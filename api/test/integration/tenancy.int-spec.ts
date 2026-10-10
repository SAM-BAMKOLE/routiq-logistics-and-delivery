import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { TenantTransactionService } from '../../src/shared/tenancy/tenant-transaction.service.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import {
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

/**
 * Exercises the tenancy kernel against a real PostGIS database: the
 * `runWithTenant` transaction opens a real transaction, binds
 * `app.tenant_id`, and the setting disappears on commit and on rollback, so a
 * pooled connection can never leak a tenant into the next request.
 */
describe('Tenancy kernel (integration)', () => {
  let app: INestApplication;
  let transactions: TenantTransactionService;
  let owner: DataSource;

  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();
    [tenantA, tenantB] = await seedTenantsAndMemberships(owner);

    process.env.DATABASE_URL = readDatabaseState().appUrl;
    process.env.PLATFORM_ADMIN_API_KEY = 'integration-test-key';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        DatabaseModule,
        TenancyModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    transactions = app.get(TenantTransactionService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (owner?.isInitialized) {
      await owner.destroy();
    }
  });

  it('runs the callback in a transaction bound to that tenant', async () => {
    const rows = await transactions.runWithTenant(tenantA, async (manager) => {
      const setting = (await manager.query(
        `SELECT current_setting($1, true) AS value`,
        ['app.tenant_id'],
      )) as Array<{ value: string | null }>;

      expect(setting[0].value).toBe(tenantA);

      return manager.query(
        'SELECT tenant_id FROM memberships WHERE status = $1',
        ['active'],
      );
    });

    expect(rows).toEqual([{ tenant_id: tenantA }]);
  });

  it('different tenants are invisible to each other', async () => {
    const rows = await transactions.runWithTenant(tenantB, async (manager) =>
      manager.query('SELECT tenant_id FROM memberships'),
    );

    expect(rows).toEqual([{ tenant_id: tenantB }]);
  });

  it('returns nothing outside any tenant transaction', async () => {
    // The pooled manager has no transaction and no setting: RLS returns no
    // rows anywhere, the safe failure mode.
    await expect(transactions.manager.query('SELECT * FROM memberships')).resolves.toEqual(
      [],
    );
  });

  it('rolls back the whole transaction when the callback throws', async () => {
    const evilUser = (
      await owner.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id`,
        [`rollback-${randomUUID()}@example.com`],
      )
    )[0].id as string;

    await expect(
      transactions.runWithTenant(tenantA, async (manager) => {
        // A legitimate in-tenant write, undone because the callback throws.
        // (Cross-tenant writes are already rejected by the RLS policy itself,
        // so this deliberately stays inside the tenant.)
        await manager.query(
          `INSERT INTO memberships (tenant_id, user_id, role)
           VALUES ($1, $2, 'dispatcher')`,
          [tenantA, evilUser],
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The offending row must not exist despite the INSERT having run.
    const rows = (await owner.query(
      `SELECT count(*)::int AS count FROM memberships WHERE user_id = $1`,
      [evilUser],
    )) as Array<{ count: number }>;
    expect(rows[0].count).toBe(0);
  });

  it('leaves the pooled connection with no tenant setting after commit and rollback', async () => {
    await transactions.runWithTenant(tenantA, () => Promise.resolve());

    const rows = (await transactions.manager.query(
      `SELECT current_setting('app.tenant_id', true) AS value`,
    )) as Array<{ value: string | null }>;

    // `current_setting(..., true)` returns '' when unset. RLS treats that the
    // same as unset via `NULLIF(current_setting('app.tenant_id', true), '')`.
    expect(rows[0].value).toBe('');
  });
});

/**
 * Seeds two tenants, two users and one membership per tenant, and returns the
 * tenant ids. Runs as the owner so it can write without RLS interference.
 */
async function seedTenantsAndMemberships(
  owner: DataSource,
): Promise<[string, string]> {
  const tenantIds = (
    await owner.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
      ['Tenant A', `tenant-a-${randomUUID()}`, 'Tenant B', `tenant-b-${randomUUID()}`],
    )
  ) as Array<{ id: string }>;

  const [tenantA, tenantB] = tenantIds.map((row) => row.id);

  const userIds = (
    await owner.query(
      `INSERT INTO users (email) VALUES ($1), ($2) RETURNING id`,
      [`a-${randomUUID()}@example.com`, `b-${randomUUID()}@example.com`],
    )
  ) as Array<{ id: string }>;

  await owner.query(
    `INSERT INTO memberships (tenant_id, user_id, role)
     VALUES ($1, $2, 'tenant_admin'), ($3, $4, 'tenant_admin')`,
    [tenantA, userIds[0].id, tenantB, userIds[1].id],
  );

  return [tenantA, tenantB];
}