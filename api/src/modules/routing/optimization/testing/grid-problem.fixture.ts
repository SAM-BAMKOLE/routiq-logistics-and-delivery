import {
  EuclideanMatrixProvider,
  createProblem,
  type RoutingProblem,
  type RoutingStop,
  type RoutingVehicle,
} from '../index.js';

/**
 * Deterministic problem builders for the optimizer's tests. Coordinates are
 * planar grid units; with the default speed of 1 unit/second, travel time
 * equals travel distance, which keeps the time-window arithmetic in tests
 * checkable by hand.
 */
export interface StopSpec {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly weight?: number;
  readonly volume?: number;
  readonly earliest?: number;
  readonly latest?: number;
  readonly service?: number;
}

export interface VehicleSpec {
  readonly id: string;
  readonly weight?: number;
  readonly volume?: number;
  readonly shiftStart?: number;
  readonly shiftEnd?: number;
}

export function gridProblem(props: {
  stops: readonly StopSpec[];
  vehicles: readonly VehicleSpec[];
  depot?: { x: number; y: number };
  opens?: number;
  closes?: number;
  speed?: number;
}): RoutingProblem {
  const depot = props.depot ?? { x: 0, y: 0 };
  const stops: RoutingStop[] = props.stops.map((stop) => ({
    id: stop.id,
    location: { latitude: stop.x, longitude: stop.y },
    weightKg: stop.weight ?? 1,
    volumeM3: stop.volume ?? 1,
    earliestSeconds: stop.earliest ?? 0,
    latestSeconds: stop.latest ?? Number.POSITIVE_INFINITY,
    serviceSeconds: stop.service ?? 0,
  }));
  const vehicles: RoutingVehicle[] = props.vehicles.map((vehicle) => ({
    id: vehicle.id,
    capacityWeightKg: vehicle.weight ?? 100,
    capacityVolumeM3: vehicle.volume ?? 100,
    shiftStartSeconds: vehicle.shiftStart ?? 0,
    shiftEndSeconds: vehicle.shiftEnd ?? 100_000,
  }));
  const matrix = new EuclideanMatrixProvider(props.speed ?? 1).build([
    { latitude: depot.x, longitude: depot.y },
    ...stops.map((stop) => stop.location),
  ]);
  return createProblem({
    depot: { latitude: depot.x, longitude: depot.y },
    depotOpensSeconds: props.opens ?? 0,
    depotClosesSeconds: props.closes ?? 100_000,
    vehicles,
    stops,
    matrix,
  });
}
