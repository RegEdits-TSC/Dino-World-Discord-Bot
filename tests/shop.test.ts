import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dailyEggOffers, buyEgg, buyFood, ShopError } from '../src/modules/shop/service.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

const DAY = 86_400_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); ctx.economy.apply('u1', { cash: 200_000 }, 'seed', 0); });
const bal = () => ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;

describe('shop', () => {
  it('offers are deterministic per day and never exceed the ceiling', () => {
    const a = dailyEggOffers(0, 3 * DAY);           // high-water 0 → ceiling uncommon
    const b = dailyEggOffers(0, 3 * DAY);
    expect(a).toEqual(b);                            // same day → same offers
    for (const r of a) expect(['common', 'uncommon']).toContain(r);
    expect(dailyEggOffers(0, 4 * DAY)).toBeInstanceOf(Array);   // a different day computes without error
  });
  it('buyEgg charges the price and adds a shop egg', () => {
    buyEgg(ctx, 'u1', 'common');                    // 500
    expect(bal().cash).toBe(200_000);               // started 500 + 200,000 seed = 200,500; − 500 = 200,000
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all()).toHaveLength(1);
  });
  it('buyFood credits food and charges cash', () => {
    const before = bal().food;
    buyFood(ctx, 'u1', 50);                          // 50 units * 10 = 500 cash
    expect(bal().food).toBe(before + 50);
    expect(bal().cash).toBe(200_000);               // 200,500 − 500
  });
  it('buyEgg rejects mythic', () => {
    expect(() => buyEgg(ctx, 'u1', 'mythic')).toThrow(ShopError);
  });
});
