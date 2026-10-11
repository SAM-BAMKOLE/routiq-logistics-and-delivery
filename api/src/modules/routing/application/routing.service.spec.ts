import {
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { FakeEventBus } from '../../../shared/messaging/testing/fake-event-bus.js';
import type { DriversService } from '../../drivers/application/drivers.service.js';
import type { TenantsService } from '../../tenants/application/tenants.service.js';
import { Route } from '../domain/route.js';
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
import { RoutingService } from './routing.service.js';

const dispatcher = { userId: 'u-ops', role: 'dispatcher' as const };
const driverActor = { userId: 'u-driver', role: 'driver' as const };
const PLAN_DATE = '2026-10-12';

const DEPOT_SETTINGS = {
  routing: { depot: { latitude: 0, longitude: 0 } },
};

interface StoredRoute {
  route: Route;
  version: number;
  stops: RouteStopRecord[];
}

interface Harness {
  service: RoutingService;
  plans: Map<string, RoutePlanRecord>;
  routes: Map<string, StoredRoute>;
  shipments: PlanShipmentInput[];
  vehicles: PlanVehicleInput[];
  shipmentFields: Map<string, ReplanStopInput>;
  userToDriver: Map<string, string>;
  settings: Record<string, unknown>;
  /** Test hook: makes markPlanPlanned throw, to exercise the failure path. */
  failMarkPlanned?: boolean;
  bus: FakeEventBus;
}

function makeHarness(overrides?: Partial<Harness>): Harness {
  const harness: Harness = {
    service: undefined as unknown as RoutingService,
    plans: new Map(),
    routes: new Map(),
    shipments: [],
    vehicles: [],
    shipmentFields: new Map(),
    userToDriver: new Map([['u-driver', 'd-1']]),
    settings: DEPOT_SETTINGS,
    bus: new FakeEventBus(),
    ...overrides,
  };

  let stopSequence = 0;
  const repository: RoutingRepository = {
    findPlanShipments: async () => harness.shipments,
    findPlanVehicles: async () => harness.vehicles,
    insertPlan: async (props) => {
      const now = new Date();
      harness.plans.set(props.planId, {
        id: props.planId,
        planDate: props.planDate,
        status: 'planning',
        strategy: props.strategy,
        seed: props.seed,
        timeBudgetMs: props.timeBudgetMs,
        requestedBy: props.requestedBy,
        unassigned: null,
        error: null,
        routesCreated: null,
        totalDistanceM: null,
        totalDurationS: null,
        objectiveValue: null,
        createdAt: now,
        updatedAt: now,
      });
    },
    findPlan: async (planId) => harness.plans.get(planId) ?? null,
    markPlanPlanned: async (props) => {
      if (harness.failMarkPlanned) {
        throw new Error('boom');
      }
      const plan = harness.plans.get(props.planId);
      if (plan) {
        harness.plans.set(props.planId, {
          ...plan,
          status: 'planned',
          unassigned: [...props.unassigned],
          routesCreated: props.routesCreated,
          totalDistanceM: props.totalDistanceM,
          totalDurationS: props.totalDurationS,
          objectiveValue: props.objectiveValue,
          updatedAt: new Date(),
        });
      }
    },
    markPlanFailed: async (planId, error) => {
      const plan = harness.plans.get(planId);
      if (plan) {
        harness.plans.set(planId, {
          ...plan,
          status: 'failed',
          error,
          updatedAt: new Date(),
        });
      }
    },
    insertPlannedRoutes: async (
      _tenantId,
      _planId,
      routes: readonly PlannedRouteInsert[],
    ) => {
      for (const planned of routes) {
        harness.routes.set(planned.route.id, {
          route: planned.route,
          version: 1,
          stops: planned.stops.map((stop) => ({
            id: `stop-${(stopSequence += 1)}`,
            shipmentId: stop.shipmentId,
            sequence: stop.sequence,
            kind: 'dropoff',
            plannedArrival: stop.plannedArrival,
            windowStart: stop.windowStart,
            windowEnd: stop.windowEnd,
          })),
        });
      }
    },
    findRoutesByPlan: async (planId) =>
      [...harness.routes.values()]
        .filter((stored) => stored.route.planId === planId)
        .map(toWithStops),
    listRoutes: async (filters: RouteListFilters) =>
      [...harness.routes.values()]
        .filter(
          (stored) =>
            (!filters.planDate || stored.route.planDate === filters.planDate) &&
            (!filters.status || stored.route.status === filters.status) &&
            (!filters.driverId || stored.route.driverId === filters.driverId),
        )
        .slice(0, filters.limit)
        .map(toWithStops),
    findRoute: async (routeId) => {
      const stored = harness.routes.get(routeId);
      return stored ? toWithStops(stored) : null;
    },
    findReplanStops: async (routeId) => {
      const stored = harness.routes.get(routeId);
      if (!stored) {
        return [];
      }
      return stored.stops
        .sort((a, b) => a.sequence - b.sequence)
        .map((stop) => {
          const fields = harness.shipmentFields.get(stop.shipmentId);
          if (!fields) {
            throw new Error(`No shipment fields for ${stop.shipmentId}.`);
          }
          return fields;
        });
    },
    saveRoute: async (route) => {
      const stored = harness.routes.get(route.id);
      if (stored) {
        harness.routes.set(route.id, {
          ...stored,
          route,
          version: stored.version + 1, // the optimistic-lock bump
        });
      }
    },
    replaceStops: async (
      _tenantId,
      routeId,
      stops: readonly NewRouteStop[],
    ) => {
      const stored = harness.routes.get(routeId);
      if (stored) {
        stored.stops = stops.map((stop) => ({
          id: `stop-${(stopSequence += 1)}`,
          shipmentId: stop.shipmentId,
          sequence: stop.sequence,
          kind: 'dropoff',
          plannedArrival: stop.plannedArrival,
          windowStart: null,
          windowEnd: null,
        }));
      }
    },
  };

  const driversService = {
    getOwnDriver: async (_tenantId: string, userId: string) => {
      const driverId = harness.userToDriver.get(userId);
      if (!driverId) {
        throw new NotFoundException({
          message: 'This user has no driver profile in this tenant.',
          code: 'DRIVER_PROFILE_NOT_FOUND',
        });
      }
      return { id: driverId };
    },
  } as unknown as DriversService;

  const tenantsService = {
    getById: async () => ({ settings: harness.settings }),
  } as unknown as TenantsService;

  const transactions = {
    runWithTenant: async (
      _tenantId: string,
      fn: (manager: unknown) => Promise<unknown>,
    ) => fn(undefined),
  };

  harness.service = new RoutingService(
    repository,
    driversService,
    tenantsService,
    transactions as never,
    harness.bus,
  );
  return harness;
}

function toWithStops(stored: StoredRoute): RouteWithStops {
  return { route: stored.route, version: stored.version, stops: stored.stops };
}

/** Lets the floating plan execution settle (all fakes resolve instantly). */
async function flushBackground(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function shipment(id: string, overrides?: Partial<PlanShipmentInput>): PlanShipmentInput {
  return {
    id,
    latitude: 1,
    longitude: 1,
    weightKg: 5,
    volumeM3: 1,
    windowStart: null,
    windowEnd: null,
    ...overrides,
  };
}

function vehicle(id: string, overrides?: Partial<PlanVehicleInput>): PlanVehicleInput {
  return {
    id,
    driverId: null,
    capacityWeightKg: 100,
    capacityVolumeM3: 100,
    shiftStartsAt: null,
    shiftEndsAt: null,
    ...overrides,
  };
}

describe('RoutingService.plan', () => {
  it('refuses to plan without a depot', async () => {
    const harness = makeHarness({ settings: {} });
    await expect(
      harness.service.plan(dispatcher, 't-1', { planDate: PLAN_DATE }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'ROUTING_DEPOT_MISSING' },
    });
  });

  it('rejects a malformed plan date', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.plan(dispatcher, 't-1', { planDate: 'tomorrow' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses an empty plan and a fleet-less plan', async () => {
    const empty = makeHarness();
    await expect(
      empty.service.plan(dispatcher, 't-1', { planDate: PLAN_DATE }),
    ).rejects.toMatchObject({ response: { code: 'ROUTING_PLAN_EMPTY' } });

    const fleetless = makeHarness({
      shipments: [shipment('sh-1')],
    });
    await expect(
      fleetless.service.plan(dispatcher, 't-1', { planDate: PLAN_DATE }),
    ).rejects.toMatchObject({ response: { code: 'ROUTING_NO_VEHICLES' } });
  });

  it('refuses plans over the tenant stop limit', async () => {
    const harness = makeHarness({
      shipments: [shipment('sh-1'), shipment('sh-2')],
      vehicles: [vehicle('veh-1')],
      settings: { routing: { depot: { latitude: 0, longitude: 0 }, maxStops: 1 } },
    });
    await expect(
      harness.service.plan(dispatcher, 't-1', { planDate: PLAN_DATE }),
    ).rejects.toMatchObject({ response: { code: 'ROUTING_PLAN_TOO_LARGE' } });
  });

  it('accepts, records the run, and completes it in the background', async () => {
    const harness = makeHarness({
      shipments: [
        shipment('sh-1', { latitude: 0.01, longitude: 0 }),
        shipment('sh-2', { latitude: 0.02, longitude: 0 }),
        // No coordinates: planned around, reported, never an error.
        shipment('sh-blank', { latitude: null, longitude: null }),
      ],
      vehicles: [vehicle('veh-1', { driverId: 'd-1' })],
    });

    const accepted = await harness.service.plan(dispatcher, 't-1', {
      planDate: PLAN_DATE,
      strategy: 'nearest_neighbor',
      seed: 'replay-1',
    });
    expect(accepted).toMatchObject({
      planDate: PLAN_DATE,
      status: 'planning',
      strategy: 'nearest_neighbor',
      seed: 'replay-1',
    });
    expect(harness.plans.get(accepted.id)?.status).toBe('planning');

    await flushBackground();

    const plan = harness.plans.get(accepted.id);
    expect(plan?.status).toBe('planned');
    expect(plan?.routesCreated).toBe(1);
    expect(plan?.unassigned).toEqual([
      { stopId: 'sh-blank', reason: 'no_coordinates' },
    ]);
    const [stored] = [...harness.routes.values()];
    expect(stored.route.driverId).toBe('d-1');
    expect(stored.route.algorithm).toBe('nearest_neighbor');
    expect(stored.stops.map((stop) => stop.shipmentId).sort()).toEqual([
      'sh-1',
      'sh-2',
    ]);
    expect(harness.bus.published.map((envelope) => envelope.type)).toContain(
      'RoutePlanned',
    );
  });

  it('generates a numeric seed when none is given', async () => {
    const harness = makeHarness({
      shipments: [shipment('sh-1')],
      vehicles: [vehicle('veh-1')],
    });
    const accepted = await harness.service.plan(dispatcher, 't-1', {
      planDate: PLAN_DATE,
    });
    expect(accepted.seed).toMatch(/^\d+$/);
  });

  it('marks the plan failed when persistence blows up mid-run', async () => {
    const harness = makeHarness({
      shipments: [shipment('sh-1')],
      vehicles: [vehicle('veh-1')],
    });
    harness.failMarkPlanned = true;
    const accepted = await harness.service.plan(dispatcher, 't-1', {
      planDate: PLAN_DATE,
    });
    await flushBackground();
    const plan = harness.plans.get(accepted.id);
    expect(plan?.status).toBe('failed');
    expect(plan?.error).toContain('boom');
  });
});

describe('RoutingService reads', () => {
  it('answers 404 for an unknown plan and an unknown route', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.getPlan(dispatcher, 't-1', 'nope'),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'ROUTING_PLAN_NOT_FOUND' },
    });
    await expect(
      harness.service.getRoute(dispatcher, 't-1', 'nope'),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'ROUTE_NOT_FOUND' },
    });
  });

  it('scopes a driver’s list and reads to their own routes', async () => {
    const harness = makeHarness();
    harness.routes.set('r-mine', {
      route: Route.rehydrate(routeProps({ id: 'r-mine', driverId: 'd-1' })),
      version: 1,
      stops: [],
    });
    harness.routes.set('r-other', {
      route: Route.rehydrate(routeProps({ id: 'r-other', driverId: 'd-2' })),
      version: 1,
      stops: [],
    });

    const listed = await harness.service.listRoutes(driverActor, 't-1', {});
    expect(listed.map((found) => found.route.id)).toEqual(['r-mine']);

    await expect(
      harness.service.getRoute(driverActor, 't-1', 'r-other'),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'ROUTE_NOT_FOUND' },
    });
    const mine = await harness.service.getRoute(driverActor, 't-1', 'r-mine');
    expect(mine.route.id).toBe('r-mine');
  });

  it('lets dispatchers see every route and filter by date', async () => {
    const harness = makeHarness();
    harness.routes.set('r-1', {
      route: Route.rehydrate(
        routeProps({ id: 'r-1', planDate: PLAN_DATE, driverId: 'd-1' }),
      ),
      version: 1,
      stops: [],
    });
    const listed = await harness.service.listRoutes(dispatcher, 't-1', {
      planDate: PLAN_DATE,
    });
    expect(listed).toHaveLength(1);
    const none = await harness.service.listRoutes(dispatcher, 't-1', {
      planDate: '2026-01-01',
    });
    expect(none).toHaveLength(0);
  });
});

