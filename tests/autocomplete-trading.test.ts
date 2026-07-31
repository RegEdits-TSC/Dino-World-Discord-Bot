import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { tradingModule } from '../src/modules/trading/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { createTrade } from '../src/modules/trading/service.js';
import { schema } from '../src/core/db/index.js';
import { locksFor } from '../src/core/locks.js';

const cmd = () => tradingModule.commands[0];
const H = 3_600_000;

function seedTrade(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.trades.$inferInsert> = {}) {
  return ctx.db.insert(schema.trades).values({
    fromUser: 'u1', toUser: 'u2',
    offer: { dinoIds: [], eggIds: [], cash: 100, foods: {} },
    request: { dinoIds: [], eggIds: [], cash: 0, foods: { ferns: 5 } },
    createdAt: ctx.now(), ...over,
  }).returning().get();
}

// Local copy of the seed idiom in tests/trading.test.ts (two users at 2★, a
// tradeable dino owned by 'a', locked into a pending a->b trade) — not a
// shared import, per the task-6 brief.
function seedPendingTrade(ctx: ReturnType<typeof makeCtx>): { tradeId: number; dinoId: number } {
  getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
  ctx.db.update(schema.users).set({ parkRating: 200 }).run();
  const d = ctx.db.insert(schema.dinos).values({
    userId: 'a', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
  }).returning().get();
  const t = createTrade(ctx, 'a', 'b',
    { dinoIds: [d.id], eggIds: [], cash: 0, foods: {} },
    { dinoIds: [], eggIds: [], cash: 0, foods: {} });
  return { tradeId: t.id, dinoId: d.id };
}

describe('/trade accept|decline|cancel id autocomplete', () => {
  it('accept: incoming trades first, outgoing tagged toward /trade cancel', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    const incoming = seedTrade(ctx, { fromUser: 'u2', toUser: 'u1' });
    const outgoing = seedTrade(ctx);
    const i = fakeAutocomplete({ name: 'trade', sub: 'accept', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([incoming.id, outgoing.id]);
    expect(rows[0].name).toBe(`🤝 #${incoming.id} ← u2 — give 🌿 5 Ferns / get 💰 100`);
    expect(rows[1].name).toContain('your outgoing, use /trade cancel');
  });

  it('cancel: outgoing first, incoming tagged toward /trade accept', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    const incoming = seedTrade(ctx, { fromUser: 'u2', toUser: 'u1' });
    const outgoing = seedTrade(ctx);
    const i = fakeAutocomplete({ name: 'trade', sub: 'cancel', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([outgoing.id, incoming.id]);
    expect(rows[0].name).toBe(`🤝 #${outgoing.id} → u2 — give 💰 100 / get 🌿 5 Ferns`);
  });

  it('expired trades vanish (expireStale runs first)', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    seedTrade(ctx, { fromUser: 'u2', toUser: 'u1', createdAt: 0 });
    ctx.setNow(25 * H);   // past TRADE_EXPIRY_MS (24h)
    const i = fakeAutocomplete({ name: 'trade', sub: 'accept', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No pending trades', value: 0 }]);
  });
});

describe('/trade offer id-list autocomplete', () => {
  // A pending u1->u2 trade offering the given items — the only thing that escrows them now.
  function escrow(ctx: ReturnType<typeof makeCtx>, offer: { dinoIds: number[]; eggIds: number[] }) {
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2', offer: { ...offer, cash: 0, foods: {} },
      request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
      status: 'pending', createdAt: ctx.now(),
    }).run();
  }

  function seedInventory(ctx: ReturnType<typeof makeCtx>, userId: string) {
    getOrCreateUser(ctx, userId, userId);
    const dino = (over: Partial<typeof schema.dinos.$inferInsert> = {}) =>
      ctx.db.insert(schema.dinos).values({ userId, speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();
    const egg = (over: Partial<typeof schema.eggs.$inferInsert> = {}) =>
      ctx.db.insert(schema.eggs).values({ userId, rarity: 'rare', source: 'shop', obtainedAt: 0, ...over }).returning().get();
    return { dino, egg };
  }

  it('give-dinos: lists only tradeable dinos, completing the last token', async () => {
    const ctx = makeCtx();
    const inv = seedInventory(ctx, 'u1');
    getOrCreateUser(ctx, 'u2', 'u2');
    const ok = inv.dino({});
    // Escrow is derived, so the lock has to come from a real pending trade row.
    escrow(ctx, { dinoIds: [inv.dino({}).id], eggIds: [] });   // escrowed — must not be listed
    inv.dino({ escapedAt: 1 });
    inv.dino({ speciesId: 'indominus' });          // mythic — untradeable
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'give-dinos', value: '' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: `${ok.id} — 🦖 Velociraptor (rare)`, value: String(ok.id) }]);
  });

  it('give-eggs: excludes incubating and locked eggs, re-emits the prefix', async () => {
    const ctx = makeCtx();
    const inv = seedInventory(ctx, 'u1');
    getOrCreateUser(ctx, 'u2', 'u2');
    const ok = inv.egg({});
    inv.egg({ incubationStartedAt: 0, hatchesAt: 99 });
    escrow(ctx, { dinoIds: [], eggIds: [inv.egg({}).id] });    // escrowed — must not be listed
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'give-eggs', value: '500, ' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: `500, ${ok.id} — 🥚 rare egg`, value: `500, ${ok.id}` }]);
  });

  it('want-dinos: reads the in-flight user option and lists the counterparty\'s items', async () => {
    const ctx = makeCtx();
    seedInventory(ctx, 'u1');
    const theirs = seedInventory(ctx, 'u2');
    const target = theirs.dino({});
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'want-dinos', value: '' },
      options: { user: 'u2' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: `${target.id} — 🦖 Velociraptor (rare)`, value: String(target.id) }]);
  });

  it('want-* without a picked user prompts for it', async () => {
    const ctx = makeCtx();
    seedInventory(ctx, 'u1');
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'want-eggs', value: '' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'Pick the user option first', value: '-' }]);
  });

  it('want-dinos: sweeps the counterparty\'s expired trade first, so a stale lock does not hide their dino', async () => {
    const ctx = makeCtx();
    seedInventory(ctx, 'u1');
    const theirs = seedInventory(ctx, 'u2');
    getOrCreateUser(ctx, 'u3', 'u3');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();
    const target = theirs.dino({});
    createTrade(ctx, 'u2', 'u3', { dinoIds: [target.id], eggIds: [], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    ctx.setNow(ctx.now() + 25 * H);   // past TRADE_EXPIRY_MS (24h)
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'want-dinos', value: '' },
      options: { user: 'u2' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: `${target.id} — 🦖 Velociraptor (rare)`, value: String(target.id) }]);
    // Escrow is read against the TARGET (u2), not the invoker, and it lapsed on the clock —
    // the provider writes nothing, so the trade row is still pending.
    expect(locksFor(ctx, 'u2').dinos.has(target.id)).toBe(false);
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('pending');
  });

  it('empty tradeable pool yields an informational row', async () => {
    const ctx = makeCtx();
    seedInventory(ctx, 'u1');   // no dinos seeded
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'give-dinos', value: '' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'You have no tradeable items', value: '-' }]);
  });
});

