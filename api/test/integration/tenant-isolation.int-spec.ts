import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { TypeOrmCustomerRepository } from '../../src/modules/customers/infrastructure/typeorm-customer.repository.js';
import { TypeOrmVehicleRepository } from '../../src/modules/fleet/infrastructure/typeorm-vehicle.repository.js';
import { TypeOrmMembershipRepository } from '../../src/modules/identity/infrastructure/typeorm-membership.repository.js';
import type { TenantContextService } from '../../src/shared/tenancy/tenant-context.service.js';
import { createOwnerDataSource, ensureSchema } from './helpers/database.js';

/**
 * The isolation guarantee, asserted against the mechanism that actually
 * provides it: the repositories.
 *
 * Tenant isolation lives in the application layer — every query is scoped to
 * the active tenant — so these tests drive the repositories with a switchable
 * tenant context and prove that a row from another tenant is invisible, while
 * the owning tenant still sees its own. A schema guard also pins the design
 * decision: no table is RLS-isolated any more.
 */

/** A tenant context whose active tenant the test can switch at will. */
class SwitchableTenantContext {
  tenantId: string | undefined;

  getTenantId(): string | undefined {
    return this.tenantId;
  }

  scope(): { tenantId?: string } {
    return this.tenantId === undefined ? {} : { tenantId: this.tenantId };
  }
}

describe('Tenant isolation in the repositories (integration)', () => {
  let owner: DataSource;
  let context: SwitchableTenantContext;
  let memberships: TypeOrmMembershipRepository;
  let vehicles: TypeOrmVehicleRepository;
  let customers: TypeOrmCustomerRepository;

  let tenantA: string;
  let tenantB: string;
  let membershipB: string;
  let vehicleAId: string;
  let vehicleBId: string;
  let customerAId: string;
  let customerBId: string;

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();
    [tenantA, tenantB] = await seedTenants(owner);

    context = new SwitchableTenantContext();
    const txHost = {
      tx: owner.manager,
    } as unknown as TransactionHost<TransactionalAdapterTypeOrm>;
    const tenants = context as unknown as TenantContextService;

    memberships = new TypeOrmMembershipRepository(txHost, tenants);
    vehicles = new TypeOrmVehicleRepository(txHost, tenants);
    customers = new TypeOrmCustomerRepository(txHost, tenants);

    const userB = await seedUser(owner);
    membershipB = (
      await memberships.create({ tenantId: tenantB, userId: userB, role: 'dispatcher' })
    ).id;

    vehicleAId = (
      await vehicles.create({
        tenantId: tenantA,
        plate: `A-${randomUUID().slice(0, 8)}`,
        type: 'van',
        capacityWeightKg: 1000,
        capacityVolumeM3: 12,
      })
    ).id;
    vehicleBId = (
      await vehicles.create({
        tenantId: tenantB,
        plate: `B-${randomUUID().slice(0, 8)}`,
        type: 'van',
        capacityWeightKg: 1000,
        capacityVolumeM3: 12,
      })
    ).id;

    customerAId = (await customers.create({ tenantId: tenantA, name: 'A Customer' })).id;
    customerBId = (await customers.create({ tenantId: tenantB, name: 'B Customer' })).id;
  });

  afterAll(async () => {
    if (owner?.isInitialized) {
      await owner.destroy();
    }
  });

  it('keeps another tenant’s rows invisible to reads by id', async () => {
    context.tenantId = tenantA;

    await expect(memberships.findById(membershipB)).resolves.toBeNull();
    await expect(vehicles.findById(vehicleBId)).resolves.toBeNull();
    await expect(customers.findById(customerBId)).resolves.toBeNull();
  });

  it('still returns the active tenant’s own rows', async () => {
    context.tenantId = tenantA;

    await expect(vehicles.findById(vehicleAId)).resolves.not.toBeNull();
    await expect(customers.findById(customerAId)).resolves.not.toBeNull();
  });

  it('refuses to delete another tenant’s row', async () => {
    context.tenantId = tenantA;

    await expect(customers.remove(customerBId)).resolves.toBe(false);
    await expect(customers.findById(customerBId)).resolves.toBeNull();
  });

  it('treats an empty context as unfiltered (login and platform paths)', async () => {
    context.tenantId = undefined;

    // With no tenant active there is nothing to scope to; the documented
    // behavior is an unfiltered read. Callers must not reach these paths with
    // a tenant-scoped route, which the guards guarantee.
    await expect(vehicles.findById(vehicleBId)).resolves.not.toBeNull();
  });

  it('leaves no table under Row Level Security', async () => {
    const rlsTables = (await owner.query(`
      SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    `)) as Array<{ table_name: string }>;

    expect(rlsTables).toEqual([]);
  });
});

async function seedTenants(owner: DataSource): Promise<[string, string]> {
  const rows = (await owner.query(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
    [
      'Isolation Tenant A',
      `isolation-a-${randomUUID()}`,
      'Isolation Tenant B',
      `isolation-b-${randomUUID()}`,
    ],
  )) as Array<{ id: string }>;
  return [rows[0].id, rows[1].id];
}

async function seedUser(owner: DataSource): Promise<string> {
  const rows = (await owner.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`iso-${randomUUID()}@example.com`],
  )) as Array<{ id: string }>;
  return rows[0].id;
}
