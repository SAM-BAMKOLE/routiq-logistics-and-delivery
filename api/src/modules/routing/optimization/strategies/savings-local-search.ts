import {
  assembleSolution,
  draftsFromSolution,
  type RouteDraft,
} from '../assemble.js';
import { improve } from '../local-search.js';
import type { RoutingProblem } from '../problem.js';
import type { RoutingSolution, SolveOptions } from '../solution.js';
import type { RoutingStrategy } from '../strategy.js';
import { savingsStrategy } from './savings.js';

/**
 * Clarke-Wright construction followed by local search (architecture step 4
 * wired after step 3). The local search receives half the iteration budget;
 * the annealing strategy splits the rest between its own phases.
 */
export const savingsLocalSearchStrategy: RoutingStrategy = {
  name: 'savings_local_search',
  solve(problem: RoutingProblem, options: SolveOptions): RoutingSolution {
    const constructed = savingsStrategy.solve(problem, options);
    const drafts: RouteDraft[] = draftsFromSolution(problem, constructed);
    const improved = improve(problem, drafts, {
      maxIterations: Math.max(1, Math.floor(options.maxIterations / 2)),
    });
    return assembleSolution(
      problem,
      improved,
      constructed.unassigned,
      options.weights,
    );
  },
};
