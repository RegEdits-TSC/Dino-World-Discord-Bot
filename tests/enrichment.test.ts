import { describe, it, expect } from 'vitest';
import { ENRICHMENT_CAP_KINDS, ENRICHMENT_STEPS, enrichingKindsFor, matchedKindCount, enrichmentMult } from '../src/data/decor.js';
import { triceratops } from '../src/data/species/triceratops.js';
import { allSpecies } from '../src/data/species/index.js';
import { paddockFit, paddockFitBase, comfortAt, baseComfortAt, enrichmentAt } from '../src/core/clock.js';
import { PADDOCKS } from '../src/data/paddocks.js';

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

const herb = PADDOCKS.herbivore_paddock;
const carn = PADDOCKS.carnivore_paddock;
const dino = (decor: string[], over: Record<string, unknown> = {}) => ({
  species: triceratops, paddock: herb, decor,
  hungerAtFed: 100, lastFedAt: 0, escapedAt: null as number | null, traits: [] as string[], ...over,
});

describe('paddockFit with enrichment', () => {
  // THE BOUNDARY. One matching tile must stay exactly 1.0: tests/clock.test.ts,
  // tests/tundra.test.ts and tests/dinos.test.ts all pin that value, and it is the
  // reason no existing income or escape integer moves.
  it('is unchanged at zero and one matching kind', () => {
    expect(paddockFit(triceratops, herb, [])).toBe(0.75);
    expect(paddockFit(triceratops, herb, ['palm_tree'])).toBe(1.0);
    expect(paddockFit(triceratops, herb, ['palm_tree', 'palm_tree'])).toBe(1.0);
  });
  it('steps above 1.0 at two and three matching kinds', () => {
    expect(paddockFit(triceratops, herb, ['palm_tree', 'fern'])).toBe(1.05);
    expect(paddockFit(triceratops, herb, ['palm_tree', 'fern', 'cycad_grove'])).toBe(1.1);
  });
  it('a wrong-diet paddock stays 0.5 however enriched', () => {
    expect(paddockFit(triceratops, carn, ['palm_tree', 'fern', 'cycad_grove'])).toBe(0.5);
  });
});

describe('paddockFitBase', () => {
  it('never exceeds 1.0, whatever the decor', () => {
    expect(paddockFitBase(triceratops, herb, [])).toBe(0.75);
    expect(paddockFitBase(triceratops, herb, ['palm_tree'])).toBe(1.0);
    expect(paddockFitBase(triceratops, herb, ['palm_tree', 'fern', 'cycad_grove'])).toBe(1.0);
    expect(paddockFitBase(triceratops, carn, ['palm_tree'])).toBe(0.5);
  });
});

describe('baseComfortAt', () => {
  it('ignores enrichment while comfortAt applies it', () => {
    const enriched = dino(['palm_tree', 'fern']);
    expect(comfortAt(enriched, 0)).toBeCloseTo(1.05);
    expect(baseComfortAt(enriched, 0)).toBeCloseTo(1.0);
  });
  it('is 0 for an unassigned dino, like comfortAt', () => {
    const loose = dino(['palm_tree', 'fern'], { paddock: null });
    expect(baseComfortAt(loose, 0)).toBe(0);
  });
});

describe('enrichmentAt', () => {
  it('reports the multiplier for display', () => {
    expect(enrichmentAt(dino(['palm_tree']))).toBe(1.0);
    expect(enrichmentAt(dino(['palm_tree', 'fern']))).toBe(1.05);
  });
  it('is 1.0 when the paddock is not even at full fit', () => {
    expect(enrichmentAt(dino([]))).toBe(1.0);
    expect(enrichmentAt(dino(['palm_tree', 'fern'], { paddock: carn }))).toBe(1.0);
    expect(enrichmentAt(dino(['palm_tree', 'fern'], { paddock: null }))).toBe(1.0);
  });
});
