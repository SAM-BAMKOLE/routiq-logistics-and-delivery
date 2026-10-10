import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistence entity for the tenant-scoped `vehicles` table. Capacities are
 * `double precision`: kilograms and cubic meters are routinely fractional,
 * and float precision is ample for capacity planning.
 */
@Entity('vehicles')
export class VehicleOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  // Uniqueness is composite (tenant_id, plate) and lives in the migration: a
  // single-column unique here would wrongly block the same plate in two
  // tenants.
  @Column({ type: 'text' })
  plate: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'double precision' })
  capacityWeightKg: number;

  @Column({ type: 'double precision' })
  capacityVolumeM3: number;

  @Column({ type: 'text', default: 'active' })
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
