import { describe, it, expect } from 'vitest';
import { rollWeighted, rollRarityFromOdds, rollSpeciesInRarity, rollSellShards, rollIntInclusive, mulberry32, shuffle, hashSeed } from '../src/core/rolls.js';

describe('rolls', () => {
  it('rollWeighted respects cumulative weights at boundaries', () => {
    const e = [{ value: 'a', weight: 70 }, { value: 'b', weight: 30 }];
    expect(rollWeighted(e, () => 0)).toBe('a');
    expect(rollWeighted(e, () => 0.699)).toBe('a');
    expect(rollWeighted(e, () => 0.701)).toBe('b');
    expect(rollWeighted(e, () => 0.999)).toBe('b');
  });
  it('rollIntInclusive covers both ends', () => {
    expect(rollIntInclusive(1, 3, () => 0)).toBe(1);
    expect(rollIntInclusive(1, 3, () => 0.999)).toBe(3);
  });
  it('rollSellShards stays within the rarity band', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const n = rollSellShards('rare', rng);   // band [8,15]
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(15);
    }
  });
  it('rollRarityFromOdds only returns listed rarities; rollSpeciesInRarity stays in-tier', () => {
    const odds = [{ rarity: 'rare' as const, weight: 40 }, { rarity: 'epic' as const, weight: 60 }];
    expect(['rare', 'epic']).toContain(rollRarityFromOdds(odds, () => 0.5));
    expect(rollSpeciesInRarity('mythic', () => 0).rarity).toBe('mythic');
  });
});

describe('shuffle', () => {
  it('returns a new array and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, mulberry32(7));
    expect(out).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('is deterministic for a given seed', () => {
    expect(shuffle([1, 2, 3, 4, 5], mulberry32(7)))
      .toEqual(shuffle([1, 2, 3, 4, 5], mulberry32(7)));
  });

  // A comparator shuffle (`sort(() => rng() - 0.5)`) is measurably biased: it
  // leaves elements near their starting index far more often than 1/n. This is
  // the property the shop's old implementation failed, and it is why this test
  // lives here rather than being inferred from the daily-quest suite.
  it('is unbiased — every element reaches every position at roughly 1/n', () => {
    const N = 5;
    const TRIALS = 60_000;
    const counts = Array.from({ length: N }, () => new Array(N).fill(0));
    const rng = mulberry32(12345);
    for (let t = 0; t < TRIALS; t++) {
      const out = shuffle([0, 1, 2, 3, 4], rng);
      out.forEach((value, pos) => { counts[value][pos]++; });
    }
    const expected = TRIALS / N;
    for (let value = 0; value < N; value++) {
      for (let pos = 0; pos < N; pos++) {
        // ±6% tolerance: comfortably inside sampling noise at 60k trials, and
        // comfortably outside the >20% skew a comparator shuffle produces.
        expect(Math.abs(counts[value][pos] - expected) / expected,
          `value ${value} at position ${pos}`).toBeLessThan(0.06);
      }
    }
  });
});

describe('hashSeed', () => {
  // Pinned BEFORE the function moved out of daily/service.ts, and measured from
  // that implementation rather than computed independently. rollDailyQuests
  // derives every player's daily board from this hash, so a changed value would
  // silently reroll boards in flight with nothing failing.
  it.each([
    ['', 2166136261],
    ['a', 3826002220],
    ['eggs:common:42', 2668734150],
    ['123456789012345678:2026-08-26', 2511531462],
    ['hatch:common-crack:42', 1946910649],
  ])('hashes %j to a pinned value', (input, expected) => {
    expect(hashSeed(input)).toBe(expected);
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['x', 'a longer string', 'banners:daily:99']) {
      const h = hashSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
