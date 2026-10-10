import type { PricingRule } from './pricing-rule.js';
import { evaluateQuote } from './quote.js';

function rule(overrides: Partial<PricingRule> & { id: string }): PricingRule {
  return {
    tenantId: 't-1',
    name: `Rule ${overrides.id}`,
    baseFeeMinor: 50_000,
    perKmMinor: 100_000,
    perKgMinor: 1_000,
    minFeeMinor: 0,
    priority: 0,
    activeFrom: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const NOW = new Date('2026-10-10T12:00:00Z');

describe('evaluateQuote', () => {
  it('returns null when the tenant has no rules at all', () => {
    expect(
      evaluateQuote([], { distanceMeters: 1000, weightKg: 5, currency: 'NGN' }, NOW),
    ).toBeNull();
  });

  it('ignores rules that are not yet active', () => {
    const future = rule({ id: 'r-1', activeFrom: new Date('2026-12-01T00:00:00Z') });
    expect(
      evaluateQuote([future], { distanceMeters: 1000, weightKg: 5, currency: 'NGN' }, NOW),
    ).toBeNull();
  });

  it('computes base + distance + weight and echoes the inputs', () => {
    const breakdown = evaluateQuote(
      [rule({ id: 'r-1' })],
      { distanceMeters: 2_000, weightKg: 10, currency: 'NGN' },
      NOW,
    );

    expect(breakdown).toMatchObject({
      ruleId: 'r-1',
      baseFeeMinor: 50_000,
      distanceFeeMinor: 200_000, // 2 km * 100_000 per km
      weightFeeMinor: 10_000, // 10 kg * 1_000 per kg
      subtotalMinor: 260_000,
      priceMinor: 260_000,
      currency: 'NGN',
    });
  });

  it('floors the price at the minimum fee', () => {
    const breakdown = evaluateQuote(
      [rule({ id: 'r-1', minFeeMinor: 300_000 })],
      { distanceMeters: 1_000, weightKg: 1, currency: 'NGN' },
      NOW,
    );
    expect(breakdown?.subtotalMinor).toBe(151_000);
    expect(breakdown?.priceMinor).toBe(300_000);
  });

  it('prices without a distance when addresses lack coordinates', () => {
    const breakdown = evaluateQuote(
      [rule({ id: 'r-1' })],
      { distanceMeters: null, weightKg: 20, currency: 'NGN' },
      NOW,
    );
    expect(breakdown?.distanceMeters).toBeNull();
    expect(breakdown?.distanceFeeMinor).toBe(0);
    expect(breakdown?.priceMinor).toBe(70_000); // base + 20 kg
  });

  it('rounds fractional fees to whole minor units', () => {
    const breakdown = evaluateQuote(
      [rule({ id: 'r-1', perKmMinor: 333, perKgMinor: 111 })],
      { distanceMeters: 1_234, weightKg: 1.5, currency: 'NGN' },
      NOW,
    );
    expect(breakdown?.distanceFeeMinor).toBe(Math.round(333 * 1.234));
    expect(breakdown?.weightFeeMinor).toBe(Math.round(111 * 1.5));
  });

  it('picks the highest-priority active rule', () => {
    const breakdown = evaluateQuote(
      [
        rule({ id: 'r-low', priority: 1, baseFeeMinor: 1 }),
        rule({ id: 'r-high', priority: 9, baseFeeMinor: 2 }),
      ],
      { distanceMeters: null, weightKg: 1, currency: 'NGN' },
      NOW,
    );
    expect(breakdown?.ruleId).toBe('r-high');
  });

  it('breaks priority ties toward the most recently activated rule', () => {
    const breakdown = evaluateQuote(
      [
        rule({ id: 'r-old', priority: 5, activeFrom: new Date('2026-01-01T00:00:00Z') }),
        rule({ id: 'r-new', priority: 5, activeFrom: new Date('2026-06-01T00:00:00Z') }),
      ],
      { distanceMeters: null, weightKg: 1, currency: 'NGN' },
      NOW,
    );
    expect(breakdown?.ruleId).toBe('r-new');
  });

  it('stays deterministic when everything ties', () => {
    const rules = [rule({ id: 'r-b' }), rule({ id: 'r-a' })];
    const first = evaluateQuote(rules, { distanceMeters: null, weightKg: 1, currency: 'NGN' }, NOW);
    const second = evaluateQuote([...rules].reverse(), { distanceMeters: null, weightKg: 1, currency: 'NGN' }, NOW);
    expect(first?.ruleId).toBe('r-a');
    expect(second?.ruleId).toBe('r-a');
  });
});
