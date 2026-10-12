import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxMessage } from './infrastructure/outbox-message.orm-entity.js';
import { OutboxService } from './application/outbox.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxMessage])],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
