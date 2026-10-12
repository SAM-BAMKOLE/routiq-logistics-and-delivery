import { DataSource } from 'typeorm';
import { createOwnerDataSource, ensureSchema } from './helpers/database.js';

/**
 * Verifies the migration pipeline against a real PostGIS database: extensions
 * are installed, the first table lands with snake_case columns, the applied set
 * is recorded, and re-running is a no-op.
 */
describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    await ensureSchema();
    dataSource = await createOwnerDataSource();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('installs the uuid-ossp and postgis extensions', async () => {
    const rows = (await dataSource.query(
      `SELECT extname
         FROM pg_extension
        WHERE extname IN ('uuid-ossp', 'postgis')
        ORDER BY extname`,
    )) as Array<{ extname: string }>;

    expect(rows.map((row) => row.extname)).toEqual(['postgis', 'uuid-ossp']);
  });

  it('creates the tenants table with snake_case columns', async () => {
    const rows = (await dataSource.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenants'
        ORDER BY column_name`,
    )) as Array<{ column_name: string }>;

    expect(rows.map((row) => row.column_name)).toEqual([
      'created_at',
      'id',
      'name',
      'plan',
      'settings',
      'slug',
      'status',
      'updated_at',
    ]);
  });

  it('records the applied migrations in order', async () => {
    const rows = (await dataSource.query(
      `SELECT name FROM migrations ORDER BY timestamp`,
    )) as Array<{ name: string }>;

    expect(rows.map((row) => row.name)).toEqual([
      'EnableExtensions1756000000000',
      'CreateTenants1756000000001',
      'CreateUsers1756000000002',
      'CreateMemberships1756000000003',
      'CreateRefreshTokens1756000000004',
      'CreateAuthTokens1756000000005',
      'MembershipLookupFunction1756000000006',
      'CreateCustomers1756000000007',
      'CreateFleet1756000000008',
      'CreateDrivers1756000000009',
      'CreatePricing1756000000010',
      'CreateShipments1756000000011',
      'CreateEmailLog1756000000012',
      'CreateDispatch1756000000013',
      'CreateRoutes1756000000014',
      'CreateTrackingPod1756000000015',
    ]);
  });

  it('is idempotent: re-running finds nothing pending', async () => {
    const executed = await dataSource.runMigrations();
    expect(executed).toHaveLength(0);
  });
});
