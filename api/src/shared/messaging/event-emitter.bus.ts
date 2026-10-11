import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';
import type { LdmsClsStore } from '../tenancy/tenant-context.js';
import type { EventBus } from './event-bus.js';
import type { DomainEventEnvelope } from './event-envelope.js';

/**
 * Phase-1 event bus: `@nestjs/event-emitter`, in process.
 *
 * Two behaviors matter beyond plain emission:
 *
 * - **Correlation**: the envelope's `correlationId` is filled from the
 *   request id in CLS when the publisher does not set one, so one request
 *   can be traced through every event it caused.
 * - **Isolation**: a listener failure is logged and swallowed. Phase 1 is
 *   best-effort delivery by design — a notification problem must never roll
 *   back or fail the business request that raised the event. Phase 2 gives
 *   delivery at-least-once semantics through the outbox and BullMQ.
 */
@Injectable()
export class EventEmitterBus implements EventBus {
  private readonly logger = new Logger(EventEmitterBus.name);

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly cls: ClsService<LdmsClsStore>,
  ) {}

  async publish(event: DomainEventEnvelope): Promise<void> {
    const correlated = this.correlate(event);
    try {
      await this.emitter.emitAsync(correlated.type, correlated);
    } catch (error) {
      this.logger.error(
        { eventId: correlated.id, type: correlated.type, error },
        'event listener failed; the raising request continues',
      );
    }
  }

  async publishAll(events: readonly DomainEventEnvelope[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  private correlate(event: DomainEventEnvelope): DomainEventEnvelope {
    if (event.correlationId) {
      return event;
    }
    const requestId = this.cls.get('requestId');
    return requestId ? { ...event, correlationId: requestId } : event;
  }
}