describe('/trade offer food autocomplete', () => {
  it('give-food lists own holdings; want-food needs the user option first', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'a', 'A');                            // starter: 10 ferns, 10 fish
    const give = fakeAutocomplete({ name: 'trade', sub: 'offer', user: 'a', focused: { name: 'give-food', value: '' } });
    await tradingModule.commands[0].autocomplete!(ctx, give.asAutocomplete());
    const rows = give.replies[0] as Array<{ name: string; value: string }>;
    expect(rows.find((r) => r.value === 'ferns')!.name).toBe('🌿 Ferns — you hold 10');
    const want = fakeAutocomplete({ name: 'trade', sub: 'offer', user: 'a', focused: { name: 'want-food', value: '' } });
    await tradingModule.commands[0].autocomplete!(ctx, want.asAutocomplete());
    expect(want.replies[0]).toEqual([{ name: 'Pick the user option first', value: '-' }]);
  });
  it('decline id autocomplete lists incoming trades by name', async () => {
    const ctx = makeCtx();
    const { tradeId } = seedPendingTrade(ctx);   // same helper idiom as trading.test.ts
    const fa = fakeAutocomplete({ name: 'trade', sub: 'decline', user: 'b', focused: { name: 'id', value: '' } });
    await tradingModule.commands.find((c) => c.data.name === 'trade')!.autocomplete!(ctx, fa.asAutocomplete());
    const choices = fa.replies[0] as Array<{ value: unknown }>;
    expect(choices.map((c) => c.value)).toContain(tradeId);
  });
  it('want-food with the user option set lists the counterparty inventory', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'a', 'a'); getOrCreateUser(ctx, 'b', 'b');
    const fa = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'a',
      focused: { name: 'want-food', value: '' }, options: { user: 'b' },
    });
    await tradingModule.commands.find((c) => c.data.name === 'trade')!.autocomplete!(ctx, fa.asAutocomplete());
    const names = (fa.replies[0] as Array<{ name: string }>).map((c) => c.name);
    expect(names.some((n) => n.includes('they hold'))).toBe(true);
  });
});
