import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantIndex } from '../tenant-index.js';

/**
 * Driver profiles plus their shifts.
 *
 * A driver profile hangs off a membership (`membership_id`), so deactivating
 * the membership cascades naturally and a profile can never point across
 * tenants unnoticed: both uniqueness scopes lead with `tenant_id`.
 * `current_vehicle_id` is `ON DELETE SET NULL` — retiring a vehicle must not
 * delete the driver. `availability` is the driver's manual flag; shifts drive
 * computed availability later in dispatch.
 */
export class CreateDrivers1756000000009 implements MigrationInterface {
  name = 'CreateDrivers1756000000009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "drivers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "membership_id" uuid NOT NULL
          REFERENCES "memberships" ("id") ON DELETE CASCADE,
        "license_no" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "availability" text NOT NULL DEFAULT 'available',
        "current_vehicle_id" uuid
          REFERENCES "vehicles" ("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_drivers_tenant_membership" UNIQUE ("tenant_id", "membership_id"),
        CONSTRAINT "uq_drivers_tenant_license" UNIQUE ("tenant_id", "license_no")
      )
    `);
    await createTenantIndex(queryRunner, 'drivers');

    await queryRunner.query(`
      CREATE TABLE "driver_shifts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "driver_id" uuid NOT NULL
          REFERENCES "drivers" ("id") ON DELETE CASCADE,
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_driver_shifts_driver_id" ON "driver_shifts" ("driver_id")
    `);
    await createTenantIndex(queryRunner, 'driver_shifts');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "driver_shifts"`);
    await queryRunner.query(`DROP TABLE "drivers"`);
  }
}
