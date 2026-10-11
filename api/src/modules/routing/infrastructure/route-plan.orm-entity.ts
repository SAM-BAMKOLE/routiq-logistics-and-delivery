import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistence entity for the tenant-scoped `route_plans` table: one planning
 * request. Backs the 202 status URL of `POST /routes/plan` — `planning`
 * while the optimizer runs, `planned` with the unassigned list and headline
 * metrics, or `failed` with the error. See migration 1756000000014.
 */
@Entity('route_plans')
export class RoutePlanOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Index('idx_route_plans_tenant_date')
  @Column({ type: 'date' })
  planDate: string;

  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'text' })
  strategy: string;

  @Column({ type: 'text' })
  seed: string;

  @Column({ type: 'integer' })
  timeBudgetMs: number;

  @Column({ type: 'uuid', nullable: true })
  requestedBy: string | null;

  @Column({ type: 'jsonb', nullable: true })
  unassigned: { stopId: string; reason: string }[] | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'integer', nullable: true })
  routesCreated: number | null;

  @Column({ type: 'double precision', nullable: true })
  totalDistanceM: number | null;

  @Column({ type: 'double precision', nullable: true })
  totalDurationS: number | null;

  @Column({ type: 'double precision', nullable: true })
  objectiveValue: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
