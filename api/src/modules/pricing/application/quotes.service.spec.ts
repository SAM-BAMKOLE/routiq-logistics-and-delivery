import { NotFoundException } from '@nestjs/common';
import type { CustomersService } from '../../customers/application/customers.service.js';
import type { TenantsService } from '../../tenants/application/tenants.service.js';
import type { PricingRuleRepository } from '../domain/pricing-rule.repository.js';
import type { PricingRule } from '../domain/pricing-rule.js';
import { QuotesService, tenantCurrency } from './quotes.service.js';

const LAGOS = {
  id: 'a-1',
  tenantId: 't-1',
  customerId: 'c-1',
  line1: '14 Warehouse Road',
  line2: null,
  city: 'Lagos',
  region: null,
  country: 'NG',
  postalCode: null,
  latitude: 6.5244,
  longitude: 3.3792,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ABUJA = {
  ...LAGOS,
  id: 'a-2',
  line1: '1 Independence Way',
  city: 'Abuja',
  latitude: 9.0579,
  longitude: 7.4951,
};

const NO_COORDS = { ...LAGOS, id: 'a-3', latitude: null, longitude: null };

function ruleFixture(): PricingRule {
  return {
    id: 'r-1',
    tenantId: 't-1',
    name: 'Standard',
    baseFeeMinor: 50_000,
    perKmMinor: 100_000,
    perKgMinor: 1_000,
    minFeeMinor: 0,
    priority: 0,
    activeFrom: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeHarness(options: {
  addresses?: Array<typeof LAGOS>;
  rules?: PricingRule[];
  settings?: Record<string, unknown>;
}): QuotesService {
  const addresses = new Map(
    (options.addresses ?? [LAGOS, ABUJA, NO_COORDS]).map((a) => [a.id, a]),
  );
  const rulesRepo = {
    listByTenant: async () => options.rules ?? [ruleFixture()],
  } as unknown as PricingRuleRepository;
  const customers = {
    getAddressById: async (_tenantId: string, id: string) => {
      const address = addresses.get(id);
      if (!address) {
        throw new NotFoundException({
          message: `Address ${id} was not found for this customer.`,
          code: 'ADDRESS_NOT_FOUND',
        });
      }
      return address;
    },
  } as unknown as CustomersService;
  const tenants = {
    getById: async () => ({ settings: options.settings ?? {} }),
  } as unknown as TenantsService;
  return new QuotesService(rulesRepo, customers, tenants);
}

describe('QuotesService', () => {
  it('prices with the haversine distance and the tenant currency', async () => {
    const service = makeHarness({ settings: { currency: 'usd' } });
    const quote = await service.quote('t-1', {
      pickupAddressId: 'a-1',
      dropoffAddressId: 'a-2',
      weightKg: 100,
    });

    expect(quote.currency).toBe('USD');
    expect(quote.distanceMeters).toBeGreaterThan(520_000);
    expect(quote.distanceMeters).toBeLessThan(545_000);
    // base + ~533 km * per-km + 100 kg * per-kg
    expect(quote.priceMinor).toBe(
      quote.baseFeeMinor + quote.distanceFeeMinor + quote.weightFeeMinor,
    );
    expect(quote.distanceFeeMinor).toBeGreaterThan(50_000_000);
  });

  it('drops the distance fee when an address has no coordinates yet', async () => {
    const service = makeHarness({});
    const quote = await service.quote('t-1', {
      pickupAddressId: 'a-3',
      dropoffAddressId: 'a-2',
      weightKg: 20,
    });
    expect(quote.distanceMeters).toBeNull();
    expect(quote.distanceFeeMinor).toBe(0);
    expect(quote.priceMinor).toBe(70_000); // base + 20 kg
    expect(quote.currency).toBe('NGN'); // default currency
  });

  it('fails loudly when no rule applies', async () => {
    const service = makeHarness({ rules: [] });
    await expect(
      service.quote('t-1', {
        pickupAddressId: 'a-1',
        dropoffAddressId: 'a-2',
        weightKg: 1,
      }),
    ).rejects.toMatchObject({
      response: { code: 'NO_ACTIVE_PRICING_RULE' },
    });
  });

  it('propagates a missing address as a 404', async () => {
    const service = makeHarness({});
    await expect(
      service.quote('t-1', {
        pickupAddressId: 'missing',
        dropoffAddressId: 'a-2',
        weightKg: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('propagates an unknown tenant as a 404', async () => {
    const tenants = {
      getById: async () => {
        throw new NotFoundException({
          message: 'Tenant nope was not found.',
          code: 'TENANT_NOT_FOUND',
        });
      },
    } as unknown as TenantsService;
    const service = new QuotesService(
      { listByTenant: async () => [ruleFixture()] } as unknown as PricingRuleRepository,
      { getAddressById: async () => LAGOS } as unknown as CustomersService,
      tenants,
    );
    await expect(
      service.quote('nope', {
        pickupAddressId: 'a-1',
        dropoffAddressId: 'a-2',
        weightKg: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('tenantCurrency', () => {
  it('normalizes valid codes and defaults anything else to NGN', () => {
    expect(tenantCurrency({ currency: 'usd' })).toBe('USD');
    expect(tenantCurrency({ currency: 'NGN' })).toBe('NGN');
    expect(tenantCurrency({ currency: 'N' })).toBe('NGN');
    expect(tenantCurrency({ currency: 42 })).toBe('NGN');
    expect(tenantCurrency({})).toBe('NGN');
  });
});
