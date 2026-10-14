import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { DispatchService } from '../../src/modules/dispatch/application/dispatch.service.js';
import { DispatchModule } from '../../src/modules/dispatch/dispatch.module.js';
import { DriversModule } from '../../src/modules/drivers/drivers.module.js';
import { FleetModule } from '../../src/modules/fleet/fleet.module.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { ShipmentsModule } from '../../src/modules/shipments/shipments.module.js';
import { ShipmentsService } from '../../src/modules/shipments/application/shipments.service.js';
import { TenantsModule } from '../../src/modules/tenants/tenants.module.js';
import { MessagingModule } from '../../src/shared/messaging/messaging.module.js';
import { TenantTransactionService } from '../../src/shared/tenancy/tenant-transaction.service.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import { createAppDataSource, createOwnerDataSource, ensureSchema } from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

/**
 * Dispatch against a real PostGIS database: the candidate search (radius,
 * eligibility filters, distance ordering), the offer lifecycle through to
 * the shipment moving to ASSIGNED with driver-scoped reads behind it, the
 * lazy offer expiry, and the partial unique indexes that stop two dispatch
 * runs from double-booking a shipment, a driver, or a vehicle.
 */
describe('Dispatch (integration)', () => {
  let app: INestApplication;
  let transactions: TenantTransactionService;
  let dispatch: DispatchService;
  let shipments: ShipmentsService;
  let owner: DataSource;
  let appDb: DataSource;

  let tenantA: string;
  let tenantB: string;
  let pickupAddressId: string;
  let customerId: string;

  let dispatcher: { userId: string; role: 'dispatcher' };
  let driverNearUserId: string;
  let driverFarUserId: string;

  let driverNearId: string;
  let driverFarId: string;
  let driverShiftId: string;
  let driverSuspendedId: string;
  let driverBusyId: string;
  let vanId: string; // driverNear's own van
  let spareVanId: string; // free, slightly larger
  let smallVanId: string; // driverBusy's own van
  let mainShipmentId: string; // the one every scenario starts from

  /** Inserts a fresh CONFIRMED shipment and returns its id. */
  async function insertConfirmedShipment(): Promise<string> {
    const rows = (await owner.query(
      `INSERT INTO shipments
         (tenant_id, tracking_number, customer_id, pickup_address_id,
          dropoff_address_id, status, weight_kg, volume_m3, price_minor, currency)
       VALUES ($1, $2, $3, $4, $4, 'CONFIRMED', 100, 2, 50000, 'NGN')
       RETURNING id`,
      [tenantA, `SHP-${randomUUID().slice(0, 8)}`, customerId, pickupAddressId],
    )) as Array<{ id: string }>;
    return rows[0].id;
  }

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();
    appDb = await createAppDataSource();
    const tag = randomUUID().slice(0, 8);

    const tenants = (await owner.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
      [`Dispatch A`, `dispatch-a-${tag}`, `Dispatch B`, `dispatch-b-${tag}`],
    )) as Array<{ id: string }>;
    [tenantA, tenantB] = tenants.map((row) => row.id);

    const users = (await owner.query(
      `INSERT INTO users (email) VALUES ($1), ($2), ($3), ($4), ($5), ($6) RETURNING id`,
      [
        `disp-${tag}@example.com`,
        `near-${tag}@example.com`,
        `far-${tag}@example.com`,
        `shift-${tag}@example.com`,
        `susp-${tag}@example.com`,
        `busy-${tag}@example.com`,
      ],
    )) as Array<{ id: string }>;
    const [dispatcherUser, nearUser, farUser, shiftUser, suspUser, busyUser] =
      users.map((row) => row.id);
    driverNearUserId = nearUser;
    driverFarUserId = farUser;
    dispatcher = { userId: dispatcherUser, role: 'dispatcher' };

    const memberships = (await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'dispatcher'), ($1, $3, 'driver'), ($1, $4, 'driver'),
              ($1, $5, 'driver'), ($1, $6, 'driver'), ($1, $7, 'driver')
       RETURNING id`,
      [tenantA, dispatcherUser, nearUser, farUser, shiftUser, suspUser, busyUser],
    )) as Array<{ id: string }>;

    const vehicles = (await owner.query(
      `INSERT INTO vehicles (tenant_id, plate, type, capacity_weight_kg, capacity_volume_m3)
       VALUES ($1, $2, 'van', 500, 10), ($1, $3, 'van', 600, 12), ($1, $4, 'van', 700, 14)
       RETURNING id`,
      [tenantA, `VAN-${tag}`, `SPARE-${tag}`, `BUSY-${tag}`],
    )) as Array<{ id: string }>;
    [vanId, spareVanId, smallVanId] = vehicles.map((row) => row.id);

    const drivers = (await owner.query(
      `INSERT INTO drivers (tenant_id, membership_id, license_no, status, current_vehicle_id)
       VALUES ($1, $2, $3, 'active', $7), ($1, $4, $8, 'active', NULL),
              ($1, $5, $9, 'active', NULL), ($1, $6, $10, 'suspended', NULL),
              ($1, $11, $12, 'active', $13)
       RETURNING id`,
      [
        tenantA,
        memberships[1].id,
        `DL-N-${tag}`,
        memberships[2].id,
        memberships[3].id,
        memberships[4].id,
        vanId,
        `DL-F-${tag}`,
        `DL-S-${tag}`,
        `DL-X-${tag}`,
        memberships[5].id,
        `DL-B-${tag}`,
        smallVanId,
      ],
    )) as Array<{ id: string }>;
    [driverNearId, driverFarId, driverShiftId, driverSuspendedId, driverBusyId] =
      drivers.map((row) => row.id);

    const customer = (await owner.query(
      `INSERT INTO customers (tenant_id, name) VALUES ($1, 'Acme') RETURNING id`,
      [tenantA],
    )) as Array<{ id: string }>;
    customerId = customer[0].id;
    const address = (await owner.query(
      `INSERT INTO addresses (tenant_id, customer_id, line1, city, country, location)
       VALUES ($1, $2, '14 Warehouse Road', 'Lagos', 'NG',
               ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography)
       RETURNING id`,
      [tenantA, customerId],
    )) as Array<{ id: string }>;
    pickupAddressId = address[0].id;
    mainShipmentId = await insertConfirmedShipment();

    // Positions: near is ~1 km from the pickup, far is ~50 km away. The
    // off-shift, suspended, and busy drivers have none.
    await owner.query(
      `INSERT INTO driver_locations (tenant_id, driver_id, recorded_at, location)
       VALUES ($1, $2, now(), ST_SetSRID(ST_MakePoint(3.3792, 6.5334), 4326)::geography),
              ($1, $3, now(), ST_SetSRID(ST_MakePoint(3.3792, 6.9744), 4326)::geography)`,
      [tenantA, driverNearId, driverFarId],
    );
    // A shift that ended an hour ago: with no current shift, the driver
    // drops out of the pool.
    await owner.query(
      `INSERT INTO driver_shifts (tenant_id, driver_id, starts_at, ends_at)
       VALUES ($1, $2, now() - interval '3 hours', now() - interval '1 hour')`,
      [tenantA, driverShiftId],
    );

    process.env.DATABASE_URL = readDatabaseState().appUrl;
    process.env.JWT_ACCESS_SECRET = 'integration-test-access-secret-min-32-chars';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        DatabaseModule,
        TenancyModule,
        MessagingModule,
        IdentityModule,
        TenantsModule,
        FleetModule,
        DriversModule,
        ShipmentsModule,
        DispatchModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    transactions = app.get(TenantTransactionService);
    dispatch = app.get(DispatchService);
    shipments = app.get(ShipmentsService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (owner?.isInitialized) {
      await owner.destroy();
    }
    if (appDb?.isInitialized) {
      await appDb.destroy();
    }
  });

  /** Runs an offer through the service inside the tenant transaction. */
  function offer(
    shipmentId: string,
    driverId: string,
    options: { ttlMinutes?: number; vehicleId?: string } = {},
  ) {
    return transactions.runWithTenant(tenantA, () =>
      dispatch.create(dispatcher, tenantA, shipmentId, {
        driverId,
        ttlMinutes: options.ttlMinutes ?? 15,
        vehicleId: options.vehicleId,
      }),
    );
  }

  describe('candidate search', () => {
    it('ranks eligible drivers by distance, excluding the ineligible', async () => {
      const ranked = await transactions.runWithTenant(tenantA, () =>
        dispatch.candidates(dispatcher, tenantA, mainShipmentId),
      );

      // The near driver wins the located pool (~1 km, own van); the far
      // driver is located but beyond every radius step, so suggestions
      // never stretch that far (the dispatcher can still name them by hand).
      expect(ranked[0]).toMatchObject({
        driverId: driverNearId,
        withinRadius: true,
        vehicleId: vanId,
      });
      expect(ranked[0].distanceMeters).toBeGreaterThan(0);
      expect(ranked[0].distanceMeters).toBeLessThan(2_000);

      const ids = ranked.map((candidate) => candidate.driverId);
      expect(ids).not.toContain(driverFarId);
      // The suspended driver and the driver whose shift is over never
      // appear; a driver without a position is still dispatchable (the
      // tracking module starts filling driver_locations in Step 10).
      expect(ids).not.toContain(driverSuspendedId);
      expect(ids).not.toContain(driverShiftId);
      expect(ids).toContain(driverBusyId);
    });

    it('never suggests a vehicle that a live assignment already holds', async () => {
      // driverBusy holds driverNear's own van: driverNear is free but their
      // own vehicle is not, so the candidate row must fall through to a free
      // vehicle instead of echoing the held one back.
      const holder = await offer(mainShipmentId, driverBusyId, { vehicleId: vanId });

      const probe = await insertConfirmedShipment();
      const ranked = await transactions.runWithTenant(tenantA, () =>
        dispatch.candidates(dispatcher, tenantA, probe),
      );
      const near = ranked.find((candidate) => candidate.driverId === driverNearId);
      expect(near).toBeDefined();
      expect(near?.vehicleId).not.toBe(vanId);
      expect(near?.vehicleId).toBe(spareVanId);

      await transactions.runWithTenant(tenantA, () =>
        dispatch.cancel(dispatcher, tenantA, holder.id, null),
      );
    });

    it('hides other tenants’ shipments behind 404', async () => {
      await expect(
        transactions.runWithTenant(tenantB, () =>
          dispatch.candidates(dispatcher, tenantB, mainShipmentId),
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_NOT_FOUND' } });
    });
  });

  describe('offer lifecycle', () => {
    it('walks offer -> accept -> ASSIGNED -> pickup, scoped to the driver', async () => {
      const assignment = await offer(mainShipmentId, driverNearId);
      expect(assignment.status).toBe('offered');
      expect(assignment.vehicleId).toBe(vanId);

      const accepted = await transactions.runWithTenant(tenantA, () =>
        dispatch.accept(tenantA, driverNearUserId, assignment.id),
      );
      expect(accepted.status).toBe('accepted');

      // The shipment row records the driver: the driver now lists and acts
      // on exactly this shipment (accept bumped the version to 2).
      const asDriver = { userId: driverNearUserId, role: 'driver' as const };
      const mine = await transactions.runWithTenant(tenantA, () =>
        shipments.list(asDriver, tenantA),
      );
      expect(mine.map((shipment) => shipment.id)).toEqual([mainShipmentId]);

      const pickedUp = await transactions.runWithTenant(tenantA, () =>
        shipments.pickup(asDriver, tenantA, mainShipmentId, 2),
      );
      expect(pickedUp.status).toBe('PICKED_UP');
      expect(pickedUp.driverId).toBe(driverNearId);
    });

    it('releases the shipment when an accepted assignment is cancelled', async () => {
      const shipmentId = await insertConfirmedShipment();
      const assignment = await offer(shipmentId, driverFarId, {
        vehicleId: spareVanId,
      });
      await transactions.runWithTenant(tenantA, () =>
        dispatch.accept(tenantA, driverFarUserId, assignment.id),
      );

      const cancelled = await transactions.runWithTenant(tenantA, () =>
        dispatch.cancel(dispatcher, tenantA, assignment.id, 'truck broke down'),
      );
      expect(cancelled.status).toBe('cancelled');

      const released = await transactions.runWithTenant(tenantA, () =>
        shipments.get(dispatcher, tenantA, shipmentId),
      );
      expect(released.status).toBe('CONFIRMED');
      expect(released.driverId).toBeNull();
    });
  });

  describe('lazy expiry and races', () => {
    it('expires an offer that outlived its TTL before the driver answers', async () => {
      const shipmentId = await insertConfirmedShipment();
      const assignment = await offer(shipmentId, driverFarId, {
        ttlMinutes: 0,
      });

      await expect(
        transactions.runWithTenant(tenantA, () =>
          dispatch.accept(tenantA, driverFarUserId, assignment.id),
        ),
      ).rejects.toMatchObject({ response: { code: 'ASSIGNMENT_EXPIRED' } });

      const list = await transactions.runWithTenant(tenantA, () =>
        dispatch.listMine(tenantA, driverFarUserId),
      );
      expect(list.find((row) => row.id === assignment.id)?.status).toBe('expired');
    });

    it('frees the driver and the vehicle once the shipment is closed out', async () => {
      const shipmentId = await insertConfirmedShipment();
      const assignment = await offer(shipmentId, driverFarId, {
        vehicleId: spareVanId,
      });
      await transactions.runWithTenant(tenantA, () =>
        dispatch.accept(tenantA, driverFarUserId, assignment.id),
      );

      await transactions.runWithTenant(tenantA, () =>
        dispatch.completeTerminalShipment(tenantA, shipmentId),
      );

      const mine = await transactions.runWithTenant(tenantA, () =>
        dispatch.listMine(tenantA, driverFarUserId),
      );
      expect(mine.find((row) => row.id === assignment.id)?.status).toBe('completed');

      // The pair is dispatchable again on a fresh shipment.
      const nextShipment = await insertConfirmedShipment();
      const reoffered = await offer(nextShipment, driverFarId, {
        vehicleId: spareVanId,
      });
      expect(reoffered.status).toBe('offered');
      await transactions.runWithTenant(tenantA, () =>
        dispatch.cancel(dispatcher, tenantA, reoffered.id, null),
      );
    });

    it('turns concurrent double-offers into named conflicts', async () => {
      const heldShipmentId = await insertConfirmedShipment();
      const held = await offer(heldShipmentId, driverFarId, {
        vehicleId: spareVanId,
      });
      expect(held.status).toBe('offered');

      // Same shipment, another driver: the per-shipment index fires. (The
      // vehicle offered here is free, so only that index can fire.)
      await expect(
        offer(heldShipmentId, driverShiftId, { vehicleId: smallVanId }),
      ).rejects.toMatchObject({ response: { code: 'ASSIGNMENT_ALREADY_OFFERED' } });

      // Same driver (busy on their accepted job), another shipment and a
      // free vehicle: the per-driver index fires.
      const otherShipmentId = await insertConfirmedShipment();
      await expect(
        offer(otherShipmentId, driverNearId, { vehicleId: smallVanId }),
      ).rejects.toMatchObject({ response: { code: 'DISPATCH_DRIVER_BUSY' } });

      // Free driver, but the vehicle is held with the offer above: the
      // per-vehicle index fires.
      const thirdShipmentId = await insertConfirmedShipment();
      await expect(
        offer(thirdShipmentId, driverShiftId, { vehicleId: spareVanId }),
      ).rejects.toMatchObject({ response: { code: 'DISPATCH_VEHICLE_BUSY' } });

      // Clearing the live offer frees all three sides again.
      await transactions.runWithTenant(tenantA, () =>
        dispatch.cancel(dispatcher, tenantA, held.id, null),
      );
      const reoffered = await offer(thirdShipmentId, driverShiftId, {
        vehicleId: spareVanId,
      });
      expect(reoffered.status).toBe('offered');
    });
  });

  describe('tenant isolation', () => {
    it('keeps tenant B from reading tenant A’s assignments or positions', async () => {
      const rows = (await owner.query(
        `SELECT count(*)::int AS count
           FROM dispatch_assignments
          WHERE tenant_id = $1`,
        [tenantA],
      )) as Array<{ count: number }>;
      expect(rows[0].count).toBeGreaterThan(0);

      // Same probe through the runtime role (no RLS bypass) under tenant
      // B's context: nothing of tenant A comes back.
      const scoped = await appDb.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantB,
        ]);
        const assignments = (await manager.query(
          `SELECT count(*)::int AS count FROM dispatch_assignments`,
        )) as Array<{ count: number }>;
        const locations = (await manager.query(
          `SELECT count(*)::int AS count FROM driver_locations`,
        )) as Array<{ count: number }>;
        return { assignments: assignments[0].count, locations: locations[0].count };
      });
      expect(scoped.assignments).toBe(0);
      expect(scoped.locations).toBe(0);
    });
  });
});
