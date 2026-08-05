import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dailyEggOffers, dailyDeal, todaysDeal, buyEgg, buyFood, eggPriceAt, foodPriceAt, roundCharge, ShopError } from '../src/modules/shop/service.js';
import { shopModule } from '../src/modules/shop/index.js';
import { createTrade } from '../src/modules/trading/service.js';
import { locksFor } from '../src/core/locks.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';
import { TRADE_MIN_RATING } from '../src/data/trade.js';
import { SHOP_EGG_PRICES, DEAL_EGG_DISCOUNT, DEAL_FOOD_DISCOUNT } from '../src/data/shop.js';
import { FOODS } from '../src/data/foods.js';
import { eventMods } from '../src/core/world.js';

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

describe('shop daily rotation', () => {
  it('varies day to day even at the two-rarity ceiling', () => {
    // highWater 0 => ceiling uncommon, pool {common, uncommon}. dailyEggOffers
    // slices 3 from a 2-entry pool, so the offer SET can never vary there (see
    // "sorts before comparing sets" below) — the deal is the only thing that
    // gives these exact players day-to-day variety, so that's what this test
    // has to assert on instead of the offers array.
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) {
      const offers = dailyEggOffers(0, d * DAY);
      seen.add(JSON.stringify(dailyDeal(offers, d * DAY)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  // NOTE: an earlier version of this test asserted
  // `expect(offers).toContain(dailyDeal(offers, d * DAY).rarity)` feeding the
  // PLAYER's own offers into dailyDeal directly — a shape production never
  // takes. eggPriceAt/foodPriceAt go through todaysDeal (uncommon-ceiling
  // offers, service.ts), not the viewer's own offers, so that assertion
  // proved nothing about what a real epic/legendary-ceiling player sees.
  // Rewritten against the real production entry point:
  //   expect(dailyEggOffers(highWater, d * DAY)).toContain(todaysDeal(d * DAY).rarity)
  // fails immediately (first failure observed: highWater 450, day 0 —
  // offers ['epic','rare','common'], todaysDeal.rarity 'uncommon', ~24.5% of
  // days over 2000 sampled at highWater 500) because todaysDeal is only ever
  // drawn from the uncommon-ceiling pool and is never widened to the caller's
  // own ceiling (a deliberate, separate, out-of-scope decision — see
  // todaysDeal's doc comment in service.ts). The two tests below pin the
  // actual mitigation instead: /shop view gates the egg half of the Daily
  // Deal line on the viewer's own rotation.
  it('the Daily Deal line omits the egg half when the deal rarity is outside the viewer\'s own rotation', async () => {
    const shopCtx = makeCtx({ nowMs: 0 });
    getOrCreateUser(shopCtx, 'u1', 'u1');
    shopCtx.db.update(schema.users).set({ ratingHighWater: 500 }).where(eq(schema.users.discordId, 'u1')).run();
    const offers = dailyEggOffers(500, shopCtx.now());
    const deal = todaysDeal(shopCtx.now());
    expect(offers).not.toContain(deal.rarity);   // sanity: day 0 at highWater 500 is exactly the gated case
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(shopCtx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const dealField = payload.embeds[0].toJSON().fields!.find((f) => f.name.includes('Daily Deal'))!;
    expect(dealField.value).not.toContain('egg —');
    expect(dealField.value).toContain(FOODS[deal.food].name);   // food half always shows — no rotation gate
  });

  it('the Daily Deal line includes the egg half when the deal rarity IS in the viewer\'s own rotation', async () => {
    const shopCtx = makeCtx({ nowMs: 0 });
    getOrCreateUser(shopCtx, 'u1', 'u1');   // default highWater 0 -> uncommon ceiling, offers always {common, uncommon}
    const offers = dailyEggOffers(0, shopCtx.now());
    const deal = todaysDeal(shopCtx.now());
    expect(offers).toContain(deal.rarity);   // sanity: this ceiling always contains the deal
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(shopCtx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const dealField = payload.embeds[0].toJSON().fields!.find((f) => f.name.includes('Daily Deal'))!;
    expect(dealField.value).toContain('egg —');
    expect(dealField.value).toContain(`${eggPriceAt(deal.rarity, shopCtx.now()).toLocaleString()}** cash`);
  });

  it('/shop view\'s Daily Deal field pins the exact composed (event + deal) price, not a recomputed one', async () => {
    // Day 38 is Market Panic (eggPrice x0.70); day-38's deal is 'uncommon',
    // and highWater 0's offers always include it, so the egg half is shown.
    const shopCtx = makeCtx({ nowMs: 38 * DAY });
    getOrCreateUser(shopCtx, 'u1', 'u1');
    const deal = todaysDeal(shopCtx.now());
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(shopCtx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const dealField = payload.embeds[0].toJSON().fields!.find((f) => f.name.includes('Daily Deal'))!;
    const eventOnly = roundCharge(SHOP_EGG_PRICES[deal.rarity], eventMods(shopCtx.now()).eggPrice);
    const composed = eggPriceAt(deal.rarity, shopCtx.now());
    expect(eventOnly).toBe(2000 * 0.70);           // 1400, the struck-through number — no deal folded in
    expect(composed).toBe(1120);                    // 2000 * 0.70 * 0.80, deal AND event both folded in
    expect(dealField.value).toContain(`~~${eventOnly.toLocaleString()}~~ **${composed.toLocaleString()}** cash`);
  });

  it('composes the daily deal with the day\'s event, not just one or the other', () => {
    // uncommon is day 38's (Market Panic, eggPrice x0.70) and day 18's
    // (Bumper Harvest, eggPrice x1.25) deal rarity; ferns is day 18's
    // (foodPrice x0.60) deal food. Verified directly against the real
    // eggPriceAt/foodPriceAt before writing these as literals.
    expect(eggPriceAt('uncommon', 38 * DAY)).toBe(1120);   // 2000 * 0.70 * 0.80; float product is 1120.0000000000002 — round, not ceil (would be 1121)
    expect(foodPriceAt(FOODS.ferns, 18 * DAY)).toBe(5);    // 10 * 0.60 * 0.75 is exactly 4.5 — round, not floor (would be 4)
    expect(eggPriceAt('uncommon', 18 * DAY)).toBe(2000);   // bumper_harvest's 1.25 exactly cancels the 0.80 deal
  });

  it('pins an absolute deal price — not just a discount-relative one', () => {
    // Every other deal assertion in this file is either strictly-less-than or
    // derived from DEAL_EGG_DISCOUNT/DEAL_FOOD_DISCOUNT, so a change to those
    // constants (e.g. 0.8 -> 0.95) would leave the whole suite green. These
    // two absolute numbers close that gap.
    expect(eggPriceAt('uncommon', 0)).toBe(1600);
    expect(foodPriceAt(FOODS.royal_greens, 0)).toBe(15);
  });

  it('gives every player the same deal food on the same day, whatever their ceiling', () => {
    // The deal's own stream must not depend on how many draws dailyEggOffers
    // used — proof dailyDeal is never riding dailyEggOffers' rng instance.
    // (Rarity alone isn't a valid probe here: it's an index into offers, and
    // offers.length legitimately differs by ceiling, so two ceilings can
    // validly land on two different rarities from the exact same rng draw.
    // The food draw is the second call on dailyDeal's OWN fresh generator and
    // never depends on offers.length at all, so it must always agree.)
    for (let d = 0; d < 30; d++) {
      const lowCeil = dailyDeal(dailyEggOffers(0, d * DAY), d * DAY);
      const highCeil = dailyDeal(dailyEggOffers(750, d * DAY), d * DAY);
      expect(lowCeil.food, `day ${d}`).toBe(highCeil.food);
    }
  });

  it('never makes anything free', () => {
    for (let d = 0; d < 100; d++) {
      const offers = dailyEggOffers(750, d * DAY);
      const deal = dailyDeal(offers, d * DAY);
      expect(eggPriceAt(deal.rarity, d * DAY)).toBeGreaterThan(0);
    }
  });

  it('sorts before comparing sets — the ORDER varies even when the set cannot', () => {
    // Guard against a future test asserting deep equality on the array: the
    // uncommon ceiling's 2-entry pool always slices down to the same SET, but
    // shuffle() still reorders it day to day. Both halves of the claim: the
    // raw (unsorted) arrays really do differ day to day (day 0 is
    // ['uncommon','common'], day 38 is ['common','uncommon']), while the
    // sorted sets agree.
    expect(dailyEggOffers(0, 0)).not.toEqual(dailyEggOffers(0, 38 * DAY));
    const a = [...dailyEggOffers(0, 0)].sort();
    const b = [...dailyEggOffers(0, 7 * DAY)].sort();
    expect(a).toEqual(b);
  });

  it('charges the deal price when buying the discounted rarity — never display-only', () => {
    const deal = todaysDeal(ctx.now());
    const before = bal().cash;
    buyEgg(ctx, 'u1', deal.rarity);
    const charged = before - bal().cash;
    // Pinned against the real charge, not a recomputed expectation, so a bug
    // that discounts the /shop view line but not buyEgg's own price can't
    // pass by both sides drifting together.
    expect(charged).toBe(eggPriceAt(deal.rarity, ctx.now()));
    expect(charged).toBeLessThan(SHOP_EGG_PRICES[deal.rarity]);
  });

  it('charges the deal price when buying the discounted food — never display-only', () => {
    const deal = todaysDeal(ctx.now());
    const before = bal().cash;
    const { total } = buyFood(ctx, 'u1', deal.food, 10);
    const charged = before - bal().cash;
    expect(charged).toBe(total);
    const undiscountedTotal = 10 * FOODS[deal.food].unitCost;
    expect(total).toBeLessThan(undiscountedTotal);
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
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
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
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
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
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
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
