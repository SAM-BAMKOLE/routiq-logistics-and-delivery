import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * Persistence entity for the tenant-scoped `shipments` table. Controllers
 * and services never write it directly - the Shipment aggregate decides
 * status changes, and the repository maps between the two. `version` is the
 * optimistic-lock column: TypeORM bumps it on every update.
 */
@Entity('shipments')
export class ShipmentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  trackingNumber: string;

  @Column({ type: 'uuid' })
  customerId: string;

  @Column({ type: 'uuid' })
  pickupAddressId: string;

  @Column({ type: 'uuid' })
  dropoffAddressId: string;

  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'uuid', nullable: true })
  driverId: string | null;

  @Column({ type: 'uuid', nullable: true })
  vehicleId: string | null;

  @Column({ type: 'double precision' })
  weightKg: number;

  @Column({ type: 'double precision', nullable: true })
  volumeM3: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  windowStart: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  windowEnd: Date | null;

  @Column({ type: 'integer', nullable: true })
  priceMinor: number | null;

  @Column({ type: 'text' })
  currency: string;

  @Column({ type: 'integer', default: 0 })
  failedAttempts: number;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
