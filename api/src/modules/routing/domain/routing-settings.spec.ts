import {
  DEFAULT_ROUTING_SETTINGS,
  clockToSeconds,
  routingSettingsFrom,
} from './routing-settings.js';

describe('routingSettingsFrom', () => {
  it('returns the documented defaults for a missing or malformed block', () => {
    expect(routingSettingsFrom({})).toEqual(DEFAULT_ROUTING_SETTINGS);
    expect(routingSettingsFrom({ routing: 'nope' })).toEqual(
      DEFAULT_ROUTING_SETTINGS,
    );
    expect(routingSettingsFrom({ routing: [] })).toEqual(
      DEFAULT_ROUTING_SETTINGS,
    );
  });

  it('reads a full block', () => {
    const settings = routingSettingsFrom({
      routing: {
        strategy: 'savings',
        depot: { latitude: 52.52, longitude: 13.405 },
        depotOpensAt: '7:30',
        depotClosesAt: '20:15',
        weights: { distance: 2, vehicles: 1_000, lateness: 0, unassigned: 5_000 },
        timeBudgetMs: 5_000,
        maxStops: 40,
        maxIterations: 900,
        serviceSeconds: 120,
        circuityFactor: 1.2,
        averageSpeedKmh: 25,
      },
    });
    expect(settings).toEqual({
      strategy: 'savings',
      depot: { latitude: 52.52, longitude: 13.405 },
      depotOpensAt: '07:30', // normalised to two digits
      depotClosesAt: '20:15',
      weights: { distance: 2, vehicles: 1_000, lateness: 0, unassigned: 5_000 },
      timeBudgetMs: 5_000,
      maxStops: 40,
      maxIterations: 900,
      serviceSeconds: 120,
      circuityFactor: 1.2,
      averageSpeedKmh: 25,
    });
  });

  it('falls back per field instead of rejecting the whole block', () => {
    const settings = routingSettingsFrom({
      routing: {
        strategy: 'teleport',
        depot: { latitude: 999, longitude: 0 },
        depotOpensAt: '25:00',
        depotClosesAt: 123,
        weights: { distance: -1 },
        timeBudgetMs: 0, // below the floor
        maxStops: 99_999, // above the cap
        maxIterations: 1.5, // not an integer
        serviceSeconds: -5,
        circuityFactor: 9,
        averageSpeedKmh: 1_000,
      },
    });
    expect(settings).toEqual({
      ...DEFAULT_ROUTING_SETTINGS,
      depot: null, // a bad depot is "not configured", never a bad default
      weights: DEFAULT_ROUTING_SETTINGS.weights, // all-zero/negative falls back wholesale
    });
  });

  it('keeps a partially specified weights block per field', () => {
    const settings = routingSettingsFrom({
      routing: { weights: { distance: 3 } },
    });
    expect(settings.weights).toEqual({
      distance: 3,
      vehicles: DEFAULT_ROUTING_SETTINGS.weights.vehicles,
      lateness: DEFAULT_ROUTING_SETTINGS.weights.lateness,
      unassigned: DEFAULT_ROUTING_SETTINGS.weights.unassigned,
    });
  });

  it('keeps a valid depot with out-of-range-free coordinates', () => {
    const settings = routingSettingsFrom({
      routing: { depot: { latitude: -33.86, longitude: 151.21 } },
    });
    expect(settings.depot).toEqual({ latitude: -33.86, longitude: 151.21 });
  });
});

describe('clockToSeconds', () => {
  it('converts HH:MM to seconds from midnight', () => {
    expect(clockToSeconds('00:00')).toBe(0);
    expect(clockToSeconds('08:30')).toBe(30_600);
    expect(clockToSeconds('23:59')).toBe(86_340);
  });
});
