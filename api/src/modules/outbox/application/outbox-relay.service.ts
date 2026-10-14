import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import { OutboxService } from './outbox.service.js';
import type { ClaimedOutboxMessage } from './outbox.service.js';

/** Delay before the first retry: each further attempt doubles, capped. */
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 60_000;

/** What one relay pass did. */
export interface RelayResult {
  claimed: number;
  delivered: number;
  failed: number;
}

/**
 * The durable half of the outbox: it claims pending rows and delivers them.
 *
 * The relay is embedded in the API process (the zero-spend deployment runs a
 * single free instance), not a separate worker with Redis and BullMQ. It polls
 * the outbox on an interval, claims a batch with `FOR UPDATE SKIP LOCKED`,
 * rebuilds each event and dispatches it to the same `@OnEvent` listeners the
 * request path uses. A successful delivery is marked `processed`; a failure is
 * recorded and retried with exponential backoff until `OUTBOX_MAX_ATTEMPTS`.
 *
 * Dispatch and the `processed` flag share one transaction: for a tenant event
 * the relay opens a tenant transaction (so listener repositories see the right
 * RLS context), for a global event a plain one. Everything the listener writes
 * through `TransactionHost.tx` commits with the flag, and a crash rolls back
 * both — so a redelivery always starts from a clean slate rather than a
 * half-applied one. That is why there is no separate consumer-dedupe table.
 */
@Injectable()
export class OutboxRelayService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;

  constructor(
    private readonly outbox: OutboxService,
    private readonly emitter: EventEmitter2,
    private readonly transactions: TenantTransactionService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('OUTBOX_RELAY_ENABLED') ?? true;
    this.intervalMs = config.get<number>('OUTBOX_RELAY_INTERVAL_MS') ?? 5_000;
    this.batchSize = config.get<number>('OUTBOX_RELAY_BATCH_SIZE') ?? 25;
    this.maxAttempts = config.get<number>('OUTBOX_MAX_ATTEMPTS') ?? 8;
    this.lockTimeoutMs = config.get<number>('OUTBOX_LOCK_TIMEOUT_MS') ?? 60_000;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('outbox relay disabled by configuration');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // A background convenience must never hold the process open.
    this.timer.unref?.();
    this.logger.log({ intervalMs: this.intervalMs }, 'outbox relay started');
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Processes at most one batch and returns what happened. Public so tests and
   * operational tooling can drain the outbox on demand.
   */
  async relayOnce(): Promise<RelayResult> {
    const batch = await this.outbox.claim(this.batchSize, this.lockTimeoutMs);
    let delivered = 0;
    let failed = 0;

    for (const message of batch) {
      try {
        await this.deliver(message);
        delivered += 1;
      } catch (error) {
        failed += 1;
        await this.recordFailure(message, error);
      }
    }

    return { claimed: batch.length, delivered, failed };
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.relayOnce();
    } catch (error) {
      this.logger.error({ error }, 'outbox relay batch failed');
    } finally {
      this.running = false;
    }
  }

  private async deliver(message: ClaimedOutboxMessage): Promise<void> {
    if (message.tenantId) {
      await this.transactions.runWithTenant(message.tenantId, (manager) =>
        this.dispatch(message, manager),
      );
      return;
    }
    await this.outbox.runInTransaction((manager) =>
      this.dispatch(message, manager),
    );
  }

  /**
   * Hands the event to the listeners and marks the row delivered, in one
   * transaction, so a crash cannot both apply the side effects and leave the
   * row claimable.
   */
  private async dispatch(
    message: ClaimedOutboxMessage,
    manager: EntityManager,
  ): Promise<void> {
    await this.emitter.emitAsync(message.eventType, message.envelope);
    await this.outbox.markProcessed(message.id, manager);
  }

  private async recordFailure(
    message: ClaimedOutboxMessage,
    error: unknown,
  ): Promise<void> {
    const attempts = message.attempts + 1;
    const exhausted = attempts >= this.maxAttempts;
    const availableAt = new Date(Date.now() + backoffDelayMs(message.attempts));

    await this.outbox.markFailed(message.id, error, availableAt, exhausted);
    this.logger.warn(
      { eventId: message.eventId, type: message.eventType, attempts, exhausted },
      'outbox delivery failed; scheduled a retry',
    );
  }
}

/** Exponential backoff for the next attempt, capped at one minute. */
function backoffDelayMs(priorAttempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** priorAttempts, RETRY_CAP_MS);
}
