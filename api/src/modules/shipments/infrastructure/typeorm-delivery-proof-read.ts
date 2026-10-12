import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { DeliveryProofRead } from '../domain/delivery-proof-read.js';

/**
 * Reads `proofs_of_delivery` (owned by the proof-of-delivery module) for the
 * shipment-side `deliver()` gate. Raw SQL on purpose: there is no ORM entity
 * on this side of the boundary, and RLS scopes the read to the tenant of the
 * open transaction.
 */
@Injectable()
export class TypeOrmDeliveryProofRead implements DeliveryProofRead {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async hasProof(shipmentId: string): Promise<boolean> {
    const rows = (await this.txHost.tx.query(
      `SELECT 1 AS present
         FROM proofs_of_delivery
        WHERE shipment_id = $1
        LIMIT 1`,
      [shipmentId],
    )) as Array<{ present: number }>;
    return rows.length > 0;
  }
}
