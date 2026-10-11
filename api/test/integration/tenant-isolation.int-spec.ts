import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  createAppDataSource,
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';

/**
 * The isolation guarantee across the whole schema.
 *
 * - A schema-level guard proves that *every* table carrying a `tenant_id`
 *   column is either RLS-isolated or explicitly classified global (with the
 *   reason recorded) — so a future table cannot silently be added without
 *   isolation.
 * - Behavioral checks prove the claim from the architecture doc: seed two
 *   tenants, deliberately run an unfiltered `SELECT` under tenant A, and
 *   assert that no tenant B row appears — through the restricted `ldms_app`
 *   role.
 */

/**
 * Global tables that reference a tenant without being tenant-scoped. Each
 * entry is a deliberate exception to the isolation rule, reviewed here rather
 * than scattered through migrations.
 */
// Deliberate exceptions: tables that carry a tenant reference but stay
// global. `refresh_tokens` because platform sessions carry no tenant;
// `email_log` because a password reset is logged before any tenant context
// exists. Both have no cross-tenant read API — rows are bound by the
// application layer (user, dedupe key).
const GLOBAL_TABLES_WITH_TENANT_REF = ['refresh_tokens', 'email_log'];
describe('Tenant isolation across the schema (integration)', () => {
  let owner: DataSource;
  let app: DataSource;

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();
    app = await createAppDataSource();
    await seedTwoTenants(owner);
  });

  afterAll(async () => {
    if (owner?.isInitialized) {
      await owner.destroy();
    }
    if (app?.isInitialized) {
      await app.destroy();
    }
  });

  it('isolates every table that has a tenant_id column', async () => {
    const tenantTables = (await owner.query(`
      SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN information_schema.columns col
          ON col.table_schema = n.nspname
         AND col.table_name = c.relname
         AND col.column_name = 'tenant_id'
       WHERE n.nspname = 'public' AND c.relkind = 'r'
    `)) as Array<{ table_name: string }>;

    expect(tenantTables.length).toBeGreaterThan(0);

    for (const { table_name } of tenantTables) {
      if (GLOBAL_TABLES_WITH_TENANT_REF.includes(table_name)) {
        // Deliberately global — see the constant's comment. Rows are bound
        // to their owning user or dedupe key in the application layer.
        const [flags] = (await owner.query(
          `SELECT relrowsecurity AS rls FROM pg_class WHERE relname = $1`,
          [table_name],
        )) as Array<{ rls: boolean }>;
        expect(flags.rls).toBe(false);
        continue;
      }

      const [flags] = (await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity
           FROM pg_class WHERE relname = $1`,
        [table_name],
      )) as Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>;

      expect(`${table_name} rls`).toBeDefined();
      expect(flags.relrowsecurity).toBe(true);
      expect(flags.relforcerowsecurity).toBe(true);

      const policies = (await owner.query(
        `SELECT policyname FROM pg_policies
          WHERE schemaname = 'public' AND tablename = $1`,
        [table_name],
      )) as Array<{ policyname: string }>;

      expect(policies.map((policy) => policy.policyname)).toContain(
        'tenant_isolation',
      );
    }
  });

  it('leaves global tables (tenants, users) outside the isolated set', async () => {
    const result = (await app.query(
      `SELECT count(*)::int AS count FROM tenants`,
    )) as Array<{ count: number }>;

    // Both seeded tenants are visible to everyone; access to them is governed
    // by application authorization, not by RLS. (Other suites seed tenants in
    // the shared schema, so only a lower bound is asserted.)
    expect(result[0].count).toBeGreaterThanOrEqual(2);
  });

  it('returns no rows when the app queries without a tenant context', async () => {
    const rows = (await app.query('SELECT * FROM memberships')) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('runs an unfiltered SELECT under tenant A and finds no tenant B row', async () => {
    const rows = (await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      // Deliberately unfiltered: only RLS can keep tenant B out.
      return manager.query('SELECT tenant_id, user_id, role FROM memberships');
    })) as Array<{ tenant_id: string; user_id: string; role: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(TENANT_A);
    expect(rows[0].role).toBe('tenant_admin');
  });

  it('rejects a write whose tenant_id belongs to another tenant', async () => {
    await expect(
      app.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          TENANT_A,
        ]);
        await manager.query(
          `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'driver')`,
          [TENANT_B, randomUUID()],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

async function seedTwoTenants(owner: DataSource): Promise<void> {
  await owner.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)`,
    [
      TENANT_A,
      'Isolation Tenant A',
      `isolation-a-${TENANT_A}`,
      TENANT_B,
      'Isolation Tenant B',
      `isolation-b-${TENANT_B}`,
    ],
  );

  const users = (await owner.query(
    `INSERT INTO users (email) VALUES ($1), ($2) RETURNING id`,
    [`iso-a-${randomUUID()}@example.com`, `iso-b-${randomUUID()}@example.com`],
  )) as Array<{ id: string }>;

  await owner.query(
    `INSERT INTO memberships (tenant_id, user_id, role)
     VALUES ($1, $2, 'tenant_admin'), ($3, $4, 'tenant_admin')`,
    [TENANT_A, users[0].id, TENANT_B, users[1].id],
  );
}