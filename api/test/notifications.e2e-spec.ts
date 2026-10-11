import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { InMemoryEmailAdapter } from '../src/modules/notifications/infrastructure/in-memory-email.adapter.js';
import type { EmailMessage } from '../src/modules/notifications/application/email.port.js';
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
 * Notifications over HTTP: invitations and password resets travel through
 * email (the response never carries a token anymore), password recovery
 * answers identically for known and unknown addresses, and every mapped
 * shipment event mails the customer exactly once with the right template.
 * All mail lands in the in-memory adapter, which every suite can read
 * because the app boots in-process.
 */
describe('Notifications and password recovery (e2e)', () => {
  let app: INestApplication;
  let fixture: E2EAuthFixture;
  let admin: Session; // tenant_admin in A
  let opsB: Session; // tenant_admin in B
  let mailbox: InMemoryEmailAdapter;

  beforeAll(async () => {
    fixture = await seedAuthFixture();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();

    mailbox = app.get(InMemoryEmailAdapter);
    mailbox.clear();

    admin = await loginAs(fixture.adminEmail, fixture.adminPassword);
    opsB = await loginAs(fixture.opsBEmail, fixture.opsBPassword);

    // One rate card makes tenant B shippable.
    await request(app.getHttpServer())
      .post('/api/v1/pricing-rules')
      .set(auth(opsB.accessToken))
      .send({
        name: 'Notify B',
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
    return req.send((options.body ?? {}) as object);
  }

  function createShipment(session: Session): Promise<request.Response> {
    return act('/api/v1/shipments', session, {
      body: {
        customerId: fixture.customerId,
        pickupAddressId: fixture.pickupAddressId,
        dropoffAddressId: fixture.dropoffAddressId,
        weightKg: 120,
        items: [{ description: 'Cartons', quantity: 10, weightKg: 120 }],
      },
    });
  }

  /** Drives a fresh shipment to OUT_FOR_DELIVERY as staff. */
  async function outForDelivery(): Promise<{
    id: string;
    version: number;
    trackingNumber: string;
  }> {
    const created = await createShipment(opsB);
    let version = created.body.version as number;
    const id = created.body.id as string;
    const trackingNumber = created.body.trackingNumber as string;
    for (const action of [
      'confirm',
      'assign',
      'pickup',
      'start-transit',
      'start-delivery',
    ]) {
      const res = await act(`/api/v1/shipments/${id}/${action}`, opsB, {
        version,
        ...(action === 'assign'
          ? { body: { driverId: fixture.driverBId, vehicleId: fixture.vehicleBId } }
          : {}),
      });
      if (res.status !== 200) {
        throw new Error(
          `${action} failed with ${res.status}: ${JSON.stringify(res.body)}`,
        );
      }
      version = res.body.version as number;
    }
    return { id, version, trackingNumber };
  }

  /** Every message that belongs to a shipment, by its tracking number. */
  function messagesFor(trackingNumber: string): EmailMessage[] {
    return mailbox.sent().filter(
      (message) =>
        message.subject.includes(trackingNumber) ||
        message.text.includes(trackingNumber),
    );
  }

  /** Pulls the one-time token out of a plain-text/html pair of parts. */
  function tokenFrom(message: EmailMessage): string {
    const match = /token=([0-9a-f]{64})/.exec(`${message.text}\n${message.html}`);
    if (!match) {
      throw new Error('No token found in the message.');
    }
    return match[1];
  }

  describe('invitations are delivered by email', () => {
    it('withholds the token from the response and mails a branded link', async () => {
      const email = `notify-${randomUUID()}@example.com`;

      const invited = await request(app.getHttpServer())
        .post('/api/v1/users/invitations')
        .set(auth(admin.accessToken))
        .send({ email, role: 'dispatcher' })
        .expect(201);

      expect(invited.body.membershipId).toEqual(expect.any(String));
      expect(invited.body.inviteToken).toBeUndefined();

      const message = mailbox.lastTo(email);
      expect(message).toBeDefined();
      expect(message?.subject).toContain(
        'You have been invited to join E2E Tenant A',
      );
      expect(message?.fromName).toContain('E2E Tenant A');

      const inviteToken = tokenFrom(message!);
      // Handlebars escapes `=` inside the href (`&#x3D;`), so assert on the
      // token itself: it only ever appears inside the invite link.
      expect(message?.html).toContain(inviteToken);
      expect(message?.html).toContain('accept-invite?token');

      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'Emailed-invite-123' })
        .expect(201);
      await loginAs(email, 'Emailed-invite-123');
    });
  });

  describe('password recovery', () => {
    it('accepts unknown addresses without revealing or mailing anything', async () => {
      const ghost = `ghost-${randomUUID()}@example.com`;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: ghost })
        .expect(202);

      expect(res.body).toEqual({ status: 'accepted' });
      expect(mailbox.lastTo(ghost)).toBeUndefined();
    });

    it('delivers a reset link, applies it, and revokes existing sessions', async () => {
      // A live session from before the password change.
      const first = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixture.adminEmail, password: fixture.adminPassword })
        .expect(201);

      const accepted = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: fixture.adminEmail })
        .expect(202);
      expect(accepted.body).toEqual({ status: 'accepted' });

      const message = mailbox.lastTo(fixture.adminEmail);
      expect(message).toBeDefined();
      // Password reset is global mail: platform branding, no tenant.
      expect(message?.subject).toBe('Reset your password for LDMS');
      const resetToken = tokenFrom(message!);

      // Junk tokens are rejected before anything else happens.
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'not-a-real-token', password: 'Whatever-123' })
        .expect(401)
        .then((res) => expect(res.body.code).toBe('RESET_TOKEN_INVALID'));

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: resetToken, password: 'Fresh-Password-9' })
        .expect(200);

      // Old password is gone, new one works.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixture.adminEmail, password: fixture.adminPassword })
        .expect(401);
      await loginAs(fixture.adminEmail, 'Fresh-Password-9');

      // The link was single-use.
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: resetToken, password: 'Second-Password-9' })
        .expect(401)
        .then((res) => expect(res.body.code).toBe('RESET_TOKEN_EXPIRED'));

      // And the session minted before the reset no longer refreshes.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(401);
    });
  });

  describe('shipment lifecycle emails', () => {
    it('mails every mapped event exactly once along the way', async () => {
      const created = await createShipment(opsB);
      expect(created.status).toBe(201);
      const tracking = created.body.trackingNumber as string;
      // Creation is an audit event: nothing goes out yet.
      expect(messagesFor(tracking)).toHaveLength(0);

      const id = created.body.id as string;
      const steps: Array<[string, number]> = [
        ['confirm', 1],
        ['assign', 2],
        ['pickup', 3],
        ['start-transit', 4],
        ['start-delivery', 5],
        ['deliver', 6],
      ];
      for (const [action, version] of steps) {
        const res = await act(`/api/v1/shipments/${id}/${action}`, opsB, {
          version,
          ...(action === 'assign'
            ? { body: { driverId: fixture.driverBId, vehicleId: fixture.vehicleBId } }
            : {}),
        });
        if (res.status !== 200) {
          throw new Error(
            `${action} failed with ${res.status}: ${JSON.stringify(res.body)}`,
          );
        }
      }

      const messages = messagesFor(tracking);
      // Only four of the six steps carry a template: confirm, assign,
      // start-delivery, and deliver.
      expect(messages.map((message) => message.subject)).toEqual([
        `Shipment ${tracking} confirmed`,
        `Driver assigned to shipment ${tracking}`,
        `Shipment ${tracking} is out for delivery`,
        `Delivered: shipment ${tracking}`,
      ]);
      for (const message of messages) {
        expect(message.to).toBe(fixture.customerEmail);
        expect(message.fromName).toContain('E2E Tenant B');
        expect(message.text).toContain(tracking);
      }
    });

    it('mails a failed attempt together with its reason', async () => {
      const { id, version, trackingNumber } = await outForDelivery();

      const failed = await act(`/api/v1/shipments/${id}/fail`, opsB, {
        version,
        body: { reason: 'nobody home' },
      });
      expect(failed.status).toBe(200);

      // The walk already mailed three messages for this shipment; only the
      // failure adds one, and it carries the reason.
      const failedMessages = messagesFor(trackingNumber).filter((message) =>
        message.subject.startsWith('Delivery attempt failed'),
      );
      expect(failedMessages).toHaveLength(1);
      expect(failedMessages[0].subject).toBe(
        `Delivery attempt failed for shipment ${trackingNumber}`,
      );
      expect(failedMessages[0].text).toContain('nobody home');
      expect(failedMessages[0].to).toBe(fixture.customerEmail);
    });
  });
});
