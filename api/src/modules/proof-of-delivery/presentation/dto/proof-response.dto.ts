import { ApiProperty } from '@nestjs/swagger';
import type { CapturedProof } from '../../domain/proof.repository.js';

/** One captured proof of delivery. */
export class ProofResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  shipmentId: string;

  @ApiProperty({ enum: ['photo', 'signature', 'otp'] })
  type: string;

  @ApiProperty({ nullable: true })
  fileUrl: string | null;

  @ApiProperty({ nullable: true })
  recipientName: string | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'When the OTP was verified (OTP proofs only).',
  })
  otpVerifiedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  capturedAt: string;

  static from(proof: CapturedProof): ProofResponseDto {
    return {
      id: proof.id,
      shipmentId: proof.shipmentId,
      type: proof.type,
      fileUrl: proof.fileUrl,
      recipientName: proof.recipientName,
      otpVerifiedAt: proof.otpVerifiedAt
        ? proof.otpVerifiedAt.toISOString()
        : null,
      capturedAt: proof.capturedAt.toISOString(),
    };
  }
}

export class ProofListResponseDto {
  @ApiProperty({ type: [ProofResponseDto] })
  data: ProofResponseDto[];
}
