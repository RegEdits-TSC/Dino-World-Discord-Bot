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
});
