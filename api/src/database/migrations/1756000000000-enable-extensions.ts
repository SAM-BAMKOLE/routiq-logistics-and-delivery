import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Installs the database extensions the schema depends on.
 *
 * `uuid-ossp` backs `uuid_generate_v4()` for UUID primary keys; PostGIS backs
 * the geography/geometry columns used for routing and tracking.
 *
 * The migration is idempotent: `IF NOT EXISTS` means it is safe on databases
 * where the extensions were already provisioned out of band (e.g. a managed
 * provider that requires enabling them from a console first).
 */
export class EnableExtensions1756000000000 implements MigrationInterface {
  name = 'EnableExtensions1756000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
  }

  async down(): Promise<void> {
    // Extensions are shared, cluster-level infrastructure and may be used by
    // objects outside this migration. Reverting deliberately leaves them in
    // place rather than risk breaking unrelated objects.
  }
}
