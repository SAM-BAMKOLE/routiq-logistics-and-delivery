import { haversineMeters } from './geo.js';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(
      haversineMeters({ latitude: 6.5244, longitude: 3.3792 }, { latitude: 6.5244, longitude: 3.3792 }),
    ).toBe(0);
  });

  it('measures one degree of latitude as about 111.2 km', () => {
    const meters = haversineMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );
    expect(meters).toBeCloseTo(111_195, 0);
  });

  it('shrinks longitude degrees toward the poles', () => {
    const equator = haversineMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    const high = haversineMeters(
      { latitude: 60, longitude: 0 },
      { latitude: 60, longitude: 1 },
    );
    expect(high).toBeCloseTo(equator / 2, -2);
  });

  it('lands within a sane band for the Lagos to Abuja crow flight', () => {
    const meters = haversineMeters(
      { latitude: 6.5244, longitude: 3.3792 },
      { latitude: 9.0579, longitude: 7.4951 },
    );
    expect(meters).toBeGreaterThan(520_000);
    expect(meters).toBeLessThan(545_000);
  });
});
