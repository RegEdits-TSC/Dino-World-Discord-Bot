import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { createTrade, acceptTrade, TradeError } from '../src/modules/trading/service.js';
import { declineTrade, cancelTrade, expireStale, listTrades } from '../src/modules/trading/service.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';
import { tradingModule } from '../src/modules/trading/index.js';
import { fakeCommand } from './harness.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx();
  getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
  ctx.db.update(schema.users).set({ parkRating: 200 }).run();   // both at 2★ so the gate passes
});
const empty = { dinoIds: [] as number[], eggIds: [] as number[], cash: 0, food: 0 };
const addDino = (user: string, speciesId = 'triceratops', over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.dinos).values({ userId: user, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();

describe('createTrade', () => {
  it('locks the offered dinos and creates a pending trade', () => {
    // 'b' needs enough cash on hand to plausibly fulfil the request being verified against them.
    ctx.db.update(schema.users).set({ cash: 10_000 }).where(eq(schema.users.discordId, 'b')).run();
    const d = addDino('a');
    const t = createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, { ...empty, cash: 1_000 });
    expect(t.status).toBe('pending');
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.locked).toBe(true);
  });
  it('rejects a Mythic in the offer', () => {
    const m = addDino('a', 'indominus');
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [m.id] }, empty)).toThrow(TradeError);
  });
  it('rejects when the offerer is below 2★', () => {
    ctx.db.update(schema.users).set({ parkRating: 150 }).where(eq(schema.users.discordId, 'a')).run();
    const d = addDino('a');
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty)).toThrow(TradeError);
  });
  it('rejects offering a dino you do not own', () => {
    const d = addDino('b');
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty)).toThrow(TradeError);
  });
  it('rejects an escaped dino in the offer', () => {
    const d = addDino('a', 'triceratops', { escapedAt: 1 });
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty)).toThrow(TradeError);
  });
  it('rejects more than 5 items per side', () => {
    const ids = [1, 2, 3, 4, 5, 6];
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, dinoIds: ids }, empty)).toThrow(TradeError);
  });
  it('rejects a 4th trade in 24h but allows the first 3 (daily cap)', () => {
    const mk = () => createTrade(ctx, 'a', 'b', { ...empty, cash: 1 }, empty);  // cheap valid offers; a has 500 cash
    mk(); mk(); mk();                                   // 3 allowed
    expect(() => mk()).toThrow(TradeError);             // 4th blocked
  });
  it('rejects self-trade', () => {
    const d = addDino('a');
    expect(() => createTrade(ctx, 'a', 'a', { ...empty, dinoIds: [d.id] }, empty)).toThrow(TradeError);
  });
  it('rejects offering a dino already locked in another pending trade', () => {
    const d = addDino('a');
    createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty);      // locks d
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty)).toThrow(TradeError);
  });
  it('rejects offering more cash than you have', () => {
    // a has 500 by default
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, cash: 10_000 }, empty)).toThrow(TradeError);
  });
  it('rejects negative amounts', () => {
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, cash: -5 }, empty)).toThrow(TradeError);
  });
  it('rejects when the RECEIVER cannot afford the requested cash', () => {
    const d = addDino('a');
    // b has 500 by default; requesting 10,000 from b must fail at offer time (receiver-side verify)
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, { ...empty, cash: 10_000 })).toThrow(TradeError);
  });
  it('rejects a mythic EGG in the offer', () => {
    const egg = ctx.db.insert(schema.eggs).values({ userId: 'a', rarity: 'mythic', speciesId: 'indominus', source: 'shop', obtainedAt: 0 }).returning().get();
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, eggIds: [egg.id] }, empty)).toThrow(TradeError);
  });
});

