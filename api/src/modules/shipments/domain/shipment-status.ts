/**
 * The shipment state machine: ten statuses and thirteen transitions, pure
 * data plus a lookup. Only the Shipment aggregate (see `shipment.ts`) may
 * walk this table, so every path through a shipment's life is explicit and
 * unit-testable without a database or a framework.
 */
export const SHIPMENT_STATUSES = [
  'CREATED',
  'CONFIRMED',
  'ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED_ATTEMPT',
  'RETURNED',
  'CANCELLED',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Allowed transitions per status. Business rules baked into the shape:
 * - cancellation only before pickup (CREATED, CONFIRMED, ASSIGNED),
 * - a failed attempt either retries (back to OUT_FOR_DELIVERY) or ends in a
 *   return,
 * - DELIVERED, RETURNED, and CANCELLED are terminal.
 */
export const SHIPMENT_TRANSITIONS: Readonly<
  Record<ShipmentStatus, readonly ShipmentStatus[]>
> = {
  CREATED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CONFIRMED', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED_ATTEMPT'],
  FAILED_ATTEMPT: ['OUT_FOR_DELIVERY', 'RETURNED'],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return (
    typeof value === 'string' && (SHIPMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}
