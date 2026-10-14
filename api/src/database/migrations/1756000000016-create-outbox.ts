import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * The transactional outbox.
 *
 * The table is deliberately **global**: an event can have no tenant (password
 * reset, invitation to a brand-new user), and the relay must claim work across
 * every tenant in one query. There is no HTTP surface that reads it, and
 * access is bound by the application layer — the same reasoning as
 * `email_log`. `tenant-isolation.int-spec.ts` records the exception.
 *
 * `envelope` holds the whole `DomainEventEnvelope` so the relay can rebuild
 * the event byte-for-byte; the scalar columns only exist to route and to query
 * pending work. `event_id` is unique so a duplicate insert (a replayed
 * command) collapses instead of delivering twice.
 */
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
          { name: 'tenant_id', type: 'uuid', isNullable: true },
          { name: 'event_type', type: 'varchar', length: '100', isNullable: false },
          { name: 'event_id', type: 'uuid', isNullable: false },
          { name: 'envelope', type: 'jsonb', isNullable: false },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            isNullable: false,
            default: `'pending'`,
          },
          { name: 'attempts', type: 'integer', isNullable: false, default: 0 },
          { name: 'last_error', type: 'text', isNullable: true },
          {
            name: 'available_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
          { name: 'locked_at', type: 'timestamptz', isNullable: true },
          {
            name: 'created_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
          { name: 'processed_at', type: 'timestamptz', isNullable: true },
        ],
        uniques: [{ name: 'uq_outbox_event_id', columnNames: ['event_id'] }],
      }),
      true,
    );

    // The relay only ever scans for ready work, and orders rows by age.
    await queryRunner.createIndex(
      'outbox_messages',
      new TableIndex({
        name: 'idx_outbox_ready',
        columnNames: ['status', 'available_at'],
      }),
    );
    await queryRunner.createIndex(
      'outbox_messages',
      new TableIndex({
        name: 'idx_outbox_created',
        columnNames: ['created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('outbox_messages');
  }
}
