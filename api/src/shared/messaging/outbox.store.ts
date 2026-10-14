import type { DomainEventEnvelope } from './event-envelope.js';

/** Injection token for the outbox persistence port. */
export const OUTBOX_STORE = Symbol('OUTBOX_STORE');

/**
 * The persistence the outbox event-bus adapter needs to be durable.
 *
 * Kept as a port so the messaging kernel never imports a feature module: the
 * TypeORM implementation lives in `modules/outbox` and is bound to this token
 * at the composition root. That keeps the dependency arrow pointing one way —
 * `outbox` knows about messaging, messaging only knows this interface.
 */
export interface OutboxStore {
  /**
   * Persists an envelope inside the ambient transaction and returns its row id.
   *
   * Idempotent per `event_id`: republishing an event that is already recorded
   * (a replayed command, an at-least-once retry) returns `null` instead of
   * inserting a second row, so the caller can skip redelivery.
   */
  append(envelope: DomainEventEnvelope): Promise<string | null>;
  /** Marks a row delivered. */
  markProcessed(id: string): Promise<void>;
  /** Records a failed attempt and schedules the next one. */
  markFailed(
    id: string,
    error: unknown,
    availableAt: Date,
    exhausted: boolean,
  ): Promise<void>;
}
