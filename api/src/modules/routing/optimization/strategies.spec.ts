import {
  DEFAULT_ROUTING_WEIGHTS,
  ROUTING_STRATEGIES,
  createRng,
  evaluateRoute,
  getStrategy,
  parseSeed,
  type RoutingProblem,
  type RoutingSolution,
  type RoutingStrategyName,
  type SolveOptions,
} from './index.js';
import { gridProblem } from './testing/grid-problem.fixture.js';

const OPTIONS: SolveOptions = {
  timeBudgetMs: 5_000,
  seed: parseSeed('test-seed'),
  weights: DEFAULT_ROUTING_WEIGHTS,
  maxIterations: 2_000,
};

/** Three clusters around the depot, mixed demands, some tight windows. */
function generatedProblem(): RoutingProblem {
  const rng = createRng(2026_1011);
  const clusters = [
    { x: 20, y: 5 },
    { x: -18, y: 12 },
    { x: 3, y: -22 },
  ];
  const stops = Array.from({ length: 27 }, (_unused, index) => {
    const cluster = clusters[index % clusters.length];
    const withWindow = index % 5 === 0;
    return {
      id: `s${index}`,
      x: cluster.x + rng.next() * 6 - 3,
      y: cluster.y + rng.next() * 6 - 3,
      weight: 1 + rng.next() * 4,
      volume: 0.5 + rng.next(),
      // Every fifth stop demands service inside a reachable band.
      earliest: withWindow ? 40 + rng.next() * 20 : undefined,
      latest: withWindow ? 70 + rng.next() * 40 : undefined,
    };
  });
  return gridProblem({
    stops,
    vehicles: [
      { id: 'v1', weight: 40, shiftEnd: 600 },
      { id: 'v2', weight: 40, shiftEnd: 600 },
      { id: 'v3', weight: 40, shiftEnd: 600 },
    ],
  });
}

/** Every stop is planned exactly once — or listed unassigned, never both. */
function expectFullPartition(
  problem: RoutingProblem,
  solution: RoutingSolution,
): void {
  const planned = solution.routes.flatMap((route) =>
    route.stops.map((stop) => stop.stopId),
  );
  const ids = [...planned, ...solution.unassigned.map((u) => u.stopId)].sort();
  expect(ids).toEqual(problem.stops.map((stop) => stop.id).sort());
  expect(new Set(ids).size).toBe(ids.length);
}

describe.each(ROUTING_STRATEGIES)('strategy %s', (name: RoutingStrategyName) => {
  const solve = (problem: RoutingProblem): RoutingSolution =>
    getStrategy(name).solve(problem, OPTIONS);

  it('partitions every stop between routes and unassigned', () => {
    const problem = generatedProblem();
    expectFullPartition(problem, solve(problem));
  });

  it('only produces feasible routes', () => {
    const problem = generatedProblem();
    const solution = solve(problem);
    expect(solution.routes.length).toBeGreaterThan(0);
    for (const route of solution.routes) {
      const vehicle = problem.vehicles.find((v) => v.id === route.vehicleId);
      if (!vehicle) {
        throw new Error(`Route ${route.vehicleId} has no vehicle.`);
      }
      const indexes = route.stops.map(
        (stop) => problem.stops.findIndex((s) => s.id === stop.stopId),
      );
      expect(evaluateRoute(problem, vehicle, indexes).feasible).toBe(true);
    }
  });

  it('is deterministic: same problem, same solution', () => {
    const problem = generatedProblem();
    expect(solve(problem)).toEqual(solve(problem));
  });

  it('leaves an empty problem with no routes and no unassigned', () => {
    const empty = gridProblem({ stops: [], vehicles: [{ id: 'v1' }] });
    const solution = solve(empty);
    expect(solution.routes).toEqual([]);
    expect(solution.unassigned).toEqual([]);
    expect(solution.totalDistanceMeters).toBe(0);
  });

  it('reports an unplaceable fleet as unassigned, not as an error', () => {
    const problem = gridProblem({
      stops: [{ id: 's1', x: 1, y: 0 }],
      vehicles: [],
    });
    const solution = solve(problem);
    expect(solution.routes).toEqual([]);
    expect(solution.unassigned).toEqual([
      { stopId: 's1', reason: 'no_feasible_vehicle' },
    ]);
  });
});

