import type { Route } from './route.js';

/** Injection token for the persistence port (see the TypeORM adapter). */
export const ROUTING_REPOSITORY = Symbol('ROUTING_REPOSITORY');

/**
 * The routing module's persistence port. All methods run inside the
 * tenant transaction, so RLS scopes every table they touch; the ones that
 * join `shipments`/`vehicles`/`drivers` additionally pin `tenant_id` in the
 * WHERE clause, matching the dispatch repository.
 */
export interface PlanShipmentInput {
  readonly id: string;
  /** Null when the drop-off address has no geocoded point: such a shipment
   * is reported unassigned (`no_coordinates`), never an error. */
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly weightKg: number;
  readonly volumeM3: number | null;
  readonly windowStart: Date | null;
  readonly windowEnd: Date | null;
}

export interface PlanVehicleInput {
  readonly id: string;
  readonly driverId: string | null;
  readonly capacityWeightKg: number;
  readonly capacityVolumeM3: number | null;
  /** The driver's shift overlapping the plan day; null when the driver has
   * none — the route then runs the depot's opening hours. */
  readonly shiftStartsAt: Date | null;
  readonly shiftEndsAt: Date | null;
}

export interface RouteStopRecord {
  readonly id: string;
  readonly shipmentId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly plannedArrival: Date | null;
  readonly windowStart: Date | null;
  readonly windowEnd: Date | null;
}

export interface RouteWithStops {
  readonly route: Route;
  /** The optimistic-lock value behind `If-Match`/ETag. */
  readonly version: number;
  readonly stops: readonly RouteStopRecord[];
}

export interface RoutePlanRecord {
  readonly id: string;
  readonly planDate: string;
  readonly status: 'planning' | 'planned' | 'failed';
  readonly strategy: string;
  readonly seed: string;
  readonly timeBudgetMs: number;
  readonly requestedBy: string | null;
  readonly unassigned: readonly { stopId: string; reason: string }[] | null;
  readonly error: string | null;
  readonly routesCreated: number | null;
  readonly totalDistanceM: number | null;
  readonly totalDurationS: number | null;
  readonly objectiveValue: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One route of a finished plan run, with its ordered stops. */
export interface PlannedRouteInsert {
  readonly route: Route;
  readonly stops: readonly {
    readonly shipmentId: string;
    readonly sequence: number;
    readonly plannedArrival: Date | null;
    readonly windowStart: Date | null;
    readonly windowEnd: Date | null;
  }[];
}

export interface NewRouteStop {
  readonly shipmentId: string;
  readonly sequence: number;
  readonly plannedArrival: Date | null;
}

export interface RouteListFilters {
  readonly planDate?: string;
  readonly status?: string;
  readonly driverId?: string;
  readonly limit: number;
}

/** A stop of an open route, with the shipment fields the optimizer needs. */
export interface ReplanStopInput {
  readonly shipmentId: string;
  readonly weightKg: number;
  readonly volumeM3: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly windowStart: Date | null;
  readonly windowEnd: Date | null;
}

export interface RoutingRepository {
  /** Confirmed shipments without a stop whose window touches the plan date. */
  findPlanShipments(
    tenantId: string,
    planDate: string,
  ): Promise<PlanShipmentInput[]>;
  /** Active vehicles with their driver's shift covering the plan day. */
  findPlanVehicles(
    tenantId: string,
    planDate: string,
  ): Promise<PlanVehicleInput[]>;

  insertPlan(props: {
    tenantId: string;
    planId: string;
    planDate: string;
    strategy: string;
    seed: string;
    timeBudgetMs: number;
    requestedBy: string | null;
  }): Promise<void>;
  findPlan(planId: string): Promise<RoutePlanRecord | null>;
  markPlanPlanned(props: {
    planId: string;
    unassigned: readonly { stopId: string; reason: string }[];
    routesCreated: number;
    totalDistanceM: number;
    totalDurationS: number;
    objectiveValue: number;
  }): Promise<void>;
  markPlanFailed(planId: string, error: string): Promise<void>;
  /** Inserts the routes and their stops, all in the tenant transaction. */
  insertPlannedRoutes(
    tenantId: string,
    planId: string,
    routes: readonly PlannedRouteInsert[],
  ): Promise<void>;
  findRoutesByPlan(planId: string): Promise<RouteWithStops[]>;

  listRoutes(filters: RouteListFilters): Promise<RouteWithStops[]>;
  findRoute(routeId: string): Promise<RouteWithStops | null>;
  /**
   * The route's stops whose shipments are not yet delivered, with the
   * shipment fields the optimizer needs — the input of a replan. Delivered
   * stops stay on the route as history.
   */
  findReplanStops(routeId: string): Promise<ReplanStopInput[]>;
  /** Status/metrics update; TypeORM bumps the `version` column. */
  saveRoute(route: Route): Promise<void>;
  /** Deletes the route's open stops and inserts the new order in one go. */
  replaceStops(
    tenantId: string,
    routeId: string,
    stops: readonly NewRouteStop[],
  ): Promise<void>;
}
