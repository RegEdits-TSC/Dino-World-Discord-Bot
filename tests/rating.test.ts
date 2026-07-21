import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recomputeRating, lotSlots, siteUnlocked, shopCeiling, mythicUnlocked } from '../src/modules/park/rating.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

describe('gating helpers (re-exported from rating.ts)', () => {
  it('lotSlots grows 3→8 across thresholds', () => {
    expect(lotSlots(0)).toBe(3);
    expect(lotSlots(50)).toBe(4);
    expect(lotSlots(400)).toBe(8);
    expect(lotSlots(999)).toBe(8);
  });
  it('siteUnlocked / shopCeiling / mythicUnlocked read high-water', () => {
    expect(siteUnlocked(150, 149)).toBe(false);
    expect(siteUnlocked(150, 150)).toBe(true);
    expect(shopCeiling(0)).toBe('uncommon');
    expect(shopCeiling(250)).toBe('epic');
    expect(shopCeiling(400)).toBe('legendary');
    expect(mythicUnlocked(399)).toBe(false);
    expect(mythicUnlocked(400)).toBe(true);
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
