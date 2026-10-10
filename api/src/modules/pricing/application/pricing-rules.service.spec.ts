import { NotFoundException } from '@nestjs/common';
import type {
  CreatePricingRuleInput,
  PricingRule,
  UpdatePricingRuleInput,
} from '../domain/pricing-rule.js';
import type { PricingRuleRepository } from '../domain/pricing-rule.repository.js';
import { PricingRulesService } from './pricing-rules.service.js';

function ruleFixture(id: string, tenantId: string): PricingRule {
  return {
    id,
    tenantId,
    name: `Rule ${id}`,
    baseFeeMinor: 50_000,
    perKmMinor: 100_000,
    perKgMinor: 1_000,
    minFeeMinor: 0,
    priority: 0,
    activeFrom: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeHarness(): {
  service: PricingRulesService;
  rules: Map<string, PricingRule>;
} {
  const rules = new Map<string, PricingRule>();
  let seq = 0;
  const repository: PricingRuleRepository = {
    create: async (tenantId: string, input: CreatePricingRuleInput) => {
      const rule: PricingRule = {
        ...ruleFixture(`r-${++seq}`, tenantId),
        name: input.name,
        baseFeeMinor: input.baseFeeMinor ?? 0,
        perKmMinor: input.perKmMinor ?? 0,
        perKgMinor: input.perKgMinor ?? 0,
        minFeeMinor: input.minFeeMinor ?? 0,
        priority: input.priority ?? 0,
        activeFrom: input.activeFrom ?? new Date(),
      };
      rules.set(rule.id, rule);
      return rule;
    },
    findById: async (id) => rules.get(id) ?? null,
    listByTenant: async (tenantId) =>
      [...rules.values()]
        .filter((rule) => rule.tenantId === tenantId)
        .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime()),
    update: async (id: string, changes: UpdatePricingRuleInput) => {
      const current = rules.get(id);
      if (!current) return null;
      const updated: PricingRule = {
        ...current,
        ...Object.fromEntries(
          Object.entries(changes).filter(([, value]) => value !== undefined),
        ),
        updatedAt: new Date(),
      } as PricingRule;
      rules.set(id, updated);
      return updated;
    },
    remove: async (id) => rules.delete(id),
  };
  return { service: new PricingRulesService(repository), rules };
}

describe('PricingRulesService', () => {
  it('creates and lists rules per tenant', async () => {
    const h = makeHarness();
    await h.service.create('t-1', { name: 'Lagos standard' });
    await h.service.create('t-1', { name: 'Express', priority: 9 });
    await h.service.create('t-2', { name: 'Other tenant' });

    const tenantOne = await h.service.list('t-1');
    expect(tenantOne).toHaveLength(2);
    expect(tenantOne.map((rule) => rule.name)).toEqual([
      'Express',
      'Lagos standard',
    ]);
  });

  it('answers 404 for foreign or unknown rule ids', async () => {
    const h = makeHarness();
    const rule = await h.service.create('t-1', { name: 'Scoped' });

    await expect(h.service.getById('t-1', rule.id)).resolves.toBeDefined();
    await expect(h.service.getById('t-2', rule.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(h.service.getById('t-1', 'missing')).rejects.toMatchObject({
      response: { code: 'PRICING_RULE_NOT_FOUND' },
    });
  });

  it('updates and removes inside the tenant only', async () => {
    const h = makeHarness();
    const rule = await h.service.create('t-1', { name: 'Base' });

    const updated = await h.service.update('t-1', rule.id, { priority: 7 });
    expect(updated.priority).toBe(7);

    await expect(
      h.service.update('t-2', rule.id, { priority: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await h.service.remove('t-1', rule.id);
    expect(await h.service.list('t-1')).toHaveLength(0);
  });
});
