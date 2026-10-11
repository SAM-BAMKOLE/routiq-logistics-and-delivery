import type { DispatchCandidate } from './assignment.repository.js';
import {
  firstRadiusWithCandidates,
  rankCandidates,
  withinRadiusPool,
} from './dispatch-candidate.js';

function candidate(
  driverId: string,
  overrides: Partial<DispatchCandidate> = {},
): DispatchCandidate {
  return {
    driverId,
    membershipId: `m-${driverId}`,
    vehicleId: 'v-1',
    distanceMeters: 1_000,
    activeAssignments: 0,
    capacitySlack: 0.5,
    ...overrides,
  };
}

describe('radius widening', () => {
  const pool = [
    candidate('far', { distanceMeters: 12_000 }),
    candidate('near', { distanceMeters: 3_000 }),
    candidate('unlocated', { distanceMeters: null }),
  ];

  it('takes the first step that yields a located candidate', () => {
    expect(firstRadiusWithCandidates(pool, [5_000, 10_000, 20_000])).toBe(5_000);
    expect(firstRadiusWithCandidates(pool, [1_000, 10_000])).toBe(10_000);
  });

  it('answers null when nothing located fits the widest step', () => {
    expect(firstRadiusWithCandidates(pool, [500, 1_000])).toBeNull();
    expect(
      firstRadiusWithCandidates([candidate('a', { distanceMeters: null })], [20_000]),
    ).toBeNull();
  });

  it('flags in-pool candidates and leaves far or unlocated ones out', () => {
    const flagged = withinRadiusPool(pool, 5_000);
    expect(flagged.find((c) => c.driverId === 'near')?.withinRadius).toBe(true);
    expect(flagged.find((c) => c.driverId === 'far')?.withinRadius).toBe(false);
    expect(flagged.find((c) => c.driverId === 'unlocated')?.withinRadius).toBe(false);
  });
});

describe('rankCandidates', () => {
  const mixed = [
    candidate('slow-and-close', { distanceMeters: 2_000, activeAssignments: 3, capacitySlack: 0.2 }),
    candidate('fast-and-far', { distanceMeters: 9_000, activeAssignments: 0, capacitySlack: 0.8 }),
    candidate('medium', { distanceMeters: 5_000, activeAssignments: 1, capacitySlack: 0.5 }),
    candidate('unlocated', { distanceMeters: null, vehicleId: null, capacitySlack: null }),
  ];

  it('nearest orders by distance, unlocated last, ties by driver id', () => {
    const ranked = rankCandidates(mixed, 'nearest');
    expect(ranked.map((c) => c.driverId)).toEqual([
      'slow-and-close',
      'medium',
      'fast-and-far',
      'unlocated',
    ]);

    const ties = rankCandidates(
      [candidate('b', { distanceMeters: 1_000 }), candidate('a', { distanceMeters: 1_000 })],
      'nearest',
    );
    expect(ties.map((c) => c.driverId)).toEqual(['a', 'b']);
  });

  it('least_loaded orders by load first, distance only as a tiebreak', () => {
    const ranked = rankCandidates(mixed, 'least_loaded');
    // Loads: fast-and-far 0, unlocated 0 (ties lose on distance), medium 1,
    // slow-and-close 3.
    expect(ranked.map((c) => c.driverId)).toEqual([
      'fast-and-far',
      'unlocated',
      'medium',
      'slow-and-close',
    ]);
  });

  it('balanced blends distance and load; a closer, tighter fit can win', () => {
    const ranked = rankCandidates(mixed, 'balanced');
    // fast-and-far: distance 1.0, load 0, slack 0.8 -> 0.5+0+0.16 = 0.66
    // slow-and-close: distance ~0.22, load 1.0, slack 0.2 -> 0.11+0.3+0.04 = 0.45
    expect(ranked[0].driverId).toBe('slow-and-close');
    expect(ranked.at(-1)?.driverId).toBe('unlocated');
  });

  it('is total and stable: equal inputs give equal outputs', () => {
    const a = rankCandidates(mixed, 'balanced').map((c) => c.driverId);
    const b = rankCandidates([...mixed].reverse(), 'balanced').map((c) => c.driverId);
    expect(a).toEqual(b);
  });
});
