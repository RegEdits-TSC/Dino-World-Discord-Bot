import { describe, it, expect } from 'vitest';
import {
  TRAITS, TRAIT_IDS, getTrait, traitDefs, modProduct,
  rollTraits, pickTrait, spliceTrait, WILD_SLOT_ODDS, BRED_SLOT_ODDS,
} from '../src/data/traits.js';
import { mulberry32 } from './harness.js';

describe('trait table', () => {
  it('has 14 traits across 4 domains', () => {
    expect(TRAIT_IDS).toHaveLength(14);
    expect(new Set(TRAIT_IDS.map((id) => TRAITS[id].domain)))
      .toEqual(new Set(['income', 'care', 'combat', 'meta']));
  });

  it('gives every trait a unicode fallback for autocomplete labels', () => {
    for (const id of TRAIT_IDS) expect(TRAITS[id].fallback.length).toBeGreaterThan(0);
  });

  it('gives every trait at least one modifier', () => {
    for (const id of TRAIT_IDS) expect(Object.keys(TRAITS[id].mods).length).toBeGreaterThan(0);
  });

  it('throws on an unknown trait id', () => {
    expect(() => getTrait('nope')).toThrow(/Unknown trait/);
  });
});

describe('modProduct', () => {
  it('is 1 for no traits', () => {
    expect(modProduct([], 'income')).toBe(1);
  });

  it('multiplies matching modifiers and ignores others', () => {
    // prolific +15% income, savage +12% atk
    expect(modProduct(['prolific', 'savage'], 'income')).toBeCloseTo(1.15);
    expect(modProduct(['prolific', 'savage'], 'atk')).toBeCloseTo(1.12);
  });

  it('ignores unknown ids rather than throwing', () => {
    expect(modProduct(['prolific', 'legacy_trait'], 'income')).toBeCloseTo(1.15);
  });

  it('applies grazer to both income and drain', () => {
    expect(modProduct(['grazer'], 'income')).toBeCloseTo(1.2);
    expect(modProduct(['grazer'], 'drain')).toBeCloseTo(1.2);
  });
});

describe('traitDefs', () => {
  it('drops unknown ids', () => {
    expect(traitDefs(['hardy', 'gone']).map((t) => t.id)).toEqual(['hardy']);
  });
});

describe('pickTrait', () => {
  it('never returns a trait from an excluded domain', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const picked = pickTrait(rng, new Set(['income', 'care']));
      expect(picked).not.toBeNull();
      expect(['combat', 'meta']).toContain(TRAITS[picked!].domain);
    }
  });

  it('returns null when every domain is excluded', () => {
    expect(pickTrait(mulberry32(1), new Set(['income', 'care', 'combat', 'meta']))).toBeNull();
  });
});

describe('rollTraits', () => {
  it('never returns two traits from the same domain', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rolled = rollTraits(mulberry32(seed));
      const domains = rolled.map((id) => TRAITS[id].domain);
      expect(new Set(domains).size).toBe(domains.length);
    }
  });

  it('never returns duplicates', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rolled = rollTraits(mulberry32(seed));
      expect(new Set(rolled).size).toBe(rolled.length);
    }
  });

  it('returns at most 2 traits', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(rollTraits(mulberry32(seed)).length).toBeLessThanOrEqual(2);
    }
  });

  it('rolls 0 traits at the bottom of the wild odds and 2 at the top', () => {
    expect(rollTraits(() => 0.0, WILD_SLOT_ODDS)).toHaveLength(0);
    expect(rollTraits(() => 0.999, WILD_SLOT_ODDS)).toHaveLength(2);
  });

  it('bred odds start at 0 traits only below 0.25', () => {
    expect(rollTraits(() => 0.1, BRED_SLOT_ODDS)).toHaveLength(0);
    expect(rollTraits(() => 0.3, BRED_SLOT_ODDS)).toHaveLength(1);
  });
});

describe('spliceTrait', () => {
  it('adds a trait to a dino that has none', () => {
    const out = spliceTrait([], 0, mulberry32(3));
    expect(out).toHaveLength(1);
  });

  it('replaces the chosen slot and keeps the other', () => {
    const out = spliceTrait(['prolific', 'savage'], 0, mulberry32(5));
    expect(out).toHaveLength(2);
    expect(out[1]).toBe('savage');
    expect(out[0]).not.toBe('savage');
  });

  it('never collides with the surviving slot domain', () => {
    for (let seed = 0; seed < 300; seed++) {
      const out = spliceTrait(['prolific', 'savage'], 0, mulberry32(seed));
      expect(TRAITS[out[0]].domain).not.toBe('combat');
    }
  });

  it('throws on an out-of-range slot', () => {
    expect(() => spliceTrait(['prolific'], 5, mulberry32(1))).toThrow(/slot/);
  });
});
