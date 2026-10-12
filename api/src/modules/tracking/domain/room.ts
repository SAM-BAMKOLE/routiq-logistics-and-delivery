/**
 * Socket.IO room names, as a domain concept.
 *
 * A room is always `<kind>:<uuid>` and every id is a tenant-owned resource,
 * so joining one is an authorization decision, not a cosmetic one: the
 * gateway parses the name here, then asks the owning module whether this
 * principal may see that row (which answers 404 for foreign tenants, so the
 * socket never learns the id exists).
 */

export const ROOM_KINDS = ['tenant', 'driver', 'shipment', 'route'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parsed form of a room name; `null` when the string is not a room. */
export interface ParsedRoom {
  readonly kind: RoomKind;
  readonly id: string;
}

export function parseRoom(name: unknown): ParsedRoom | null {
  if (typeof name !== 'string') {
    return null;
  }
  const separator = name.indexOf(':');
  if (separator < 1) {
    return null;
  }
  const kind = name.slice(0, separator);
  const id = name.slice(separator + 1);
  if (
    !(ROOM_KINDS as readonly string[]).includes(kind) ||
    !UUID.test(id)
  ) {
    return null;
  }
  return { kind: kind as RoomKind, id };
}

export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function driverRoom(driverId: string): string {
  return `driver:${driverId}`;
}

export function shipmentRoom(shipmentId: string): string {
  return `shipment:${shipmentId}`;
}

export function routeRoom(routeId: string): string {
  return `route:${routeId}`;
}
