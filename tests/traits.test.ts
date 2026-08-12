import { describe, it, expect } from 'vitest';
import {
  TRAITS, TRAIT_IDS, getTrait, traitDefs, modProduct,
  rollTraits, pickTrait, spliceTrait, WILD_SLOT_ODDS, BRED_SLOT_ODDS,
} from '../src/data/traits.js';
import type { TraitMods } from '../src/data/traits.js';
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

  // Splice is a "genuine gamble" (design doc §6) — the sink only works as a
  // repeatable one if the replacement can land worse than what it replaced,
  // not just better. pickTrait (src/data/traits.ts) samples uniformly across
  // the domain-filtered pool with no polarity weighting, so a wide seed sweep
  // must surface both positive- and negative-polarity outcomes.
  it('can produce a worse trait, not just a better one', () => {
    const polarities = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      const out = spliceTrait(['prolific', 'savage'], 0, mulberry32(seed));
      polarities.add(TRAITS[out[0]].polarity);
    }
    expect(polarities.has('positive')).toBe(true);
    expect(polarities.has('negative')).toBe(true);
  });
});

describe('polarity', () => {
  // Exhaustive over keyof TraitMods on purpose — a Partial would let a future mod key
  // go unclassified, and every trait carrying only that key would pass vacuously. Five
  // of the fourteen shipped traits carry only combat keys, so a map missing hp/atk/def/
  // spd is red on arrival rather than merely incomplete.
  const DIRECTION: Record<keyof TraitMods, 1 | -1> = {
    income: 1, xp: 1, hp: 1, atk: 1, def: 1, spd: 1,
    drain: -1, feed: -1, breedTime: -1,
  };

  it('agrees with the direction of every mod a trait carries', () => {
    for (const id of TRAIT_IDS) {
      const t = TRAITS[id];
      const signs = (Object.keys(t.mods) as Array<keyof TraitMods>)
        .map((k) => Math.sign((t.mods[k]! - 1) * DIRECTION[k]))
        .filter((s) => s !== 0);
      const good = signs.some((s) => s > 0);
      const bad = signs.some((s) => s < 0);

      if (t.polarity === 'positive') {
        expect(good, `${id} is positive but carries no beneficial mod`).toBe(true);
        expect(bad, `${id} is positive but carries an adverse mod`).toBe(false);
      }
      if (t.polarity === 'negative') {
        expect(bad, `${id} is negative but carries no adverse mod`).toBe(true);
        expect(good, `${id} is negative but carries a beneficial mod`).toBe(false);
      }
      if (t.polarity === 'mixed') {
        expect(good && bad, `${id} is mixed without one beneficial and one adverse mod`).toBe(true);
      }
    }
  });
});
