import type { PricingRule } from './pricing-rule.js';

/** What a quote is computed from: distance (meters, nullable) and weight. */
export interface QuoteRequest {
  /** Route distance in meters; null when coordinates are not known yet. */
  readonly distanceMeters: number | null;
  readonly weightKg: number;
  readonly currency: string;
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
  readonly minFeeMinor: number;
  readonly priceMinor: number;
  readonly currency: string;
}

/**
 * The quote engine: pure functions over pricing rules, no framework imports.
 *
 * Selection: among rules whose `activeFrom` has passed, the highest priority
 * wins; ties break toward the most recently activated rule, then by id so the
 * outcome is deterministic. Price is `base + per-km * km + per-kg * kg`,
 * floored at the rule's minimum fee. A missing distance (addresses without
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
  const rule = selectRule(rules, quoteAt);
  if (!rule) {
    return null;
  }

  const distanceKm =
    request.distanceMeters === null ? null : request.distanceMeters / 1000;
  const distanceFeeMinor =
    distanceKm === null ? 0 : Math.round(rule.perKmMinor * distanceKm);
  const weightFeeMinor = Math.round(rule.perKgMinor * request.weightKg);
  const subtotalMinor =
    rule.baseFeeMinor + distanceFeeMinor + weightFeeMinor;

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    distanceMeters: request.distanceMeters,
    weightKg: request.weightKg,
    baseFeeMinor: rule.baseFeeMinor,
    distanceFeeMinor,
    weightFeeMinor,
    subtotalMinor,
    minFeeMinor: rule.minFeeMinor,
    priceMinor: Math.max(subtotalMinor, rule.minFeeMinor),
    currency: request.currency,
  };
}

function selectRule(
  rules: readonly PricingRule[],
  quoteAt: Date,
): PricingRule | null {
  const applicable = rules.filter((rule) => rule.activeFrom <= quoteAt);
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