describe('savings construction', () => {
  it('beats nearest neighbor on a crossing instance', () => {
    // Depot, then two wings: nearest neighbor zig-zags across the centre;
    // savings keeps each wing on its own side.
    const problem = gridProblem({
      depot: { x: 0, y: 0 },
      vehicles: [{ id: 'v1' }],
      stops: [
        { id: 'p1', x: 10, y: 0 },
        { id: 'p2', x: 9, y: 1 },
        { id: 'p3', x: 0, y: 10 },
        { id: 'p4', x: 1, y: 9 },
      ],
    });
    const nearest = getStrategy('nearest_neighbor').solve(problem, OPTIONS);
    const savings = getStrategy('savings').solve(problem, OPTIONS);
    expect(savings.totalDistanceMeters).toBeLessThan(
      nearest.totalDistanceMeters,
    );
    expect(savings.unassigned).toEqual([]);
  });

  it('serves only what one tour per vehicle can carry', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1', weight: 10 }],
      stops: [
        { id: 'a', x: 1, y: 0, weight: 6 },
        { id: 'b', x: -1, y: 0, weight: 6 },
      ],
    });
    const solution = getStrategy('savings').solve(problem, OPTIONS);
    expect(solution.routes).toHaveLength(1);
    expect(solution.routes[0].stops.map((s) => s.stopId)).toEqual(['a']);
    expect(solution.unassigned).toEqual([
      { stopId: 'b', reason: 'no_feasible_vehicle' },
    ]);
  });

  it('spreads unmergeable tours across the free fleet', () => {
    const problem = gridProblem({
      vehicles: [
        { id: 'v1', weight: 10 },
        { id: 'v2', weight: 10 },
      ],
      stops: [
        { id: 'a', x: 1, y: 0, weight: 6 },
        { id: 'b', x: -1, y: 0, weight: 6 },
      ],
    });
    const solution = getStrategy('savings').solve(problem, OPTIONS);
    expect(solution.unassigned).toEqual([]);
    expect(solution.routes).toHaveLength(2);
    expect(solution.routes.map((r) => r.vehicleId).sort()).toEqual([
      'v1',
      'v2',
    ]);
    expect(solution.usedVehicles).toBe(2);
  });

  it('unassigns a stop no vehicle could ever carry', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1', weight: 10 }],
      stops: [
        { id: 'ok', x: 1, y: 0, weight: 5 },
        { id: 'huge', x: 2, y: 0, weight: 50 },
      ],
    });
    const solution = getStrategy('savings').solve(problem, OPTIONS);
    expect(solution.unassigned).toEqual([
      { stopId: 'huge', reason: 'capacity_exceeded' },
    ]);
    expect(solution.routes).toHaveLength(1);
    expect(solution.routes[0].stops.map((s) => s.stopId)).toEqual(['ok']);
  });
});

describe('improvement and annealing', () => {
  it('local search never returns a longer tour than its start', () => {
    const problem = generatedProblem();
    const nearest = getStrategy('nearest_neighbor').solve(problem, OPTIONS);
    const improved = getStrategy('savings_local_search').solve(
      problem,
      OPTIONS,
    );
    expect(improved.totalDistanceMeters).toBeLessThanOrEqual(
      nearest.totalDistanceMeters,
    );
  });

  it('annealing matches or improves on plain savings', () => {
    const problem = generatedProblem();
    const savings = getStrategy('savings').solve(problem, OPTIONS);
    const annealed = getStrategy('annealing').solve(problem, OPTIONS);
    expect(annealed.objectiveValue).toBeLessThanOrEqual(
      savings.objectiveValue,
    );
  });

  it('replays an identical annealing run from the same seed', () => {
    const problem = generatedProblem();
    const first = getStrategy('annealing').solve(problem, OPTIONS);
    const second = getStrategy('annealing').solve(problem, OPTIONS);
    expect(second).toEqual(first);
  });
});
