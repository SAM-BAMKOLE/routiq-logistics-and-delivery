import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import type { DeliveryProofRead } from '../domain/delivery-proof-read.js';

/**
 * Reads `proofs_of_delivery` (owned by the proof-of-delivery module) for the
 * shipment-side `deliver()` gate. Raw SQL on purpose: there is no ORM entity
 * on this side of the boundary. The read is scoped to the active tenant, so a
 * shipment id from another tenant never reveals whether a proof exists.
 */
@Injectable()
export class TypeOrmDeliveryProofRead implements DeliveryProofRead {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly tenants: TenantContextService,
  ) {}

  async hasProof(shipmentId: string): Promise<boolean> {
    const tenantId = this.tenants.getTenantId();
    const params: unknown[] = [shipmentId];
    const tenantPredicate =
      tenantId === undefined ? '' : ` AND tenant_id = $${params.push(tenantId)}`;
    const rows = (await this.txHost.tx.query(
      `SELECT 1 AS present
         FROM proofs_of_delivery
        WHERE shipment_id = $1${tenantPredicate}
        LIMIT 1`,
      params,
    )) as Array<{ present: number }>;
    return rows.length > 0;
  }
}
