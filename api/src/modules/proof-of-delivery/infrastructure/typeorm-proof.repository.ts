import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { EntityManager } from 'typeorm';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import type { ProofType } from '../domain/proof.js';
import type {
  CapturedProof,
  CaptureProofRecord,
  OtpState,
  PendingOtp,
  ProofRepository,
} from '../domain/proof.repository.js';
import { ProofOrmEntity } from './proof.orm-entity.js';

/**
 * TypeORM implementation of the {@link ProofRepository} port.
 *
 * Evidence rows go through the ORM entity; the append-only convention is that
 * no code path rewrites them. The OTP state is raw SQL against the shipments
 * columns this module does not own — the documented cross-module write, the
 * mirror of dispatch writing `driver_id`. Every statement is scoped to the
 * active tenant.
 */
@Injectable()
export class TypeOrmProofRepository implements ProofRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly tenants: TenantContextService,
  ) {}

  async insertProof(record: CaptureProofRecord): Promise<CapturedProof> {
    const manager = this.manager();
    const tenantId = await this.tenantIdFor(manager, record.shipmentId);
    const entity = await manager.save(
      ProofOrmEntity,
      manager.create(ProofOrmEntity, {
        tenantId,
        shipmentId: record.shipmentId,
        type: record.type,
        fileUrl: record.fileUrl,
        recipientName: record.recipientName,
        otpVerifiedAt: record.type === 'otp' ? new Date() : null,
        capturedAt: new Date(),
      }),
    );
    return toCaptured(entity);
  }

  async listProofs(shipmentId: string): Promise<CapturedProof[]> {
    const manager = this.manager();
    const entities = await manager.find(ProofOrmEntity, {
      where: { shipmentId, ...this.tenants.scope() },
      order: { capturedAt: 'ASC' },
    });
    return entities.map(toCaptured);
  }

  async findPendingOtp(shipmentId: string): Promise<PendingOtp | null> {
    const params: unknown[] = [shipmentId];
    const rows = (await this.manager().query(
      `SELECT otp_hash AS hash, otp_expires_at AS "expiresAt",
              otp_attempts AS attempts
         FROM shipments
        WHERE id = $1${this.tenantPredicate(params)}`,
      params,
    )) as Array<{
      hash: string | null;
      expiresAt: Date | null;
      attempts: number;
    }>;
    const row = rows[0];
    if (!row || !row.hash || !row.expiresAt) {
      return null;
    }
    return { hash: row.hash, expiresAt: row.expiresAt, attempts: row.attempts };
  }

  async saveOtp(shipmentId: string, state: OtpState): Promise<void> {
    const params: unknown[] = [shipmentId, state.hash, state.expiresAt, state.attempts];
    await this.manager().query(
      `UPDATE shipments
          SET otp_hash = $2, otp_expires_at = $3, otp_attempts = $4
        WHERE id = $1${this.tenantPredicate(params)}`,
      params,
    );
  }

  async recordOtpAttempt(shipmentId: string, attempts: number): Promise<void> {
    const params: unknown[] = [shipmentId, attempts];
    await this.manager().query(
      `UPDATE shipments SET otp_attempts = $2
        WHERE id = $1${this.tenantPredicate(params)}`,
      params,
    );
  }

  async clearOtp(shipmentId: string): Promise<void> {
    const params: unknown[] = [shipmentId];
    await this.manager().query(
      `UPDATE shipments
          SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0
        WHERE id = $1${this.tenantPredicate(params)}`,
      params,
    );
  }

  /** Resolves the tenant of a shipment, scoped to the active tenant. */
  private async tenantIdFor(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<string> {
    const params: unknown[] = [shipmentId];
    const rows = (await manager.query(
      `SELECT tenant_id AS "tenantId" FROM shipments
        WHERE id = $1${this.tenantPredicate(params)}`,
      params,
    )) as Array<{ tenantId: string }>;
    // The shipment was loaded through the facade moments earlier; a racing
    // delete is the only way this is missing, and it should fail loudly.
    if (rows.length === 0) {
      throw new Error(`Shipment ${shipmentId} disappeared mid-capture.`);
    }
    return rows[0].tenantId;
  }

  /**
   * Appends a tenant predicate to the running parameter list and returns the
   * SQL fragment (` AND tenant_id = $n`), or an empty string when no tenant is
   * active. Mutating `params` keeps the placeholder index in sync.
   */
  private tenantPredicate(params: unknown[]): string {
    const tenantId = this.tenants.getTenantId();
    if (tenantId === undefined) {
      return '';
    }
    params.push(tenantId);
    return ` AND tenant_id = $${params.length}`;
  }

  private manager(): EntityManager {
    return this.txHost.tx;
  }
}

function toCaptured(entity: ProofOrmEntity): CapturedProof {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    shipmentId: entity.shipmentId,
    type: entity.type as ProofType,
    fileUrl: entity.fileUrl,
    recipientName: entity.recipientName,
    otpVerifiedAt: entity.otpVerifiedAt,
    capturedAt: entity.capturedAt,
  };
}
