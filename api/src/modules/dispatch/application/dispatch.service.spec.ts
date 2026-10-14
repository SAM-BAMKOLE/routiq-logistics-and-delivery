import { ConflictException, NotFoundException } from '@nestjs/common';
import { FakeEventBus } from '../../../shared/messaging/testing/fake-event-bus.js';
import type { Shipment } from '../../shipments/domain/shipment.js';
import type { ShipmentsService } from '../../shipments/application/shipments.service.js';
import type { DriversService } from '../../drivers/application/drivers.service.js';
import type { VehiclesService } from '../../fleet/application/vehicles.service.js';
import type { TenantsService } from '../../tenants/application/tenants.service.js';
import { Assignment } from '../domain/assignment.js';
import type {
  AssignmentRepository,
  DispatchCandidate,
} from '../domain/assignment.repository.js';
import { DispatchService } from './dispatch.service.js';

const dispatcher = { userId: 'u-ops', role: 'dispatcher' as const };
const driverActor = { userId: 'u-driver', role: 'driver' as const };

interface Harness {
  service: DispatchService;
  store: Map<string, Assignment>;
  shipments: Map<string, Shipment>;
  drivers: Map<string, Record<string, unknown>>;
  vehicles: Map<string, Record<string, unknown>>;
  userToDriver: Map<string, string>;
  pool: DispatchCandidate[];
  settings: Record<string, unknown>;
  applied: Array<{
    tenantId: string;
    shipmentId: string;
    driverId: string;
    vehicleId: string | null;
    actorUserId: string;
  }>;
  released: Array<{ tenantId: string; shipmentId: string; reason: string | null }>;
  bus: FakeEventBus;
}

