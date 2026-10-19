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
import type { Driver } from '../../drivers/domain/driver.js';
import { DriversService } from '../../drivers/application/drivers.service.js';
import { VehiclesService } from '../../fleet/application/vehicles.service.js';
import { QuotesService } from '../../pricing/application/quotes.service.js';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import { EVENT_BUS, type EventBus } from '../../../shared/messaging/event-bus.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';
import { Shipment, ShipmentDomainError } from '../domain/shipment.js';
import {
  DELIVERY_PROOF_READ,
  type DeliveryProofRead,
} from '../domain/delivery-proof-read.js';
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
import { generatePublicToken } from '../domain/public-token.js';

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
  /** Rate-card surcharge codes to opt into when pricing this shipment. */
  readonly surchargeCodes?: readonly string[];
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
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(DELIVERY_PROOF_READ)
    private readonly proofRead: DeliveryProofRead,
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
      surchargeCodes: command.surchargeCodes,
    });

    const shipment = await this.insertWithTrackingRetry(() =>
      Shipment.create({
        id: randomUUID(),
        tenantId,
        trackingNumber: generateTrackingNumber(randomTrackingBytes()),
        publicToken: generatePublicToken(),
        customerId: command.customerId,
        pickupAddressId: command.pickupAddressId,
        dropoffAddressId: command.dropoffAddressId,
        weightKg: command.weightKg,
        volumeM3: command.volumeM3 ?? null,
        windowStart: command.windowStart ?? null,
        windowEnd: command.windowEnd ?? null,
        priceMinor: quote.priceMinor,
        currency: quote.currency,
        priceBreakdown: quote,
        items: (command.items ?? []).map((item) => ({
          description: item.description,
          quantity: item.quantity,
          weightKg: item.weightKg ?? null,
        })),
      }),
    );

    await this.persistHistory(shipment, actor.userId);
    await this.publishEvents(shipment);
    return shipment;
  }

  async list(
    actor: ShipmentActor,
    tenantId: string,
    filters: ShipmentListFilters = {},
  ): Promise<Shipment[]> {
    if (actor.role === 'driver') {
      // Drivers see exactly the shipments the dispatch module assigned to
      // them; the shipment row records who is driving.
      const driver = await this.ownDriverOrNone(tenantId, actor.userId);
      if (!driver) {
        return [];
      }
      return this.shipments.listByTenant(tenantId, {
        ...filters,
        driverId: driver.id,
      });
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
      const hasProof = await this.proofRead.hasProof(id);
      if (!hasProof) {
        throw new UnprocessableEntityException({
          message:
            'This tenant requires proof of delivery before a shipment can be delivered.',
          code: 'PROOF_REQUIRED',
        });
      }
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

  /**
   * Dispatch-internal: apply an accepted assignment (CONFIRMED to ASSIGNED)
   * for the given driver. The dispatch module has already authorized the
   * driver and owns the assignment row; this entry point spares it a fake
   * actor and an If-Match version while keeping the guarantee that every
   * status change still flows through the aggregate, its history, and its
   * events. Not exposed over HTTP.
   */
  async applyAssignment(
    tenantId: string,
    id: string,
    driverId: string,
    vehicleId: string | null,
    actorUserId: string,
  ): Promise<Shipment> {
    return this.runTrustedAction(tenantId, id, actorUserId, (s) =>
      s.assign(driverId, vehicleId),
    );
  }

  /** Dispatch-internal: withdraw an accepted assignment (ASSIGNED back to
   * CONFIRMED). Same trust contract as {@link applyAssignment}. */
  async releaseAssignment(
    tenantId: string,
    id: string,
    reason: string | null,
    actorUserId: string,
  ): Promise<Shipment> {
    return this.runTrustedAction(tenantId, id, actorUserId, (s) =>
      s.release(reason),
    );
  }

  /** Shared body of the dispatch-internal entry points above. */
  private async runTrustedAction(
    tenantId: string,
    id: string,
    actorUserId: string,
    apply: (shipment: Shipment) => void,
  ): Promise<Shipment> {
    const shipment = await this.shipments.findById(id);
    if (!shipment || shipment.tenantId !== tenantId) {
      throw shipmentNotFound(id);
    }
    try {
      apply(shipment);
    } catch (error) {
      throw mapDomainError(error);
    }
    await this.shipments.save(shipment);
    await this.persistHistory(shipment, actorUserId);
    await this.publishEvents(shipment);
    return shipment;
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
    await this.publishEvents(shipment);
    return shipment;
  }

  /**
   * Loads a shipment and applies the ownership policy: dispatchers and
   * admins act on everything in the tenant, customers on their own, drivers
   * on the shipments assigned to them (dispatch records the driver on the
   * shipment row).
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
    // Drivers: the shipment row records who is driving, so only the assigned
    // driver may read or act on it. Everyone else gets a 404 for reads and a
    // 403 for actions, matching the customer branch above.
    const driver = await this.ownDriverOrNone(tenantId, actor.userId);
    if (driver && shipment.driverId === driver.id) {
      return shipment;
    }
    if (options.forAction) {
      throw new ForbiddenException({
        message:
          'Drivers may only act on shipments that are assigned to them.',
        code: 'SHIPMENT_NOT_ASSIGNED',
      });
    }
    return null;
  }

  /** The caller's driver profile, or null when they simply do not have one
   * (an admin flipping a switch should not explode into a 404 here). */
  private async ownDriverOrNone(
    tenantId: string,
    userId: string,
  ): Promise<Driver | null> {
    try {
      return await this.drivers.getOwnDriver(tenantId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
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
   * Drains the aggregate's domain events into the event bus as envelopes.
   * Runs inside the request's tenant transaction, so listeners share the
   * RLS context and see exactly the rows this request sees; delivery is
   * best-effort (a listener failure never fails the request).
   */
  private async publishEvents(shipment: Shipment): Promise<void> {
    const events = shipment.pullDomainEvents();
    if (events.length === 0) {
      return;
    }
    await this.events.publishAll(
      events.map((event) =>
        createEnvelope({
          type: event.type,
          tenantId: shipment.tenantId,
          aggregateType: 'shipment',
          aggregateId: shipment.id,
          aggregateVersion: shipment.version,
          occurredAt: event.occurredAt,
          payload: event.payload,
        }),
      ),
    );
    this.logger.debug(
      { shipmentId: shipment.id, events: events.map((event) => event.type) },
      'shipment domain events published',
    );
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
