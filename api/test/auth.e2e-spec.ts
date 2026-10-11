import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { InMemoryEmailAdapter } from '../src/modules/notifications/infrastructure/in-memory-email.adapter.js';
import { seedAuthFixture, type E2EAuthFixture } from './e2e/seed.js';

/**
 * Authentication and RBAC over HTTP: login (default and explicit tenant),
 * refresh rotation with reuse detection, tenant switching, logout,
 * invitation plus acceptance, tenant user listing, membership updates with
 * last-admin protection, and the permission boundaries between roles.
 */
describe('Identity authentication and RBAC (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;

  beforeAll(async () => {
    fixture = await seedAuthFixture();

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

  /**
   * Logs in and returns the settled response. The request executes inside the
   * helper (awaited), so callers can never orphan a supertest `Test` by
   * chaining assertions onto the returned promise.
   */
  async function login(
    email: string,
    password: string,
    tenantId?: string,
    expectedStatus = 201,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(tenantId ? { email, password, tenantId } : { email, password })
      .expect(expectedStatus);
  }

  /**
   * Reads the raw invite token out of the in-memory mailbox: invitations
   * are delivered by email now, never in an HTTP response.
   */
  function inviteTokenFromMailbox(recipient: string): string {
    const message = app.get(InMemoryEmailAdapter).lastTo(recipient);
    if (!message) {
      throw new Error(`No invitation email was delivered to ${recipient}.`);
    }
    const match = /token=([0-9a-f]{64})/.exec(`${message.text}\n${message.html}`);
    if (!match) {
      throw new Error(`The invitation email to ${recipient} carries no token.`);
    }
    return match[1];
  }

  describe('login', () => {
    it('logs into the first active membership by default', async () => {
      const res = await login(fixture.adminEmail, fixture.adminPassword);

      expect(res.body.tenant.id).toBe(fixture.tenantA);
      expect(res.body.tenant.role).toBe('tenant_admin');
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.expiresIn).toEqual(expect.any(Number));
      expect(res.body.user.email).toBe(fixture.adminEmail);
    });

    it('logs into an explicit tenant', async () => {
      const res = await login(
        fixture.adminEmail,
        fixture.adminPassword,
        fixture.tenantB,
      );

      expect(res.body.tenant.id).toBe(fixture.tenantB);
      expect(res.body.tenant.role).toBe('dispatcher');
    });

    it('rejects wrong passwords and unknown users identically', async () => {
      const wrong = await login(fixture.adminEmail, 'wrong-password', undefined, 401);
      const unknown = await login(
        `ghost-${randomUUID()}@example.com`,
        fixture.adminPassword,
        undefined,
        401,
      );

      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('issues a platform session for an admin without a tenant', async () => {
      const res = await login(
        fixture.platformEmail,
        fixture.platformPassword,
      );

      expect(res.body.tenant).toBeNull();
      expect(res.body.user.isPlatformAdmin).toBe(true);
    });
  });

  describe('refresh, switch, logout', () => {
    it('rotates refresh tokens and detects reuse', async () => {
      const first = await login(fixture.adminEmail, fixture.adminPassword);

      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(200);

      expect(second.body.refreshToken).not.toBe(first.body.refreshToken);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(401)
        .expect((res) => {
          expect(res.body.code).toBe('REFRESH_TOKEN_REUSED');
        });
    });

    it('switches the session to another membership', async () => {
      const first = await login(fixture.adminEmail, fixture.adminPassword);

      const switched = await request(app.getHttpServer())
        .post('/api/v1/auth/switch-tenant')
        .send({ refreshToken: first.body.refreshToken, tenantId: fixture.tenantB })
        .expect(200);

      expect(switched.body.tenant.id).toBe(fixture.tenantB);
      expect(switched.body.tenant.role).toBe('dispatcher');
    });

    it('refuses to switch into a foreign tenant', async () => {
      const first = await login(fixture.driverEmail, fixture.driverPassword);

      await request(app.getHttpServer())
        .post('/api/v1/auth/switch-tenant')
        .send({ refreshToken: first.body.refreshToken, tenantId: fixture.tenantA })
        .expect(403)
        .expect((res) => {
          expect(res.body.code).toBe('NO_ACTIVE_MEMBERSHIP');
        });
    });

    it('logs out by revoking the refresh token', async () => {
      const first = await login(fixture.adminEmail, fixture.adminPassword);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: first.body.refreshToken })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(401);
    });
  });

  describe('invitations and users', () => {
    it('invites, accepts, and logs in as the new member', async () => {
      const admin = await login(fixture.adminEmail, fixture.adminPassword);
      const email = `invited-${randomUUID()}@example.com`;

      const invited = await request(app.getHttpServer())
        .post('/api/v1/users/invitations')
        .set('Authorization', `Bearer ${admin.body.accessToken}`)
        .send({ email, role: 'dispatcher' })
        .expect(201);

      expect(invited.body.membershipId).toEqual(expect.any(String));
      // The token is delivered by email only — never in the response body.
      expect(invited.body.inviteToken).toBeUndefined();

      const inviteToken = inviteTokenFromMailbox(email);
      const message = app.get(InMemoryEmailAdapter).lastTo(email);
      expect(message?.subject).toContain('invited');

      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'New-member-123' })
        .expect(201);

      const member = await login(email, 'New-member-123');
      expect(member.body.tenant.id).toBe(fixture.tenantA);
    });

    it('lists tenant members for admins but not for drivers', async () => {
      const admin = await login(fixture.adminEmail, fixture.adminPassword);
      const driver = await login(
        fixture.driverEmail,
        fixture.driverPassword,
        fixture.tenantB,
      );

      const listed = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${admin.body.accessToken}`)
        .expect(200);

      expect(listed.body.data.map((row: { email: string }) => row.email)).toContain(
        fixture.adminEmail,
      );

      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${driver.body.accessToken}`)
        .expect(403)
        .expect((res) => {
          expect(res.body.code).toBe('PERMISSION_DENIED');
        });
    });

    it('updates a membership and protects the last admin', async () => {
      const admin = await login(fixture.adminEmail, fixture.adminPassword);

      const members = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${admin.body.accessToken}`)
        .expect(200);

      const adminRow = (
        members.body.data as Array<{ membershipId: string; role: string }>
      ).find((row) => row.role === 'tenant_admin');

      // Tenant A has a single admin: demoting them would lock out administration.
      await request(app.getHttpServer())
        .patch(`/api/v1/memberships/${adminRow?.membershipId}`)
        .set('Authorization', `Bearer ${admin.body.accessToken}`)
        .send({ role: 'driver' })
        .expect(409)
        .expect((res) => {
          expect(res.body.code).toBe('LAST_TENANT_ADMIN');
        });

      // A second admin removes the protection: invite, accept, then demote.
      const secondEmail = `second-admin-${randomUUID()}@example.com`;
      const invited = await request(app.getHttpServer())
        .post('/api/v1/users/invitations')
        .set('Authorization', `Bearer ${admin.body.accessToken}`)
        .send({ email: secondEmail, role: 'tenant_admin' })
        .expect(201);
      expect(invited.body.inviteToken).toBeUndefined();

      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteTokenFromMailbox(secondEmail), password: 'Second-admin-123' })
        .expect(201);

      const second = await login(secondEmail, 'Second-admin-123');
      const demoted = await request(app.getHttpServer())
        .patch(`/api/v1/memberships/${adminRow?.membershipId}`)
        .set('Authorization', `Bearer ${second.body.accessToken}`)
        .send({ role: 'driver' })
        .expect(200);

      expect(demoted.body.role).toBe('driver');
    });

    it('denies user administration to non-admin roles', async () => {
      const dispatcher = await login(
        fixture.adminEmail,
        fixture.adminPassword,
        fixture.tenantB,
      );

      const members = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${dispatcher.body.accessToken}`)
        .expect(403);
      expect(members.body.code).toBe('PERMISSION_DENIED');
    });

    it('keeps platform sessions out of tenant routes', async () => {
      const platform = await login(
        fixture.platformEmail,
        fixture.platformPassword,
      );

      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${platform.body.accessToken}`)
        .expect(403)
        .expect((res) => {
          expect(res.body.code).toBe('TENANT_CONTEXT_REQUIRED');
        });
    });
  });
});
