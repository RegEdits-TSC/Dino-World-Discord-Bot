import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dailyEggOffers, buyEgg, buyFood, ShopError } from '../src/modules/shop/service.js';
import { shopModule } from '../src/modules/shop/index.js';
import { createTrade } from '../src/modules/trading/service.js';
import { locksFor } from '../src/core/locks.js';
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
  it('buyFood credits typed inventory and charges cash, rejecting unknown items', () => {
    const before = ctx.economy.getFoodInventory('u1').fish ?? 0;   // starter fish
    buyFood(ctx, 'u1', 'fish', 50);                  // 50 units * 12 = 600 cash
    expect(ctx.economy.getFoodInventory('u1').fish).toBe(before + 50);
    expect(bal().cash).toBe(200_500 - 600);
    expect(() => buyFood(ctx, 'u1', 'pizza', 1)).toThrow(ShopError);
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

describe('sell confirm button', () => {
  it('/sell shows a Confirm sale button with the cash emoji, not text', async () => {
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    const i = fakeCommand({ name: 'sell', user: 'u1', options: { dino: d.id } });
    await shopModule.commands[1].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      components: Array<{ toJSON(): { components: Array<{ label: string; emoji?: { name: string; animated: boolean } }> } }>;
    };
    const button = payload.components[0].toJSON().components[0];
    expect(button.label).toBe('Confirm sale');
    // No app emoji map is loaded in tests, so this is the unicode fallback for dw_cash,
    // resolved by discord.js into the button's structured emoji field (not embedded in the label).
    expect(button.emoji).toEqual({ name: '💰', animated: false });
  });
  it('/sell prompts with the sell banner embed, stays ephemeral, and the confirm update clears it', async () => {
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    const i = fakeCommand({ name: 'sell', user: 'u1', options: { dino: d.id } });
    await shopModule.commands[1].execute(ctx, i.asChatInput());
    const prompt = i.replies[0] as {
      embeds: Array<{ toJSON(): { description?: string; image?: { url: string } } }>;
      files?: Array<{ name: string | null }>; components: unknown[]; flags?: number;
    };
    expect(prompt.embeds[0].toJSON().description).toContain(`Sell dino #${d.id}`);
    expect(prompt.embeds[0].toJSON().image?.url).toBe('attachment://sell.webp');
    expect(prompt.files!.map((f) => f.name)).toEqual(['sell.webp']);
    expect(prompt.components).toHaveLength(1);
    expect(prompt.flags).toBe(MessageFlags.Ephemeral);
    // The confirm edits that same message: without embeds:[]/attachments:[] the
    // stale "Sell dino #N?" embed and its banner would outlive the sale.
    const b = fakeButton({ customId: `sell:confirm:${d.id}`, user: 'u1' });
    await shopModule.components[0].execute(ctx, b.asInteraction() as never);
    const done = b.replies[0] as { content: string; embeds: unknown[]; attachments: unknown[] };
    expect(done.content).toContain('Sold for');
    expect(done.embeds).toEqual([]);
    expect(done.attachments).toEqual([]);
  });
});

describe('shop visuals', () => {
  it('/shop view thumbnails the best egg in today\'s rotation', async () => {
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { thumbnail?: { url: string } } }>; files?: unknown[] };
    // dailyEggOffers always returns ≥1 rarity with egg art present for all six rarities
    expect(payload.embeds[0].toJSON().thumbnail?.url).toMatch(/^attachment:\/\/(common|uncommon|rare|epic|legendary)\.webp$/);
    expect(payload.files!.length).toBeGreaterThanOrEqual(1);   // egg thumbnail; food-market banner may add a second
  });
  it('/shop egg purchase replies with a rarity-colored embed and egg thumbnail', async () => {
    const offers = dailyEggOffers(0, ctx.now());
    const i = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity: offers[0] } });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { thumbnail?: { url: string }; description?: string } }> };
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${offers[0]}.webp`);
    expect(payload.embeds[0].toJSON().description).toContain('/incubate');
  });
  it('/shop view lists the food market grouped by diet', async () => {
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const foodField = payload.embeds[0].toJSON().fields!.find((f) => f.name.includes('Food'))!;
    expect(foodField.value).toContain('🌿 Ferns — 10/unit, fills 100');
    expect(foodField.value).toContain('🥩 Prime Steak — 24/unit, fills 150');
  });
  it('/shop view attaches the food-market banner image and file together', async () => {
    // Guards attach-all-or-nothing: setImage without the matching file renders a
    // broken image in Discord. shop_food_market.webp ships in the repo.
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { image?: { url: string } } }>; files?: Array<{ name?: string | null }> };
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://shop_food_market.webp');
    expect(payload.files!.some((f) => f.name === 'shop_food_market.webp')).toBe(true);
  });
});

describe('shop food and sell error branches', () => {
  it('/shop food execute buys units and replies with an illustrated total', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = shopModule.commands.find((c) => c.data.name === 'shop')!;
    const i = fakeCommand({ name: 'shop', sub: 'food', user: 'u1', options: { item: 'ferns', units: 10 } });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; description?: string; image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toContain('Bought 10× Ferns');
    expect(embed.description).toContain('100 cash');
    expect(embed.image?.url).toBe('attachment://shop_food_market.webp');
    expect(payload.files!.map((f) => f.name)).toContain('shop_food_market.webp');
    expect(ctx.economy.getFoodInventory('u1').ferns).toBe(20);   // 10 starter + 10 bought
  });
  it('/sell rejects an unsellable (locked) dino ephemeral, and sell:confirm re-checks', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();
    const dino = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [dino.id], eggIds: [], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    const sell = shopModule.commands.find((c) => c.data.name === 'sell')!;
    const i = fakeCommand({ name: 'sell', user: 'u1', options: { dino: dino.id } });
    await sell.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('cannot be sold');
    const comp = shopModule.components.find((c) => c.prefix === 'sell')!;
    const b = fakeButton({ customId: `sell:confirm:${dino.id}`, user: 'u1' });
    await comp.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(b.replies[0])).toContain('locked');
  });

  it('/sell: an expired trade stops blocking the sale prompt, with no sweep', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();
    const dino = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [dino.id], eggIds: [], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    ctx.setNow(ctx.now() + 25 * 3_600_000);          // TRADE_EXPIRY_MS is 24h
    const sell = shopModule.commands.find((c) => c.data.name === 'sell')!;
    const i = fakeCommand({ name: 'sell', user: 'u1', options: { dino: dino.id } });
    await sell.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { description?: string } }> };
    expect(payload.embeds[0].toJSON().description).toContain(`Sell dino #${dino.id} for 500 cash`);
    expect(locksFor(ctx, 'u1').dinos.has(dino.id)).toBe(false);
    // The command writes nothing: the lock lapsed on the clock, not on a sweep.
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('pending');
  });

  it('sell:confirm: an expired trade stops blocking the sale, with no sweep', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();
    const dino = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [dino.id], eggIds: [], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    ctx.setNow(ctx.now() + 25 * 3_600_000);          // TRADE_EXPIRY_MS is 24h
    const comp = shopModule.components.find((c) => c.prefix === 'sell')!;
    const b = fakeButton({ customId: `sell:confirm:${dino.id}`, user: 'u1' });
    await comp.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(b.replies[0])).toContain('Sold for');
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, dino.id)).get()).toBeUndefined();
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('pending');
  });
});
