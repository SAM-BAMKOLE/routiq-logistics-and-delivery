/**
 * Location points: what a point is, which of them a driver's device may send,
 * and which of them we keep.
 *
 * Everything here is pure so the rules that decide whether a position is
 * believed are testable without a database or a clock — the caller passes
 * `now`. A device's buffer arrives unordered (an offline phone flushes its
 * queue on reconnect), so a batch is sorted by `recordedAt` before it is
 * judged, and each point is judged against the newest point kept so far.
 */

/** One point as the device sent it (already shape-validated by the DTO). */
export interface RawLocationPoint {
  readonly latitude: number;
  readonly longitude: number;
  /** When the fix was taken, not when it arrived. */
  readonly recordedAt: Date;
  readonly speedKmh?: number | null;
  readonly heading?: number | null;
}

/** A point that survived validation, ready to store. */
export interface ValidatedLocationPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly recordedAt: Date;
  readonly speedKmh: number | null;
  readonly heading: number | null;
}

/**
 * Why a point was dropped. The ingest response reports these per point so a
 * debugging driver can see exactly what their device sent that we refused:
 *
 * - `out_of_range` — coordinates outside ±90/±180, or an unparseable time.
 * - `future` — recorded beyond a small clock-skew allowance.
 * - `stale` — older than the tenant's maximum point age (a replayed backlog).
 * - `implausible_speed` — implies travelling faster than a vehicle can.
 * - `thinned` — valid but too close to its predecessor to be worth storing.
 */
export type LocationDiscardReason =
  | 'out_of_range'
  | 'future'
  | 'stale'
  | 'implausible_speed'
  | 'thinned';

/** Per-tenant believability and retention thresholds. */
export interface LocationThresholds {
  /** A point older than this (vs `now`) is a stale replay. */
  readonly maxPointAgeSeconds: number;
  /** Two points closer than this AND this-close-in-time collapse to one. */
  readonly minDistanceMeters: number;
  readonly minIntervalSeconds: number;
  /** Anything implying a faster trip than this is dropped as implausible. */
  readonly maxSpeedKmh: number;
}

export interface DiscardedPoint {
  /** Index in the caller's original (unsorted) array. */
  readonly index: number;
  readonly reason: LocationDiscardReason;
}

export interface LocationValidationResult {
  /** Believable points, oldest first. */
  readonly accepted: ValidatedLocationPoint[];
  readonly discarded: DiscardedPoint[];
}

/** Clock-skew allowance for `recordedAt` timestamps ahead of server time. */
export const FUTURE_SKEW_SECONDS = 60;

/**
 * Great-circle distance in metres (haversine). Good enough at vehicle scale;
 * PostGIS `ST_Distance` on the stored geography column remains the authority
 * for anything spatial, and the two agree to within metres here.
 */
export function haversineMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) *
      Math.cos(toRad(to.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Sorts a batch by `recordedAt` and decides, point by point, which are worth
 * believing. `previous` is the newest point already stored for this driver;
 * within the batch each accepted point becomes the new predecessor.
 */
export function validateLocationPoints(
  points: readonly RawLocationPoint[],
  thresholds: LocationThresholds,
  previous: ValidatedLocationPoint | null,
  now: Date,
): LocationValidationResult {
  const accepted: ValidatedLocationPoint[] = [];
  const discarded: DiscardedPoint[] = [];

  const sorted = points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => a.point.recordedAt.getTime() - b.point.recordedAt.getTime());

  let predecessor: ValidatedLocationPoint | null = previous;
  for (const { point, index } of sorted) {
    const reason = discardReasonOf(point, thresholds, predecessor, now);
    if (reason !== null) {
      discarded.push({ index, reason });
      continue;
    }
    const kept: ValidatedLocationPoint = {
      latitude: point.latitude,
      longitude: point.longitude,
      recordedAt: point.recordedAt,
      speedKmh: point.speedKmh ?? null,
      heading: point.heading ?? null,
    };
    accepted.push(kept);
    predecessor = kept;
  }
  return { accepted, discarded };
}

/**
 * The reason a point is dropped, or `null` when it is kept. Checks run
 * cheapest-first, and plausibility before thinning: a point that teleports a
 * truck across the country is implausible, however still it is.
 */
function discardReasonOf(
  point: RawLocationPoint,
  thresholds: LocationThresholds,
  predecessor: ValidatedLocationPoint | null,
  now: Date,
): LocationDiscardReason | null {
  const { latitude, longitude, recordedAt } = point;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    Number.isNaN(recordedAt.getTime())
  ) {
    return 'out_of_range';
  }

  const nowMs = now.getTime();
  if (recordedAt.getTime() > nowMs + FUTURE_SKEW_SECONDS * 1_000) {
    return 'future';
  }
  if (nowMs - recordedAt.getTime() > thresholds.maxPointAgeSeconds * 1_000) {
    return 'stale';
  }

  if (!predecessor) {
    return null; // First point for this driver: nothing to compare against.
  }

  const distanceM = haversineMeters(predecessor, point);
  const deltaSeconds =
    (recordedAt.getTime() - predecessor.recordedAt.getTime()) / 1_000;

  // A repeat of the predecessor (same place, same instant) cannot be a
  // position; a jump implies a speed no vehicle has.
  if (deltaSeconds <= 0) {
    return distanceM > 1 ? 'implausible_speed' : 'thinned';
  }
  // m/s → km/h is ×3.6.
  const speedKmh = (distanceM * 3.6) / deltaSeconds;
  if (speedKmh > thresholds.maxSpeedKmh) {
    return 'implausible_speed';
  }
  if (
    distanceM < thresholds.minDistanceMeters &&
    deltaSeconds < thresholds.minIntervalSeconds
  ) {
    return 'thinned';
  }
  return null;
}
