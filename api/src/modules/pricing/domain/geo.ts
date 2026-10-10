/** A WGS84 coordinate pair. */
export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two coordinates in meters (haversine on a
 * mean-earth-radius sphere). This is the pure fallback for pricing until the
 * routing step adds road-network distances; for city-scale deliveries the
 * difference sits well inside a quote's rounding.
 */
export function haversineMeters(from: Coordinate, to: Coordinate): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
