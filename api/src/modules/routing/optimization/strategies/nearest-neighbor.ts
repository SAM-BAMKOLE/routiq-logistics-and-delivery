import { assembleSolution, type RouteDraft } from '../assemble.js';
import {
  evaluateRoute,
  probeStop,
} from '../feasibility.js';
import type { RoutingProblem } from '../problem.js';
import type { RoutingSolution, SolveOptions, UnassignedStop } from '../solution.js';
import type { RoutingStrategy } from '../strategy.js';

/**
 * Nearest-neighbor construction: the baseline every other strategy is
 * measured against. Each vehicle (in fleet order) greedily appends the
 * closest stop it can still serve feasibly; stops no vehicle can place end
 * up unassigned with the reason their tightest constraint deserves.
 */
export const nearestNeighborStrategy: RoutingStrategy = {
  name: 'nearest_neighbor',
  solve(problem: RoutingProblem, _options: SolveOptions): RoutingSolution {
    const remaining = new Set(problem.stops.map((_stop, index) => index));
    const drafts: RouteDraft[] = [];
    const unassigned: UnassignedStop[] = [];

    for (const vehicle of problem.vehicles) {
      const route: number[] = [];
      for (;;) {
        let bestIndex: number | null = null;
        let bestLeg = Number.POSITIVE_INFINITY;
        const lastNode = route.length === 0 ? 0 : problem.nodeOf(route[route.length - 1]);
        for (const index of remaining) {
          const leg = problem.matrix.distanceMeters(lastNode, problem.nodeOf(index));
          if (leg >= bestLeg) {
            continue;
          }
          const candidate = [...route, index];
          if (evaluateRoute(problem, vehicle, candidate).feasible) {
            bestIndex = index;
            bestLeg = leg;
          }
        }
        if (bestIndex === null) {
          break;
        }
        route.push(bestIndex);
        remaining.delete(bestIndex);
      }
      if (route.length > 0) {
        drafts.push({ vehicleId: vehicle.id, stopIndexes: route });
      }
    }

    for (const index of remaining) {
      unassigned.push({
        stopId: problem.stops[index].id,
        reason: probeStop(problem, index),
      });
    }
    return assembleSolution(problem, drafts, unassigned, _options.weights);
  },
};
