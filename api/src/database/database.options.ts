import type { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from './naming.strategy.js';
import { EnableExtensions1756000000000 } from './migrations/1756000000000-enable-extensions.js';
import { CreateTenants1756000000001 } from './migrations/1756000000001-create-tenants.js';
import { CreateUsers1756000000002 } from './migrations/1756000000002-create-users.js';
import { CreateMemberships1756000000003 } from './migrations/1756000000003-create-memberships.js';
import { CreateRefreshTokens1756000000004 } from './migrations/1756000000004-create-refresh-tokens.js';
import { CreateAuthTokens1756000000005 } from './migrations/1756000000005-create-auth-tokens.js';
import { MembershipLookupFunction1756000000006 } from './migrations/1756000000006-membership-lookup-function.js';
import { CreateCustomers1756000000007 } from './migrations/1756000000007-create-customers.js';
import { CreateFleet1756000000008 } from './migrations/1756000000008-create-fleet.js';
import { CreateDrivers1756000000009 } from './migrations/1756000000009-create-drivers.js';
import { CreatePricing1756000000010 } from './migrations/1756000000010-create-pricing.js';
import { CreateShipments1756000000011 } from './migrations/1756000000011-create-shipments.js';

/**
 * Migrations are listed explicitly rather than loaded from a filesystem glob.
 * Under ESM there is no reliable `__dirname`, and an explicit list makes the
 * applied order obvious and reviewable.
 */
export const migrations = [
  EnableExtensions1756000000000,
  CreateTenants1756000000001,
  CreateUsers1756000000002,
  CreateMemberships1756000000003,
  CreateRefreshTokens1756000000004,
  CreateAuthTokens1756000000005,
  MembershipLookupFunction1756000000006,
  CreateCustomers1756000000007,
  CreateFleet1756000000008,
  CreateDrivers1756000000009,
  CreatePricing1756000000010,
  CreateShipments1756000000011,
];

/**
 * Builds the TypeORM options used by the migration CLI and the integration
 * test harness. `synchronize` is permanently off: the schema is owned by
 * migrations only, so a running app can never reshape the database.
 */
export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    namingStrategy: new SnakeNamingStrategy(),
    entities: [],
    migrations,
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
    synchronize: false,
    logging: ['error', 'warn', 'migration'],
  };
}
