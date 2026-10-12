import {
  NotFoundException,
  PreconditionFailedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Address, Customer } from '../../customers/domain/customer.js';
import type { CustomersService } from '../../customers/application/customers.service.js';
import type { DriversService } from '../../drivers/application/drivers.service.js';
import type { VehiclesService } from '../../fleet/application/vehicles.service.js';
import type { QuotesService } from '../../pricing/application/quotes.service.js';
import type { TenantsService } from '../../tenants/application/tenants.service.js';
import { FakeEventBus } from '../../../shared/messaging/testing/fake-event-bus.js';
import { Shipment } from '../domain/shipment.js';
import type { DeliveryProofRead } from '../domain/delivery-proof-read.js';
import type {
  ShipmentHistoryEntry,
  ShipmentListFilters,
  ShipmentRepository,
} from '../domain/shipment.repository.js';
import {
  ShipmentsService,
  type CreateShipmentCommand,
  type ShipmentActor,
} from './shipments.service.js';

const dispatcher: ShipmentActor = { userId: 'u-1', role: 'dispatcher' };
const admin: ShipmentActor = { userId: 'u-2', role: 'tenant_admin' };
const customerActor: ShipmentActor = { userId: 'u-3', role: 'customer' };
const driverActor: ShipmentActor = { userId: 'u-4', role: 'driver' };

