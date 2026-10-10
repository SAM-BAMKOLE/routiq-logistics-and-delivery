import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedAuthFixture, type E2EAuthFixture } from './e2e/seed.js';

/**
 * Platform tenants API against a real PostGIS database, authorized by JWT
 * platform-admin sessions: missing/invalid/non-admin tokens are rejected with
 * stable codes, and admins get the full create/list/get/update contract.
 */
describe('Platform tenants API (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let adminToken: string;
  let tenantToken: string;

  beforeAll(async () => {
    fixture = await seedAuthFixture();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();

    adminToken = await login(fixture.platformEmail, fixture.platformPassword);
    tenantToken = await login(fixture.adminEmail, fixture.adminPassword);
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return res.body.accessToken as string;
  }

  function uniqueSlug(): string {
    return `acme-${randomUUID()}`;
  }

  describe('authorization', () => {
    it('rejects a request without a token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .send({ name: 'Ghost Logistics', slug: uniqueSlug() })
        .expect(401)
        .expect('Content-Type', /application\/problem\+json/);

      expect(res.body).toMatchObject({
        status: 401,
        code: 'ACCESS_TOKEN_MISSING',
      });
      expect(res.body.correlationId).toEqual(expect.any(String));
    });

    it('rejects a request with a forged token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('Authorization', 'Bearer forged-token')
        .send({ name: 'Ghost Logistics', slug: uniqueSlug() })
        .expect(401)
        .expect((res) => {
          expect(res.body.code).toBe('ACCESS_TOKEN_INVALID');
        });
    });

    it('rejects an authenticated tenant user without the admin flag', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ name: 'Ghost Logistics', slug: uniqueSlug() })
        .expect(403);

      expect(res.body).toMatchObject({
        status: 403,
        code: 'PLATFORM_ADMIN_REQUIRED',
      });
    });
  });

  describe('create', () => {
    it('creates a tenant with defaults', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Acme Logistics', slug: uniqueSlug() })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'active',
        plan: 'free',
        settings: {},
      });
      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body.createdAt).toEqual(expect.any(String));
    });

    it('rejects a duplicate slug with a 409', async () => {
      const slug = uniqueSlug();
      await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'First', slug })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Second', slug })
        .expect(409);

      expect(res.body).toMatchObject({
        status: 409,
        code: 'TENANT_SLUG_TAKEN',
      });
    });

    it('rejects an invalid payload with field-level errors', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'A', slug: 'UPPER CASE !' })
        .expect(400);

      expect(res.body).toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
      expect(res.body.errors).toBeDefined();
    });
  });

  describe('read, update', () => {
    it('lists tenants and returns envelopes with a data array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('gets a single tenant by id', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Solo Logistics', slug: uniqueSlug() })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(created.body.id);
      expect(res.body.name).toBe('Solo Logistics');
    });

    it('updates tenant status and plan', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Mutable Logistics', slug: uniqueSlug() })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'suspended', plan: 'enterprise' })
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'suspended',
        plan: 'enterprise',
      });
    });

    it('returns 404 for an unknown tenant id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/platform/tenants/6c83a8a9-9f3e-4c7e-8f2d-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(res.body).toMatchObject({
        status: 404,
        code: 'TENANT_NOT_FOUND',
      });
    });
  });
});
