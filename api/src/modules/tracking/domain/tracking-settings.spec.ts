import {
  DEFAULT_TRACKING_SETTINGS,
  trackingSettingsFrom,
} from './tracking-settings.js';

describe('trackingSettingsFrom', () => {
  it('falls back to the defaults when the block is missing', () => {
    expect(trackingSettingsFrom({})).toEqual(DEFAULT_TRACKING_SETTINGS);
    expect(trackingSettingsFrom({ tracking: null })).toEqual(
      DEFAULT_TRACKING_SETTINGS,
    );
    expect(trackingSettingsFrom({ tracking: 'nonsense' })).toEqual(
      DEFAULT_TRACKING_SETTINGS,
    );
  });

  it('reads a fully populated block', () => {
    const settings = trackingSettingsFrom({
      tracking: {
        retentionDays: 90,
        maxPointAgeSeconds: 600,
        minDistanceMeters: 50,
        minIntervalSeconds: 30,
        maxSpeedKmh: 120,
        geofenceRadiusMeters: 400,
      },
    });
    expect(settings).toEqual({
      retentionDays: 90,
      maxPointAgeSeconds: 600,
      minDistanceMeters: 50,
      minIntervalSeconds: 30,
      maxSpeedKmh: 120,
      geofenceRadiusMeters: 400,
    });
  });

  it('clamps hostile numbers into the safe band', () => {
    const settings = trackingSettingsFrom({
      tracking: {
        retentionDays: 10_000,
        maxPointAgeSeconds: -5,
        minDistanceMeters: 0,
        minIntervalSeconds: 1e9,
        maxSpeedKmh: 90_000,
        geofenceRadiusMeters: 1,
      },
    });
    expect(settings.retentionDays).toBe(365);
    expect(settings.maxPointAgeSeconds).toBe(30);
    expect(settings.minDistanceMeters).toBe(1);
    expect(settings.minIntervalSeconds).toBe(3_600);
    expect(settings.maxSpeedKmh).toBe(500);
    expect(settings.geofenceRadiusMeters).toBe(50);
  });

  it('ignores non-numeric values per key', () => {
    const settings = trackingSettingsFrom({
      tracking: {
        retentionDays: 'soon',
        maxPointAgeSeconds: Number.NaN,
        minDistanceMeters: null,
        minIntervalSeconds: undefined,
        maxSpeedKmh: 100,
        geofenceRadiusMeters: 300,
      },
    });
    expect(settings.retentionDays).toBe(
      DEFAULT_TRACKING_SETTINGS.retentionDays,
    );
    expect(settings.maxPointAgeSeconds).toBe(
      DEFAULT_TRACKING_SETTINGS.maxPointAgeSeconds,
    );
    expect(settings.minDistanceMeters).toBe(
      DEFAULT_TRACKING_SETTINGS.minDistanceMeters,
    );
    expect(settings.minIntervalSeconds).toBe(
      DEFAULT_TRACKING_SETTINGS.minIntervalSeconds,
    );
    expect(settings.maxSpeedKmh).toBe(100);
    expect(settings.geofenceRadiusMeters).toBe(300);
  });
});
