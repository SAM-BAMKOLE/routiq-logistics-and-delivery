import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { enableTenantIsolation } from '../rls.js';

export class CreateOutbox1756000000016 implements MigrationInterface {
  name = 'CreateOutbox1756000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'outbox_messages',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'tenant_id', type: 'uuid', isNullable: false },
          { name: 'event_type', type: 'varchar', length: '100', isNullable: false },
          { name: 'event_id', type: 'uuid', isNullable: false },
          { name: 'payload', type: 'jsonb', isNullable: false },
          { name: 'processed', type: 'boolean', isNullable: false, default: false },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'processed_at', type: 'timestamptz', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'outbox_messages',
      new TableIndex({
        name: 'idx_outbox_processed',
        columnNames: ['processed'],
      }),
    );

    await queryRunner.createIndex(
      'outbox_messages',
      new TableIndex({
        name: 'idx_outbox_created',
        columnNames: ['createdAt'],
      }),
    );

    await enableTenantIsolation(queryRunner, 'outbox_messages');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('outbox_messages');
  }
}
