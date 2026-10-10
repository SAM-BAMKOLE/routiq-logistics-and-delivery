import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { enableTenantIsolation } from '../../src/database/rls.js';
import {
  createAppDataSource,
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';

/**
 * Proves tenant isolation end to end: a table isolated with
 * {@link enableTenantIsolation} reveals nothing across tenants, denies
 * cross-tenant writes, and returns nothing when no tenant context is set —
 * all exercised through the restricted `ldms_app` role, not the owner.
 */
describe('Row Level Security (integration)', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  let owner: DataSource;
  let app: DataSource;

  beforeAll(async () => {
    await ensureSchema();

    owner = await createOwnerDataSource();
    app = await createAppDataSource();

    await owner.query(`
      CREATE TABLE rls_probe (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        label text NOT NULL
      )
    `);

    const runner = owner.createQueryRunner();
    try {
      await enableTenantIsolation(runner, 'rls_probe');
    } finally {
      await runner.release();
    }

    await owner.query(
      `INSERT INTO rls_probe (tenant_id, label) VALUES ($1, 'a'), ($2, 'b')`,
      [tenantA, tenantB],
    );
  });

  afterAll(async () => {
    if (owner?.isInitialized) {
      await owner.query('DROP TABLE IF EXISTS rls_probe');
      await owner.destroy();
    }
    if (app?.isInitialized) {
      await app.destroy();
    }
  });

  it('runs as a role that cannot bypass RLS', async () => {
    const [role] = (await app.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    )) as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;

    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it.each([
    ['tenant A', () => tenantA],
    ['tenant B', () => tenantB],
  ])('only exposes %s rows when that tenant is active', async (_label, get) => {
    const rows = (await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        get(),
      ]);
      return manager.query('SELECT tenant_id, label FROM rls_probe');
    })) as Array<{ tenant_id: string; label: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(get());
  });

  it('returns no rows when no tenant context is set', async () => {
    const rows = await app.query('SELECT * FROM rls_probe');
    expect(rows).toHaveLength(0);
  });

  it('rejects a write that targets a different tenant', async () => {
    await expect(
      app.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantA,
        ]);
        await manager.query(
          `INSERT INTO rls_probe (tenant_id, label) VALUES ($1, 'evil')`,
          [tenantB],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot delete rows owned by another tenant', async () => {
    // TypeORM returns [rows, affectedCount] for DELETE/UPDATE.
    const [deleted] = (await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantA,
      ]);
      return manager.query(
        `DELETE FROM rls_probe WHERE tenant_id = $1 RETURNING id`,
        [tenantB],
      );
    })) as [Array<{ id: string }>, number];

    expect(deleted).toHaveLength(0);
  });
});
