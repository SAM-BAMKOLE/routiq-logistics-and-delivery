import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { TenantSignupService } from './application/tenant-signup.service.js';
import { TenantSignupController } from './presentation/tenant-signup.controller.js';

/**
 * Self-service onboarding: turning a company name into a working tenant.
 *
 * It is its own module because it is the one place that needs all three of the
 * tenant registry, identity, and pricing — while none of those may depend on
 * it. Folding it into any of them would either invert a dependency (identity
 * does not create tenants) or close a cycle (`PricingModule` already imports
 * `TenantsModule` for `QuotesService`).
 */
@Module({
  imports: [TenantsModule, IdentityModule, PricingModule],
  controllers: [TenantSignupController],
  providers: [TenantSignupService],
})
export class OnboardingModule {}
