import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantIndex } from '../tenant-index.js';

/**
 * Memberships tie a global user to a tenant with a role. They are the first
 * tenant-scoped table, so this migration is also the first to apply the shared
 * isolation helper.
 *
 * The composite unique `(tenant_id, user_id)` prevents the same user being
 * added to a tenant twice, while still letting them exist in many tenants.
 */
export class CreateMemberships1756000000003 implements MigrationInterface {
  name = 'CreateMemberships1756000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "memberships" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL
          REFERENCES "users" ("id") ON DELETE CASCADE,
        "role" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_memberships_tenant_user" UNIQUE ("tenant_id", "user_id")
      )
    `);

    await createTenantIndex(queryRunner, 'memberships');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "memberships"`);
  }
}
