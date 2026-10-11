import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistence entity for the tenant-scoped `dispatch_assignments` table. The
 * aggregate decides status changes; this entity and its repository only map.
 * The "one live assignment per shipment/driver" invariants are partial
 * unique indexes in the schema — see migration 1756000000013.
 */
@Entity('dispatch_assignments')
export class AssignmentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Index('idx_dispatch_assignments_shipment_id')
  @Column({ type: 'uuid' })
  shipmentId: string;

  @Index('idx_dispatch_assignments_driver_id')
  @Column({ type: 'uuid' })
  driverId: string;

  @Column({ type: 'uuid', nullable: true })
  vehicleId: string | null;

  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'timestamptz' })
  offeredAt: Date;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
