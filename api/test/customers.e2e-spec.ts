import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
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
 * Customers and addresses over HTTP: full CRUD, nested scoping, coordinate
 * persistence, cross-tenant 404s, and the reader/writer permission boundary.
 */
describe('Customers API (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let admin: Session;
  let dispatcher: Session;
  let driver: Session;

  beforeAll(async () => {
    fixture = await seedAuthFixture();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();

    admin = await loginAs(fixture.adminEmail, fixture.adminPassword);
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

  describe('customers', () => {
    it('creates, reads, updates, and deletes a customer', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(admin.accessToken))
        .send({ name: 'Acme Warehousing', email: 'ops@acme.example' })
        .expect(201);
      expect(created.body).toMatchObject({ name: 'Acme Warehousing' });

      const got = await request(app.getHttpServer())
        .get(`/api/v1/customers/${created.body.id}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(got.body.id).toBe(created.body.id);

      const listed = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set(auth(admin.accessToken))
        .expect(200);
      expect(
        (listed.body.data as Array<{ id: string }>).map((row) => row.id),
      ).toContain(created.body.id);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${created.body.id}`)
        .set(auth(admin.accessToken))
        .send({ phone: '+100' })
        .expect(200);
      expect(updated.body.phone).toBe('+100');

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${created.body.id}`)
        .set(auth(admin.accessToken))
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${created.body.id}`)
        .set(auth(admin.accessToken))
        .expect(404)
        .expect((res) => {
          expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
        });
    });

    it('validates payloads with field-level errors', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(admin.accessToken))
        .send({ name: 'A' })
        .expect(400)
        .expect((res) => {
          expect(res.body.code).toBe('VALIDATION_ERROR');
        });
    });

    it('hides tenant A customers from tenant B', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(admin.accessToken))
        .send({ name: 'Scoped Customer' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${created.body.id}`)
        .set(auth(dispatcher.accessToken))
        .expect(404)
        .expect((res) => {
          expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
        });

      const listed = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set(auth(dispatcher.accessToken))
        .expect(200);
      expect(
        (listed.body.data as Array<{ id: string }>).map((row) => row.id),
      ).not.toContain(created.body.id);
    });
  });

  describe('addresses', () => {
    it('manages addresses nested under their customer, with coordinates', async () => {
      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(admin.accessToken))
        .send({ name: 'Address Customer' })
        .expect(201);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customer.body.id}/addresses`)
        .set(auth(admin.accessToken))
        .send({
          line1: '14 Warehouse Road',
          city: 'Lagos',
          country: 'NG',
          latitude: 6.5244,
          longitude: 3.3792,
        })
        .expect(201);
      expect(created.body.latitude).toBeCloseTo(6.5244, 4);
      expect(created.body.longitude).toBeCloseTo(3.3792, 4);

      const got = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.body.id}/addresses/${created.body.id}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(got.body.id).toBe(created.body.id);

      const listed = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.body.id}/addresses`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(listed.body.data).toHaveLength(1);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.body.id}/addresses/${created.body.id}`)
        .set(auth(admin.accessToken))
        .send({ city: 'Abuja' })
        .expect(200);
      expect(updated.body.city).toBe('Abuja');
      expect(updated.body.latitude).toBeCloseTo(6.5244, 4);

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customer.body.id}/addresses/${created.body.id}`)
        .set(auth(admin.accessToken))
        .expect(204);
    });

    it('accepts addresses without coordinates', async () => {
      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(admin.accessToken))
        .send({ name: 'No Coords Customer' })
        .expect(201);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customer.body.id}/addresses`)
        .set(auth(admin.accessToken))
        .send({ line1: 'Unknown Road', city: 'Kano', country: 'NG' })
        .expect(201);

      expect(created.body.latitude).toBeNull();
      expect(created.body.longitude).toBeNull();
    });

    it('rejects invalid coordinates', async () => {
      const customer = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(admin.accessToken))
        .send({ name: 'Bad Coords Customer' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customer.body.id}/addresses`)
        .set(auth(admin.accessToken))
        .send({ line1: 'x', city: 'y', country: 'z', latitude: 200 })
        .expect(400);
    });

    it('scopes addresses to their customer', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(admin.accessToken))
        .send({ name: 'First Customer' })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(admin.accessToken))
        .send({ name: 'Second Customer' })
        .expect(201);

      const address = await request(app.getHttpServer())
        .post(`/api/v1/customers/${first.body.id}/addresses`)
        .set(auth(admin.accessToken))
        .send({ line1: '1 First Street', city: 'Lagos', country: 'NG' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${second.body.id}/addresses/${address.body.id}`)
        .set(auth(admin.accessToken))
        .expect(404)
        .expect((res) => {
          expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
        });
    });
  });

  describe('authorization', () => {
    it('lets dispatchers read and write customers', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set(auth(dispatcher.accessToken))
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(dispatcher.accessToken))
        .send({ name: `Dispatcher Customer ${randomUUID()}` })
        .expect(201);
    });

    it('keeps drivers out of customer management', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set(auth(driver.accessToken))
        .expect(403)
        .expect((res) => {
          expect(res.body.code).toBe('PERMISSION_DENIED');
        });

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(auth(driver.accessToken))
        .send({ name: 'Driver Customer' })
        .expect(403);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
    });
  });
});
