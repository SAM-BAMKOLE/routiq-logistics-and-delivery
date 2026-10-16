import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantIndex } from '../tenant-index.js';

/**
 * The shipment aggregate: the shipment row, its line items, and the
 * append-only status history.
 *
 * Design notes:
 * - `customer_id`, `pickup_address_id`, and `dropoff_address_id` are `ON
 *   DELETE RESTRICT`: a shipment is a business record, so deleting the
 *   customer or addresses it references must fail loudly rather than erase
 *   history (the customers service maps the violation to a 409).
 * - `price_minor` is NOT NULL because the quote is computed synchronously at
 *   creation; a tenant without an active pricing rule cannot create
 *   shipments, which is intentional - a shipment without a price cannot be
 *   confirmed.
 * - `failed_attempts` counts FAILED_ATTEMPT visits so the domain can stop
 *   retries after the tenant-configured limit.
 * - `version` is the optimistic-lock column; the API exposes it as an ETag
 *   and requires it back in `If-Match` on every state-changing action.
 * - The history table is append-only by application convention: no code path
 *   issues `UPDATE` or `DELETE` against it, so the audit trail only grows.
 */
export class CreateShipments1756000000011 implements MigrationInterface {
  name = 'CreateShipments1756000000011';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "shipments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "tracking_number" text NOT NULL,
        "customer_id" uuid NOT NULL
          REFERENCES "customers" ("id") ON DELETE RESTRICT,
        "pickup_address_id" uuid NOT NULL
          REFERENCES "addresses" ("id") ON DELETE RESTRICT,
        "dropoff_address_id" uuid NOT NULL
          REFERENCES "addresses" ("id") ON DELETE RESTRICT,
        "status" text NOT NULL DEFAULT 'CREATED',
        "weight_kg" double precision NOT NULL,
        "volume_m3" double precision,
        "window_start" timestamptz,
        "window_end" timestamptz,
        "price_minor" integer NOT NULL,
        "currency" text NOT NULL,
        "failed_attempts" integer NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_shipments_tenant_tracking"
          UNIQUE ("tenant_id", "tracking_number")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipments_tenant_status"
        ON "shipments" ("tenant_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipments_tenant_customer"
        ON "shipments" ("tenant_id", "customer_id")
    `);
    await createTenantIndex(queryRunner, 'shipments');

    await queryRunner.query(`
      CREATE TABLE "shipment_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "shipment_id" uuid NOT NULL
          REFERENCES "shipments" ("id") ON DELETE CASCADE,
        "description" text NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "weight_kg" double precision,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipment_items_shipment_id"
        ON "shipment_items" ("shipment_id")
    `);
    await createTenantIndex(queryRunner, 'shipment_items');

    await queryRunner.query(`
      CREATE TABLE "shipment_status_history" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "shipment_id" uuid NOT NULL
          REFERENCES "shipments" ("id") ON DELETE CASCADE,
        "from_status" text,
        "to_status" text NOT NULL,
        "actor_id" uuid
          REFERENCES "users" ("id") ON DELETE SET NULL,
        "reason" text,
        "occurred_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipment_status_history_shipment_id"
        ON "shipment_status_history" ("shipment_id")
    `);
    await createTenantIndex(queryRunner, 'shipment_status_history');
    // Append-only audit trail: rows are only ever inserted. With a single
    // database role the database cannot enforce this with grants, so the
    // application never issues UPDATE or DELETE against this table.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "shipment_status_history"`);
    await queryRunner.query(`DROP TABLE "shipment_items"`);
    await queryRunner.query(`DROP TABLE "shipments"`);
  }
}
