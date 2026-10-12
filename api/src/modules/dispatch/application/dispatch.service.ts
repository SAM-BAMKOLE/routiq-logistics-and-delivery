import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Vehicle } from '../../fleet/domain/vehicle.js';
import { VehiclesService } from '../../fleet/application/vehicles.service.js';
import { DriversService } from '../../drivers/application/drivers.service.js';
import type { Role } from '../../identity/domain/membership.js';
import { ShipmentsService } from '../../shipments/application/shipments.service.js';
import type { Shipment } from '../../shipments/domain/shipment.js';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import { EVENT_BUS, type EventBus } from '../../../shared/messaging/event-bus.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';
import {
  Assignment,
  AssignmentDomainError,
  type AssignmentDomainEvent,
} from '../domain/assignment.js';
import {
  ASSIGNMENT_REPOSITORY,
  type AssignmentRepository,
} from '../domain/assignment.repository.js';
import {
  firstRadiusWithCandidates,
  rankCandidates,
  withinRadiusPool,
  type RankedCandidate,
} from '../domain/dispatch-candidate.js';
import {
  dispatchSettingsFrom,
  type DispatchSettings,
} from '../domain/dispatch-settings.js';

/** The authenticated principal as the dispatch service wants it. */
export interface DispatchActor {
  readonly userId: string;
  readonly role: Role;
}

