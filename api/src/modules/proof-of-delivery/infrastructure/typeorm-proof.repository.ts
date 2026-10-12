import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { EntityManager } from 'typeorm';
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
 * Evidence rows go through the ORM entity (the table's append-only grants
 * make a rewrite impossible even if a bug tried). The OTP state is raw SQL
 * against the shipments columns this module does not own — the documented
 * cross-module write, the mirror of dispatch writing `driver_id`.
 */
@Injectable()
export class TypeOrmProofRepository implements ProofRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
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
      where: { shipmentId },
      order: { capturedAt: 'ASC' },
    });
    return entities.map(toCaptured);
  }

  async findPendingOtp(shipmentId: string): Promise<PendingOtp | null> {
    const rows = (await this.manager().query(
      `SELECT otp_hash AS hash, otp_expires_at AS "expiresAt",
              otp_attempts AS attempts
         FROM shipments
        WHERE id = $1`,
      [shipmentId],
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
    await this.manager().query(
      `UPDATE shipments
          SET otp_hash = $2, otp_expires_at = $3, otp_attempts = $4
        WHERE id = $1`,
      [shipmentId, state.hash, state.expiresAt, state.attempts],
    );
  }

  async recordOtpAttempt(shipmentId: string, attempts: number): Promise<void> {
    await this.manager().query(
      `UPDATE shipments SET otp_attempts = $2 WHERE id = $1`,
      [shipmentId, attempts],
    );
  }

  async clearOtp(shipmentId: string): Promise<void> {
    await this.manager().query(
      `UPDATE shipments
          SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0
        WHERE id = $1`,
      [shipmentId],
    );
  }

  /** RLS already scopes reads; this pins the tenant column explicitly. */
  private async tenantIdFor(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<string> {
    const rows = (await manager.query(
      `SELECT tenant_id AS "tenantId" FROM shipments WHERE id = $1`,
      [shipmentId],
    )) as Array<{ tenantId: string }>;
    // The shipment was loaded through the facade moments earlier; a racing
    // delete is the only way this is missing, and it should fail loudly.
    if (rows.length === 0) {
      throw new Error(`Shipment ${shipmentId} disappeared mid-capture.`);
    }
    return rows[0].tenantId;
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
