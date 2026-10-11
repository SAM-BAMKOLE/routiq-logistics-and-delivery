import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { createOwnerDataSource } from './integration/helpers/database.js';
import { seedAuthFixture, type E2EAuthFixture } from './e2e/seed.js';

interface Session {
  accessToken: string;
  tenantId: string;
  role: string;
}

interface StopBody {
  id: string;
  shipmentId: string;
  sequence: number;
  plannedArrival: string | null;
}

interface RouteBody {
  id: string;
  planId: string | null;
  planDate: string;
  status: string;
  vehicleId: string | null;
  driverId: string | null;
  totalDistanceM: number;
  objectiveValue: number;
  version: number;
  stops: StopBody[];
}

interface PlanBody {
  id: string;
  planDate: string;
  status: 'planning' | 'planned' | 'failed';
  strategy: string;
  seed: string;
  error: string | null;
  unassigned: { stopId: string; reason: string }[] | null;
  routesCreated: number | null;
  totalDistanceM: number | null;
  objectiveValue: number | null;
  routes: RouteBody[];
}

/**
 * Routing over HTTP: plan a day (202 + status URL + poll), read the routes
 * back along the dispatcher/driver/customer lines, start and replan a route
 * behind `If-Match`, and keep the validation and cross-tenant answers in the
 * problem+json style the rest of the API uses.
 *
 * Tenant B gets its depot and hours in the fixture: the seed's two saved
 * addresses sit 700 km apart, which only plans inside a day with a depot
 * near the pickup and generous hours and speed.
 */
