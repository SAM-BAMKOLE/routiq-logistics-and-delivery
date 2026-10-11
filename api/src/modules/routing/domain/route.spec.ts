import {
  Route,
  RouteDomainError,
  isOpenRouteStatus,
  isRouteStatus,
} from './route.js';

function planRoute(): Route {
  return Route.plan({
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: 'tenant-1',
    planId: '22222222-2222-2222-2222-222222222222',
    planDate: '2026-10-12',
    vehicleId: 'vehicle-1',
    driverId: 'driver-1',
    algorithm: 'annealing',
    stopCount: 3,
    metrics: {
      totalDistanceMeters: 12_345,
      totalDurationSeconds: 5_400,
      objectiveValue: 62_345,
    },
  });
}

describe('Route aggregate', () => {
  it('is born planned and raises RoutePlanned with the headline numbers', () => {
    const route = planRoute();
    expect(route.status).toBe('planned');
    const events = route.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('RoutePlanned');
    expect(events[0].payload).toMatchObject({
      routeId: route.id,
      planId: route.planId,
      planDate: '2026-10-12',
      driverId: 'driver-1',
      vehicleId: 'vehicle-1',
      stopCount: 3,
      totalDistanceM: 12_345,
      totalDurationS: 5_400,
      algorithm: 'annealing',
      objectiveValue: 62_345,
    });
    expect(route.pullDomainEvents()).toEqual([]); // drained
  });

  it('starts exactly once and raises no event for it', () => {
    const route = planRoute();
    route.pullDomainEvents();
    route.start();
    expect(route.status).toBe('active');
    expect(route.pullDomainEvents()).toEqual([]);
    expect(() => route.start()).toThrow(RouteDomainError);
    try {
      route.start();
    } catch (error) {
      expect((error as RouteDomainError).code).toBe('ROUTE_NOT_STARTABLE');
    }
  });

  it('replans planned and active routes, raising RouteReplanned', () => {
    const route = planRoute();
    route.applyReplan({
      stopCount: 2,
      unassignedCount: 1,
      metrics: {
        totalDistanceMeters: 9_000,
        totalDurationSeconds: 3_600,
        objectiveValue: 49_000,
      },
    });
    expect(route.status).toBe('planned'); // replan keeps the status
    expect(route.metrics.totalDistanceMeters).toBe(9_000);
    const [event] = route.pullDomainEvents().slice(-1);
    expect(event.type).toBe('RouteReplanned');
    expect(event.payload).toMatchObject({
      routeId: route.id,
      stopCount: 2,
      unassignedCount: 1,
      totalDistanceM: 9_000,
    });

    route.start();
    expect(() =>
      route.applyReplan({
        stopCount: 1,
        unassignedCount: 0,
        metrics: {
          totalDistanceMeters: 1,
          totalDurationSeconds: 1,
          objectiveValue: 1,
        },
      }),
    ).not.toThrow(); // active routes replan too (delayed drivers)
  });

  it('refuses to replan a closed route', () => {
    const route = Route.rehydrate({
      id: 'route-closed',
      tenantId: 'tenant-1',
      planId: null,
      planDate: '2026-10-12',
      vehicleId: null,
      driverId: null,
      algorithm: 'savings',
      status: 'completed',
      metrics: {
        totalDistanceMeters: 1,
        totalDurationSeconds: 1,
        objectiveValue: 1,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      route.applyReplan({
        stopCount: 1,
        unassignedCount: 0,
        metrics: {
          totalDistanceMeters: 1,
          totalDurationSeconds: 1,
          objectiveValue: 1,
        },
      });
      throw new Error('expected applyReplan to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RouteDomainError);
      expect((error as RouteDomainError).code).toBe('ROUTE_NOT_REPLANABLE');
    }
  });
});

describe('route status guards', () => {
  it('recognises known statuses only', () => {
    expect(isRouteStatus('planned')).toBe(true);
    expect(isRouteStatus('active')).toBe(true);
    expect(isRouteStatus('in_orbit')).toBe(false);
    expect(isRouteStatus(7)).toBe(false);
  });

  it('treats planned and active as open, completed and cancelled as closed', () => {
    expect(isOpenRouteStatus('planned')).toBe(true);
    expect(isOpenRouteStatus('active')).toBe(true);
    expect(isOpenRouteStatus('completed')).toBe(false);
    expect(isOpenRouteStatus('cancelled')).toBe(false);
  });
});
