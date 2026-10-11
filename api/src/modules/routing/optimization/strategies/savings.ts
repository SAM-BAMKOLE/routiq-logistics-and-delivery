import { assembleSolution, type RouteDraft } from '../assemble.js';
import {
  bestVehicleFor,
  evaluateRoute,
  probeStop,
  type RouteEvaluation,
} from '../feasibility.js';
import type { RoutingProblem, RoutingVehicle } from '../problem.js';
import type {
  RoutingSolution,
  SolveOptions,
  UnassignedStop,
} from '../solution.js';
import type { RoutingStrategy } from '../strategy.js';

/**
 * Clarke-Wright savings construction (architecture step 3). Every stop
 * starts as its own route; merge candidates are the pairwise savings
 * s(i, j) = d(depot, i) + d(depot, j) - d(i, j), tried in descending order,
 * and a merge is accepted only when i and j sit at route ends and the
 * merged sequence stays feasible for some vehicle (the cheapest orientation
 * and the smallest-capacity vehicle that fits, re-chosen at each attempt).
 *
 * One tour per vehicle — classic CVRPTW, no multi-tripping. After merging,
 * the surviving routes compete for the free fleet, largest first; a route
 * no free vehicle serves has its stops salvaged into the drafted routes by
 * cheapest feasible insertion, and anything that still fits nowhere is
 * reported unassigned. (Without the salvage step a hard fleet limit would
 * starve the surplus singleton routes that merging left behind — the
 * benchmark caught exactly that.)
 */
export const savingsStrategy: RoutingStrategy = {
  name: 'savings',
  solve(problem: RoutingProblem, options: SolveOptions): RoutingSolution {
    // 1. Single-stop routes; a stop no vehicle can serve alone is unassigned
    //    with the reason its tightest constraint deserves.
    const routes: Array<{ stops: number[] }> = [];
    const unassigned: UnassignedStop[] = [];
    for (let index = 0; index < problem.stops.length; index += 1) {
      if (bestVehicleFor(problem, [index])) {
        routes.push({ stops: [index] });
      } else {
        unassigned.push({
          stopId: problem.stops[index].id,
          reason: probeStop(problem, index),
        });
      }
    }

    // 2. The savings list, ordered deterministically (saving, then ids).
    const routeOf = new Map<number, number>();
    routes.forEach((route, slot) =>
      route.stops.forEach((stop) => routeOf.set(stop, slot)),
    );
    const pairs: Array<{ i: number; j: number; saving: number }> = [];
    for (let i = 0; i < problem.stops.length; i += 1) {
      for (let j = i + 1; j < problem.stops.length; j += 1) {
        if (!routeOf.has(i) || !routeOf.has(j)) {
          continue;
        }
        const nodeI = problem.nodeOf(i);
        const nodeJ = problem.nodeOf(j);
        pairs.push({
          i,
          j,
          saving:
            problem.matrix.distanceMeters(0, nodeI) +
            problem.matrix.distanceMeters(0, nodeJ) -
            problem.matrix.distanceMeters(nodeI, nodeJ),
        });
      }
    }
    pairs.sort((a, b) => b.saving - a.saving || a.i - b.i || a.j - b.j);

    // 3. Parallel merge phase.
    for (const pair of pairs) {
      const slotI = routeOf.get(pair.i);
      const slotJ = routeOf.get(pair.j);
      if (slotI === undefined || slotJ === undefined || slotI === slotJ) {
        continue; // same route, or a stop already merged away
      }
      const mergedSequences = edgeMerges(
        routes[slotI].stops,
        routes[slotJ].stops,
        pair.i,
        pair.j,
      );
      let chosen: {
        stops: number[];
        vehicleId: string;
        distanceMeters: number;
      } | null = null;
      for (const candidate of mergedSequences) {
        const best = bestVehicleFor(problem, candidate);
        if (!best) {
          continue;
        }
        // Several orientations may be feasible; keep the cheapest tour, not
        // the first that fits — the orientation is free distance.
        if (
          !chosen ||
          best.evaluation.distanceMeters < chosen.distanceMeters
        ) {
          chosen = {
            stops: candidate,
            vehicleId: best.vehicle.id,
            distanceMeters: best.evaluation.distanceMeters,
          };
        }
      }
      if (!chosen) {
        continue; // no vehicle could serve the merged tour: keep both routes
      }
      routes[slotI] = { stops: chosen.stops };
      routes.splice(slotJ, 1);
      routeOf.clear();
      routes.forEach((route, slot) =>
        route.stops.forEach((stop) => routeOf.set(stop, slot)),
      );
    }

    // 4. One tour per vehicle: routes compete for the free fleet, largest
    //    first; a route that finds no free vehicle has its stops salvaged
    //    into the drafted routes by cheapest feasible insertion, and
    //    anything that fits nowhere is reported unassigned.
    const ordered = [...routes].sort(
      (a, b) => b.stops.length - a.stops.length || a.stops[0] - b.stops[0],
    );
    const usedVehicles = new Set<string>();
    const drafts: RouteDraft[] = [];
    for (const route of ordered) {
      const best = bestFreeVehicleFor(problem, usedVehicles, route.stops);
      if (best) {
        usedVehicles.add(best.vehicle.id);
        drafts.push({ vehicleId: best.vehicle.id, stopIndexes: route.stops });
      } else {
        salvageIntoDrafts(problem, route.stops, drafts, unassigned);
      }
    }
    return assembleSolution(problem, drafts, unassigned, options.weights);
  },
};

