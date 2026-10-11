import type { RoutingProblem, RoutingVehicle } from './problem.js';
import type {
  PlannedStop,
  UnassignedReason,
} from './solution.js';

/**
 * Route evaluation: the single source of truth for "may this vehicle serve
 * these stops in this order?". Every construction heuristic, every
 * local-search move, and the post-processor all go through it, so a route
 * that any part of the optimizer produces is feasible by definition.
 *
 * Constraints (architecture, "Problem definition"):
 * - capacity: total weight and volume must fit the vehicle;
 * - time windows: early arrival waits, late arrival is infeasible;
 * - shift: leave at max(depot opening, shift start), back by shift end.
 *
 * When several constraints fail at once the reason reported is the first in
 * that order — capacity, windows, shift — so unassigned reasons are
 * deterministic.
 */
export interface RouteEvaluation {
  readonly feasible: boolean;
  readonly reason?: UnassignedReason;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly returnSeconds: number;
  readonly latenessSeconds: number;
  readonly weightKg: number;
  readonly volumeM3: number;
  readonly stops: readonly PlannedStop[];
}

const EPSILON = 1e-6;

export function evaluateRoute(
  problem: RoutingProblem,
  vehicle: RoutingVehicle,
  stopIndexes: readonly number[],
): RouteEvaluation {
  const { matrix } = problem;

  let weightKg = 0;
  let volumeM3 = 0;
  for (const index of stopIndexes) {
    weightKg += problem.stops[index].weightKg;
    volumeM3 += problem.stops[index].volumeM3;
  }
  const overCapacity =
    weightKg > vehicle.capacityWeightKg + EPSILON ||
    volumeM3 > vehicle.capacityVolumeM3 + EPSILON;

  let time = Math.max(
    problem.depotOpensSeconds,
    vehicle.shiftStartSeconds,
  );
  const departSeconds = time;
  let distanceMeters = 0;
  const latenessSeconds = 0; // hard windows: a late arrival is infeasible, never accrued
  let previousNode = 0;
  const planned: PlannedStop[] = [];
  let windowViolation = false;

  for (const index of stopIndexes) {
    const stop = problem.stops[index];
    const node = problem.nodeOf(index);
    distanceMeters += matrix.distanceMeters(previousNode, node);
    time += matrix.durationSeconds(previousNode, node);
    const arrivalSeconds = time;
    const waitSeconds = Math.max(0, stop.earliestSeconds - arrivalSeconds);
    if (arrivalSeconds > stop.latestSeconds + EPSILON) {
      // Hard windows: stop at the first violation; lateness stays 0.
      windowViolation = true;
      break;
    }
    // Hard windows mean lateness never accrues: a late arrival is infeasible,
    // not penalized (the objective's lateness term serves soft-window mode).
    time = arrivalSeconds + waitSeconds + stop.serviceSeconds;
    planned.push({ stopId: stop.id, arrivalSeconds, waitSeconds, departureSeconds: time });
    previousNode = node;
  }

  if (!windowViolation && stopIndexes.length > 0) {
    distanceMeters += matrix.distanceMeters(previousNode, 0);
    time += matrix.durationSeconds(previousNode, 0);
  }

  const shiftViolation = time > vehicle.shiftEndSeconds + EPSILON;
  const feasible = !overCapacity && !windowViolation && !shiftViolation;

  return {
    feasible,
    reason: overCapacity
      ? 'capacity_exceeded'
      : windowViolation
        ? 'time_window_infeasible'
        : shiftViolation
          ? 'shift_exceeded'
          : undefined,
    distanceMeters,
    durationSeconds: time - departSeconds,
    returnSeconds: time,
    latenessSeconds,
    weightKg,
    volumeM3,
    stops: planned,
  };
}

/** The smallest vehicle (weight capacity, then id) that can serve the stops. */
export function bestVehicleFor(
  problem: RoutingProblem,
  stopIndexes: readonly number[],
): { vehicle: RoutingVehicle; evaluation: RouteEvaluation } | null {
  let best: { vehicle: RoutingVehicle; evaluation: RouteEvaluation } | null = null;
  for (const vehicle of problem.vehicles) {
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
 * Why a lone stop cannot be served by any vehicle — the reason a stop gets
 * when even the one-stop problem fails: dominated by the tightest constraint
 * that some vehicle could have met.
 */
export function probeStop(
  problem: RoutingProblem,
  stopIndex: number,
): UnassignedReason {
  const reasons = new Set<UnassignedReason>();
  for (const vehicle of problem.vehicles) {
    const evaluation = evaluateRoute(problem, vehicle, [stopIndex]);
    if (evaluation.feasible) {
      return 'no_feasible_vehicle'; // unreachable, kept for symmetry
    }
    if (evaluation.reason) {
      reasons.add(evaluation.reason);
    }
  }
  if (reasons.size === 0 || reasons.has('no_feasible_vehicle')) {
    return 'no_feasible_vehicle';
  }
  // Report the tightest failing constraint in the fixed order.
  for (const order of ['capacity_exceeded', 'time_window_infeasible', 'shift_exceeded'] as const) {
    if (reasons.has(order)) {
      return order;
    }
  }
  return 'no_feasible_vehicle';
}

