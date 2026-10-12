/**
 * The tenant's `tracking` settings block: how long history lives, which
 * points are worth storing, and how close a driver must be to the dropoff
 * before anyone is told.
 *
 * Untrusted input, so every value is coerced and clamped — a tenant cannot
 * ask for zero retention or a 900 km/h plausibility ceiling by writing an
 * absurd number into its own settings row.
 */

export interface TrackingSettings {
  /** Days of `driver_locations` history kept before the sweep deletes it. */
  readonly retentionDays: number;
  /** A point older than this (vs arrival time) is a stale replay. */
  readonly maxPointAgeSeconds: number;
  /** Points closer and closer-in-time than these collapse into one. */
  readonly minDistanceMeters: number;
  readonly minIntervalSeconds: number;
  /** Anything implying a faster trip is dropped as implausible. */
  readonly maxSpeedKmh: number;
  /** How near the dropoff a driver triggers DriverNearDestination. */
  readonly geofenceRadiusMeters: number;
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
  retentionDays: 30,
  maxPointAgeSeconds: 300,
  minDistanceMeters: 25,
  minIntervalSeconds: 10,
  maxSpeedKmh: 250,
  geofenceRadiusMeters: 250,
};

interface Clamp {
  readonly min: number;
  readonly max: number;
}

const CLAMPS: Record<keyof TrackingSettings, Clamp> = {
  retentionDays: { min: 1, max: 365 },
  maxPointAgeSeconds: { min: 30, max: 3_600 },
  minDistanceMeters: { min: 1, max: 1_000 },
  minIntervalSeconds: { min: 1, max: 3_600 },
  maxSpeedKmh: { min: 30, max: 500 },
  geofenceRadiusMeters: { min: 50, max: 5_000 },
};

function clamped(key: keyof TrackingSettings, value: unknown): number {
  const { min, max } = CLAMPS[key];
  const fallback = DEFAULT_TRACKING_SETTINGS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads the `tracking` block of a tenant's settings. Missing keys fall back
 * to the defaults, out-of-range numbers are clamped, and non-numbers are
 * ignored — settings written before this block existed parse the same as an
 * empty one.
 */
export function trackingSettingsFrom(
  settings: Record<string, unknown>,
): TrackingSettings {
  const block = settings['tracking'];
  const raw =
    typeof block === 'object' && block !== null
      ? (block as Record<string, unknown>)
      : {};
  return {
    retentionDays: clamped('retentionDays', raw['retentionDays']),
    maxPointAgeSeconds: clamped(
      'maxPointAgeSeconds',
      raw['maxPointAgeSeconds'],
    ),
    minDistanceMeters: clamped('minDistanceMeters', raw['minDistanceMeters']),
    minIntervalSeconds: clamped('minIntervalSeconds', raw['minIntervalSeconds']),
    maxSpeedKmh: clamped('maxSpeedKmh', raw['maxSpeedKmh']),
    geofenceRadiusMeters: clamped(
      'geofenceRadiusMeters',
      raw['geofenceRadiusMeters'],
    ),
  };
}
