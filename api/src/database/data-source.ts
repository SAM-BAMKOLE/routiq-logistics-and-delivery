import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.options.js';

loadEnv({ quiet: true });

const url = process.env.MIGRATION_DATABASE_URL?.trim();
if (!url) {
  throw new Error(
    'MIGRATION_DATABASE_URL must be set to run migrations (see .env.example). ' +
      'It connects as the table owner; the application itself connects as the ' +
      'restricted runtime role via DATABASE_URL.',
  );
}

/**
 * Data source for the TypeORM CLI (`migration:run`, `migration:revert`, ...).
 *
 * It connects with `MIGRATION_DATABASE_URL`, i.e. as `ldms_owner` — the role
 * that owns the tables and may run DDL. The application never imports this
 * file; it connects with `DATABASE_URL` as `ldms_app` at runtime.
 *
 * Exported as the sole default export: TypeORM's CLI loader rejects a data
 * source module that exposes more than one DataSource instance.
 */
export default new DataSource(buildDataSourceOptions(url));
