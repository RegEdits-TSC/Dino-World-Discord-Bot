import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { createTrade, TradeError } from '../src/modules/trading/service.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

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
