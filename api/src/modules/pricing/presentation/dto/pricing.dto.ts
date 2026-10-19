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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SURCHARGE_KINDS } from '../../domain/pricing-rule.js';
import type { SurchargeKind } from '../../domain/pricing-rule.js';

const MONEY_MIN = 0;

/** Surcharge value cap (10,000 bp = +100%, or 1bn minor units when flat). */
const SURCHARGE_VALUE_MAX = 1_000_000_000;

/**
 * One named price adjustment on a rate card. `value` is basis points for a
 * `percent` surcharge and minor units for a `flat` one; the domain re-checks
 * the shape, this only rejects obvious junk at the edge.
 */
export class PricingSurchargeDto {
  @ApiProperty({ example: 'express', maxLength: 40 })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code: string;

  @ApiProperty({ example: 'Express delivery', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label: string;

  @ApiProperty({ enum: SURCHARGE_KINDS })
  @IsIn(SURCHARGE_KINDS)
  kind: SurchargeKind;

  @ApiProperty({
    example: 2500,
    description: 'Basis points when percent; minor units when flat.',
  })
  @IsInt()
  @Min(0)
  @Max(SURCHARGE_VALUE_MAX)
  value: number;
}

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

  @ApiPropertyOptional({
    type: [PricingSurchargeDto],
    description:
      'Surcharge catalogue for this rate card. Omit to start from the stock list.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PricingSurchargeDto)
  surcharges?: PricingSurchargeDto[];
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

  @ApiPropertyOptional({ type: [PricingSurchargeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PricingSurchargeDto)
  surcharges?: PricingSurchargeDto[];
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

  @ApiPropertyOptional({
    type: [String],
    example: ['express', 'fragile'],
    description: 'Rate-card surcharge codes to opt into.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  surchargeCodes?: string[];
}
