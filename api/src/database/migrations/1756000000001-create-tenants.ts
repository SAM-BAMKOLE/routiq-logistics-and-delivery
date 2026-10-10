import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tenant registry: the root of the tenancy model.
 *
 * `tenants` is a global table (it is not tenant-scoped, so it carries no RLS
 * policy). Every tenant-owned table added from here on references `tenants.id`
 * and is isolated with {@link enableTenantIsolation}.
 */
export class CreateTenants1756000000001 implements MigrationInterface {
  name = 'CreateTenants1756000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "plan" text NOT NULL DEFAULT 'free',
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_tenants_slug" UNIQUE ("slug")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tenants"`);
  }
}
