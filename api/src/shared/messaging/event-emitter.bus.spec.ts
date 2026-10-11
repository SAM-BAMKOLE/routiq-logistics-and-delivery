import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ClsService } from 'nestjs-cls';
import type { LdmsClsStore } from '../tenancy/tenant-context.js';
import { EventEmitterBus } from './event-emitter.bus.js';
import { createEnvelope, type DomainEventEnvelope } from './event-envelope.js';

describe('EventEmitterBus', () => {
  function makeBus(requestId?: string) {
    const emitter = new EventEmitter2();
    const cls = {
      get: (key: string) => (key === 'requestId' ? requestId : undefined),
    } as unknown as ClsService<LdmsClsStore>;
    const bus = new EventEmitterBus(emitter, cls);
    return { emitter, bus };
  }

  it('delivers to typed listeners with the request id as correlation', async () => {
    const { emitter, bus } = makeBus('req-42');
    const seen: DomainEventEnvelope[] = [];
    emitter.on('ShipmentConfirmed', (event: DomainEventEnvelope) => {
      seen.push(event);
    });

    await bus.publish(
      createEnvelope({
        type: 'ShipmentConfirmed',
        tenantId: 't-1',
        aggregateType: 'shipment',
        aggregateId: 's-1',
        payload: { toStatus: 'CONFIRMED' },
      }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].correlationId).toBe('req-42');
    expect(seen[0].tenantId).toBe('t-1');
  });

  it('never overwrites a correlation id the publisher already set', async () => {
    const { emitter, bus } = makeBus('req-42');
    const seen: DomainEventEnvelope[] = [];
    emitter.on('PasswordResetRequested', (event: DomainEventEnvelope) => {
      seen.push(event);
    });

    await bus.publish(
      createEnvelope({
        type: 'PasswordResetRequested',
        correlationId: 'upstream-1',
        aggregateType: 'user',
        aggregateId: 'u-1',
        payload: {},
      }),
    );

    expect(seen[0].correlationId).toBe('upstream-1');
  });

  it('swallows listener failures: the raising request continues', async () => {
    const { emitter, bus } = makeBus();
    emitter.on('ShipmentFailed', () => {
      throw new Error('listener exploded');
    });

    await expect(
      bus.publish(
        createEnvelope({
          type: 'ShipmentFailed',
          aggregateType: 'shipment',
          aggregateId: 's-1',
          payload: {},
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('publishes several events in order', async () => {
    const { emitter, bus } = makeBus();
    const order: string[] = [];
    emitter.on('A', () => order.push('A'));
    emitter.on('B', () => order.push('B'));
    emitter.on('C', () => order.push('C'));

    await bus.publishAll([
      createEnvelope({ type: 'A', aggregateType: 'x', aggregateId: '1', payload: {} }),
      createEnvelope({ type: 'B', aggregateType: 'x', aggregateId: '1', payload: {} }),
      createEnvelope({ type: 'C', aggregateType: 'x', aggregateId: '1', payload: {} }),
    ]);

    expect(order).toEqual(['A', 'B', 'C']);
  });
});
