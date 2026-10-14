import type { ClsService } from 'nestjs-cls';
import type { LdmsClsStore } from '../tenancy/tenant-context.js';
import type { DomainEventEnvelope } from './event-envelope.js';

/**
 * Fills an unset `correlationId` from the request id in CLS.
 *
 * A publisher rarely knows the request that caused the event; the bus does.
 * Filling it here — before the envelope is persisted — means the correlation
 * survives into the outbox and through every retry, so one request stays
 * traceable across every event it eventually caused.
 */
export function correlate(
  event: DomainEventEnvelope,
  cls: ClsService<LdmsClsStore>,
): DomainEventEnvelope {
  if (event.correlationId) {
    return event;
  }
  const requestId = cls.get('requestId');
  return requestId ? { ...event, correlationId: requestId } : event;
}
