import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { EntityManager } from 'typeorm';
import type { ValidatedLocationPoint } from '../domain/location-point.js';
import type {
  ActiveDropoff,
  ListPointsOptions,
  LocationPointRow,
  ProofSummaryRow,
  RouteStopEta,
  ShipmentTrackingRow,
  TimelineEntry,
  TrackingRepository,
} from '../domain/tracking.repository.js';

/**
 * Raw-SQL implementation of the {@link TrackingRepository} port.
 *
 * `driver_locations` stores its position as a PostGIS `geography(Point)`,
 * which is what makes the dispatch proximity query fast and what the
 * geofence check reuses; coordinates therefore enter and leave through
 * `ST_MakePoint`/`ST_X`/`ST_Y`, never through a numeric column. Every query
 * filters `tenant_id` explicitly, and documents for the reader which tenant
 * each cross-module read belongs to.
 */
@Injectable()
export class TypeOrmTrackingRepository implements TrackingRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async insertPoints(
    tenantId: string,
    driverId: string,
    points: readonly ValidatedLocationPoint[],
  ): Promise<void> {
    if (points.length === 0) {
      return;
    }
    const manager = this.manager();
    const values: unknown[] = [];
    const tuples = points.map((point) => {
      values.push(
        tenantId,
        driverId,
        point.recordedAt,
        point.longitude,
        point.latitude,
        point.speedKmh,
        point.heading,
      );
      const base = values.length - 7;
      return (
        `($${base + 1}, $${base + 2}, $${base + 3}, ` +
        `ST_SetSRID(ST_MakePoint($${base + 4}, $${base + 5}), 4326)::geography, ` +
        `$${base + 6}, $${base + 7})`
      );
    });
    await manager.query(
      `INSERT INTO driver_locations
         (tenant_id, driver_id, recorded_at, location, speed_kmh, heading)
       VALUES ${tuples.join(', ')}`,
      values,
    );
  }

  async findLatestPoint(
    tenantId: string,
    driverId: string,
  ): Promise<LocationPointRow | null> {
    const rows = (await this.manager().query(
      `SELECT
         dl.driver_id AS driver_id,
         ST_Y(dl.location::geometry) AS latitude,
         ST_X(dl.location::geometry) AS longitude,
         dl.speed_kmh AS speed_kmh,
         dl.heading AS heading,
         dl.recorded_at AS recorded_at
       FROM driver_locations dl
       WHERE dl.tenant_id = $1 AND dl.driver_id = $2
       ORDER BY dl.recorded_at DESC
       LIMIT 1`,
      [tenantId, driverId],
    )) as RawPointRow[];
    return rows.length === 0 ? null : toPointRow(rows[0]);
  }

  async listPoints(
    tenantId: string,
    driverId: string,
    options: ListPointsOptions,
  ): Promise<LocationPointRow[]> {
    const rows = (await this.manager().query(
      `SELECT
         dl.driver_id AS driver_id,
         ST_Y(dl.location::geometry) AS latitude,
         ST_X(dl.location::geometry) AS longitude,
         dl.speed_kmh AS speed_kmh,
         dl.heading AS heading,
         dl.recorded_at AS recorded_at
       FROM driver_locations dl
       WHERE dl.tenant_id = $1
         AND dl.driver_id = $2
         AND ($3::timestamptz IS NULL OR dl.recorded_at < $3::timestamptz)
       ORDER BY dl.recorded_at DESC
       LIMIT $4`,
      [tenantId, driverId, options.from ?? null, options.limit],
    )) as RawPointRow[];
    return rows.map(toPointRow);
  }

  async activeDropoffs(
    tenantId: string,
    driverId: string,
  ): Promise<ActiveDropoff[]> {
    const rows = (await this.manager().query(
      `SELECT
         s.id AS shipment_id,
         ST_Y(a.location::geometry) AS latitude,
         ST_X(a.location::geometry) AS longitude
       FROM shipments s
       JOIN addresses a
         ON a.id = s.dropoff_address_id AND a.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1
         AND s.driver_id = $2
         AND s.status = 'OUT_FOR_DELIVERY'`,
      [tenantId, driverId],
    )) as Array<{
      shipment_id: string;
      latitude: number;
      longitude: number;
    }>;
    return rows.map((row) => ({
      shipmentId: row.shipment_id,
      latitude: row.latitude,
      longitude: row.longitude,
    }));
  }

  async findShipmentTracking(
    tenantId: string,
    shipmentId: string,
  ): Promise<ShipmentTrackingRow | null> {
    const rows = (await this.manager().query(
      `SELECT
         s.id AS shipment_id,
         s.tracking_number AS tracking_number,
         s.status AS status,
         s.driver_id AS driver_id,
         (
           SELECT h.occurred_at
             FROM shipment_status_history h
            WHERE h.shipment_id = s.id AND h.to_status = 'DELIVERED'
            ORDER BY h.occurred_at DESC
            LIMIT 1
         ) AS delivered_at
       FROM shipments s
       WHERE s.tenant_id = $1 AND s.id = $2`,
      [tenantId, shipmentId],
    )) as Array<{
      shipment_id: string;
      tracking_number: string;
      status: string;
      driver_id: string | null;
      delivered_at: Date | null;
    }>;
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      shipmentId: row.shipment_id,
      trackingNumber: row.tracking_number,
      status: row.status,
      driverId: row.driver_id,
      deliveredAt: row.delivered_at,
    };
  }

  async listTimeline(
    tenantId: string,
    shipmentId: string,
  ): Promise<TimelineEntry[]> {
    const rows = (await this.manager().query(
      `SELECT
         h.to_status AS to_status,
         h.reason AS reason,
         h.occurred_at AS occurred_at
       FROM shipment_status_history h
       WHERE h.tenant_id = $1 AND h.shipment_id = $2
       ORDER BY h.occurred_at ASC`,
      [tenantId, shipmentId],
    )) as Array<{
      to_status: string;
      reason: string | null;
      occurred_at: Date;
    }>;
    return rows.map((row) => ({
      toStatus: row.to_status,
      reason: row.reason,
      occurredAt: row.occurred_at,
    }));
  }

  async listProofs(
    tenantId: string,
    shipmentId: string,
  ): Promise<ProofSummaryRow[]> {
    const rows = (await this.manager().query(
      `SELECT
         p.type AS type,
         p.recipient_name AS recipient_name,
         p.captured_at AS captured_at,
         p.otp_verified_at AS otp_verified_at
       FROM proofs_of_delivery p
       WHERE p.tenant_id = $1 AND p.shipment_id = $2
       ORDER BY p.captured_at ASC`,
      [tenantId, shipmentId],
    )) as Array<{
      type: string;
      recipient_name: string | null;
      captured_at: Date;
      otp_verified_at: Date | null;
    }>;
    return rows.map((row) => ({
      type: row.type,
      recipientName: row.recipient_name,
      capturedAt: row.captured_at,
      otpVerifiedAt: row.otp_verified_at,
    }));
  }

  async findStopEta(
    tenantId: string,
    shipmentId: string,
  ): Promise<RouteStopEta | null> {
    const rows = (await this.manager().query(
      `SELECT
         r.id AS route_id,
         rs.planned_arrival AS planned_arrival
       FROM route_stops rs
       JOIN routes r ON r.id = rs.route_id AND rs.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1
         AND rs.shipment_id = $2
         AND r.status IN ('planned', 'active')
       ORDER BY
         CASE r.status WHEN 'active' THEN 0 ELSE 1 END,
         r.created_at DESC
       LIMIT 1`,
      [tenantId, shipmentId],
    )) as Array<{ route_id: string; planned_arrival: Date | null }>;
    if (rows.length === 0 || !rows[0].planned_arrival) {
      return null;
    }
    return {
      routeId: rows[0].route_id,
      plannedArrival: rows[0].planned_arrival,
    };
  }

  async lookupPublicShipment(
    trackingNumber: string,
    publicToken: string,
  ): Promise<{ shipmentId: string; tenantId: string } | null> {
    const rows = (await this.manager().query(
      `SELECT shipment_id, tenant_id
         FROM lookup_public_shipment($1, $2)`,
      [trackingNumber, publicToken],
    )) as Array<{ shipment_id: string; tenant_id: string }>;
    return rows.length === 0
      ? null
      : { shipmentId: rows[0].shipment_id, tenantId: rows[0].tenant_id };
  }

  async pruneOlderThan(tenantId: string, cutoff: Date): Promise<number> {
    const result = (await this.manager().query(
      `DELETE FROM driver_locations
        WHERE tenant_id = $1 AND recorded_at < $2`,
      [tenantId, cutoff],
    )) as unknown[] | undefined;
    // TypeORM returns [rows, affectedCount] for DELETE on pg.
    if (Array.isArray(result) && result.length === 2) {
      return Number(result[1]);
    }
    return 0;
  }

  async listTenantIds(): Promise<string[]> {
    const rows = (await this.manager().query(
      `SELECT id FROM tenants`,
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private manager(): EntityManager {
    return this.txHost.tx;
  }
}

interface RawPointRow {
  driver_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: Date;
}

function toPointRow(row: RawPointRow): LocationPointRow {
  return {
    driverId: row.driver_id,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKmh: row.speed_kmh,
    heading: row.heading,
    recordedAt: row.recorded_at,
  };
}
