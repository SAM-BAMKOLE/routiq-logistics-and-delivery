import {
  DEFAULT_DISPATCH_SETTINGS,
  dispatchSettingsFrom,
} from './dispatch-settings.js';

describe('dispatchSettingsFrom', () => {
  it('falls back to the defaults without a dispatch block', () => {
    expect(dispatchSettingsFrom({})).toEqual(DEFAULT_DISPATCH_SETTINGS);
    expect(dispatchSettingsFrom({ dispatch: 'nope' })).toEqual(
      DEFAULT_DISPATCH_SETTINGS,
    );
    expect(dispatchSettingsFrom({ dispatch: [] })).toEqual(
      DEFAULT_DISPATCH_SETTINGS,
    );
  });

  it('reads a valid block', () => {
    expect(
      dispatchSettingsFrom({
        dispatch: {
          strategy: 'least_loaded',
          offerTtlMinutes: 30,
          radiusStepsKm: [2, 8],
          maxCandidates: 5,
        },
      }),
    ).toEqual({
      strategy: 'least_loaded',
      offerTtlMinutes: 30,
      radiusStepsKm: [2, 8],
      maxCandidates: 5,
    });
  });

  it('sorts and caps the radius steps, and clamps the candidate cap', () => {
    const settings = dispatchSettingsFrom({
      dispatch: {
        radiusStepsKm: [30, 5, 10, 15, 20, 25, 40, 50],
        maxCandidates: 500,
      },
    });
    expect(settings.radiusStepsKm).toEqual([5, 10, 15, 20, 25, 30]);
    expect(settings.maxCandidates).toBe(50);
  });

  it('drops invalid fields one by one', () => {
    const settings = dispatchSettingsFrom({
      dispatch: {
        strategy: 'fastest',
        offerTtlMinutes: -1,
        radiusStepsKm: [0, -5],
        maxCandidates: 0,
      },
    });
    expect(settings).toEqual(DEFAULT_DISPATCH_SETTINGS);
  });

  it('accepts a zero TTL (an offer that expires immediately)', () => {
    expect(
      dispatchSettingsFrom({ dispatch: { offerTtlMinutes: 0 } }).offerTtlMinutes,
    ).toBe(0);
  });
});
