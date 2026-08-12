import { describe, it, expect } from 'vitest';
import { allSpecies, speciesByRarity, getSpecies } from '../src/data/species/index.js';
import { DECOR, ENRICHMENT_CAP_KINDS, enrichingKindsFor } from '../src/data/decor.js';

const EXPECTED = { common: 8, uncommon: 9, rare: 9, epic: 8, legendary: 5, mythic: 3 } as const;

describe('roster', () => {
  it('has exactly 42 species with unique ids', () => {
    const all = allSpecies();
    expect(all).toHaveLength(42);
    expect(new Set(all.map((s) => s.id)).size).toBe(42);
  });
  // REGISTRY is a Map, so a duplicated id is deduped for getSpecies and allSpecies but
  // NOT for speciesByRarity, which filters the raw ALL array. That split ships a dino
  // whose rolled identity and resolved identity are different objects, with no error
  // anywhere. ALL is module-private; summing the tiers reads it, allSpecies reads the Map.
  it('registers every species exactly once — the per-tier pools and the registry agree', () => {
    const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
    const pooled = tiers.reduce((n, r) => n + speciesByRarity(r).length, 0);
    expect(pooled).toBe(allSpecies().length);
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
  it('every species declares a valid archetype; commons span at least 3 archetypes', () => {
    const VALID = ['bruiser', 'tank', 'swift', 'support'];
    for (const s of allSpecies()) expect(VALID).toContain(s.archetype);
    const commonArchetypes = new Set(speciesByRarity('common').map((s) => s.archetype));
    expect(commonArchetypes.size).toBeGreaterThanOrEqual(3);
  });
  it('getSpecies round-trips the seed species', () => {
    expect(getSpecies('tyrannosaurus').rarity).toBe('legendary');
    expect(getSpecies('indominus').rarity).toBe('mythic');
  });
});

describe('biome vocabulary', () => {
  // paddockFit (src/core/clock.ts:47) reaches 1.0 only when a decor kind on the lot
  // shares a biomeTag with the species, so a species carrying a tag no decor offers
  // is capped at 0.75 comfort forever — and a typo ('Marine' for 'marine') ships
  // exactly that with every other test still green.
  it('every species can reach the enrichment cap', () => {
    for (const s of allSpecies()) {
      expect(
        enrichingKindsFor(s).length,
        `${s.id} (biomes ${s.biomeTags.join(',')}) can only ever match ${enrichingKindsFor(s).length} decor kinds`,
      ).toBeGreaterThanOrEqual(ENRICHMENT_CAP_KINDS);
    }
  });
  it('every biome tag any species wants is offered by at least the cap in distinct kinds', () => {
    const wanted = new Set(allSpecies().flatMap((s) => s.biomeTags));
    for (const tag of wanted) {
      const kinds = Object.values(DECOR).filter((d) => d.biomeTags.includes(tag));
      expect(kinds.length, `biome '${tag}' is offered by only ${kinds.length} kinds`)
        .toBeGreaterThanOrEqual(ENRICHMENT_CAP_KINDS);
    }
  });
});
