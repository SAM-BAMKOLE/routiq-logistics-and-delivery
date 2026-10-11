import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Route, isRouteStatus } from '../domain/route.js';
import type {
  NewRouteStop,
  PlanShipmentInput,
  PlanVehicleInput,
  PlannedRouteInsert,
  ReplanStopInput,
  RouteListFilters,
  RoutePlanRecord,
  RouteStopRecord,
  RouteWithStops,
  RoutingRepository,
} from '../domain/routing.repository.js';
import { RouteOrmEntity } from './route.orm-entity.js';
import { RoutePlanOrmEntity } from './route-plan.orm-entity.js';
import { RouteStopOrmEntity } from './route-stop.orm-entity.js';

/**
 * TypeORM implementation of the {@link RoutingRepository} port. Everything
 * runs inside the tenant transaction, so RLS scopes every table; the raw
 * plan queries additionally pin `tenant_id` in the WHERE clause, matching
 * the dispatch repository.
 */
@Injectable()
export class TypeOrmRoutingRepository implements RoutingRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async findPlanShipments(
    tenantId: string,
    planDate: string,
  ): Promise<PlanShipmentInput[]> {
    const rows = (await this.manager().query(
      `
      SELECT
        s.id,
        ST_Y(a.location::geometry) AS latitude,
        ST_X(a.location::geometry) AS longitude,
        s.weight_kg,
        s.volume_m3,
        s.window_start,
        s.window_end
      FROM shipments s
      LEFT JOIN addresses a ON a.id = s.dropoff_address_id
      WHERE s.tenant_id = $1
        AND s.status = 'CONFIRMED'
        AND (s.window_start IS NULL OR s.window_start < ($2::date + interval '1 day'))
        AND (s.window_end IS NULL OR s.window_end >= $2::date)
        AND NOT EXISTS (
          SELECT 1 FROM route_stops rs WHERE rs.shipment_id = s.id
        )
      ORDER BY s.id
      `,
      [tenantId, planDate],
    )) as Array<{
      id: string;
      latitude: number | null;
      longitude: number | null;
      weight_kg: string | number;
      volume_m3: string | number | null;
      window_start: Date | null;
      window_end: Date | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      weightKg: Number(row.weight_kg),
      volumeM3: row.volume_m3 === null ? null : Number(row.volume_m3),
      windowStart: row.window_start,
      windowEnd: row.window_end,
    }));
  }

  async findPlanVehicles(
    tenantId: string,
    planDate: string,
  ): Promise<PlanVehicleInput[]> {
    const rows = (await this.manager().query(
      `
      SELECT
        v.id,
        v.capacity_weight_kg,
        v.capacity_volume_m3,
        d.id AS driver_id,
        shift.starts_at,
        shift.ends_at
      FROM vehicles v
      LEFT JOIN drivers d
        ON d.current_vehicle_id = v.id AND d.status = 'active'
      LEFT JOIN LATERAL (
        SELECT s.starts_at, s.ends_at
          FROM driver_shifts s
         WHERE s.driver_id = d.id
           AND s.starts_at < ($2::date + interval '1 day')
           AND s.ends_at > $2::date
         ORDER BY s.starts_at ASC
         LIMIT 1
      ) shift ON TRUE
      WHERE v.tenant_id = $1
        AND v.status = 'active'
      ORDER BY v.id
      `,
      [tenantId, planDate],
    )) as Array<{
      id: string;
      capacity_weight_kg: string | number;
      capacity_volume_m3: string | number | null;
      driver_id: string | null;
      starts_at: Date | null;
      ends_at: Date | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      driverId: row.driver_id,
      capacityWeightKg: Number(row.capacity_weight_kg),
      capacityVolumeM3:
        row.capacity_volume_m3 === null ? null : Number(row.capacity_volume_m3),
      shiftStartsAt: row.starts_at,
      shiftEndsAt: row.ends_at,
    }));
  }

  async insertPlan(props: {
    tenantId: string;
    planId: string;
    planDate: string;
    strategy: string;
    seed: string;
    timeBudgetMs: number;
    requestedBy: string | null;
  }): Promise<void> {
    await this.manager().insert(RoutePlanOrmEntity, {
      id: props.planId,
      tenantId: props.tenantId,
      planDate: props.planDate,
      status: 'planning',
      strategy: props.strategy,
      seed: props.seed,
      timeBudgetMs: props.timeBudgetMs,
      requestedBy: props.requestedBy,
    });
  }

  async findPlan(planId: string): Promise<RoutePlanRecord | null> {
    const entity = await this.manager().findOne(RoutePlanOrmEntity, {
      where: { id: planId },
    });
    return entity ? toPlanRecord(entity) : null;
  }

  async markPlanPlanned(props: {
    planId: string;
    unassigned: readonly { stopId: string; reason: string }[];
    routesCreated: number;
    totalDistanceM: number;
    totalDurationS: number;
    objectiveValue: number;
  }): Promise<void> {
    await this.manager().update(
      RoutePlanOrmEntity,
      { id: props.planId },
      {
        status: 'planned',
        unassigned: [...props.unassigned],
        error: null,
        routesCreated: props.routesCreated,
        totalDistanceM: props.totalDistanceM,
        totalDurationS: props.totalDurationS,
        objectiveValue: props.objectiveValue,
      },
    );
  }

  async markPlanFailed(planId: string, error: string): Promise<void> {
    await this.manager().update(
      RoutePlanOrmEntity,
      { id: planId },
      { status: 'failed', error },
    );
  }

  async insertPlannedRoutes(
    tenantId: string,
    planId: string,
    routes: readonly PlannedRouteInsert[],
  ): Promise<void> {
    for (const planned of routes) {
      const { route } = planned;
      await this.manager().insert(RouteOrmEntity, {
        // The aggregate owns the id: events all reference it.
        id: route.id,
        tenantId,
        planId,
        vehicleId: route.vehicleId,
        driverId: route.driverId,
        planDate: route.planDate,
        status: route.status,
        totalDistanceM: route.metrics.totalDistanceMeters,
        totalDurationS: route.metrics.totalDurationSeconds,
        algorithm: route.algorithm,
        objectiveValue: route.metrics.objectiveValue,
      });
      if (planned.stops.length > 0) {
        await this.manager().insert(
          RouteStopOrmEntity,
          planned.stops.map((stop) => ({
            tenantId,
            routeId: route.id,
            shipmentId: stop.shipmentId,
            sequence: stop.sequence,
            plannedArrival: stop.plannedArrival,
            windowStart: stop.windowStart,
            windowEnd: stop.windowEnd,
          })),
        );
      }
    }
  }

  async findRoutesByPlan(planId: string): Promise<RouteWithStops[]> {
    const entities = await this.manager().find(RouteOrmEntity, {
      where: { planId },
      order: { id: 'ASC' },
    });
    return this.withStops(entities);
  }

  async listRoutes(filters: RouteListFilters): Promise<RouteWithStops[]> {
    let builder = this.manager()
      .getRepository(RouteOrmEntity)
      .createQueryBuilder('route');
    if (filters.planDate) {
      builder = builder.andWhere('route.plan_date = :planDate', {
        planDate: filters.planDate,
      });
    }
    if (filters.status) {
      builder = builder.andWhere('route.status = :status', {
        status: filters.status,
      });
    }
    if (filters.driverId) {
      builder = builder.andWhere('route.driver_id = :driverId', {
        driverId: filters.driverId,
      });
    }
    const entities = await builder
      .orderBy('route.plan_date', 'DESC')
      .addOrderBy('route.id', 'ASC')
      .limit(filters.limit)
      .getMany();
    return this.withStops(entities);
  }

  async findRoute(routeId: string): Promise<RouteWithStops | null> {
    const entity = await this.manager().findOne(RouteOrmEntity, {
      where: { id: routeId },
    });
    if (!entity) {
      return null;
    }
    const [withStops] = await this.withStops([entity]);
    return withStops;
  }

  async findReplanStops(routeId: string): Promise<ReplanStopInput[]> {
    const rows = (await this.manager().query(
      `
      SELECT
        rs.shipment_id,
        s.weight_kg,
        s.volume_m3,
        ST_Y(a.location::geometry) AS latitude,
        ST_X(a.location::geometry) AS longitude,
        s.window_start,
        s.window_end
      FROM route_stops rs
      JOIN shipments s ON s.id = rs.shipment_id
      LEFT JOIN addresses a ON a.id = s.dropoff_address_id
      WHERE rs.route_id = $1
        AND s.status <> 'DELIVERED'
      ORDER BY rs.sequence ASC
      `,
      [routeId],
    )) as Array<{
      shipment_id: string;
      weight_kg: string | number;
      volume_m3: string | number | null;
      latitude: number | null;
      longitude: number | null;
      window_start: Date | null;
      window_end: Date | null;
    }>;
    return rows.map((row) => ({
      shipmentId: row.shipment_id,
      weightKg: Number(row.weight_kg),
      volumeM3: row.volume_m3 === null ? null : Number(row.volume_m3),
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      windowStart: row.window_start,
      windowEnd: row.window_end,
    }));
  }

  async saveRoute(route: Route): Promise<void> {
    await this.manager().update(
      RouteOrmEntity,
      { id: route.id },
      {
        status: route.status,
        totalDistanceM: route.metrics.totalDistanceMeters,
        totalDurationS: route.metrics.totalDurationSeconds,
        objectiveValue: route.metrics.objectiveValue,
      },
    );
  }

  async replaceStops(
    tenantId: string,
    routeId: string,
    stops: readonly NewRouteStop[],
  ): Promise<void> {
    await this.manager().delete(RouteStopOrmEntity, { routeId });
    if (stops.length > 0) {
      await this.manager().insert(
        RouteStopOrmEntity,
        stops.map((stop) => ({
          tenantId,
          routeId,
          shipmentId: stop.shipmentId,
          sequence: stop.sequence,
          plannedArrival: stop.plannedArrival,
        })),
      );
    }
  }

  private async withStops(
    entities: readonly RouteOrmEntity[],
  ): Promise<RouteWithStops[]> {
    if (entities.length === 0) {
      return [];
    }
    const routeIds = entities.map((entity) => entity.id);
    const stopRows = (await this.manager().query(
      `
      SELECT
        route_id, id, shipment_id, sequence, kind,
        planned_arrival, window_start, window_end
      FROM route_stops
      WHERE route_id = ANY($1)
      ORDER BY route_id ASC, sequence ASC
      `,
      [routeIds],
    )) as Array<StopRow>;
    const byRoute = new Map<string, RouteStopRecord[]>();
    for (const row of stopRows) {
      const record = toStopRecord(row);
      const bucket = byRoute.get(row.route_id);
      if (bucket) {
        bucket.push(record);
      } else {
        byRoute.set(row.route_id, [record]);
      }
    }
    return entities.map((entity) => ({
      route: toDomain(entity),
      version: entity.version,
      stops: byRoute.get(entity.id) ?? [],
    }));
  }

  private manager() {
    return this.txHost.tx;
  }
}

