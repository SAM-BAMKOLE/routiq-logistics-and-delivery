import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PreconditionFailedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { CustomersService } from '../../customers/application/customers.service.js';
import type { Role } from '../../identity/domain/membership.js';
import { DriversService } from '../../drivers/application/drivers.service.js';
import { VehiclesService } from '../../fleet/application/vehicles.service.js';
import { QuotesService } from '../../pricing/application/quotes.service.js';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import { Shipment, ShipmentDomainError } from '../domain/shipment.js';
import { shipmentPolicyFrom } from '../domain/shipment-policy.js';
import {
  SHIPMENT_HISTORY_REPOSITORY,
  SHIPMENT_REPOSITORY,
  type ShipmentHistoryEntry,
  type ShipmentHistoryRepository,
  type ShipmentListFilters,
  type ShipmentRepository,
} from '../domain/shipment.repository.js';
import { generateTrackingNumber } from '../domain/tracking-number.js';

/** Who is acting: the authenticated principal's identity and tenant role. */
export interface ShipmentActor {
  readonly userId: string;
  readonly role: Role;
}

export interface CreateShipmentCommand {
  readonly customerId: string;
  readonly pickupAddressId: string;
  readonly dropoffAddressId: string;
  readonly weightKg: number;
  readonly volumeM3?: number | null;
  readonly windowStart?: Date | null;
  readonly windowEnd?: Date | null;
  readonly items?: ReadonlyArray<{
    description: string;
    quantity: number;
    weightKg?: number | null;
  }>;
}

/**
 * Application service for shipments: the only place that drives the state
 * machine. It enforces the three authorization layers - route permissions
 * in the controller, ownership policies here (customers see their own,
 * drivers only their assignments), and RLS underneath both. Every action
 * takes the expected version (parsed from `If-Match`) so two dispatchers
 * acting at once cannot lose an update.
 */
