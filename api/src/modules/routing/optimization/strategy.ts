import type { RoutingProblem } from './problem.js';
import type { RoutingSolution, SolveOptions } from './solution.js';

/**
 * A solving strategy, per the architecture's interface. Strategies are pure:
 * same problem + same options (seed included) give the same solution, on any
 * machine. The iteration limits in `SolveOptions` are the deterministic
 * stopping rule; `timeBudgetMs` is only a safety net for slow hosts.
 */
export interface RoutingStrategy {
  readonly name: string;
  solve(problem: RoutingProblem, options: SolveOptions): RoutingSolution;
}

export const ROUTING_STRATEGIES = [
  'nearest_neighbor',
  'savings',
  'savings_local_search',
  'annealing',
] as const;
export type RoutingStrategyName = (typeof ROUTING_STRATEGIES)[number];

export function isRoutingStrategyName(
  value: unknown,
): value is RoutingStrategyName {
  return (
    typeof value === 'string' &&
    (ROUTING_STRATEGIES as readonly string[]).includes(value)
  );
}
