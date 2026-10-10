import type {
  CreatePricingRuleInput,
  PricingRule,
  UpdatePricingRuleInput,
} from './pricing-rule.js';

/** DI token for the {@link PricingRuleRepository} port. */
export const PRICING_RULE_REPOSITORY = Symbol('PRICING_RULE_REPOSITORY');

/** Outbound port for rate-card persistence (tenant-scoped via RLS). */
export interface PricingRuleRepository {
  create(
    tenantId: string,
    input: CreatePricingRuleInput,
  ): Promise<PricingRule>;
  findById(id: string): Promise<PricingRule | null>;
  listByTenant(tenantId: string): Promise<PricingRule[]>;
  update(id: string, changes: UpdatePricingRuleInput): Promise<PricingRule | null>;
  remove(id: string): Promise<boolean>;
}
