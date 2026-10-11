/**
 * Routing benchmark: the four strategies on deterministic synthetic
 * instances, printed as a table.
 *
 *   pnpm bench:routing
 *
 * The instances are generated in-process from fixed seeds — no downloads,
 * no network, byte-identical on every machine — in the spirit of the public
 * benchmark families they imitate:
 *
 * - C101-like: 100 customers in 10 tight geographic clusters (clustered VRP;
 *   construction heuristics shine);
 * - R101-like: 100 customers uniform-random with tight windows (random VRP;
 *   capacity and windows bind);
 * - RC101-like: 50 clustered + 50 random (mixed);
 * - CVRP-200: 200 customers, no windows, capacity only (scales construction
 *   and local search).
 *
 * Coordinates are city-scale (about a 12 km box around a Lagos-centred
 * depot), distances are Haversine with a 1.3 circuity factor, and speed is
 * 30 km/h — the same phase-1 model the API uses. The table reports solve
 * time, routes, unassigned stops, tour kilometres, and the weighted
 * objective (tenant-default weights).
 */
import {
  DEFAULT_ROUTING_WEIGHTS,
  HaversineMatrixProvider,
  createProblem,
  createRng,
  getStrategy,
  type Rng,
  type RoutingProblem,
  type RoutingStop,
  type RoutingStrategyName,
} from '../src/modules/routing/optimization/index.js';

const DEPOT = { latitude: 6.5244, longitude: 3.3792 };
const OPENS = 8 * 3_600;
const CLOSES = 18 * 3_600;
const SERVICE_SECONDS = 300;
const CAPACITY_KG = 200;
const VEHICLES = 10;
const STRATEGIES: readonly RoutingStrategyName[] = [
  'nearest_neighbor',
  'savings',
  'savings_local_search',
  'annealing',
];

interface InstanceSpec {
  readonly name: string;
  readonly stops: readonly RoutingStop[];
}

interface Row {
  readonly instance: string;
  readonly strategy: string;
  readonly ms: number;
  readonly routes: number;
  readonly unassigned: number;
  readonly km: number;
  readonly objective: number;
}

function demand(rng: Rng): number {
  return 1 + Math.floor(rng.next() * 19); // 1..19 kg
}

function window(
  rng: Rng,
  loose: boolean,
): { earliestSeconds: number; latestSeconds: number } {
  const opens = 8 * 3_600;
  const span = 10 * 3_600;
  const start = opens + Math.floor(rng.next() * span);
  const width = loose ? 5_400 : 1_800; // 90 min or 30 min
  return { earliestSeconds: start, latestSeconds: start + width };
}

function clusteredInstance(): InstanceSpec {
  const rng = createRng(101); // C101-like seed
  const clusters = Array.from({ length: 10 }, () => ({
    latitude: DEPOT.latitude + (rng.next() - 0.5) * 0.08,
    longitude: DEPOT.longitude + (rng.next() - 0.5) * 0.08,
  }));
  const stops = Array.from({ length: 100 }, (_unused, index) => {
    const cluster = clusters[index % clusters.length];
    const { earliestSeconds, latestSeconds } = window(rng, false);
    return {
      id: `c${index}`,
      location: {
        latitude: cluster.latitude + (rng.next() - 0.5) * 0.006,
        longitude: cluster.longitude + (rng.next() - 0.5) * 0.006,
      },
      weightKg: demand(rng),
      volumeM3: 0,
      earliestSeconds,
      latestSeconds,
      serviceSeconds: SERVICE_SECONDS,
    };
  });
  return { name: 'C101-like', stops };
}

function randomInstance(): InstanceSpec {
  const rng = createRng(111); // R101-like seed
  const stops = Array.from({ length: 100 }, (_unused, index) => {
    const { earliestSeconds, latestSeconds } = window(rng, true);
    return {
      id: `r${index}`,
      location: {
        latitude: DEPOT.latitude + (rng.next() - 0.5) * 0.11,
        longitude: DEPOT.longitude + (rng.next() - 0.5) * 0.11,
      },
      weightKg: demand(rng),
      volumeM3: 0,
      earliestSeconds,
      latestSeconds,
      serviceSeconds: SERVICE_SECONDS,
    };
  });
  return { name: 'R101-like', stops };
}

