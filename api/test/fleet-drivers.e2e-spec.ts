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
 * Fleet and drivers over HTTP: vehicle registration with per-tenant plates,
 * driver profiles linked to memberships, shifts, self-service and
 * dispatcher-managed availability, cross-tenant 404s, and role boundaries.
 */
describe('Fleet and drivers API (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let admin: Session;
  let dispatcher: Session;
  let driver: Session;
  let opsB: Session;

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
    opsB = await loginAs(fixture.opsBEmail, fixture.opsBPassword);
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

  function plate(): string {
    return `E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  describe('vehicles', () => {
    it('registers, reads, updates, and retires a vehicle', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set(auth(opsB.accessToken))
        .send({
          plate: plate(),
          type: 'truck',
          capacityWeightKg: 8000,
          capacityVolumeM3: 40,
        })
        .expect(201);
      expect(created.body).toMatchObject({ type: 'truck', status: 'active' });

      const got = await request(app.getHttpServer())
        .get(`/api/v1/vehicles/${created.body.id}`)
        .set(auth(opsB.accessToken))
        .expect(200);
      expect(got.body.id).toBe(created.body.id);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/vehicles/${created.body.id}`)
        .set(auth(opsB.accessToken))
        .send({ status: 'in_maintenance' })
        .expect(200);
      expect(updated.body.status).toBe('in_maintenance');

      await request(app.getHttpServer())
        .delete(`/api/v1/vehicles/${created.body.id}`)
        .set(auth(opsB.accessToken))
        .expect(204);
    });

    it('rejects duplicate plates in the tenant but allows them across tenants', async () => {
      const value = plate();
      await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set(auth(opsB.accessToken))
        .send({ plate: value, type: 'van', capacityWeightKg: 1000, capacityVolumeM3: 10 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set(auth(opsB.accessToken))
        .send({ plate: value, type: 'van', capacityWeightKg: 1000, capacityVolumeM3: 10 })
        .expect(409)
        .expect((res) => {
          expect(res.body.code).toBe('VEHICLE_PLATE_TAKEN');
        });

      await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set(auth(admin.accessToken))
        .send({ plate: value, type: 'van', capacityWeightKg: 1000, capacityVolumeM3: 10 })
        .expect(201);
    });

    it('hides tenant A vehicles from tenant B', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set(auth(admin.accessToken))
        .send({ plate: plate(), type: 'van', capacityWeightKg: 1000, capacityVolumeM3: 10 })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/vehicles/${created.body.id}`)
        .set(auth(dispatcher.accessToken))
        .expect(404)
        .expect((res) => {
          expect(res.body.code).toBe('VEHICLE_NOT_FOUND');
        });
    });

    it('lets dispatchers read but not manage the fleet', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/vehicles')
        .set(auth(dispatcher.accessToken))
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set(auth(dispatcher.accessToken))
        .send({ plate: plate(), type: 'van', capacityWeightKg: 1, capacityVolumeM3: 1 })
        .expect(403)
        .expect((res) => {
          expect(res.body.code).toBe('PERMISSION_DENIED');
        });
    });

    it('keeps drivers out of the fleet', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/vehicles')
        .set(auth(driver.accessToken))
        .expect(403);
    });
  });

  describe('drivers', () => {
    it('creates a driver profile for a membership of the same tenant', async () => {
      const members = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(auth(admin.accessToken))
        .expect(200);
      const target = (
        members.body.data as Array<{ userId: string; membershipId: string; email: string }>
      ).find((row) => row.email === fixture.driverEmail);
      // The driver user has no membership in tenant A: link the admin instead
      // after inviting a fresh member.
      expect(target).toBeUndefined();

      const email = `wheeler-${randomUUID()}@example.com`;
      const invited = await request(app.getHttpServer())
        .post('/api/v1/users/invitations')
        .set(auth(admin.accessToken))
        .send({ email, role: 'driver' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({ token: invited.body.inviteToken, password: 'Wheeler-123' })
        .expect(201);

      const refreshed = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(auth(admin.accessToken))
        .expect(200);
      const membershipId = (
        refreshed.body.data as Array<{ membershipId: string; email: string }>
      ).find((row) => row.email === email)?.membershipId;

      const created = await request(app.getHttpServer())
        .post('/api/v1/drivers')
        .set(auth(admin.accessToken))
        .send({ membershipId, licenseNo: `DL-${randomUUID().slice(0, 8)}` })
        .expect(201);
      expect(created.body.membershipId).toBe(membershipId);
      expect(created.body.availability).toBe('available');

      // A second profile for the same membership is a 409, not a duplicate.
      await request(app.getHttpServer())
        .post('/api/v1/drivers')
        .set(auth(admin.accessToken))
        .send({ membershipId, licenseNo: `DL-${randomUUID().slice(0, 8)}` })
        .expect(409)
        .expect((res) => {
          expect(res.body.code).toBe('DRIVER_EXISTS');
        });
    });

    it('rejects foreign memberships', async () => {
      const members = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(auth(opsB.accessToken))
        .expect(200);
      const foreign = (
        members.body.data as Array<{ membershipId: string; email: string }>
      ).find((row) => row.email === fixture.driverEmail)?.membershipId;

      await request(app.getHttpServer())
        .post('/api/v1/drivers')
        .set(auth(admin.accessToken))
        .send({ membershipId: foreign, licenseNo: `DL-${randomUUID().slice(0, 8)}` })
        .expect(404)
        .expect((res) => {
          expect(res.body.code).toBe('MEMBERSHIP_NOT_FOUND');
        });
    });

    it('manages shifts with range validation', async () => {
      const shift = await request(app.getHttpServer())
        .post(`/api/v1/drivers/${fixture.driverBId}/shifts`)
        .set(auth(opsB.accessToken))
        .send({ startsAt: '2026-10-12T06:00:00.000Z', endsAt: '2026-10-12T14:00:00.000Z' })
        .expect(201);
      expect(shift.body.driverId).toBe(fixture.driverBId);

      await request(app.getHttpServer())
        .post(`/api/v1/drivers/${fixture.driverBId}/shifts`)
        .set(auth(opsB.accessToken))
        .send({ startsAt: '2026-10-12T14:00:00.000Z', endsAt: '2026-10-12T06:00:00.000Z' })
        .expect(422)
        .expect((res) => {
          expect(res.body.code).toBe('SHIFT_END_BEFORE_START');
        });

      const listed = await request(app.getHttpServer())
        .get(`/api/v1/drivers/${fixture.driverBId}/shifts`)
        .set(auth(opsB.accessToken))
        .expect(200);
      expect(listed.body.data.length).toBeGreaterThanOrEqual(1);

      await request(app.getHttpServer())
        .delete(`/api/v1/drivers/${fixture.driverBId}/shifts/${shift.body.id}`)
        .set(auth(opsB.accessToken))
        .expect(204);
    });

    it('lets drivers set their own availability but nothing else', async () => {
      const updated = await request(app.getHttpServer())
        .patch('/api/v1/drivers/me/availability')
        .set(auth(driver.accessToken))
        .send({ availability: 'unavailable' })
        .expect(200);
      expect(updated.body.availability).toBe('unavailable');

      await request(app.getHttpServer())
        .patch('/api/v1/drivers/me/availability')
        .set(auth(driver.accessToken))
        .send({ availability: 'available' })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/drivers')
        .set(auth(driver.accessToken))
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/v1/drivers/${fixture.driverBId}/availability`)
        .set(auth(driver.accessToken))
        .send({ availability: 'unavailable' })
        .expect(403)
        .expect((res) => {
          expect(res.body.code).toBe('PERMISSION_DENIED');
        });
    });

    it('lets dispatchers adjust driver availability', async () => {
      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/drivers/${fixture.driverBId}/availability`)
        .set(auth(dispatcher.accessToken))
        .send({ availability: 'unavailable' })
        .expect(200);
      expect(updated.body.availability).toBe('unavailable');

      await request(app.getHttpServer())
        .patch(`/api/v1/drivers/${fixture.driverBId}/availability`)
        .set(auth(dispatcher.accessToken))
        .send({ availability: 'available' })
        .expect(200);
    });

    it('assigns vehicles within the tenant and rejects foreign ones', async () => {
      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/drivers/${fixture.driverBId}`)
        .set(auth(opsB.accessToken))
        .send({ currentVehicleId: fixture.vehicleBId })
        .expect(200);
      expect(updated.body.currentVehicleId).toBe(fixture.vehicleBId);

      const foreign = await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set(auth(admin.accessToken))
        .send({ plate: plate(), type: 'van', capacityWeightKg: 1, capacityVolumeM3: 1 })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/drivers/${fixture.driverBId}`)
        .set(auth(opsB.accessToken))
        .send({ currentVehicleId: foreign.body.id })
        .expect(404)
        .expect((res) => {
          expect(res.body.code).toBe('VEHICLE_NOT_FOUND');
        });
    });
  });
});
