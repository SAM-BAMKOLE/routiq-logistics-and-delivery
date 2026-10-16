import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../../src/database/database.options.js';
import { readDatabaseState } from './state.js';

/**
 * Applies the schema exactly once per test run. The first suite to call it runs
 * the migrations; later suites detect the schema and return immediately.
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

    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}

/** Connects as the schema owner (may run DDL). */
export async function createOwnerDataSource(): Promise<DataSource> {
  const { ownerUrl } = readDatabaseState();
  const dataSource = new DataSource({ type: 'postgres', url: ownerUrl });
  await dataSource.initialize();
  return dataSource;
}

/**
 * Connects as the application would. The deployment uses a single database
 * role, so this is the same connection as {@link createOwnerDataSource}; it is
 * kept distinct so tests can express "what the app sees" without implying a
 * second role exists.
 */
export async function createAppDataSource(): Promise<DataSource> {
  const { appUrl } = readDatabaseState();
  const dataSource = new DataSource({ type: 'postgres', url: appUrl });
  await dataSource.initialize();
  return dataSource;
}
