import {
  haversineMeters,
  validateLocationPoints,
  FUTURE_SKEW_SECONDS,
  type LocationThresholds,
  type RawLocationPoint,
} from './location-point.js';

const NOW = new Date('2026-10-11T12:00:00Z');

const THRESHOLDS: LocationThresholds = {
  maxPointAgeSeconds: 300,
  minDistanceMeters: 25,
  minIntervalSeconds: 10,
  maxSpeedKmh: 250,
};

function point(
  overrides: Partial<RawLocationPoint> & { recordedAt: Date },
): RawLocationPoint {
  return {
    latitude: 6.5244,
    longitude: 3.3792,
    speedKmh: null,
    heading: null,
    ...overrides,
  };
}

function at(secondsAgo: number): Date {
  return new Date(NOW.getTime() - secondsAgo * 1_000);
}

/** ~1.11 km per 0.01° of latitude, anywhere on the globe. */
function shiftedLatitude(degrees: number, base = 6.5244): number {
  return base + degrees;
}

describe('haversineMeters', () => {
  it('measures zero for the same point', () => {
    expect(haversineMeters({ latitude: 6.5, longitude: 3.3 }, { latitude: 6.5, longitude: 3.3 })).toBe(0);
  });

  it('matches the known Lagos–Abuja distance within 1%', () => {
    // ~908 km by road; straight line is a little shorter.
    const lagos = { latitude: 6.5244, longitude: 3.3792 };
    const abuja = { latitude: 9.0765, longitude: 7.3986 };
    const distance = haversineMeters(lagos, abuja);
    expect(distance).toBeGreaterThan(500_000);
    expect(distance).toBeLessThan(600_000);
  });

  it('scales linearly with latitude offsets', () => {
    const base = { latitude: 0, longitude: 0 };
    const one = haversineMeters(base, { latitude: 0.01, longitude: 0 });
    const two = haversineMeters(base, { latitude: 0.02, longitude: 0 });
    expect(two).toBeCloseTo(one * 2, 0);
  });
});

describe('validateLocationPoints', () => {
  it('keeps a fresh, plausible first point', () => {
    const result = validateLocationPoints(
      [point({ recordedAt: at(5) })],
      THRESHOLDS,
      null,
      NOW,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.discarded).toEqual([]);
    expect(result.accepted[0]).toMatchObject({
      latitude: 6.5244,
      longitude: 3.3792,
      speedKmh: null,
    });
  });

  it('drops coordinates outside the valid range', () => {
    const result = validateLocationPoints(
      [
        point({ latitude: 91, recordedAt: at(5) }),
        point({ longitude: -181, recordedAt: at(4) }),
      ],
      THRESHOLDS,
      null,
      NOW,
    );
    expect(result.accepted).toEqual([]);
    expect(result.discarded).toEqual([
      { index: 0, reason: 'out_of_range' },
      { index: 1, reason: 'out_of_range' },
    ]);
  });

  it('drops points recorded in the future beyond the skew allowance', () => {
    const withinSkew = new Date(NOW.getTime() + 5 * 1_000);
    const beyondSkew = new Date(
      NOW.getTime() + (FUTURE_SKEW_SECONDS + 30) * 1_000,
    );
    const result = validateLocationPoints(
      [point({ recordedAt: withinSkew }), point({ recordedAt: beyondSkew })],
      THRESHOLDS,
      null,
      NOW,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.discarded).toEqual([{ index: 1, reason: 'future' }]);
  });

  it('drops stale points older than the tenant’s maximum age', () => {
    const result = validateLocationPoints(
      [point({ recordedAt: at(400) }), point({ recordedAt: at(10) })],
      THRESHOLDS,
      null,
      NOW,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.discarded).toEqual([{ index: 0, reason: 'stale' }]);
  });

  it('drops points implying an impossible speed', () => {
    // 0.5° of latitude (~55 km) two seconds apart: ~100 000 km/h.
    const previous = {
      latitude: 6.5244,
      longitude: 3.3792,
      recordedAt: at(20),
      speedKmh: null,
      heading: null,
    };
    const result = validateLocationPoints(
      [point({ latitude: shiftedLatitude(0.5), recordedAt: at(18) })],
      THRESHOLDS,
      previous,
      NOW,
    );
    expect(result.accepted).toEqual([]);
    expect(result.discarded).toEqual([
      { index: 0, reason: 'implausible_speed' },
    ]);
  });

  it('thins points that barely move within the interval', () => {
    const previous = {
      latitude: 6.5244,
      longitude: 3.3792,
      recordedAt: at(30),
      speedKmh: null,
      heading: null,
    };
    // ~1 m east, 5 s later: closer than 25 m and within 10 s.
    const result = validateLocationPoints(
      [point({ longitude: 3.37921, recordedAt: at(25) })],
      THRESHOLDS,
      previous,
      NOW,
    );
    expect(result.accepted).toEqual([]);
    expect(result.discarded).toEqual([{ index: 0, reason: 'thinned' }]);
  });

  it('keeps a small move once the interval has passed', () => {
    const previous = {
      latitude: 6.5244,
      longitude: 3.3792,
      recordedAt: at(60),
      speedKmh: null,
      heading: null,
    };
    // Same ~1 m move, but 20 s later: the interval alone earns a row.
    const result = validateLocationPoints(
      [point({ longitude: 3.37921, recordedAt: at(40) })],
      THRESHOLDS,
      previous,
      NOW,
    );
    expect(result.accepted).toHaveLength(1);
  });

  it('sorts an unordered offline buffer and judges in time order', () => {
    const result = validateLocationPoints(
      [
        point({ latitude: shiftedLatitude(0.001), recordedAt: at(10) }),
        point({ latitude: 91, recordedAt: at(30) }), // invalid, oldest
        point({ recordedAt: at(20) }),
      ],
      THRESHOLDS,
      null,
      NOW,
    );
    expect(result.accepted.map((p) => p.recordedAt.getTime())).toEqual([
      at(20).getTime(),
      at(10).getTime(),
    ]);
    expect(result.discarded).toEqual([{ index: 1, reason: 'out_of_range' }]);
  });

  it('reports original array indices, not sorted positions', () => {
    const result = validateLocationPoints(
      [
        point({ recordedAt: at(5) }), // index 0, second in time
        point({ recordedAt: at(15) }), // index 1, first in time
      ],
      THRESHOLDS,
      null,
      NOW,
    );
    expect(result.accepted).toHaveLength(2);
    expect(result.discarded).toEqual([]);
  });

  it('drops an unparseable timestamp as out_of_range', () => {
    const result = validateLocationPoints(
      [point({ recordedAt: new Date('not-a-date') })],
      THRESHOLDS,
      null,
      NOW,
    );
    expect(result.discarded).toEqual([{ index: 0, reason: 'out_of_range' }]);
  });

  it('judges a batch against its own accepted points, not just the store', () => {
    // The second point moves ~111 m in 2 s (~200 km/h: fast but under the
    // ceiling) and is kept; the third then jumps 55 km in 2 s, which is
    // implausible *relative to the point this very batch just accepted*.
    const result = validateLocationPoints(
      [
        point({ recordedAt: at(20) }),
        point({ latitude: shiftedLatitude(0.001), recordedAt: at(18) }),
        point({ latitude: shiftedLatitude(0.501), recordedAt: at(16) }),
      ],
      THRESHOLDS,
      null,
      NOW,
    );
    expect(result.accepted).toHaveLength(2);
    expect(result.discarded).toEqual([
      { index: 2, reason: 'implausible_speed' },
    ]);
  });
});
