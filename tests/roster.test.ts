import { describe, it, expect } from 'vitest';
import { allSpecies, speciesByRarity, getSpecies } from '../src/data/species/index.js';

const EXPECTED = { common: 8, uncommon: 7, rare: 6, epic: 4, legendary: 3, mythic: 2 } as const;

describe('roster', () => {
  it('has exactly 30 species with unique ids', () => {
    const all = allSpecies();
    expect(all).toHaveLength(30);
    expect(new Set(all.map((s) => s.id)).size).toBe(30);
  });
  it('matches the per-tier distribution', () => {
    for (const [rarity, n] of Object.entries(EXPECTED))
      expect(speciesByRarity(rarity as keyof typeof EXPECTED)).toHaveLength(n);
  });
  it('every species has non-empty biomeTags and a known diet', () => {
    for (const s of allSpecies()) {
      expect(s.biomeTags.length).toBeGreaterThan(0);
      expect(['herbivore', 'carnivore']).toContain(s.diet);
    }
  });
  it('getSpecies round-trips the seed species', () => {
    expect(getSpecies('tyrannosaurus').rarity).toBe('legendary');
    expect(getSpecies('indominus').rarity).toBe('mythic');
  });
});