describe('RoutingService.start', () => {
  function harnessWithRoute(status: 'planned' | 'active' | 'completed'): Harness {
    const harness = makeHarness();
    harness.routes.set('r-1', {
      route: Route.rehydrate(
        routeProps({ id: 'r-1', status, driverId: 'd-1' }),
      ),
      version: 3,
      stops: [],
    });
    return harness;
  }

  it('requires the caller’s last-seen version', async () => {
    const harness = harnessWithRoute('planned');
    await expect(
      harness.service.start(dispatcher, 't-1', 'r-1', 2),
    ).rejects.toBeInstanceOf(PreconditionFailedException);
    try {
      await harness.service.start(dispatcher, 't-1', 'r-1', 2);
      throw new Error('expected a version mismatch');
    } catch (error) {
      expect((error as { response?: { code?: string } }).response?.code).toBe(
        'VERSION_MISMATCH',
      );
    }
  });

  it('refuses to start a non-planned route', async () => {
    const harness = harnessWithRoute('active');
    await expect(
      harness.service.start(dispatcher, 't-1', 'r-1', 3),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROUTE_NOT_STARTABLE' },
    });
  });

  it('starts a planned route and bumps the version', async () => {
    const harness = harnessWithRoute('planned');
    const started = await harness.service.start(dispatcher, 't-1', 'r-1', 3);
    expect(started.route.status).toBe('active');
    expect(started.version).toBe(4);
  });
});

