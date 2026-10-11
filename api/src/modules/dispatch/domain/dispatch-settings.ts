/**
 * Tenant-level dispatch rules, read from the tenant's `settings` jsonb under
 * the `dispatch` key with documented defaults. Pure: no database, no
 * framework (same shape as the shipments policy).
 */
export const ASSIGNMENT_STRATEGIES = [
  'nearest',
  'least_loaded',
  'balanced',
] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export interface DispatchSettings {
  /** How the candidate search ranks eligible drivers. */
  readonly strategy: AssignmentStrategy;
  /** How long an offer stays live before it expires lazily. */
  readonly offerTtlMinutes: number;
  /** Proximity search widens through these radii (km) until it finds someone. */
  readonly radiusStepsKm: readonly number[];
  /** Hard cap on returned candidates. */
  readonly maxCandidates: number;
}

export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  strategy: 'balanced',
  offerTtlMinutes: 15,
  radiusStepsKm: [5, 10, 20],
  maxCandidates: 10,
};

const MAX_RADIUS_STEPS = 6;
const MAX_CANDIDATES = 50;

export function dispatchSettingsFrom(
  settings: Record<string, unknown>,
): DispatchSettings {
  const block = settings['dispatch'];
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    return DEFAULT_DISPATCH_SETTINGS;
  }
  const raw = block as Record<string, unknown>;

  const strategy = raw['strategy'];
  const ttl = raw['offerTtlMinutes'];
  const radius = raw['radiusStepsKm'];
  const max = raw['maxCandidates'];

  const radiusStepsKm =
    Array.isArray(radius) &&
    radius.length > 0 &&
    radius.every(
      (step) => typeof step === 'number' && Number.isFinite(step) && step > 0,
    )
      ? [...radius]
          .sort((a, b) => a - b)
          .slice(0, MAX_RADIUS_STEPS)
      : DEFAULT_DISPATCH_SETTINGS.radiusStepsKm;

  return {
    strategy:
      typeof strategy === 'string' &&
      (ASSIGNMENT_STRATEGIES as readonly string[]).includes(strategy)
        ? (strategy as AssignmentStrategy)
        : DEFAULT_DISPATCH_SETTINGS.strategy,
    offerTtlMinutes:
      typeof ttl === 'number' && Number.isInteger(ttl) && ttl >= 0
        ? ttl
        : DEFAULT_DISPATCH_SETTINGS.offerTtlMinutes,
    radiusStepsKm,
    maxCandidates:
      typeof max === 'number' && Number.isInteger(max) && max > 0
        ? Math.min(max, MAX_CANDIDATES)
        : DEFAULT_DISPATCH_SETTINGS.maxCandidates,
  };
}
