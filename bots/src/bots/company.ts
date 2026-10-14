import type {
  SeededAddress,
  SeededCompany,
  SeededCustomer,
  SeededVehicle,
} from '../config.js';
import { RoutiqClient } from '../http.js';
import { Logger, money } from '../logger.js';
import type { Quote, Shipment } from '../types.js';

export interface ShipmentPlan {
  customer: SeededCustomer;
  pickup: SeededAddress;
  dropoff: SeededAddress;
  weightKg: number;
  volumeM3: number | null;
}

/**
 * CompanyAgent behaves like a logistics company's back-office operator: it
 * logs in as the tenant admin, quotes a lane, books a shipment and confirms it.
 */
export class CompanyAgent {
  readonly client: RoutiqClient;
  readonly log: Logger;
  tenantSlug = '';

  constructor(
    private readonly company: SeededCompany,
    baseUrl: string,
    private readonly password: string,
  ) {
    this.log = new Logger(`${company.slug}:admin`, 'cyan');
    this.client = new RoutiqClient(baseUrl, this.log);
  }

  async connect(): Promise<void> {
    const auth = await this.client.login(this.company.admin.email, this.password);
    this.tenantSlug = auth.tenant?.slug ?? this.company.slug;
    this.log.ok('signed in', `role=${auth.tenant?.role ?? 'n/a'}`);
  }

  /**
   * Picks a seeded customer that has both a pickup and a dropoff address, and
   * sizes the parcel to the company's own fleet. A real shipper books loads its
   * couriers can actually carry; dispatch would (correctly) refuse to offer an
   * over-capacity shipment, so the bot bounds weight and volume by the largest
   * vehicle instead of inventing a load nothing can move.
   */
  planShipment(): ShipmentPlan {
    const customer = this.company.customers.find((c) => c.addresses.length >= 2);
    if (!customer) {
      throw new Error(`Company ${this.company.slug} has no customer with two addresses.`);
    }
    const [pickup, dropoff] = customer.addresses as [SeededAddress, SeededAddress];

    const largest = (this.company.vehicles ?? []).reduce<SeededVehicle | null>(
      (best, vehicle) =>
        !best || vehicle.capacityWeightKg > best.capacityWeightKg ? vehicle : best,
      null,
    );
    const ceilingWeightKg = Math.max(1, Math.min(largest?.capacityWeightKg ?? 200, 200));
    const weightKg = Math.max(
      1,
      Math.round(2 + Math.random() * Math.max(1, ceilingWeightKg - 2)),
    );
    const capacityVolumeM3 = largest?.capacityVolumeM3 ?? null;
    const volumeM3 =
      capacityVolumeM3 && capacityVolumeM3 > 0
        ? Math.round(capacityVolumeM3 * (0.1 + Math.random() * 0.5) * 1000) / 1000
        : null;

    return { customer, pickup, dropoff, weightKg, volumeM3 };
  }

  async requestQuote(plan: ShipmentPlan): Promise<Quote> {
    const quote = await this.client.post<Quote>('/quotes', {
      pickupAddressId: plan.pickup.id,
      dropoffAddressId: plan.dropoff.id,
      weightKg: plan.weightKg,
    });
    this.log.info(
      `quote for ${plan.customer.name}`,
      `${money(quote.priceMinor, quote.currency)} over ${quote.distanceMeters ?? '?'} m`,
    );
    return quote;
  }

  async createShipment(plan: ShipmentPlan): Promise<Shipment> {
    const shipment = await this.client.post<Shipment>('/shipments', {
      customerId: plan.customer.id,
      pickupAddressId: plan.pickup.id,
      dropoffAddressId: plan.dropoff.id,
      weightKg: plan.weightKg,
      ...(plan.volumeM3 !== null ? { volumeM3: plan.volumeM3 } : {}),
      items: [
        { description: 'Standard parcel', quantity: 1, weightKg: plan.weightKg },
      ],
    });
    this.log.ok(
      `booked ${shipment.trackingNumber}`,
      `${plan.pickup.city} → ${plan.dropoff.city}, ${plan.weightKg} kg` +
        (plan.volumeM3 !== null ? ` / ${plan.volumeM3} m³` : ''),
    );
    return shipment;
  }

  async confirm(shipment: Shipment): Promise<Shipment> {
    const confirmed = await this.client.post<Shipment>(
      `/shipments/${shipment.id}/confirm`,
      undefined,
      { ifMatch: shipment.version },
    );
    this.log.ok(`confirmed ${confirmed.trackingNumber}`, `status=${confirmed.status}`);
    return confirmed;
  }
}
