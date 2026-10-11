/**
 * Travel cost between every pair of plan locations.
 *
 * The optimizer only ever asks "how far / how long from node i to node j",
 * where node 0 is the depot and node k is the (k-1)-th stop. Building the
 * matrix once up front turns every feasibility check and every local-search
 * move into array lookups, which is what keeps the search fast.
 */
export interface MatrixLocation {
  readonly latitude: number;
  readonly longitude: number;
}

export interface DistanceMatrix {
  readonly size: number;
  distanceMeters(from: number, to: number): number;
  durationSeconds(from: number, to: number): number;
}

/**
 * Builds a {@link DistanceMatrix} from raw coordinates. The architecture's
 * adapter list is OSRM (road distances, phase 2), Haversine with a
 * road-circuity factor (phase 1 default), and Euclidean (benchmarks).
 */
export interface MatrixProvider {
  readonly name: string;
  build(locations: readonly MatrixLocation[]): DistanceMatrix;
}

const EARTH_RADIUS_M = 6_371_000;
const KMH_TO_MPS = 1 / 3.6;

export interface HaversineMatrixOptions {
  /** Straight-line distance is multiplied by this to approximate roads. */
  readonly circuityFactor: number;
  /** Average speed used to turn distance into drive time. */
  readonly averageSpeedKmh: number;
}

/**
 * Phase 1's road-distance stand-in: great-circle distance scaled by a
 * circuity factor, drive time at a constant average speed. Results are
 * cached by rounded coordinate pair, so a dense plan with repeated
 * locations measures each unique leg once.
 */
export class HaversineMatrixProvider implements MatrixProvider {
  readonly name = 'haversine';
  private readonly cache = new Map<string, number>();

  constructor(private readonly options: HaversineMatrixOptions) {}

  build(locations: readonly MatrixLocation[]): DistanceMatrix {
    const distances = buildSymmetric(locations, (a, b) => {
      const key = `${roundKey(a)}|${roundKey(b)}`;
      const hit = this.cache.get(key);
      if (hit !== undefined) {
        return hit;
      }
      const value =
        haversineMeters(a, b) * this.options.circuityFactor;
      this.cache.set(key, value);
      return value;
    });
    const speedMps = this.options.averageSpeedKmh * KMH_TO_MPS;
    return matrixFromDistances(distances, speedMps);
  }
}

/**
 * Benchmark adapter: plain planar distance in whatever unit the fixture
 * coordinates use (Solomon and CVRPLIB instances are unitless grids), with
 * drive time at a configurable unit-per-second speed.
 */
export class EuclideanMatrixProvider implements MatrixProvider {
  readonly name = 'euclidean';

  constructor(private readonly unitsPerSecond = 1) {}

  build(locations: readonly MatrixLocation[]): DistanceMatrix {
    const distances = buildSymmetric(locations, (a, b) =>
      Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude),
    );
    return matrixFromDistances(distances, this.unitsPerSecond);
  }
}

export function haversineMeters(a: MatrixLocation, b: MatrixLocation): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLng = (b.longitude - a.longitude) * toRad;
  const lat1 = a.latitude * toRad;
  const lat2 = b.latitude * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function buildSymmetric(
  locations: readonly MatrixLocation[],
  measure: (a: MatrixLocation, b: MatrixLocation) => number,
): Float64Array {
  const size = locations.length;
  const cells = new Float64Array(size * size);
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      const value = measure(locations[i], locations[j]);
      cells[i * size + j] = value;
      cells[j * size + i] = value;
    }
  }
  return cells;
}

function matrixFromDistances(
  cells: Float64Array,
  speedUnitsPerSecond: number,
): DistanceMatrix {
  const size = Math.sqrt(cells.length);
  return {
    size,
    distanceMeters: (from, to) => cells[from * size + to],
    durationSeconds: (from, to) => cells[from * size + to] / speedUnitsPerSecond,
  };
}

function roundKey(location: MatrixLocation): string {
  // ~1 m resolution: legs closer than that measure the same for routing.
  return `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`;
}
