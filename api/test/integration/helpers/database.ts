import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../../src/database/database.options.js';
import { readDatabaseState } from './state.js';

/** The restricted runtime role the application connects as. */
const APP_ROLE = 'ldms_app';

/**
 * Creates the runtime role and grants it DML on everything the owner creates.
 * Runs as the container superuser (the table owner), mirroring the
 * `docker/initdb` script used for local development. Idempotent.
 */
async function provisionRuntimeRole(dataSource: DataSource): Promise<void> {
  const statements = [
    `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
           CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE}';
         END IF;
       END
     $$;`,
    `DO $$
       BEGIN
         EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${APP_ROLE}', current_database());
       END
     $$;`,
    `GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`,
  ];

  for (const sql of statements) {
    await dataSource.query(sql);
  }
}

/**
 * Applies the schema exactly once per test run. The first suite to call it
 * provisions the runtime role (before migrations, so default privileges cover
 * the new tables) and runs the migrations; later suites detect the schema and
 * return immediately.
 */
export async function ensureSchema(): Promise<void> {
  const { ownerUrl } = readDatabaseState();

  const dataSource = new DataSource(buildDataSourceOptions(ownerUrl));
  await dataSource.initialize();
  try {
    const [{ tenants }] = (await dataSource.query(
      `SELECT to_regclass('public.tenants') AS tenants`,
    )) as Array<{ tenants: string | null }>;
    if (tenants) {
      return;
    }

    await provisionRuntimeRole(dataSource);
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}

/** Connects as the table owner (bypasses RLS, may run DDL). */
export async function createOwnerDataSource(): Promise<DataSource> {
  const { ownerUrl } = readDatabaseState();
  const dataSource = new DataSource({ type: 'postgres', url: ownerUrl });
  await dataSource.initialize();
  return dataSource;
}

/** Connects as the restricted runtime role (`ldms_app`). */
export async function createAppDataSource(): Promise<DataSource> {
  const { appUrl } = readDatabaseState();
  const dataSource = new DataSource({ type: 'postgres', url: appUrl });
  await dataSource.initialize();
  return dataSource;
}
