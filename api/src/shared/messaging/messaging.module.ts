import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OutboxService } from '../../modules/outbox/application/outbox.service.js';
import { OutboxModule } from '../../modules/outbox/outbox.module.js';
import { EVENT_BUS } from './event-bus.js';
import { EventEmitterBus } from './event-emitter.bus.js';
import { OutboxEventBus } from './outbox-event-bus.js';
import { OUTBOX_STORE } from './outbox.store.js';

/**
 * The messaging kernel: the event envelope contract, the `EventBus` port, and
 * the adapters behind it.
 *
 * Global, so any feature module can publish or listen without importing it.
 * The default adapter is the outbox (`OutboxEventBus`); the phase-1 in-process
 * adapter is kept selectable with `EVENT_BUS_ADAPTER=messaging`, which is
 * handy when running without the outbox table. Because the module owns the
 * choice, feature modules depend only on the `EVENT_BUS` token and never on an
 * adapter.
 */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot(), OutboxModule],
  providers: [
    EventEmitterBus,
    OutboxEventBus,
    { provide: OUTBOX_STORE, useExisting: OutboxService },
    {
      provide: EVENT_BUS,
      inject: [ConfigService, EventEmitterBus, OutboxEventBus],
      useFactory: (
        config: ConfigService,
        inProcess: EventEmitterBus,
        outbox: OutboxEventBus,
      ) =>
        config.get<string>('EVENT_BUS_ADAPTER') === 'messaging'
          ? inProcess
          : outbox,
    },
  ],
  exports: [EVENT_BUS],
})
export class MessagingModule {}
