import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  DRIVER_AVAILABILITY,
  DRIVER_STATUSES,
} from '../../domain/driver.js';
import type {
  DriverAvailability,
  DriverStatus,
} from '../../domain/driver.js';

export class CreateDriverDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Membership of the driver. Must belong to the active tenant.',
  })
  @IsUUID()
  membershipId: string;

  @ApiProperty({ example: 'DL-LAG-004821' })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  licenseNo: string;

  @ApiPropertyOptional({ enum: DRIVER_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(DRIVER_STATUSES)
  status?: DriverStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Vehicle currently assigned to the driver.',
  })
  @IsOptional()
  @IsUUID()
  currentVehicleId?: string;
}

export class UpdateDriverDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  licenseNo?: string;

  @ApiPropertyOptional({ enum: DRIVER_STATUSES })
  @IsOptional()
  @IsIn(DRIVER_STATUSES)
  status?: DriverStatus;

  @ApiPropertyOptional({ enum: DRIVER_AVAILABILITY })
  @IsOptional()
  @IsIn(DRIVER_AVAILABILITY)
  availability?: DriverAvailability;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  currentVehicleId?: string | null;
}

export class SetAvailabilityDto {
  @ApiProperty({ enum: DRIVER_AVAILABILITY })
  @IsIn(DRIVER_AVAILABILITY)
  availability: DriverAvailability;
}

export class CreateShiftDto {
  @ApiProperty({ example: '2026-10-12T06:00:00.000Z' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: '2026-10-12T14:00:00.000Z' })
  @IsDateString()
  endsAt: string;
}
