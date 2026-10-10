import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VEHICLE_STATUSES, VEHICLE_TYPES } from '../../domain/vehicle.js';
import type { VehicleStatus, VehicleType } from '../../domain/vehicle.js';

export class CreateVehicleDto {
  @ApiProperty({ example: 'KTU-123A' })
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  plate: string;

  @ApiProperty({ enum: VEHICLE_TYPES })
  @IsIn(VEHICLE_TYPES)
  type: VehicleType;

  @ApiProperty({ example: 1500, description: 'Payload capacity in kilograms.' })
  @IsNumber()
  @Min(0)
  capacityWeightKg: number;

  @ApiProperty({ example: 12.5, description: 'Cargo volume in cubic meters.' })
  @IsNumber()
  @Min(0)
  capacityVolumeM3: number;

  @ApiPropertyOptional({ enum: VEHICLE_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(VEHICLE_STATUSES)
  status?: VehicleStatus;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  plate?: string;

  @ApiPropertyOptional({ enum: VEHICLE_TYPES })
  @IsOptional()
  @IsIn(VEHICLE_TYPES)
  type?: VehicleType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  capacityWeightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  capacityVolumeM3?: number;

  @ApiPropertyOptional({ enum: VEHICLE_STATUSES })
  @IsOptional()
  @IsIn(VEHICLE_STATUSES)
  status?: VehicleStatus;
}
