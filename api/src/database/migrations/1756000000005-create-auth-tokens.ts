import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Single-use tokens for invitations (email verification and password reset
 * follow the same shape in a later step): stored hashed, expiring, and marked
 * used on acceptance so they cannot be replayed.
 *
 * `metadata` carries the token's business context — for an invitation, the
 * tenant and role being offered — so acceptance needs no extra lookup.
 * The table is global; rows are bound to their user in the application layer.
 */
export class CreateAuthTokens1756000000005 implements MigrationInterface {
  name = 'CreateAuthTokens1756000000005';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL
          REFERENCES "users" ("id") ON DELETE CASCADE,
        "purpose" text NOT NULL,
        "token_hash" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_auth_tokens_token_hash" UNIQUE ("token_hash")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_auth_tokens_user_id" ON "auth_tokens" ("user_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth_tokens"`);
  }
}
