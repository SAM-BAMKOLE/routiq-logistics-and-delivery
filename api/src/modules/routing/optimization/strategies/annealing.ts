import {
  assembleSolution,
  draftsFromSolution,
  type RouteDraft,
} from '../assemble.js';
import { evaluateRoute } from '../feasibility.js';
import { improve } from '../local-search.js';
import type { RoutingProblem } from '../problem.js';
import { createRng, type Rng } from '../rng.js';
import type { RoutingSolution, SolveOptions } from '../solution.js';
import type { RoutingStrategy } from '../strategy.js';
import { savingsStrategy } from './savings.js';

/**
 * The default strategy (architecture step 5): Clarke-Wright construction,
 * local search, then simulated annealing that keeps walking out of local
 * optima until the iteration budget runs out. Every random choice — move
 * selection and acceptance — comes from the seeded generator, and the loop
 * is iteration-bounded, so the same seed replays the same run.
 *
 * The time budget is a safety net only: on hosts too slow to finish the
 * iteration budget the run truncates, trading a little determinism for a
 * bounded request.
 */
const COOLING = 0.997;
const MAX_STALENESS_FACTOR = 5;
const TEMPERATURE_SAMPLES = 30;

export const annealingStrategy: RoutingStrategy = {
  name: 'annealing',
  solve(problem: RoutingProblem, options: SolveOptions): RoutingSolution {
    const rng = createRng(options.seed);
    const startedAt = Date.now();
    const halfBudget = Math.max(1, Math.floor(options.maxIterations / 2));
    const annealBudget = Math.max(1, options.maxIterations - halfBudget);
    const deadlineMs = startedAt + options.timeBudgetMs;

    // Warm start: construction plus local search.
    const constructed = savingsStrategy.solve(problem, options);
    const warmed = improve(problem, draftsFromSolution(problem, constructed), {
      maxIterations: halfBudget,
      deadlineMs: startedAt + Math.floor(options.timeBudgetMs / 2),
    });

    let current = warmed;
    let currentCost = objectiveOf(problem, current, options);
    let best = current;
    let bestCost = currentCost;

    // Seed the temperature from the scale of moves actually available, so
    // the schedule adapts to the instance instead of guessing a constant.
    const scale = sampleMoveScale(problem, current, options, rng);
    let temperature = Math.max(scale, 1e-6);
    const maxStale = Math.ceil(annealBudget / MAX_STALENESS_FACTOR);
    let stale = 0;

    for (let iteration = 0; iteration < annealBudget; iteration += 1) {
      if (Date.now() > deadlineMs) {
        break;
      }
      const neighbor = randomNeighbor(problem, current, rng);
      if (!neighbor) {
        continue; // infeasible or unmovable proposal: skip, cool on
      }
      const cost = objectiveOf(problem, neighbor, options);
      const delta = cost - currentCost;
      if (delta <= 0 || rng.next() < Math.exp(-delta / temperature)) {
        current = neighbor;
        currentCost = cost;
        if (cost < bestCost) {
          best = current;
          bestCost = cost;
          stale = 0;
        } else {
          stale += 1;
        }
      } else {
        stale += 1;
      }
      temperature *= COOLING;
      if (stale >= maxStale) {
        break; // cooled into stagnation: the schedule has done its work
      }
    }

    return assembleSolution(problem, best, constructed.unassigned, options.weights);
  },
};

function objectiveOf(
  problem: RoutingProblem,
  drafts: readonly RouteDraft[],
  options: SolveOptions,
): number {
  // Unassigned is constant across neighbors (annealing only rearranges), so
  // the comparable cost is distance + vehicle count under the tenant weights.
  const solution = assembleSolution(problem, drafts, [], options.weights);
  return (
    options.weights.distance * solution.totalDistanceMeters +
    options.weights.vehicles * solution.usedVehicles
  );
}

function sampleMoveScale(
  problem: RoutingProblem,
  drafts: readonly RouteDraft[],
  options: SolveOptions,
  rng: Rng,
): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < TEMPERATURE_SAMPLES; i += 1) {
    const neighbor = randomNeighbor(problem, drafts, rng);
    if (!neighbor) {
      continue;
    }
    total += Math.abs(
      objectiveOf(problem, neighbor, options) -
        objectiveOf(problem, drafts, options),
    );
    count += 1;
  }
  return count === 0 ? 1 : (total / count) * 2;
}

/**
 * One random neighbor: relocate, 2-opt, Or-opt, swap, or 2-opt*, with the
 * affected routes re-checked for feasibility. Returns null when the proposal
 * is infeasible — the caller simply rejects it.
 */
