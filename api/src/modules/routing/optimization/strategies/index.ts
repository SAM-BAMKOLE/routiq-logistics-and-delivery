import { annealingStrategy } from './annealing.js';
import { nearestNeighborStrategy } from './nearest-neighbor.js';
import { savingsStrategy } from './savings.js';
import { savingsLocalSearchStrategy } from './savings-local-search.js';
import type {
  RoutingStrategy,
  RoutingStrategyName,
} from '../strategy.js';

/**
 * The strategy registry from the architecture doc: nearest neighbor as the
 * baseline, savings as construction, savings + local search, and annealing
 * as the default.
 */
const STRATEGIES: Record<RoutingStrategyName, RoutingStrategy> = {
  nearest_neighbor: nearestNeighborStrategy,
  savings: savingsStrategy,
  savings_local_search: savingsLocalSearchStrategy,
  annealing: annealingStrategy,
};

export function getStrategy(name: RoutingStrategyName): RoutingStrategy {
  return STRATEGIES[name];
}

export {
  annealingStrategy,
  nearestNeighborStrategy,
  savingsLocalSearchStrategy,
  savingsStrategy,
};