/** The four end-to-end orientations of merging routes A and B at i and j. */
function edgeMerges(
  a: readonly number[],
  b: readonly number[],
  i: number,
  j: number,
): number[][] {
  const aFirst = a[0] === i;
  const aLast = a[a.length - 1] === i;
  const bFirst = b[0] === j;
  const bLast = b[b.length - 1] === j;
  const candidates: number[][] = [];
  if (aLast && bFirst) {
    candidates.push([...a, ...b]);
  }
  if (aLast && bLast) {
    candidates.push([...a, ...[...b].reverse()]);
  }
  if (aFirst && bFirst) {
    candidates.push([...[...a].reverse(), ...b]);
  }
  if (aFirst && bLast) {
    candidates.push([...[...a].reverse(), ...[...b].reverse()]);
  }
  return candidates;
}

/** Smallest free (not yet drafted) vehicle that can serve the stops. */
function bestFreeVehicleFor(
  problem: RoutingProblem,
  usedVehicles: ReadonlySet<string>,
  stopIndexes: readonly number[],
): { vehicle: RoutingVehicle; evaluation: RouteEvaluation } | null {
  let best: { vehicle: RoutingVehicle; evaluation: RouteEvaluation } | null =
    null;
  for (const vehicle of problem.vehicles) {
    if (usedVehicles.has(vehicle.id)) {
      continue;
    }
    const evaluation = evaluateRoute(problem, vehicle, stopIndexes);
    if (!evaluation.feasible) {
      continue;
    }
    if (
      !best ||
      vehicle.capacityWeightKg < best.vehicle.capacityWeightKg ||
      (vehicle.capacityWeightKg === best.vehicle.capacityWeightKg &&
        vehicle.id < best.vehicle.id)
    ) {
      best = { vehicle, evaluation };
    }
  }
  return best;
}

/**
 * Inserts a dropped route's stops one by one into the drafted routes at the
 * cheapest feasible position (cheapest insertion, with feasibility checked
 * by full re-evaluation of the resulting tour). A stop that fits nowhere is
 * unassigned: the day's fleet really has no room left for it.
 */
function salvageIntoDrafts(
  problem: RoutingProblem,
  stops: readonly number[],
  drafts: RouteDraft[],
  unassigned: UnassignedStop[],
): void {
  for (const stop of stops) {
    let best: {
      draft: number;
      sequence: number[];
      distanceMeters: number;
    } | null = null;
    for (let d = 0; d < drafts.length; d += 1) {
      const draft = drafts[d];
      const vehicle = problem.vehicles.find((v) => v.id === draft.vehicleId);
      if (!vehicle) {
        continue;
      }
      for (
        let position = 0;
        position <= draft.stopIndexes.length;
        position += 1
      ) {
        const sequence = [...draft.stopIndexes];
        sequence.splice(position, 0, stop);
        const evaluation = evaluateRoute(problem, vehicle, sequence);
        if (!evaluation.feasible) {
          continue;
        }
        if (!best || evaluation.distanceMeters < best.distanceMeters) {
          best = {
            draft: d,
            sequence,
            distanceMeters: evaluation.distanceMeters,
          };
        }
      }
    }
    if (best) {
      drafts[best.draft] = {
        vehicleId: drafts[best.draft].vehicleId,
        stopIndexes: best.sequence,
      };
    } else {
      unassigned.push({
        stopId: problem.stops[stop].id,
        reason: 'no_feasible_vehicle',
      });
    }
  }
}
