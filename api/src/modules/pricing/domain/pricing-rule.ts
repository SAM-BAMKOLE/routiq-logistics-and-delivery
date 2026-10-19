/** How a {@link PricingSurcharge} changes a quote. */
export const SURCHARGE_KINDS = ['percent', 'flat'] as const;
export type SurchargeKind = (typeof SURCHARGE_KINDS)[number];

/**
 * A named price adjustment on a rate card that a booking may opt into: an
 * express-delivery speed premium, a difficult-road/terrain premium, a fragile
 * or refrigerated handling fee, and so on.
 *
 * `value` is basis points for a `percent` surcharge (2500 = +25% of the
 * subtotal) and minor units for a `flat` one. `code` is the stable machine
 * key a booking sends; `label` is what a customer sees on the quote.
 */
export interface PricingSurcharge {
  readonly code: string;
  readonly label: string;
  readonly kind: SurchargeKind;
  readonly value: number;
}

/**
 * The catalogue every new rate card starts with: two multipliers (delivery
 * speed and road/terrain difficulty) and three flat handling fees. A tenant
 * can edit, remove, or extend them. Nothing is applied unless a booking opts
 * in, so the defaults never change a price on their own.
 */
export const DEFAULT_SURCHARGES: readonly PricingSurcharge[] = [
  { code: 'express', label: 'Express delivery', kind: 'percent', value: 2500 },
  {
    code: 'difficult_road',
    label: 'Difficult road / terrain',
    kind: 'percent',
    value: 1500,
  },
  { code: 'fragile', label: 'Fragile handling', kind: 'flat', value: 150_000 },
  {
    code: 'refrigerated',
    label: 'Refrigerated / cold chain',
    kind: 'flat',
    value: 250_000,
  },
  {
    code: 'hazardous',
    label: 'Hazardous materials',
    kind: 'flat',
    value: 300_000,
  },
];

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
  /** Optional, named price adjustments a booking can opt into. */
  readonly surcharges: readonly PricingSurcharge[];
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
  surcharges?: readonly PricingSurcharge[];
}

export interface UpdatePricingRuleInput {
  name?: string;
  baseFeeMinor?: number;
  perKmMinor?: number;
  perKgMinor?: number;
  minFeeMinor?: number;
  priority?: number;
  activeFrom?: Date;
  surcharges?: readonly PricingSurcharge[];
}
