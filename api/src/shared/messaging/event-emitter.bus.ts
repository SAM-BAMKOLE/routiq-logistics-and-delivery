import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';
import type { LdmsClsStore } from '../tenancy/tenant-context.js';
import { correlate } from './correlate.js';
import type { EventBus } from './event-bus.js';
import type { DomainEventEnvelope } from './event-envelope.js';

/**
 * Phase-1 event bus: `@nestjs/event-emitter`, in process, with no durability.
 *
 * Retained as the fallback adapter (`EVENT_BUS_ADAPTER=messaging`): it is
 * useful when running without the outbox table, and its tests pin the
 * correlation and isolation behaviors that `OutboxEventBus` inherits.
 *
 * - **Correlation**: `correlationId` is filled from the request id in CLS, so
 *   one request can be traced through every event it caused.
 * - **Isolation**: a listener failure is logged and swallowed. A notification
 *   problem must never roll back or fail the business request that raised the
 *   event.
 *
 * Unlike the outbox adapter, a failed delivery here is simply lost.
 */
@Injectable()
export class EventEmitterBus implements EventBus {
  private readonly logger = new Logger(EventEmitterBus.name);

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly cls: ClsService<LdmsClsStore>,
  ) {}

  async publish(event: DomainEventEnvelope): Promise<void> {
    const correlated = correlate(event, this.cls);
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
}
