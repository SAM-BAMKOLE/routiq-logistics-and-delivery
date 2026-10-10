import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cross-tenant membership lookup for login.
 *
 * Login has no verified token yet, so it cannot set `app.tenant_id` — and
 * without that setting, RLS hides every `memberships` row from the runtime
 * role. This `SECURITY DEFINER` function runs as the table owner and returns
 * only the given user's rows (user, membership, and tenant status needed to
 * pick a tenant and issue tokens). The `user_id` parameter is typed `uuid`,
 * so there is no injection surface.
 *
 * Deployment note: `FORCE ROW LEVEL SECURITY` still applies to table owners,
 * so the function owner must bypass RLS (superuser or `BYPASSRLS`) for the
 * lookup to see rows. Locally and in tests the migration role is a superuser,
 * so this works out of the box; on hosted Postgres, ensure the function is
 * owned by a privileged role via the provider console after migrating.
 */
export class MembershipLookupFunction1756000000006
  implements MigrationInterface
{
  name = 'MembershipLookupFunction1756000000006';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION list_user_memberships(p_user_id uuid)
      RETURNS TABLE (
        membership_id uuid,
        tenant_id uuid,
        role text,
        status text,
        tenant_name text,
        tenant_slug text,
        tenant_status text
      )
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$
        SELECT m.id, m.tenant_id, m.role, m.status,
               t.name, t.slug, t.status
          FROM memberships AS m
          JOIN tenants AS t ON t.id = m.tenant_id
         WHERE m.user_id = p_user_id
      $$
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION list_user_memberships(uuid) FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION list_user_memberships(uuid) TO ldms_app
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS list_user_memberships(uuid)`);
  }
}
