import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EVENT_BUS } from './event-bus.js';
import { EventEmitterBus } from './event-emitter.bus.js';

/**
 * The messaging kernel: the event envelope contract, the `EventBus` port,
 * and its phase-1 in-process adapter.
 *
 * Global so any feature module can publish or listen without importing it.
 * Phase 2 replaces the adapter (outbox relay + BullMQ) behind the same port.
 */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [{ provide: EVENT_BUS, useClass: EventEmitterBus }],
  exports: [EVENT_BUS],
})
export class MessagingModule {}