function customerFixture(id: string, userId: string | null): Customer {
  return {
    id,
    tenantId: 't-1',
    name: `Customer ${id}`,
    email: null,
    phone: null,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function addressFixture(id: string, customerId: string): Address {
  return {
    id,
    tenantId: 't-1',
    customerId,
    line1: '14 Warehouse Road',
    line2: null,
    city: 'Lagos',
    region: null,
    country: 'NG',
    postalCode: null,
    latitude: 6.5244,
    longitude: 3.3792,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Harness {
  service: ShipmentsService;
  shipments: Map<string, Shipment>;
  history: ShipmentHistoryEntry[];
  customers: Map<string, Customer>;
  addresses: Map<string, Address>;
  settings: Record<string, unknown>;
  failInserts: number;
  /** Whether the proof-of-delivery table already holds a proof row. */
  hasProof: boolean;
  bus: FakeEventBus;
}

function makeHarness(options: { quotes?: QuotesService } = {}): Harness {
  const shipments = new Map<string, Shipment>();
  const history: ShipmentHistoryEntry[] = [];
  const customers = new Map<string, Customer>([
    ['c-1', customerFixture('c-1', 'u-3')],
    ['c-2', customerFixture('c-2', null)],
  ]);
  const addresses = new Map<string, Address>([
    ['a-1', addressFixture('a-1', 'c-1')],
    ['a-2', addressFixture('a-2', 'c-1')],
    ['a-9', addressFixture('a-9', 'c-2')],
  ]);
  const harness: Harness = {
    service: undefined as unknown as ShipmentsService,
    shipments,
    history,
    customers,
    addresses,
    settings: {},
    failInserts: 0,
    hasProof: false,
    bus: new FakeEventBus(),
  };

  const shipmentRepository: ShipmentRepository = {
    insert: async (shipment) => {
      if (harness.failInserts > 0) {
        harness.failInserts -= 1;
        throw { driverError: { code: '23505' } };
      }
      shipments.set(shipment.id, shipment);
    },
    save: async () => undefined,
    findById: async (id) => shipments.get(id) ?? null,
    listByTenant: async (tenantId: string, filters: ShipmentListFilters = {}) =>
      [...shipments.values()].filter(
        (shipment) =>
          shipment.tenantId === tenantId &&
          (!filters.status || shipment.status === filters.status) &&
          (!filters.customerId || shipment.customerId === filters.customerId) &&
          (!filters.driverId || shipment.driverId === filters.driverId),
      ),
  };

  const historyRepository = {
    append: async (entries: readonly ShipmentHistoryEntry[]) => {
      history.push(...entries);
    },
  };

  const defaultQuotes = {
    quote: async () => ({
      ruleId: 'r-1',
      ruleName: 'Standard',
      distanceMeters: 1000,
      weightKg: 10,
      baseFeeMinor: 50_000,
      distanceFeeMinor: 100_000,
      weightFeeMinor: 10_000,
      subtotalMinor: 160_000,
      minFeeMinor: 0,
      priceMinor: 160_000,
      currency: 'NGN',
    }),
  } as unknown as QuotesService;
  const quotes = options.quotes ?? defaultQuotes;

  const customersService = {
    getCustomer: async (_tenantId: string, id: string) => {
      const customer = customers.get(id);
      if (!customer) {
        throw new NotFoundException({
          message: `Customer ${id} was not found in this tenant.`,
          code: 'CUSTOMER_NOT_FOUND',
        });
      }
      return customer;
    },
    getAddressById: async (_tenantId: string, id: string) => {
      const address = addresses.get(id);
      if (!address) {
        throw new NotFoundException({
          message: `Address ${id} was not found for this customer.`,
          code: 'ADDRESS_NOT_FOUND',
        });
      }
      return address;
    },
    listCustomersByUser: async (_tenantId: string, userId: string) =>
      [...customers.values()].filter((customer) => customer.userId === userId),
  } as unknown as CustomersService;

  const driversService = {
    getDriver: async (_tenantId: string, id: string) => {
      if (id !== 'd-1') {
        throw new NotFoundException({
          message: `Driver ${id} was not found in this tenant.`,
          code: 'DRIVER_NOT_FOUND',
        });
      }
      return { id };
    },
    getOwnDriver: async (_tenantId: string, userId: string) => {
      const profiles: Record<string, string> = { 'u-4': 'd-1', 'u-5': 'd-2' };
      const driverId = profiles[userId];
      if (!driverId) {
        throw new NotFoundException({
          message: 'This user has no driver profile in this tenant.',
          code: 'DRIVER_PROFILE_NOT_FOUND',
        });
      }
      return { id: driverId };
    },
  } as unknown as DriversService;

  const vehiclesService = {
    getById: async (_tenantId: string, id: string) => {
      if (id !== 'v-1') {
        throw new NotFoundException({
          message: `Vehicle ${id} was not found in this tenant.`,
          code: 'VEHICLE_NOT_FOUND',
        });
      }
      return { id };
    },
  } as unknown as VehiclesService;

  const tenantsService = {
    getById: async () => ({ settings: harness.settings }),
  } as unknown as TenantsService;

  const proofRead = {
    hasProof: async () => harness.hasProof,
  } as unknown as DeliveryProofRead;

  harness.service = new ShipmentsService(
    shipmentRepository,
    historyRepository,
    quotes,
    customersService,
    driversService,
    vehiclesService,
    tenantsService,
    harness.bus,
    proofRead,
  );
  return harness;
}

const baseCommand: CreateShipmentCommand = {
  customerId: 'c-1',
  pickupAddressId: 'a-1',
  dropoffAddressId: 'a-2',
  weightKg: 120,
  items: [{ description: 'Cartons', quantity: 10, weightKg: 120 }],
};

async function createShipment(h: Harness, actor = dispatcher): Promise<Shipment> {
  return h.service.create(actor, 't-1', baseCommand);
}

/** Drives a fresh shipment to OUT_FOR_DELIVERY (dispatcher path). */
async function toOutForDelivery(h: Harness): Promise<Shipment> {
  const shipment = await createShipment(h);
  await h.service.confirm(dispatcher, 't-1', shipment.id, 1);
  await h.service.assign(dispatcher, 't-1', shipment.id, 2, 'd-1', 'v-1');
  await h.service.pickup(dispatcher, 't-1', shipment.id, 3);
  await h.service.startTransit(dispatcher, 't-1', shipment.id, 4);
  return h.service.startDelivery(dispatcher, 't-1', shipment.id, 5);
}

describe('ShipmentsService', () => {
  describe('create', () => {
    it('stores the quote, tracking number, items, and creation history', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h);

      expect(shipment.status).toBe('CREATED');
      expect(shipment.priceMinor).toBe(160_000);
      expect(shipment.currency).toBe('NGN');
      expect(shipment.trackingNumber).toMatch(/^SHP-[0-9A-HJKMNP-TV-Z]{12}$/);
      expect(shipment.publicToken).toMatch(/^[0-9a-f]{32}$/);
      expect(shipment.items).toEqual([
        { description: 'Cartons', quantity: 10, weightKg: 120 },
      ]);
      expect(h.history).toEqual([
        expect.objectContaining({
          shipmentId: shipment.id,
          fromStatus: null,
          toStatus: 'CREATED',
          actorId: 'u-1',
        }),
      ]);
    });

    it('publishes ShipmentCreated as a tenant-scoped envelope', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h);

      expect(h.bus.types()).toEqual(['ShipmentCreated']);
      const event = h.bus.lastOfType('ShipmentCreated');
      expect(event).toMatchObject({
        tenantId: 't-1',
        aggregateType: 'shipment',
        aggregateId: shipment.id,
        aggregateVersion: 1,
        payload: {
          shipmentId: shipment.id,
          trackingNumber: shipment.trackingNumber,
          customerId: 'c-1',
        },
      });
      expect(event?.occurredAt).toEqual(expect.any(String));
      expect(event?.id).toEqual(expect.any(String));
    });

    it('rejects an inverted delivery window', async () => {
      const h = makeHarness();
      await expect(
        h.service.create(dispatcher, 't-1', {
          ...baseCommand,
          windowStart: new Date('2026-10-12T17:00:00Z'),
          windowEnd: new Date('2026-10-12T08:00:00Z'),
        }),
      ).rejects.toMatchObject({ response: { code: 'WINDOW_END_BEFORE_START' } });
    });

    it('propagates a missing quote rule as 422', async () => {
      const throwingQuotes = {
        quote: async () => {
          throw new UnprocessableEntityException({
            message: 'no rule',
            code: 'NO_ACTIVE_PRICING_RULE',
          });
        },
      } as unknown as QuotesService;
      const h = makeHarness({ quotes: throwingQuotes });
      await expect(createShipment(h)).rejects.toMatchObject({
        response: { code: 'NO_ACTIVE_PRICING_RULE' },
      });
    });

    it('forces customers onto their own customer record and addresses', async () => {
      const h = makeHarness();
      const own = await h.service.create(customerActor, 't-1', baseCommand);
      expect(own.customerId).toBe('c-1');

      await expect(
        h.service.create(customerActor, 't-1', {
          ...baseCommand,
          customerId: 'c-2',
        }),
      ).rejects.toMatchObject({ response: { code: 'OWNERSHIP_VIOLATION' } });

      await expect(
        h.service.create(customerActor, 't-1', {
          ...baseCommand,
          dropoffAddressId: 'a-9', // belongs to another customer
        }),
      ).rejects.toMatchObject({ response: { code: 'OWNERSHIP_VIOLATION' } });
    });

    it('retries a tracking-number collision instead of failing', async () => {
      const h = makeHarness();
      h.failInserts = 2;
      const shipment = await createShipment(h);
      expect(shipment.trackingNumber).toMatch(/^SHP-/);
    });
  });

  describe('reads and policies', () => {
    it('scopes lists: dispatchers see all, customers their own, drivers their assigned', async () => {
      const h = makeHarness();
      // Staff ship for any tenant customer; the portal user only owns c-1.
      await h.service.create(dispatcher, 't-1', { ...baseCommand, customerId: 'c-2' });
      await createShipment(h, customerActor);

      expect(await h.service.list(dispatcher, 't-1')).toHaveLength(2);
      expect(await h.service.list(customerActor, 't-1')).toHaveLength(1);
      // Nothing is dispatched yet, so the driver's list is empty.
      expect(await h.service.list(driverActor, 't-1')).toEqual([]);
    });

    it('honors status and customer filters for staff', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h);
      await h.service.confirm(dispatcher, 't-1', shipment.id, 1);

      const confirmed = await h.service.list(dispatcher, 't-1', {
        status: 'CONFIRMED',
      });
      expect(confirmed).toHaveLength(1);
      const created = await h.service.list(dispatcher, 't-1', {
        status: 'CREATED',
      });
      expect(created).toHaveLength(0);
    });

    it('hides other customers and other tenants behind 404', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h); // customer c-1, actor u-3 owns it

      await expect(
        h.service.get(customerActor, 't-1', shipment.id),
      ).resolves.toBeDefined();

      // A second customer (no portal user) tries to read it.
      const stranger: ShipmentActor = { userId: 'u-9', role: 'customer' };
      await expect(
        h.service.get(stranger, 't-1', shipment.id),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_NOT_FOUND' } });

      // RLS would hide it; the explicit check agrees.
      await expect(
        h.service.get(dispatcher, 't-OTHER', shipment.id),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_NOT_FOUND' } });
    });

    it('denies drivers actions on shipments that are not theirs', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h); // still unassigned
      await expect(
        h.service.pickup(driverActor, 't-1', shipment.id, 1),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'SHIPMENT_NOT_ASSIGNED' },
      });
    });

    it('lets drivers read, list, and act on their assigned shipments (Step 8)', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h);
      await h.service.confirm(dispatcher, 't-1', shipment.id, 1);
      await h.service.assign(dispatcher, 't-1', shipment.id, 2, 'd-1', null);

      // The shipment row records who is driving; that is the whole policy.
      expect(shipment.driverId).toBe('d-1');
      await expect(
        h.service.get(driverActor, 't-1', shipment.id),
      ).resolves.toBeDefined();
      expect(await h.service.list(driverActor, 't-1')).toHaveLength(1);
      const pickedUp = await h.service.pickup(driverActor, 't-1', shipment.id, 3);
      expect(pickedUp.status).toBe('PICKED_UP');

      // Another driver with a profile stays out; a user without one simply
      // sees nothing (reads 404, actions 403).
      const otherDriver: ShipmentActor = { userId: 'u-5', role: 'driver' };
      await expect(
        h.service.get(otherDriver, 't-1', shipment.id),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_NOT_FOUND' } });
      await expect(
        h.service.pickup(otherDriver, 't-1', shipment.id, 3),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'SHIPMENT_NOT_ASSIGNED' },
      });
      const noProfile: ShipmentActor = { userId: 'u-6', role: 'driver' };
      await expect(
        h.service.get(noProfile, 't-1', shipment.id),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_NOT_FOUND' } });
    });
  });

  describe('transitions', () => {
    it('confirms, records history with the actor, and bumps the version', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h);

      const confirmed = await h.service.confirm(
        admin,
        't-1',
        shipment.id,
        1,
      );
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.version).toBe(2);
      expect(h.history.at(-1)).toMatchObject({
        fromStatus: 'CREATED',
        toStatus: 'CONFIRMED',
        actorId: 'u-2',
      });

      // Each raised event left as an envelope, stamped with the version it
      // was raised at (1 for creation, 2 after the transition). The generic
      // status event is queued before the specific one.
      expect(h.bus.types()).toEqual([
        'ShipmentCreated',
        'ShipmentStatusChanged',
        'ShipmentConfirmed',
      ]);
      expect(h.bus.published.map((event) => event.aggregateVersion)).toEqual([
        1, 2, 2,
      ]);
      expect(h.bus.lastOfType('ShipmentStatusChanged')?.payload).toMatchObject({
        fromStatus: 'CREATED',
        toStatus: 'CONFIRMED',
        customerId: 'c-1',
        trackingNumber: shipment.trackingNumber,
      });
    });

    it('rejects a stale If-Match with 412', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h);
      await h.service.confirm(dispatcher, 't-1', shipment.id, 1);

      await expect(
        h.service.confirm(dispatcher, 't-1', shipment.id, 1),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
      await expect(
        h.service.cancel(dispatcher, 't-1', shipment.id, 1, 'changed my mind'),
      ).rejects.toMatchObject({ response: { code: 'VERSION_MISMATCH' } });
    });

    it('maps invalid transitions to 409 SHIPMENT_INVALID_TRANSITION', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h);
      await expect(
        h.service.deliver(dispatcher, 't-1', shipment.id, 1),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'SHIPMENT_INVALID_TRANSITION' },
      });
    });

    it('requires a reason on a failed attempt (422)', async () => {
      const h = makeHarness();
      const shipment = await toOutForDelivery(h);
      await expect(
        h.service.fail(dispatcher, 't-1', shipment.id, 6, '   '),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'SHIPMENT_REASON_REQUIRED' },
      });
    });

    it('walks the failure path: fail, retry, then forced return', async () => {
      const h = makeHarness();
      const shipment = await toOutForDelivery(h);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        // toOutForDelivery leaves the shipment at version 6; each
        // fail + retry pair adds two.
        const version = 6 + (attempt - 1) * 2;
        const failed = await h.service.fail(
          dispatcher,
          't-1',
          shipment.id,
          version,
          `miss ${attempt}`,
        );
        expect(failed.status).toBe('FAILED_ATTEMPT');
        if (attempt < 3) {
          const retried = await h.service.retry(
            dispatcher,
            't-1',
            shipment.id,
            version + 1,
          );
          expect(retried.status).toBe('OUT_FOR_DELIVERY');
        }
      }
      expect(shipment.failedAttempts).toBe(3);

      await expect(
        h.service.retry(dispatcher, 't-1', shipment.id, 11),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'SHIPMENT_RETRY_EXHAUSTED' },
      });

      const returned = await h.service.returnShipment(
        admin,
        't-1',
        shipment.id,
        11,
        'attempt limit reached',
      );
      expect(returned.status).toBe('RETURNED');
      expect(h.history.at(-1)).toMatchObject({
        toStatus: 'RETURNED',
        reason: 'attempt limit reached',
      });
    });

    it('demands proof of delivery when the tenant setting says so', async () => {
      const h = makeHarness();
      const shipment = await toOutForDelivery(h);
      h.settings = { requireProofOfDelivery: true };

      await expect(
        h.service.deliver(dispatcher, 't-1', shipment.id, 6),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'PROOF_REQUIRED' },
      });
    });

    it('lets a proof-demanding tenant deliver once a proof row exists', async () => {
      const h = makeHarness();
      const shipment = await toOutForDelivery(h);
      h.settings = { requireProofOfDelivery: true };
      h.hasProof = true;

      const delivered = await h.service.deliver(dispatcher, 't-1', shipment.id, 6);
      expect(delivered.status).toBe('DELIVERED');
    });

    it('delivers normally when proof is not demanded', async () => {
      const h = makeHarness();
      const shipment = await toOutForDelivery(h);
      const delivered = await h.service.deliver(dispatcher, 't-1', shipment.id, 6);
      expect(delivered.status).toBe('DELIVERED');
    });

    it('validates assignment identities inside the tenant', async () => {
      const h = makeHarness();
      const shipment = await createShipment(h);
      await h.service.confirm(dispatcher, 't-1', shipment.id, 1);

      await expect(
        h.service.assign(dispatcher, 't-1', shipment.id, 2, 'ghost', null),
      ).rejects.toMatchObject({ response: { code: 'DRIVER_NOT_FOUND' } });
      await expect(
        h.service.assign(dispatcher, 't-1', shipment.id, 2, 'd-1', 'ghost-v'),
      ).rejects.toMatchObject({ response: { code: 'VEHICLE_NOT_FOUND' } });

      const assigned = await h.service.assign(
        dispatcher,
        't-1',
        shipment.id,
        2,
        'd-1',
        'v-1',
      );
      expect(assigned.status).toBe('ASSIGNED');
    });

    it('appends one history row per transition, in order', async () => {
      const h = makeHarness();
      await toOutForDelivery(h);
      expect(h.history.map((row) => row.toStatus)).toEqual([
        'CREATED',
        'CONFIRMED',
        'ASSIGNED',
        'PICKED_UP',
        'IN_TRANSIT',
        'OUT_FOR_DELIVERY',
      ]);
    });
  });
});
