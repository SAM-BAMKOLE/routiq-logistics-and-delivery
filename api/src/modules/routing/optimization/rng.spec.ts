import { createRng, parseSeed } from './rng.js';

describe('seeded RNG (mulberry32)', () => {
  it('replays the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const sequenceA = Array.from({ length: 20 }, () => a.next());
    const sequenceB = Array.from({ length: 20 }, () => b.next());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const sequenceA = Array.from({ length: 5 }, () => a.next());
    const sequenceB = Array.from({ length: 5 }, () => b.next());
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it('stays inside [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1_000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() covers the inclusive bounds', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([3, 4, 5, 6]);
  });

  it('shuffle is a permutation and preserves determinism', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(createRng(5).shuffle(items)).toEqual(createRng(5).shuffle(items));
    expect([...createRng(5).shuffle(items)].sort((a, b) => a - b)).toEqual(
      items,
    );
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // input untouched
  });
});

describe('parseSeed', () => {
  it('uses numeric seeds directly', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('0')).toBe(0);
  });

  it('hashes textual seeds deterministically into 32 bits', () => {
    const first = parseSeed('seed-7');
    expect(first).toBe(parseSeed('seed-7'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(0xffffffff);
    expect(parseSeed('seed-7')).not.toBe(parseSeed('seed-8'));
  });
});
