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

/**
 * Pricing over HTTP: tenant admins own the rate cards, the role table keeps
 * them away from everyone else, and the quote endpoint prices a delivery
 * from the addresses' real coordinates through the same engine shipments
 * use.
 */
describe('Pricing API (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let admin: Session; // tenant_admin in A
  let opsB: Session; // tenant_admin in B
  let dispatcher: Session; // dispatcher in B (same user as admin)
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

    admin = await loginAs(fixture.adminEmail, fixture.adminPassword);
    opsB = await loginAs(fixture.opsBEmail, fixture.opsBPassword);
    dispatcher = await loginAs(
      fixture.adminEmail,
      fixture.adminPassword,
      fixture.tenantB,
    );
    driver = await loginAs(fixture.driverEmail, fixture.driverPassword, fixture.tenantB);
    customer = await loginAs(
      fixture.customerEmail,
      fixture.customerPassword,
      fixture.tenantB,
    );
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

  describe('rate cards', () => {
    let ruleId: string;

    it('creates a rate card with sensible defaults', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/pricing-rules')
        .set(auth(admin.accessToken))
        .send({
          name: 'Lagos standard',
          baseFeeMinor: 50_000,
          perKmMinor: 100_000,
          perKgMinor: 1_000,
          minFeeMinor: 100_000,
          priority: 5,
        })
        .expect(201);
      expect(created.body).toMatchObject({
        name: 'Lagos standard',
        baseFeeMinor: 50_000,
        perKmMinor: 100_000,
        perKgMinor: 1_000,
        minFeeMinor: 100_000,
        priority: 5,
      });
      expect(created.body.activeFrom).toBeDefined();
      ruleId = created.body.id as string;
    });

    it('lists, reads, updates, and deletes inside the tenant', async () => {
      const listed = await request(app.getHttpServer())
        .get('/api/v1/pricing-rules')
        .set(auth(admin.accessToken))
        .expect(200);
      expect((listed.body.data as Array<{ id: string }>).map((r) => r.id)).toContain(
        ruleId,
      );

      const got = await request(app.getHttpServer())
        .get(`/api/v1/pricing-rules/${ruleId}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(got.body.id).toBe(ruleId);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/pricing-rules/${ruleId}`)
        .set(auth(admin.accessToken))
        .send({ minFeeMinor: 120_000, priority: 9 })
        .expect(200);
      expect(updated.body).toMatchObject({ minFeeMinor: 120_000, priority: 9 });

      await request(app.getHttpServer())
        .delete(`/api/v1/pricing-rules/${ruleId}`)
        .set(auth(admin.accessToken))
        .expect(204);
      await request(app.getHttpServer())
        .get(`/api/v1/pricing-rules/${ruleId}`)
        .set(auth(admin.accessToken))
        .expect(404);
    });

    it('keeps rules out of other tenants', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/pricing-rules')
        .set(auth(admin.accessToken))
        .send({ name: 'Tenant A only' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/pricing-rules/${created.body.id}`)
        .set(auth(opsB.accessToken))
        .expect(404);
      const listedInB = await request(app.getHttpServer())
        .get('/api/v1/pricing-rules')
        .set(auth(opsB.accessToken))
        .expect(200);
      expect(listedInB.body.data).toHaveLength(0);
    });

    it('keeps the role table: only tenant admins manage rules', async () => {
      for (const session of [dispatcher, driver, customer]) {
        await request(app.getHttpServer())
          .get('/api/v1/pricing-rules')
          .set(auth(session.accessToken))
          .expect(403);
        await request(app.getHttpServer())
          .post('/api/v1/pricing-rules')
          .set(auth(session.accessToken))
          .send({ name: 'Not allowed' })
          .expect(403);
      }
    });

    it('validates the payload', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/pricing-rules')
        .set(auth(admin.accessToken))
        .send({ name: 'x' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/pricing-rules')
        .set(auth(admin.accessToken))
        .send({ name: 'Negative', perKmMinor: -5 })
        .expect(400);
    });
  });

  describe('quotes', () => {
    it('refuses to quote a tenant without an active rule', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/quotes')
        .set(auth(customer.accessToken))
        .send({
          pickupAddressId: fixture.pickupAddressId,
          dropoffAddressId: fixture.dropoffAddressId,
          weightKg: 100,
        })
        .expect(422);
    });

    it('prices the seeded addresses once a rule exists', async () => {
      const rule = await request(app.getHttpServer())
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

      const quote = await request(app.getHttpServer())
        .post('/api/v1/quotes')
        .set(auth(customer.accessToken))
        .send({
          pickupAddressId: fixture.pickupAddressId,
          dropoffAddressId: fixture.dropoffAddressId,
          weightKg: 100,
        })
        .expect(201);
      expect(quote.body).toMatchObject({
        currency: 'NGN',
        ruleId: (rule.body as { id: string }).id,
      });
      // Lagos to Abuja crow flight, from the seeded coordinates.
      expect(quote.body.distanceMeters).toBeGreaterThan(520_000);
      expect(quote.body.distanceMeters).toBeLessThan(545_000);
      expect(quote.body.priceMinor).toBe(
        quote.body.baseFeeMinor +
          quote.body.distanceFeeMinor +
          quote.body.weightFeeMinor,
      );
    });

    it('404s an unknown address instead of pricing nothing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/quotes')
        .set(auth(customer.accessToken))
        .send({
          pickupAddressId: '00000000-0000-4000-8000-000000000000',
          dropoffAddressId: fixture.dropoffAddressId,
          weightKg: 1,
        })
        .expect(404);
    });

    it('denies drivers and dispatchers the customer-only quote endpoint', async () => {
      for (const session of [driver, dispatcher]) {
        await request(app.getHttpServer())
          .post('/api/v1/quotes')
          .set(auth(session.accessToken))
          .send({
            pickupAddressId: fixture.pickupAddressId,
            dropoffAddressId: fixture.dropoffAddressId,
            weightKg: 1,
          })
          .expect(403);
      }
    });
  });
});
