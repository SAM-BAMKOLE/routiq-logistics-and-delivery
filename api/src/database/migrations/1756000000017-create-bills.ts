import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { createTenantIndex } from '../tenant-index.js';

export class CreateBills1756000000017 implements MigrationInterface {
  name = 'CreateBills1756000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'bills',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, isGenerated: true, generationStrategy: 'uuid' },
          { name: 'tenant_id', type: 'uuid', isNullable: false },
          { name: 'shipment_id', type: 'uuid', isNullable: false },
          { name: 'amount_minor', type: 'integer', isNullable: false },
          { name: 'currency', type: 'varchar', length: '3', isNullable: false, default: "'NGN'" },
          { name: 'status', type: 'varchar', length: '10', isNullable: false },
          { name: 'issued_at', type: 'timestamptz', isNullable: true },
          { name: 'paid_at', type: 'timestamptz', isNullable: true },
          { name: 'voided_at', type: 'timestamptz', isNullable: true },
          { name: 'version', type: 'integer', isNullable: false, default: 1 },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'bills',
      new TableIndex({
        name: 'idx_bills_tenant_shipment',
        columnNames: ['tenant_id', 'shipment_id'],
      }),
    );

    await createTenantIndex(queryRunner, 'bills');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('bills');
  }
}
