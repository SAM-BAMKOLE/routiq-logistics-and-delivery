import { ApiProperty } from '@nestjs/swagger';
import { SURCHARGE_KINDS } from '../../domain/pricing-rule.js';
import type {
  PricingRule,
  PricingSurcharge,
  SurchargeKind,
} from '../../domain/pricing-rule.js';
import type { AppliedSurcharge, QuoteBreakdown } from '../../domain/quote.js';

export class PricingSurchargeResponseDto {
  @ApiProperty({ example: 'express' })
  code: string;

  @ApiProperty({ example: 'Express delivery' })
  label: string;

  @ApiProperty({ enum: SURCHARGE_KINDS })
  kind: SurchargeKind;

  @ApiProperty({
    example: 2500,
    description: 'Basis points when percent; minor units when flat.',
  })
  value: number;

  static from(surcharge: PricingSurcharge): PricingSurchargeResponseDto {
    return {
      code: surcharge.code,
      label: surcharge.label,
      kind: surcharge.kind,
      value: surcharge.value,
    };
  }
}

export class AppliedSurchargeResponseDto {
  @ApiProperty({ example: 'express' })
  code: string;

  @ApiProperty({ example: 'Express delivery' })
  label: string;

  @ApiProperty({ enum: SURCHARGE_KINDS })
  kind: SurchargeKind;

  @ApiProperty()
  value: number;

  @ApiProperty({ description: 'Minor units this surcharge added to the price.' })
  amountMinor: number;

  static from(surcharge: AppliedSurcharge): AppliedSurchargeResponseDto {
    return {
      code: surcharge.code,
      label: surcharge.label,
      kind: surcharge.kind,
      value: surcharge.value,
      amountMinor: surcharge.amountMinor,
    };
  }
}

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

  @ApiProperty({ type: [PricingSurchargeResponseDto] })
  surcharges: PricingSurchargeResponseDto[];

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
      surcharges: rule.surcharges.map((surcharge) =>
        PricingSurchargeResponseDto.from(surcharge),
      ),
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}

export class PricingRuleListResponseDto {
  @ApiProperty({ type: [PricingRuleResponseDto] })
  data: PricingRuleResponseDto[];
}

/**
 * The surcharge catalogue of the tenant's active rate card, for the booking
 * form. `ruleId`/`ruleName` are null when the tenant has no active rule.
 */
export class SurchargeCatalogResponseDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  ruleId: string | null;

  @ApiProperty({ nullable: true })
  ruleName: string | null;

  @ApiProperty({ type: [PricingSurchargeResponseDto] })
  surcharges: PricingSurchargeResponseDto[];

  static from(catalog: {
    ruleId: string | null;
    ruleName: string | null;
    surcharges: readonly PricingSurcharge[];
  }): SurchargeCatalogResponseDto {
    return {
      ruleId: catalog.ruleId,
      ruleName: catalog.ruleName,
      surcharges: catalog.surcharges.map((surcharge) =>
        PricingSurchargeResponseDto.from(surcharge),
      ),
    };
  }
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

  @ApiProperty({ type: [AppliedSurchargeResponseDto] })
  surcharges: AppliedSurchargeResponseDto[];

  @ApiProperty({ description: 'Total added by the opted-in surcharges.' })
  surchargeFeeMinor: number;

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
      surcharges: breakdown.surcharges.map((surcharge) =>
        AppliedSurchargeResponseDto.from(surcharge),
      ),
      surchargeFeeMinor: breakdown.surchargeFeeMinor,
      minFeeMinor: breakdown.minFeeMinor,
    };
  }
}
