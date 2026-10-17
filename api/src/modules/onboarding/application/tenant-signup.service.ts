import { ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthService, type AuthResult } from '../../identity/application/auth.service.js';
import { PricingRulesService } from '../../pricing/application/pricing-rules.service.js';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import type { Tenant } from '../../tenants/domain/tenant.js';

export interface RegisterCompanyInput {
  companyName: string;
  email: string;
  password: string;
  name?: string | null;
}

/**
 * The rate card every self-service company starts with.
 *
 * A tenant with no active pricing rule cannot quote or ship
 * (`NO_ACTIVE_PRICING_RULE`), so a founder who signed up would hit a dead end
 * on their very first booking. Provisioning a sensible standard rate means a
 * new company can ship immediately and refine its pricing later; the values
 * mirror the demo tenants' entry-level card.
 */
const DEFAULT_RATE_CARD = {
  name: 'Standard rate',
  baseFeeMinor: 50_000,
  perKmMinor: 12_000,
  perKgMinor: 2_000,
  minFeeMinor: 80_000,
  priority: 0,
} as const;

/**
 * Self-service company sign-up.
 *
 * It orchestrates the three things a new tenant needs, in order: the tenant
 * itself ({@link TenantsService}), a default rate card so it can ship
 * immediately ({@link PricingRulesService}), and its first administrator with a
 * ready session ({@link AuthService}). It lives in its own module precisely
 * because it sits in front of all three — a module they can depend on without
 * any of them depending back on it.
 */
@Injectable()
export class TenantSignupService {
  constructor(
    private readonly tenants: TenantsService,
    private readonly pricing: PricingRulesService,
    private readonly auth: AuthService,
  ) {}

  async register(input: RegisterCompanyInput): Promise<AuthResult> {
    const tenant = await this.createTenant(input.companyName);
    await this.pricing.create(tenant.id, { ...DEFAULT_RATE_CARD });
    return this.auth.registerTenantAdmin({
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      email: input.email,
      password: input.password,
      name: input.name ?? null,
    });
  }

  private async createTenant(name: string): Promise<Tenant> {
    const base = slugify(name);
    try {
      return await this.tenants.create({ name, slug: base });
    } catch (error) {
      if (!isSlugTaken(error)) {
        throw error;
      }
      // The company name maps to a taken slug; append a short random suffix
      // rather than failing the sign-up over a URL clash.
      return this.tenants.create({
        name,
        slug: `${base}-${randomBytes(2).toString('hex')}`,
      });
    }
  }
}

/** URL-safe slug; matches the tenant slug rule (lowercase, digits, hyphens). */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // Leave room for a `-xxxx` collision suffix under the 60-char limit.
    .slice(0, 50)
    .replace(/-+$/g, '');
  return slug || 'company';
}

function isSlugTaken(error: unknown): boolean {
  return (
    error instanceof ConflictException &&
    (error.getResponse() as { code?: string }).code === 'TENANT_SLUG_TAKEN'
  );
}
