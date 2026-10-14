import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxRelayService } from './application/outbox-relay.service.js';
import { OutboxService } from './application/outbox.service.js';
import { OutboxMessage } from './infrastructure/outbox-message.orm-entity.js';

/**
 * The transactional outbox: durable event storage plus the embedded relay.
 *
 * `OutboxService` is the persistence the messaging kernel binds to its
 * `OUTBOX_STORE` port; the relay starts with the application and drains
 * anything the in-process fast path could not deliver.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OutboxMessage])],
  providers: [OutboxService, OutboxRelayService],
  exports: [OutboxService],
})
export class OutboxModule {}
