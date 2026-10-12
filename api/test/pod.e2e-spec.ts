import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { InMemoryEmailAdapter } from '../src/modules/notifications/infrastructure/in-memory-email.adapter.js';
import { createOwnerDataSource } from './integration/helpers/database.js';
import { seedAuthFixture, type E2EAuthFixture } from './e2e/seed.js';

interface Session {
  accessToken: string;
  tenantId: string;
  role: string;
}

/**
 * Proof of delivery over HTTP, end to end against a real database: the
 * tenant switches on `requireProofOfDelivery`, a shipment goes out for
 * delivery and the six-digit code lands in the customer's inbox (the
 * in-memory adapter, read from inside the same process), the driver
 * verifies it and captures a signature, and only then does `deliver` let
 * the shipment settle. The failure paths — wrong code, five wrong codes
 * retiring the code, an expired code, a delivery with no evidence at all —
 * are answered with stable codes, and the plaintext never reaches the
 * database.
 */
describe('Proof of delivery API (e2e)', () => {
  let app: INestApplication;
  let owner: DataSource;
  let fixture: E2EAuthFixture;
  let mailbox: InMemoryEmailAdapter;
  let platform: Session; // platform admin: toggles tenant settings
  let opsB: Session; // tenant_admin in B: full shipment rights
  let driver: Session; // driver in B: captures proof on their assignment
  let customer: Session; // portal customer in B: owns the shipments
  let opsA: Session; // tenant_admin in A: must see nothing of B

  beforeAll(async () => {
    fixture = await seedAuthFixture();
    owner = await createOwnerDataSource();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();
    mailbox = app.get(InMemoryEmailAdapter);
    mailbox.clear();

    platform = await loginAs(fixture.platformEmail, fixture.platformPassword);
    opsB = await loginAs(fixture.opsBEmail, fixture.opsBPassword);
    opsA = await loginAs(fixture.adminEmail, fixture.adminPassword);
    driver = await loginAs(fixture.driverEmail, fixture.driverPassword, fixture.tenantB);
    customer = await loginAs(
      fixture.customerEmail,
      fixture.customerPassword,
      fixture.tenantB,
    );

    // The tenant now demands evidence: every shipment that goes out for
    // delivery gets a code emailed to its customer, and none can be
    // delivered without a proof row.
    await request(app.getHttpServer())
      .patch(`/api/v1/platform/tenants/${fixture.tenantB}`)
      .set(auth(platform.accessToken))
      .send({ settings: { requireProofOfDelivery: true } })
      .expect(200)
      .then((res) => {
        expect(res.body.settings).toMatchObject({ requireProofOfDelivery: true });
      });

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
    if (app) {
      await app.close();
    }
    if (owner?.isInitialized) {
      await owner.destroy();
    }
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

  /** POSTs to a shipment action with the running If-Match version. */
  async function act(
    path: string,
    session: Session,
    options: { version?: number; body?: object } = {},
  ): Promise<request.Response> {
    let req = request(app.getHttpServer())
      .post(path)
      .set(auth(session.accessToken));
    if (options.version !== undefined) {
      req = req.set('If-Match', `"${options.version}"`);
    }
    return req.send((options.body ?? {}) as object);
  }

  /** Drives a fresh shipment to OUT_FOR_DELIVERY, which issues its OTP. */
  async function outForDelivery(): Promise<{
    id: string;
    trackingNumber: string;
    version: number;
  }> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/shipments')
      .set(auth(opsB.accessToken))
      .send({
        customerId: fixture.customerId,
        pickupAddressId: fixture.pickupAddressId,
        dropoffAddressId: fixture.dropoffAddressId,
        weightKg: 120,
        items: [{ description: 'Cartons', quantity: 10, weightKg: 120 }],
      })
      .expect(201);
    const id = created.body.id as string;
    const trackingNumber = created.body.trackingNumber as string;
    let version = created.body.version as number;
    for (const action of ['confirm', 'assign', 'pickup', 'start-transit', 'start-delivery']) {
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
    return { id, trackingNumber, version };
  }

  /**
   * The code from the OTP email for one tracking number. The mailbox also
   * holds the routine status notifications, so the subject line is what
   * singles the delivery code out.
   */
  function codeFromInbox(trackingNumber: string): string {
    const message = mailbox
      .sent()
      .find(
        (mail) =>
          mail.to === fixture.customerEmail &&
          mail.subject.startsWith('Your delivery code for') &&
          mail.subject.includes(trackingNumber),
      );
    if (!message) {
      throw new Error(`no delivery-code email for ${trackingNumber}`);
    }
    const match = /arrives:\s*(\d{6})/.exec(message.text);
    if (!match) {
      throw new Error(`no six-digit code in the email for ${trackingNumber}`);
    }
    return match[1];
  }

  it('issues a code by email, verifies it, and settles the delivery', async () => {
    const shipment = await outForDelivery();
    const code = codeFromInbox(shipment.trackingNumber);

    // Only the HMAC reached the row; the digits exist in the clear in the
    // email and nowhere else.
    const rows = (await owner.query(
      `SELECT otp_hash, otp_attempts FROM shipments WHERE id = $1`,
      [shipment.id],
    )) as Array<{ otp_hash: string; otp_attempts: number }>;
    expect(rows[0].otp_hash).not.toContain(code);
    expect(rows[0].otp_attempts).toBe(0);

    // The driver verifies the code the recipient was emailed.
    const verified = await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/otp/verify`)
      .set(auth(driver.accessToken))
      .send({ code })
      .expect(201);
    expect(verified.body).toMatchObject({ shipmentId: shipment.id, type: 'otp' });

    // A signature on top of the code: both proofs are listed, oldest first.
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/proof`)
      .set(auth(driver.accessToken))
      .send({ type: 'signature', recipientName: 'Jane Doe' })
      .expect(201);
    const proofs = await request(app.getHttpServer())
      .get(`/api/v1/shipments/${shipment.id}/proofs`)
      .set(auth(customer.accessToken))
      .expect(200);
    expect(proofs.body.data).toHaveLength(2);
    expect(proofs.body.data.map((proof: { type: string }) => proof.type)).toEqual([
      'otp',
      'signature',
    ]);

    // The evidence exists, so the tenant's proof demand is satisfied.
    const delivered = await act(`/api/v1/shipments/${shipment.id}/deliver`, opsB, {
      version: shipment.version,
    });
    expect(delivered.status).toBe(200);
    expect(delivered.body).toMatchObject({ status: 'DELIVERED', version: shipment.version + 1 });
  });

  it('blocks delivery until a proof exists, then lets a photo settle it', async () => {
    const shipment = await outForDelivery();

    const blocked = await act(`/api/v1/shipments/${shipment.id}/deliver`, opsB, {
      version: shipment.version,
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('PROOF_REQUIRED');

    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/proof`)
      .set(auth(driver.accessToken))
      .send({ type: 'photo', fileUrl: 'https://cdn.example.com/pod.jpg' })
      .expect(201);

    const delivered = await act(`/api/v1/shipments/${shipment.id}/deliver`, opsB, {
      version: shipment.version,
    });
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe('DELIVERED');
  });

  it('rejects wrong codes and retires the code after the fifth guess', async () => {
    const shipment = await outForDelivery();
    const realCode = codeFromInbox(shipment.trackingNumber);

    for (let guess = 1; guess <= 4; guess += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/shipments/${shipment.id}/otp/verify`)
        .set(auth(driver.accessToken))
        .send({ code: '000000' })
        .expect(422)
        .then((res) => expect(res.body.code).toBe('OTP_INVALID'));
    }
    // The fifth wrong guess retires the code outright.
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/otp/verify`)
      .set(auth(driver.accessToken))
      .send({ code: '000000' })
      .expect(422)
      .then((res) => expect(res.body.code).toBe('OTP_LOCKED'));

    // Even the real code is dead now: nothing is outstanding.
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/otp/verify`)
      .set(auth(driver.accessToken))
      .send({ code: realCode })
      .expect(422)
      .then((res) => expect(res.body.code).toBe('OTP_NOT_OUTSTANDING'));
  });

  it('answers an expired code without a second chance', async () => {
    const shipment = await outForDelivery();
    const code = codeFromInbox(shipment.trackingNumber);

    // Age the code past its window; the row keeps everything else intact.
    await owner.query(
      `UPDATE shipments SET otp_expires_at = now() - interval '1 hour' WHERE id = $1`,
      [shipment.id],
    );

    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/otp/verify`)
      .set(auth(driver.accessToken))
      .send({ code })
      .expect(422)
      .then((res) => expect(res.body.code).toBe('OTP_EXPIRED'));

    // The expired code is retired; a follow-up guess finds nothing.
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/otp/verify`)
      .set(auth(driver.accessToken))
      .send({ code })
      .expect(422)
      .then((res) => expect(res.body.code).toBe('OTP_NOT_OUTSTANDING'));
  });

  it('validates what a proof must carry before it can be evidence', async () => {
    const shipment = await outForDelivery();

    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/proof`)
      .set(auth(driver.accessToken))
      .send({ type: 'photo' }) // a photo needs where it is stored
      .expect(422)
      .then((res) => expect(res.body.code).toBe('PROOF_FILE_REQUIRED'));

    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/proof`)
      .set(auth(driver.accessToken))
      .send({ type: 'signature' }) // a signature needs a name
      .expect(422)
      .then((res) => expect(res.body.code).toBe('PROOF_RECIPIENT_REQUIRED'));

    // An OTP proof is recorded by verifying a code, never by capturing one.
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/proof`)
      .set(auth(driver.accessToken))
      .send({ type: 'otp' })
      .expect(422);

    // Only an out-for-delivery shipment accepts evidence of any kind.
    const created = await request(app.getHttpServer())
      .post('/api/v1/shipments')
      .set(auth(opsB.accessToken))
      .send({
        customerId: fixture.customerId,
        pickupAddressId: fixture.pickupAddressId,
        dropoffAddressId: fixture.dropoffAddressId,
        weightKg: 10,
        items: [{ description: 'Envelope', quantity: 1, weightKg: 10 }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${created.body.id}/proof`)
      .set(auth(driver.accessToken))
      .send({ type: 'signature', recipientName: 'Too Early' })
      .expect(409)
      .then((res) => expect(res.body.code).toBe('PROOF_WRONG_STATUS'));
  });

  it('keeps proof capture behind permissions and tenant walls', async () => {
    const shipment = await outForDelivery();

    // The customer owns the shipment but cannot fabricate evidence.
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/proof`)
      .set(auth(customer.accessToken))
      .send({ type: 'signature', recipientName: 'Self-Signed' })
      .expect(403);

    // Another tenant's admin sees nothing of this shipment: not its proofs,
    // not its existence.
    await request(app.getHttpServer())
      .get(`/api/v1/shipments/${shipment.id}/proofs`)
      .set(auth(opsA.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/otp/verify`)
      .set(auth(opsA.accessToken))
      .send({ code: '000000' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/shipments/${shipment.id}/proof`)
      .set(auth(opsA.accessToken))
      .send({ type: 'signature', recipientName: 'Foreign' })
      .expect(404);
  });
});
