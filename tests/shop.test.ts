import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand, fakeButton } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dailyEggOffers, buyEgg, buyFood, ShopError } from '../src/modules/shop/service.js';
import { shopModule } from '../src/modules/shop/index.js';
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

describe('shop module', () => {
  it('/shop egg buys an offered rarity', async () => {
    // common is always in the pool at ceiling uncommon; if a given day excludes it, pick from dailyEggOffers
    const offers = (await import('../src/modules/shop/service.js')).dailyEggOffers(0, ctx.now());
    const rarity = offers[0];
    const i = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity } });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all().length).toBeGreaterThanOrEqual(1);
  });
  it('/sell confirm button sells the dino', async () => {
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    const b = fakeButton({ customId: `sell:confirm:${d.id}`, user: 'u1', guild: 'g1' });
    await shopModule.components[0].execute(ctx, b.asInteraction() as never);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()).toBeUndefined();
  });
});

describe('shop visuals', () => {
  it('/shop view thumbnails the best egg in today\'s rotation', async () => {
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { thumbnail?: { url: string } } }>; files?: unknown[] };
    // dailyEggOffers always returns ≥1 rarity with egg art present for all six rarities
    expect(payload.embeds[0].toJSON().thumbnail?.url).toMatch(/^attachment:\/\/(common|uncommon|rare|epic|legendary)\.png$/);
    expect(payload.files).toHaveLength(1);
  });
  it('/shop egg purchase replies with a rarity-colored embed and egg thumbnail', async () => {
    const offers = dailyEggOffers(0, ctx.now());
    const i = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity: offers[0] } });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { thumbnail?: { url: string }; description?: string } }> };
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${offers[0]}.png`);
    expect(payload.embeds[0].toJSON().description).toContain('/incubate');
  });
});
