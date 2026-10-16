import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantIndex } from '../tenant-index.js';

/**
 * Tracking and proof of delivery (Step 10).
 *
 * - `proofs_of_delivery` is the evidence trail: a photo URL, a signature's
 *   recipient name, or the timestamp an OTP was verified. Like the shipment
 *   history it is append-only: captured evidence is never rewritten, so the
 *   runtime role keeps INSERT only and the owner (migrations, tests) can
 *   still clean up.
 * - `shipments` gains two concerns. `public_token` is the second secret the
 *   public tracking endpoint demands beside the tracking number, so a leaked
 *   tracking number alone cannot be looked up; it defaults to a random md5 so
 *   fixture inserts that omit it still get a usable value (the application
 *   generates its own on create). The three `otp_*` columns hold the delivery
 *   OTP state — hash, expiry, attempt counter — written by the proof-of-
 *   delivery module, never the plaintext code.
 * - `lookup_public_shipment` resolves the owning tenant before any tenant
 *   context exists: public tracking presents a tracking number plus a
 *   `public_token`, and this helper returns only the ids needed to re-enter a
 *   normal tenant-scoped read. The `SECURITY DEFINER` function takes typed
 *   parameters (no injection surface) and returns nothing without both
 *   secrets.
 * - The extra `driver_locations` btree backs the retention sweep, which
 *   deletes per tenant by `recorded_at`; the existing per-driver index cannot
 *   serve it.
 */
export class CreateTrackingPod1756000000015 implements MigrationInterface {
  name = 'CreateTrackingPod1756000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "proofs_of_delivery" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "shipment_id" uuid NOT NULL
          REFERENCES "shipments" ("id") ON DELETE CASCADE,
        "type" text NOT NULL,
        "file_url" text,
        "recipient_name" text,
        "otp_verified_at" timestamptz,
        "captured_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "proofs_of_delivery_type_check"
          CHECK ("type" IN ('photo', 'signature', 'otp'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_proofs_of_delivery_tenant_shipment"
        ON "proofs_of_delivery" ("tenant_id", "shipment_id")
    `);
    await createTenantIndex(queryRunner, 'proofs_of_delivery');

    await queryRunner.query(`
      ALTER TABLE "shipments"
        ADD "public_token" text NOT NULL
          DEFAULT md5(random()::text || clock_timestamp()::text),
        ADD "otp_hash" text,
        ADD "otp_expires_at" timestamptz,
        ADD "otp_attempts" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_shipments_tenant_public_token"
        ON "shipments" ("tenant_id", "public_token")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_driver_locations_tenant_recorded"
        ON "driver_locations" ("tenant_id", "recorded_at")
    `);

    await queryRunner.query(`
      CREATE FUNCTION lookup_public_shipment(
        p_tracking_number text,
        p_public_token text
      )
      RETURNS TABLE (shipment_id uuid, tenant_id uuid)
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $$
        SELECT s."id", s."tenant_id"
        FROM "shipments" s
        WHERE s."tracking_number" = p_tracking_number
          AND s."public_token" = p_public_token
      $$
    `);
    await queryRunner.query(
      `REVOKE ALL ON FUNCTION lookup_public_shipment(text, text) FROM PUBLIC`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "lookup_public_shipment"(text, text)`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_driver_locations_tenant_recorded"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_shipments_tenant_public_token"`,
    );
    await queryRunner.query(`
      ALTER TABLE "shipments"
        DROP COLUMN "otp_attempts",
        DROP COLUMN "otp_expires_at",
        DROP COLUMN "otp_hash",
        DROP COLUMN "public_token"
    `);
    await queryRunner.query(`DROP TABLE "proofs_of_delivery"`);
  }
}
