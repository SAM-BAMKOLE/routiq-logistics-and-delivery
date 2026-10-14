import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { DomainEventEnvelope } from '../../../shared/messaging/event-envelope.js';
import type { OutboxStore } from '../../../shared/messaging/outbox.store.js';
import { OutboxMessage } from '../infrastructure/outbox-message.orm-entity.js';

/** One row claimed by the relay, ready for delivery. */
export interface ClaimedOutboxMessage {
  id: string;
  tenantId: string | null;
  eventType: string;
  eventId: string;
  envelope: DomainEventEnvelope;
  attempts: number;
}

/** The raw shape `claim` returns (snake_case, straight from Postgres). */
interface ClaimedRow {
  id: string;
  tenant_id: string | null;
  event_type: string;
  event_id: string;
  envelope: DomainEventEnvelope;
  attempts: number;
}

/**
 * The persistence half of the outbox.
 *
 * `append` and the `mark*` methods run on `TransactionHost.tx`, so when the
 * publisher is inside a request's tenant transaction the outbox row joins that
 * same transaction — it commits if and only if the state change commits. The
 * optional `manager` lets the relay pin the same calls to a transaction it
 * opened itself (a global event has no tenant transaction to inherit).
 *
 * `claim` is the one operation that must span tenants, so it runs on the
 * pooled `DataSource` in its own transaction and takes rows with
 * `FOR UPDATE SKIP LOCKED`. The outbox table is global (see its migration), so
 * the restricted runtime role can read every tenant's pending work.
 */
@Injectable()
export class OutboxService implements OutboxStore {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @Inject(getDataSourceToken()) private readonly dataSource: DataSource,
  ) {}

  /**
   * Appends one envelope to the outbox and returns the row id.
   *
   * The insert is idempotent on `event_id`: a replay (the same event published
   * twice, or an at-least-once redelivery) returns `null` and leaves the
   * existing row alone. The caller is then responsible for delivery (the
   * in-process fast path) or for leaving the row for the relay.
   */
  async append(envelope: DomainEventEnvelope): Promise<string | null> {
    const id = randomUUID();
    // INSERT is not a UPDATE/DELETE, so TypeORM returns the RETURNING rows
    // directly, not the `[rows, count]` pair it uses for those statements.
    const rows = (await this.txHost.tx.query(
      `INSERT INTO outbox_messages
         (id, tenant_id, event_type, event_id, envelope, status, attempts,
          available_at, locked_at, processed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', 0, now(), NULL, NULL)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [id, envelope.tenantId, envelope.type, envelope.id, JSON.stringify(envelope)],
    )) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }

  /** Marks a row delivered. */
  async markProcessed(id: string, manager?: EntityManager): Promise<void> {
    await this.manager(manager).update(
      OutboxMessage,
      { id },
      { status: 'processed', processedAt: new Date(), lockedAt: null },
    );
  }

  /**
   * Records a failed attempt and schedules the next one. `exhausted` moves the
   * row to its terminal `failed` state; otherwise it returns to `pending`.
   */
  async markFailed(
    id: string,
    error: unknown,
    availableAt: Date,
    exhausted: boolean,
    manager?: EntityManager,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.manager(manager).query(
      `UPDATE outbox_messages
          SET attempts = attempts + 1,
              last_error = $2,
              available_at = $3,
              status = $4,
              locked_at = NULL
        WHERE id = $1`,
      [id, message.slice(0, 2000), availableAt, exhausted ? 'failed' : 'pending'],
    );
  }

  /**
   * Claims up to `limit` ready rows for this worker, oldest first, and flags
   * them `processing`. Rows whose lock is older than `lockTimeoutMs` are
   * reclaimed — a relay that crashed mid-delivery must not strand work.
   */
  async claim(
    limit: number,
    lockTimeoutMs: number,
  ): Promise<ClaimedOutboxMessage[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE outbox_messages
            SET status = 'pending', locked_at = NULL
          WHERE status = 'processing'
            AND locked_at < now() - ($1::int * interval '1 millisecond')`,
        [lockTimeoutMs],
      );

      // TypeORM returns `[rows, affectedCount]` for UPDATE, so pull the rows out.
      const [rows] = (await manager.query(
        `UPDATE outbox_messages
            SET status = 'processing', locked_at = now()
          WHERE id IN (
            SELECT id FROM outbox_messages
             WHERE status = 'pending'
               AND available_at <= now()
             ORDER BY created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING id, tenant_id, event_type, event_id, envelope, attempts`,
        [limit],
      )) as [ClaimedRow[], number];

      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        eventType: row.event_type,
        eventId: row.event_id,
        envelope: row.envelope,
        attempts: Number(row.attempts),
      }));
    });
  }

  /** Runs `fn` in a plain transaction on the pooled connection. */
  runInTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(fn);
  }

  /** Reads one row; used by tests and future admin tooling. */
  findById(id: string): Promise<OutboxMessage | null> {
    return this.dataSource
      .getRepository(OutboxMessage)
      .findOne({ where: { id } });
  }

  private manager(manager?: EntityManager): EntityManager {
    return manager ?? this.txHost.tx;
  }
}
