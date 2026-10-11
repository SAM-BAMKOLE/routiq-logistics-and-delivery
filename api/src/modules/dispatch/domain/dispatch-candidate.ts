import type { DispatchCandidate } from './assignment.repository.js';
import type { AssignmentStrategy } from './dispatch-settings.js';

export type { DispatchCandidate };

/** A candidate flagged with whether it sits inside the radius pool. */
export interface RankedCandidate extends DispatchCandidate {
  readonly withinRadius: boolean;
}

/**
 * The radius step (metres) that yields at least one located candidate, or
 * null when no located driver is within the widest step. Unlocated drivers
 * are never part of the pool — there is nothing to measure — but the caller
 * still lists them after it, because a fleet without GPS data (tracking
 * lands in Step 10) must still be dispatchable.
 */
export function firstRadiusWithCandidates(
  candidates: readonly DispatchCandidate[],
  radiusStepsMeters: readonly number[],
): number | null {
  for (const step of radiusStepsMeters) {
    if (candidates.some((c) => c.distanceMeters !== null && c.distanceMeters <= step)) {
      return step;
    }
  }
  return null;
}

/**
 * Applies the radius: located drivers inside the chosen step stay in the
 * pool, everything else (located but far away, or unlocated) is dropped from
 * the pool but kept as an unlocated/far tail by the caller.
 */
export function withinRadiusPool(
  candidates: readonly DispatchCandidate[],
  stepMeters: number | null,
): Array<DispatchCandidate & { withinRadius: boolean }> {
  return candidates.map((candidate) => ({
    ...candidate,
    withinRadius:
      stepMeters !== null &&
      candidate.distanceMeters !== null &&
      candidate.distanceMeters <= stepMeters,
  }));
}

/**
 * Ranks candidates by the tenant's {@link AssignmentStrategy}. All three
 * strategies break ties by distance (unlocated last) and then driver id, so
 * the order is total and stable — two dispatchers asking the same question
 * get the same answer.
 *
 * - `nearest`: closest to the pickup first; the fast same-day answer.
 * - `least_loaded`: fewest live assignments first; balances work across the
 *   fleet, whatever the distance.
 * - `balanced`: a weighted sum of normalised distance, normalised load, and
 *   vehicle slack (how much spare capacity the suggestion has; a tight fit
 *   is a better fit). Lower scores win. The weights are phase-1 constants:
 *   distance dominates, capacity fit is the tiebreak flavour.
 */
export function rankCandidates(
  candidates: readonly (DispatchCandidate & { withinRadius?: boolean })[],
  strategy: AssignmentStrategy,
): RankedCandidate[] {
  const scored = candidates.map((candidate) => ({
    candidate,
    score: balancedScore(candidate, candidates),
  }));
  scored.sort((left, right) => {
    const a = left.candidate;
    const b = right.candidate;
    if (strategy === 'nearest') {
      return compareKeys(
        distanceKey(a),
        distanceKey(b),
        a,
        b,
      );
    }
    if (strategy === 'least_loaded') {
      if (a.activeAssignments !== b.activeAssignments) {
        return a.activeAssignments - b.activeAssignments;
      }
      return compareKeys(distanceKey(a), distanceKey(b), a, b);
    }
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    return compareKeys(distanceKey(a), distanceKey(b), a, b);
  });
  return scored.map((entry) => ({
    ...entry.candidate,
    withinRadius: entry.candidate.withinRadius ?? false,
  }));
}

/** Distance with unlocated drivers sorting last. */
function distanceKey(candidate: DispatchCandidate): number {
  return candidate.distanceMeters ?? Number.POSITIVE_INFINITY;
}

function compareKeys(
  a: number,
  b: number,
  left: DispatchCandidate,
  right: DispatchCandidate,
): number {
  if (a !== b) {
    return a - b;
  }
  return left.driverId < right.driverId ? -1 : left.driverId > right.driverId ? 1 : 0;
}

const BALANCED_WEIGHTS = { distance: 0.5, load: 0.3, slack: 0.2 } as const;

function balancedScore(
  candidate: DispatchCandidate,
  all: readonly DispatchCandidate[],
): number {
  const maxDistance = Math.max(
    1,
    ...all.map((other) => other.distanceMeters ?? 0),
  );
  const maxLoad = Math.max(1, ...all.map((other) => other.activeAssignments));
  // Unlocated candidates get the worst distance so load still separates them.
  const distance =
    candidate.distanceMeters === null ? 1 : candidate.distanceMeters / maxDistance;
  const load = candidate.activeAssignments / maxLoad;
  // Slack of 1 (or no suggested vehicle at all) is the worst fit; a vehicle
  // with no spare capacity is the best fit.
  const slack = candidate.capacitySlack ?? 1;
  return (
    BALANCED_WEIGHTS.distance * distance +
    BALANCED_WEIGHTS.load * load +
    BALANCED_WEIGHTS.slack * slack
  );
}
