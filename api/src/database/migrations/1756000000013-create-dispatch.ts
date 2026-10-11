import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantIsolation } from '../rls.js';

/**
 * Dispatch: the assignment lifecycle table, the driver position table that
 * candidate proximity ranks on, and the shipment columns that record who is
 * currently driving.
 *
 * - `dispatch_assignments` is the negotiation record: an offer to a driver and
 *   how it ended (accepted, rejected, expired, cancelled). The three partial
 *   unique indexes are the concurrency guard two dispatch runs race through:
 *   one live offer/acceptance per shipment, per driver, and per vehicle, so a
 *   concurrent double offer loses with a `23505` instead of silently
 *   double-booking anyone. That is the in-transaction answer to the saga's
 *   `FOR UPDATE SKIP LOCKED` claim, which arrives with the offer timeout job
 *   in phase 2.
 * - `driver_locations` holds positions pushed by drivers. The write path is
 *   Step 10's (tracking); dispatch reads the newest row per driver through the
 *   `(tenant_id, driver_id, recorded_at DESC)` btree, and proximity uses the
 *   GiST index behind `ST_DWithin`.
 * - `shipments.driver_id` / `vehicle_id` record who drives a shipment right
 *   now: driver-scoped shipment reads check this row, which keeps dispatch a
 *   one-way dependency (dispatch -> shipments) instead of a module cycle. The
 *   `assign` transition sets the columns and `release` (ASSIGNED ->
 *   CONFIRMED) clears them again. The driver reference is ON DELETE RESTRICT —
 *   a driver with live shipments cannot be deleted — while the vehicle is
 *   ON DELETE SET NULL so retiring a truck never blocks anything.
 */
export class CreateDispatch1756000000013 implements MigrationInterface {
  name = 'CreateDispatch1756000000013';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipments"
        ADD COLUMN "driver_id" uuid
          REFERENCES "drivers" ("id") ON DELETE RESTRICT,
        ADD COLUMN "vehicle_id" uuid
          REFERENCES "vehicles" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipments_tenant_driver"
        ON "shipments" ("tenant_id", "driver_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "dispatch_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "shipment_id" uuid NOT NULL
          REFERENCES "shipments" ("id") ON DELETE CASCADE,
        "driver_id" uuid NOT NULL
          REFERENCES "drivers" ("id") ON DELETE CASCADE,
        "vehicle_id" uuid
          REFERENCES "vehicles" ("id") ON DELETE SET NULL,
        "status" text NOT NULL DEFAULT 'offered',
        "offered_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "responded_at" timestamptz,
        "reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_dispatch_assignments_tenant_shipment"
        ON "dispatch_assignments" ("tenant_id", "shipment_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_dispatch_assignments_tenant_driver"
        ON "dispatch_assignments" ("tenant_id", "driver_id", "status")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_dispatch_assignments_active_shipment"
        ON "dispatch_assignments" ("shipment_id")
        WHERE "status" IN ('offered', 'accepted')
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_dispatch_assignments_active_driver"
        ON "dispatch_assignments" ("driver_id")
        WHERE "status" IN ('offered', 'accepted')
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_dispatch_assignments_active_vehicle"
        ON "dispatch_assignments" ("vehicle_id")
        WHERE "status" IN ('offered', 'accepted') AND "vehicle_id" IS NOT NULL
    `);
    await enableTenantIsolation(queryRunner, 'dispatch_assignments');

    await queryRunner.query(`
      CREATE TABLE "driver_locations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "driver_id" uuid NOT NULL
          REFERENCES "drivers" ("id") ON DELETE CASCADE,
        "recorded_at" timestamptz NOT NULL,
        "location" geography(Point, 4326) NOT NULL,
        "speed_kmh" double precision,
        "heading" double precision,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_driver_locations_driver_recorded"
        ON "driver_locations" ("tenant_id", "driver_id", "recorded_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_driver_locations_location"
        ON "driver_locations" USING GIST ("location")
    `);
    await enableTenantIsolation(queryRunner, "driver_locations");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "driver_locations"`);
    await queryRunner.query(`DROP TABLE "dispatch_assignments"`);
    await queryRunner.query(`DROP INDEX "idx_shipments_tenant_driver"`);
    await queryRunner.query(`
      ALTER TABLE "shipments"
        DROP COLUMN "vehicle_id",
        DROP COLUMN "driver_id"
    `);
  }
}
