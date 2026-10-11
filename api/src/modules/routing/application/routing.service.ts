import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PreconditionFailedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { DriversService } from '../../drivers/application/drivers.service.js';
import type { Role } from '../../identity/domain/membership.js';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';
import { EVENT_BUS, type EventBus } from '../../../shared/messaging/event-bus.js';
import {
  Route,
  RouteDomainError,
  isOpenRouteStatus,
} from '../domain/route.js';
import {
  ROUTING_REPOSITORY,
  type PlanShipmentInput,
  type PlanVehicleInput,
  type RoutePlanRecord,
  type RouteWithStops,
  type RoutingRepository,
} from '../domain/routing.repository.js';
import {
  clockToSeconds,
  routingSettingsFrom,
  type RoutingSettings,
} from '../domain/routing-settings.js';
import {
  HaversineMatrixProvider,
  createProblem,
  getStrategy,
  isRoutingStrategyName,
  parseSeed,
  type RoutingProblem,
  type RoutingStop,
  type RoutingStrategyName,
  type RoutingVehicle,
  type SolvedRoute,
  type SolveOptions,
  type UnassignedStop,
} from '../optimization/index.js';

/** The authenticated principal as the routing service wants it. */
export interface RoutingActor {
  readonly userId: string;
  readonly role: Role;
}

export interface PlanRouteRequest {
  readonly planDate: string;
  readonly strategy?: RoutingStrategyName;
  readonly seed?: string;
}

export interface PlanRouteAccepted {
  readonly id: string;
  readonly planDate: string;
  readonly status: 'planning';
  readonly strategy: RoutingStrategyName;
  readonly seed: string;
  readonly timeBudgetMs: number;
}

export interface RoutePlanView {
  readonly plan: RoutePlanRecord;
  readonly routes: readonly RouteWithStops[];
}

export interface ReplanResult {
  readonly route: RouteWithStops;
  readonly unassigned: readonly { shipmentId: string; reason: string }[];
}

/** The optimizer's view of one stop, shared by plan and replan inputs. */
interface PlannerStop {
  readonly id: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly weightKg: number;
  readonly volumeM3: number | null;
  readonly windowStart: Date | null;
  readonly windowEnd: Date | null;
}

