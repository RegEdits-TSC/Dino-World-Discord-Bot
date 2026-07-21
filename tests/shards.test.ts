import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { sellDino, buyMythicEgg, ShardError, SHARD_DAILY_CAP } from '../src/modules/shop/shards.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });
const addDino = (speciesId: string, over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();
const bal = () => ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;

describe('sellDino', () => {
  it('pays cash + shards, deletes the dino, and never exceeds the 40/day shard cap', () => {
    let totalShards = 0;
    for (let i = 0; i < 10; i++) { const d = addDino('velociraptor'); totalShards += sellDino(ctx, 'u1', d.id).shards; }
    expect(totalShards).toBe(SHARD_DAILY_CAP);
    expect(bal().shards).toBe(SHARD_DAILY_CAP);
    expect(ctx.db.select().from(schema.dinos).all()).toHaveLength(0);
  });
  it('a Mythic dino cannot be sold', () => {
    const d = addDino('indominus');
    expect(() => sellDino(ctx, 'u1', d.id)).toThrow(ShardError);
  });
  it('a via_trade dino sells for cash but 0 shards', () => {
    const d = addDino('velociraptor', { viaTrade: true });
    const res = sellDino(ctx, 'u1', d.id);
    expect(res.shards).toBe(0);
    expect(res.cash).toBeGreaterThan(0);
  });
  it('the shard window resets after 24h', () => {
    for (let i = 0; i < 6; i++) sellDino(ctx, 'u1', addDino('velociraptor').id);   // reaches the 40 cap
    ctx.setNow(ctx.now() + 24 * 3_600_000 + 1);
    const res = sellDino(ctx, 'u1', addDino('velociraptor').id);
    expect(res.shards).toBeGreaterThan(0);
  });
});

describe('buyMythicEgg', () => {
  it('requires 4★ high-water and 500 shards, then grants a preset Mythic egg', () => {
    ctx.db.update(schema.users).set({ ratingHighWater: 400, shards: 500 }).where(eq(schema.users.discordId, 'u1')).run();
    const egg = buyMythicEgg(ctx, 'u1', 'indoraptor');
    expect(egg.rarity).toBe('mythic');
    expect(egg.speciesId).toBe('indoraptor');
    expect(bal().shards).toBe(0);
  });
  it('rejects when high-water < 4★', () => {
    ctx.db.update(schema.users).set({ ratingHighWater: 399, shards: 500 }).where(eq(schema.users.discordId, 'u1')).run();
    expect(() => buyMythicEgg(ctx, 'u1', 'indoraptor')).toThrow(ShardError);
  });
});
