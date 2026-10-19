import type {
  PricingRule,
  PricingSurcharge,
  SurchargeKind,
} from './pricing-rule.js';

/** What a quote is computed from: distance (meters, nullable) and weight. */
export interface QuoteRequest {
  /** Route distance in meters; null when coordinates are not known yet. */
  readonly distanceMeters: number | null;
  readonly weightKg: number;
  readonly currency: string;
  /**
   * Codes of the rate card's surcharges the booking opts into. Unknown codes
   * are ignored (the caller decides which codes to offer) and repeats are
   * collapsed, so the result never depends on request order.
   */
  readonly surchargeCodes?: readonly string[];
}

/** One opted-in surcharge and what it contributed to the price. */
export interface AppliedSurcharge {
  readonly code: string;
  readonly label: string;
  readonly kind: SurchargeKind;
  /** Basis points when `percent`, minor units when `flat` - as configured. */
  readonly value: number;
  /** Minor units this surcharge added to the price. */
  readonly amountMinor: number;
}

/** The full arithmetic of a quote, ready to show a customer. */
export interface QuoteBreakdown {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly distanceMeters: number | null;
  readonly weightKg: number;
  readonly baseFeeMinor: number;
  readonly distanceFeeMinor: number;
  readonly weightFeeMinor: number;
  readonly subtotalMinor: number;
  readonly surcharges: readonly AppliedSurcharge[];
  readonly surchargeFeeMinor: number;
  readonly minFeeMinor: number;
  readonly priceMinor: number;
  readonly currency: string;
}

/**
 * The quote engine: pure functions over pricing rules, no framework imports.
 *
 * Price is `base + per-km * km + per-kg * kg`, plus any surcharges the booking
 * opted into (percent ones off the subtotal, flat ones at face value), floored
 * at the rule's minimum fee. A missing distance (addresses without
 * coordinates) contributes no distance fee rather than failing the quote -
 * the shipment can still be priced by base and weight, and routing will fill
 * in road distances later.
 *
 * Returns null when the tenant has no applicable rule; the caller turns that
 * into an explicit error, because silently pricing a shipment at zero would
 * be the one bug a pricing engine must never have.
 */
export function evaluateQuote(
  rules: readonly PricingRule[],
  request: QuoteRequest,
  quoteAt: Date = new Date(),
): QuoteBreakdown | null {
  const rule = activeRule(rules, quoteAt);
  if (!rule) {
    return null;
  }

  const distanceKm =
    request.distanceMeters === null ? null : request.distanceMeters / 1000;
  const distanceFeeMinor =
    distanceKm === null ? 0 : Math.round(rule.perKmMinor * distanceKm);
  const weightFeeMinor = Math.round(rule.perKgMinor * request.weightKg);
  const subtotalMinor = rule.baseFeeMinor + distanceFeeMinor + weightFeeMinor;

  const surcharges = applySurcharges(
    rule.surcharges,
    request.surchargeCodes,
    subtotalMinor,
  );
  const surchargeFeeMinor = surcharges.reduce(
    (sum, surcharge) => sum + surcharge.amountMinor,
    0,
  );

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    distanceMeters: request.distanceMeters,
    weightKg: request.weightKg,
    baseFeeMinor: rule.baseFeeMinor,
    distanceFeeMinor,
    weightFeeMinor,
    subtotalMinor,
    surcharges,
    surchargeFeeMinor,
    minFeeMinor: rule.minFeeMinor,
    priceMinor: Math.max(subtotalMinor + surchargeFeeMinor, rule.minFeeMinor),
    currency: request.currency,
  };
}

/**
 * The rule that prices a quote at `at`: among rules whose `activeFrom` has
 * passed, the highest priority wins; ties break toward the most recently
 * activated rule, then by id so the outcome is deterministic.
 */
export function activeRule(
  rules: readonly PricingRule[],
  at: Date = new Date(),
): PricingRule | null {
  const applicable = rules.filter((rule) => rule.activeFrom <= at);
  if (applicable.length === 0) {
    return null;
  }
  return [...applicable].sort(
    (a, b) =>
      b.priority - a.priority ||
      b.activeFrom.getTime() - a.activeFrom.getTime() ||
      a.id.localeCompare(b.id),
  )[0];
}

/**
 * Resolves the codes a booking opted into against the rate card's catalogue.
 * Percent surcharges are computed off the subtotal - each rounded once, then
 * summed, so the total always equals the sum of the printed lines; flat ones
 * add their configured amount. Catalogue order is preserved.
 */
function applySurcharges(
  catalogue: readonly PricingSurcharge[],
  codes: readonly string[] | undefined,
  subtotalMinor: number,
): AppliedSurcharge[] {
  if (!codes || codes.length === 0) {
    return [];
  }
  const optedIn = new Set(codes);
  return catalogue
    .filter((surcharge) => optedIn.has(surcharge.code))
    .map((surcharge) => ({
      code: surcharge.code,
      label: surcharge.label,
      kind: surcharge.kind,
      value: surcharge.value,
      amountMinor:
        surcharge.kind === 'percent'
          ? Math.round((subtotalMinor * surcharge.value) / 10_000)
          : surcharge.value,
    }));
}
