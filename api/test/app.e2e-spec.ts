import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1', () => {
    it('returns the API discovery document', () => {
      return request(app.getHttpServer())
        .get('/api/v1')
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            name: 'LDMS API',
            version: '0.1.0',
          });
        });
    });
  });

  describe('GET /health/live', () => {
    it('reports liveness outside the API prefix', () => {
      return request(app.getHttpServer())
        .get('/health/live')
        .expect(200)
        .expect({ status: 'ok' });
    });
  });

  describe('GET /health/ready', () => {
    it('reports readiness with its dependency checks', () => {
      return request(app.getHttpServer())
        .get('/health/ready')
        .expect(200)
        .expect({ status: 'ok', checks: [] });
    });
  });

  describe('unknown routes', () => {
    it('answers with RFC 9457 problem+json and a correlation ID', () => {
      return request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .expect(404)
        .expect('Content-Type', /application\/problem\+json/)
        .expect((res) => {
          expect(res.body).toMatchObject({
            status: 404,
            code: 'NOT_FOUND',
          });
          expect(res.body.correlationId).toEqual(expect.any(String));
          expect(res.headers['x-request-id']).toEqual(expect.any(String));
        });
    });
  });
});
