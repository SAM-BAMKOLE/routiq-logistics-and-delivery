import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Global users. A person is platform-wide; which tenants they can act in is
 * expressed by `memberships`, not by this table, so a user may belong to
 * several tenants and hold a different role in each.
 *
 * `email` is stored lowercase by the application and is unique, so the same
 * address cannot register twice. `password_hash` is nullable to allow
 * invitation-only users who have not set a password yet.
 */
export class CreateUsers1756000000002 implements MigrationInterface {
  name = 'CreateUsers1756000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" text NOT NULL,
        "password_hash" text,
        "name" text,
        "is_platform_admin" boolean NOT NULL DEFAULT false,
        "email_verified_at" timestamptz,
        "status" text NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
