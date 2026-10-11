import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { EVENT_BUS, type EventBus } from '../../src/shared/messaging/event-bus.js';
import { createEnvelope } from '../../src/shared/messaging/event-envelope.js';
import { MessagingModule } from '../../src/shared/messaging/messaging.module.js';
import { TenantsModule } from '../../src/modules/tenants/tenants.module.js';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module.js';
import {
  EMAIL_LOG_REPOSITORY,
  type EmailLogRepository,
} from '../../src/modules/notifications/application/email-log.repository.js';
import { NotificationsService } from '../../src/modules/notifications/application/notifications.service.js';
import { InMemoryEmailAdapter } from '../../src/modules/notifications/infrastructure/in-memory-email.adapter.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import { TenantTransactionService } from '../../src/shared/tenancy/tenant-transaction.service.js';
import {
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

/**
 * Notifications against the real database: the pipeline persists its
 * attempts in `email_log`, the unique dedupe index survives a race, the
 * quota counter only sees today's attempts for the right tenant, quota
 * skipping is recorded rather than silently dropped, and a domain event on
 * the real bus carries a customer email end to end (exactly once per
 * replay).
 */
describe('Notifications (integration)', () => {
  let app: INestApplication;
  let notifications: NotificationsService;
  let mailbox: InMemoryEmailAdapter;
  let emailLog: EmailLogRepository;
  let bus: EventBus;
  let owner: DataSource;
  let appDb: DataSource;

  let tenantA: string;
  let tenantEvent: string;
  let tenantQuota: string;
  let eventCustomerId: string;
  let recipient: string;
  let eventRecipient: string;

  const originalTenantLimit = process.env.EMAIL_DAILY_TENANT_LIMIT;
  const originalAdapter = process.env.EMAIL_ADAPTER;

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();

    const tenants = (await owner.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4), ($5, $6) RETURNING id`,
      [
        'Notify A',
        `notify-a-${randomUUID()}`,
        'Notify Event',
        `notify-e-${randomUUID()}`,
        'Notify Quota',
        `notify-q-${randomUUID()}`,
      ],
    )) as Array<{ id: string }>;
    [tenantA, tenantEvent, tenantQuota] = tenants.map((row) => row.id);

    recipient = `ada-${randomUUID()}@example.com`;
    eventRecipient = `event-${randomUUID()}@example.com`;
    // Only the event test resolves a recipient through the customer
    // facade; the rest notify directly by address.
    const customers = (await owner.query(
      `INSERT INTO customers (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
      [tenantEvent, 'Eve', eventRecipient],
    )) as Array<{ id: string }>;
    eventCustomerId = customers[0].id;

    process.env.DATABASE_URL = readDatabaseState().appUrl;
    process.env.JWT_ACCESS_SECRET = 'integration-test-access-secret-min-32-chars';
    // Deterministic transport, plus a deliberately tiny tenant share so the
    // quota path can be exercised without sending 100 messages.
    process.env.EMAIL_ADAPTER = 'memory';
    process.env.EMAIL_DAILY_TENANT_LIMIT = '2';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        DatabaseModule,
        TenancyModule,
        MessagingModule,
        TenantsModule,
        NotificationsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    notifications = app.get(NotificationsService);
    mailbox = app.get(InMemoryEmailAdapter);
    emailLog = app.get(EMAIL_LOG_REPOSITORY);
    bus = app.get(EVENT_BUS);
    appDb = app.get(DataSource);
  });

  afterAll(async () => {
    if (originalTenantLimit === undefined) {
      delete process.env.EMAIL_DAILY_TENANT_LIMIT;
    } else {
      process.env.EMAIL_DAILY_TENANT_LIMIT = originalTenantLimit;
    }
    if (originalAdapter === undefined) {
      delete process.env.EMAIL_ADAPTER;
    } else {
      process.env.EMAIL_ADAPTER = originalAdapter;
    }
    await app.close();
    await owner.destroy();
  });

  it('sends with tenant branding and records the attempt', async () => {
    const dedupeKey = randomUUID();
    const before = mailbox.sent().length;

    const outcome = await notifications.notify({
      tenantId: tenantA,
      template: 'shipment-confirmed',
      recipient: `  ${recipient.toUpperCase()} `,
      priority: 'normal',
      dedupeKey,
      data: { customerName: 'Ada', trackingNumber: 'SHP-INT111222333' },
    });

    expect(outcome).toBe('sent');
    expect(mailbox.sent()).toHaveLength(before + 1);
    const message = mailbox.lastTo(recipient);
    expect(message?.subject).toContain('SHP-INT111222333');
    // Branding came from the real tenants row, not a fallback.
    expect(message?.fromName).toBe('Notify A');

    const rows = (await appDb.query(
      `SELECT tenant_id, recipient, template, status, sent_at
         FROM email_log WHERE dedupe_key = $1`,
      [dedupeKey],
    )) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: tenantA,
      recipient,
      template: 'shipment-confirmed',
      status: 'sent',
    });
    expect(rows[0].sent_at).not.toBeNull();
  });

  it('suppresses a replay through the pre-read and the unique index', async () => {
    const dedupeKey = randomUUID();

    expect(
      await notifications.notify({
        tenantId: tenantA,
        template: 'shipment-confirmed',
        recipient,
        priority: 'normal',
        dedupeKey,
        data: { customerName: 'Ada', trackingNumber: 'SHP-REPLAY000001' },
      }),
    ).toBe('sent');
    expect(
      await notifications.notify({
        tenantId: tenantA,
        template: 'shipment-confirmed',
        recipient,
        priority: 'normal',
        dedupeKey,
        data: { customerName: 'Ada', trackingNumber: 'SHP-REPLAY000001' },
      }),
    ).toBe('duplicate');

    // The database itself refuses a second row with the same key.
    await expect(
      appDb.query(
        `INSERT INTO email_log (tenant_id, recipient, template, dedupe_key, status)
         VALUES ($1, $2, 'shipment-confirmed', $3, 'sent')`,
        [tenantA, recipient, dedupeKey],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("counts only today's attempts, scoped per tenant", async () => {
    const tenantC = (
      (await owner.query(
        `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
        ['Notify Count', `notify-c-${randomUUID()}`],
      )) as Array<{ id: string }>
    )[0].id;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await appDb.query(
      `INSERT INTO email_log (tenant_id, recipient, template, dedupe_key, status, sent_at)
       VALUES ($1, 'x@example.com', 'a', $2, 'sent', now()),
              ($1, 'x@example.com', 'a', $3, 'failed', now()),
              ($1, 'x@example.com', 'a', $4, 'sent', $5)`,
      [tenantC, randomUUID(), randomUUID(), randomUUID(), yesterday],
    );

    const counts = await emailLog.countToday(tenantC);
    // Two attempts today; the stale row is invisible to the guard.
    expect(counts.tenant).toBe(2);
    // The tenant filter never counts foreign rows: null matches nothing.
    expect((await emailLog.countToday(null)).tenant).toBe(0);
    expect((await emailLog.countToday(null)).global).toBeGreaterThanOrEqual(2);
  });

  it('records a quota skip without sending, and critical still goes out', async () => {
    for (const n of [0, 1]) {
      expect(
        await notifications.notify({
          tenantId: tenantQuota,
          template: 'out-for-delivery',
          recipient,
          priority: 'normal',
          dedupeKey: randomUUID(),
          data: { customerName: 'Ada', trackingNumber: `SHP-Q${n}` },
        }),
      ).toBe('sent');
    }

    const before = mailbox.sent().length;
    const skipKey = randomUUID();
    expect(
      await notifications.notify({
        tenantId: tenantQuota,
        template: 'out-for-delivery',
        recipient,
        priority: 'normal',
        dedupeKey: skipKey,
        data: { customerName: 'Ada', trackingNumber: 'SHP-Q2' },
      }),
    ).toBe('skipped_quota');
    expect(mailbox.sent()).toHaveLength(before);

    const skipped = (await appDb.query(
      `SELECT status, sent_at FROM email_log WHERE dedupe_key = $1`,
      [skipKey],
    )) as Array<{ status: string; sent_at: Date | null }>;
    expect(skipped[0].status).toBe('skipped_quota');
    expect(skipped[0].sent_at).toBeNull();

    // Critical mail ignores the exhausted share.
    expect(
      await notifications.notify({
        tenantId: tenantQuota,
        template: 'failed-attempt',
        recipient,
        priority: 'critical',
        dedupeKey: randomUUID(),
        data: { customerName: 'Ada', trackingNumber: 'SHP-QX', reason: 'nobody home', failedAttempts: 1 },
      }),
    ).toBe('sent');
  });

  it('carries a shipment event through the real bus exactly once per replay', async () => {
    const transactions = app.get(TenantTransactionService);
    const trackingNumber = 'SHP-EVT444555666';
    const envelope = createEnvelope({
      type: 'ShipmentConfirmed',
      tenantId: tenantEvent,
      aggregateType: 'shipment',
      aggregateId: randomUUID(),
      aggregateVersion: 2,
      payload: { customerId: eventCustomerId, trackingNumber },
    });

    // Listeners resolve the customer through the RLS-scoped facade, so the
    // event is published inside the tenant transaction exactly as it is
    // during a real request.
    await transactions.runWithTenant(tenantEvent, () => bus.publish(envelope));

    const messages = mailbox
      .sent()
      .filter(
        (message) =>
          message.to === eventRecipient &&
          message.subject.includes(trackingNumber),
      );
    expect(messages).toHaveLength(1);

    const rows = (await appDb.query(
      `SELECT status FROM email_log WHERE dedupe_key = $1`,
      [`${envelope.id}:shipment-confirmed:${eventRecipient}`],
    )) as Array<{ status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');

    // Replaying the same event (at-least-once delivery in phase 2) mails
    // nothing new.
    await transactions.runWithTenant(tenantEvent, () => bus.publish(envelope));
    expect(
      mailbox
        .sent()
        .filter((message) => message.subject.includes(trackingNumber)),
    ).toHaveLength(1);
  });

  it('logs global mail with a null tenant (password reset has no tenant)', async () => {
    const dedupeKey = randomUUID();
    const globalRecipient = `reset-${randomUUID()}@example.com`;

    await notifications.notify({
      tenantId: null,
      template: 'reset-password',
      recipient: globalRecipient,
      priority: 'critical',
      dedupeKey,
      data: { resetUrl: 'http://localhost:5173/reset-password?token=abc', expiresInMinutes: 60 },
    });

    const rows = (await appDb.query(
      `SELECT tenant_id, status FROM email_log WHERE dedupe_key = $1`,
      [dedupeKey],
    )) as Array<{ tenant_id: string | null; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBeNull();
    expect(rows[0].status).toBe('sent');
    expect(mailbox.lastTo(globalRecipient)?.subject).toContain('LDMS');
  });
});
