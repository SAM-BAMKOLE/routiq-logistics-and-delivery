import type {
  ValidatedLocationPoint,
} from './location-point.js';

/**
 * Outbound port of the tracking module: everything it needs from tables it
 * does not own.
 *
 * `driver_locations` is the one table it writes (created in Step 8 for
 * dispatch proximity, now the tracking history buffer). Everything else is a
 * documented cross-module read, the same pattern dispatch uses when it reads
 * `driver_locations` and `shipments`: raw SQL, no ORM entity on this side,
 * and RLS still enforcing tenant scope inside the open transaction.
 */

/** DI token for the {@link TrackingRepository} port. */
export const TRACKING_REPOSITORY = Symbol('TRACKING_REPOSITORY');

/** One stored position. */
export interface LocationPointRow extends ValidatedLocationPoint {
  readonly driverId: string;
}

/** A driver's shipment that is out for delivery, with its dropoff location. */
export interface ActiveDropoff {
  readonly shipmentId: string;
  readonly latitude: number;
  readonly longitude: number;
}

/** Minimal shipment facts for the authenticated track view. */
export interface ShipmentTrackingRow {
  readonly shipmentId: string;
  readonly trackingNumber: string;
  readonly status: string;
  readonly driverId: string | null;
  readonly deliveredAt: Date | null;
}

/** One row of the shipment's status history. */
export interface TimelineEntry {
  readonly toStatus: string;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

/** One captured proof of delivery. */
export interface ProofSummaryRow {
  readonly type: string;
  readonly recipientName: string | null;
  readonly capturedAt: Date;
  readonly otpVerifiedAt: Date | null;
}

/** The stop this shipment occupies on its driver's active route. */
export interface RouteStopEta {
  readonly routeId: string;
  readonly plannedArrival: Date;
}

export interface ListPointsOptions {
  /** Exclusive upper cursor: only points recorded before it. */
  readonly from?: Date;
  readonly limit: number;
}

export interface TrackingRepository {
  /**
   * Stores a batch of believed points for one driver in a single statement.
   * Ordering is the caller's (the batch was sorted during validation).
   */
  insertPoints(
    tenantId: string,
    driverId: string,
    points: readonly ValidatedLocationPoint[],
  ): Promise<void>;

  /** The newest stored point for the driver, or `null` if it never pushed. */
  findLatestPoint(
    tenantId: string,
    driverId: string,
  ): Promise<LocationPointRow | null>;

  /**
   * A window of history, newest first, cursor-paginated on `recorded_at`.
   * Thinned at write time, so this is the path that answers "where has this
   * driver been" without storing every ping.
   */
  listPoints(
    tenantId: string,
    driverId: string,
    options: ListPointsOptions,
  ): Promise<LocationPointRow[]>;

  /** The driver's OUT_FOR_DELIVERY shipments, with dropoff coordinates. */
  activeDropoffs(
    tenantId: string,
    driverId: string,
  ): Promise<ActiveDropoff[]>;

  /** Shipment facts + history + proofs + route ETA, for the track view. */
  findShipmentTracking(
    tenantId: string,
    shipmentId: string,
  ): Promise<ShipmentTrackingRow | null>;

  listTimeline(tenantId: string, shipmentId: string): Promise<TimelineEntry[]>;

  listProofs(tenantId: string, shipmentId: string): Promise<ProofSummaryRow[]>;

  /** ETA from the stop on the driver's active route, when there is one. */
  findStopEta(tenantId: string, shipmentId: string): Promise<RouteStopEta | null>;

  /**
   * Resolves the public tracking pair (number + token) to a shipment id and
   * its tenant, through the `SECURITY DEFINER` SQL function: public tracking
   * runs with no tenant context, so RLS would hide every row from the app
   * role. The caller re-enters a normal tenant-scoped read with the returned
   * tenant id. No tenant context is required here, by construction.
   */
  lookupPublicShipment(
    trackingNumber: string,
    publicToken: string,
  ): Promise<{ shipmentId: string; tenantId: string } | null>;

  /** Deletes history older than the cutoff; returns the rows removed. */
  pruneOlderThan(tenantId: string, cutoff: Date): Promise<number>;

  /**
   * Every tenant id, for background sweeps. `tenants` is deliberately not
   * RLS-protected — it is the one table a sweep must be able to enumerate.
   */
  listTenantIds(): Promise<string[]>;
}
