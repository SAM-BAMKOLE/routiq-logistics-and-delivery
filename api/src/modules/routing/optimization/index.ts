/**
 * The route optimizer: a plain-TypeScript package with no framework
 * imports (architecture principle "Pure algorithms"), so it stays
 * deterministic, testable in isolation, and benchmarkable from a script.
 */
export * from './assemble.js';
export * from './feasibility.js';
export * from './local-search.js';
export * from './matrix.js';
export * from './problem.js';
export * from './rng.js';
export * from './solution.js';
export * from './strategy.js';
export * from './strategies/index.js';
