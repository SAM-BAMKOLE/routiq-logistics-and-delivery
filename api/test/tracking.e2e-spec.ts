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
 * Tracking over HTTP: the ingest path drivers and dispatchers use, the
 * latest-position and history reads, the authenticated track view, and the
 * anonymous public endpoint with its two-secret lookup and rate limit. The
 * permission line between `tracking:push` (drivers) and `tracking:read`
 * (dispatchers) is exercised from both sides.
 */
describe('Tracking API (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let opsB: Session;
  let driver: Session;
  let customer: Session;

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

  const ago = (seconds: number): string =>
    new Date(Date.now() - seconds * 1_000).toISOString();

  it('lets a driver push their own positions and read them back', async () => {
    const push = await request(app.getHttpServer())
      .post('/api/v1/tracking/locations')
      .set(auth(driver.accessToken))
      .send({
        points: [
          { latitude: 6.5244, longitude: 3.3792, recordedAt: ago(30), speedKmh: 30, heading: 90 },
          { latitude: 6.525, longitude: 3.3795, recordedAt: ago(10), speedKmh: 32, heading: 90 },
        ],
      })
      .expect(200);
    expect(push.body).toMatchObject({ accepted: 2, discarded: [] });

    const latest = await request(app.getHttpServer())
      .get(`/api/v1/drivers/${fixture.driverBId}/location`)
      .set(auth(driver.accessToken))
      .expect(200);
    expect(latest.body).toMatchObject({
      driverId: fixture.driverBId,
      speedKmh: 32,
      heading: 90,
    });
    expect(latest.body.latitude).toBeCloseTo(6.525, 3);
  });

  it('reports per-point discard reasons instead of failing the batch', async () => {
    const push = await request(app.getHttpServer())
      .post('/api/v1/tracking/locations')
      .set(auth(driver.accessToken))
      .send({
        points: [
          { latitude: 6.5244, longitude: 3.3792, recordedAt: ago(400) }, // stale
          { latitude: 91, longitude: 3.3792, recordedAt: ago(5) }, // out of range
          { latitude: 6.5255, longitude: 3.3798, recordedAt: ago(2) }, // kept
        ],
      })
      .expect(200);
    expect(push.body.accepted).toBe(1);
    expect(push.body.discarded).toEqual([
      { index: 0, reason: 'stale' },
      { index: 1, reason: 'out_of_range' },
    ]);
  });

  it('lets a dispatcher push on behalf of a driver by naming them', async () => {
    const push = await request(app.getHttpServer())
      .post('/api/v1/tracking/locations')
      .set(auth(opsB.accessToken))
      .send({
        driverId: fixture.driverBId,
        // Fresh now: the stored predecessor is a couple of seconds old, so
        // this fix is newer, plausibly faster, and worth keeping.
        points: [
          { latitude: 6.526, longitude: 3.38, recordedAt: new Date().toISOString() },
        ],
      })
      .expect(200);
    expect(push.body.accepted).toBe(1);

    // Without a driverId a dispatcher has no driver to push for: 422.
    await request(app.getHttpServer())
      .post('/api/v1/tracking/locations')
      .set(auth(opsB.accessToken))
      .send({ points: [{ latitude: 6.526, longitude: 3.38, recordedAt: ago(4) }] })
      .expect(422)
      .then((res) => expect(res.body.code).toBe('DRIVER_ID_REQUIRED'));
  });

  it('refuses a driver pushing for another driver with 404, not 403', async () => {
    // A second, loginless driver profile in B: the driver must not be able
    // to claim it, and the refusal must not confirm it exists.
    const owner = await createOwnerDataSource();
    let otherDriverId: string;
    try {
      const user = (await owner.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id`,
        [`ghost-${Date.now()}@example.com`],
      )) as Array<{ id: string }>;
      const membership = (await owner.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'driver') RETURNING id`,
        [fixture.tenantB, user[0].id],
      )) as Array<{ id: string }>;
      const other = (await owner.query(
        `INSERT INTO drivers (tenant_id, membership_id, license_no) VALUES ($1, $2, $3) RETURNING id`,
        [fixture.tenantB, membership[0].id, `DL-G-${Date.now()}`],
      )) as Array<{ id: string }>;
      otherDriverId = other[0].id;
    } finally {
      if (owner.isInitialized) {
        await owner.destroy();
      }
    }

    await request(app.getHttpServer())
      .post('/api/v1/tracking/locations')
      .set(auth(driver.accessToken))
      .send({
        driverId: otherDriverId,
        points: [{ latitude: 6.526, longitude: 3.38, recordedAt: ago(4) }],
      })
      .expect(404)
      .then((res) => expect(res.body.code).toBe('DRIVER_NOT_FOUND'));
  });

  it('keeps a driver to their own position history', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/drivers/${fixture.driverBId}/locations`)
      .set(auth(driver.accessToken))
      .expect(200)
      .then((res) => {
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);
        // Newest first.
        const times = res.body.data.map(
          (point: { recordedAt: string }) => new Date(point.recordedAt).getTime(),
        );
        expect([...times].sort((a, b) => b - a)).toEqual(times);
      });

    // A customer has neither tracking:read nor drivers:manage-own: 403.
    await request(app.getHttpServer())
      .get(`/api/v1/drivers/${fixture.driverBId}/locations`)
      .set(auth(customer.accessToken))
      .expect(403);
  });

  it('serves the anonymous tracking view only for the exact number+token pair', async () => {
    const owner = await createOwnerDataSource();
    let trackingNumber: string;
    let publicToken: string;
    try {
      publicToken = 'feedfacefeedfacefeedfacefeedface';
      const inserted = (await owner.query(
        `INSERT INTO shipments
           (tenant_id, tracking_number, public_token, customer_id,
            pickup_address_id, dropoff_address_id, status, weight_kg,
            volume_m3, price_minor, currency)
         VALUES ($1, $2, $3, $4, $5, $6, 'OUT_FOR_DELIVERY', 100, 2, 50000, 'NGN')
         RETURNING tracking_number`,
        [
          fixture.tenantB,
          `SHP-PUB-${Date.now()}`,
          publicToken,
          fixture.customerId,
          fixture.pickupAddressId,
          fixture.dropoffAddressId,
        ],
      )) as Array<{ tracking_number: string }>;
      trackingNumber = inserted[0].tracking_number;
    } finally {
      if (owner.isInitialized) {
        await owner.destroy();
      }
    }

    // No authentication required; the pair resolves the shipment.
    const res = await request(app.getHttpServer())
      .get(`/api/v1/public/tracking/${trackingNumber}`)
      .query({ token: publicToken })
      .expect(200);
    expect(res.body).toMatchObject({ trackingNumber, status: 'OUT_FOR_DELIVERY' });
    expect(Array.isArray(res.body.timeline)).toBe(true);

    // A wrong token answers exactly like a wrong number: 404, no leak.
    await request(app.getHttpServer())
      .get(`/api/v1/public/tracking/${trackingNumber}`)
      .query({ token: '00000000000000000000000000000000' })
      .expect(404)
      .then((r) => expect(r.body.code).toBe('TRACKING_NOT_FOUND'));
    await request(app.getHttpServer())
      .get('/api/v1/public/tracking/SHP-NOPE')
      .query({ token: publicToken })
      .expect(404)
      .then((r) => expect(r.body.code).toBe('TRACKING_NOT_FOUND'));
  });

  it('rate limits the public endpoint and answers 429 with Retry-After', async () => {
    // 30 requests per minute are allowed; the 31st is refused. The endpoint
    // is per-IP, so this runs with no auth at all.
    let limited = false;
    for (let i = 0; i < 35; i += 1) {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/public/tracking/SHP-RATE',
      );
      if (res.status === 429) {
        expect(res.headers['retry-after']).toBeDefined();
        expect(res.body.code).toBe('TOO_MANY_REQUESTS');
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
