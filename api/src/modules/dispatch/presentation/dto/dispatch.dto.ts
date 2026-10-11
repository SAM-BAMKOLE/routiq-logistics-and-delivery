import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Body of `POST /shipments/:id/assignments`: who to offer the job to. */
export class CreateAssignmentDto {
  @ApiProperty({ format: 'uuid', description: 'Driver to offer the job to.' })
  @IsUUID()
  driverId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Vehicle for the job; defaults to the driver’s own vehicle when it fits.',
  })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({
    description:
      'Offer TTL in minutes; defaults to the tenant setting. 0 expires the offer immediately.',
    minimum: 0,
    maximum: 1440,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  ttlMinutes?: number;
}

/** Body of `POST /assignments/:id/reject`. */
export class RejectAssignmentDto {
  @ApiPropertyOptional({ description: 'Why the driver passed on the job.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Body of `POST /assignments/:id/cancel`. */
export class CancelAssignmentDto {
  @ApiPropertyOptional({ description: 'Why the assignment is withdrawn.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
