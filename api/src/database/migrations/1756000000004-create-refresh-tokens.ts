import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Opaque refresh tokens, stored hashed, with rotation on every use.
 *
 * A login or accept-invite creates the first token of a family (`family_id`).
 * Every refresh revokes the presented token and issues a successor in the same
 * family. Presenting an already-revoked token means the token was stolen and
 * replayed, so the whole family is revoked.
 *
 * `tenant_id` is nullable: a platform admin session may carry no tenant. The
 * table is global (like `users`); each row is bound to its user and can only
 * be used for that user, enforced in the application layer.
 */
export class CreateRefreshTokens1756000000004 implements MigrationInterface {
  name = 'CreateRefreshTokens1756000000004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL
          REFERENCES "users" ("id") ON DELETE CASCADE,
        "tenant_id" uuid
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "family_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "replaced_by" uuid
          REFERENCES "refresh_tokens" ("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_refresh_tokens_token_hash" UNIQUE ("token_hash")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens" ("family_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
