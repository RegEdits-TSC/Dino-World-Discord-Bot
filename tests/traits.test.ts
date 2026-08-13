import { describe, it, expect } from 'vitest';
import {
  TRAITS, TRAIT_IDS, getTrait, traitDefs, modProduct,
  rollTraits, pickTrait, spliceTrait, WILD_SLOT_ODDS, BRED_SLOT_ODDS,
} from '../src/data/traits.js';
import type { TraitMods, TraitDomain } from '../src/data/traits.js';
import { mulberry32 } from './harness.js';

describe('trait table', () => {
  it('has 20 traits across 4 domains', () => {
    expect(TRAIT_IDS).toHaveLength(20);
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

describe('domain draw parity', () => {
  const DOMAINS = ['income', 'care', 'combat', 'meta'] as const;
  // 20,000 draws at ±1 percentage point. The bound has to discriminate the failure it
  // exists to catch — but "one domain going 5/20 -> 4/20 or 6/20 moves that share by 5
  // points" is only exact for a REASSIGNMENT that holds the table at 20 traits; adding
  // or removing a trait moves the denominator too. The real figures: adding one trait to
  // a domain moves it 25% -> 28.57% (3.57 pp) and each other domain to 23.81% (1.19 pp);
  // removing one moves it to 21.05% (3.95 pp) and the others to 26.32% (1.32 pp). The
  // guard still fires in every case, but the true worst-case margin is the unchanged
  // domains' 1.19 pp against this 1.00 pp bound, not the changed domain's much wider
  // 3.57 pp. Sampling error at this N stays under a third of a point. A loose tolerance
  // on a large N cannot tell 5/20 from 4/20; a tight one on a small N is merely flaky.
  const DRAWS = 20_000;
  const TOLERANCE = 0.01;

  const shares = (exclude: Set<TraitDomain>, seed: number) => {
    const rng = mulberry32(seed);
    const counts = new Map<TraitDomain, number>(DOMAINS.map((d) => [d, 0] as [TraitDomain, number]));
    for (let i = 0; i < DRAWS; i++) {
      const picked = pickTrait(rng, exclude);
      const domain = TRAITS[picked!].domain;
      counts.set(domain, counts.get(domain)! + 1);
    }
    return counts;
  };

  it('holds the same number of traits in every domain', () => {
    const sizes = DOMAINS.map((d) => TRAIT_IDS.filter((id) => TRAITS[id].domain === d).length);
    expect(new Set(sizes).size, `domain sizes are ${sizes.join('/')}`).toBe(1);
  });

  it('draws every domain a quarter of the time with nothing excluded', () => {
    const counts = shares(new Set<TraitDomain>(), 99);
    for (const d of DOMAINS) {
      const share = counts.get(d)! / DRAWS;
      expect(Math.abs(share - 0.25), `${d} drew ${counts.get(d)} of ${DRAWS}`).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('draws every survivor a third of the time with one domain excluded', () => {
    const counts = shares(new Set<TraitDomain>(['combat']), 101);
    expect(counts.get('combat')).toBe(0);
    for (const d of DOMAINS.filter((d) => d !== 'combat')) {
      const share = counts.get(d)! / DRAWS;
      expect(Math.abs(share - 1 / 3), `${d} drew ${counts.get(d)} of ${DRAWS}`).toBeLessThanOrEqual(TOLERANCE);
    }
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
