import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { TenantContextService } from '../../src/shared/tenancy/tenant-context.service.js';
import { TenantTransactionService } from '../../src/shared/tenancy/tenant-transaction.service.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import {
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

/**
 * Exercises the tenancy kernel against a real PostGIS database: `runWithTenant`
 * opens a real transaction, publishes the tenant in the request context for its
 * duration, and discards the context afterwards. A write commits with the
 * transaction or rolls back with it, so a request's changes are all-or-nothing.
 */
describe('Tenancy kernel (integration)', () => {
  let app: INestApplication;
  let transactions: TenantTransactionService;
  let context: TenantContextService;
  let owner: DataSource;

  let tenantA: string;

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();
    [tenantA] = await seedTenantsAndMemberships(owner);

    process.env.DATABASE_URL = readDatabaseState().appUrl;
    process.env.JWT_ACCESS_SECRET = 'integration-test-access-secret-min-32-chars';

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
    context = app.get(TenantContextService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (owner?.isInitialized) {
      await owner.destroy();
    }
  });

  it('publishes the tenant in context for the duration of the transaction', async () => {
    const observed = await transactions.runWithTenant(tenantA, async () => {
      expect(context.getTenantId()).toBe(tenantA);
      return 'ok';
    });

    expect(observed).toBe('ok');
  });

  it('discards the tenant context once the transaction returns', async () => {
    await transactions.runWithTenant(tenantA, () => Promise.resolve());

    expect(context.getTenantId()).toBeUndefined();
  });

  it('runs every write in the transaction on the same manager', async () => {
    const userId = (
      await owner.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [
        `commit-${randomUUID()}@example.com`,
      ])
    )[0].id as string;

    await transactions.runWithTenant(tenantA, async (manager) => {
      await manager.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         VALUES ($1, $2, 'dispatcher')`,
        [tenantA, userId],
      );
    });

    const rows = (await owner.query(
      `SELECT tenant_id FROM memberships WHERE user_id = $1`,
      [userId],
    )) as Array<{ tenant_id: string }>;
    expect(rows).toEqual([{ tenant_id: tenantA }]);
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
        // A legitimate write, undone because the callback throws.
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
});

/**
 * Seeds two tenants, two users and one membership per tenant, and returns the
 * tenant ids.
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