/**
 * The optimizer's output and the tenant's objective weights.
 *
 * A solution visits every stop exactly once (in some route) or lists it in
 * `unassigned` with a reason — never both, never neither. That invariant is
 * property-tested per strategy.
 */
export type UnassignedReason =
  | 'no_coordinates'
  | 'no_feasible_vehicle'
  | 'capacity_exceeded'
  | 'time_window_infeasible'
  | 'shift_exceeded';

export interface UnassignedStop {
  readonly stopId: string;
  readonly reason: UnassignedReason;
}

/** One stop's schedule inside a route. */
export interface PlannedStop {
  readonly stopId: string;
  /** Arrival at the stop (after driving from the previous node). */
  readonly arrivalSeconds: number;
  /** Waiting for the time window to open (0 when on time). */
  readonly waitSeconds: number;
  /** Arrival + wait + service; departure towards the next node. */
  readonly departureSeconds: number;
}

export interface SolvedRoute {
  readonly vehicleId: string;
  /** Visited stops in order; an empty route means the vehicle is unused. */
  readonly stops: readonly PlannedStop[];
  /** Driving distance of the whole tour (depot ... depot), in metres. */
  readonly distanceMeters: number;
  /** Tour time: driving + waiting + service, in seconds. */
  readonly durationSeconds: number;
  /** Time back at the depot, in seconds from plan-day midnight. */
  readonly returnSeconds: number;
}

export interface RoutingSolution {
  readonly routes: readonly SolvedRoute[];
  readonly unassigned: readonly UnassignedStop[];
  readonly totalDistanceMeters: number;
  /** Distinct vehicles with at least one tour (not route count). */
  readonly usedVehicles: number;
  /** Tenant objective: distance + vehicles + lateness + unassigned, weighted. */
  readonly objectiveValue: number;
}

export interface RoutingWeights {
  readonly distance: number;
  readonly vehicles: number;
  readonly lateness: number;
  readonly unassigned: number;
}

export const DEFAULT_ROUTING_WEIGHTS: RoutingWeights = {
  distance: 1,
  vehicles: 50_000,
  lateness: 100,
  unassigned: 200_000,
};

export interface SolveOptions {
  /** Hard safety cap; iteration limits are the deterministic stop. */
  readonly timeBudgetMs: number;
  readonly seed: number;
  readonly weights: RoutingWeights;
  /** Iteration cap for the metaheuristic (and local search's move budget). */
  readonly maxIterations: number;
}
