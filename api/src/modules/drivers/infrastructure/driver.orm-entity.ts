import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistence entity for the tenant-scoped `drivers` table. Uniqueness is
 * composite in the migration (`tenant_id` + `membership_id`, `tenant_id` +
 * `license_no`); no single-column unique belongs here.
 */
@Entity('drivers')
export class DriverOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  membershipId: string;

  @Column({ type: 'text' })
  licenseNo: string;

  @Column({ type: 'text', default: 'active' })
  status: string;

  @Column({ type: 'text', default: 'available' })
  availability: string;

  @Column({ type: 'uuid', nullable: true })
  currentVehicleId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
