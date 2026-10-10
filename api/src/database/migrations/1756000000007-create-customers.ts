import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantIsolation } from '../rls.js';

/**
 * Customer profiles plus their saved addresses.
 *
 * `customers.user_id` optionally links a portal customer to their login; it
 * is `ON DELETE SET NULL` so removing a login never removes business data.
 * `addresses.location` is a PostGIS `geography(Point, 4326)` with a GiST
 * index for the radius searches dispatch and routing will need. Coordinates
 * are written later through the repository (geocoding lands with routing);
 * the column stays NULL until then.
 */
export class CreateCustomers1756000000007 implements MigrationInterface {
  name = 'CreateCustomers1756000000007';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "email" text,
        "phone" text,
        "user_id" uuid
          REFERENCES "users" ("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await enableTenantIsolation(queryRunner, 'customers');

    await queryRunner.query(`
      CREATE TABLE "addresses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        "customer_id" uuid NOT NULL
          REFERENCES "customers" ("id") ON DELETE CASCADE,
        "line1" text NOT NULL,
        "line2" text,
        "city" text NOT NULL,
        "region" text,
        "country" text NOT NULL,
        "postal_code" text,
        "location" geography(Point, 4326),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_addresses_customer_id" ON "addresses" ("customer_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_addresses_location" ON "addresses" USING gist ("location")
    `);
    await enableTenantIsolation(queryRunner, 'addresses');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "addresses"`);
    await queryRunner.query(`DROP TABLE "customers"`);
  }
}
