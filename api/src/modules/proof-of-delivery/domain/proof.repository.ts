import type { ProofType } from './proof.js';

/**
 * Outbound port of the proof-of-delivery module.
 *
 * Two tables live behind it. `proofs_of_delivery` (migration 15) is the
 * evidence trail — append-only, like the shipment history. The OTP state
 * rides on three `shipments` columns (`otp_hash`, `otp_expires_at`,
 * `otp_attempts`); writing them from this module is the same documented
 * cross-module pattern dispatch uses for `shipments.driver_id`, and keeps
 * the code's hash next to the shipment it guards.
 */

/** DI token for the {@link ProofRepository} port. */
export const PROOF_REPOSITORY = Symbol('PROOF_REPOSITORY');

export interface CapturedProof {
  readonly id: string;
  readonly tenantId: string;
  readonly shipmentId: string;
  readonly type: ProofType;
  readonly fileUrl: string | null;
  readonly recipientName: string | null;
  readonly otpVerifiedAt: Date | null;
  readonly capturedAt: Date;
}

export interface CaptureProofRecord {
  readonly shipmentId: string;
  readonly type: ProofType;
  readonly fileUrl: string | null;
  readonly recipientName: string | null;
}

/** The pending OTP state of a shipment, as stored. */
export interface PendingOtp {
  readonly hash: string;
  readonly expiresAt: Date;
  readonly attempts: number;
}

export interface OtpState {
  readonly hash: string;
  readonly expiresAt: Date;
  readonly attempts: number;
}

export interface ProofRepository {
  /** Appends one evidence row; the table rejects updates by design. */
  insertProof(record: CaptureProofRecord): Promise<CapturedProof>;

  /** Every proof of a shipment, oldest first. */
  listProofs(shipmentId: string): Promise<CapturedProof[]>;

  /** The pending OTP for a shipment, or `null` when none is outstanding. */
  findPendingOtp(shipmentId: string): Promise<PendingOtp | null>;

  /** Issues or replaces the pending OTP (attempts reset to zero). */
  saveOtp(shipmentId: string, state: OtpState): Promise<void>;

  /** Bumps the failed-attempt counter after a wrong code. */
  recordOtpAttempt(shipmentId: string, attempts: number): Promise<void>;

  /** Clears the OTP columns once verified or abandoned. */
  clearOtp(shipmentId: string): Promise<void>;
}
