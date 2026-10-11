import { randomUUID } from 'node:crypto';

/**
 * The event envelope every event carries out of a module, per the
 * architecture's eventing contract.
 *
 * The shape is deliberately stable so phase 2 can move it into the outbox
 * table unchanged: identity (`id`), routing (`type`, `tenantId`), ordering
 * (`aggregateType`/`aggregateId`/`aggregateVersion`), causality
 * (`correlationId`/`causationId`), and the event's own `payload`.
 *
 * `correlationId` follows a request through every downstream event and log
 * line; the event-bus adapter fills it from the request context when the
 * publisher does not know it.
 */
export interface DomainEventEnvelope<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly type: string;
  /** Owning tenant, or null for global events (password reset, users). */
  readonly tenantId: string | null;
  /** ISO-8601 timestamp of the moment the event occurred. */
  readonly occurredAt: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Aggregate version at the event, when the aggregate has one. */
  readonly aggregateVersion: number | null;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly payload: TPayload;
}

export interface CreateEnvelopeInput<TPayload> {
  readonly type: string;
  readonly tenantId?: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion?: number | null;
  readonly correlationId?: string | null;
  readonly causationId?: string | null;
  readonly occurredAt?: Date;
  readonly payload: TPayload;
}

/**
 * Builds an envelope with sensible defaults (`id`, `occurredAt`) so
 * publishers only state what they actually know.
 */
export function createEnvelope<TPayload>(
  input: CreateEnvelopeInput<TPayload>,
): DomainEventEnvelope<TPayload> {
  return {
    id: randomUUID(),
    type: input.type,
    tenantId: input.tenantId ?? null,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion ?? null,
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
    payload: input.payload,
  };
}
