import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { PricingRulesService } from './application/pricing-rules.service.js';
import { QuotesService } from './application/quotes.service.js';
import { PRICING_RULE_REPOSITORY } from './domain/pricing-rule.repository.js';
import { PricingRuleOrmEntity } from './infrastructure/pricing-rule.orm-entity.js';
import { TypeOrmPricingRuleRepository } from './infrastructure/typeorm-pricing-rule.repository.js';
import { PricingRulesController } from './presentation/pricing-rules.controller.js';
import { QuotesController } from './presentation/quotes.controller.js';

/**
 * Pricing module: tenant rate cards and the quote facade. `QuotesService` is
 * exported because Shipments calls it synchronously at creation time; the
 * quote engine itself is a pure function in `domain/quote.ts`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PricingRuleOrmEntity]),
    IdentityModule,
    CustomersModule,
    TenantsModule,
  ],
  controllers: [PricingRulesController, QuotesController],
  providers: [
    PricingRulesService,
    QuotesService,
    TypeOrmPricingRuleRepository,
    { provide: PRICING_RULE_REPOSITORY, useClass: TypeOrmPricingRuleRepository },
  ],
  exports: [QuotesService, PricingRulesService],
})
export class PricingModule {}
