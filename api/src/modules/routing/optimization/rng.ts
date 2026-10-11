/**
 * Seeded pseudo-random number generator for the optimizer: mulberry32.
 *
 * Small, fast, and — the property that matters here — identical across
 * machines and Node versions, so a benchmark run or a failing test can be
 * replayed exactly from its seed. Never use `Math.random()` in the routing
 * package; every stochastic choice flows through an injected {@link Rng}.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle (returns a new array). */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  // Uint32 coercion keeps the state well-defined for any numeric seed.
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

/** Parses a textual seed ("42", "seed-7") into a 32-bit integer seed. */
export function parseSeed(seed: string): number {
  const numeric = Number(seed);
  if (Number.isFinite(numeric)) {
    return numeric >>> 0;
  }
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
