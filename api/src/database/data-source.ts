import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.options.js';

loadEnv({ quiet: true });

const url = process.env.MIGRATION_DATABASE_URL?.trim();
if (!url) {
  throw new Error(
    'MIGRATION_DATABASE_URL must be set to run migrations (see .env.example). ' +
      'On Neon it is the direct (non-pooler) connection string; on a local ' +
      'database it can be the same URL as DATABASE_URL.',
  );
}

/**
 * Data source for the TypeORM CLI (`migration:run`, `migration:revert`, ...).
 *
 * It connects with `MIGRATION_DATABASE_URL` and may run DDL. The application
 * never imports this file; it connects with `DATABASE_URL` at runtime. Both use
 * the same role — isolation is enforced by the repositories, not the database —
 * but migrations require a direct connection because DDL through a pooler is
 * unreliable.
 *
 * Exported as the sole default export: TypeORM's CLI loader rejects a data
 * source module that exposes more than one DataSource instance.
 */
export default new DataSource(buildDataSourceOptions(url));
