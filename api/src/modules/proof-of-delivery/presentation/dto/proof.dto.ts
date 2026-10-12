import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** Body of `POST /shipments/:id/proof`: a photo or a signature. */
export class CaptureProofDto {
  @ApiProperty({
    enum: ['photo', 'signature'],
    description:
      'OTP proofs cannot be captured directly — they come from verifying a code.',
  })
  @IsIn(['photo', 'signature'])
  type: 'photo' | 'signature';

  @ApiPropertyOptional({
    description: 'URL of the uploaded photo (required for type=photo).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  fileUrl?: string;

  @ApiPropertyOptional({
    description: 'Who signed (required for type=signature).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientName?: string;
}

/** Body of `POST /shipments/:id/otp/verify`: the recipient's six digits. */
export class VerifyOtpDto {
  @ApiProperty({
    example: '048291',
    description: 'The six-digit code the customer received by email.',
  })
  @Matches(/^\d{6}$/, {
    message: 'code must be the six digits the customer received',
  })
  code: string;
}
