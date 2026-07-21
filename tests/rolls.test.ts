import { describe, it, expect } from 'vitest';
import { rollWeighted, rollRarityFromOdds, rollSpeciesInRarity, rollSellShards, rollIntInclusive } from '../src/core/rolls.js';
import { mulberry32 } from './harness.js';

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
