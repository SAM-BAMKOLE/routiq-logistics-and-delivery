import {
  canTransition,
  isShipmentStatus,
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSITIONS,
  type ShipmentStatus,
} from './shipment-status.js';

/**
 * The doc pins the machine at 10 states and 13 transitions; this table
 * lists every allowed pair explicitly (and nothing else is allowed), so a
 * future edit to the machine must edit this test on purpose.
 */
const ALLOWED: ReadonlyArray<[ShipmentStatus, ShipmentStatus]> = [
  ['CREATED', 'CONFIRMED'],
  ['CREATED', 'CANCELLED'],
  ['CONFIRMED', 'ASSIGNED'],
  ['CONFIRMED', 'CANCELLED'],
  ['ASSIGNED', 'PICKED_UP'],
  ['ASSIGNED', 'CONFIRMED'],
  ['ASSIGNED', 'CANCELLED'],
  ['PICKED_UP', 'IN_TRANSIT'],
  ['IN_TRANSIT', 'OUT_FOR_DELIVERY'],
  ['OUT_FOR_DELIVERY', 'DELIVERED'],
  ['OUT_FOR_DELIVERY', 'FAILED_ATTEMPT'],
  ['FAILED_ATTEMPT', 'OUT_FOR_DELIVERY'],
  ['FAILED_ATTEMPT', 'RETURNED'],
];

describe('shipment state machine', () => {
  it('has exactly the documented shape: 10 states, 13 transitions', () => {
    expect(SHIPMENT_STATUSES).toHaveLength(10);
    const edgeCount = SHIPMENT_STATUSES.reduce(
      (count, status) => count + SHIPMENT_TRANSITIONS[status].length,
      0,
    );
    expect(edgeCount).toBe(13);
  });

  it('allows exactly the listed pairs and nothing else', () => {
    const allowedSet = new Set(ALLOWED.map(([from, to]) => `${from}->${to}`));
    expect(ALLOWED).toHaveLength(13);

    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_STATUSES) {
        const expected = allowedSet.has(`${from}->${to}`);
        expect([from, to, canTransition(from, to)]).toEqual([
          from,
          to,
          expected,
        ]);
      }
    }
  });

  it('keeps DELIVERED, RETURNED, and CANCELLED terminal', () => {
    expect(SHIPMENT_TRANSITIONS.DELIVERED).toEqual([]);
    expect(SHIPMENT_TRANSITIONS.RETURNED).toEqual([]);
    expect(SHIPMENT_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('allows cancellation only before pickup', () => {
    expect(canTransition('CREATED', 'CANCELLED')).toBe(true);
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('ASSIGNED', 'CANCELLED')).toBe(true);
    expect(canTransition('PICKED_UP', 'CANCELLED')).toBe(false);
    expect(canTransition('IN_TRANSIT', 'CANCELLED')).toBe(false);
    expect(canTransition('OUT_FOR_DELIVERY', 'CANCELLED')).toBe(false);
  });

  it('lets a failed attempt retry or end in a return', () => {
    expect(canTransition('FAILED_ATTEMPT', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition('FAILED_ATTEMPT', 'RETURNED')).toBe(true);
    expect(canTransition('FAILED_ATTEMPT', 'DELIVERED')).toBe(false);
  });

  it('narrows unknown strings away from the status type', () => {
    expect(isShipmentStatus('CREATED')).toBe(true);
    expect(isShipmentStatus('SOMETHING_ELSE')).toBe(false);
    expect(isShipmentStatus(42)).toBe(false);
    expect(isShipmentStatus(undefined)).toBe(false);
  });
});
