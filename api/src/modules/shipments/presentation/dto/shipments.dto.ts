import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SHIPMENT_STATUSES } from '../../domain/shipment-status.js';
import type { ShipmentStatus } from '../../domain/shipment-status.js';

export class ShipmentItemDto {
  @ApiProperty({ example: '10 cartons of bottled water', maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description: string;

  @ApiProperty({ example: 10, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ example: 120, description: 'Line weight in kilograms.' })
  @IsOptional()
  @IsPositive()
  weightKg?: number;
}

export class CreateShipmentDto {
  @ApiProperty({ format: 'uuid', description: 'Customer the shipment is for.' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pickupAddressId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dropoffAddressId: string;

  @ApiProperty({ example: 120, description: 'Total weight in kilograms.' })
  @IsPositive()
  weightKg: number;

  @ApiPropertyOptional({ example: 1.5, description: 'Total volume in cubic meters.' })
  @IsOptional()
  @IsPositive()
  volumeM3?: number;

  @ApiPropertyOptional({ example: '2026-10-12T08:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  windowStart?: string;

  @ApiPropertyOptional({ example: '2026-10-12T17:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  windowEnd?: string;

  @ApiPropertyOptional({ type: [ShipmentItemDto], maxItems: 50 })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ShipmentItemDto)
  @ArrayMaxSize(50)
  items?: ShipmentItemDto[];

  @ApiPropertyOptional({
    type: [String],
    example: ['express', 'fragile'],
    description:
      'Rate-card surcharge codes to opt into when this shipment is priced.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  surchargeCodes?: string[];
}

export class ListShipmentsQueryDto {
  @ApiPropertyOptional({ enum: SHIPMENT_STATUSES })
  @IsOptional()
  @IsIn(SHIPMENT_STATUSES)
  status?: ShipmentStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class AssignShipmentDto {
  @ApiProperty({ format: 'uuid', description: 'Driver taking the shipment.' })
  @IsUUID()
  driverId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Vehicle used for the run.' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}

export class ReasonDto {
  @ApiPropertyOptional({ example: 'customer away', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class FailShipmentDto {
  @ApiProperty({ example: 'address not found', maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
