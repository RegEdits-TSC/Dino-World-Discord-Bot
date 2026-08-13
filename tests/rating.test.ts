import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recomputeRating, lotSlots, siteUnlocked, shopCeiling, mythicUnlocked } from '../src/modules/park/rating.js';
import { LOT_SLOT_THRESHOLDS } from '../src/data/progression.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

const seedPaddock = (
  ctx: ReturnType<typeof makeCtx>, decor: string[],
  kind: 'herbivore_paddock' | 'carnivore_paddock' = 'herbivore_paddock',
) =>
  ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind,
    name: kind === 'herbivore_paddock' ? 'Herbivore Paddock' : 'Carnivore Paddock',
    level: 1, decor,
  }).returning().get().id;

const seedAssignedDino = (
  ctx: ReturnType<typeof makeCtx>, lotId: number, speciesId: string,
  over: Partial<typeof schema.dinos.$inferInsert> = {},
) => ctx.db.insert(schema.dinos).values({
  userId: 'u1', lotId, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over,
}).returning().get();

describe('gating helpers (re-exported from rating.ts)', () => {
  it('lotSlots grows 3→10 across all thresholds', () => {
    expect(lotSlots(0)).toBe(3);
    expect(lotSlots(100)).toBe(4);
    expect(lotSlots(200)).toBe(5);
    expect(lotSlots(400)).toBe(6);
    expect(lotSlots(600)).toBe(7);
    expect(lotSlots(800)).toBe(8);
    expect(lotSlots(880)).toBe(9);
    expect(lotSlots(950)).toBe(10);
    expect(lotSlots(9999)).toBe(10);
  });
  it('siteUnlocked / shopCeiling / mythicUnlocked read high-water', () => {
    expect(siteUnlocked(300, 299)).toBe(false);
    expect(siteUnlocked(300, 300)).toBe(true);
    expect(shopCeiling(0)).toBe('uncommon');
    expect(shopCeiling(250)).toBe('rare');
    expect(shopCeiling(400)).toBe('epic');
    expect(shopCeiling(700)).toBe('legendary');
    expect(mythicUnlocked(799)).toBe(false);
    expect(mythicUnlocked(800)).toBe(true);
  });
  // Abyssal Trench (880) and Containment Site (950) are pinned in two unrelated
  // files with nothing coupling them — progression.ts's gating constants and
  // sites.ts's. The intent is that a gate that deep carries a park-side reward
  // too, so those two lot-slot thresholds must equal those two sites'
  // unlockRating, in campaign order. Both sides read the real exported constants
  // (never a hardcoded 880/950), so this fails the moment either file moves
  // without the other.
  //
  // The pairing deliberately STOPS there. Founder's Park (1000) is the newest
  // site and has no lot-slot threshold behind it, because 1000 is a
  // battle/expedition gate rather than a build gate: LOT_SLOT_THRESHOLDS already
  // tops out at 10 slots, parkRaw already saturates PARK_TARGET at 41 with 10
  // slots, and an 11th slot would be +8 dino capacity and more income at exactly
  // the tier where income is largest. This test therefore names its two sites
  // explicitly and must NOT be generalised to "the newest N sites".
  it('the Abyssal Trench and Containment Site lot-slot thresholds match their sites\' unlockRating', () => {
    const newestGateSites = [EXPEDITION_SITES.abyssal_trench, EXPEDITION_SITES.containment_site];
    expect(LOT_SLOT_THRESHOLDS.slice(-newestGateSites.length))
      .toEqual(newestGateSites.map((s) => s.unlockRating));
  });
  it('rating is scaled to 1000 — a known collection pins the exact score', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // tyrannosaurus + mosasaurus (legendary, 16 each) + indominus + indoraptor (mythic, 32 each)
    // = 96 weight / 190 target × 0.40 collection weight × 1000 scale = 202
    for (const s of ['tyrannosaurus', 'mosasaurus', 'indominus', 'indoraptor']) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: s, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    const { rating } = recomputeRating(ctx, 'u1');
    expect(rating).toBe(202);
  });
});

