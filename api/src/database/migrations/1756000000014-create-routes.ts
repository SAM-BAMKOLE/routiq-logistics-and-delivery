import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantIndex } from '../tenant-index.js';

/**
 * Routing: the planning run, the routes it produced, and their stops.
 *
 * - `route_plans` is one planning request: which date it planned, with which
 *   strategy and seed, and — once the (phase-1 inline, phase-2 queued)
 *   optimizer finishes — the unassigned stops with their reasons plus the
 *   run's headline metrics. Backing `POST /routes/plan`'s 202 with a status
 *   URL is why the run is a row and not a function return.
 * - `routes` carries one vehicle's tour for a plan date: metrics, the
 *   algorithm that produced it, its objective value, and the `version`
 *   column that `If-Match` guards on start/replan.
 * - `route_stops` is the ordered drop-off stops of a route. The unique index
 *   on `shipment_id` is the invariant "a shipment is planned exactly once":
 *   replanning deletes and reinserts a route's remaining stops in one
 *   transaction, and route cancellation (which would free the shipments
 *   again) is phase 2. `kind` defaults to `dropoff` for v1; pickup stops
 *   arrive with pickup-delivery pairing.
 */
export class CreateRoutes1756000000014 implements MigrationInterface {
  name = 'CreateRoutes1756000000014';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "route_plans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "plan_date" date NOT NULL,
        "status" text NOT NULL DEFAULT 'planning',
        "strategy" text NOT NULL,
        "seed" text NOT NULL,
        "time_budget_ms" integer NOT NULL,
        "requested_by" uuid
          REFERENCES "users" ("id") ON DELETE SET NULL,
        "unassigned" jsonb,
        "error" text,
        "routes_created" integer,
        "total_distance_m" double precision,
        "total_duration_s" double precision,
        "objective_value" double precision,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_route_plans_tenant_date"
        ON "route_plans" ("tenant_id", "plan_date")
    `);
    await createTenantIndex(queryRunner, 'route_plans');

    await queryRunner.query(`
      CREATE TABLE "routes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "plan_id" uuid
          REFERENCES "route_plans" ("id") ON DELETE SET NULL,
        "vehicle_id" uuid
          REFERENCES "vehicles" ("id") ON DELETE SET NULL,
        "driver_id" uuid
          REFERENCES "drivers" ("id") ON DELETE SET NULL,
        "plan_date" date NOT NULL,
        "status" text NOT NULL DEFAULT 'planned',
        "total_distance_m" double precision NOT NULL DEFAULT 0,
        "total_duration_s" double precision NOT NULL DEFAULT 0,
        "algorithm" text NOT NULL,
        "objective_value" double precision NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_routes_tenant_date"
        ON "routes" ("tenant_id", "plan_date")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_routes_tenant_driver"
        ON "routes" ("tenant_id", "driver_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_routes_tenant_status"
        ON "routes" ("tenant_id", "status")
    `);
    await createTenantIndex(queryRunner, 'routes');

    await queryRunner.query(`
      CREATE TABLE "route_stops" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "route_id" uuid NOT NULL
          REFERENCES "routes" ("id") ON DELETE CASCADE,
        "shipment_id" uuid NOT NULL
          REFERENCES "shipments" ("id") ON DELETE RESTRICT,
        "sequence" integer NOT NULL,
        "kind" text NOT NULL DEFAULT 'dropoff',
        "planned_arrival" timestamptz,
        "window_start" timestamptz,
        "window_end" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_route_stops_shipment"
        ON "route_stops" ("shipment_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_route_stops_route_sequence"
        ON "route_stops" ("route_id", "sequence")
    `);
    await createTenantIndex(queryRunner, 'route_stops');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "route_stops"`);
    await queryRunner.query(`DROP TABLE "routes"`);
    await queryRunner.query(`DROP TABLE "route_plans"`);
  }
}
