import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistence entity for the tenant-scoped `shipment_items` table. Items are
 * written once when the shipment is created and never modified.
 */
@Entity('shipment_items')
export class ShipmentItemOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  shipmentId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @Column({ type: 'double precision', nullable: true })
  weightKg: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