function makeHarness(): Harness {
  const harness: Harness = {
    service: undefined as unknown as DispatchService,
    store: new Map(),
    shipments: new Map(),
    drivers: new Map(),
    vehicles: new Map(),
    userToDriver: new Map(),
    pool: [],
    settings: {},
    applied: [],
    released: [],
    bus: new FakeEventBus(),
  };

  harness.shipments.set('s-1', {
    id: 's-1',
    tenantId: 't-1',
    status: 'CONFIRMED',
    pickupAddressId: 'a-1',
    weightKg: 100,
    volumeM3: 2,
  } as unknown as Shipment);
  harness.shipments.set('s-assigned', {
    id: 's-assigned',
    tenantId: 't-1',
    status: 'ASSIGNED',
    pickupAddressId: 'a-1',
    weightKg: 100,
    volumeM3: 2,
  } as unknown as Shipment);

  harness.drivers.set('d-1', {
    id: 'd-1',
    status: 'active',
    availability: 'available',
    currentVehicleId: 'v-own',
  });
  harness.drivers.set('d-suspended', {
    id: 'd-suspended',
    status: 'suspended',
    availability: 'available',
    currentVehicleId: null,
  });
  harness.userToDriver.set('u-driver', 'd-1');
  harness.vehicles.set('v-own', {
    id: 'v-own',
    status: 'active',
    capacityWeightKg: 500,
    capacityVolumeM3: 10,
  });
  harness.vehicles.set('v-tiny', {
    id: 'v-tiny',
    status: 'active',
    capacityWeightKg: 50,
    capacityVolumeM3: 1,
  });

  function uniqueViolation(constraint: string): never {
    throw { driverError: { code: '23505', constraint } };
  }

  const assignmentRepository: AssignmentRepository = {
    insert: async (assignment) => {
      // The partial unique indexes, in memory: one live per shipment,
      // driver, and vehicle.
      for (const existing of harness.store.values()) {
        if (!existing.isLive) {
          continue;
        }
        if (existing.shipmentId === assignment.shipmentId) {
          uniqueViolation('uq_dispatch_assignments_active_shipment');
        }
        if (existing.driverId === assignment.driverId) {
          uniqueViolation('uq_dispatch_assignments_active_driver');
        }
        if (assignment.vehicleId && existing.vehicleId === assignment.vehicleId) {
          uniqueViolation('uq_dispatch_assignments_active_vehicle');
        }
      }
      harness.store.set(assignment.id, assignment);
    },
    save: async (assignment) => {
      harness.store.set(assignment.id, assignment);
    },
    findById: async (id) => harness.store.get(id) ?? null,
    findLiveByShipment: async (shipmentId) =>
      [...harness.store.values()].filter(
        (assignment) => assignment.shipmentId === shipmentId && assignment.isLive,
      ),
    listByDriver: async (driverId) =>
      [...harness.store.values()].filter(
        (assignment) => assignment.driverId === driverId,
      ),
    findOverdue: async (_tenantId, now) =>
      [...harness.store.values()].filter((assignment) => assignment.isOverdue(now)),
    searchCandidates: async () => harness.pool,
  };

  const shipmentsService = {
    get: async (
      _actor: unknown,
      tenantId: string,
      id: string,
    ): Promise<Shipment> => {
      const shipment = harness.shipments.get(id);
      if (!shipment || shipment.tenantId !== tenantId) {
        throw new NotFoundException({
          message: `Shipment ${id} was not found in this tenant.`,
          code: 'SHIPMENT_NOT_FOUND',
        });
      }
      return shipment;
    },
    applyAssignment: async (
      tenantId: string,
      id: string,
      driverId: string,
      vehicleId: string | null,
      actorUserId: string,
    ): Promise<Shipment> => {
      const shipment = harness.shipments.get(id);
      if (!shipment || shipment.tenantId !== tenantId) {
        throw new NotFoundException({
          message: `Shipment ${id} was not found in this tenant.`,
          code: 'SHIPMENT_NOT_FOUND',
        });
      }
      if (shipment.status !== 'CONFIRMED') {
        throw new ConflictException({
          message: `A shipment in status ${shipment.status} cannot move to ASSIGNED.`,
          code: 'SHIPMENT_INVALID_TRANSITION',
        });
      }
      harness.applied.push({ tenantId, shipmentId: id, driverId, vehicleId, actorUserId });
      (shipment as { status: string }).status = 'ASSIGNED';
      (shipment as { driverId: string | null }).driverId = driverId;
      (shipment as { vehicleId: string | null }).vehicleId = vehicleId;
      return shipment;
    },
    releaseAssignment: async (
      tenantId: string,
      id: string,
      reason: string | null,
    ): Promise<Shipment> => {
      const shipment = harness.shipments.get(id);
      if (!shipment || shipment.tenantId !== tenantId) {
        throw new NotFoundException({
          message: `Shipment ${id} was not found in this tenant.`,
          code: 'SHIPMENT_NOT_FOUND',
        });
      }
      harness.released.push({ tenantId, shipmentId: id, reason });
      (shipment as { status: string }).status = 'CONFIRMED';
      (shipment as { driverId: string | null }).driverId = null;
      (shipment as { vehicleId: string | null }).vehicleId = null;
      return shipment;
    },
  } as unknown as ShipmentsService;

  const driversService = {
    getDriver: async (_tenantId: string, id: string) => {
      const driver = harness.drivers.get(id);
      if (!driver) {
        throw new NotFoundException({
          message: `Driver ${id} was not found in this tenant.`,
          code: 'DRIVER_NOT_FOUND',
        });
      }
      return driver;
    },
    getOwnDriver: async (_tenantId: string, userId: string) => {
      const driverId = harness.userToDriver.get(userId);
      const driver = driverId ? harness.drivers.get(driverId) : undefined;
      if (!driver) {
        throw new NotFoundException({
          message: 'This user has no driver profile in this tenant.',
          code: 'DRIVER_PROFILE_NOT_FOUND',
        });
      }
      return driver;
    },
  } as unknown as DriversService;

  const vehiclesService = {
    getById: async (_tenantId: string, id: string) => {
      const vehicle = harness.vehicles.get(id);
      if (!vehicle) {
        throw new NotFoundException({
          message: `Vehicle ${id} was not found in this tenant.`,
          code: 'VEHICLE_NOT_FOUND',
        });
      }
      return vehicle;
    },
  } as unknown as VehiclesService;

  const tenantsService = {
    getById: async () => ({ settings: harness.settings }),
  } as unknown as TenantsService;

  harness.service = new DispatchService(
    assignmentRepository,
    shipmentsService,
    driversService,
    vehiclesService,
    tenantsService,
    harness.bus,
  );
  return harness;
}

/** Opens an offer through the service, then re-keys the stored row so specs
 * can address it by a readable id and seed it as already lapsed. */
