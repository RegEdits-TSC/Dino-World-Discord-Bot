import { describe, it, expect } from 'vitest';
import { ENRICHMENT_CAP_KINDS, ENRICHMENT_STEPS, enrichingKindsFor, matchedKindCount, enrichmentMult } from '../src/data/decor.js';
import { triceratops } from '../src/data/species/triceratops.js';
import { allSpecies } from '../src/data/species/index.js';

describe('enrichmentMult', () => {
  it('is 1.0 at zero or one matching kind, then steps once per extra kind', () => {
    expect(enrichmentMult(0)).toBe(1.0);
    expect(enrichmentMult(1)).toBe(1.0);
    expect(enrichmentMult(2)).toBe(1.05);
    expect(enrichmentMult(3)).toBe(1.1);
  });
  it('clamps above the cap instead of reading past the table', () => {
    expect(enrichmentMult(ENRICHMENT_CAP_KINDS + 5)).toBe(1.1);
  });
  // Past fit 1.5 escapeAt outruns hungerZero (12/fit < 8) and a dino earns nothing
  // while its 8h grace runs. Nothing else in the codebase guards that cliff.
  it('never reaches the 1.5 escape cliff', () => {
    for (const step of ENRICHMENT_STEPS) expect(step).toBeLessThan(1.5);
  });
  it('has exactly one step per reachable kind count', () => {
    expect(ENRICHMENT_STEPS).toHaveLength(ENRICHMENT_CAP_KINDS);
  });
});

describe('matchedKindCount', () => {
  it('counts two different kinds sharing one biome tag as two', () => {
    // palm_tree and fern both carry 'forest', which triceratops wants.
    expect(matchedKindCount(triceratops, ['palm_tree', 'fern'])).toBe(2);
  });
  it('dedupes repeated slugs — decorateLot appends without dedupe', () => {
    expect(matchedKindCount(triceratops, ['palm_tree', 'palm_tree', 'palm_tree'])).toBe(1);
  });
  it('ignores unknown slugs and non-matching kinds', () => {
    expect(matchedKindCount(triceratops, ['some_retired_decor', 'ice_block', 'palm_tree'])).toBe(1);
  });
  it('is 0 for an empty paddock', () => {
    expect(matchedKindCount(triceratops, [])).toBe(0);
  });
});

describe('enrichingKindsFor', () => {
  it('returns every kind whose biomeTags intersect the species', () => {
    const kinds = enrichingKindsFor(triceratops);
    expect(kinds).toContain('palm_tree');
    expect(kinds).toContain('fern');
    expect(kinds).not.toContain('ice_block');
  });
  it('never returns duplicates, for any species', () => {
    for (const s of allSpecies()) {
      const kinds = enrichingKindsFor(s);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });
});
