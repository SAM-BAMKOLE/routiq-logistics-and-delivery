import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The email delivery log: one row per message attempt, feeding the daily
 * quota guard and the deduplication key that keeps a replayed event from
 * producing a second email.
 *
 * `tenant_id` is nullable for the same reason `refresh_tokens` is: some
 * messages belong to no tenant (a password reset is requested before any
 * tenant context exists). The table is therefore global rather than
 * RLS-scoped — it has no read API, only server-side quota counting — and is
 * listed alongside `refresh_tokens` in the isolation test's exceptions.
 *
 * `sent_at` is stamped for every attempt (sent or failed), because Gmail's
 * daily allowance counts attempts, not successes; quota-skipped rows leave
 * it null and never consumed anything.
 */
export class CreateEmailLog1756000000012 implements MigrationInterface {
  name = 'CreateEmailLog1756000000012';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "email_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid
          REFERENCES "tenants" ("id") ON DELETE SET NULL,
        "recipient" text NOT NULL,
        "template" text NOT NULL,
        "priority" text NOT NULL DEFAULT 'normal',
        "dedupe_key" text NOT NULL,
        "status" text NOT NULL,
        "error" text,
        "sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_email_log_dedupe_key" UNIQUE ("dedupe_key"),
        CONSTRAINT "ck_email_log_status"
          CHECK ("status" IN ('sent', 'failed', 'skipped_quota'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_email_log_tenant_id_created_at"
        ON "email_log" ("tenant_id", "created_at")
    `);
    // The quota guard counts today's attempts on every send; this is its
    // only access path.
    await queryRunner.query(`
      CREATE INDEX "idx_email_log_sent_at"
        ON "email_log" ("sent_at")
        WHERE "sent_at" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "email_log"`);
  }
}
