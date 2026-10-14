import type { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EntityManager } from 'typeorm';
import type { DomainEventEnvelope } from '../../../shared/messaging/event-envelope.js';
import type { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import type {
  ClaimedOutboxMessage,
  OutboxService,
} from './outbox.service.js';
import { OutboxRelayService } from './outbox-relay.service.js';

/** In-memory stand-in for the persistence, scripted by each test. */
class FakeOutbox {
  batch: ClaimedOutboxMessage[] = [];
  processed: string[] = [];
  failed: Array<{ id: string; availableAt: Date; exhausted: boolean }> = [];

  async claim(): Promise<ClaimedOutboxMessage[]> {
    const claimed = this.batch;
    this.batch = [];
    return claimed;
  }

  async markProcessed(id: string): Promise<void> {
    this.processed.push(id);
  }

  async markFailed(
    id: string,
    _error: unknown,
    availableAt: Date,
    exhausted: boolean,
  ): Promise<void> {
    this.failed.push({ id, availableAt, exhausted });
  }

  async runInTransaction<T>(
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return fn({} as EntityManager);
  }
}

function message(
  overrides: Partial<ClaimedOutboxMessage> = {},
): ClaimedOutboxMessage {
  const envelope: DomainEventEnvelope = {
    id: 'event-1',
    type: 'Probe',
    tenantId: 'tenant-1',
    occurredAt: new Date().toISOString(),
    aggregateType: 'Shipment',
    aggregateId: 's-1',
    aggregateVersion: null,
    correlationId: null,
    causationId: null,
    payload: {},
  };
  return {
    id: 'row-1',
    tenantId: 'tenant-1',
    eventType: 'Probe',
    eventId: 'event-1',
    envelope,
    attempts: 0,
    ...overrides,
  };
}

describe('OutboxRelayService', () => {
  function makeRelay(
    outbox: FakeOutbox,
    options: { maxAttempts?: number } = {},
  ) {
    const emitter = new EventEmitter2();
    const transactions = {
      runWithTenant: (
        _tenantId: string,
        fn: (manager: EntityManager) => Promise<unknown>,
      ) => fn({} as EntityManager),
    } as unknown as TenantTransactionService;
    const config = {
      get: (key: string) => {
        if (key === 'OUTBOX_MAX_ATTEMPTS') return options.maxAttempts ?? 8;
        if (key === 'OUTBOX_RELAY_ENABLED') return false;
        return undefined;
      },
    } as unknown as ConfigService;

    const relay = new OutboxRelayService(
      outbox as unknown as OutboxService,
      emitter,
      transactions,
      config,
    );
    return { emitter, relay };
  }

  it('delivers a claimed tenant event and marks it processed', async () => {
    const outbox = new FakeOutbox();
    outbox.batch = [message()];
    const { emitter, relay } = makeRelay(outbox);
    const seen: string[] = [];
    emitter.on('Probe', (event: DomainEventEnvelope) => {
      seen.push(event.id);
    });

    const result = await relay.relayOnce();

    expect(seen).toEqual(['event-1']);
    expect(outbox.processed).toEqual(['row-1']);
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
  });

  it('schedules a backoff retry when a listener fails', async () => {
    const outbox = new FakeOutbox();
    outbox.batch = [message({ attempts: 2 })];
    const { emitter, relay } = makeRelay(outbox);
    emitter.on('Probe', async () => {
      throw new Error('downstream is down');
    });

    const before = Date.now();
    const result = await relay.relayOnce();

    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(outbox.processed).toHaveLength(0);
    expect(outbox.failed).toHaveLength(1);
    expect(outbox.failed[0].id).toBe('row-1');
    expect(outbox.failed[0].exhausted).toBe(false);
    // attempts=2 failed twice already, so the next wait is 2^2 = 4s.
    expect(outbox.failed[0].availableAt.getTime()).toBeGreaterThanOrEqual(
      before + 4_000,
    );
  });

  it('makes the row terminal once attempts are exhausted', async () => {
    const outbox = new FakeOutbox();
    outbox.batch = [message({ attempts: 0 })];
    const { emitter, relay } = makeRelay(outbox, { maxAttempts: 1 });
    emitter.on('Probe', async () => {
      throw new Error('still failing');
    });

    await relay.relayOnce();

    expect(outbox.failed).toEqual([
      { id: 'row-1', availableAt: expect.any(Date), exhausted: true },
    ]);
  });

  it('delivers a global event in a plain transaction', async () => {
    const outbox = new FakeOutbox();
    outbox.batch = [message({ tenantId: null })];
    const { emitter, relay } = makeRelay(outbox);
    const seen: string[] = [];
    emitter.on('Probe', (event: DomainEventEnvelope) => {
      seen.push(event.id);
    });

    const result = await relay.relayOnce();

    expect(seen).toEqual(['event-1']);
    expect(result.delivered).toBe(1);
  });

  it('does nothing when the outbox has no ready rows', async () => {
    const outbox = new FakeOutbox();
    const { relay } = makeRelay(outbox);

    await expect(relay.relayOnce()).resolves.toEqual({
      claimed: 0,
      delivered: 0,
      failed: 0,
    });
  });
});
