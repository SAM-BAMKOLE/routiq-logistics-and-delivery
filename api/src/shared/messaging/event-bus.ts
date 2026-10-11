import type { DomainEventEnvelope } from './event-envelope.js';

/** DI token for the {@link EventBus} port. */
export const EVENT_BUS = Symbol('EVENT_BUS');

/**
 * Outbound port for publishing domain events, so modules depend on an
 * abstraction rather than on the delivery mechanism.
 *
 * Phase 1 delivers in process, synchronously with the request: listeners run
 * before the publisher's transaction commits, which is what lets a listener's
 * database reads share the tenant's RLS context. Phase 2 swaps the adapter
 * for the outbox plus BullMQ (at-least-once, cross-process) without touching
 * any publisher.
 */
export interface EventBus {
  /** Awaits delivery of one event to its listeners. */
  publish(event: DomainEventEnvelope): Promise<void>;
  /** Awaits delivery of several events, in order. */
  publishAll(events: readonly DomainEventEnvelope[]): Promise<void>;
}
