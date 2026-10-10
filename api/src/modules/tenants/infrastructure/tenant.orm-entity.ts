import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistence entity for the global `tenants` table.
 *
 * `tenants` is not tenant-scoped — it is the registry of tenants — so it
 * carries no RLS policy; access is controlled by application authorization
 * (only platform admins reach it). The snake_case naming strategy maps
 * `createdAt` to `created_at` and so on.
 */
@Entity('tenants')
export class TenantOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', unique: true })
  slug: string;

  @Column({ type: 'text', default: 'active' })
  status: string;

  @Column({ type: 'text', default: 'free' })
  plan: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  settings: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
