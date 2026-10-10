import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { CustomersService } from '../../src/modules/customers/application/customers.service.js';
import { CustomersModule } from '../../src/modules/customers/customers.module.js';
import { DriversService } from '../../src/modules/drivers/application/drivers.service.js';
import { DriversModule } from '../../src/modules/drivers/drivers.module.js';
import { VehiclesService } from '../../src/modules/fleet/application/vehicles.service.js';
import { FleetModule } from '../../src/modules/fleet/fleet.module.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { TenantTransactionService } from '../../src/shared/tenancy/tenant-transaction.service.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import {
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

/**
 * Customers, fleet, and drivers against a real PostGIS database: geography
 * round-trips through the address repository, composite uniques hold per
 * tenant, cross-tenant reads stay empty under RLS, and the GiST index the
 * dispatch radius searches will need exists.
 */
describe('Operations modules (integration)', () => {
  let app: INestApplication;
  let transactions: TenantTransactionService;
  let customers: CustomersService;
  let vehicles: VehiclesService;
  let drivers: DriversService;
  let owner: DataSource;

  let tenantA: string;
  let tenantB: string;
  let membershipA: string;

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();

    const tenants = (await owner.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
      ['Ops A', `ops-a-${randomUUID()}`, 'Ops B', `ops-b-${randomUUID()}`],
    )) as Array<{ id: string }>;
    [tenantA, tenantB] = tenants.map((row) => row.id);

    const userRows = (await owner.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`ops-${randomUUID()}@example.com`],
    )) as Array<{ id: string }>;
    const membershipRows = (await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'tenant_admin') RETURNING id`,
      [tenantA, userRows[0].id],
    )) as Array<{ id: string }>;
    membershipA = membershipRows[0].id;

    process.env.DATABASE_URL = readDatabaseState().appUrl;
    process.env.JWT_ACCESS_SECRET = 'integration-test-access-secret-min-32-chars';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        DatabaseModule,
        TenancyModule,
        IdentityModule,
        CustomersModule,
        FleetModule,
        DriversModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    transactions = app.get(TenantTransactionService);
    customers = app.get(CustomersService);
    vehicles = app.get(VehiclesService);
    drivers = app.get(DriversService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (owner?.isInitialized) {
      await owner.destroy();
    }
  });

  it('round-trips addresses with PostGIS coordinates', async () => {
    const created = await transactions.runWithTenant(tenantA, async () => {
      const customer = await customers.createCustomer(tenantA, {
        name: 'Acme Warehousing',
      });
      return customers.createAddress(tenantA, customer.id, {
        line1: '14 Warehouse Road',
        city: 'Lagos',
        country: 'NG',
        latitude: 6.5244,
        longitude: 3.3792,
      });
    });

    expect(created.latitude).toBeCloseTo(6.5244, 4);
    expect(created.longitude).toBeCloseTo(3.3792, 4);

    const stored = (await owner.query(
      `SELECT ST_AsText("location") AS wkt FROM "addresses" WHERE "id" = $1`,
      [created.id],
    )) as Array<{ wkt: string }>;
    expect(stored[0].wkt).toContain('POINT');

    // Partial coordinate update keeps the stored axis.
    const updated = await transactions.runWithTenant(tenantA, () =>
      customers.updateAddress(tenantA, created.customerId, created.id, {
        latitude: 6.6,
      }),
    );
    expect(updated.latitude).toBeCloseTo(6.6, 4);
    expect(updated.longitude).toBeCloseTo(3.3792, 4);

    // No coordinates means a NULL geography, not a zero point.
    const bare = await transactions.runWithTenant(tenantA, () =>
      customers.createAddress(tenantA, created.customerId, {
        line1: 'No Coords Ave',
        city: 'Abuja',
        country: 'NG',
      }),
    );
    expect(bare.latitude).toBeNull();
    expect(bare.longitude).toBeNull();
  });

  it('indexes address locations with GiST for radius searches', async () => {
    const indexes = (await owner.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'addresses'`,
    )) as Array<{ indexname: string; indexdef: string }>;

    const gist = indexes.find((index) => index.indexname === 'idx_addresses_location');
    expect(gist?.indexdef).toContain('USING gist');
  });

  it('enforces plate uniqueness per tenant but not across tenants', async () => {
    await transactions.runWithTenant(tenantA, () =>
      vehicles.create({
        tenantId: tenantA,
        plate: 'KTU-1',
        type: 'van',
        capacityWeightKg: 1000,
        capacityVolumeM3: 10,
      }),
    );

    await expect(
      transactions.runWithTenant(tenantA, () =>
        vehicles.create({
          tenantId: tenantA,
          plate: 'KTU-1',
          type: 'truck',
          capacityWeightKg: 5000,
          capacityVolumeM3: 30,
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'VEHICLE_PLATE_TAKEN' } });

    const other = await transactions.runWithTenant(tenantB, () =>
      vehicles.create({
        tenantId: tenantB,
        plate: 'KTU-1',
        type: 'van',
        capacityWeightKg: 1000,
        capacityVolumeM3: 10,
      }),
    );
    expect(other.tenantId).toBe(tenantB);
  });

  it('links drivers to same-tenant memberships and vehicles', async () => {
    const vehicle = await transactions.runWithTenant(tenantA, () =>
      vehicles.create({
        tenantId: tenantA,
        plate: 'DRV-9',
        type: 'van',
        capacityWeightKg: 1000,
        capacityVolumeM3: 10,
      }),
    );

    const driver = await transactions.runWithTenant(tenantA, () =>
      drivers.createDriver(tenantA, {
        membershipId: membershipA,
        licenseNo: 'DL-OPS-1',
        currentVehicleId: vehicle.id,
      }),
    );
    expect(driver.currentVehicleId).toBe(vehicle.id);

    // A membership from another tenant reads as missing, never linked.
    const foreign = (await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, (SELECT id FROM users LIMIT 1), 'driver') RETURNING id`,
      [tenantB],
    )) as Array<{ id: string }>;
    await expect(
      transactions.runWithTenant(tenantA, () =>
        drivers.createDriver(tenantA, {
          membershipId: foreign[0].id,
          licenseNo: 'DL-OPS-2',
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'MEMBERSHIP_NOT_FOUND' } });

    // Duplicate profiles and licenses map to distinct codes.
    await expect(
      transactions.runWithTenant(tenantA, () =>
        drivers.createDriver(tenantA, {
          membershipId: membershipA,
          licenseNo: 'DL-OPS-9',
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'DRIVER_EXISTS' } });
  });

  it('rejects cross-tenant reads across every operations table', async () => {
    const customer = await transactions.runWithTenant(tenantA, () =>
      customers.createCustomer(tenantA, { name: 'Scoped' }),
    );

    // A tenant that owns nothing must see nothing, and tenant A's rows must
    // stay invisible through both RLS and the explicit checks.
    const fresh = (
      await owner.query(
        `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
        ['Ops Fresh', `ops-fresh-${randomUUID()}`],
      )
    )[0].id as string;

    await transactions.runWithTenant(fresh, async () => {
      expect(await customers.listCustomers(fresh)).toEqual([]);
      expect(await vehicles.list(fresh)).toEqual([]);
      expect(await drivers.listDrivers(fresh)).toEqual([]);
      await expect(customers.getCustomer(fresh, customer.id)).rejects.toMatchObject(
        {
          response: { code: 'CUSTOMER_NOT_FOUND' },
        },
      );
    });
  });

  it('cascades customer deletion to addresses', async () => {
    const customer = await transactions.runWithTenant(tenantA, () =>
      customers.createCustomer(tenantA, { name: 'Doomed' }),
    );
    await transactions.runWithTenant(tenantA, () =>
      customers.createAddress(tenantA, customer.id, {
        line1: '1 Gone Street',
        city: 'Lagos',
        country: 'NG',
      }),
    );

    await transactions.runWithTenant(tenantA, () =>
      customers.removeCustomer(tenantA, customer.id),
    );

    const leftover = (await owner.query(
      `SELECT count(*)::int AS count FROM "addresses" WHERE "customer_id" = $1`,
      [customer.id],
    )) as Array<{ count: number }>;
    expect(leftover[0].count).toBe(0);
  });
});
