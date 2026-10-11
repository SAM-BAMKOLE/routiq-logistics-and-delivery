import type { ConfigService } from '@nestjs/config';
import type { TenantsService } from '../../tenants/application/tenants.service.js';
import type {
  EmailAttemptsToday,
  EmailLogEntry,
  EmailLogRepository,
} from './email-log.repository.js';
import type { EmailMessage, EmailPort } from './email.port.js';
import { NotificationsService } from './notifications.service.js';
import { TemplatesService } from './templates.service.js';

class RecordingEmailPort implements EmailPort {
  readonly sent: EmailMessage[] = [];
  failWith: string | null = null;

  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) {
      throw new Error(this.failWith);
    }
    this.sent.push(message);
  }
}

class FakeEmailLog implements EmailLogRepository {
  readonly rows: EmailLogEntry[] = [];
  counts: EmailAttemptsToday = { tenant: 0, global: 0 };

  async findByDedupeKey(dedupeKey: string): Promise<boolean> {
    return this.rows.some((row) => row.dedupeKey === dedupeKey);
  }

  async countToday(): Promise<EmailAttemptsToday> {
    return this.counts;
  }

  async insert(entry: EmailLogEntry): Promise<void> {
    if (this.rows.some((row) => row.dedupeKey === entry.dedupeKey)) {
      // The real table's unique index answers this way.
      throw new Error('duplicate key value violates unique constraint');
    }
    this.rows.push(entry);
  }
}

function makeHarness(options: {
  config?: Record<string, unknown>;
  tenant?: { id: string; name: string; settings: Record<string, unknown> };
} = {}) {
  const email = new RecordingEmailPort();
  const emailLog = new FakeEmailLog();
  const tenants = {
    getById: async (id: string) => {
      const tenant = options.tenant ?? {
        id: 't-1',
        name: 'Acme Logistics',
        settings: {
          accentColor: '#ff6600',
          contactEmail: 'hello@acme.example',
        },
      };
      if (id !== tenant.id) {
        throw new Error(`tenant ${id} not found`);
      }
      return tenant;
    },
  } as unknown as TenantsService;
  const config = {
    get: (key: string) => options.config?.[key],
  } as ConfigService;

  const service = new NotificationsService(
    email,
    emailLog,
    new TemplatesService(),
    tenants,
    config,
  );
  return { service, email, emailLog };
}

const inviteInput = {
  tenantId: 't-1',
  template: 'invite-user',
  recipient: 'Boss@Example.COM',
  priority: 'critical' as const,
  dedupeKey: 'event-1:invite-user:boss@example.com',
  data: { role: 'dispatcher', inviteUrl: 'http://localhost:5173/accept-invite?token=abc', expiresInDays: 7 },
};

describe('NotificationsService', () => {
  it('renders with tenant branding, sends, and records a sent row', async () => {
    const { service, email, emailLog } = makeHarness();

    const outcome = await service.notify(inviteInput);

    expect(outcome).toBe('sent');
    expect(email.sent).toHaveLength(1);
    const message = email.sent[0];
    // Recipient is normalized at the boundary.
    expect(message.to).toBe('boss@example.com');
    expect(message.subject).toBe(
      'You have been invited to join Acme Logistics on LDMS',
    );
    expect(message.html).toContain('Acme Logistics');
    expect(message.html).toContain('color:#ff6600');
    expect(message.text).toContain('accept-invite?token=abc');
    // Plain-text part stays plain.
    expect(message.text).not.toContain('<');
    expect(message.fromName).toBe('Acme Logistics');
    expect(message.replyTo).toBe('hello@acme.example');

    expect(emailLog.rows).toHaveLength(1);
    expect(emailLog.rows[0]).toMatchObject({
      tenantId: 't-1',
      recipient: 'boss@example.com',
      template: 'invite-user',
      priority: 'critical',
      status: 'sent',
      error: null,
      dedupeKey: inviteInput.dedupeKey,
    });
    expect(emailLog.rows[0].sentAt).toBeInstanceOf(Date);
  });

  it('suppresses a replayed event by dedupe key', async () => {
    const { service, email, emailLog } = makeHarness();

    expect(await service.notify(inviteInput)).toBe('sent');
    expect(await service.notify(inviteInput)).toBe('duplicate');

    expect(email.sent).toHaveLength(1);
    expect(emailLog.rows).toHaveLength(1);
  });

  it('skips normal messages when the tenant share is spent', async () => {
    const { service, email, emailLog } = makeHarness({
      config: { EMAIL_DAILY_TENANT_LIMIT: 100 },
    });
    emailLog.counts = { tenant: 100, global: 200 };

    const outcome = await service.notify({
      ...inviteInput,
      priority: 'normal',
      dedupeKey: 'event-2:normal',
    });

    expect(outcome).toBe('skipped_quota');
    expect(email.sent).toHaveLength(0);
    expect(emailLog.rows[0]).toMatchObject({
      status: 'skipped_quota',
      sentAt: null, // nothing was spent against the Gmail allowance
    });
  });

  it('skips normal messages when the shared allowance is spent', async () => {
    const { service, email, emailLog } = makeHarness({
      config: { EMAIL_DAILY_GLOBAL_LIMIT: 450 },
    });
    emailLog.counts = { tenant: 0, global: 450 };

    const outcome = await service.notify({
      ...inviteInput,
      priority: 'normal',
      dedupeKey: 'event-3:global',
    });

    expect(outcome).toBe('skipped_quota');
    expect(email.sent).toHaveLength(0);
  });

  it('lets critical messages through a spent quota', async () => {
    const { service, email, emailLog } = makeHarness();
    emailLog.counts = { tenant: 100, global: 450 };

    const outcome = await service.notify(inviteInput);

    expect(outcome).toBe('sent');
    expect(email.sent).toHaveLength(1);
  });

  it('records a transport failure without throwing', async () => {
    const { service, email, emailLog } = makeHarness();
    email.failWith = 'smtp unavailable';

    const outcome = await service.notify(inviteInput);

    expect(outcome).toBe('failed');
    expect(emailLog.rows[0]).toMatchObject({
      status: 'failed',
      error: 'smtp unavailable',
    });
    expect(emailLog.rows[0].sentAt).toBeInstanceOf(Date);
  });

  it('falls back to platform branding for global mail (no tenant)', async () => {
    const { service, email } = makeHarness();

    const outcome = await service.notify({
      tenantId: null,
      template: 'reset-password',
      recipient: 'someone@example.com',
      priority: 'critical',
      dedupeKey: 'event-4:reset',
      data: { resetUrl: 'http://localhost:5173/reset-password?token=xyz', expiresInMinutes: 60 },
    });

    expect(outcome).toBe('sent');
    expect(email.sent[0].subject).toBe('Reset your password for LDMS');
    expect(email.sent[0].fromName).toBe('LDMS');
    expect(email.sent[0].replyTo).toBeUndefined();
    expect(email.sent[0].text).toContain('reset-password?token=xyz');
  });
});
