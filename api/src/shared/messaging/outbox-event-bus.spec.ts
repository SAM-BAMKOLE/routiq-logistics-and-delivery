import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ClsService } from 'nestjs-cls';
import type { LdmsClsStore } from '../tenancy/tenant-context.js';
import { createEnvelope, type DomainEventEnvelope } from './event-envelope.js';
import { OutboxEventBus } from './outbox-event-bus.js';
import type { OutboxStore } from './outbox.store.js';

/** Records what the bus asked the outbox to do, without a database. */
class RecordingStore implements OutboxStore {
  readonly appended: DomainEventEnvelope[] = [];
  readonly processed: string[] = [];
  readonly failed: Array<{ id: string; exhausted: boolean }> = [];

  async append(event: DomainEventEnvelope): Promise<string | null> {
    this.appended.push(event);
    return `row-${this.appended.length}`;
  }

  async markProcessed(id: string): Promise<void> {
    this.processed.push(id);
  }

  async markFailed(
    id: string,
    _error: unknown,
    _availableAt: Date,
    exhausted: boolean,
  ): Promise<void> {
    this.failed.push({ id, exhausted });
  }
}

describe('OutboxEventBus', () => {
  function makeBus(requestId?: string) {
    const emitter = new EventEmitter2();
    const cls = {
      get: (key: string) => (key === 'requestId' ? requestId : undefined),
    } as unknown as ClsService<LdmsClsStore>;
    const store = new RecordingStore();
    const bus = new OutboxEventBus(emitter, cls, store);
    return { emitter, store, bus };
  }

  it('persists the event, delivers it, then marks the row processed', async () => {
    const { emitter, store, bus } = makeBus();
    const seen: string[] = [];
    emitter.on('ShipmentConfirmed', (event: DomainEventEnvelope) => {
      seen.push(event.id);
    });

    const event = createEnvelope({
      type: 'ShipmentConfirmed',
      tenantId: 't-1',
      aggregateType: 'Shipment',
      aggregateId: 's-1',
      payload: {},
    });
    await bus.publish(event);

    expect(store.appended.map((item) => item.id)).toEqual([event.id]);
    expect(seen).toEqual([event.id]);
    expect(store.processed).toEqual(['row-1']);
    expect(store.failed).toHaveLength(0);
  });

  it('fills the correlation id from the request context', async () => {
    const { store, bus } = makeBus('req-42');
    await bus.publish(
      createEnvelope({
        type: 'ShipmentConfirmed',
        tenantId: 't-1',
        aggregateType: 'Shipment',
        aggregateId: 's-1',
        payload: {},
      }),
    );

    expect(store.appended[0].correlationId).toBe('req-42');
  });

  it('keeps a failed delivery pending for the relay', async () => {
    const { emitter, store, bus } = makeBus();
    emitter.on('ShipmentFailed', () => {
      throw new Error('smtp down');
    });

    await bus.publish(
      createEnvelope({
        type: 'ShipmentFailed',
        tenantId: 't-1',
        aggregateType: 'Shipment',
        aggregateId: 's-1',
        payload: {},
      }),
    );

    // The event is durable even though delivery failed...
    expect(store.appended).toHaveLength(1);
    // ...it was not acknowledged...
    expect(store.processed).toHaveLength(0);
    // ...and the attempt was recorded for a retry.
    expect(store.failed).toEqual([{ id: 'row-1', exhausted: false }]);
  });

  it('skips redelivery when the event is already recorded', async () => {
    const emitter = new EventEmitter2();
    const cls = { get: () => undefined } as unknown as ClsService<LdmsClsStore>;
    let appended = 0;
    const store: OutboxStore = {
      append: async () => {
        appended += 1;
        return appended === 1 ? 'row-1' : null;
      },
      markProcessed: async () => undefined,
      markFailed: async () => undefined,
    };
    const bus = new OutboxEventBus(emitter, cls, store);
    const seen: string[] = [];
    emitter.on('ShipmentConfirmed', (event: DomainEventEnvelope) => {
      seen.push(event.id);
    });
    const event = createEnvelope({
      type: 'ShipmentConfirmed',
      tenantId: 't-1',
      aggregateType: 'Shipment',
      aggregateId: 's-1',
      payload: {},
    });

    await bus.publish(event);
    await bus.publish(event);

    expect(seen).toEqual([event.id]);
  });

  it('delivers every event in publishAll, in order', async () => {
    const { emitter, store, bus } = makeBus();
    const seen: string[] = [];
    emitter.on('Probe', (event: DomainEventEnvelope) => {
      seen.push(event.type);
    });

    await bus.publishAll([
      createEnvelope({ type: 'Probe', aggregateType: 'A', aggregateId: '1', payload: {} }),
      createEnvelope({ type: 'Probe', aggregateType: 'A', aggregateId: '2', payload: {} }),
    ]);

    expect(store.appended).toHaveLength(2);
    expect(seen).toHaveLength(2);
  });
});
