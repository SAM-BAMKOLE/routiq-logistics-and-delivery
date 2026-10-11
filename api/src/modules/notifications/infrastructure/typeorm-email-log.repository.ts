import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  EmailAttemptsToday,
  EmailLogEntry,
  EmailLogRepository,
} from '../application/email-log.repository.js';
import { EmailLogOrmEntity } from './email-log.orm-entity.js';

/**
 * TypeORM implementation of the {@link EmailLogRepository} port.
 *
 * The table is global (no RLS), so this works with or without a tenant
 * transaction — a password reset logs its mail with no tenant context at
 * all. `countToday` counts attempts (sent or failed) for the current UTC
 * day: Gmail's allowance is spent by attempts, not by successes.
 */
@Injectable()
export class TypeOrmEmailLogRepository implements EmailLogRepository {
  constructor(
    @InjectRepository(EmailLogOrmEntity)
    private readonly repo: Repository<EmailLogOrmEntity>,
  ) {}

  async findByDedupeKey(dedupeKey: string): Promise<boolean> {
    const row = await this.repo
      .createQueryBuilder('log')
      .select('log.id', 'id')
      .where('log.dedupe_key = :dedupeKey', { dedupeKey })
      .getRawOne<{ id: string }>();
    return row !== undefined;
  }

  async countToday(tenantId: string | null): Promise<EmailAttemptsToday> {
    const raw = (await this.repo
      .createQueryBuilder('log')
      .select(
        `count(*) FILTER (WHERE log.tenant_id = :tenantId)`,
        'tenant_count',
      )
      .addSelect(`count(*)`, 'global_count')
      .where(`log.status IN ('sent', 'failed')`)
      .andWhere(`log.sent_at >= date_trunc('day', now())`)
      .setParameter('tenantId', tenantId)
      .getRawOne<{ tenant_count: string; global_count: string }>()) ?? {
      tenant_count: '0',
      global_count: '0',
    };
    return {
      tenant: Number(raw.tenant_count),
      global: Number(raw.global_count),
    };
  }

  async insert(entry: EmailLogEntry): Promise<void> {
    await this.repo.insert({
      tenantId: entry.tenantId,
      recipient: entry.recipient,
      template: entry.template,
      priority: entry.priority,
      dedupeKey: entry.dedupeKey,
      status: entry.status,
      error: entry.error,
      sentAt: entry.sentAt,
    });
  }
}
