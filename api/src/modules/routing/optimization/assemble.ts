import { evaluateRoute } from './feasibility.js';
import type { RoutingProblem } from './problem.js';
import type {
  RoutingSolution,
  RoutingWeights,
  SolvedRoute,
  UnassignedStop,
} from './solution.js';

/** A route under construction: which vehicle, which stops, in which order. */
export interface RouteDraft {
  readonly vehicleId: string;
  readonly stopIndexes: readonly number[];
}

/**
 * Turns drafts plus the unassigned list into the final solution: routes are
 * evaluated one last time (empty ones are unused vehicles and drop out), and
 * the objective applies the tenant's weights — the formula from the
 * architecture doc, with lateness always 0 under hard windows.
 */
export function assembleSolution(
  problem: RoutingProblem,
  drafts: readonly RouteDraft[],
  unassigned: readonly UnassignedStop[],
  weights: RoutingWeights,
): RoutingSolution {
  const routes: SolvedRoute[] = [];
  let totalDistanceMeters = 0;
  let latenessSeconds = 0;

  for (const draft of drafts) {
    if (draft.stopIndexes.length === 0) {
      continue;
    }
    const vehicle = problem.vehicles.find((v) => v.id === draft.vehicleId);
    if (!vehicle) {
      throw new Error(`Draft route references unknown vehicle ${draft.vehicleId}.`);
    }
    const evaluation = evaluateRoute(problem, vehicle, draft.stopIndexes);
    if (!evaluation.feasible) {
      throw new Error(
        `Draft route for vehicle ${draft.vehicleId} is infeasible (${evaluation.reason}).`,
      );
    }
    totalDistanceMeters += evaluation.distanceMeters;
    latenessSeconds += evaluation.latenessSeconds;
    routes.push({
      vehicleId: draft.vehicleId,
      stops: evaluation.stops,
      distanceMeters: evaluation.distanceMeters,
      durationSeconds: evaluation.durationSeconds,
      returnSeconds: evaluation.returnSeconds,
    });
  }

  const usedVehicles = new Set(routes.map((route) => route.vehicleId)).size;
  const objectiveValue =
    weights.distance * totalDistanceMeters +
    weights.vehicles * usedVehicles +
    weights.lateness * latenessSeconds +
    weights.unassigned * unassigned.length;

  return {
    routes,
    unassigned: [...unassigned],
    totalDistanceMeters,
    usedVehicles,
    objectiveValue,
  };
}

/** Rebuilds strategy drafts (stop indexes) from a solved solution. */
export function draftsFromSolution(
  problem: RoutingProblem,
  solution: RoutingSolution,
): RouteDraft[] {
  const indexById = new Map(
    problem.stops.map((stop, index) => [stop.id, index]),
  );
  return solution.routes.map((route) => ({
    vehicleId: route.vehicleId,
    stopIndexes: route.stops.map((planned) => {
      const index = indexById.get(planned.stopId);
      if (index === undefined) {
        throw new Error(`Solution references unknown stop ${planned.stopId}.`);
      }
      return index;
    }),
  }));
}
