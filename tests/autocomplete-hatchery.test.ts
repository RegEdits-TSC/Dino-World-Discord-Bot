import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { createTrade } from '../src/modules/trading/service.js';
import { locksFor } from '../src/core/locks.js';
import { eq } from 'drizzle-orm';
import { TRADE_MIN_RATING } from '../src/data/trade.js';

const H = 3_600_000;
const cmd = (name: string) => hatcheryModule.commands.find((c) => c.data.name === name)!;

// A pending u1->u2 trade offering the given eggs — the only thing that escrows them now.
function escrowEggs(ctx: ReturnType<typeof makeCtx>, eggIds: number[]) {
  getOrCreateUser(ctx, 'u2', 'u2');
  ctx.db.insert(schema.trades).values({
    fromUser: 'u1', toUser: 'u2', offer: { dinoIds: [], eggIds, cash: 0, foods: {} },
    request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
    status: 'pending', createdAt: ctx.now(),
  }).run();
}

function seedEggs(ctx: ReturnType<typeof makeCtx>) {
  getOrCreateUser(ctx, 'u1', 'u1');
  const mk = (over: Partial<typeof schema.eggs.$inferInsert>) =>
    ctx.db.insert(schema.eggs).values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, ...over }).returning().get();
  const inventory = mk({ rarity: 'common' });                                        // not incubating
  const hatching = mk({ rarity: 'epic', incubationStartedAt: 0, hatchesAt: 12 * H }); // incubating
  const ready = mk({ rarity: 'rare', incubationStartedAt: 0, hatchesAt: 1 });         // ready
  return { inventory, hatching, ready };
}

describe('/incubate egg autocomplete', () => {
  it('ranks non-incubating eggs first with state-tagged labels', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { inventory, hatching, ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0]).toEqual({ name: `🥚 #${inventory.id} Common — in inventory`, value: inventory.id });
    expect(rows.map((r) => r.value)).toEqual([inventory.id, hatching.id, ready.id]);
    expect(rows[1].name).toBe(`🥚 #${hatching.id} Epic — hatching, 10h left`);
    expect(rows[2].name).toBe(`🥚 #${ready.id} Rare — READY`);
  });

  it('filters by the typed query', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: 'rare' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows.map((r) => r.value)).toEqual([ready.id]);
  });

  it('shows the empty-state row when the user has no eggs', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No eggs — get one from /shop egg or /expedition', value: 0 }]);
  });

  it('tags a locked egg and ranks it below the valid ones', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { inventory } = seedEggs(ctx);
    const locked = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'legendary', source: 'shop', obtainedAt: 0 })
      .returning().get();
    escrowEggs(ctx, [locked.id]);
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0].value).toBe(inventory.id);                      // valid first
    expect(rows[rows.length - 1]).toEqual({
      name: `🥚 #${locked.id} Legendary — locked in a trade`, value: locked.id,
    });
  });

  it('an expired trade stops shadowing an inventory egg, with no sweep', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    ctx.setNow(25 * 3_600_000);                                        // TRADE_EXPIRY_MS is 24h
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0]).toEqual({ name: `🥚 #${egg.id} Common — in inventory`, value: egg.id });
    expect(locksFor(ctx, 'u1').eggs.has(egg.id)).toBe(false);
    // The provider writes nothing — the lock lapsed on the clock, not on a sweep.
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('pending');
  });
});

describe('/hatch egg autocomplete', () => {
  it('ranks READY eggs first', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'hatch', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows[0].value).toBe(ready.id);
    expect(rows).toHaveLength(3);
  });

  it('never lists another user\'s eggs', async () => {
    const ctx = makeCtx();
    seedEggs(ctx);
    getOrCreateUser(ctx, 'u2', 'u2');
    const i = fakeAutocomplete({ name: 'hatch', user: 'u2', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No eggs — get one from /shop egg or /expedition', value: 0 }]);
  });

  it('never ranks a locked egg as ready, even when its timer is up', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    seedEggs(ctx);
    const locked = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'legendary', source: 'shop', obtainedAt: 0,
                incubationStartedAt: 0, hatchesAt: 1 })
      .returning().get();
    escrowEggs(ctx, [locked.id]);
    const i = fakeAutocomplete({ name: 'hatch', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[rows.length - 1]).toEqual({
      name: `🥚 #${locked.id} Legendary — locked in a trade`, value: locked.id,
    });
  });

  it('an expired trade stops demoting a ready egg, with no sweep', async () => {
    // A locked AND ready row cannot be built through services in either order —
    // createTrade refuses an incubating egg, and (after this work) incubateEgg refuses
    // a locked one. Trade first, then set the timer fields directly.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    ctx.db.update(schema.eggs).set({ incubationStartedAt: 0, hatchesAt: 1 })
      .where(eq(schema.eggs.id, egg.id)).run();
    ctx.setNow(25 * 3_600_000);                                        // TRADE_EXPIRY_MS is 24h
    const i = fakeAutocomplete({ name: 'hatch', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0]).toEqual({ name: `🥚 #${egg.id} Common — READY`, value: egg.id });
    expect(locksFor(ctx, 'u1').eggs.has(egg.id)).toBe(false);
    // The provider writes nothing — the lock lapsed on the clock, not on a sweep.
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('pending');
  });
});
