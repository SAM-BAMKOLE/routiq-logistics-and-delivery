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

/**
 * Dispatch over HTTP: ranked candidates for a confirmed shipment, the offer
 * lifecycle (expire, reject, accept) with the driver's own endpoints behind
 * `drivers:manage-own`, the shipment moving to ASSIGNED and back on cancel,
 * and the permission lines between dispatchers, drivers, and customers.
 */
describe('Dispatch API (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let opsB: Session; // tenant_admin in B: full dispatch rights
  let driver: Session; // driver in B, owns the profile behind driverBId
  let customer: Session; // portal customer in B
  let secondDriverId: string; // a second, loginless driver profile in B

  beforeAll(async () => {
    fixture = await seedAuthFixture();

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

    // One rate card makes the whole tenant shippable, and a position near
    // the Lagos pickup makes the proximity ranking observable.
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

    const owner = await createOwnerDataSource();
    try {
      await owner.query(
        `INSERT INTO driver_locations (tenant_id, driver_id, recorded_at, location)
         VALUES ($1, $2, now(),
                 ST_SetSRID(ST_MakePoint(3.3792, 6.5302), 4326)::geography)`,
        [fixture.tenantB, fixture.driverBId],
      );
      // A second driver profile in B (no login needed): it exists so a
      // second offer can target someone else and hit only the per-shipment
      // index, never the per-driver one.
      const secondUser = await owner.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id`,
        [`other-driver-${Date.now()}@example.com`],
      ) as Array<{ id: string }>;
      const secondMembership = await owner.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'driver') RETURNING id`,
        [fixture.tenantB, secondUser[0].id],
      ) as Array<{ id: string }>;
      const secondDriver = await owner.query(
        `INSERT INTO drivers (tenant_id, membership_id, license_no) VALUES ($1, $2, $3) RETURNING id`,
        [fixture.tenantB, secondMembership[0].id, `DL-OTHER-${Date.now()}`],
      ) as Array<{ id: string }>;
      secondDriverId = secondDriver[0].id;
    } finally {
      if (owner.isInitialized) {
        await owner.destroy();
      }
    }
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

  /** Creates and confirms a fresh shipment; returns its id and version. */
  async function confirmedShipment(): Promise<{ id: string; version: number }> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/shipments')
      .set(auth(opsB.accessToken))
      .send({
        customerId: fixture.customerId,
        pickupAddressId: fixture.pickupAddressId,
        dropoffAddressId: fixture.dropoffAddressId,
        weightKg: 120,
        items: [{ description: 'Cartons', quantity: 10, weightKg: 120 }],
      })
      .expect(201);
    const id = created.body.id as string;
    let version = created.body.version as number;
    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/shipments/${id}/confirm`)
      .set(auth(opsB.accessToken))
      .set('If-Match', `"${version}"`)
      .expect(200);
    version = confirmed.body.version as number;
    return { id, version };
  }

  function offer(
    shipmentId: string,
    body: object = {},
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipmentId}/assignments`)
      .set(auth(opsB.accessToken))
      .send({ driverId: fixture.driverBId, ...body });
  }

  it('ranks the seeded driver near the pickup, and keeps the routes off limits', async () => {
    const shipment = await confirmedShipment();

    const res = await request(app.getHttpServer())
      .get(`/api/v1/shipments/${shipment.id}/dispatch-candidates`)
      .set(auth(opsB.accessToken))
      .expect(200);
    expect(res.body.data[0]).toMatchObject({
      driverId: fixture.driverBId,
      vehicleId: fixture.vehicleBId,
      withinRadius: true,
    });
    expect(res.body.data[0].distanceMeters).toBeGreaterThan(0);
    expect(res.body.data[0].distanceMeters).toBeLessThan(2_000);

    // Only dispatchers rank candidates; drivers and customers get a 403.
    await request(app.getHttpServer())
      .get(`/api/v1/shipments/${shipment.id}/dispatch-candidates`)
      .set(auth(driver.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/shipments/${shipment.id}/dispatch-candidates`)
      .set(auth(customer.accessToken))
      .expect(403);
  });

  it('returns the shipment to CONFIRMED when an accepted offer is cancelled', async () => {
    const shipment = await confirmedShipment();
    const live = await offer(shipment.id).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/assignments/${live.body.id}/accept`)
      .set(auth(driver.accessToken))
      .expect(200);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/assignments/${live.body.id}/cancel`)
      .set(auth(opsB.accessToken))
      .send({ reason: 'vehicle broke down' })
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');

    const after = await request(app.getHttpServer())
      .get(`/api/v1/shipments/${shipment.id}`)
      .set(auth(opsB.accessToken))
      .expect(200);
    expect(after.body.status).toBe('CONFIRMED');
    expect(after.body.driverId).toBeNull();
  });

  it('runs the offer lifecycle: expire, reject, accept, and the shipment follows', async () => {
    const shipment = await confirmedShipment();

    // A TTL of zero is expired by the time the driver answers.
    const lapsed = await offer(shipment.id, { ttlMinutes: 0 }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/assignments/${lapsed.body.id}/accept`)
      .set(auth(driver.accessToken))
      .expect(409)
      .then((res) => expect(res.body.code).toBe('ASSIGNMENT_EXPIRED'));

    const mine = await request(app.getHttpServer())
      .get('/api/v1/assignments/me')
      .set(auth(driver.accessToken))
      .expect(200);
    expect(
      mine.body.data.find((row: { id: string }) => row.id === lapsed.body.id)
        .status,
    ).toBe('expired');

    // A live offer blocks the shipment until it ends; a second offer to a
    // *different* driver isolates the per-shipment index.
    const live = await offer(shipment.id).expect(201);
    await offer(shipment.id, { driverId: secondDriverId })
      .expect(409)
      .then((res) => expect(res.body.code).toBe('ASSIGNMENT_ALREADY_OFFERED'));

    // The driver passes; the shipment stays CONFIRMED and frees up.
    await request(app.getHttpServer())
      .post(`/api/v1/assignments/${live.body.id}/reject`)
      .set(auth(driver.accessToken))
      .send({ reason: 'already on a job' })
      .expect(200)
      .then((res) => expect(res.body.status).toBe('rejected'));

    const second = await offer(shipment.id).expect(201);
    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/assignments/${second.body.id}/accept`)
      .set(auth(driver.accessToken))
      .expect(200);
    expect(accepted.body.status).toBe('accepted');

    // The shipment followed the acceptance: ASSIGNED to this driver, and
    // readable by them with a new version for the next If-Match.
    const afterAccept = await request(app.getHttpServer())
      .get(`/api/v1/shipments/${shipment.id}`)
      .set(auth(opsB.accessToken))
      .expect(200);
    expect(afterAccept.body.status).toBe('ASSIGNED');
    expect(afterAccept.body.driverId).toBe(fixture.driverBId);
    expect(afterAccept.body.version).toBe(shipment.version + 1);

    // The assigned driver can now act on it (Step 8's scoped rights).
    const pickedUp = await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/pickup`)
      .set(auth(driver.accessToken))
      .set('If-Match', `"${afterAccept.body.version}"`)
      .expect(200);
    expect(pickedUp.body.status).toBe('PICKED_UP');

    // Only drivers answer offers: a customer gets a 403 from the guard, a
    // dispatcher without a driver profile never reaches the assignment.
    const third = await confirmedShipment();
    const foreign = await offer(third.id, { driverId: secondDriverId }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/assignments/${foreign.body.id}/accept`)
      .set(auth(customer.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/assignments/${foreign.body.id}/accept`)
      .set(auth(opsB.accessToken))
      .expect(404)
      .then((res) => expect(res.body.code).toBe('DRIVER_PROFILE_NOT_FOUND'));
  });

  it('answers 404 for assignments and shipments that do not exist', async () => {
    // RLS and the explicit tenant checks agree: unknown ids are 404s, never
    // 403s that leak existence (cross-tenant probes themselves live in the
    // dispatch integration spec).
    const ghost = '00000000-0000-4000-8000-00000000d15e';
    await request(app.getHttpServer())
      .get(`/api/v1/shipments/${ghost}/dispatch-candidates`)
      .set(auth(opsB.accessToken))
      .expect(404);
    await offer(ghost).expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/assignments/${ghost}/accept`)
      .set(auth(driver.accessToken))
      .expect(404);
  });
});
