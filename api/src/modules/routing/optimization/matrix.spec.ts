import {
  EuclideanMatrixProvider,
  HaversineMatrixProvider,
  haversineMeters,
} from './matrix.js';

describe('haversineMeters', () => {
  it('measures one degree of latitude as ~111.2 km', () => {
    const meters = haversineMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );
    expect(meters).toBeGreaterThan(111_000);
    expect(meters).toBeLessThan(111_400);
  });

  it('is zero for identical points and symmetric otherwise', () => {
    const a = { latitude: 52.52, longitude: 13.405 };
    const b = { latitude: 48.8566, longitude: 2.3522 };
    expect(haversineMeters(a, a)).toBe(0);
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('HaversineMatrixProvider', () => {
  it('scales by the circuity factor and converts to time at avg speed', () => {
    const provider = new HaversineMatrixProvider({
      circuityFactor: 1.3,
      averageSpeedKmh: 36, // 10 m/s
    });
    const matrix = provider.build([
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0 }, // ~111.2 m straight line
    ]);
    const straight = haversineMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0 },
    );
    expect(matrix.distanceMeters(0, 1)).toBeCloseTo(straight * 1.3, 3);
    expect(matrix.durationSeconds(0, 1)).toBeCloseTo(
      (straight * 1.3) / 10,
      6,
    );
    expect(matrix.distanceMeters(0, 0)).toBe(0);
    expect(matrix.distanceMeters(1, 0)).toBe(matrix.distanceMeters(0, 1));
    expect(matrix.size).toBe(2);
  });

  it('caches repeated coordinate pairs across builds', () => {
    const provider = new HaversineMatrixProvider({
      circuityFactor: 1,
      averageSpeedKmh: 30,
    });
    const first = provider.build([
      { latitude: 10, longitude: 10 },
      { latitude: 10.5, longitude: 10.5 },
    ]);
    const second = provider.build([
      { latitude: 10.5, longitude: 10.5 },
      { latitude: 10, longitude: 10 },
    ]);
    expect(second.distanceMeters(0, 1)).toBe(first.distanceMeters(1, 0));
  });
});

describe('EuclideanMatrixProvider', () => {
  it('measures planar distance in coordinate units', () => {
    const matrix = new EuclideanMatrixProvider(1).build([
      { latitude: 0, longitude: 0 },
      { latitude: 3, longitude: 4 },
    ]);
    expect(matrix.distanceMeters(0, 1)).toBe(5);
    expect(matrix.durationSeconds(0, 1)).toBe(5); // 1 unit/second
  });
});
