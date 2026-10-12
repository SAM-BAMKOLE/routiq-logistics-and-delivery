import {
  driverRoom,
  parseRoom,
  routeRoom,
  shipmentRoom,
  tenantRoom,
} from './room.js';

const ID = '3f1d2a60-8f3e-4a2c-9a1b-0c9d8e7f6a5b';

describe('room names', () => {
  it('builds `<kind>:<uuid>` names', () => {
    expect(tenantRoom(ID)).toBe(`tenant:${ID}`);
    expect(driverRoom(ID)).toBe(`driver:${ID}`);
    expect(shipmentRoom(ID)).toBe(`shipment:${ID}`);
    expect(routeRoom(ID)).toBe(`route:${ID}`);
  });

  it('round-trips every kind through parseRoom', () => {
    for (const name of [
      tenantRoom(ID),
      driverRoom(ID),
      shipmentRoom(ID),
      routeRoom(ID),
    ]) {
      const parsed = parseRoom(name);
      expect(parsed).not.toBeNull();
      expect(parsed?.id).toBe(ID);
    }
  });

  it('accepts uppercase uuids (the wire is case-insensitive)', () => {
    const parsed = parseRoom(`shipment:${ID.toUpperCase()}`);
    expect(parsed?.id).toBe(ID.toUpperCase());
  });

  it('rejects anything that is not a room', () => {
    expect(parseRoom(undefined)).toBeNull();
    expect(parseRoom(42)).toBeNull();
    expect(parseRoom('')).toBeNull();
    expect(parseRoom('shipment')).toBeNull();
    expect(parseRoom(':missing-kind')).toBeNull();
    expect(parseRoom('invoice:' + ID)).toBeNull();
    expect(parseRoom('shipment:not-a-uuid')).toBeNull();
    // Injection attempts through the id half.
    expect(parseRoom(`shipment:${ID}; DROP TABLE x`)).toBeNull();
    expect(parseRoom(`shipment:${ID}/../driver:${ID}`)).toBeNull();
    expect(parseRoom(`shipment:${ID}:extra`)).toBeNull();
  });
});