/**
 * Application service for routing: the planning run (collect, solve,
 * persist), route reads with driver scoping, and the two state changes
 * (`start`, `replan`) guarded by `If-Match` like shipments.
 *
 * Phase-1 execution model, a documented tradeoff against the doc's worker
 * pool: `POST /routes/plan` inserts the plan row, kicks the optimizer as an
 * in-process background task, and answers 202 immediately — the caller
 * polls `GET /routes/plans/:id`. The optimizer is iteration-bounded and
 * time-budgeted, so the inline run stays short; the phase-2 queue moves the
 * same `executePlan` body onto a worker thread without changing this API.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    @Inject(ROUTING_REPOSITORY)
    private readonly routing: RoutingRepository,
    private readonly drivers: DriversService,
    private readonly tenants: TenantsService,
    private readonly transactions: TenantTransactionService,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  // ---------------------------------------------------------------------
  // Dispatcher side
  // ---------------------------------------------------------------------

  /**
   * Starts a planning run for a date: validates the tenant can plan at all
   * (depot, fleet, stop limit), records the request, then solves it in the
   * background and answers immediately.
   */
  async plan(
    actor: RoutingActor,
    tenantId: string,
    request: PlanRouteRequest,
  ): Promise<PlanRouteAccepted> {
    const settings = await this.settingsFor(tenantId);
    if (!settings.depot) {
      throw new UnprocessableEntityException({
        message:
          'This tenant has no routing depot configured; set routing.depot (latitude/longitude) in the tenant settings before planning.',
        code: 'ROUTING_DEPOT_MISSING',
      });
    }
    const planDate = this.parsePlanDate(request.planDate);
    const strategy = request.strategy ?? settings.strategy;
    if (!isRoutingStrategyName(strategy)) {
      throw new UnprocessableEntityException({
        message: `Unknown routing strategy "${String(strategy)}".`,
        code: 'ROUTING_STRATEGY_UNKNOWN',
      });
    }
    const seed = request.seed?.trim() || String(randomInt(2 ** 31));

    // One planning pass over what exists right now, both to fail fast on
    // impossible plans and to size them against the tenant's limit.
    const shipments = await this.routing.findPlanShipments(tenantId, planDate);
    if (shipments.length === 0) {
      throw new UnprocessableEntityException({
        message: `No confirmed shipments need a route on ${planDate}.`,
        code: 'ROUTING_PLAN_EMPTY',
      });
    }
    if (shipments.length > settings.maxStops) {
      throw new UnprocessableEntityException({
        message: `Plan date ${planDate} has ${shipments.length} shipments, over the tenant's limit of ${settings.maxStops}.`,
        code: 'ROUTING_PLAN_TOO_LARGE',
      });
    }
    const vehicles = await this.routing.findPlanVehicles(tenantId, planDate);
    if (vehicles.length === 0) {
      throw new UnprocessableEntityException({
        message: `No active vehicles are available to plan on ${planDate}.`,
        code: 'ROUTING_NO_VEHICLES',
      });
    }

    const planId = randomUUID();
    await this.routing.insertPlan({
      tenantId,
      planId,
      planDate,
      strategy,
      seed,
      timeBudgetMs: settings.timeBudgetMs,
      requestedBy: actor.userId,
    });
    // Background task: its own tenant transaction, never awaited. Errors
    // land on the plan row (`failed`) where the poller sees them.
    void this.executePlan(tenantId, planId, {
      planDate,
      strategy,
      seed,
      settings,
      shipments,
      vehicles,
    });
    this.logger.debug(
      { planId, planDate, strategy, shipments: shipments.length },
      'route plan accepted',
    );
    return {
      id: planId,
      planDate,
      status: 'planning',
      strategy,
      seed,
      timeBudgetMs: settings.timeBudgetMs,
    };
  }

  /** The 202's status URL target: the plan with its finished routes. */
  async getPlan(
    _actor: RoutingActor,
    tenantId: string,
    planId: string,
  ): Promise<RoutePlanView> {
    const plan = await this.routing.findPlan(planId);
    if (!plan) {
      throw routePlanNotFound(planId);
    }
    const routes = await this.routing.findRoutesByPlan(planId);
    return { plan, routes };
  }

  /** Routes for a date/status/driver. Drivers only ever see their own. */
  async listRoutes(
    actor: RoutingActor,
    tenantId: string,
    filters: { planDate?: string; status?: string; driverId?: string },
  ): Promise<RouteWithStops[]> {
    const scoped = await this.scopeToOwnDriver(actor, tenantId, filters);
    return this.routing.listRoutes({ ...scoped, limit: 100 });
  }

  /** One route with its stops. Another driver's route answers 404. */
  async getRoute(
    actor: RoutingActor,
    tenantId: string,
    id: string,
  ): Promise<RouteWithStops> {
    const found = await this.routing.findRoute(id);
    if (!found) {
      throw routeNotFound(id);
    }
    const visible = await this.isVisibleTo(actor, tenantId, found.route);
    if (!visible) {
      throw routeNotFound(id);
    }
    return found;
  }

  /** planned to active; requires the caller's last-seen version. */
  async start(
    _actor: RoutingActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
  ): Promise<RouteWithStops> {
    const found = await this.routing.findRoute(id);
    if (!found) {
      throw routeNotFound(id);
    }
    this.ensureVersion(found, expectedVersion);
    try {
      found.route.start();
    } catch (error) {
      throw mapRouteDomainError(error);
    }
    await this.routing.saveRoute(found.route);
    const reloaded = await this.routing.findRoute(id);
    if (!reloaded) {
      throw routeNotFound(id);
    }
    return reloaded;
  }

  /**
   * Re-solves the route's remaining stops (everything not yet delivered) on
   * the same vehicle, in place: same route row, swapped stop order, fresh
   * metrics and ETAs. Shipments that fall out of the solution leave the
   * route and come back in the response's `unassigned` list with reasons.
   */
  async replan(
    _actor: RoutingActor,
    tenantId: string,
    id: string,
    expectedVersion: number,
  ): Promise<ReplanResult> {
    const found = await this.routing.findRoute(id);
    if (!found) {
      throw routeNotFound(id);
    }
    this.ensureVersion(found, expectedVersion);
    const route = found.route;
    if (!isOpenRouteStatus(route.status)) {
      throw new ConflictException({
        message: `A route in status ${route.status} cannot be replanned.`,
        code: 'ROUTE_NOT_REPLANABLE',
      });
    }

    const settings = await this.settingsFor(tenantId);
    if (!settings.depot) {
      throw new UnprocessableEntityException({
        message:
          'This tenant has no routing depot configured; set routing.depot (latitude/longitude) in the tenant settings before replanning.',
        code: 'ROUTING_DEPOT_MISSING',
      });
    }
    if (!route.vehicleId) {
      throw new UnprocessableEntityException({
        message: `Route ${id} has no vehicle and cannot be replanned.`,
        code: 'ROUTING_REPLAN_NO_VEHICLE',
      });
    }
    const fleet = await this.routing.findPlanVehicles(tenantId, route.planDate);
    const vehicle = fleet.find((candidate) => candidate.id === route.vehicleId);
    if (!vehicle) {
      throw new UnprocessableEntityException({
        message: `Route ${id} has no active vehicle to replan with.`,
        code: 'ROUTING_REPLAN_NO_VEHICLE',
      });
    }

    const stops = await this.routing.findReplanStops(id);
    const { problem, unassigned: preUnassigned } = this.buildProblem({
      planDate: route.planDate,
      stops: stops.map((stop) => ({ ...stop, id: stop.shipmentId })),
      vehicles: [vehicle],
      settings,
    });
    const solution = getStrategy(settings.strategy).solve(
      problem,
      this.solveOptions(settings, route.id),
    );
    const unassigned = [...preUnassigned, ...solution.unassigned];
    const solved = solution.routes[0] ?? null;
    const metrics = this.metricsOf(solved, settings);

    const midnightMs = this.midnightMs(route.planDate);
    const newStops = (solved?.stops ?? []).map((planned, index) => ({
      shipmentId: planned.stopId,
      sequence: index + 1,
      plannedArrival: new Date(
        midnightMs + planned.arrivalSeconds * 1_000,
      ),
    }));

    try {
      route.applyReplan({
        stopCount: newStops.length,
        unassignedCount: unassigned.length,
        metrics,
      });
    } catch (error) {
      throw mapRouteDomainError(error);
    }
    await this.routing.replaceStops(tenantId, id, newStops);
    await this.routing.saveRoute(route);
    await this.publishRouteEvents(route);

    const reloaded = await this.routing.findRoute(id);
    if (!reloaded) {
      throw routeNotFound(id);
    }
    return {
      route: reloaded,
      unassigned: unassigned.map((stop) => ({
        shipmentId: stop.stopId,
        reason: stop.reason,
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Planning execution (the background half of `plan`)
  // ---------------------------------------------------------------------

  /**
   * Solves and persists one plan run in its own tenant transaction. The
   * plan row doubles as the commit barrier: route rows reference it by FK,
   * so we wait until the request's insert is visible before writing.
   */
  private async executePlan(
    tenantId: string,
    planId: string,
    input: {
      planDate: string;
      strategy: RoutingStrategyName;
      seed: string;
      settings: RoutingSettings;
      shipments: readonly PlanShipmentInput[];
      vehicles: readonly PlanVehicleInput[];
    },
  ): Promise<void> {
    try {
      await this.transactions.runWithTenant(tenantId, async () => {
        await this.awaitPlanVisible(planId);
        const { problem, unassigned: preUnassigned } = this.buildProblem({
          planDate: input.planDate,
          stops: input.shipments,
          vehicles: input.vehicles,
          settings: input.settings,
        });
        const solution = getStrategy(input.strategy).solve(
          problem,
          this.solveOptions(input.settings, input.seed),
        );
        const unassigned = [...preUnassigned, ...solution.unassigned];

        const midnightMs = this.midnightMs(input.planDate);
        const vehicleById = new Map(
          input.vehicles.map((vehicle) => [vehicle.id, vehicle]),
        );
        const windowById = new Map(
          input.shipments.map((shipment) => [
            shipment.id,
            { windowStart: shipment.windowStart, windowEnd: shipment.windowEnd },
          ]),
        );
        const aggregates = solution.routes.map((solved) =>
          Route.plan({
            id: randomUUID(),
            tenantId,
            planId,
            planDate: input.planDate,
            vehicleId: solved.vehicleId,
            driverId: vehicleById.get(solved.vehicleId)?.driverId ?? null,
            algorithm: input.strategy,
            stopCount: solved.stops.length,
            metrics: this.metricsOf(solved, input.settings),
          }),
        );
        await this.routing.insertPlannedRoutes(
          tenantId,
          planId,
          aggregates.map((route, index) => ({
            route,
            stops: solution.routes[index].stops.map((planned, sequence) => ({
              shipmentId: planned.stopId,
              sequence: sequence + 1,
              plannedArrival: new Date(
                midnightMs + planned.arrivalSeconds * 1_000,
              ),
              windowStart: windowById.get(planned.stopId)?.windowStart ?? null,
              windowEnd: windowById.get(planned.stopId)?.windowEnd ?? null,
            })),
          })),
        );
        await this.routing.markPlanPlanned({
          planId,
          unassigned: unassigned.map((stop) => ({
            stopId: stop.stopId,
            reason: stop.reason,
          })),
          routesCreated: aggregates.length,
          totalDistanceM: solution.totalDistanceMeters,
          totalDurationS: solution.routes.reduce(
            (sum, solved) => sum + solved.durationSeconds,
            0,
          ),
          objectiveValue: solution.objectiveValue,
        });
        for (const route of aggregates) {
          await this.publishRouteEvents(route);
        }
        this.logger.debug(
          {
            planId,
            routes: aggregates.length,
            unassigned: unassigned.length,
          },
          'route plan completed',
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { planId, err: message },
        'route plan failed; marking the plan row failed',
      );
      try {
        await this.transactions.runWithTenant(tenantId, async () => {
          await this.routing.markPlanFailed(planId, message.slice(0, 2_000));
        });
      } catch (markError) {
        this.logger.error(
          { planId, err: markError },
          'could not mark the route plan failed',
        );
      }
    }
  }

  /** Waits until the plan row committed by the request is visible. */
  private async awaitPlanVisible(planId: string): Promise<RoutePlanRecord> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const plan = await this.routing.findPlan(planId);
      if (plan) {
        return plan;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Route plan ${planId} never became visible.`);
  }

  // ---------------------------------------------------------------------
  // Problem building (shared by plan and replan)
  // ---------------------------------------------------------------------

  private buildProblem(props: {
    planDate: string;
    stops: readonly PlannerStop[];
    vehicles: readonly PlanVehicleInput[];
    settings: RoutingSettings;
  }): { problem: RoutingProblem; unassigned: UnassignedStop[] } {
    const depot = props.settings.depot;
    if (!depot) {
      throw new UnprocessableEntityException({
        message: 'This tenant has no routing depot configured.',
        code: 'ROUTING_DEPOT_MISSING',
      });
    }
    const midnightMs = this.midnightMs(props.planDate);
    const toSeconds = (value: Date): number =>
      (value.getTime() - midnightMs) / 1_000;
    const opensSeconds = clockToSeconds(props.settings.depotOpensAt);
    const closesSeconds = clockToSeconds(props.settings.depotClosesAt);

    const unassigned: UnassignedStop[] = [];
    const stops: RoutingStop[] = [];
    for (const stop of props.stops) {
      if (stop.latitude === null || stop.longitude === null) {
        // A never-geocoded address is reported, not an error (architecture:
        // "Unserved stops ... never an error").
        unassigned.push({ stopId: stop.id, reason: 'no_coordinates' });
        continue;
      }
      stops.push({
        id: stop.id,
        location: { latitude: stop.latitude, longitude: stop.longitude },
        weightKg: stop.weightKg,
        volumeM3: stop.volumeM3 ?? 0,
        earliestSeconds: stop.windowStart ? toSeconds(stop.windowStart) : 0,
        latestSeconds: stop.windowEnd
          ? toSeconds(stop.windowEnd)
          : Number.POSITIVE_INFINITY,
        serviceSeconds: props.settings.serviceSeconds,
      });
    }

    const vehicles: RoutingVehicle[] = props.vehicles.map((vehicle) => ({
      id: vehicle.id,
      capacityWeightKg: vehicle.capacityWeightKg,
      capacityVolumeM3:
        vehicle.capacityVolumeM3 ?? Number.POSITIVE_INFINITY,
      shiftStartSeconds: vehicle.shiftStartsAt
        ? toSeconds(vehicle.shiftStartsAt)
        : opensSeconds,
      shiftEndSeconds: vehicle.shiftEndsAt
        ? toSeconds(vehicle.shiftEndsAt)
        : closesSeconds,
    }));

    const matrix = new HaversineMatrixProvider({
      circuityFactor: props.settings.circuityFactor,
      averageSpeedKmh: props.settings.averageSpeedKmh,
    }).build([depot, ...stops.map((stop) => stop.location)]);

    return {
      problem: createProblem({
        depot,
        depotOpensSeconds: opensSeconds,
        depotClosesSeconds: closesSeconds,
        vehicles,
        stops,
        matrix,
      }),
      unassigned,
    };
  }

  private solveOptions(
    settings: RoutingSettings,
    seed: string,
  ): SolveOptions {
    return {
      timeBudgetMs: settings.timeBudgetMs,
      seed: parseSeed(seed),
      weights: settings.weights,
      maxIterations: settings.maxIterations,
    };
  }

  private metricsOf(
    solved: SolvedRoute | null,
    settings: RoutingSettings,
  ): {
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    objectiveValue: number;
  } {
    if (!solved) {
      return {
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        objectiveValue: 0,
      };
    }
    return {
      totalDistanceMeters: solved.distanceMeters,
      totalDurationSeconds: solved.durationSeconds,
      objectiveValue:
        settings.weights.distance * solved.distanceMeters +
        settings.weights.vehicles,
    };
  }

  private midnightMs(planDate: string): number {
    return Date.parse(`${planDate}T00:00:00Z`);
  }

  // ---------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------

  private async settingsFor(tenantId: string): Promise<RoutingSettings> {
    const tenant = await this.tenants.getById(tenantId);
    return routingSettingsFrom(tenant.settings);
  }

  private parsePlanDate(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new UnprocessableEntityException({
        message: `planDate must be a calendar date like 2026-10-12, got "${value}".`,
        code: 'ROUTING_PLAN_DATE_INVALID',
      });
    }
    return value;
  }

  /** Drivers list and read only their own routes. */
  private async scopeToOwnDriver<T extends { driverId?: string }>(
    actor: RoutingActor,
    tenantId: string,
    filters: T,
  ): Promise<T> {
    if (actor.role !== 'driver') {
      return filters;
    }
    const driver = await this.drivers.getOwnDriver(tenantId, actor.userId);
    return { ...filters, driverId: driver.id };
  }

  private async isVisibleTo(
    actor: RoutingActor,
    tenantId: string,
    route: Route,
  ): Promise<boolean> {
    if (actor.role !== 'driver') {
      return true;
    }
    const driver = await this.drivers.getOwnDriver(tenantId, actor.userId);
    return route.driverId === driver.id;
  }

  private ensureVersion(found: RouteWithStops, expectedVersion: number): void {
    if (expectedVersion !== found.version) {
      throw new PreconditionFailedException({
        message: `Route ${found.route.id} is at version ${found.version}, not ${expectedVersion}. Reload and retry.`,
        code: 'VERSION_MISMATCH',
      });
    }
  }

  /**
   * Drains the aggregate's domain events into the event bus as envelopes.
   * Runs inside the tenant transaction, so listeners share the RLS
   * context; delivery is best-effort, matching the dispatch publisher.
   */
  private async publishRouteEvents(route: Route): Promise<void> {
    const events = route.pullDomainEvents();
    if (events.length === 0) {
      return;
    }
    await this.events.publishAll(
      events.map((event) =>
        createEnvelope({
          type: event.type,
          tenantId: route.tenantId,
          aggregateType: 'route',
          aggregateId: route.id,
          occurredAt: event.occurredAt,
          payload: event.payload,
        }),
      ),
    );
    this.logger.debug(
      { routeId: route.id, events: events.map((event) => event.type) },
      'routing domain events published',
    );
  }
}

function routePlanNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Route plan ${id} was not found in this tenant.`,
    code: 'ROUTING_PLAN_NOT_FOUND',
  });
}

function routeNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Route ${id} was not found in this tenant.`,
    code: 'ROUTE_NOT_FOUND',
  });
}

/** Domain guard failures are lifecycle conflicts, always 409. */
function mapRouteDomainError(error: unknown): unknown {
  if (error instanceof RouteDomainError) {
    return new ConflictException({ message: error.message, code: error.code });
  }
  return error;
}
