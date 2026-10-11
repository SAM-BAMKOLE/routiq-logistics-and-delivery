/** DI token for the {@link EmailLogRepository} port. */
export const EMAIL_LOG_REPOSITORY = Symbol('EMAIL_LOG_REPOSITORY');

export type EmailPriority = 'critical' | 'normal';

export type EmailLogStatus = 'sent' | 'failed' | 'skipped_quota';

export interface EmailLogEntry {
  readonly tenantId: string | null;
  readonly recipient: string;
  readonly template: string;
  readonly priority: EmailPriority;
  readonly dedupeKey: string;
  readonly status: EmailLogStatus;
  readonly error: string | null;
  readonly sentAt: Date | null;
}

export interface EmailAttemptsToday {
  /** Attempts (sent or failed) by this tenant today. */
  readonly tenant: number;
  /** Attempts by every tenant today — the shared Gmail allowance. */
  readonly global: number;
}

/**
 * Outbound port over `email_log`, which exists for exactly two jobs: the
 * daily quota guard and deduplication. There is no read API — this table is
 * server-side bookkeeping, never a response body.
 *
 * Dedupe keys are unique in the database; the pre-read here is the common
 * path and the unique index is the backstop against a race.
 */
export interface EmailLogRepository {
  /** Whether a message with this dedupe key was already attempted. */
  findByDedupeKey(dedupeKey: string): Promise<boolean>;
  /** Today's attempt counts (UTC day), globally and for one tenant. */
  countToday(tenantId: string | null): Promise<EmailAttemptsToday>;
  insert(entry: EmailLogEntry): Promise<void>;
}
