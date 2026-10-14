import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import type { DomainEventEnvelope } from '../../../shared/messaging/event-envelope.js';

/** Lifecycle of one outbox row as the relay moves it along. */
export type OutboxStatus = 'pending' | 'processing' | 'processed' | 'failed';

/**
 * One persisted domain event awaiting (or having completed) delivery.
 *
 * The row is written inside the publisher's transaction, so it commits only
 * if the state change that raised the event commits — the property that makes
 * the outbox transactional. The primary key is assigned by the publisher
 * (every aggregate in this codebase owns its id), which lets the in-process
 * fast path mark exactly the row it wrote.
 */
@Entity({ name: 'outbox_messages' })
@Index('uq_outbox_event_id', ['eventId'], { unique: true })
@Index('idx_outbox_ready', ['status', 'availableAt'])
@Index('idx_outbox_created', ['createdAt'])
export class OutboxMessage {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  /** Null for global events (password reset, user onboarding). */
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  /** The full envelope, so the relay reconstructs the event unchanged. */
  @Column({ type: 'jsonb' })
  envelope: DomainEventEnvelope;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: OutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  /** Earliest time the relay may pick the row up (retry backoff). */
  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt: Date;

  /** Set while a relay instance holds the row, so stale locks can be reclaimed. */
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