function randomNeighbor(
  problem: RoutingProblem,
  drafts: readonly RouteDraft[],
  rng: Rng,
): RouteDraft[] | null {
  const nonEmpty = drafts
    .map((draft, index) => ({ draft, index }))
    .filter((entry) => entry.draft.stopIndexes.length > 0);
  if (nonEmpty.length === 0) {
    return null;
  }

  const kind = rng.int(0, 4);
  const from = rng.pick(nonEmpty);
  const to = nonEmpty.length > 1 ? rng.pick(nonEmpty) : from;
  const stops = [...from.draft.stopIndexes];

  const replace = (
    fromStops: number[],
    toStops: number[] | null,
    fromIndex: number,
    toIndex: number | null,
  ): RouteDraft[] | null => {
    const vehicleFrom = problem.vehicles.find(
      (v) => v.id === drafts[fromIndex].vehicleId,
    );
    if (!vehicleFrom) {
      return null;
    }
    const next = [...drafts];
    if (!evaluateRoute(problem, vehicleFrom, fromStops).feasible) {
      return null;
    }
    next[fromIndex] = { ...drafts[fromIndex], stopIndexes: fromStops };
    if (toIndex !== null && toStops !== null) {
      const vehicleTo = problem.vehicles.find(
        (v) => v.id === drafts[toIndex].vehicleId,
      );
      if (!vehicleTo) {
        return null;
      }
      if (!evaluateRoute(problem, vehicleTo, toStops).feasible) {
        return null;
      }
      next[toIndex] = { ...drafts[toIndex], stopIndexes: toStops };
    }
    return next;
  };

  if (kind === 0) {
    // Relocate one stop: within the same route, or into the other route.
    const position = rng.int(0, stops.length - 1);
    const rest = [...stops.slice(0, position), ...stops.slice(position + 1)];
    if (from.index === to.index) {
      const target = rng.int(0, rest.length);
      return replace(
        [
          ...rest.slice(0, target),
          stops[position],
          ...rest.slice(target),
        ],
        null,
        from.index,
        null,
      );
    }
    const target = rng.int(0, to.draft.stopIndexes.length);
    return replace(
      rest,
      [
        ...to.draft.stopIndexes.slice(0, target),
        stops[position],
        ...to.draft.stopIndexes.slice(target),
      ],
      from.index,
      to.index,
    );
  }
  if (kind === 1 && stops.length >= 2) {
    // 2-opt: reverse a random segment.
    const start = rng.int(0, stops.length - 2);
    const end = rng.int(start + 1, stops.length - 1);
    return replace(
      [
        ...stops.slice(0, start),
        ...stops.slice(start, end + 1).reverse(),
        ...stops.slice(end + 1),
      ],
      null,
      from.index,
      null,
    );
  }
  if (kind === 2 && stops.length >= 2) {
    // Or-opt: move a short segment elsewhere in the same route.
    const length = rng.int(1, Math.min(3, stops.length - 1));
    const fromPosition = rng.int(0, stops.length - length);
    const segment = stops.slice(fromPosition, fromPosition + length);
    const rest = [
      ...stops.slice(0, fromPosition),
      ...stops.slice(fromPosition + length),
    ];
    const toPosition = rng.int(0, rest.length);
    const oriented = rng.next() < 0.5 ? segment : [...segment].reverse();
    return replace(
      [...rest.slice(0, toPosition), ...oriented, ...rest.slice(toPosition)],
      null,
      from.index,
      null,
    );
  }
  if (kind === 3 && from.index !== to.index && to.draft.stopIndexes.length > 0) {
    // Swap one stop of each route.
    const a = rng.int(0, stops.length - 1);
    const b = rng.int(0, to.draft.stopIndexes.length - 1);
    const stopsA = [...stops];
    const stopsB = [...to.draft.stopIndexes];
    [stopsA[a], stopsB[b]] = [stopsB[b], stopsA[a]];
    return replace(stopsA, stopsB, from.index, to.index);
  }
  if (from.index !== to.index && to.draft.stopIndexes.length > 0) {
    // 2-opt*: exchange route tails.
    const a = rng.int(0, stops.length - 1);
    const b = rng.int(0, to.draft.stopIndexes.length - 1);
    return replace(
      [...stops.slice(0, a + 1), ...to.draft.stopIndexes.slice(b + 1)],
      [...to.draft.stopIndexes.slice(0, b + 1), ...stops.slice(a + 1)],
      from.index,
      to.index,
    );
  }
  return null;
}
