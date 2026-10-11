import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Persistence entity for the global `email_log` table (see the migration:
 * `tenant_id` is nullable because password-reset mail belongs to no tenant,
 * so the table is not RLS-scoped).
 */
@Entity('email_log')
export class EmailLogOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ type: 'text' })
  recipient: string;

  @Column({ type: 'text' })
  template: string;

  @Column({ type: 'text', default: 'normal' })
  priority: string;

  @Column({ type: 'text' })
  dedupeKey: string;

  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
