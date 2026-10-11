import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * Persistence entity for the tenant-scoped `routes` table. The aggregate
 * decides status and metric changes; this entity and its repository only
 * map. `version` is the optimistic-lock column behind `If-Match` on
 * start/replan — TypeORM bumps it on every update. See migration
 * 1756000000014.
 */
@Entity('routes')
export class RouteOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  planId: string | null;

  @Column({ type: 'uuid', nullable: true })
  vehicleId: string | null;

  @Index('idx_routes_tenant_driver')
  @Column({ type: 'uuid', nullable: true })
  driverId: string | null;

  @Index('idx_routes_tenant_date')
  @Column({ type: 'date' })
  planDate: string;

  @Index('idx_routes_tenant_status')
  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'double precision' })
  totalDistanceM: number;

  @Column({ type: 'double precision' })
  totalDurationS: number;

  @Column({ type: 'text' })
  algorithm: string;

  @Column({ type: 'double precision' })
  objectiveValue: number;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
