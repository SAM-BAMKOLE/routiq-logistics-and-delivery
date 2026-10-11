import { DEFAULT_ROUTING_WEIGHTS, type RoutingWeights } from '../optimization/solution.js';
import { isRoutingStrategyName, type RoutingStrategyName } from '../optimization/strategy.js';

/**
 * Tenant-level routing rules, read from the tenant's `settings` jsonb under
 * the `routing` key with documented defaults (same shape as the dispatch
 * settings). Pure: no database, no framework.
 *
 * The depot is the one piece with no sensible default — a route problem
 * without a start point is not a problem — so `depot` stays null until the
 * tenant configures it and the application layer refuses to plan.
 */
export interface RoutingDepot {
  readonly latitude: number;
  readonly longitude: number;
}

export interface RoutingSettings {
  /** Which strategy {@link RoutingService} reaches for by default. */
  readonly strategy: RoutingStrategyName;
  /** The tenant's single depot; null until configured. */
  readonly depot: RoutingDepot | null;
  /** Depot opening, "HH:MM" — routes cannot leave earlier. */
  readonly depotOpensAt: string;
  /** Depot closing, "HH:MM" — the shift horizon when a vehicle has none. */
  readonly depotClosesAt: string;
  /** Objective weights (distance, vehicles, lateness, unassigned stops). */
  readonly weights: RoutingWeights;
  /** Safety cap for one planning run's optimizer (the phase-2 queue moves
   * this to a worker; phase 1 runs inline within it). */
  readonly timeBudgetMs: number;
  /** Hard cap on stops in one plan; larger requests are 422, never clamped. */
  readonly maxStops: number;
  /** Iteration budget — the deterministic stopping rule of every strategy. */
  readonly maxIterations: number;
  /** Default dwell time at a stop when the shipment sets none. */
  readonly serviceSeconds: number;
  /** Straight-line distance multiplier approximating roads (phase 1). */
  readonly circuityFactor: number;
  /** Average speed used to turn distance into drive time (phase 1). */
  readonly averageSpeedKmh: number;
}

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = {
  strategy: 'annealing',
  depot: null,
  depotOpensAt: '08:00',
  depotClosesAt: '18:00',
  weights: DEFAULT_ROUTING_WEIGHTS,
  timeBudgetMs: 2_000,
  maxStops: 500,
  maxIterations: 4_000,
  serviceSeconds: 300,
  circuityFactor: 1.3,
  averageSpeedKmh: 30,
};

const MAX_TIME_BUDGET_MS = 30_000;
const MAX_STOPS_LIMIT = 2_000;
const MAX_ITERATIONS_LIMIT = 200_000;

export function routingSettingsFrom(
  settings: Record<string, unknown>,
): RoutingSettings {
  const block = settings['routing'];
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    return DEFAULT_ROUTING_SETTINGS;
  }
  const raw = block as Record<string, unknown>;

  return {
    strategy: parseStrategy(raw['strategy']),
    depot: parseDepot(raw['depot']),
    depotOpensAt: parseClock(
      raw['depotOpensAt'],
      DEFAULT_ROUTING_SETTINGS.depotOpensAt,
    ),
    depotClosesAt: parseClock(
      raw['depotClosesAt'],
      DEFAULT_ROUTING_SETTINGS.depotClosesAt,
    ),
    weights: parseWeights(raw['weights']),
    timeBudgetMs: parseBoundedInt(
      raw['timeBudgetMs'],
      DEFAULT_ROUTING_SETTINGS.timeBudgetMs,
      100,
      MAX_TIME_BUDGET_MS,
    ),
    maxStops: parseBoundedInt(
      raw['maxStops'],
      DEFAULT_ROUTING_SETTINGS.maxStops,
      1,
      MAX_STOPS_LIMIT,
    ),
    maxIterations: parseBoundedInt(
      raw['maxIterations'],
      DEFAULT_ROUTING_SETTINGS.maxIterations,
      100,
      MAX_ITERATIONS_LIMIT,
    ),
    serviceSeconds: parseBoundedInt(
      raw['serviceSeconds'],
      DEFAULT_ROUTING_SETTINGS.serviceSeconds,
      0,
      7_200,
    ),
    circuityFactor: parseBoundedNumber(
      raw['circuityFactor'],
      DEFAULT_ROUTING_SETTINGS.circuityFactor,
      1,
      3,
    ),
    averageSpeedKmh: parseBoundedNumber(
      raw['averageSpeedKmh'],
      DEFAULT_ROUTING_SETTINGS.averageSpeedKmh,
      1,
      200,
    ),
  };
}

function parseStrategy(value: unknown): RoutingStrategyName {
  return isRoutingStrategyName(value)
    ? value
    : DEFAULT_ROUTING_SETTINGS.strategy;
}

function parseDepot(value: unknown): RoutingDepot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const latitude = raw['latitude'];
  const longitude = raw['longitude'];
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function parseClock(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return fallback;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "08:30" -> 30600 seconds from plan-day midnight. */
export function clockToSeconds(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 3_600 + minutes * 60;
}

function parseWeights(value: unknown): RoutingWeights {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_ROUTING_WEIGHTS;
  }
  const raw = value as Record<string, unknown>;
  const one = (key: keyof RoutingWeights): number => {
    const candidate = raw[key];
    return typeof candidate === 'number' &&
      Number.isFinite(candidate) &&
      candidate >= 0
      ? candidate
      : DEFAULT_ROUTING_WEIGHTS[key];
  };
  const weights: RoutingWeights = {
    distance: one('distance'),
    vehicles: one('vehicles'),
    lateness: one('lateness'),
    unassigned: one('unassigned'),
  };
  const allZero = Object.values(weights).every((weight) => weight === 0);
  return allZero ? DEFAULT_ROUTING_WEIGHTS : weights;
}

function parseBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function parseBoundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}
