import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import {
  EMAIL_LOG_REPOSITORY,
  type EmailLogRepository,
  type EmailPriority,
} from './email-log.repository.js';
import { EMAIL_PORT, type EmailPort } from './email.port.js';
import { TemplatesService } from './templates.service.js';

export interface NotifyInput {
  /** Owning tenant, or null for global mail (password reset). */
  readonly tenantId: string | null;
  /** Template file base name, e.g. `shipment-confirmed`. */
  readonly template: string;
  /** Final recipient, already resolved by the caller. */
  readonly recipient: string;
  /** `critical` messages survive quota exhaustion; `normal` ones are cut. */
  readonly priority: EmailPriority;
  /**
   * Unique per message attempt: the architecture builds it from the event
   * id, template, and recipient, so a replayed event never sends twice.
   */
  readonly dedupeKey: string;
  /** Template variables (branding is merged in by the service). */
  readonly data: Record<string, unknown>;
}

export type NotifyOutcome = 'sent' | 'failed' | 'skipped_quota' | 'duplicate';

interface Branding {
  readonly tenantName: string;
  readonly logoUrl: string | null;
  readonly accentColor: string;
  readonly replyTo: string | null;
}

const FALLBACK_BRANDING: Branding = {
  // Global mail (a password reset) has no tenant to brand it with.
  tenantName: 'LDMS',
  logoUrl: null,
  accentColor: '#2563eb',
  replyTo: null,
};

/**
 * Phase-1 notification pipeline: check the dedupe key, apply the daily
 * quota, render with tenant branding, send through the {@link EmailPort},
 * and record the outcome in `email_log`.
 *
 * Design notes:
 * - **Never throws on transport failure.** A mail problem is recorded as a
 *   `failed` row and the caller carries on; phase 2 moves retries onto the
 *   BullMQ `email` queue with a dead-letter queue.
 * - **Quota.** A personal Gmail account allows roughly 500 messages a day,
 *   so a global limit (default 450) plus a per-tenant share (default 100)
 *   keep one tenant from consuming the allowance. Only `critical` messages
 *   ignore the quota.
 * - **Counting.** `email_log` counts attempts, not successes — Gmail
 *   charges for both — for the current UTC day.
 * - **Dedupe.** The pre-read is the fast path; the unique index on
 *   `dedupe_key` is the backstop if two identical events race.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(EMAIL_LOG_REPOSITORY)
    private readonly emailLog: EmailLogRepository,
    private readonly templates: TemplatesService,
    private readonly tenants: TenantsService,
    private readonly config: ConfigService,
  ) {}

  async notify(input: NotifyInput): Promise<NotifyOutcome> {
    const recipient = input.recipient.trim().toLowerCase();

    if (await this.emailLog.findByDedupeKey(input.dedupeKey)) {
      this.logger.debug(
        { template: input.template, recipient },
        'duplicate event suppressed by dedupe key',
      );
      return 'duplicate';
    }

    if (
      input.priority === 'normal' &&
      (await this.exhausted(input.tenantId))
    ) {
      await this.emailLog.insert({
        tenantId: input.tenantId,
        recipient,
        template: input.template,
        priority: input.priority,
        dedupeKey: input.dedupeKey,
        status: 'skipped_quota',
        error: null,
        sentAt: null,
      });
      this.logger.warn(
        { template: input.template, recipient, tenantId: input.tenantId },
        'daily email quota exhausted; normal-priority message skipped',
      );
      return 'skipped_quota';
    }

    const branding = await this.branding(input.tenantId);
    const rendered = this.templates.render(input.template, {
      ...branding,
      ...input.data,
    });

    try {
      await this.email.send({
        to: recipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        fromName: branding.tenantName,
        replyTo: branding.replyTo ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.record(input, recipient, 'failed', message);
      this.logger.error(
        { template: input.template, recipient, error },
        'email transport failed',
      );
      return 'failed';
    }

    try {
      await this.record(input, recipient, 'sent', null);
    } catch (error) {
      // The unique index fired: two identical events raced past the
      // pre-read. The mail already went out, so this is a duplicate win.
      this.logger.warn(
        { template: input.template, recipient, error },
        'dedupe key lost the race after send',
      );
    }
    return 'sent';
  }

  /** Global and per-tenant daily attempt counts are both enforced. */
  private async exhausted(tenantId: string | null): Promise<boolean> {
    const globalLimit = this.config.get<number>('EMAIL_DAILY_GLOBAL_LIMIT') ?? 450;
    const tenantLimit = this.config.get<number>('EMAIL_DAILY_TENANT_LIMIT') ?? 100;
    const counts = await this.emailLog.countToday(tenantId);
    return (
      counts.global >= globalLimit ||
      (tenantId !== null && counts.tenant >= tenantLimit)
    );
  }

  /** Tenant branding for the rendered message; fallback for global mail. */
  private async branding(tenantId: string | null): Promise<Branding> {
    if (!tenantId) {
      return FALLBACK_BRANDING;
    }
    const tenant = await this.tenants.getById(tenantId);
    const settings = tenant.settings as {
      logoUrl?: unknown;
      accentColor?: unknown;
      contactEmail?: unknown;
    };
    return {
      tenantName: tenant.name,
      logoUrl: typeof settings.logoUrl === 'string' ? settings.logoUrl : null,
      accentColor:
        typeof settings.accentColor === 'string'
          ? settings.accentColor
          : FALLBACK_BRANDING.accentColor,
      replyTo:
        typeof settings.contactEmail === 'string'
          ? settings.contactEmail
          : null,
    };
  }

  private async record(
    input: NotifyInput,
    recipient: string,
    status: 'sent' | 'failed',
    error: string | null,
  ): Promise<void> {
    await this.emailLog.insert({
      tenantId: input.tenantId,
      recipient,
      template: input.template,
      priority: input.priority,
      dedupeKey: input.dedupeKey,
      status,
      error,
      // Attempts consume the Gmail allowance whether or not they succeed.
      sentAt: new Date(),
    });
  }
}

// Re-exported so a listener needs a single import path for notify inputs.
export type { EmailPriority };
