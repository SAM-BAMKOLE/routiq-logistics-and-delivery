import { createEnvelope } from './event-envelope.js';

describe('createEnvelope', () => {
  it('fills identity and clock, leaving correlation to the bus', () => {
    const envelope = createEnvelope({
      type: 'ShipmentConfirmed',
      tenantId: 't-1',
      aggregateType: 'shipment',
      aggregateId: 's-1',
      aggregateVersion: 2,
      payload: { toStatus: 'CONFIRMED' },
    });

    expect(envelope.id).toEqual(expect.any(String));
    expect(envelope.id).toHaveLength(36); // a UUID
    expect(envelope.type).toBe('ShipmentConfirmed');
    expect(envelope.tenantId).toBe('t-1');
    expect(envelope.aggregateVersion).toBe(2);
    expect(envelope.payload).toEqual({ toStatus: 'CONFIRMED' });
    // Not yet correlated: the bus stamps the request id in.
    expect(envelope.correlationId).toBeNull();
    expect(envelope.causationId).toBeNull();
    expect(Number.isNaN(Date.parse(envelope.occurredAt))).toBe(false);
  });

  it('defaults global events to null tenant and no version', () => {
    const occurredAt = new Date('2026-10-11T08:00:00.000Z');
    const envelope = createEnvelope({
      type: 'PasswordResetRequested',
      aggregateType: 'user',
      aggregateId: 'someone@example.com',
      occurredAt,
      payload: { email: 'someone@example.com', resetToken: null },
    });

    expect(envelope.tenantId).toBeNull();
    expect(envelope.aggregateVersion).toBeNull();
    expect(envelope.occurredAt).toBe('2026-10-11T08:00:00.000Z');
  });

  it('produces a fresh id per envelope', () => {
    const input = {
      type: 'X',
      aggregateType: 'x',
      aggregateId: 'x-1',
      payload: {},
    };
    expect(createEnvelope(input).id).not.toBe(createEnvelope(input).id);
  });
});
