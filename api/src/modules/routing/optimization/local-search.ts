import {
  evaluateRoute,
  type RouteEvaluation,
} from './feasibility.js';
import type { RoutingProblem, RoutingVehicle } from './problem.js';
import type { RouteDraft } from './assemble.js';

/**
 * Local search over a set of routes (architecture step 4): intra-route
 * 2-opt and Or-opt (segments of one to three stops, both orientations), and
 * inter-route relocate, swap, and 2-opt* (exchanging route tails). Best
 * improvement: each pass enumerates every candidate move, re-evaluating only
 * the affected routes, applies the single best distance decrease that stays
 * feasible, and repeats until nothing improves or the move budget runs out.
 */
export interface ImproveOptions {
  /** Cap on candidate moves examined (the deterministic stopping rule). */
  readonly maxIterations: number;
  /** Optional absolute deadline in epoch ms (safety net, not a stop rule). */
  readonly deadlineMs?: number;
}

interface WorkingRoute {
  vehicleId: string;
  stops: number[];
}

interface BestMove {
  stopsA: number[];
  stopsB: number[] | null;
  slotA: number;
  slotB: number | null;
  evaluationA: RouteEvaluation;
  evaluationB: RouteEvaluation | null;
}

const EPSILON = 1e-9;
const MAX_OR_OPT_SEGMENT = 3;

export function improve(
  problem: RoutingProblem,
  drafts: readonly RouteDraft[],
  options: ImproveOptions,
): RouteDraft[] {
  const routes: WorkingRoute[] = drafts
    .filter((draft) => draft.stopIndexes.length > 0)
    .map((draft) => ({
      vehicleId: draft.vehicleId,
      stops: [...draft.stopIndexes],
    }));
  const evaluations = routes.map((route) =>
    evaluateRoute(problem, vehicleOf(problem, route.vehicleId), route.stops),
  );

  let iterations = 0;
  const deadline = options.deadlineMs ?? Number.POSITIVE_INFINITY;

  for (;;) {
    if (iterations >= options.maxIterations || Date.now() >= deadline) {
      break;
    }
    let best: BestMove | null = null;
    let bestDelta = -EPSILON;

    const consider = (
      stopsA: number[],
      stopsB: number[] | null,
      slotA: number,
      slotB: number | null,
    ): void => {
      iterations += 1;
      const evaluationA = evaluateRoute(
        problem,
        vehicleOf(problem, routes[slotA].vehicleId),
        stopsA,
      );
      if (!evaluationA.feasible) {
        return;
      }
      let delta = evaluationA.distanceMeters - evaluations[slotA].distanceMeters;
      let evaluationB: RouteEvaluation | null = null;
      if (slotB !== null && stopsB !== null) {
        evaluationB = evaluateRoute(
          problem,
          vehicleOf(problem, routes[slotB].vehicleId),
          stopsB,
        );
        if (!evaluationB.feasible) {
          return;
        }
        delta += evaluationB.distanceMeters - evaluations[slotB].distanceMeters;
      }
      if (delta < bestDelta) {
        bestDelta = delta;
        best = { stopsA, stopsB, slotA, slotB, evaluationA, evaluationB };
      }
    };

    for (let a = 0; a < routes.length; a += 1) {
      enumerateIntraMoves(routes[a], (stopsA) => consider(stopsA, null, a, null));
      for (let b = a + 1; b < routes.length; b += 1) {
        enumerateInterMoves(
          routes[a],
          routes[b],
          (stopsA, stopsB) => consider(stopsA, stopsB, a, b),
        );
      }
      if (iterations >= options.maxIterations || Date.now() >= deadline) {
        break;
      }
    }

    if (!best) {
      break;
    }
    const move: BestMove = best;
    routes[move.slotA].stops = move.stopsA;
    evaluations[move.slotA] = move.evaluationA;
    if (move.slotB !== null && move.stopsB !== null && move.evaluationB) {
      routes[move.slotB].stops = move.stopsB;
      evaluations[move.slotB] = move.evaluationB;
    }
  }

  return routes
    .filter((route) => route.stops.length > 0)
    .map((route) => ({
      vehicleId: route.vehicleId,
      stopIndexes: route.stops,
    }));
}

function enumerateIntraMoves(
  route: WorkingRoute,
  emit: (stops: number[]) => void,
): void {
  const { stops } = route;
  // 2-opt: reverse every segment.
  for (let start = 0; start < stops.length - 1; start += 1) {
    for (let end = start + 1; end < stops.length; end += 1) {
      emit([
        ...stops.slice(0, start),
        ...stops.slice(start, end + 1).reverse(),
        ...stops.slice(end + 1),
      ]);
    }
  }
  // Or-opt: move segments of one to three stops elsewhere, both ways.
  for (let length = 1; length <= MAX_OR_OPT_SEGMENT; length += 1) {
    for (let from = 0; from + length <= stops.length; from += 1) {
      const segment = stops.slice(from, from + length);
      const rest = [...stops.slice(0, from), ...stops.slice(from + length)];
      for (const candidate of [segment, [...segment].reverse()]) {
        for (let to = 0; to <= rest.length; to += 1) {
          if (to === from) {
            continue; // same position, same order
          }
          emit([...rest.slice(0, to), ...candidate, ...rest.slice(to)]);
        }
      }
    }
  }
}

function enumerateInterMoves(
  a: WorkingRoute,
  b: WorkingRoute,
  emit: (stopsA: number[], stopsB: number[]) => void,
): void {
  // Relocate: one stop from a into b, and the other way round.
  for (let from = 0; from < a.stops.length; from += 1) {
    const rest = [...a.stops.slice(0, from), ...a.stops.slice(from + 1)];
    for (let to = 0; to <= b.stops.length; to += 1) {
      emit(rest, [...b.stops.slice(0, to), a.stops[from], ...b.stops.slice(to)]);
    }
  }
  for (let from = 0; from < b.stops.length; from += 1) {
    const rest = [...b.stops.slice(0, from), ...b.stops.slice(from + 1)];
    for (let to = 0; to <= a.stops.length; to += 1) {
      emit([...a.stops.slice(0, to), b.stops[from], ...a.stops.slice(to)], rest);
    }
  }
  // Swap: exchange one stop of each route.
  for (let pa = 0; pa < a.stops.length; pa += 1) {
    for (let pb = 0; pb < b.stops.length; pb += 1) {
      const stopsA = [...a.stops];
      const stopsB = [...b.stops];
      [stopsA[pa], stopsB[pb]] = [b.stops[pb], a.stops[pa]];
      emit(stopsA, stopsB);
    }
  }
  // 2-opt*: exchange route tails after the given positions.
  for (let pa = 0; pa < a.stops.length; pa += 1) {
    for (let pb = 0; pb < b.stops.length; pb += 1) {
      emit(
        [...a.stops.slice(0, pa + 1), ...b.stops.slice(pb + 1)],
        [...b.stops.slice(0, pb + 1), ...a.stops.slice(pa + 1)],
      );
    }
  }
}

function vehicleOf(problem: RoutingProblem, vehicleId: string): RoutingVehicle {
  const vehicle = problem.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) {
    throw new Error(`Route references unknown vehicle ${vehicleId}.`);
  }
  return vehicle;
}
