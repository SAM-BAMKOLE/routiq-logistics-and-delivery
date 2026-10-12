import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Persistence entity for `proofs_of_delivery` (migration 15). The table is
 * append-only — the runtime role has INSERT but not UPDATE/DELETE — so this
 * entity deliberately exposes no update path: the module only inserts.
 */
@Entity('proofs_of_delivery')
@Index(['tenantId', 'shipmentId'])
export class ProofOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  shipmentId: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text', nullable: true })
  fileUrl: string | null;

  @Column({ type: 'text', nullable: true })
  recipientName: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  otpVerifiedAt: Date | null;

  @Column({ type: 'timestamptz' })
  capturedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
