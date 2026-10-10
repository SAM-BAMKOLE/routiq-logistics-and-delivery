import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CustomersService } from '../../customers/application/customers.service.js';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import { haversineMeters } from '../domain/geo.js';
import {
  PRICING_RULE_REPOSITORY,
  type PricingRuleRepository,
} from '../domain/pricing-rule.repository.js';
import { evaluateQuote, type QuoteBreakdown } from '../domain/quote.js';

export interface QuoteInput {
  pickupAddressId: string;
  dropoffAddressId: string;
  weightKg: number;
}

/**
 * The pricing facade: Shipments calls this synchronously at creation time
 * because a quote is needed in the same request. Addresses come from the
 * customers module (never from persistence directly), the currency from the
 * tenant's settings, and the arithmetic from the pure quote engine.
 *
 * Distance is haversine over the addresses' coordinates; an address without
 * coordinates yields a distance-less quote (base and weight only) until
 * geocoding lands with routing.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(PRICING_RULE_REPOSITORY)
    private readonly rules: PricingRuleRepository,
    private readonly customers: CustomersService,
    private readonly tenants: TenantsService,
  ) {}

  async quote(tenantId: string, input: QuoteInput): Promise<QuoteBreakdown> {
    const [pickup, dropoff, rules, tenant] = await Promise.all([
      this.customers.getAddressById(tenantId, input.pickupAddressId),
      this.customers.getAddressById(tenantId, input.dropoffAddressId),
      this.rules.listByTenant(tenantId),
      this.tenants.getById(tenantId),
    ]);

    const distanceMeters =
      pickup.latitude !== null &&
      pickup.longitude !== null &&
      dropoff.latitude !== null &&
      dropoff.longitude !== null
        ? haversineMeters(
            { latitude: pickup.latitude, longitude: pickup.longitude },
            { latitude: dropoff.latitude, longitude: dropoff.longitude },
          )
        : null;

    const breakdown = evaluateQuote(
      rules,
      {
        distanceMeters,
        weightKg: input.weightKg,
        currency: tenantCurrency(tenant.settings),
      },
      new Date(),
    );
    if (!breakdown) {
      throw new UnprocessableEntityException({
        message:
          'No active pricing rule applies to this tenant. Create a rate card before quoting or shipping.',
        code: 'NO_ACTIVE_PRICING_RULE',
      });
    }
    return breakdown;
  }
}

/** The tenant's single currency (one region, one currency), default NGN. */
export function tenantCurrency(settings: Record<string, unknown>): string {
  const currency = settings['currency'];
  return typeof currency === 'string' && currency.length === 3
    ? currency.toUpperCase()
    : 'NGN';
}
