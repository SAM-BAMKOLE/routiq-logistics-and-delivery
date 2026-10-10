/**
 * A tenant rate card in domain terms. All money is integer minor units
 * (kobo, cents): the engine never rounds a stored value. A rule applies from
 * `activeFrom` onwards; among the applicable ones the highest `priority`
 * wins.
 */
export interface PricingRule {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly baseFeeMinor: number;
  readonly perKmMinor: number;
  readonly perKgMinor: number;
  readonly minFeeMinor: number;
  readonly priority: number;
  readonly activeFrom: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePricingRuleInput {
  name: string;
  baseFeeMinor?: number;
  perKmMinor?: number;
  perKgMinor?: number;
  minFeeMinor?: number;
  priority?: number;
  activeFrom?: Date;
}

export interface UpdatePricingRuleInput {
  name?: string;
  baseFeeMinor?: number;
  perKmMinor?: number;
  perKgMinor?: number;
  minFeeMinor?: number;
  priority?: number;
  activeFrom?: Date;
}
