/**
 * Proof of delivery: what the driver captured at the door.
 *
 * A proof is evidence, so it is immutable once captured — the module only
 * ever inserts rows (the table revokes UPDATE and DELETE, like the shipment
 * history). Three kinds are recognized, matching the architecture's table:
 * a photo URL, a signature with the recipient's name, or a verified OTP.
 */

export const PROOF_TYPES = ['photo', 'signature', 'otp'] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

export function isProofType(value: unknown): value is ProofType {
  return (
    typeof value === 'string' && (PROOF_TYPES as readonly string[]).includes(value)
  );
}

/** Domain error raised by proof validation. Mapped to 422 by the service. */
export class ProofDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProofDomainError';
  }
}

export interface CaptureProofInput {
  readonly type: ProofType;
  readonly fileUrl?: string | null;
  readonly recipientName?: string | null;
}

/**
 * Validates a capture before it becomes a row. A photo must point at the
 * photo; a signature must say who signed; an OTP proof is only ever created
 * by the verify flow, never directly.
 */
export function assertCapturable(input: CaptureProofInput): void {
  if (input.type === 'otp') {
    throw new ProofDomainError(
      'PROOF_OTP_DIRECT_FORBIDDEN',
      'OTP proofs are recorded by verifying a code, not by capturing one.',
    );
  }
  if (input.type === 'photo' && !input.fileUrl) {
    throw new ProofDomainError(
      'PROOF_FILE_REQUIRED',
      'A photo proof needs the URL of the stored photo.',
    );
  }
  if (input.type === 'signature' && !input.recipientName) {
    throw new ProofDomainError(
      'PROOF_RECIPIENT_REQUIRED',
      'A signature proof needs the name of the person who signed.',
    );
  }
}
