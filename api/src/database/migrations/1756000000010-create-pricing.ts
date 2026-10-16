import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantIndex } from '../tenant-index.js';

/**
 * Tenant rate cards. Money is integer minor units (kobo, cents) so no
 * rounding ever happens on stored values; the quote engine evaluates the
 * rules by `priority` and only rules whose `active_from` has passed apply.
 */
export class CreatePricing1756000000010 implements MigrationInterface {
  name = 'CreatePricing1756000000010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pricing_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "base_fee_minor" integer NOT NULL DEFAULT 0,
        "per_km_minor" integer NOT NULL DEFAULT 0,
        "per_kg_minor" integer NOT NULL DEFAULT 0,
        "min_fee_minor" integer NOT NULL DEFAULT 0,
        "priority" integer NOT NULL DEFAULT 0,
        "active_from" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pricing_rules_tenant_priority"
        ON "pricing_rules" ("tenant_id", "priority")
    `);
    await createTenantIndex(queryRunner, 'pricing_rules');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "pricing_rules"`);
  }
}
