import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxMessage } from '../infrastructure/outbox-message.orm-entity.js';

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxMessage)
    private readonly repository: Repository<OutboxMessage>,
  ) {}

  async publish(event: {
    tenantId: string;
    eventType: string;
    eventId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const message = this.repository.create({
      tenantId: event.tenantId,
      eventType: event.eventType,
      eventId: event.eventId,
      payload: event.payload,
      processed: false,
    });
    await this.repository.save(message);
  }
}