describe('RoutingService.replan', () => {
  it('re-solves remaining stops, drops unplaceable ones, publishes RouteReplanned', async () => {
    const harness = makeHarness();
    harness.routes.set('r-1', {
      route: Route.rehydrate(
        routeProps({ id: 'r-1', status: 'active', vehicleId: 'veh-1' }),
      ),
      version: 1,
      stops: [
        stopRecord('stop-1', 'sh-1', 1),
        stopRecord('stop-2', 'sh-blank', 2),
      ],
    });
    harness.shipmentFields.set('sh-1', {
      shipmentId: 'sh-1',
      weightKg: 5,
      volumeM3: 1,
      latitude: 0.01,
      longitude: 0,
      windowStart: null,
      windowEnd: null,
    });
    harness.shipmentFields.set('sh-blank', {
      shipmentId: 'sh-blank',
      weightKg: 5,
      volumeM3: 1,
      latitude: null,
      longitude: null,
      windowStart: null,
      windowEnd: null,
    });
    harness.vehicles = [vehicle('veh-1', { driverId: 'd-1' })];

    const result = await harness.service.replan(dispatcher, 't-1', 'r-1', 1);
    expect(result.route.version).toBe(2);
    expect(result.route.route.status).toBe('active');
    expect(result.route.stops.map((stop) => stop.shipmentId)).toEqual(['sh-1']);
    expect(result.unassigned).toEqual([
      { shipmentId: 'sh-blank', reason: 'no_coordinates' },
    ]);
    expect(harness.bus.published.map((envelope) => envelope.type)).toContain(
      'RouteReplanned',
    );
  });

  it('refuses a closed route and an unknown vehicle', async () => {
    const closed = makeHarness();
    closed.routes.set('r-1', {
      route: Route.rehydrate(
        routeProps({ id: 'r-1', status: 'completed', vehicleId: 'veh-1' }),
      ),
      version: 1,
      stops: [],
    });
    await expect(
      closed.service.replan(dispatcher, 't-1', 'r-1', 1),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROUTE_NOT_REPLANABLE' },
    });

    const vehicleless = makeHarness();
    vehicleless.routes.set('r-1', {
      route: Route.rehydrate(
        routeProps({ id: 'r-1', status: 'planned', vehicleId: null }),
      ),
      version: 1,
      stops: [],
    });
    await expect(
      vehicleless.service.replan(dispatcher, 't-1', 'r-1', 1),
    ).rejects.toMatchObject({
      response: { code: 'ROUTING_REPLAN_NO_VEHICLE' },
    });
  });

  it('honours If-Match', async () => {
    const harness = makeHarness();
    harness.routes.set('r-1', {
      route: Route.rehydrate(
        routeProps({ id: 'r-1', status: 'planned', vehicleId: 'veh-1' }),
      ),
      version: 5,
      stops: [],
    });
    await expect(
      harness.service.replan(dispatcher, 't-1', 'r-1', 4),
    ).rejects.toMatchObject({ response: { code: 'VERSION_MISMATCH' } });
  });
});

function routeProps(overrides?: {
  id?: string;
  status?: 'planned' | 'active' | 'completed' | 'cancelled';
  driverId?: string | null;
  vehicleId?: string | null;
  planDate?: string;
}): Parameters<typeof Route.rehydrate>[0] {
  return {
    id: overrides?.id ?? 'r-1',
    tenantId: 't-1',
    planId: null,
    planDate: overrides?.planDate ?? PLAN_DATE,
    vehicleId: overrides?.vehicleId ?? 'veh-1',
    driverId: overrides?.driverId ?? 'd-1',
    algorithm: 'annealing',
    status: overrides?.status ?? 'planned',
    metrics: {
      totalDistanceMeters: 1_000,
      totalDurationSeconds: 600,
      objectiveValue: 51_000,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function stopRecord(
  id: string,
  shipmentId: string,
  sequence: number,
): RouteStopRecord {
  return {
    id,
    shipmentId,
    sequence,
    kind: 'dropoff',
    plannedArrival: null,
    windowStart: null,
    windowEnd: null,
  };
}
