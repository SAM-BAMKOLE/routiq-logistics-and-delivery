import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Role } from '../../identity/domain/membership.js';
import { DriversService } from '../../drivers/application/drivers.service.js';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import { EVENT_BUS, type EventBus } from '../../../shared/messaging/event-bus.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';
import { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import {
  haversineMeters,
  validateLocationPoints,
  type DiscardedPoint,
  type RawLocationPoint,
} from '../domain/location-point.js';
import {
  trackingSettingsFrom,
} from '../domain/tracking-settings.js';
import {
  TRACKING_REPOSITORY,
  type LocationPointRow,
  type ProofSummaryRow,
  type RouteStopEta,
  type TimelineEntry,
  type TrackingRepository,
} from '../domain/tracking.repository.js';
import { ShipmentsService } from '../../shipments/application/shipments.service.js';

/** Who is acting: the authenticated principal's identity and tenant role. */
export interface TrackingActor {
  readonly userId: string;
  readonly role: Role;
}

export interface IngestCommand {
  /** Required when a dispatcher pushes on behalf of a driver. */
  readonly driverId?: string | null;
  readonly points: RawLocationPoint[];
}

export interface IngestResult {
  readonly accepted: number;
  readonly discarded: DiscardedPoint[];
}

/** Where a shipment is, for the authenticated track view. */
export interface DriverPositionView {
  readonly driverId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKmh: number | null;
  readonly heading: number | null;
  readonly recordedAt: Date;
}

export interface ShipmentTrackView {
  readonly shipmentId: string;
  readonly trackingNumber: string;
  readonly status: string;
  readonly deliveredAt: Date | null;
  readonly timeline: TimelineEntry[];
  readonly proofs: ProofSummaryRow[];
  readonly eta: RouteStopEta | null;
  readonly position: DriverPositionView | null;
}

/** The anonymous view: no addresses, no people, no failure reasons. */
export interface PublicTrackingView {
  readonly trackingNumber: string;
  readonly status: string;
  readonly timeline: ReadonlyArray<{ status: string; occurredAt: Date }>;
  readonly eta: Date | null;
  /** Only present while the shipment is out for delivery. */
  readonly position: { latitude: number; longitude: number; recordedAt: Date } | null;
}

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

/**
 * Application service for tracking: the write path that accepts driver
 * positions, the read paths dispatch and support use to see where things
 * are, and the anonymous view the public tracking endpoint serves.
 *
 * The write path is deliberately forgiving of devices — an offline phone
 * flushes its buffer hours later, in any order — and strict about what it
 * believes: points outside plausible space, time, or speed are answered with
 * a discard reason, not an error. Only believable points become rows, events,
 * and broadcasts.
 */
@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingService.name);
  private retentionTimer: NodeJS.Timeout | null = null;
  /**
   * Shipments whose driver is currently inside the dropoff geofence, so
   * DriverNearDestination fires on entry, not on every ping while parked
   * outside the door. In-memory is enough for phase 1: the set only matters
   * while the process that observed the entry is also the one that will see
   * the exit.
   */
  private readonly nearDropoffs = new Set<string>();

  constructor(
    @Inject(TRACKING_REPOSITORY)
    private readonly tracking: TrackingRepository,
    private readonly shipments: ShipmentsService,
    private readonly drivers: DriversService,
    private readonly tenants: TenantsService,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly transactions: TenantTransactionService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }
    this.retentionTimer = setInterval(
      () => void this.runRetentionSweep(),
      RETENTION_INTERVAL_MS,
    );
    // Never hold the process open for a sweep.
    this.retentionTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  /**
   * Accepts a batch of positions from a device. A driver always pushes for
   * themself (the service resolves the driver profile from the principal, so
   * a body cannot claim another driver); a dispatcher may push on behalf of
   * one by naming it.
   */
  async ingest(
    actor: TrackingActor,
    tenantId: string,
    command: IngestCommand,
  ): Promise<IngestResult> {
    const driverId = await this.resolveDriverId(
      actor,
      tenantId,
      command.driverId ?? null,
    );
    const settings = trackingSettingsFrom(
      (await this.tenants.getById(tenantId)).settings,
    );
    const previous = await this.tracking.findLatestPoint(tenantId, driverId);
    const { accepted, discarded } = validateLocationPoints(
      command.points,
      settings,
      previous,
      new Date(),
    );

    if (accepted.length === 0) {
      return { accepted: 0, discarded };
    }
    await this.tracking.insertPoints(tenantId, driverId, accepted);

    const latest = accepted[accepted.length - 1];
    const dropoffs = await this.tracking.activeDropoffs(tenantId, driverId);
    await this.raiseGeofenceEvents(tenantId, driverId, latest, dropoffs, settings.geofenceRadiusMeters);

    await this.events.publish(
      createEnvelope({
        type: 'LocationUpdated',
        tenantId,
        aggregateType: 'driver',
        aggregateId: driverId,
        payload: {
          driverId,
          shipmentIds: dropoffs.map((dropoff) => dropoff.shipmentId),
          latitude: latest.latitude,
          longitude: latest.longitude,
          speedKmh: latest.speedKmh,
          heading: latest.heading,
          recordedAt: latest.recordedAt.toISOString(),
          accepted: accepted.length,
          discarded: discarded.length,
        },
      }),
    );
    return { accepted: accepted.length, discarded };
  }

  /** The driver's newest stored position. */
  async latestForDriver(
    actor: TrackingActor,
    tenantId: string,
    driverId: string,
  ): Promise<LocationPointRow> {
    await this.scopedDriver(actor, tenantId, driverId);
    const point = await this.tracking.findLatestPoint(tenantId, driverId);
    if (!point) {
      throw new NotFoundException({
        message: 'No position has been recorded for this driver yet.',
        code: 'DRIVER_LOCATION_NOT_FOUND',
      });
    }
    return point;
  }

  /** A thinned window of history, newest first, cursor-paginated. */
  async historyForDriver(
    actor: TrackingActor,
    tenantId: string,
    driverId: string,
    options: { from?: Date; limit?: number } = {},
  ): Promise<LocationPointRow[]> {
    await this.scopedDriver(actor, tenantId, driverId);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE),
    );
    return this.tracking.listPoints(tenantId, driverId, {
      from: options.from,
      limit,
    });
  }

  /**
   * The authenticated track view: status timeline, proofs, ETA, and the
   * driver's live position while the shipment is on the road. Ownership
   * comes from ShipmentsService — customers see their own, drivers their
   * assignments, dispatchers everything — so a foreign id is a 404 here.
   */
  async trackShipment(
    actor: TrackingActor,
    tenantId: string,
    shipmentId: string,
  ): Promise<ShipmentTrackView> {
    const shipment = await this.shipments.get(actor, tenantId, shipmentId);
    const row = await this.tracking.findShipmentTracking(tenantId, shipment.id);
    if (!row) {
      // Unreachable through the facade above; kept as a guard so a racing
      // delete cannot turn into a 500.
      throw new NotFoundException({
        message: `Shipment ${shipmentId} was not found in this tenant.`,
        code: 'SHIPMENT_NOT_FOUND',
      });
    }
    const [timeline, proofs, eta] = await Promise.all([
      this.tracking.listTimeline(tenantId, shipment.id),
      this.tracking.listProofs(tenantId, shipment.id),
      this.tracking.findStopEta(tenantId, shipment.id),
    ]);
    return {
      shipmentId: row.shipmentId,
      trackingNumber: row.trackingNumber,
      status: row.status,
      deliveredAt: row.deliveredAt,
      timeline,
      proofs,
      eta,
      position: await this.positionFor(tenantId, row),
    };
  }

  /**
   * The anonymous tracking view, keyed by the number/token pair. Both halves
   * must match; either wrong is a `null` the controller turns into a 404, so
   * a caller cannot even learn whether the tracking number exists.
   *
   * The SQL lookup runs outside any tenant (its SECURITY DEFINER function is
   * the only door), then the view itself is read under the tenant's RLS by
   * re-entering a normal tenant transaction.
   */
  async publicTracking(
    trackingNumber: string,
    publicToken: string,
  ): Promise<PublicTrackingView | null> {
    const found = await this.tracking.lookupPublicShipment(
      trackingNumber,
      publicToken,
    );
    if (!found) {
      return null;
    }
    return this.transactions.runWithTenant(found.tenantId, async () => {
      const row = await this.tracking.findShipmentTracking(
        found.tenantId,
        found.shipmentId,
      );
      if (!row) {
        return null;
      }
      const [timeline, eta] = await Promise.all([
        this.tracking.listTimeline(found.tenantId, found.shipmentId),
        this.tracking.findStopEta(found.tenantId, found.shipmentId),
      ]);
      // The driver's live position is shared only while the shipment is out
      // for delivery — never for a parked or already-delivered row.
      const position =
        row.status === 'OUT_FOR_DELIVERY' && row.driverId
          ? await this.tracking.findLatestPoint(found.tenantId, row.driverId)
          : null;
      return {
        trackingNumber: row.trackingNumber,
        status: row.status,
        timeline: timeline.map((entry) => ({
          status: entry.toStatus,
          occurredAt: entry.occurredAt,
        })),
        eta: eta ? eta.plannedArrival : null,
        position: position
          ? {
              latitude: position.latitude,
              longitude: position.longitude,
              recordedAt: position.recordedAt,
            }
          : null,
      };
    });
  }

  /**
   * Deletes history older than each tenant's retention window. Called on a
   * timer in production (see {@link onModuleInit}) and directly by tests.
   * Returns the rows removed across all tenants.
   */
  async pruneRetention(): Promise<number> {
    const tenantIds = await this.tracking.listTenantIds();
    let removed = 0;
    for (const tenantId of tenantIds) {
      const settings = trackingSettingsFrom(
        (await this.tenants.getById(tenantId)).settings,
      );
      const cutoff = new Date(
        Date.now() - settings.retentionDays * 24 * 60 * 60 * 1_000,
      );
      removed += await this.tracking.pruneOlderThan(tenantId, cutoff);
    }
    return removed;
  }

  private async runRetentionSweep(): Promise<void> {
    try {
      const removed = await this.pruneRetention();
      this.logger.debug({ removed }, 'location retention sweep complete');
    } catch (error) {
      // A failed sweep must never take the process down; it retries in six
      // hours and the error is in the logs until then.
      this.logger.error('location retention sweep failed', error);
    }
  }

  /**
   * Raises DriverNearDestination when a driver first enters the dropoff
   * geofence of one of their out-for-delivery shipments, and rearms the
   * trigger once they leave again.
   */
  private async raiseGeofenceEvents(
    tenantId: string,
    driverId: string,
    latest: { latitude: number; longitude: number },
    dropoffs: ReadonlyArray<{ shipmentId: string; latitude: number; longitude: number }>,
    radiusM: number,
  ): Promise<void> {
    for (const dropoff of dropoffs) {
      const key = `${tenantId}:${dropoff.shipmentId}`;
      const distanceM = haversineMeters(latest, dropoff);
      if (distanceM > radiusM) {
        this.nearDropoffs.delete(key);
        continue;
      }
      if (this.nearDropoffs.has(key)) {
        continue; // Already announced this visit.
      }
      this.nearDropoffs.add(key);
      await this.events.publish(
        createEnvelope({
          type: 'DriverNearDestination',
          tenantId,
          aggregateType: 'shipment',
          aggregateId: dropoff.shipmentId,
          payload: {
            driverId,
            shipmentId: dropoff.shipmentId,
            distanceM: Math.round(distanceM),
            radiusM,
          },
        }),
      );
    }
  }

  /** Position while the shipment is on the road, never once it settles. */
  private async positionFor(
    tenantId: string,
    row: { driverId: string | null; status: string },
  ): Promise<DriverPositionView | null> {
    // A settled shipment (delivered, cancelled, returned) shows no live
    // position even if the row still names a driver.
    if (
      !row.driverId ||
      ['DELIVERED', 'CANCELLED', 'RETURNED'].includes(row.status)
    ) {
      return null;
    }
    const point = await this.tracking.findLatestPoint(tenantId, row.driverId);
    if (!point) {
      return null;
    }
    return {
      driverId: point.driverId,
      latitude: point.latitude,
      longitude: point.longitude,
      speedKmh: point.speedKmh,
      heading: point.heading,
      recordedAt: point.recordedAt,
    };
  }

  /**
   * A driver reads only their own position; everyone else reads any driver
   * of the tenant. A foreign driver id is a 404, never a 403.
   */
  private async scopedDriver(
    actor: TrackingActor,
    tenantId: string,
    driverId: string,
  ): Promise<{ id: string }> {
    if (actor.role === 'driver') {
      const own = await this.drivers.getOwnDriver(tenantId, actor.userId);
      if (own.id !== driverId) {
        throw driverNotFound(driverId);
      }
      return own;
    }
    return this.drivers.getDriver(tenantId, driverId);
  }

  private async resolveDriverId(
    actor: TrackingActor,
    tenantId: string,
    requested: string | null,
  ): Promise<string> {
    if (actor.role === 'driver') {
      const own = await this.drivers.getOwnDriver(tenantId, actor.userId);
      if (requested && requested !== own.id) {
        // Claiming another driver's id is answered like a missing one.
        throw driverNotFound(requested);
      }
      return own.id;
    }
    if (!requested) {
      throw new UnprocessableEntityException({
        message:
          'A driverId is required when pushing positions on behalf of a driver.',
        code: 'DRIVER_ID_REQUIRED',
      });
    }
    const driver = await this.drivers.getDriver(tenantId, requested);
    return driver.id;
  }
}

function driverNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Driver ${id} was not found in this tenant.`,
    code: 'DRIVER_NOT_FOUND',
  });
}
