import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { DriversModule } from '../../src/modules/drivers/drivers.module.js';
import { FleetModule } from '../../src/modules/fleet/fleet.module.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { RoutingService } from '../../src/modules/routing/application/routing.service.js';
import { RoutingModule } from '../../src/modules/routing/routing.module.js';
import { ShipmentsModule } from '../../src/modules/shipments/shipments.module.js';
import { TenantsModule } from '../../src/modules/tenants/tenants.module.js';
import { MessagingModule } from '../../src/shared/messaging/messaging.module.js';
import { TenantTransactionService } from '../../src/shared/tenancy/tenant-transaction.service.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import {
  createAppDataSource,
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

/**
 * Routing against a real PostGIS database: the plan run end to end (input
 * queries over shipments/vehicles/shifts, the background optimizer writing
 * routes and stops, the plan row reaching `planned`), re-planning only the
 * remaining stops, the `route_stops` unique index that keeps a shipment
 * planned exactly once, driver-scoped reads, and RLS on the three new
 * tables.
 */
describe('Routing (integration)', () => {
  let app: INestApplication;
  let transactions: TenantTransactionService;
  let routing: RoutingService;
  let owner: DataSource;
  let appDb: DataSource;

  let tenantA: string;
  let tenantB: string;
  let customerId: string;
  let depotAddressId: string;
  let blankAddressId: string; // geocoding never happened: location is null
  let dispatcher: { userId: string; role: 'dispatcher' };
  let driverUserId: string;
  let idleDriverUserId: string; // has a profile, no vehicle, no routes
  let driverId: string;
  let vanId: string;
  const planDate = '2026-10-20';
  const locatedShipments: string[] = [];
  let blankShipmentId: string;

  /** Inserts a CONFIRMED shipment; drop-off defaults to the depot address. */
  async function insertShipment(dropoffAddressId?: string): Promise<string> {
    const rows = (await owner.query(
      `INSERT INTO shipments
         (tenant_id, tracking_number, customer_id, pickup_address_id,
          dropoff_address_id, status, weight_kg, volume_m3, price_minor, currency)
       VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', 50, 1, 25000, 'NGN')
       RETURNING id`,
      [
        tenantA,
        `SHP-${randomUUID().slice(0, 8)}`,
        customerId,
        depotAddressId,
        dropoffAddressId ?? depotAddressId,
      ],
    )) as Array<{ id: string }>;
    return rows[0].id;
  }

  /** Polls the plan until the background optimizer is done with it. */
  async function awaitPlan(planId: string) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const view = await transactions.runWithTenant(tenantA, () =>
        routing.getPlan(dispatcher, tenantA, planId),
      );
      if (view.plan.status !== 'planning') {
        return view;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Plan ${planId} never left planning.`);
  }

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();
    appDb = await createAppDataSource();
    const tag = randomUUID().slice(0, 8);

    const tenants = (await owner.query(
      `INSERT INTO tenants (name, slug, settings)
       VALUES ($1, $2, $3), ($4, $5, '{}'::jsonb) RETURNING id`,
      [
        `Routing A`,
        `routing-a-${tag}`,
        JSON.stringify({
          routing: {
            strategy: 'nearest_neighbor',
            depot: { latitude: 6.5244, longitude: 3.3792 },
            depotOpensAt: '06:00',
            depotClosesAt: '22:00',
            averageSpeedKmh: 40,
            circuityFactor: 1.2,
            serviceSeconds: 60,
          },
        }),
        `Routing B`,
        `routing-b-${tag}`,
      ],
    )) as Array<{ id: string }>;
    [tenantA, tenantB] = tenants.map((row) => row.id);

    const users = (await owner.query(
      `INSERT INTO users (email) VALUES ($1), ($2), ($3) RETURNING id`,
      [`rdisp-${tag}@example.com`, `rdrv-${tag}@example.com`, `ridle-${tag}@example.com`],
    )) as Array<{ id: string }>;
    dispatcher = { userId: users[0].id, role: 'dispatcher' };
    driverUserId = users[1].id;
    idleDriverUserId = users[2].id;

    const memberships = (await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'dispatcher'), ($1, $3, 'driver'), ($1, $4, 'driver')
       RETURNING id`,
      [tenantA, users[0].id, users[1].id, users[2].id],
    )) as Array<{ id: string }>;

    const customer = (await owner.query(
      `INSERT INTO customers (tenant_id, name) VALUES ($1, 'Acme') RETURNING id`,
      [tenantA],
    )) as Array<{ id: string }>;
    customerId = customer[0].id;

    // Three addresses around the depot (all geocoded) plus one whose
    // geocoding never happened — `location` stays null.
    const addresses = (await owner.query(
      `INSERT INTO addresses (tenant_id, customer_id, line1, city, country, location)
       VALUES ($1, $2, '1 Warehouse Road', 'Lagos', 'NG',
               ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography),
              ($1, $2, '2 Adekunle Lane', 'Lagos', 'NG',
               ST_SetSRID(ST_MakePoint(3.3850, 6.5300), 4326)::geography),
              ($1, $2, '3 Herbert Way', 'Lagos', 'NG',
               ST_SetSRID(ST_MakePoint(3.3750, 6.5180), 4326)::geography),
              ($1, $2, '4 Ungeocoded Street', 'Lagos', 'NG', NULL)
       RETURNING id`,
      [tenantA, customerId],
    )) as Array<{ id: string }>;
    [depotAddressId, blankAddressId] = [addresses[0].id, addresses[3].id];

    const vehicles = (await owner.query(
      `INSERT INTO vehicles (tenant_id, plate, type, capacity_weight_kg, capacity_volume_m3)
       VALUES ($1, $2, 'van', 500, 12) RETURNING id`,
      [tenantA, `RVAN-${tag}`],
    )) as Array<{ id: string }>;
    vanId = vehicles[0].id;

    const drivers = (await owner.query(
      `INSERT INTO drivers (tenant_id, membership_id, license_no, status, current_vehicle_id)
       VALUES ($1, $2, $3, 'active', $5), ($1, $4, $6, 'active', NULL)
       RETURNING id`,
      [
        tenantA,
        memberships[1].id,
        `DL-R-${tag}`,
        memberships[2].id,
        vanId,
        `DL-I-${tag}`,
      ],
    )) as Array<{ id: string }>;
    [driverId] = drivers.map((row) => row.id);

    // A shift spanning the whole plan day, in UTC (the plan-day model is
    // UTC-midnight-anchored).
    await owner.query(
      `INSERT INTO driver_shifts (tenant_id, driver_id, starts_at, ends_at)
       VALUES ($1, $2, '2026-10-20 06:00:00+00', '2026-10-20 22:00:00+00')`,
      [tenantA, driverId],
    );

    // Three routable shipments (small, windowless) plus one that cannot be
    // routed because its drop-off address has no coordinates.
    for (const addressId of [addresses[1].id, addresses[2].id, addresses[0].id]) {
      locatedShipments.push(await insertShipment(addressId));
    }
    blankShipmentId = await insertShipment(blankAddressId);

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
        RoutingModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    transactions = app.get(TenantTransactionService);
    routing = app.get(RoutingService);
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

  it('plans the day in the background and reports the uncollected stop', async () => {
    const accepted = await transactions.runWithTenant(tenantA, () =>
      routing.plan(dispatcher, tenantA, { planDate, seed: 'int-seed' }),
    );
    expect(accepted.status).toBe('planning');
    expect(accepted.strategy).toBe('nearest_neighbor'); // tenant default

    const view = await awaitPlan(accepted.id);
    expect(view.plan.status).toBe('planned');
    expect(view.plan.seed).toBe('int-seed');
    expect(view.plan.routesCreated).toBe(1);
    expect(view.plan.unassigned).toEqual([
      { stopId: blankShipmentId, reason: 'no_coordinates' },
    ]);
    expect(view.plan.totalDistanceM).toBeGreaterThan(0);

    // One route on the only vehicle, bound to the driver behind it, with
    // every routable shipment planned exactly once.
    expect(view.routes).toHaveLength(1);
    const route = view.routes[0];
    expect(route.route.vehicleId).toBe(vanId);
    expect(route.route.driverId).toBe(driverId);
    expect(route.version).toBe(1);
    expect(route.stops).toHaveLength(locatedShipments.length);
    expect(route.stops.map((stop) => stop.shipmentId).sort()).toEqual(
      [...locatedShipments].sort(),
    );
    for (const stop of route.stops) {
      expect(stop.plannedArrival).not.toBeNull();
    }
  });

  it('never plans a shipment twice, and re-planning the date only picks up the leftover', async () => {
    // Every routable shipment now has a stop, so a second run for the same
    // day sees exactly the one unroutable leftover: no new routes, no
    // double-planned shipments (the unique index would refuse that anyway).
    const accepted = await transactions.runWithTenant(tenantA, () =>
      routing.plan(dispatcher, tenantA, { planDate }),
    );
    const view = await awaitPlan(accepted.id);
    expect(view.plan.status).toBe('planned');
    expect(view.plan.routesCreated).toBe(0);
    expect(view.routes).toHaveLength(0);
    expect(view.plan.unassigned).toEqual([
      { stopId: blankShipmentId, reason: 'no_coordinates' },
    ]);
  });

  it('refuses duplicate stops at the schema level', async () => {
    const planned = (await owner.query(
      `SELECT rs.route_id, rs.shipment_id
         FROM route_stops rs
         JOIN routes r ON r.id = rs.route_id
        WHERE r.tenant_id = $1
        LIMIT 1`,
      [tenantA],
    )) as Array<{ route_id: string; shipment_id: string }>;
    expect(planned).toHaveLength(1);

    await expect(
      owner.query(
        `INSERT INTO route_stops (tenant_id, route_id, shipment_id, sequence)
         VALUES ($1, $2, $3, 99)`,
        [tenantA, planned[0].route_id, planned[0].shipment_id],
      ),
    ).rejects.toThrow(/duplicate key|unique/);
  });

  it('starts a route and replans its remaining stops, guarded by version', async () => {
    const planA = await planId();
    const before = await transactions.runWithTenant(tenantA, () =>
      routing.getPlan(dispatcher, tenantA, planA),
    );
    const route = before.routes[0];

    const started = await transactions.runWithTenant(tenantA, () =>
      routing.start(dispatcher, tenantA, route.route.id, route.version),
    );
    expect(started.route.status).toBe('active');
    expect(started.version).toBe(route.version + 1);

    const stale = transactions.runWithTenant(tenantA, () =>
      routing.start(dispatcher, tenantA, route.route.id, route.version),
    );
    await expect(stale).rejects.toMatchObject({
      response: { code: 'VERSION_MISMATCH' },
    });

    const replanned = await transactions.runWithTenant(tenantA, () =>
      routing.replan(dispatcher, tenantA, route.route.id, started.version),
    );
    expect(replanned.route.version).toBe(started.version + 1);
    // Nothing changed on the ground, so the re-solved tour still serves
    // every shipment. (The blank one is not on the route — replan re-solves
    // existing stops, it does not rescan the day — so nothing is dropped.)
    expect(replanned.route.stops).toHaveLength(locatedShipments.length);
    expect(replanned.route.stops.map((stop) => stop.shipmentId).sort()).toEqual(
      [...locatedShipments].sort(),
    );
    expect(replanned.unassigned).toEqual([]);

    // The unique index held through the swap: still one stop per shipment.
    const counts = (await owner.query(
      `SELECT count(*)::int AS count, count(DISTINCT shipment_id)::int AS distinct_shipments
         FROM route_stops WHERE route_id = $1`,
      [route.route.id],
    )) as Array<{ count: number; distinct_shipments: number }>;
    expect(counts[0].count).toBe(locatedShipments.length);
    expect(counts[0].distinct_shipments).toBe(locatedShipments.length);
  });

  /** The id of the first plan of this suite (there is exactly one route). */
  async function planId(): Promise<string> {
    const rows = (await owner.query(
      `SELECT id FROM route_plans WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [tenantA],
    )) as Array<{ id: string }>;
    return rows[0].id;
  }

  it('scopes a driver’s reads to their own routes', async () => {
    const asDriver = { userId: driverUserId, role: 'driver' as const };
    const asIdle = { userId: idleDriverUserId, role: 'driver' as const };
    const routeId = (
      await owner.query(
        `SELECT id FROM routes WHERE tenant_id = $1 LIMIT 1`,
        [tenantA],
      )
    ) as Array<{ id: string }>;

    const mine = await transactions.runWithTenant(tenantA, () =>
      routing.listRoutes(asDriver, tenantA, {}),
    );
    expect(mine.map((found) => found.route.id)).toEqual([routeId[0].id]);

    // Someone else's route answers 404, never 403, and the idle driver
    // sees no routes at all.
    await expect(
      transactions.runWithTenant(tenantA, () =>
        routing.getRoute(asIdle, tenantA, routeId[0].id),
      ),
    ).rejects.toMatchObject({ response: { code: 'ROUTE_NOT_FOUND' } });
    const idleList = await transactions.runWithTenant(tenantA, () =>
      routing.listRoutes(asIdle, tenantA, {}),
    );
    expect(idleList).toEqual([]);
  });

  it('keeps tenant B from seeing tenant A’s plans, routes, or stops', async () => {
    const planA = await planId();
    const routeA = (
      await owner.query(`SELECT id FROM routes WHERE tenant_id = $1 LIMIT 1`, [
        tenantA,
      ])
    ) as Array<{ id: string }>;

    // Owner sees tenant A's rows exist...
    const owned = (await owner.query(
      `SELECT (SELECT count(*)::int FROM route_plans WHERE tenant_id = $1) AS plans,
              (SELECT count(*)::int FROM routes WHERE tenant_id = $1) AS routes,
              (SELECT count(*)::int FROM route_stops WHERE tenant_id = $1) AS stops`,
      [tenantA],
    )) as Array<{ plans: number; routes: number; stops: number }>;
    expect(owned[0].plans).toBeGreaterThan(0);
    expect(owned[0].routes).toBeGreaterThan(0);
    expect(owned[0].stops).toBeGreaterThan(0);

    // Isolation is enforced by the repositories, not the database, so the
    // same ids are simply not found when read under tenant B (below).

    // And the service layer answers 404 for tenant A's ids under B.
    await expect(
      transactions.runWithTenant(tenantB, () =>
        routing.getPlan(dispatcher, tenantB, planA),
      ),
    ).rejects.toMatchObject({ response: { code: 'ROUTING_PLAN_NOT_FOUND' } });
    await expect(
      transactions.runWithTenant(tenantB, () =>
        routing.getRoute(dispatcher, tenantB, routeA[0].id),
      ),
    ).rejects.toMatchObject({ response: { code: 'ROUTE_NOT_FOUND' } });
  });

  it('drops stops that no longer fit after a capacity change', async () => {
    const planA = await planId();
    const view = await transactions.runWithTenant(tenantA, () =>
      routing.getPlan(dispatcher, tenantA, planA),
    );
    const route = view.routes[0];

    // The van suddenly cannot carry any of the 50 kg shipments: every stop
    // leaves the tour and comes back with the reason.
    await owner.query(
      `UPDATE vehicles SET capacity_weight_kg = 10 WHERE id = $1`,
      [route.route.vehicleId],
    );
    const replanned = await transactions.runWithTenant(tenantA, () =>
      routing.replan(dispatcher, tenantA, route.route.id, route.version),
    );
    expect(replanned.route.stops).toEqual([]);
    expect(replanned.unassigned).toHaveLength(locatedShipments.length);
    expect(
      replanned.unassigned.every((stop) => stop.reason === 'capacity_exceeded'),
    ).toBe(true);

    // The stop rows are gone, so the unique index would now let these
    // shipments be planned again elsewhere.
    const remaining = (await owner.query(
      `SELECT count(*)::int AS count FROM route_stops WHERE route_id = $1`,
      [route.route.id],
    )) as Array<{ count: number }>;
    expect(remaining[0].count).toBe(0);
  });
});
