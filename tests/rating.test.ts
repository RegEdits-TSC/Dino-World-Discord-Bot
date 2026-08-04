import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recomputeRating, lotSlots, siteUnlocked, shopCeiling, mythicUnlocked } from '../src/modules/park/rating.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

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
});
