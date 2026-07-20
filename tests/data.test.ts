import { describe, it, expect } from 'vitest';
import { RARITY } from '../src/data/rarity.js';
import { getSpecies, allSpecies } from '../src/data/species/index.js';
import { FACILITIES } from '../src/data/facilities.js';

describe('game data', () => {
  it('every species has a valid rarity entry', () => {
    for (const s of allSpecies()) expect(RARITY[s.rarity]).toBeDefined();
  });
  it('getSpecies throws on unknown id', () => {
    expect(() => getSpecies('barney')).toThrow(/Unknown species/);
  });
  it('facility arrays match maxLevel', () => {
    for (const f of Object.values(FACILITIES)) {
      expect(f.incomeBonusPct).toHaveLength(f.maxLevel);
      expect(f.upgradeCosts).toHaveLength(f.maxLevel - 1);
    }
  });
});
