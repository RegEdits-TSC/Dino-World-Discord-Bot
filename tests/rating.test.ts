import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recomputeRating, lotSlots, siteUnlocked, shopCeiling, mythicUnlocked } from '../src/modules/park/rating.js';
import { LOT_SLOT_THRESHOLDS } from '../src/data/progression.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

const seedPaddock = (ctx: ReturnType<typeof makeCtx>, decor: string[]) =>
  ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock',
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
  // The two newest sites (Abyssal Trench, Containment Site) are pinned in two
  // unrelated files with nothing coupling them — progression.ts's own gating
  // constants and sites.ts's own gating constants. The spec's intent is that a
  // gate this deep carries a park-side reward too, so the last two lot-slot
  // thresholds must equal those two sites' unlockRating, in campaign order.
  // Both sides read the real exported constants (never a hardcoded 880/950),
  // so this fails the moment either file's gate moves without the other.
  it('the two newest lot-slot thresholds match their sites\' unlockRating', () => {
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
    // 302 points of rarity weight now exist against a COLLECTION_TARGET of 190,
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
  // comfort leak is fixed, for a reason that has nothing to do with enrichment. grass_tuft
  // and boulder are plains-tagged, so they don't match triceratops's forest biome — one
  // matching kind (palm_tree) either way, holding enrichment coverage constant too.
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

  it('a fully enriched saturated park still reports at most 1000', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const lot = seedPaddock(ctx, ['palm_tree', 'fern', 'cycad_grove']);
    seedAssignedDino(ctx, lot, 'triceratops', { hunger: 100, lastFedAt: 0 });
    const { rating } = recomputeRating(ctx, 'u1');
    expect(rating).toBeLessThanOrEqual(1000);
  });
});
