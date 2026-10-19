import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The itemised quote a shipment was priced with, captured at creation. Rate
 * cards can change afterwards, so the breakdown is stored (not recomputed) to
 * keep the price a customer was quoted auditable. Null for shipments created
 * before this migration.
 */
export class AddShipmentPriceBreakdown1756000000019
  implements MigrationInterface
{
  name = 'AddShipmentPriceBreakdown1756000000019';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipments" ADD COLUMN "price_breakdown" jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipments" DROP COLUMN "price_breakdown"`,
    );
  }
}