@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY)
    private readonly shipments: ShipmentRepository,
    @Inject(SHIPMENT_HISTORY_REPOSITORY)
    private readonly history: ShipmentHistoryRepository,
    private readonly quotes: QuotesService,
    private readonly customers: CustomersService,
    private readonly drivers: DriversService,
    private readonly vehicles: VehiclesService,
    private readonly tenants: TenantsService,
  ) {}

  async create(
    actor: ShipmentActor,
    tenantId: string,
    command: CreateShipmentCommand,
  ): Promise<Shipment> {
    const customer = await this.customers.getCustomer(
      tenantId,
      command.customerId,
    );
    if (actor.role === 'customer') {
      await this.assertCustomerIsOwn(actor, tenantId, customer.id);
      // A customer may only ship between their own saved addresses.
      for (const addressId of [
        command.pickupAddressId,
        command.dropoffAddressId,
      ]) {
        const address = await this.customers.getAddressById(tenantId, addressId);
        if (address.customerId !== customer.id) {
          throw ownershipViolation();
        }
      }
    } else {
      // Dispatchers ship between any two addresses of the tenant.
      await this.customers.getAddressById(tenantId, command.pickupAddressId);
      await this.customers.getAddressById(tenantId, command.dropoffAddressId);
    }

    if (
      command.windowStart &&
      command.windowEnd &&
      command.windowEnd.getTime() <= command.windowStart.getTime()
    ) {
      throw new UnprocessableEntityException({
        message: 'The delivery window must end after it starts.',
        code: 'WINDOW_END_BEFORE_START',
      });
    }

    // A quote is needed in the same request, so Pricing is called
    // synchronously through its facade.
    const quote = await this.quotes.quote(tenantId, {
      pickupAddressId: command.pickupAddressId,
      dropoffAddressId: command.dropoffAddressId,
      weightKg: command.weightKg,
    });

    const shipment = await this.insertWithTrackingRetry(() =>
      Shipment.create({
        id: randomUUID(),
        tenantId,
        trackingNumber: generateTrackingNumber(randomTrackingBytes()),
        customerId: command.customerId,
        pickupAddressId: command.pickupAddressId,
        dropoffAddressId: command.dropoffAddressId,
        weightKg: command.weightKg,
        volumeM3: command.volumeM3 ?? null,
        windowStart: command.windowStart ?? null,
        windowEnd: command.windowEnd ?? null,
        priceMinor: quote.priceMinor,
        currency: quote.currency,
        items: (command.items ?? []).map((item) => ({
          description: item.description,
          quantity: item.quantity,
          weightKg: item.weightKg ?? null,
        })),
      }),
    );

    await this.persistHistory(shipment, actor.userId);
    this.publishEvents(shipment);
    return shipment;
  }

  async list(
    actor: ShipmentActor,
    tenantId: string,
    filters: ShipmentListFilters = {},
  ): Promise<Shipment[]> {
    if (actor.role === 'driver') {
      // Assignment-scoped reads land with the dispatch module (Step 8);
      // until then a driver sees no shipments at all.
      return [];
    }
    if (actor.role === 'customer') {
      const own = await this.customers.listCustomersByUser(
        tenantId,
        actor.userId,
      );
      const ownIds = own.map((customer) => customer.id);
      const all = await this.shipments.listByTenant(tenantId, filters);
      return all.filter((shipment) => ownIds.includes(shipment.customerId));
    }
    return this.shipments.listByTenant(tenantId, filters);
  }

  async get(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
  ): Promise<Shipment> {
    const shipment = await this.loadOwned(actor, tenantId, id);
    if (!shipment) {
      throw shipmentNotFound(id);
    }
    return shipment;
  }

  confirm(actor: ShipmentActor, tenantId: string, id: string, expectedVersion: number): Promise<Shipment> {
    return this.runAction(actor, tenantId, id, expectedVersion, (s) => s.confirm());
  }

  cancel(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
    reason: string | null,
  ): Promise<Shipment> {
    return this.runAction(actor, tenantId, id, expectedVersion, (s) => s.cancel(reason));
  }

  async assign(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
    driverId: string,
    vehicleId: string | null,
  ): Promise<Shipment> {
    // Both identities must exist in this tenant; the explicit checks turn a
    // foreign id into a 404 instead of a foreign-key error.
    await this.drivers.getDriver(tenantId, driverId);
    if (vehicleId) {
      await this.vehicles.getById(tenantId, vehicleId);
    }
    return this.runAction(actor, tenantId, id, expectedVersion, (s) =>
      s.assign(driverId, vehicleId),
    );
  }

  pickup(actor: ShipmentActor, tenantId: string, id: string, expectedVersion: number): Promise<Shipment> {
    return this.runAction(actor, tenantId, id, expectedVersion, (s) => s.markPickedUp());
  }

  startTransit(actor: ShipmentActor, tenantId: string, id: string, expectedVersion: number): Promise<Shipment> {
    return this.runAction(actor, tenantId, id, expectedVersion, (s) => s.startTransit());
  }

  startDelivery(actor: ShipmentActor, tenantId: string, id: string, expectedVersion: number): Promise<Shipment> {
    return this.runAction(actor, tenantId, id, expectedVersion, (s) => s.startDelivery());
  }

  async deliver(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
  ): Promise<Shipment> {
    const policy = await this.policyFor(tenantId);
    if (policy.requireProofOfDelivery) {
      // Proof of delivery lands in Step 10; until it can be verified,
      // demanding it blocks the transition outright.
      throw new UnprocessableEntityException({
        message:
          'This tenant requires proof of delivery before a shipment can be delivered.',
        code: 'PROOF_REQUIRED',
      });
    }
    return this.runAction(actor, tenantId, id, expectedVersion, (s) => s.deliver());
  }

  async fail(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<Shipment> {
    return this.runAction(actor, tenantId, id, expectedVersion, (s) => s.fail(reason));
  }

  async retry(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
  ): Promise<Shipment> {
    const policy = await this.policyFor(tenantId);
    return this.runAction(actor, tenantId, id, expectedVersion, (s) =>
      s.retry(policy.maxFailedAttempts),
    );
  }

  returnShipment(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
    reason: string | null,
  ): Promise<Shipment> {
    return this.runAction(actor, tenantId, id, expectedVersion, (s) =>
      s.returnShipment(reason),
    );
  }

  private async runAction(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
    apply: (shipment: Shipment) => void,
  ): Promise<Shipment> {
    const shipment = await this.loadOwned(actor, tenantId, id, {
      forAction: true,
    });
    if (!shipment) {
      throw shipmentNotFound(id);
    }
    if (expectedVersion !== shipment.version) {
      throw new PreconditionFailedException({
        message: `Shipment ${id} is at version ${shipment.version}, not ${expectedVersion}. Reload and retry.`,
        code: 'VERSION_MISMATCH',
      });
    }

    try {
      apply(shipment);
    } catch (error) {
      throw mapDomainError(error);
    }

    await this.shipments.save(shipment);
    await this.persistHistory(shipment, actor.userId);
    this.publishEvents(shipment);
    return shipment;
  }

  /**
   * Loads a shipment and applies the ownership policy: dispatchers and
   * admins act on everything in the tenant, customers on their own, drivers
   * on nothing yet (their assignment-scoped rights arrive with dispatch).
   */
  private async loadOwned(
    actor: ShipmentActor,
    tenantId: string,
    id: string,
    options: { forAction?: boolean } = {},
  ): Promise<Shipment | null> {
    const shipment = await this.shipments.findById(id);
    if (!shipment || shipment.tenantId !== tenantId) {
      return null;
    }
    if (actor.role === 'dispatcher' || actor.role === 'tenant_admin') {
      return shipment;
    }
    if (actor.role === 'customer') {
      const own = await this.customers.listCustomersByUser(
        tenantId,
        actor.userId,
      );
      const isOwn = own.some((customer) => customer.id === shipment.customerId);
      // Non-own reads answer 404 so foreign ids never leak existence.
      return isOwn ? shipment : null;
    }
    // Drivers: assignment checks land with dispatch (Step 8).
    if (options.forAction) {
      throw new ForbiddenException({
        message:
          'Drivers may only act on shipments that are assigned to them.',
        code: 'SHIPMENT_NOT_ASSIGNED',
      });
    }
    return null;
  }

  private async assertCustomerIsOwn(
    actor: ShipmentActor,
    tenantId: string,
    customerId: string,
  ): Promise<void> {
    const own = await this.customers.listCustomersByUser(
      tenantId,
      actor.userId,
    );
    if (!own.some((customer) => customer.id === customerId)) {
      throw ownershipViolation();
    }
  }

  private async policyFor(tenantId: string) {
    const tenant = await this.tenants.getById(tenantId);
    return shipmentPolicyFrom(tenant.settings);
  }

  private async persistHistory(
    shipment: Shipment,
    actorId: string,
  ): Promise<void> {
    const entries: ShipmentHistoryEntry[] = shipment
      .pullTransitions()
      .map((transition) => ({
        tenantId: shipment.tenantId,
        shipmentId: shipment.id,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        actorId,
        reason: transition.reason,
        occurredAt: transition.occurredAt,
      }));
    await this.history.append(entries);
  }

  /**
   * Drains the aggregate's domain events. No consumer exists until the
   * notifications/outbox steps; they are logged now and published for real
   * later, without changing the aggregate.
   */
  private publishEvents(shipment: Shipment): void {
    const events = shipment.pullDomainEvents();
    if (events.length > 0) {
      this.logger.debug(
        {
          shipmentId: shipment.id,
          events: events.map((event) => event.type),
        },
        'shipment domain events raised',
      );
    }
  }

  private async insertWithTrackingRetry(
    build: () => Shipment,
    attempts = 3,
  ): Promise<Shipment> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const shipment = build();
        await this.shipments.insert(shipment);
        return shipment;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }
}

function shipmentNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Shipment ${id} was not found in this tenant.`,
    code: 'SHIPMENT_NOT_FOUND',
  });
}

function ownershipViolation(): ForbiddenException {
  return new ForbiddenException({
    message: 'You may only act on your own customers and addresses.',
    code: 'OWNERSHIP_VIOLATION',
  });
}

/** Domain errors map to the problem+json statuses the doc prescribes. */
function mapDomainError(error: unknown): Error {
  if (error instanceof ShipmentDomainError) {
    switch (error.code) {
      case 'SHIPMENT_REASON_REQUIRED':
      case 'SHIPMENT_QUOTE_REQUIRED':
        return new UnprocessableEntityException({
          message: error.message,
          code: error.code,
        });
      default:
        // Invalid transition, exhausted retries, missing driver.
        return new ConflictException({
          message: error.message,
          code: error.code,
        });
    }
  }
  return error as Error;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const driverError = (error as { driverError?: { code?: string } }).driverError;
  return driverError?.code === '23505';
}

/** 8 fresh bytes for the tracking-number generator. */
function randomTrackingBytes(): Uint8Array {
  return randomBytes(8);
}
