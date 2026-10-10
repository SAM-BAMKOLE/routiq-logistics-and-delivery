import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Persistence entity for `shipment_status_history`: an append-only audit
 * trail. The migration revokes UPDATE and DELETE from the runtime role, and
 * the entity deliberately has no update timestamp - history never changes.
 */
@Entity('shipment_status_history')
export class ShipmentStatusHistoryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  shipmentId: string;

  @Column({ type: 'text', nullable: true })
  fromStatus: string | null;

  @Column({ type: 'text' })
  toStatus: string;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;
}