describe('acceptTrade', () => {
  it('swaps items + cash both ways, flags via_trade, unlocks, marks accepted', () => {
    ctx.db.update(schema.users).set({ cash: 5_000 }).where(eq(schema.users.discordId, 'b')).run();
    const da = addDino('a');                          // A gives this dino
    const t = createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [da.id] }, { ...empty, cash: 1_000 });
    acceptTrade(ctx, 'b', t.id);
    const moved = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, da.id)).get()!;
    expect(moved.userId).toBe('b');
    expect(moved.viaTrade).toBe(true);
    expect(moved.locked).toBe(false);
    expect(moved.lotId).toBeNull();
    const a = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!;
    expect(a.cash).toBe(500 + 1_000);                 // A received B's 1,000 (A started 500)
    expect(ctx.db.select().from(schema.trades).where(eq(schema.trades.id, t.id)).get()!.status).toBe('accepted');
  });
  it('fails (and rolls back) if the offerer no longer owns a listed dino at accept', () => {
    const da = addDino('a');
    const t = createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [da.id] }, empty);
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.id, da.id)).run();   // vanished after offer
    expect(() => acceptTrade(ctx, 'b', t.id)).toThrow(TradeError);
    expect(ctx.db.select().from(schema.trades).where(eq(schema.trades.id, t.id)).get()!.status).toBe('pending');
  });
  it('only the toUser can accept', () => {
    const da = addDino('a');
    const t = createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [da.id] }, empty);
    expect(() => acceptTrade(ctx, 'a', t.id)).toThrow(TradeError);
  });
  it('cannot accept an already-resolved trade twice', () => {
    const da = addDino('a');
    const t = createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [da.id] }, empty);
    acceptTrade(ctx, 'b', t.id);
    expect(() => acceptTrade(ctx, 'b', t.id)).toThrow(TradeError);   // status no longer pending
  });
});

describe('trade lifecycle', () => {
  it('decline unlocks the offered items and marks declined', () => {
    const d = addDino('a');
    const t = createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty);
    declineTrade(ctx, 'b', t.id);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.locked).toBe(false);
    expect(ctx.db.select().from(schema.trades).where(eq(schema.trades.id, t.id)).get()!.status).toBe('declined');
  });
  it('only the sender can cancel, only the recipient can decline', () => {
    const d = addDino('a');
    const t = createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty);
    expect(() => cancelTrade(ctx, 'b', t.id)).toThrow(TradeError);   // b is recipient, not sender
    expect(() => declineTrade(ctx, 'a', t.id)).toThrow(TradeError);  // a is sender, not recipient
    cancelTrade(ctx, 'a', t.id);                                     // sender cancels — ok
    expect(ctx.db.select().from(schema.trades).where(eq(schema.trades.id, t.id)).get()!.status).toBe('cancelled');
  });
  it('expireStale marks an overdue pending trade expired and unlocks', () => {
    const d = addDino('a');
    const t = createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty);
    ctx.setNow(ctx.now() + 25 * 3_600_000);                          // 25h later
    expireStale(ctx, 'a');
    expect(ctx.db.select().from(schema.trades).where(eq(schema.trades.id, t.id)).get()!.status).toBe('expired');
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.locked).toBe(false);
  });
  it('listTrades returns the user\'s pending trades', () => {
    const d = addDino('a');
    createTrade(ctx, 'a', 'b', { ...empty, dinoIds: [d.id] }, empty);
    expect(listTrades(ctx, 'a')).toHaveLength(1);
    expect(listTrades(ctx, 'b')).toHaveLength(1);
    expect(listTrades(ctx, 'c')).toHaveLength(0);
  });
});

describe('trading module', () => {
  it('/trade offer then /trade accept moves the dino', async () => {
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();   // both 2★ (beforeEach may already do this)
    const d = addDino('a');
    const offerCmd = fakeCommand({ name: 'trade', sub: 'offer', user: 'a', options: { user: 'b', 'give-dinos': String(d.id) } });
    await tradingModule.commands[0].execute(ctx, offerCmd.asChatInput());
    const t = ctx.db.select().from(schema.trades).where(eq(schema.trades.fromUser, 'a')).get()!;
    const acceptCmd = fakeCommand({ name: 'trade', sub: 'accept', user: 'b', options: { id: t.id } });
    await tradingModule.commands[0].execute(ctx, acceptCmd.asChatInput());
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.userId).toBe('b');
  });
});
