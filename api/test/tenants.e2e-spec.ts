import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

/**
 * Platform tenants API against a real PostGIS database: create / list / update
 * with the interim platform-admin key, and the RFC 9457 error shapes for the
 * failure modes (bad key, bad payload, duplicate slug, unknown tenant).
 */
describe('Platform tenants API (e2e)', () => {
  let app: INestApplication;
  let adminKey: string;

  beforeAll(async () => {
    adminKey = process.env.PLATFORM_ADMIN_API_KEY ?? '';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function uniqueSlug(): string {
    return `acme-${randomUUID()}`;
  }

  describe('authentication', () => {
    it('rejects a request without the platform admin key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .send({ name: 'Ghost Logistics', slug: uniqueSlug() })
        .expect(401)
        .expect('Content-Type', /application\/problem\+json/);

      expect(res.body).toMatchObject({
        status: 401,
        code: 'PLATFORM_ADMIN_KEY_INVALID',
      });
      expect(res.body.correlationId).toEqual(expect.any(String));
    });

    it('rejects a request with a wrong platform admin key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('x-platform-admin-key', 'not-the-key')
        .send({ name: 'Ghost Logistics', slug: uniqueSlug() })
        .expect(401);
    });
  });

  describe('create', () => {
    it('creates a tenant with defaults', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('x-platform-admin-key', adminKey)
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
        .set('x-platform-admin-key', adminKey)
        .send({ name: 'First', slug })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('x-platform-admin-key', adminKey)
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
        .set('x-platform-admin-key', adminKey)
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
        .set('x-platform-admin-key', adminKey)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('gets a single tenant by id', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('x-platform-admin-key', adminKey)
        .send({ name: 'Solo Logistics', slug: uniqueSlug() })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${created.body.id}`)
        .set('x-platform-admin-key', adminKey)
        .expect(200);

      expect(res.body.id).toBe(created.body.id);
      expect(res.body.name).toBe('Solo Logistics');
    });

    it('updates tenant status and plan', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('x-platform-admin-key', adminKey)
        .send({ name: 'Mutable Logistics', slug: uniqueSlug() })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${created.body.id}`)
        .set('x-platform-admin-key', adminKey)
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
        .set('x-platform-admin-key', adminKey)
        .expect(404);

      expect(res.body).toMatchObject({
        status: 404,
        code: 'TENANT_NOT_FOUND',
      });
    });
  });
});