import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MONEY_MIN = 0;

export class CreatePricingRuleDto {
  @ApiProperty({ example: 'Lagos standard rate', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 50000, description: 'Base fee in minor units.' })
  @IsOptional()
  @IsInt()
  @Min(MONEY_MIN)
  baseFeeMinor?: number;

  @ApiPropertyOptional({ example: 150000, description: 'Fee per kilometer, minor units.' })
  @IsOptional()
  @IsInt()
  @Min(MONEY_MIN)
  perKmMinor?: number;

  @ApiPropertyOptional({ example: 2000, description: 'Fee per kilogram, minor units.' })
  @IsOptional()
  @IsInt()
  @Min(MONEY_MIN)
  perKgMinor?: number;

  @ApiPropertyOptional({ example: 100000, description: 'Price floor, minor units.' })
  @IsOptional()
  @IsInt()
  @Min(MONEY_MIN)
  minFeeMinor?: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Highest priority wins when several rules are active.',
  })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  activeFrom?: string;
}

export class UpdatePricingRuleDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(MONEY_MIN)
  baseFeeMinor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(MONEY_MIN)
  perKmMinor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(MONEY_MIN)
  perKgMinor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(MONEY_MIN)
  minFeeMinor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  activeFrom?: string;
}

export class QuoteRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Pickup address of the quote.' })
  @IsUUID()
  pickupAddressId: string;

  @ApiProperty({ format: 'uuid', description: 'Drop-off address of the quote.' })
  @IsUUID()
  dropoffAddressId: string;

  @ApiProperty({ example: 12.5, description: 'Total weight in kilograms.' })
  @IsPositive()
  weightKg: number;
}
