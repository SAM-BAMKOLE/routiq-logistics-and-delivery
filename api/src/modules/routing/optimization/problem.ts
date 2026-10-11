import type { DistanceMatrix, MatrixLocation } from './matrix.js';

/**
 * The optimizer's input, in pure terms: a depot, a fleet, and a set of
 * drop-off stops, with travel costs precomputed in `matrix`. Node 0 of the
 * matrix is the depot; stop i is node i + 1. All times are seconds relative
 * to the plan day's midnight, so a night shift simply runs past 86400.
 */
export interface RoutingStop {
  readonly id: string;
  readonly location: MatrixLocation;
  readonly weightKg: number;
  readonly volumeM3: number;
  /** Time-window start in seconds from plan-day midnight (0 = day start). */
  readonly earliestSeconds: number;
  /** Time-window end; `Infinity` when the shipment has no window. */
  readonly latestSeconds: number;
  /** Dwell time at the stop (loading/unloading), in seconds. */
  readonly serviceSeconds: number;
}

export interface RoutingVehicle {
  readonly id: string;
  readonly capacityWeightKg: number;
  readonly capacityVolumeM3: number;
  /** Shift start in seconds from plan-day midnight. */
  readonly shiftStartSeconds: number;
  /** The vehicle must be back at the depot by this time. */
  readonly shiftEndSeconds: number;
}

export interface RoutingProblem {
  readonly depot: MatrixLocation;
  readonly depotOpensSeconds: number;
  readonly depotClosesSeconds: number;
  readonly vehicles: readonly RoutingVehicle[];
  readonly stops: readonly RoutingStop[];
  readonly matrix: DistanceMatrix;
  /** Index of a stop's matrix node (stop i -> node i + 1). */
  nodeOf(stopIndex: number): number;
}

/** Builds the problem, wiring stop indexes to matrix nodes. */
export function createProblem(input: {
  depot: MatrixLocation;
  depotOpensSeconds: number;
  depotClosesSeconds: number;
  vehicles: readonly RoutingVehicle[];
  stops: readonly RoutingStop[];
  matrix: DistanceMatrix;
}): RoutingProblem {
  return {
    ...input,
    nodeOf: (stopIndex) => stopIndex + 1,
  };
}
