import { ConflictException } from '@nestjs/common';
import type { AuthResult, AuthService } from '../../identity/application/auth.service.js';
import type { PricingRulesService } from '../../pricing/application/pricing-rules.service.js';
import type { CreatePricingRuleInput } from '../../pricing/domain/pricing-rule.js';
import type { TenantsService } from '../../tenants/application/tenants.service.js';
import type { CreateTenantInput, Tenant } from '../../tenants/domain/tenant.js';
import { TenantSignupService } from './tenant-signup.service.js';

interface Harness {
  service: TenantSignupService;
  createTenantCalls: CreateTenantInput[];
  pricingCalls: Array<{ tenantId: string; input: CreatePricingRuleInput }>;
  authCalls: Array<Record<string, unknown>>;
}

function tenant(input: CreateTenantInput): Tenant {
  return {
    id: `t-${input.slug}`,
    name: input.name,
    slug: input.slug,
    status: 'active',
    plan: input.plan ?? 'free',
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function slugTaken(): ConflictException {
  return new ConflictException({
    message: 'taken',
    code: 'TENANT_SLUG_TAKEN',
  });
}

function makeHarness(options: { takenSlugs?: string[] } = {}): Harness {
  const taken = new Set(options.takenSlugs ?? []);
  const createTenantCalls: CreateTenantInput[] = [];
  const pricingCalls: Array<{ tenantId: string; input: CreatePricingRuleInput }> = [];
  const authCalls: Array<Record<string, unknown>> = [];

  const tenants = {
    create: async (input: CreateTenantInput) => {
      createTenantCalls.push(input);
      if (taken.has(input.slug)) {
        throw slugTaken();
      }
      return tenant(input);
    },
  } as unknown as TenantsService;

  const pricing = {
    create: async (tenantId: string, input: CreatePricingRuleInput) => {
      pricingCalls.push({ tenantId, input });
      return { id: 'r-1' };
    },
  } as unknown as PricingRulesService;

  const auth = {
    registerTenantAdmin: async (input: Record<string, unknown>) => {
      authCalls.push(input);
      return { accessToken: 'a', refreshToken: 'r', expiresIn: 900 } as AuthResult;
    },
  } as unknown as AuthService;

  return {
    service: new TenantSignupService(tenants, pricing, auth),
    createTenantCalls,
    pricingCalls,
    authCalls,
  };
}

describe('TenantSignupService', () => {
  it('derives a slug, provisions a default rate card, and registers the admin', async () => {
    const h = makeHarness();

    const result = await h.service.register({
      companyName: 'Northwind Logistics',
      email: 'founder@example.com',
      password: 'new-password-123',
      name: 'Ada',
    });

    expect(h.createTenantCalls).toEqual([
      { name: 'Northwind Logistics', slug: 'northwind-logistics' },
    ]);
    // Without a rate card a new tenant cannot quote or ship.
    expect(h.pricingCalls).toHaveLength(1);
    expect(h.pricingCalls[0].tenantId).toBe('t-northwind-logistics');
    expect(h.pricingCalls[0].input).toMatchObject({
      name: 'Standard rate',
      baseFeeMinor: 50_000,
      perKmMinor: 12_000,
      perKgMinor: 2_000,
      minFeeMinor: 80_000,
    });

    expect(h.authCalls[0]).toMatchObject({
      tenantId: 't-northwind-logistics',
      tenantName: 'Northwind Logistics',
      tenantSlug: 'northwind-logistics',
      email: 'founder@example.com',
    });
    expect(result.accessToken).toBe('a');
  });

  it('normalizes accents and punctuation into a URL-safe slug', async () => {
    const h = makeHarness();

    await h.service.register({
      companyName: "Étoile & Fils, Côte d'Ivoire",
      email: 'x@example.com',
      password: 'new-password-123',
    });

    expect(h.createTenantCalls[0].slug).toBe('etoile-fils-cote-d-ivoire');
  });

  it('falls back to a short suffix when the slug is taken', async () => {
    const h = makeHarness({ takenSlugs: ['northwind-logistics'] });

    await h.service.register({
      companyName: 'Northwind Logistics',
      email: 'founder@example.com',
      password: 'new-password-123',
    });

    expect(h.createTenantCalls).toHaveLength(2);
    expect(h.createTenantCalls[1].slug).toMatch(/^northwind-logistics-[0-9a-f]{4}$/);
    expect(h.pricingCalls[0].tenantId).toBe(
      `t-${h.createTenantCalls[1].slug}`,
    );
  });

  it('rethrows conflicts that are not a taken slug', async () => {
    const tenants = {
      create: async () => {
        throw new ConflictException({ code: 'SOMETHING_ELSE' });
      },
    } as unknown as TenantsService;
    const service = new TenantSignupService(
      tenants,
      {} as PricingRulesService,
      {} as AuthService,
    );

    await expect(
      service.register({
        companyName: 'Northwind',
        email: 'founder@example.com',
        password: 'new-password-123',
      }),
    ).rejects.toMatchObject({ response: { code: 'SOMETHING_ELSE' } });
  });
});