describe('Routing API (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let opsB: Session; // tenant_admin in B: routes:manage
  let driver: Session; // driver in B, owns the profile behind driverBId
  let customer: Session; // portal customer in B: no routing permissions
  let adminA: Session; // tenant_admin in A: no depot, no routes
  let yabaAddressId: string; // two extra geocoded addresses near Lagos
  let ikejaAddressId: string;

  const planDate = '2026-10-20';
  const shipments: Array<{ id: string; version: number }> = [];
  let planId: string;
  let routeId: string;

  beforeAll(async () => {
    fixture = await seedAuthFixture();

    const owner = await createOwnerDataSource();
    try {
      // Depot at the Lagos warehouse with a horizon and speed that make the
      // seed's long-haul addresses plannable in one day (phase-1 speed model:
      // straight-line x circuity, divided by average speed).
      await owner.query(
        `UPDATE tenants SET settings = settings || $2::jsonb WHERE id = $1`,
        [
          fixture.tenantB,
          JSON.stringify({
            routing: {
              depot: { latitude: 6.5244, longitude: 3.3792 },
              depotOpensAt: '05:00',
              depotClosesAt: '23:30',
              averageSpeedKmh: 150,
              serviceSeconds: 60,
            },
          }),
        ],
      );
      // A city loop needs city-scale addresses: Yaba and Ikeja, minutes
      // from the depot, so the planned tour stays inside Lagos.
      const addresses = (await owner.query(
        `INSERT INTO addresses (tenant_id, customer_id, line1, city, country, location)
         VALUES ($1, $2, '7 Herbert Macaulay Way', 'Yaba', 'NG',
                 ST_SetSRID(ST_MakePoint(3.5100, 6.5093), 4326)::geography),
                ($1, $2, '1 Allen Avenue', 'Ikeja', 'NG',
                 ST_SetSRID(ST_MakePoint(3.3515, 6.6018), 4326)::geography)
         RETURNING id`,
        [fixture.tenantB, fixture.customerId],
      )) as Array<{ id: string }>;
      yabaAddressId = addresses[0].id;
      ikejaAddressId = addresses[1].id;
    } finally {
      if (owner.isInitialized) {
        await owner.destroy();
      }
    }

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();

    opsB = await loginAs(fixture.opsBEmail, fixture.opsBPassword);
    driver = await loginAs(
      fixture.driverEmail,
      fixture.driverPassword,
      fixture.tenantB,
    );
    customer = await loginAs(
      fixture.customerEmail,
      fixture.customerPassword,
      fixture.tenantB,
    );
    adminA = await loginAs(fixture.adminEmail, fixture.adminPassword);

    // One rate card makes the whole tenant shippable (same as dispatch).
    await request(app.getHttpServer())
      .post('/api/v1/pricing-rules')
      .set(auth(opsB.accessToken))
      .send({
        name: 'B standard',
        baseFeeMinor: 50_000,
        perKmMinor: 100_000,
        perKgMinor: 1_000,
        minFeeMinor: 100_000,
      })
      .expect(201);

    // Three confirmed shipments forming a Lagos loop: warehouse -> Yaba ->
    // Ikeja -> warehouse. Windowless, so any plan date may pick them up.
    shipments.push(
      await confirmedShipment(fixture.pickupAddressId, yabaAddressId),
      await confirmedShipment(yabaAddressId, ikejaAddressId),
      await confirmedShipment(ikejaAddressId, fixture.pickupAddressId),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAs(
    email: string,
    password: string,
    tenantId?: string,
  ): Promise<Session> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(tenantId ? { email, password, tenantId } : { email, password })
      .expect(201);
    return {
      accessToken: res.body.accessToken as string,
      tenantId: res.body.tenant.id as string,
      role: res.body.tenant.role as string,
    };
  }

  function auth(token: string): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
  }

  /** Creates and confirms a shipment between two tenant addresses. */
  async function confirmedShipment(
    pickupAddressId: string,
    dropoffAddressId: string,
  ): Promise<{ id: string; version: number }> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/shipments')
      .set(auth(opsB.accessToken))
      .send({
        customerId: fixture.customerId,
        pickupAddressId,
        dropoffAddressId,
        weightKg: 50,
        items: [{ description: 'Cartons', quantity: 5, weightKg: 50 }],
      })
      .expect(201);
    const id = created.body.id as string;
    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/shipments/${id}/confirm`)
      .set(auth(opsB.accessToken))
      .set('If-Match', `"${created.body.version as number}"`)
      .expect(200);
    return { id, version: confirmed.body.version as number };
  }

  /** Polls the 202's status URL until the background optimizer finishes. */
  async function pollPlan(id: string): Promise<PlanBody> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/routes/plans/${id}`)
        .set(auth(opsB.accessToken))
        .expect(200);
      if (res.body.status !== 'planning') {
        return res.body as PlanBody;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Plan ${id} never left planning.`);
  }

  it('plans the day: 202 with a status URL, then routes and stops', async () => {
    const accepted = await request(app.getHttpServer())
      .post('/api/v1/routes/plan')
      .set(auth(opsB.accessToken))
      .send({ planDate })
      .expect(202);

    planId = accepted.body.id as string;
    expect(accepted.headers.location).toBe(
      `/api/v1/routes/plans/${planId}`,
    );
    expect(accepted.body).toMatchObject({
      planDate,
      status: 'planning',
      strategy: 'annealing', // tenant default (settings had no strategy)
    });
    expect(accepted.body.seed).toEqual(expect.any(String));

    const plan = await pollPlan(planId);
    expect(plan.status).toBe('planned');
    expect(plan.error).toBeNull();
    expect(plan.seed).toBe(accepted.body.seed); // replayable from the 202
    expect(plan.unassigned).toEqual([]); // every address is geocoded
    expect(plan.routesCreated).toBe(1);
    expect(plan.totalDistanceM).toBeGreaterThan(0);
    expect(plan.objectiveValue).toBeGreaterThan(0);

    expect(plan.routes).toHaveLength(1);
    const route = plan.routes[0];
    routeId = route.id;
    expect(route).toMatchObject({
      planDate,
      status: 'planned',
      vehicleId: fixture.vehicleBId,
      driverId: fixture.driverBId,
      version: 1,
    });
    expect(route.totalDistanceM).toBeGreaterThan(0);

    // All three shipments planned exactly once, sequenced from the depot.
    expect(route.stops).toHaveLength(3);
    expect(route.stops.map((stop) => stop.sequence)).toEqual([1, 2, 3]);
    expect(
      route.stops.map((stop) => stop.shipmentId).sort(),
    ).toEqual(shipments.map((row) => row.id).sort());
    for (const stop of route.stops) {
      expect(stop.plannedArrival).not.toBeNull();
    }
  });

  it('reads routes along the dispatcher/driver/customer lines', async () => {
    const list = await request(app.getHttpServer())
      .get(`/api/v1/routes?planDate=${planDate}`)
      .set(auth(opsB.accessToken))
      .expect(200);
    expect(list.body.data).toHaveLength(1);

    const one = await request(app.getHttpServer())
      .get(`/api/v1/routes/${routeId}`)
      .set(auth(opsB.accessToken))
      .expect(200);
    expect(one.headers.etag).toBe('"1"');
    expect(one.body.stops).toHaveLength(3);

    // The assigned driver sees exactly their own route...
    const mine = await request(app.getHttpServer())
      .get('/api/v1/routes')
      .set(auth(driver.accessToken))
      .expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].driverId).toBe(fixture.driverBId);
    await request(app.getHttpServer())
      .get(`/api/v1/routes/${routeId}`)
      .set(auth(driver.accessToken))
      .expect(200);

    // ...the plan and its writes stay with dispatchers, and customers have
    // no routing rights at all.
    await request(app.getHttpServer())
      .get(`/api/v1/routes/plans/${planId}`)
      .set(auth(driver.accessToken))
      .expect(403)
      .then((res) => expect(res.body.code).toBe('PERMISSION_DENIED'));
    await request(app.getHttpServer())
      .get('/api/v1/routes')
      .set(auth(customer.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/routes/plan')
      .set(auth(customer.accessToken))
      .send({ planDate })
      .expect(403);

    // Unknown ids answer 404, never 403.
    const ghost = '00000000-0000-4000-8000-00000000d15e';
    await request(app.getHttpServer())
      .get(`/api/v1/routes/${ghost}`)
      .set(auth(opsB.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/routes/plans/${ghost}`)
      .set(auth(opsB.accessToken))
      .expect(404);
  });

  it('starts a route behind If-Match: 428, 412, then active', async () => {
    // Missing header is the standard 428...
    await request(app.getHttpServer())
      .post(`/api/v1/routes/${routeId}/start`)
      .set(auth(opsB.accessToken))
      .expect(428)
      .then((res) => expect(res.body.code).toBe('PRECONDITION_REQUIRED'));

    // ...a version the operator never saw is 412...
    await request(app.getHttpServer())
      .post(`/api/v1/routes/${routeId}/start`)
      .set(auth(opsB.accessToken))
      .set('If-Match', '"999"')
      .expect(412)
      .then((res) => expect(res.body.code).toBe('VERSION_MISMATCH'));

    // ...and the right one starts the route.
    const started = await request(app.getHttpServer())
      .post(`/api/v1/routes/${routeId}/start`)
      .set(auth(opsB.accessToken))
      .set('If-Match', '"1"')
      .expect(200);
    expect(started.body.status).toBe('active');
    expect(started.body.version).toBe(2);
    expect(started.headers.etag).toBe('"2"');

    // A route already moving cannot be started again.
    await request(app.getHttpServer())
      .post(`/api/v1/routes/${routeId}/start`)
      .set(auth(opsB.accessToken))
      .set('If-Match', '"2"')
      .expect(409)
      .then((res) => expect(res.body.code).toBe('ROUTE_NOT_STARTABLE'));

    // Drivers read routes; they never start or replan them.
    await request(app.getHttpServer())
      .post(`/api/v1/routes/${routeId}/start`)
      .set(auth(driver.accessToken))
      .set('If-Match', '"2"')
      .expect(403);
  });

  it('replans the remaining stops in place, version-guarded', async () => {
    // The stale version loses to whoever bumped it (the start above).
    await request(app.getHttpServer())
      .post(`/api/v1/routes/${routeId}/replan`)
      .set(auth(opsB.accessToken))
      .set('If-Match', '"1"')
      .expect(412)
      .then((res) => expect(res.body.code).toBe('VERSION_MISMATCH'));

    const replanned = await request(app.getHttpServer())
      .post(`/api/v1/routes/${routeId}/replan`)
      .set(auth(opsB.accessToken))
      .set('If-Match', '"2"')
      .expect(200);
    expect(replanned.body.route.version).toBe(3);
    expect(replanned.headers.etag).toBe('"3"');
    expect(replanned.body.route.status).toBe('active');
    // Nothing changed on the ground: same three shipments, still planned
    // exactly once, nothing fell out of the tour.
    expect(
      replanned.body.route.stops.map((stop: StopBody) => stop.shipmentId).sort(),
    ).toEqual(shipments.map((row) => row.id).sort());
    expect(replanned.body.unassigned).toEqual([]);

    await request(app.getHttpServer())
      .post(`/api/v1/routes/${routeId}/replan`)
      .set(auth(driver.accessToken))
      .set('If-Match', '"3"')
      .expect(403);
  });

  it('answers validation and cross-tenant probes in problem+json', async () => {
    // Field errors: 400 with the shared problem shape and content type.
    const badDate = await request(app.getHttpServer())
      .post('/api/v1/routes/plan')
      .set(auth(opsB.accessToken))
      .send({ planDate: 'soon' })
      .expect(400);
    expect(badDate.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(badDate.body.code).toBe('VALIDATION_ERROR');
    await request(app.getHttpServer())
      .post('/api/v1/routes/plan')
      .set(auth(opsB.accessToken))
      .send({ planDate, strategy: 'quantum' })
      .expect(400);

    // A day with nothing left to route is unprocessable, not empty 200s.
    await request(app.getHttpServer())
      .post('/api/v1/routes/plan')
      .set(auth(opsB.accessToken))
      .send({ planDate: '2026-11-01' })
      .expect(422)
      .then((res) => expect(res.body.code).toBe('ROUTING_PLAN_EMPTY'));

    // Tenant A has no depot: planning there is refused before anything runs.
    await request(app.getHttpServer())
      .post('/api/v1/routes/plan')
      .set(auth(adminA.accessToken))
      .send({ planDate })
      .expect(422)
      .then((res) => expect(res.body.code).toBe('ROUTING_DEPOT_MISSING'));

    // Tenant A cannot see tenant B's run or its routes: 404, never 403.
    await request(app.getHttpServer())
      .get(`/api/v1/routes/plans/${planId}`)
      .set(auth(adminA.accessToken))
      .expect(404)
      .then((res) => expect(res.body.code).toBe('ROUTING_PLAN_NOT_FOUND'));
    await request(app.getHttpServer())
      .get(`/api/v1/routes/${routeId}`)
      .set(auth(adminA.accessToken))
      .expect(404)
      .then((res) => expect(res.body.code).toBe('ROUTE_NOT_FOUND'));
    await request(app.getHttpServer())
      .get('/api/v1/routes')
      .set(auth(adminA.accessToken))
      .expect(200)
      .then((res) => expect(res.body.data).toEqual([]));
  });
});