interface StopRow {
  id: string;
  route_id: string;
  shipment_id: string;
  sequence: number;
  kind: string;
  planned_arrival: Date | null;
  window_start: Date | null;
  window_end: Date | null;
}

function toStopRecord(row: StopRow): RouteStopRecord {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    sequence: row.sequence,
    kind: row.kind,
    plannedArrival: row.planned_arrival,
    windowStart: row.window_start,
    windowEnd: row.window_end,
  };
}

function toDomain(entity: RouteOrmEntity): Route {
  if (!isRouteStatus(entity.status)) {
    throw new Error(
      `Route ${entity.id} has unknown status "${entity.status}".`,
    );
  }
  return Route.rehydrate({
    id: entity.id,
    tenantId: entity.tenantId,
    planId: entity.planId,
    planDate: entity.planDate,
    vehicleId: entity.vehicleId,
    driverId: entity.driverId,
    algorithm: entity.algorithm,
    status: entity.status,
    metrics: {
      totalDistanceMeters: entity.totalDistanceM,
      totalDurationSeconds: entity.totalDurationS,
      objectiveValue: entity.objectiveValue,
    },
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  });
}

function toPlanRecord(entity: RoutePlanOrmEntity): RoutePlanRecord {
  if (
    entity.status !== 'planning' &&
    entity.status !== 'planned' &&
    entity.status !== 'failed'
  ) {
    throw new Error(
      `Route plan ${entity.id} has unknown status "${entity.status}".`,
    );
  }
  return {
    id: entity.id,
    planDate: entity.planDate,
    status: entity.status,
    strategy: entity.strategy,
    seed: entity.seed,
    timeBudgetMs: entity.timeBudgetMs,
    requestedBy: entity.requestedBy,
    unassigned: entity.unassigned,
    error: entity.error,
    routesCreated: entity.routesCreated,
    totalDistanceM: entity.totalDistanceM,
    totalDurationS: entity.totalDurationS,
    objectiveValue: entity.objectiveValue,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
