import { describe, it, expect } from 'vitest';
import { ENRICHMENT_CAP_KINDS, ENRICHMENT_STEPS, enrichingKindsFor, matchedKindCount, enrichmentMult } from '../src/data/decor.js';
import { triceratops } from '../src/data/species/triceratops.js';
import { allSpecies } from '../src/data/species/index.js';
import {
  paddockFit, paddockFitBase, comfortAt, baseComfortAt, enrichmentAt,
  escapeAt, drainMsFor, hungerAt, GRACE_MS, ESCAPE_COMFORT, HUNGER_DRAIN_MS,
} from '../src/core/clock.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { TRAITS, modProduct, WILD_SLOT_ODDS, BRED_SLOT_ODDS, type TraitId, type TraitDomain } from '../src/data/traits.js';

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
  // The dead window this ladder has to stay clear of is gated further down, in
  // "the fit × drain dead window" — the boundary is fit × drainMult, not fit alone,
  // so a `step < 1.5` assertion here would pass while the condition is violated.
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

// ─── The dead window ────────────────────────────────────────────────────────────
// A dino whose escapeAt lands AFTER its hunger hits zero sits at comfort 0 — earning
// nothing — until the grace clock runs out. From src/core/clock.ts:
//   escapeAt − hungerZero = GRACE_MS − (ESCAPE_COMFORT / fit) · drainMs
//   drainMs = HUNGER_DRAIN_MS / drainMult,  drainMult = modProduct(traits, 'drain')
// so the window opens iff fit · drainMult > 1.5. Fit 1.5 is the boundary ONLY for a
// dino with no drain traits, which is why the assertion this replaces
// (`expect(step).toBeLessThan(1.5)`) was toothless: grazer (income domain) + skittish
// (care domain) is a legal pair at drainMult 1.44, boundary fit 1.0417, so BOTH shipped
// rungs are already past it. src/data/decor.ts records the measured numbers.

/** Slot count is the odds-array index, so its length − 1 is the most traits a dino holds. */
const MAX_TRAIT_SLOTS = Math.max(WILD_SLOT_ODDS.length, BRED_SLOT_ODDS.length) - 1;

/**
 * The worst hunger drain a dino can legally carry. The domain rule (never two traits
 * from one domain) makes that the MAX_TRAIT_SLOTS largest per-domain `drain` maxima,
 * and a domain whose best drain is ≤ 1 contributes no trait at all. Derived from the
 * real TRAITS table rather than hard-coded, so a third drain trait — or one that beats
 * grazer or skittish in its own domain — moves this gate without anyone editing it.
 */
function worstDrainTraits(): TraitId[] {
  const best = new Map<TraitDomain, TraitId>();
  for (const t of Object.values(TRAITS)) {
    const held = best.get(t.domain);
    if ((t.mods.drain ?? 1) > (held ? TRAITS[held].mods.drain ?? 1 : 1)) best.set(t.domain, t.id);
  }
  return [...best.values()]
    .sort((a, b) => (TRAITS[b].mods.drain ?? 1) - (TRAITS[a].mods.drain ?? 1))
    .slice(0, MAX_TRAIT_SLOTS);
}
const WORST_TRAITS = worstDrainTraits();
const MAX_DRAIN_MULT = modProduct(WORST_TRAITS, 'drain');

/**
 * How long a dino may sit at comfort 0 while its grace runs, worst case. The shipped
 * worst case is 25.45 min (fit 1.10 × MAX_DRAIN_MULT 1.44) and 30 minutes is the round
 * number just above it — deliberately only ~4.5 min of headroom. Under today's table
 * this trips at an ENRICHMENT_STEPS cap above 1.111, or at any MAX_DRAIN_MULT above
 * 1.4545. Raising it is a decision about how long a player may earn nothing while a
 * dino is still theirs, not a formality.
 */
const MAX_DEAD_WINDOW_MS = 30 * 60_000;

/** escapeAt − hungerZero, both from the real clock. Positive means a dead window. */
function deadWindowMs(decor: string[], traits: string[]): number {
  const d = dino(decor, { traits });
  const drainMs = drainMsFor(traits);
  const hungerZero = d.lastFedAt + (d.hungerAtFed / 100) * drainMs;
  // Ground that instant in the real hunger function instead of trusting the algebra:
  // hunger is exactly 0 there and still positive a millisecond earlier.
  expect(hungerAt(d.hungerAtFed, d.lastFedAt, hungerZero, drainMs)).toBe(0);
  expect(hungerAt(d.hungerAtFed, d.lastFedAt, hungerZero - 1, drainMs)).toBeGreaterThan(0);
  return escapeAt(d)! - hungerZero;
}

describe('the fit × drain dead window', () => {
  // Cap-many matching kinds for triceratops, read off the catalog so the fixture tracks
  // ENRICHMENT_CAP_KINDS instead of a hand-listed trio.
  const capDecor = enrichingKindsFor(triceratops).slice(0, ENRICHMENT_CAP_KINDS);

  it('derives the worst legal drain product from the real trait table', () => {
    expect(MAX_DRAIN_MULT).toBe(1.44);                       // grazer 1.20 × skittish 1.20
    // A real, legal pair reaches it — so the derivation is not silently under-counting.
    expect(MAX_DRAIN_MULT).toBeGreaterThanOrEqual(modProduct(['grazer', 'skittish'], 'drain'));
    expect(WORST_TRAITS.length).toBeLessThanOrEqual(MAX_TRAIT_SLOTS);
    // ...and the pair it picked is one a dino could actually hold: distinct domains.
    expect(new Set(WORST_TRAITS.map((id) => TRAITS[id].domain)).size).toBe(WORST_TRAITS.length);
  });

  it('opens no dead window at fit 1.0, the pre-enrichment ceiling', () => {
    // −20 min at the worst legal drain: the dino escapes before hunger hits zero, which
    // is why this condition was unreachable before enrichment shipped.
    expect(paddockFit(triceratops, herb, capDecor.slice(0, 1))).toBe(1.0);
    expect(deadWindowMs(capDecor.slice(0, 1), WORST_TRAITS)).toBeLessThan(0);
  });

  it('keeps the worst reachable window inside MAX_DEAD_WINDOW_MS', () => {
    // The fixture must really reach the top of the ladder, or the bound is measured at
    // the wrong fit. If a future cap exceeds this species' enriching kinds, move the
    // fixture to a wider species — never lower this guard.
    expect(capDecor).toHaveLength(ENRICHMENT_CAP_KINDS);
    const fit = paddockFit(triceratops, herb, capDecor);
    expect(fit).toBe(Math.max(...ENRICHMENT_STEPS));
    const worst = deadWindowMs(capDecor, WORST_TRAITS);
    // The closed form src/data/decor.ts documents, checked against the real clock rather
    // than assumed: if comfortCrossing ever stops dividing by a constant fit, the two
    // part company here before anyone trusts the bound below.
    expect(worst).toBeCloseTo(GRACE_MS - (ESCAPE_COMFORT / fit) * (HUNGER_DRAIN_MS / MAX_DRAIN_MULT), 6);
    expect(worst).toBeLessThanOrEqual(MAX_DEAD_WINDOW_MS);
  });

  it('records the measured window at both shipped rungs', () => {
    expect(deadWindowMs(capDecor.slice(0, 2), WORST_TRAITS) / 60_000).toBeCloseTo(3.8095, 3);
    expect(deadWindowMs(capDecor, WORST_TRAITS) / 60_000).toBeCloseTo(25.4545, 3);
  });
});
