import { Shipment, ShipmentDomainError } from './shipment.js';

function newShipment(priceMinor: number | null = 50_000): Shipment {
  return Shipment.create({
    id: 's-1',
    tenantId: 't-1',
    trackingNumber: 'SHP-K7M2N9PQ4R8T',
    customerId: 'c-1',
    pickupAddressId: 'a-1',
    dropoffAddressId: 'a-2',
    weightKg: 120,
    volumeM3: 1.5,
    windowStart: new Date('2026-10-12T08:00:00Z'),
    windowEnd: new Date('2026-10-12T17:00:00Z'),
    priceMinor,
    currency: 'NGN',
    items: [{ description: 'Cartons', quantity: 10, weightKg: 120 }],
  });
}

function expectDomainError(run: () => void, code: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShipmentDomainError);
  expect((caught as ShipmentDomainError).code).toBe(code);
}

describe('Shipment aggregate', () => {
  it('starts at CREATED with a creation history row and event', () => {
    const shipment = newShipment();

    expect(shipment.status).toBe('CREATED');
    expect(shipment.version).toBe(1);
    expect(shipment.failedAttempts).toBe(0);
    expect(shipment.items).toHaveLength(1);

    expect(shipment.pullTransitions()).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'CREATED' }),
    ]);
    expect(shipment.pullDomainEvents().map((e) => e.type)).toEqual([
      'ShipmentCreated',
    ]);
    // Both queues drain: the service persists each batch once.
    expect(shipment.pullTransitions()).toEqual([]);
    expect(shipment.pullDomainEvents()).toEqual([]);
  });

  it('walks the happy path to DELIVERED, bumping the version each step', () => {
    const shipment = newShipment();

    shipment.confirm();
    expect(shipment.status).toBe('CONFIRMED');
    expect(shipment.version).toBe(2);

    shipment.assign('d-1', 'v-1');
    shipment.markPickedUp();
    shipment.startTransit();
    shipment.startDelivery();
    shipment.deliver();

    expect(shipment.status).toBe('DELIVERED');
    expect(shipment.version).toBe(7);

    const types = shipment.pullDomainEvents().map((event) => event.type);
    expect(types).toContain('ShipmentConfirmed');
    expect(types).toContain('ShipmentDelivered');
    expect(types.filter((type) => type === 'ShipmentStatusChanged')).toHaveLength(6);
  });

  it('carries the driver and vehicle identity into assignment events', () => {
    const shipment = newShipment();
    shipment.confirm();

    shipment.assign('d-9', 'v-9');
    const events = shipment.pullDomainEvents();
    const changed = events.find(
      (event) => event.payload['toStatus'] === 'ASSIGNED',
    );
    expect(changed?.payload).toMatchObject({
      driverId: 'd-9',
      vehicleId: 'v-9',
      toStatus: 'ASSIGNED',
    });
  });

  it('refuses to confirm without a quote', () => {
    const shipment = newShipment(null);
    expectDomainError(() => shipment.confirm(), 'SHIPMENT_QUOTE_REQUIRED');
    expect(shipment.status).toBe('CREATED');
  });

  it('rejects out-of-order actions with SHIPMENT_INVALID_TRANSITION', () => {
    const shipment = newShipment();
    expectDomainError(() => shipment.markPickedUp(), 'SHIPMENT_INVALID_TRANSITION');
    shipment.confirm();
    shipment.assign('d-1');
    expectDomainError(() => shipment.deliver(), 'SHIPMENT_INVALID_TRANSITION');
  });

  it('cancels only before pickup, with the documented message', () => {
    const shipment = newShipment();
    shipment.confirm();
    shipment.assign('d-1');
    shipment.markPickedUp();

    let caught: unknown;
    try {
      shipment.cancel('customer asked');
    } catch (error: unknown) {
      caught = error;
    }
    expect((caught as ShipmentDomainError).message).toBe(
      'A shipment in status PICKED_UP cannot be cancelled.',
    );
    expect(shipment.status).toBe('PICKED_UP');
  });

  it('releases an assignment back to CONFIRMED', () => {
    const shipment = newShipment();
    shipment.confirm();
    shipment.assign('d-1');
    shipment.release('driver declined');
    expect(shipment.status).toBe('CONFIRMED');
  });

  it('requires a driver on assignment', () => {
    const shipment = newShipment();
    shipment.confirm();
    expectDomainError(() => shipment.assign(''), 'SHIPMENT_DRIVER_REQUIRED');
  });

  it('requires a reason on a failed attempt and counts the attempt', () => {
    const shipment = newShipment();
    shipment.confirm();
    shipment.assign('d-1');
    shipment.markPickedUp();
    shipment.startTransit();
    shipment.startDelivery();

    expectDomainError(() => shipment.fail('   '), 'SHIPMENT_REASON_REQUIRED');

    shipment.fail('nobody home');
    expect(shipment.status).toBe('FAILED_ATTEMPT');
    expect(shipment.failedAttempts).toBe(1);
    const failed = shipment
      .pullTransitions()
      .find((transition) => transition.toStatus === 'FAILED_ATTEMPT');
    expect(failed?.reason).toBe('nobody home');
    const types = shipment.pullDomainEvents().map((event) => event.type);
    expect(types).toContain('ShipmentFailed');
  });

  it('retries until the attempt limit, then only a return remains', () => {
    const shipment = newShipment();
    shipment.confirm();
    shipment.assign('d-1');
    shipment.markPickedUp();
    shipment.startTransit();
    shipment.startDelivery();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      shipment.fail(`miss ${attempt}`);
      if (attempt < 3) {
        shipment.retry(3);
        expect(shipment.status).toBe('OUT_FOR_DELIVERY');
      }
    }
    expectDomainError(() => shipment.retry(3), 'SHIPMENT_RETRY_EXHAUSTED');

    shipment.returnShipment('attempt limit reached');
    expect(shipment.status).toBe('RETURNED');
  });

  it('refuses a retry that would cross the limit', () => {
    const shipment = newShipment();
    shipment.confirm();
    shipment.assign('d-1');
    shipment.markPickedUp();
    shipment.startTransit();
    shipment.startDelivery();
    shipment.fail('miss');
    expectDomainError(() => shipment.retry(1), 'SHIPMENT_RETRY_EXHAUSTED');
  });

  it('rehydrates persisted state without replaying events', () => {
    const shipment = Shipment.rehydrate({
      id: 's-2',
      tenantId: 't-1',
      trackingNumber: 'SHP-AAAAAAAAAAAA',
      customerId: 'c-1',
      pickupAddressId: 'a-1',
      dropoffAddressId: 'a-2',
      weightKg: 10,
      volumeM3: null,
      windowStart: null,
      windowEnd: null,
      priceMinor: 1000,
      currency: 'NGN',
      status: 'OUT_FOR_DELIVERY',
      failedAttempts: 1,
      version: 5,
      createdAt: new Date('2026-10-10T00:00:00Z'),
      updatedAt: new Date('2026-10-10T01:00:00Z'),
      items: [],
    });

    expect(shipment.status).toBe('OUT_FOR_DELIVERY');
    expect(shipment.version).toBe(5);
    expect(shipment.pullDomainEvents()).toEqual([]);
    expect(shipment.pullTransitions()).toEqual([]);

    shipment.deliver();
    expect(shipment.version).toBe(6);
  });
});