async function offer(
  h: Harness,
  overrides: { id?: string; expiresAt?: Date; vehicleId?: string | null } = {},
): Promise<Assignment> {
  const created = await h.service.create(dispatcher, 't-1', 's-1', {
    driverId: 'd-1',
    vehicleId: overrides.vehicleId ?? undefined,
    ttlMinutes: 15,
  });
  h.store.delete(created.id);
  const stored = Assignment.rehydrate({
    id: overrides.id ?? created.id,
    tenantId: created.tenantId,
    shipmentId: created.shipmentId,
    driverId: created.driverId,
    vehicleId: created.vehicleId,
    status: created.status,
    offeredAt: created.offeredAt,
    expiresAt: overrides.expiresAt ?? created.expiresAt,
    respondedAt: created.respondedAt,
    reason: created.reason,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  });
  h.store.set(stored.id, stored);
  return stored;
}

describe('DispatchService', () => {
  describe('candidates', () => {
    it('refuses anything but a confirmed shipment with a 409', async () => {
      const h = makeHarness();
      await expect(
        h.service.candidates(dispatcher, 't-1', 's-assigned'),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'DISPATCH_SHIPMENT_NOT_DISPATCHABLE' },
      });
    });

    it('keeps the located pool inside the first radius step, unlocated after it', async () => {
      const h = makeHarness();
      h.pool = [
        {
          driverId: 'near',
          membershipId: 'm-near',
          vehicleId: 'v-own',
          distanceMeters: 2_000,
          activeAssignments: 0,
          capacitySlack: 0.4,
        },
        {
          driverId: 'far',
          membershipId: 'm-far',
          vehicleId: 'v-own',
          distanceMeters: 12_000,
          activeAssignments: 0,
          capacitySlack: 0.4,
        },
        {
          driverId: 'unlocated',
          membershipId: 'm-none',
          vehicleId: null,
          distanceMeters: null,
          activeAssignments: 2,
          capacitySlack: null,
        },
      ];

      const ranked = await h.service.candidates(dispatcher, 't-1', 's-1');
      expect(ranked.map((c) => c.driverId)).toEqual(['near', 'unlocated']);
      expect(ranked[0].withinRadius).toBe(true);
      expect(ranked[1].withinRadius).toBe(false);
      expect(ranked[1].distanceMeters).toBeNull();
    });

    it('sweeps overdue offers before ranking, publishing the expiries', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-stale', expiresAt: new Date(Date.now() - 1_000) });

      await h.service.candidates(dispatcher, 't-1', 's-1');

      expect(h.store.get('as-stale')?.status).toBe('expired');
      expect(h.bus.types()).toContain('AssignmentExpired');
    });

    it('caps the list at the tenant maxCandidates setting', async () => {
      const h = makeHarness();
      h.settings = { dispatch: { maxCandidates: 1 } };
      h.pool = [
        {
          driverId: 'a',
          membershipId: 'm-a',
          vehicleId: null,
          distanceMeters: null,
          activeAssignments: 0,
          capacitySlack: null,
        },
        {
          driverId: 'b',
          membershipId: 'm-b',
          vehicleId: null,
          distanceMeters: null,
          activeAssignments: 0,
          capacitySlack: null,
        },
      ];
      const ranked = await h.service.candidates(dispatcher, 't-1', 's-1');
      expect(ranked).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('opens an offer with the tenant TTL and the driver’s own vehicle', async () => {
      const h = makeHarness();
      const assignment = await h.service.create(dispatcher, 't-1', 's-1', {
        driverId: 'd-1',
      });

      expect(assignment.status).toBe('offered');
      expect(assignment.vehicleId).toBe('v-own');
      expect(assignment.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(assignment.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 16 * 60_000);
      // Opening an offer raises AssignmentOffered for WS broadcast.
      expect(h.bus.types()).toEqual(['AssignmentOffered']);
    });

    it('honors a TTL override (0 expires immediately)', async () => {
      const h = makeHarness();
      const assignment = await h.service.create(dispatcher, 't-1', 's-1', {
        driverId: 'd-1',
        ttlMinutes: 0,
      });
      expect(assignment.isOverdue(new Date())).toBe(true);
    });

    it('rejects an unavailable driver', async () => {
      const h = makeHarness();
      await expect(
        h.service.create(dispatcher, 't-1', 's-1', { driverId: 'd-suspended' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'DISPATCH_DRIVER_UNAVAILABLE' },
      });
    });

    it('rejects a vehicle too small for the shipment with a 422', async () => {
      const h = makeHarness();
      await expect(
        h.service.create(dispatcher, 't-1', 's-1', {
          driverId: 'd-1',
          vehicleId: 'v-tiny',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'DISPATCH_VEHICLE_TOO_SMALL' },
      });
    });

    it('turns the partial unique indexes into named 409s', async () => {
      const h = makeHarness();
      await h.service.create(dispatcher, 't-1', 's-1', { driverId: 'd-1' });

      // Same shipment: the offer above still holds it.
      h.drivers.set('d-2', {
        id: 'd-2',
        status: 'active',
        availability: 'available',
        currentVehicleId: null,
      });
      await expect(
        h.service.create(dispatcher, 't-1', 's-1', { driverId: 'd-2' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ASSIGNMENT_ALREADY_OFFERED' },
      });
    });
  });

  describe('accept', () => {
    it('assigns the shipment and publishes DriverAssigned', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1', vehicleId: 'v-own' });

      const accepted = await h.service.accept('t-1', 'u-driver', 'as-1');

      expect(accepted.status).toBe('accepted');
      expect(h.applied).toEqual([
        {
          tenantId: 't-1',
          shipmentId: 's-1',
          driverId: 'd-1',
          vehicleId: 'v-own',
          actorUserId: 'u-driver',
        },
      ]);
      expect(h.shipments.get('s-1')?.status).toBe('ASSIGNED');
      expect(h.shipments.get('s-1')?.driverId).toBe('d-1');
      expect(h.bus.types()).toEqual(['AssignmentOffered', 'DriverAssigned']);
    });

    it('hides foreign assignments and unknown profiles behind 404s', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1' });
      await expect(
        h.service.accept('t-1', 'u-stranger', 'as-1'),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'DRIVER_PROFILE_NOT_FOUND' },
      });

      h.userToDriver.set('u-other', 'd-2');
      h.drivers.set('d-2', { id: 'd-2', status: 'active', availability: 'available' });
      await expect(
        h.service.accept('t-1', 'u-other', 'as-1'),
      ).rejects.toMatchObject({ status: 404, response: { code: 'ASSIGNMENT_NOT_FOUND' } });
    });

    it('expires a lapsed offer on the spot, with a 409', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-late', expiresAt: new Date(Date.now() - 1_000) });

      await expect(
        h.service.accept('t-1', 'u-driver', 'as-late'),
      ).rejects.toMatchObject({ status: 409, response: { code: 'ASSIGNMENT_EXPIRED' } });

      expect(h.store.get('as-late')?.status).toBe('expired');
      expect(h.bus.types()).toEqual(['AssignmentOffered', 'AssignmentExpired']);
      expect(h.applied).toEqual([]);
    });

    it('refuses an assignment that is not an open offer', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1' });
      await h.service.accept('t-1', 'u-driver', 'as-1');
      h.bus.clear();

      await expect(
        h.service.accept('t-1', 'u-driver', 'as-1'),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ASSIGNMENT_NOT_OFFERED' },
      });
    });

    it('folds the offer away when the shipment moved under it', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1' });
      // A dispatcher assigned the shipment directly while the offer sat.
      (h.shipments.get('s-1') as { status: string }).status = 'ASSIGNED';

      await expect(
        h.service.accept('t-1', 'u-driver', 'as-1'),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'SHIPMENT_INVALID_TRANSITION' },
      });

      expect(h.store.get('as-1')?.status).toBe('cancelled');
      expect(h.bus.types()).toContain('AssignmentOffered');
      expect(h.bus.types()).toContain('AssignmentCancelled');
    });
  });

  describe('completeTerminalShipment', () => {
    it('completes an accepted assignment and frees the driver', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1', vehicleId: 'v-own' });
      await h.service.accept('t-1', 'u-driver', 'as-1');
      h.bus.clear();

      await h.service.completeTerminalShipment('t-1', 's-1');

      expect(h.store.get('as-1')?.status).toBe('completed');
      expect(h.bus.types()).toEqual(['AssignmentCompleted']);
      // Completing never moves the shipment; the caller already did.
      expect(h.released).toEqual([]);

      // The driver is free for the next job on a different shipment.
      h.shipments.set('s-2', {
        id: 's-2',
        tenantId: 't-1',
        status: 'CONFIRMED',
        pickupAddressId: 'a-1',
        weightKg: 100,
        volumeM3: 2,
      } as unknown as Shipment);
      const next = await h.service.create(dispatcher, 't-1', 's-2', {
        driverId: 'd-1',
      });
      expect(next.status).toBe('offered');
    });

    it('withdraws an offer that was still pending', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1' });
      h.bus.clear();

      await h.service.completeTerminalShipment('t-1', 's-1');

      expect(h.store.get('as-1')?.status).toBe('cancelled');
      expect(h.bus.types()).toEqual(['AssignmentCancelled']);
    });

    it('is a no-op when nothing is live', async () => {
      const h = makeHarness();
      await h.service.completeTerminalShipment('t-1', 's-1');
      expect(h.bus.types()).toEqual([]);
    });
  });

  describe('reject', () => {
    it('records the rejection with a reason, leaving the shipment alone', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1' });

      const rejected = await h.service.reject('t-1', 'u-driver', 'as-1', 'on leave');

      expect(rejected.status).toBe('rejected');
      expect(rejected.reason).toBe('on leave');
      expect(h.shipments.get('s-1')?.status).toBe('CONFIRMED');
      expect(h.bus.types()).toEqual(['AssignmentOffered', 'AssignmentRejected']);

      // The driver and shipment are free again.
      const next = await h.service.create(dispatcher, 't-1', 's-1', {
        driverId: 'd-1',
      });
      expect(next.status).toBe('offered');
    });
  });

  describe('cancel', () => {
    it('withdraws a pending offer without touching the shipment', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1' });

      const cancelled = await h.service.cancel(dispatcher, 't-1', 'as-1', 'better fit');

      expect(cancelled.status).toBe('cancelled');
      expect(h.released).toEqual([]);
      expect(h.bus.types()).toEqual(['AssignmentOffered', 'AssignmentCancelled']);
    });

    it('releases an accepted assignment back to CONFIRMED', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1', vehicleId: 'v-own' });
      await h.service.accept('t-1', 'u-driver', 'as-1');
      h.bus.clear();

      const cancelled = await h.service.cancel(dispatcher, 't-1', 'as-1', 'no truck');

      expect(cancelled.status).toBe('cancelled');
      expect(h.released).toEqual([
        { tenantId: 't-1', shipmentId: 's-1', reason: 'no truck' },
      ]);
      expect(h.shipments.get('s-1')?.status).toBe('CONFIRMED');
      expect(h.shipments.get('s-1')?.driverId).toBeNull();
      expect(h.bus.types()).toEqual(['AssignmentCancelled']);
    });

    it('lets the driver withdraw their own, but nobody else’s', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1' });

      const cancelled = await h.service.cancel(driverActor, 't-1', 'as-1', null);
      expect(cancelled.status).toBe('cancelled');

      // An offer addressed to another driver stays out of reach (404, no
      // existence leak).
      h.userToDriver.set('u-other', 'd-2');
      h.drivers.set('d-2', { id: 'd-2', status: 'active', availability: 'available' });
      h.store.set(
        'as-2',
        Assignment.rehydrate({
          id: 'as-2',
          tenantId: 't-1',
          shipmentId: 's-1',
          driverId: 'd-2',
          vehicleId: null,
          status: 'offered',
          offeredAt: new Date(),
          expiresAt: new Date(Date.now() + 15 * 60_000),
          respondedAt: null,
          reason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
      await expect(
        h.service.cancel(driverActor, 't-1', 'as-2', null),
      ).rejects.toMatchObject({ status: 404, response: { code: 'ASSIGNMENT_NOT_FOUND' } });
    });

    it('refuses to cancel a terminal assignment', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-1' });
      await h.service.reject('t-1', 'u-driver', 'as-1', null);

      await expect(
        h.service.cancel(dispatcher, 't-1', 'as-1', null),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ASSIGNMENT_NOT_LIVE' },
      });
    });
  });

  describe('listMine', () => {
    it('lists the driver’s own assignments after sweeping their overdue offers', async () => {
      const h = makeHarness();
      await offer(h, { id: 'as-late', expiresAt: new Date(Date.now() - 1_000) });

      const mine = await h.service.listMine('t-1', 'u-driver');

      expect(mine.map((assignment) => assignment.id)).toEqual(['as-late']);
      expect(mine[0].status).toBe('expired');
      expect(h.bus.types()).toEqual(['AssignmentOffered', 'AssignmentExpired']);
    });

    it('404s a user without a driver profile', async () => {
      const h = makeHarness();
      await expect(h.service.listMine('t-1', 'u-nobody')).rejects.toMatchObject({
        status: 404,
        response: { code: 'DRIVER_PROFILE_NOT_FOUND' },
      });
    });
  });
});
