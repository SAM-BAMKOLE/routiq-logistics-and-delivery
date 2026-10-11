/**
 * The Route aggregate: one vehicle's ordered tour for a plan date.
 * Framework-free on purpose — transitions are pure and every rule lives
 * here, so the lifecycle is testable without I/O.
 *
 * The lifecycle (architecture, "Dispatch and driver assignment" and the
 * routes endpoints):
 *
 *     (plan run) ──▶ planned ──start──▶ active ──(last stop delivered)──▶
 *       completed                │
 *                                └──replan──▶ planned | active
 *
 * Replanning is allowed both before and after start: the architecture's
 * driver flow replans when a driver accepts or rejects a job, and the
 * phase-1 endpoint re-solves a route's remaining stops in place. Phase 1
 * only ever produces `planned` and `active`; `completed` and `cancelled`
 * exist for Step 10 (tracking closes routes) and phase 2 (cancelling one
 * frees its shipments again) and are unreachable so far.
 *
 * The `version` column is the optimistic-lock companion of `If-Match`;
 * like shipments, it lives in persistence, not in this class.
 */
export const ROUTE_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export function isRouteStatus(value: unknown): value is RouteStatus {
  return (
    typeof value === 'string' && (ROUTE_STATUSES as readonly string[]).includes(value)
  );
}

/** Statuses whose stops are still part of the daily plan. */
export const OPEN_ROUTE_STATUSES = ['planned', 'active'] as const;

export function isOpenRouteStatus(
  value: RouteStatus,
): value is (typeof OPEN_ROUTE_STATUSES)[number] {
  return (OPEN_ROUTE_STATUSES as readonly string[]).includes(value);
}

/**
 * Domain error raised by the aggregate. Framework-free on purpose: the
 * application layer maps codes to HTTP problem+json responses (the
 * conflict-generating codes become 409).
 */
export class RouteDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RouteDomainError';
  }
}

export type RouteEventType = 'RoutePlanned' | 'RouteReplanned';

/** A domain event raised by the aggregate. */
export interface RouteDomainEvent {
  readonly type: RouteEventType;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
}

/** The optimizer's headline numbers for one route. */
export interface RouteMetrics {
  readonly totalDistanceMeters: number;
  readonly totalDurationSeconds: number;
  readonly objectiveValue: number;
}

export interface PlanRouteProps {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string | null;
  readonly planDate: string;
  readonly vehicleId: string | null;
  readonly driverId: string | null;
  readonly algorithm: string;
  readonly stopCount: number;
  readonly metrics: RouteMetrics;
}

export interface RehydrateRouteProps extends Omit<PlanRouteProps, 'stopCount'> {
  readonly status: RouteStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ReplanRouteProps {
  readonly stopCount: number;
  readonly unassignedCount: number;
  readonly metrics: RouteMetrics;
}

/**
 * The Route aggregate: the only place allowed to change a route's status or
 * metrics. Every transition guards the lifecycle above and raises a domain
 * event — all in memory. Persistence and the stop rows belong to the
 * application layer.
 */
export class Route {
  private currentStatus: RouteStatus;
  private currentMetrics: RouteMetrics;
  private readonly eventQueue: RouteDomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly planId: string | null,
    readonly planDate: string,
    readonly vehicleId: string | null,
    readonly driverId: string | null,
    readonly algorithm: string,
    readonly createdAt: Date,
    private currentUpdatedAt: Date,
    status: RouteStatus,
    metrics: RouteMetrics,
  ) {
    this.currentStatus = status;
    this.currentMetrics = metrics;
  }

  /** Created by a plan run: already ordered, already measured. */
  static plan(props: PlanRouteProps): Route {
    const now = new Date();
    const route = new Route(
      props.id,
      props.tenantId,
      props.planId,
      props.planDate,
      props.vehicleId,
      props.driverId,
      props.algorithm,
      now,
      now,
      'planned',
      props.metrics,
    );
    route.eventQueue.push({
      type: 'RoutePlanned',
      occurredAt: now,
      payload: {
        routeId: props.id,
        planId: props.planId,
        planDate: props.planDate,
        driverId: props.driverId,
        vehicleId: props.vehicleId,
        stopCount: props.stopCount,
        totalDistanceM: props.metrics.totalDistanceMeters,
        totalDurationS: props.metrics.totalDurationSeconds,
        algorithm: props.algorithm,
        objectiveValue: props.metrics.objectiveValue,
      },
    });
    return route;
  }

  static rehydrate(props: RehydrateRouteProps): Route {
    return new Route(
      props.id,
      props.tenantId,
      props.planId,
      props.planDate,
      props.vehicleId,
      props.driverId,
      props.algorithm,
      props.createdAt,
      props.updatedAt,
      props.status,
      props.metrics,
    );
  }

  get status(): RouteStatus {
    return this.currentStatus;
  }

  get metrics(): RouteMetrics {
    return this.currentMetrics;
  }

  get updatedAt(): Date {
    return this.currentUpdatedAt;
  }

  /** Events raised since the last {@link pullDomainEvents}. */
  pullDomainEvents(): RouteDomainEvent[] {
    return this.eventQueue.splice(0, this.eventQueue.length);
  }

  /** planned to active: the driver started driving the tour. */
  start(): void {
    if (this.currentStatus !== 'planned') {
      throw new RouteDomainError(
        'ROUTE_NOT_STARTABLE',
        `A route in status ${this.currentStatus} cannot be started.`,
      );
    }
    this.currentStatus = 'active';
    this.currentUpdatedAt = new Date();
  }

  /**
   * Re-solves the route's remaining stops in place: new metrics, new stop
   * rows (the application layer swaps them), same vehicle and driver.
   */
  applyReplan(props: ReplanRouteProps): void {
    if (!isOpenRouteStatus(this.currentStatus)) {
      throw new RouteDomainError(
        'ROUTE_NOT_REPLANABLE',
        `A route in status ${this.currentStatus} cannot be replanned.`,
      );
    }
    const now = new Date();
    this.currentMetrics = props.metrics;
    this.currentUpdatedAt = now;
    this.eventQueue.push({
      type: 'RouteReplanned',
      occurredAt: now,
      payload: {
        routeId: this.id,
        planDate: this.planDate,
        driverId: this.driverId,
        vehicleId: this.vehicleId,
        stopCount: props.stopCount,
        unassignedCount: props.unassignedCount,
        totalDistanceM: props.metrics.totalDistanceMeters,
        totalDurationS: props.metrics.totalDurationSeconds,
        objectiveValue: props.metrics.objectiveValue,
      },
    });
  }
}
