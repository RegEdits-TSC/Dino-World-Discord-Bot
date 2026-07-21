import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { settleEscapes } from '../src/modules/park/escapes.js';
import { recomputeRating } from '../src/modules/park/rating.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0); });
const dinoRow = (id: number) => ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;

describe('settleEscapes', () => {
  it('stamps escapedAt once a dino has been below comfort past the grace period', () => {
    // triceratops in a herbivore paddock, NO matching decor → fit 0.75.
    // comfort hits 0.25 at hunger 33.3 → ~32h; escape 32h + 8h grace = 40h.
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    ctx.setNow(20 * H);
    expect(settleEscapes(ctx, 'u1')).toEqual([]);
    expect(dinoRow(d.id).escapedAt).toBeNull();
    ctx.setNow(60 * H);
    expect(settleEscapes(ctx, 'u1')).toEqual([d.id]);
    expect(dinoRow(d.id).escapedAt).not.toBeNull();
    expect(settleEscapes(ctx, 'u1')).toEqual([]);        // idempotent
  });
  it('never escapes an unassigned dino', () => {
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: null, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    ctx.setNow(200 * H);
    expect(settleEscapes(ctx, 'u1')).toEqual([]);
    expect(dinoRow(d.id).escapedAt).toBeNull();
  });
});

describe('recomputeRating with escapes', () => {
  it('an escaped dino stays in collection but drops out of the comfort average', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    ctx.setNow(0);
    const happy = recomputeRating(ctx, 'u1').rating;
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, d.id)).run();
    const escaped = recomputeRating(ctx, 'u1').rating;
    expect(escaped).toBeLessThan(happy);                 // comfort term dropped
    expect(escaped).toBeGreaterThan(0);                  // collection still counts
  });
});
