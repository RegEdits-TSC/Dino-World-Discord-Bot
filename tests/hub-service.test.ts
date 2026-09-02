import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { hubView } from '../src/modules/hub/service.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx({ nowMs: 1_000_000 }); getOrCreateUser(ctx, 'u1', 'U1'); });

const egg = (over: Partial<typeof schema.eggs.$inferInsert> = {}) =>
  ctx.db.insert(schema.eggs).values({
    userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, ...over,
  }).run();

const ids = (userId = 'u1') => hubView(ctx, userId).map((s) => s.id);

describe('hubView — the READY section', () => {
  it('is empty for a player with nothing ready', () => {
    expect(hubView(ctx, 'u1').filter((s) => s.section === 'ready')).toEqual([]);
  });

  it('reports an egg whose hatch time has arrived, and offers Crack', () => {
    egg({ incubationStartedAt: 0, hatchesAt: 1_000_000 });   // exactly now — the boundary
    const row = hubView(ctx, 'u1').find((s) => s.id === 'eggs-ready');
    expect(row, 'no eggs-ready row').toBeTruthy();
    expect(row!.section).toBe('ready');
    expect(row!.lossAtMs, 'a ready egg waits forever and must not carry a deadline').toBeNull();
    expect(row!.control!.customId).toBe('hatch:crack:1');
  });

  it('does NOT report an egg still cooking as ready', () => {
    egg({ incubationStartedAt: 0, hatchesAt: 1_000_001 });   // one ms out
    expect(ids()).not.toContain('eggs-ready');
  });

  it('reports an egg that was never put in the incubator, and offers Incubate', () => {
    egg();   // incubationStartedAt stays null
    const row = hubView(ctx, 'u1').find((s) => s.id === 'eggs-idle');
    expect(row, 'no eggs-idle row').toBeTruthy();
    // The owner uid rides in this id because the handler checks it; the egg id is
    // validated as an integer on the other side.
    expect(row!.control!.customId).toBe('hatch:inc:u1:1');
  });

  it('suppresses both egg rows for an egg locked in a pending trade', () => {
    egg();
    egg({ incubationStartedAt: 0, hatchesAt: 0 });
    getOrCreateUser(ctx, 'u2', 'U2');   // toUser is FK-constrained against users.discordId
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { dinoIds: [], eggIds: [1, 2], cash: 0, foods: {} },
      request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
      status: 'pending', createdAt: 999_999,
    } as typeof schema.trades.$inferInsert).run();
    // Both incubateEgg and hatchEgg refuse a locked egg, so offering either control would
    // be offering a button that can only error.
    expect(ids()).not.toContain('eggs-idle');
    expect(ids()).not.toContain('eggs-ready');
  });

  it('reports a returned expedition and offers Claim, but not one still out', () => {
    ctx.db.insert(schema.expeditions).values({
      userId: 'u1', siteId: 'coastal_dig', departedAt: 0, returnsAt: 1_000_000,
    }).run();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'expedition-ready');
    expect(row!.control!.customId).toBe('exp:claim:u1');

    ctx.setNow(999_999);
    expect(ids()).not.toContain('expedition-ready');
  });

  it('reports a finished pairing and offers Claim, carrying the breeding id', () => {
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: 1, parentB: 2, rarity: 'common', startedAt: 0, readyAt: 500_000,
    }).run();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'breeding-ready');
    // breed:claim carries the breeding id, NOT the owner — safe here only because the hub
    // is ephemeral and therefore owner-only. It must never be minted on a public message.
    expect(row!.control!.customId).toBe('breed:claim:1');
  });

  it('writes nothing — hubView is a read', () => {
    egg();
    const before = ctx.db.select().from(schema.eggs).all();
    hubView(ctx, 'u1');
    expect(ctx.db.select().from(schema.eggs).all()).toEqual(before);
  });
});
