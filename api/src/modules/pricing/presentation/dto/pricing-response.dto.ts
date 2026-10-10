import { ApiProperty } from '@nestjs/swagger';
import type { PricingRule } from '../../domain/pricing-rule.js';
import type { QuoteBreakdown } from '../../domain/quote.js';

export class PricingRuleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Base fee in minor units.' })
  baseFeeMinor: number;

  @ApiProperty({ description: 'Fee per kilometer, minor units.' })
  perKmMinor: number;

  @ApiProperty({ description: 'Fee per kilogram, minor units.' })
  perKgMinor: number;

  @ApiProperty({ description: 'Price floor, minor units.' })
  minFeeMinor: number;

  @ApiProperty()
  priority: number;

  @ApiProperty({ format: 'date-time' })
  activeFrom: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(rule: PricingRule): PricingRuleResponseDto {
    return {
      id: rule.id,
      name: rule.name,
      baseFeeMinor: rule.baseFeeMinor,
      perKmMinor: rule.perKmMinor,
      perKgMinor: rule.perKgMinor,
      minFeeMinor: rule.minFeeMinor,
      priority: rule.priority,
      activeFrom: rule.activeFrom.toISOString(),
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}

export class PricingRuleListResponseDto {
  @ApiProperty({ type: [PricingRuleResponseDto] })
  data: PricingRuleResponseDto[];
}

export class QuoteResponseDto {
  @ApiProperty({ description: 'Final price in minor units.' })
  priceMinor: number;

  @ApiProperty({ example: 'NGN' })
  currency: string;

  @ApiProperty({
    nullable: true,
    description: 'Haversine distance in meters; null when coordinates are unknown.',
  })
  distanceMeters: number | null;

  @ApiProperty()
  weightKg: number;

  @ApiProperty({ format: 'uuid' })
  ruleId: string;

  @ApiProperty()
  ruleName: string;

  @ApiProperty()
  baseFeeMinor: number;

  @ApiProperty()
  distanceFeeMinor: number;

  @ApiProperty()
  weightFeeMinor: number;

  @ApiProperty()
  subtotalMinor: number;

  @ApiProperty()
  minFeeMinor: number;

  static from(breakdown: QuoteBreakdown): QuoteResponseDto {
    return {
      priceMinor: breakdown.priceMinor,
      currency: breakdown.currency,
      distanceMeters:
        breakdown.distanceMeters === null
          ? null
          : Math.round(breakdown.distanceMeters),
      weightKg: breakdown.weightKg,
      ruleId: breakdown.ruleId,
      ruleName: breakdown.ruleName,
      baseFeeMinor: breakdown.baseFeeMinor,
      distanceFeeMinor: breakdown.distanceFeeMinor,
      weightFeeMinor: breakdown.weightFeeMinor,
      subtotalMinor: breakdown.subtotalMinor,
      minFeeMinor: breakdown.minFeeMinor,
    };
  }
}
