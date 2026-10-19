import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Configurable surcharges on a rate card: an array of named price adjustments
 * (percent multipliers for express speed / difficult terrain, flat fees for
 * special handling). Existing rules are backfilled with the stock catalogue so
 * the feature is visible immediately. Nothing is applied to a shipment unless
 * the booking opts in, so backfilling never moves a price on its own.
 */
const STOCK_CATALOGUE = [
  { code: 'express', label: 'Express delivery', kind: 'percent', value: 2500 },
  {
    code: 'difficult_road',
    label: 'Difficult road / terrain',
    kind: 'percent',
    value: 1500,
  },
  { code: 'fragile', label: 'Fragile handling', kind: 'flat', value: 150_000 },
  {
    code: 'refrigerated',
    label: 'Refrigerated / cold chain',
    kind: 'flat',
    value: 250_000,
  },
  {
    code: 'hazardous',
    label: 'Hazardous materials',
    kind: 'flat',
    value: 300_000,
  },
];

export class AddPricingSurcharges1756000000018 implements MigrationInterface {
  name = 'AddPricingSurcharges1756000000018';

  async up(queryRunner: QueryRunner): Promise<void> {
    // DDL cannot take bind parameters, so the default is inlined as a literal.
    // The catalogue is a compile-time constant; quotes are escaped anyway.
    const literal = JSON.stringify(STOCK_CATALOGUE).replace(/'/g, "''");
    await queryRunner.query(
      `ALTER TABLE "pricing_rules"
         ADD COLUMN "surcharges" jsonb NOT NULL DEFAULT '${literal}'::jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pricing_rules" DROP COLUMN "surcharges"`,
    );
  }
}
