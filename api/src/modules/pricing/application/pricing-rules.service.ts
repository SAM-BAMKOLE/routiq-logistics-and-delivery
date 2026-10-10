import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreatePricingRuleInput,
  PricingRule,
  UpdatePricingRuleInput,
} from '../domain/pricing-rule.js';
import {
  PRICING_RULE_REPOSITORY,
  type PricingRuleRepository,
} from '../domain/pricing-rule.repository.js';

/**
 * Application service for tenant rate cards. Only tenant admins manage
 * rules; the quote engine itself is pure and lives in `domain/quote.ts`.
 */
@Injectable()
export class PricingRulesService {
  constructor(
    @Inject(PRICING_RULE_REPOSITORY)
    private readonly rules: PricingRuleRepository,
  ) {}

  create(tenantId: string, input: CreatePricingRuleInput): Promise<PricingRule> {
    return this.rules.create(tenantId, input);
  }

  list(tenantId: string): Promise<PricingRule[]> {
    return this.rules.listByTenant(tenantId);
  }

  async getById(tenantId: string, id: string): Promise<PricingRule> {
    const rule = await this.rules.findById(id);
    if (!rule || rule.tenantId !== tenantId) {
      throw ruleNotFound(id);
    }
    return rule;
  }

  async update(
    tenantId: string,
    id: string,
    changes: UpdatePricingRuleInput,
  ): Promise<PricingRule> {
    await this.getById(tenantId, id);
    const updated = await this.rules.update(id, changes);
    if (!updated) {
      throw ruleNotFound(id);
    }
    return updated;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.getById(tenantId, id);
    await this.rules.remove(id);
  }
}

function ruleNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Pricing rule ${id} was not found in this tenant.`,
    code: 'PRICING_RULE_NOT_FOUND',
  });
}
