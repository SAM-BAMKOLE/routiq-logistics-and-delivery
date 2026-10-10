import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedAuthFixture, type E2EAuthFixture } from './e2e/seed.js';

interface Session {
  accessToken: string;
  tenantId: string;
  role: string;
}

interface ActOptions {
  /** If-Match version; omit to send no header at all. */
  version?: number;
  body?: unknown;
}

/**
 * Shipments over HTTP: the quote-to-delivery flow end to end, every one of
 * the state machine's reachable transitions, the If-Match precondition
 * (428 missing, 412 stale), the retry limit that forces a return, and the
 * role policies that keep customers on their own shipments and drivers on
 * nothing until dispatch lands in Step 8.
 */
describe('Shipments API (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let opsB: Session; // tenant_admin in B
  let opsA: Session; // tenant_admin in A
  let dispatcher: Session; // dispatcher in B
  let driver: Session; // driver in B
  let customer: Session; // portal customer in B

  beforeAll(async () => {
    fixture = await seedAuthFixture();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();

    opsB = await loginAs(fixture.opsBEmail, fixture.opsBPassword);
    opsA = await loginAs(fixture.adminEmail, fixture.adminPassword);
    dispatcher = await loginAs(
      fixture.adminEmail,
      fixture.adminPassword,
      fixture.tenantB,
    );
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

    // One rate card makes the whole tenant shippable.
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
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Logs in and returns the session. The request executes inside the helper,
   * so callers can never orphan a supertest `Test` by chaining assertions
   * onto the returned promise.
   */
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

  /** POSTs to a shipment action, optionally carrying the If-Match version. */
  async function act(
    path: string,
    session: Session,
    options: ActOptions = {},
  ): Promise<request.Response> {
    let req = request(app.getHttpServer())
      .post(path)
      .set(auth(session.accessToken));
    if (options.version !== undefined) {
      req = req.set('If-Match', `"${options.version}"`);
    }
    const res = await req.send((options.body ?? {}) as object);
    return res;
  }

  function createShipment(session: Session, overrides: object = {}) {
    return act('/api/v1/shipments', session, {
      body: {
        customerId: fixture.customerId,
        pickupAddressId: fixture.pickupAddressId,
        dropoffAddressId: fixture.dropoffAddressId,
        weightKg: 120,
        items: [{ description: 'Cartons', quantity: 10, weightKg: 120 }],
        ...overrides,
      },
    });
  }

  /** Drives a fresh shipment to OUT_FOR_DELIVERY as staff. */
  async function outForDelivery(session: Session): Promise<{
    id: string;
    version: number;
  }> {
    const created = await createShipment(session);
    let version = created.body.version as number;
    const id = created.body.id as string;
    for (const action of ['confirm', 'assign', 'pickup', 'start-transit', 'start-delivery']) {
      const res = await act(`/api/v1/shipments/${id}/${action}`, session, {
        version,
        ...(action === 'assign'
          ? { body: { driverId: fixture.driverBId, vehicleId: fixture.vehicleBId } }
          : {}),
      });
      if (res.status !== 200) {
        throw new Error(`${action} failed with ${res.status}: ${JSON.stringify(res.body)}`);
      }
      version = res.body.version as number;
    }
    return { id, version };
  }

  it('refuses to create a shipment in a tenant without an active rule', async () => {
    const fresh = await seedAuthFixture(); // its own tenant pair, no rules
    const freshOps = await loginAs(fresh.opsBEmail, fresh.opsBPassword);
    const res = await createShipment(freshOps, { customerId: fresh.customerId,
      pickupAddressId: fresh.pickupAddressId, dropoffAddressId: fresh.dropoffAddressId });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_ACTIVE_PRICING_RULE');
  });

  it('creates a quoted shipment with the version as its ETag', async () => {
    const res = await createShipment(opsB);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'CREATED',
      currency: 'NGN',
      failedAttempts: 0,
      version: 1,
      weightKg: 120,
    });
    expect(res.body.priceMinor).toBeGreaterThanOrEqual(100_000);
    expect(res.body.trackingNumber).toMatch(/^SHP-[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(res.body.items).toHaveLength(1);
    expect(res.headers['etag']).toBe('"1"');
  });

  it('validates the delivery window and the payload', async () => {
    const inverted = await createShipment(opsB, {
      windowStart: '2026-10-12T17:00:00.000Z',
      windowEnd: '2026-10-12T08:00:00.000Z',
    });
    expect(inverted.status).toBe(422);
    expect(inverted.body.code).toBe('WINDOW_END_BEFORE_START');

    await createShipment(opsB, { weightKg: -1 }).then((res) =>
      expect(res.status).toBe(400),
    );
    await createShipment(opsB, { dropoffAddressId: 'not-a-uuid' }).then((res) =>
      expect(res.status).toBe(400),
    );
  });

  it('requires If-Match and rejects a stale version with 412', async () => {
    const created = await createShipment(opsB);
    const id = created.body.id as string;

    const missing = await act(`/api/v1/shipments/${id}/confirm`, opsB);
    expect(missing.status).toBe(428);
    expect(missing.body.code).toBe('PRECONDITION_REQUIRED');

    const stale = await act(`/api/v1/shipments/${id}/confirm`, opsB, { version: 99 });
    expect(stale.status).toBe(412);
    expect(stale.body.code).toBe('VERSION_MISMATCH');

    const confirmed = await act(`/api/v1/shipments/${id}/confirm`, opsB, { version: 1 });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: 'CONFIRMED', version: 2 });
    expect(confirmed.headers['etag']).toBe('"2"');

    const again = await act(`/api/v1/shipments/${id}/confirm`, opsB, { version: 1 });
    expect(again.status).toBe(412);
  });

  it('walks a shipment from confirm through to delivered', async () => {
    const created = await createShipment(opsB);
    const id = created.body.id as string;

    const steps: Array<[string, number]> = [
      ['confirm', 1],
      ['assign', 2],
      ['pickup', 3],
      ['start-transit', 4],
      ['start-delivery', 5],
      ['deliver', 6],
    ];
    let res: request.Response | undefined;
    for (const [action, version] of steps) {
      res = await act(`/api/v1/shipments/${id}/${action}`, opsB, {
        version,
        ...(action === 'assign'
          ? { body: { driverId: fixture.driverBId, vehicleId: fixture.vehicleBId } }
          : {}),
      });
      if (res.status !== 200) {
        throw new Error(`${action} failed with ${res.status}: ${JSON.stringify(res.body)}`);
      }
    }
    expect(res?.body).toMatchObject({ status: 'DELIVERED', version: 7 });
  });

  it('walks failed attempts into a forced return', async () => {
    const { id, version } = await outForDelivery(opsB); // version 6

    const failed1 = await act(`/api/v1/shipments/${id}/fail`, opsB, {
      version,
      body: { reason: 'nobody home' },
    });
    expect(failed1.body).toMatchObject({
      status: 'FAILED_ATTEMPT',
      failedAttempts: 1,
      version: 7,
    });

    // Attempts only advance one at a time: fail, retry, fail, retry, fail.
    const retried = await act(`/api/v1/shipments/${id}/retry`, opsB, { version: 7 });
    expect(retried.body).toMatchObject({ status: 'OUT_FOR_DELIVERY', version: 8 });

    await act(`/api/v1/shipments/${id}/fail`, opsB, {
      version: 8,
      body: { reason: 'gate locked' },
    });
    await act(`/api/v1/shipments/${id}/retry`, opsB, { version: 9 });
    const failed3 = await act(`/api/v1/shipments/${id}/fail`, opsB, {
      version: 10,
      body: { reason: 'customer away' },
    });
    expect(failed3.body).toMatchObject({ failedAttempts: 3, version: 11 });

    const exhausted = await act(`/api/v1/shipments/${id}/retry`, opsB, { version: 11 });
    expect(exhausted.status).toBe(409);
    expect(exhausted.body.code).toBe('SHIPMENT_RETRY_EXHAUSTED');

    const returned = await act(`/api/v1/shipments/${id}/return`, opsB, {
      version: 11,
      body: { reason: 'attempt limit reached' },
    });
    expect(returned.body).toMatchObject({ status: 'RETURNED', version: 12 });
  });

  it('guards invalid transitions and missing reasons', async () => {
    // No assignment yet: pickup is illegal.
    const fresh = await createShipment(opsB);
    const early = await act(`/api/v1/shipments/${fresh.body.id}/pickup`, opsB, {
      version: 1,
    });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('SHIPMENT_INVALID_TRANSITION');

    // Cancellation dies at pickup, with the documented message.
    const { id, version } = await outForDelivery(opsB);
    const cancel = await act(`/api/v1/shipments/${id}/cancel`, opsB, {
      version,
      body: { reason: 'customer asked' },
    });
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('SHIPMENT_INVALID_TRANSITION');
    expect(cancel.body.detail).toContain('cannot be cancelled');

    // A failed attempt without a usable reason is unprocessable.
    const noReason = await act(`/api/v1/shipments/${id}/fail`, opsB, {
      version,
      body: { reason: '   ' },
    });
    expect(noReason.status).toBe(422);
    expect(noReason.body.code).toBe('SHIPMENT_REASON_REQUIRED');
  });

  it('validates assignment identities inside the tenant', async () => {
    const created = await createShipment(opsB);
    await act(`/api/v1/shipments/${created.body.id}/confirm`, opsB, { version: 1 });

    const ghostDriver = await act(
      `/api/v1/shipments/${created.body.id}/assign`,
      opsB,
      { version: 2, body: { driverId: '00000000-0000-4000-8000-0000000000d1' } },
    );
    expect(ghostDriver.status).toBe(404);
    expect(ghostDriver.body.code).toBe('DRIVER_NOT_FOUND');

    const ghostVehicle = await act(
      `/api/v1/shipments/${created.body.id}/assign`,
      opsB,
      {
        version: 2,
        body: {
          driverId: fixture.driverBId,
          vehicleId: '00000000-0000-4000-8000-0000000000e1',
        },
      },
    );
    expect(ghostVehicle.status).toBe(404);
    expect(ghostVehicle.body.code).toBe('VEHICLE_NOT_FOUND');
  });

  describe('policies and visibility', () => {
    let staffShipmentId: string;

    it('lets dispatchers create and confirm', async () => {
      // A customer the portal user does not own, so scoping is observable.
      const other = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(dispatcher.accessToken))
        .send({ name: 'Other Co' })
        .expect(201);
      const created = await createShipment(dispatcher, {
        customerId: other.body.id as string,
      });
      expect(created.status).toBe(201);
      staffShipmentId = created.body.id as string;

      const confirmed = await act(
        `/api/v1/shipments/${staffShipmentId}/confirm`,
        dispatcher,
        { version: 1 },
      );
      expect(confirmed.status).toBe(200);
    });

    it('scopes customers to their own shipments', async () => {
      const own = await createShipment(customer);
      expect(own.status).toBe(201);

      // Reads: own shipment yes, staff shipment no.
      const gotOwn = await request(app.getHttpServer())
        .get(`/api/v1/shipments/${own.body.id}`)
        .set(auth(customer.accessToken))
        .expect(200);
      expect(gotOwn.body.id).toBe(own.body.id);
      await request(app.getHttpServer())
        .get(`/api/v1/shipments/${staffShipmentId}`)
        .set(auth(customer.accessToken))
        .expect(404);

      const listed = await request(app.getHttpServer())
        .get('/api/v1/shipments')
        .set(auth(customer.accessToken))
        .expect(200);
      const ids = (listed.body.data as Array<{ id: string }>).map((s) => s.id);
      expect(ids).toContain(own.body.id as string);
      expect(ids).not.toContain(staffShipmentId);

      // Writes on someone else's shipment die at the permission guard.
      const confirm = await act(`/api/v1/shipments/${staffShipmentId}/confirm`, customer, {
        version: 2,
      });
      expect(confirm.status).toBe(403);
      expect(confirm.body.code).toBe('PERMISSION_DENIED');
    });

    it('keeps drivers on the sideline until dispatch (Step 8)', async () => {
      const listed = await request(app.getHttpServer())
        .get('/api/v1/shipments')
        .set(auth(driver.accessToken))
        .expect(200);
      expect(listed.body.data).toEqual([]);

      const assigned = await outForDelivery(opsB);
      const pickup = await act(`/api/v1/shipments/${assigned.id}/pickup`, driver, {
        version: assigned.version,
      });
      expect(pickup.status).toBe(403);
      expect(pickup.body.code).toBe('SHIPMENT_NOT_ASSIGNED');
    });

    it('hides everything from a foreign tenant', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/shipments/${staffShipmentId}`)
        .set(auth(opsA.accessToken))
        .expect(404);
      const confirm = await act(`/api/v1/shipments/${staffShipmentId}/confirm`, opsA, {
        version: 2,
      });
      expect(confirm.status).toBe(404);
      expect(confirm.body.code).toBe('SHIPMENT_NOT_FOUND');
    });

    it('filters by status and rejects unknown ones', async () => {
      const created = await request(app.getHttpServer())
        .get('/api/v1/shipments?status=CREATED')
        .set(auth(opsB.accessToken))
        .expect(200);
      for (const shipment of created.body.data as Array<{ status: string }>) {
        expect(shipment.status).toBe('CREATED');
      }

      await request(app.getHttpServer())
        .get('/api/v1/shipments?status=TELEPORTED')
        .set(auth(opsB.accessToken))
        .expect(400);
    });
  });
});
