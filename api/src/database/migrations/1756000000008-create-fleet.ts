import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantIsolation } from '../rls.js';

/**
 * Fleet vehicles. Plates are unique per tenant (two tenants may run the same
 * plate; one tenant may not register it twice). Capacities are
 * `double precision`: kilograms and cubic meters are routinely fractional,
 * and float precision is ample for capacity planning.
 */
export class CreateFleet1756000000008 implements MigrationInterface {
  name = 'CreateFleet1756000000008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vehicles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "plate" text NOT NULL,
        "type" text NOT NULL,
        "capacity_weight_kg" double precision NOT NULL,
        "capacity_volume_m3" double precision NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_vehicles_tenant_plate" UNIQUE ("tenant_id", "plate")
      )
    `);
    await enableTenantIsolation(queryRunner, 'vehicles');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "vehicles"`);
  }
}
