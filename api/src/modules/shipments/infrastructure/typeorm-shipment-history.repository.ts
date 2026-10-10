import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type {
  ShipmentHistoryEntry,
  ShipmentHistoryRepository,
} from '../domain/shipment.repository.js';
import { ShipmentStatusHistoryOrmEntity } from './shipment-status-history.orm-entity.js';

/**
 * TypeORM implementation of the append-only {@link ShipmentHistoryRepository}
 * port. Inserts only - the migration revoked UPDATE and DELETE from the
 * runtime role, so the audit trail cannot be rewritten even by mistake.
 */
@Injectable()
export class TypeOrmShipmentHistoryRepository
  implements ShipmentHistoryRepository
{
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async append(entries: readonly ShipmentHistoryEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.txHost.tx.insert(
      ShipmentStatusHistoryOrmEntity,
      entries.map((entry) => ({
        tenantId: entry.tenantId,
        shipmentId: entry.shipmentId,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        actorId: entry.actorId,
        reason: entry.reason,
        occurredAt: entry.occurredAt,
      })),
    );
  }
}