function mixedInstance(): InstanceSpec {
  const rng = createRng(116); // RC101-like seed
  const clusters = Array.from({ length: 5 }, () => ({
    latitude: DEPOT.latitude + (rng.next() - 0.5) * 0.09,
    longitude: DEPOT.longitude + (rng.next() - 0.5) * 0.09,
  }));
  const stops = Array.from({ length: 100 }, (_unused, index) => {
    const clustered = index % 2 === 0;
    const base = clustered
      ? clusters[Math.floor(index / 2) % clusters.length]
      : DEPOT;
    const spread = clustered ? 0.008 : 0.11;
    const { earliestSeconds, latestSeconds } = window(rng, clustered);
    return {
      id: `m${index}`,
      location: {
        latitude: base.latitude + (rng.next() - 0.5) * spread,
        longitude: base.longitude + (rng.next() - 0.5) * spread,
      },
      weightKg: demand(rng),
      volumeM3: 0,
      earliestSeconds,
      latestSeconds,
      serviceSeconds: SERVICE_SECONDS,
    };
  });
  return { name: 'RC101-like', stops };
}

function cvrpInstance(): InstanceSpec {
  const rng = createRng(200); // CVRP-style seed, no windows
  const stops = Array.from({ length: 200 }, (_unused, index) => ({
    id: `v${index}`,
    location: {
      latitude: DEPOT.latitude + (rng.next() - 0.5) * 0.2,
      longitude: DEPOT.longitude + (rng.next() - 0.5) * 0.2,
    },
    weightKg: demand(rng),
    volumeM3: 0,
    earliestSeconds: 0,
    latestSeconds: Number.POSITIVE_INFINITY,
    serviceSeconds: SERVICE_SECONDS,
  }));
  return { name: 'CVRP-200', stops };
}

function buildProblem(spec: InstanceSpec): RoutingProblem {
  const matrix = new HaversineMatrixProvider({
    circuityFactor: 1.3,
    averageSpeedKmh: 30,
  }).build([DEPOT, ...spec.stops.map((stop) => stop.location)]);
  return createProblem({
    depot: DEPOT,
    depotOpensSeconds: OPENS,
    depotClosesSeconds: CLOSES,
    vehicles: Array.from({ length: VEHICLES }, (_unused, index) => ({
      id: `veh-${index + 1}`,
      capacityWeightKg: CAPACITY_KG,
      capacityVolumeM3: Number.POSITIVE_INFINITY,
      shiftStartSeconds: OPENS,
      shiftEndSeconds: CLOSES,
    })),
    stops: spec.stops,
    matrix,
  });
}

function benchmark(): Row[] {
  const instances = [
    clusteredInstance(),
    randomInstance(),
    mixedInstance(),
    cvrpInstance(),
  ];
  const rows: Row[] = [];
  for (const spec of instances) {
    const problem = buildProblem(spec);
    for (const name of STRATEGIES) {
      const started = performance.now();
      const solution = getStrategy(name).solve(problem, {
        timeBudgetMs: 2_000,
        seed: createRng(7).int(0, 2 ** 31 - 1),
        weights: DEFAULT_ROUTING_WEIGHTS,
        maxIterations: 4_000,
      });
      const ms = performance.now() - started;
      rows.push({
        instance: spec.name,
        strategy: name,
        ms,
        routes: solution.routes.length,
        unassigned: solution.unassigned.length,
        km: solution.totalDistanceMeters / 1_000,
        objective: solution.objectiveValue,
      });
    }
  }
  return rows;
}

function render(rows: readonly Row[]): void {
  const header = [
    'instance'.padEnd(10),
    'strategy'.padEnd(22),
    'ms'.padStart(9),
    'routes'.padStart(7),
    'unass.'.padStart(7),
    'km'.padStart(9),
    'objective'.padStart(12),
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of rows) {
    console.log(
      [
        row.instance.padEnd(10),
        row.strategy.padEnd(22),
        row.ms.toFixed(1).padStart(9),
        String(row.routes).padStart(7),
        String(row.unassigned).padStart(7),
        row.km.toFixed(1).padStart(9),
        Math.round(row.objective).toLocaleString('en-US').padStart(12),
      ].join('  '),
    );
  }
}

render(benchmark());
