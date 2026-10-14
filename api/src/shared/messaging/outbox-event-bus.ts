import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';
import type { LdmsClsStore } from '../tenancy/tenant-context.js';
import { correlate } from './correlate.js';
import type { EventBus } from './event-bus.js';
import type { DomainEventEnvelope } from './event-envelope.js';
import { OUTBOX_STORE, type OutboxStore } from './outbox.store.js';

/** How long the relay waits before its first retry of an inline failure. */
const INLINE_RETRY_DELAY_MS = 1_000;

/**
 * Phase-2 event bus: every event is persisted to the outbox, then delivered.
 *
 * The write and the delivery both run on the ambient transaction, so an event
 * raised (and delivered) inside a request shares that request's commit: if the
 * business change rolls back, the event disappears with it. Delivery itself
 * keeps the phase-1 contract — synchronous, in-process, and unable to fail the
 * request:
 *
 * - a listener that succeeds gets its row marked `processed`;
 * - a listener that throws leaves the row `pending` with the attempt recorded,
 *   and the {@link OutboxRelayService} retries it with backoff.
 *
 * The append is idempotent per `event_id`, so a replay is a no-op here rather
 * than a second delivery. The relay, not this adapter, is what makes delivery
 * at-least-once; the bus only guarantees the event is never lost silently.
 */
@Injectable()
export class OutboxEventBus implements EventBus {
  private readonly logger = new Logger(OutboxEventBus.name);

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly cls: ClsService<LdmsClsStore>,
    @Inject(OUTBOX_STORE) private readonly outbox: OutboxStore,
  ) {}

  async publish(event: DomainEventEnvelope): Promise<void> {
    const correlated = correlate(event, this.cls);
    const rowId = await this.outbox.append(correlated);

    if (rowId === null) {
      // The event is already recorded: a replay of a command that was already
      // published, or a redelivery. It was (or will be) delivered once; running
      // the listeners again would double every side effect.
      this.logger.debug(
        { eventId: correlated.id, type: correlated.type },
        'event already recorded; skipping inline delivery',
      );
      return;
    }

    try {
      await this.emitter.emitAsync(correlated.type, correlated);
    } catch (error) {
      // Best-effort for the request: a broken listener must never fail the
      // business write. The row stays pending and the relay retries it.
      await this.outbox
        .markFailed(
          rowId,
          error,
          new Date(Date.now() + INLINE_RETRY_DELAY_MS),
          false,
        )
        .catch(() => undefined);
      this.logger.error(
        { eventId: correlated.id, type: correlated.type, error },
        'event listener failed; the relay will retry',
      );
      return;
    }

    await this.outbox.markProcessed(rowId);
  }

  async publishAll(events: readonly DomainEventEnvelope[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