/**
 * Application service for dispatch: ranked candidate search, the offer
 * lifecycle (offer, accept, reject, cancel), and the lazy offer expiry that
 * stands in for the phase-2 timeout job.
 *
 * The invariants are split on purpose:
 * - the shipment row records *who* is driving (set by the accept path via
 *   the shipments aggregate), so driver-scoped shipment reads never need to
 *   know this module exists;
 * - this table records the negotiation that put them there;
 * - the database backstops both with partial unique indexes, so races lose
 *   with a `23505` the service turns into a 409 instead of double-booking.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @Inject(ASSIGNMENT_REPOSITORY)
    private readonly assignments: AssignmentRepository,
    private readonly shipments: ShipmentsService,
    private readonly drivers: DriversService,
    private readonly vehicles: VehiclesService,
    private readonly tenants: TenantsService,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  // ---------------------------------------------------------------------
  // Dispatcher side
  // ---------------------------------------------------------------------

  /**
   * Ranked dispatch suggestions for a confirmed shipment: eligible drivers
   * (active, available, unbooked, on shift or unscheduled) whose tenant has
   * a free vehicle that fits, ordered by the tenant's strategy. The radius
   * steps narrow the located pool; drivers without a known position are
   * always listed after it (distance null), because a fleet without GPS
   * data must still be dispatchable.
   */
  async candidates(
    actor: DispatchActor,
    tenantId: string,
    shipmentId: string,
  ): Promise<RankedCandidate[]> {
    const shipment = await this.shipments.get(actor, tenantId, shipmentId);
    this.ensureDispatchable(shipment);
    await this.expireOverdue(tenantId);

    const settings = await this.settingsFor(tenantId);
    const pool = await this.assignments.searchCandidates({
      tenantId,
      pickupAddressId: shipment.pickupAddressId,
      weightKg: shipment.weightKg,
      volumeM3: shipment.volumeM3,
    });

    const stepsMeters = settings.radiusStepsKm.map((km) => km * 1_000);
    const step = firstRadiusWithCandidates(pool, stepsMeters);
    const flagged = withinRadiusPool(pool, step);
    const locatedInPool = flagged.filter((candidate) => candidate.withinRadius);
    const unlocated = flagged.filter(
      (candidate) => candidate.distanceMeters === null,
    );
    const ranked = rankCandidates(
      [...locatedInPool, ...unlocated],
      settings.strategy,
    );
    this.logger.debug(
      {
        shipmentId,
        strategy: settings.strategy,
        step,
        returned: Math.min(ranked.length, settings.maxCandidates),
      },
      'dispatch candidates ranked',
    );
    return ranked.slice(0, settings.maxCandidates);
  }

  /**
   * Offers the shipment to one driver. The shipment must be CONFIRMED, the
   * driver must be eligible, and the offer lives for the tenant's TTL (or
   * the caller's override). A concurrent second offer loses at the partial
   * unique index and surfaces as a 409.
   */
  async create(
    actor: DispatchActor,
    tenantId: string,
    shipmentId: string,
    input: {
      readonly driverId: string;
      readonly vehicleId?: string | null;
      readonly ttlMinutes?: number;
    },
  ): Promise<Assignment> {
    const shipment = await this.shipments.get(actor, tenantId, shipmentId);
    this.ensureDispatchable(shipment);
    await this.expireOverdue(tenantId);

    const driver = await this.drivers.getDriver(tenantId, input.driverId);
    if (driver.status !== 'active' || driver.availability !== 'available') {
      throw new ConflictException({
        message: `Driver ${driver.id} is ${driver.status} and ${driver.availability}; offers need an active, available driver.`,
        code: 'DISPATCH_DRIVER_UNAVAILABLE',
      });
    }

    let vehicleId = input.vehicleId ?? null;
    if (vehicleId) {
      const vehicle = await this.vehicles.getById(tenantId, vehicleId);
      this.assertFits(vehicle, shipment);
    } else if (driver.currentVehicleId) {
      // Default to the driver's own vehicle when it fits; the dispatcher
      // sees the suggestion in the response and can override it.
      const own = await this.tryGetVehicle(tenantId, driver.currentVehicleId);
      if (own && this.fits(own, shipment)) {
        vehicleId = own.id;
      }
    }

    const settings = await this.settingsFor(tenantId);
    const ttlMinutes = input.ttlMinutes ?? settings.offerTtlMinutes;
    const assignment = Assignment.offer({
      id: randomUUID(),
      tenantId,
      shipmentId,
      driverId: driver.id,
      vehicleId,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });
    try {
      await this.assignments.insert(assignment);
    } catch (error) {
      throw mapUniqueViolation(error);
    }
    // The offer event goes out before the dispatcher gets the 201: the
    // WebSocket gateway pushes it to the driver's room as `offer:new`. The
    // addresses ride along so the driver's card shows the job without a
    // second fetch.
    await this.publishEvents(assignment, (event) =>
      event.type === 'AssignmentOffered'
        ? {
            pickupAddressId: shipment.pickupAddressId,
            dropoffAddressId: shipment.dropoffAddressId,
          }
        : {},
    );
    this.logger.debug(
      { assignmentId: assignment.id, shipmentId, driverId: driver.id },
      'dispatch offer created',
    );
    return assignment;
  }

  /** Cancels a live assignment: a pending offer is withdrawn, an accepted
   * one releases the shipment back to CONFIRMED. Dispatchers cancel any;
   * drivers cancel their own (the guard admits both roles). */
  async cancel(
    actor: DispatchActor,
    tenantId: string,
    assignmentId: string,
    reason: string | null = null,
  ): Promise<Assignment> {
    const assignment = await this.requireAssignment(tenantId, assignmentId);
    if (actor.role === 'driver') {
      const driver = await this.drivers.getOwnDriver(tenantId, actor.userId);
      if (driver.id !== assignment.driverId) {
        // Foreign ids never leak existence.
        throw assignmentNotFound(assignmentId);
      }
    }
    const wasAccepted = assignment.status === 'accepted';
    try {
      assignment.cancel(reason);
    } catch (error) {
      throw mapAssignmentDomainError(error);
    }
    if (wasAccepted) {
      // Release first: if the shipment has meanwhile left ASSIGNED, the
      // offer stays accepted and the dispatcher sees the real problem.
      await this.shipments.releaseAssignment(
        tenantId,
        assignment.shipmentId,
        reason,
        actor.userId,
      );
    }
    await this.assignments.save(assignment);
    await this.publishEvents(assignment);
    return assignment;
  }

  // ---------------------------------------------------------------------
  // Driver side
  // ---------------------------------------------------------------------

  /** The caller's own assignments (offers and accepted jobs), newest first. */
  async listMine(
    tenantId: string,
    userId: string,
  ): Promise<Assignment[]> {
    const driver = await this.drivers.getOwnDriver(tenantId, userId);
    await this.expireOverdue(tenantId);
    return this.assignments.listByDriver(driver.id);
  }

  /** The driver takes the job: the offer becomes accepted and the shipment
   * moves CONFIRMED to ASSIGNED in the same transaction. An offer that ran
   * out its TTL expires lazily right here, and an assignment that is not an
   * open offer is a 409. */
  async accept(
    tenantId: string,
    userId: string,
    assignmentId: string,
  ): Promise<Assignment> {
    const driver = await this.drivers.getOwnDriver(tenantId, userId);
    const assignment = await this.requireAssignment(tenantId, assignmentId);
    if (assignment.driverId !== driver.id) {
      throw assignmentNotFound(assignmentId);
    }
    await this.ensureNotOverdue(assignment);
    try {
      assignment.accept();
    } catch (error) {
      throw mapAssignmentDomainError(error);
    }
    try {
      await this.shipments.applyAssignment(
        tenantId,
        assignment.shipmentId,
        assignment.driverId,
        assignment.vehicleId,
        userId,
      );
    } catch (error) {
      // The shipment moved under the offer (a direct assign, a cancel):
      // fold the offer away so it stops blocking the shipment, then let the
      // shipments layer's problem+json reach the caller unchanged.
      assignment.cancel('The shipment was no longer assignable.');
      await this.assignments.save(assignment);
      await this.publishEvents(assignment);
      throw error;
    }
    await this.assignments.save(assignment);
    await this.publishEvents(assignment);
    this.logger.debug(
      { assignmentId: assignment.id, shipmentId: assignment.shipmentId },
      'dispatch offer accepted',
    );
    return assignment;
  }

  /** The driver passes on the job; the shipment stays CONFIRMED. */
  async reject(
    tenantId: string,
    userId: string,
    assignmentId: string,
    reason: string | null = null,
  ): Promise<Assignment> {
    const driver = await this.drivers.getOwnDriver(tenantId, userId);
    const assignment = await this.requireAssignment(tenantId, assignmentId);
    if (assignment.driverId !== driver.id) {
      throw assignmentNotFound(assignmentId);
    }
    await this.ensureNotOverdue(assignment);
    try {
      assignment.reject(reason);
    } catch (error) {
      throw mapAssignmentDomainError(error);
    }
    await this.assignments.save(assignment);
    await this.publishEvents(assignment);
    return assignment;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * The lazy half of the offer timeout: every offer in the tenant past its
   * TTL is expired, saved, and published before anyone reads the table
   * again. Two concurrent sweeps can double-publish an expiry (both read the
   * row while still `offered`); with in-process best-effort delivery that is
   * noise, and the phase-2 timeout job removes the sweep entirely.
   */
  private async expireOverdue(tenantId: string): Promise<void> {
    const overdue = await this.assignments.findOverdue(tenantId, new Date());
    for (const assignment of overdue) {
      try {
        assignment.expire();
      } catch {
        continue; // lost the lazy-sweep race; the other writer published it
      }
      await this.assignments.save(assignment);
      await this.publishEvents(assignment);
      this.logger.debug(
        { assignmentId: assignment.id },
        'dispatch offer expired lazily',
      );
    }
  }

  /** Guards a driver-side action against an offer that ran out its TTL:
   * the offer is expired, persisted, and published right here, then the
   * caller sees a 409. */
  private async ensureNotOverdue(assignment: Assignment): Promise<void> {
    if (!assignment.isOverdue(new Date())) {
      return;
    }
    assignment.expire();
    await this.assignments.save(assignment);
    await this.publishEvents(assignment);
    throw new ConflictException({
      message: 'This offer expired before the driver responded.',
      code: 'ASSIGNMENT_EXPIRED',
    });
  }
  private ensureDispatchable(shipment: Shipment): void {
    if (shipment.status !== 'CONFIRMED') {
      throw new ConflictException({
        message: `Shipment ${shipment.id} is ${shipment.status}; only confirmed shipments can be dispatched.`,
        code: 'DISPATCH_SHIPMENT_NOT_DISPATCHABLE',
      });
    }
  }

  private async requireAssignment(
    tenantId: string,
    assignmentId: string,
  ): Promise<Assignment> {
    const assignment = await this.assignments.findById(assignmentId);
    if (!assignment || assignment.tenantId !== tenantId) {
      throw assignmentNotFound(assignmentId);
    }
    return assignment;
  }

  private async settingsFor(tenantId: string): Promise<DispatchSettings> {
    const tenant = await this.tenants.getById(tenantId);
    return dispatchSettingsFrom(tenant.settings);
  }

  private async tryGetVehicle(
    tenantId: string,
    vehicleId: string,
  ): Promise<Vehicle | null> {
    try {
      return await this.vehicles.getById(tenantId, vehicleId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  private assertFits(vehicle: Vehicle, shipment: Shipment): void {
    if (!this.fits(vehicle, shipment)) {
      throw new UnprocessableEntityException({
        message: `Vehicle ${vehicle.id} holds ${vehicle.capacityWeightKg} kg / ${vehicle.capacityVolumeM3 ?? 'unlimited'} m3; the shipment needs ${shipment.weightKg} kg / ${shipment.volumeM3 ?? 'unmeasured'} m3.`,
        code: 'DISPATCH_VEHICLE_TOO_SMALL',
      });
    }
  }

  private fits(vehicle: Vehicle, shipment: Shipment): boolean {
    if (vehicle.status !== 'active') {
      return false;
    }
    if (vehicle.capacityWeightKg < shipment.weightKg) {
      return false;
    }
    if (
      vehicle.capacityVolumeM3 !== null &&
      shipment.volumeM3 !== null &&
      vehicle.capacityVolumeM3 < shipment.volumeM3
    ) {
      return false;
    }
    return true;
  }

  /**
   * Drains the aggregate's domain events into the event bus as envelopes.
   * Runs inside the request's tenant transaction, so listeners share the
   * RLS context; delivery is best-effort (a listener failure never fails
   * the request), matching the shipments publisher.
   */
  /**
   * Publishes the aggregate's drained events. `enrich` adds facts the event
   * itself does not carry (the offer's addresses, from the shipment loaded
   * by the caller) so consumers get one complete payload.
   */
  private async publishEvents(
    assignment: Assignment,
    enrich: (
      event: AssignmentDomainEvent,
    ) => Record<string, unknown> = () => ({}),
  ): Promise<void> {
    const events = assignment.pullDomainEvents();
    if (events.length === 0) {
      return;
    }
    await this.events.publishAll(
      events.map((event) =>
        createEnvelope({
          type: event.type,
          tenantId: assignment.tenantId,
          aggregateType: 'dispatch_assignment',
          aggregateId: assignment.id,
          occurredAt: event.occurredAt,
          payload: { ...event.payload, ...enrich(event) },
        }),
      ),
    );
    this.logger.debug(
      {
        assignmentId: assignment.id,
        events: events.map((event) => event.type),
      },
      'dispatch domain events published',
    );
  }
}

function assignmentNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Assignment ${id} was not found in this tenant.`,
    code: 'ASSIGNMENT_NOT_FOUND',
  });
}

/** Domain guard failures are lifecycle conflicts, always 409. */
function mapAssignmentDomainError(error: unknown): unknown {
  if (error instanceof AssignmentDomainError) {
    return new ConflictException({ message: error.message, code: error.code });
  }
  return error;
}

/** The partial unique indexes answer concurrent double-offers; the named
 * constraint tells us which side was double-booked. */
function mapUniqueViolation(error: unknown): unknown {
  const driverError = (error as { driverError?: { code?: string; constraint?: string } })
    .driverError;
  if (driverError?.code !== '23505') {
    return error;
  }
  switch (driverError.constraint) {
    case 'uq_dispatch_assignments_active_shipment':
      return new ConflictException({
        message:
          'This shipment already has a live assignment; cancel it or wait for it to end.',
        code: 'ASSIGNMENT_ALREADY_OFFERED',
      });
    case 'uq_dispatch_assignments_active_driver':
      return new ConflictException({
        message: 'This driver already holds a live assignment.',
        code: 'DISPATCH_DRIVER_BUSY',
      });
    case 'uq_dispatch_assignments_active_vehicle':
      return new ConflictException({
        message: 'This vehicle already holds a live assignment.',
        code: 'DISPATCH_VEHICLE_BUSY',
      });
    default:
      return new ConflictException({
        message: 'The assignment raced with another change; retry.',
        code: 'ASSIGNMENT_CONFLICT',
      });
  }
}