describe('recomputeRating', () => {
  it('empty park rates 0; owning a species raises rating and sets high-water', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    expect(recomputeRating(ctx, 'u1').rating).toBe(0);
    ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'tyrannosaurus', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    const after = recomputeRating(ctx, 'u1');
    expect(after.rating).toBeGreaterThan(0);
    expect(after.highWater).toBe(after.rating);
  });
  it('high-water never decreases when rating drops', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'tyrannosaurus', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    const high = recomputeRating(ctx, 'u1').highWater;
    ctx.db.delete(schema.dinos).run();
    const dropped = recomputeRating(ctx, 'u1');
    expect(dropped.rating).toBe(0);
    expect(dropped.highWater).toBe(high);
  });
  it('collection is clamped at the frozen target, so extra species never overflow it', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // 337 points of rarity weight now exist against a COLLECTION_TARGET of 190,
    // so a deep collection must saturate the term rather than exceeding it.
    for (const s of ['indominus', 'indoraptor', 'ultimasaurus', 'tyrannosaurus', 'mosasaurus',
      'quetzalcoatlus', 'liopleurodon', 'spinoraptor']) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: s, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    // 3 mythic (96) + 5 legendary (80) = 176 … add two epics to cross 190.
    for (const s of ['kronosaurus', 'scorpios_rex']) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: s, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    const { rating } = recomputeRating(ctx, 'u1');
    // collection saturated at 1.0 → 0.40 × 1000 = 400 from that term alone, and the
    // park and comfort terms are unassigned/zero here.
    expect(rating).toBe(400);
  });

  // Rating must be IDENTICAL with and without enrichment. ratingHighWater is monotone
  // (rating.ts), so any enrichment-driven gain would permanently unlock lot slots,
  // sites, the shop ceiling and the mythic egg for every existing player the day this
  // ships. Watch this test fail by pointing rating.ts at comfortAt before trusting it.
  // The "before" paddock carries 3 decor pieces, same as "after", not the brief's literal
  // single-item list: rating's park term sums level + decor.length (unrelated to
  // enrichment), so a 1-vs-3 decor count would leave the two ratings apart even once the
  // comfort leak is fixed, for a reason that has nothing to do with enrichment. decor.length
  // and level are equal on both sides (3 items, level 1), so that term is now identical —
  // what differs is matching-kind COUNT. The control paddock ('palm_tree', 'grass_tuft',
  // 'boulder') matches only palm_tree against triceratops's forest tag (grass_tuft/boulder
  // are plains), so 1 matching kind and base fit 1.0. The test paddock ('palm_tree', 'fern',
  // 'cycad_grove') matches BOTH palm_tree and fern — fern is forest AND swamp — so 2
  // matching kinds and enriched fit 1.05. That 1-vs-2 difference is exactly what this test
  // isolates, and is why it can fail at all: at hunger 80, comfort moves from 0.8×1.0=0.80
  // to 0.8×1.05=0.84, a 0.25 × 0.04 × 1000 = 10-point swing in rating.
  it('enrichment does not change park rating, at full or partial hunger', () => {
    const oneKind = makeCtx();
    getOrCreateUser(oneKind, 'u1', 'Reg');
    const lotA = seedPaddock(oneKind, ['palm_tree', 'grass_tuft', 'boulder']);
    seedAssignedDino(oneKind, lotA, 'triceratops', { hunger: 80, lastFedAt: 0 });
    const before = recomputeRating(oneKind, 'u1');

    const threeKinds = makeCtx();
    getOrCreateUser(threeKinds, 'u1', 'Reg');
    const lotB = seedPaddock(threeKinds, ['palm_tree', 'fern', 'cycad_grove']);
    seedAssignedDino(threeKinds, lotB, 'triceratops', { hunger: 80, lastFedAt: 0 });
    const after = recomputeRating(threeKinds, 'u1');

    expect(after.rating).toBe(before.rating);
    expect(after.highWater).toBe(before.highWater);
  });

  // "At most 1000" only has teeth if every term is genuinely pushed to its ceiling at
  // once. collection and park both saturate through an explicit Math.min(1, ...); comfort
  // carries NO such clamp in rating.ts, so an enriched fit above 1.0 is the one term that
  // could carry the weighted sum past 1.0 (and the final rating past 1000) if rating.ts
  // ever regressed back onto comfortAt. A lone triceratops at hunger 100 in a three-kind
  // paddock — the brief's original fixture — rates ~287 with the fix and ~300 without it,
  // nowhere near 1000 either way, so it could never actually catch that regression.
  it('a fully enriched saturated park still reports at most 1000', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Collection: 3 mythic (32 each) + 5 legendary (16 each) + 2 epic (8 each) = 192,
    // clearing COLLECTION_TARGET (190) — same combination as "collection is clamped"
    // above. indominus is seeded separately below, assigned, so its weight still counts
    // here (the collection term reads every owned dino regardless of assignment).
    for (const s of ['indoraptor', 'ultimasaurus', 'tyrannosaurus', 'mosasaurus',
      'quetzalcoatlus', 'liopleurodon', 'spinoraptor', 'kronosaurus', 'scorpios_rex']) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: s, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    // Park: level 1 + 40 decor pieces = 41 ≥ PARK_TARGET (40).
    // Comfort: indominus's biome tags are volcanic + containment; lava_rock covers the
    // former and containment_fence/floodlight_rig cover the latter — 3 distinct matching
    // kinds, the enrichment ladder's cap (ENRICHMENT_CAP_KINDS), so comfortAt would read
    // fit 1.10 here if rating.ts ever regressed off baseComfortAt. The 37 extra lava_rock
    // entries only pad decor.length for the park term; matchedKindCount Set-dedupes them.
    const lot = seedPaddock(ctx, [
      'lava_rock', 'containment_fence', 'floodlight_rig',
      ...Array(37).fill('lava_rock'),
    ], 'carnivore_paddock');
    seedAssignedDino(ctx, lot, 'indominus', { hunger: 100, lastFedAt: 0 });
    const { rating } = recomputeRating(ctx, 'u1');
    // With every term at its cap: 1000 × (0.40×1 + 0.35×1 + 0.25×1.0) = 1000 on
    // baseComfortAt, sitting exactly on the ceiling; the same fixture reads 1000 ×
    // (0.40×1 + 0.35×1 + 0.25×1.10) = 1025 on comfortAt, over it — the margin this
    // assertion actually has to catch a regression.
    expect(rating).toBeLessThanOrEqual(1000);
  });
});
