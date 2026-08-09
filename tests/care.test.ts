import { describe, it, expect, beforeEach } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, replyText } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { decorateLot } from '../src/modules/park/dinos.js';
import { feedDino, feedAll, rescueDino, feedCostFor, CareError } from '../src/modules/care/service.js';
import { careModule } from '../src/modules/care/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';
import { VERY_HUNGRY_MS } from '../src/core/autocomplete.js';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); ctx.economy.apply('u1', { foods: { ferns: 1_000 } }, 'seed', 0); });
const addDino = (over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();
const food = () => ctx.economy.getFoodInventory('u1').ferns ?? 0;
const dinoRow = (id: number) => ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;

describe('feedDino', () => {
  it('refills hunger to 100, charges feed cost, stamps lastFedAt', () => {
    const d = addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(24 * H);
    const before = food();
    const res = feedDino(ctx, 'u1', d.id);               // triceratops = common, feedCost 5
    expect(res.cost).toBe(5);
    expect(res.food.id).toBe('ferns');
    expect(food()).toBe(before - 5);
    const row = dinoRow(d.id);
    expect(row.hunger).toBe(100);
    expect(row.lastFedAt).toBe(24 * H);
  });
  it('refuses to feed an escaped dino', () => {
    const d = addDino({ escapedAt: 1 });
    expect(() => feedDino(ctx, 'u1', d.id)).toThrow(CareError);
  });
  it('hard-blocks feeding wrong-diet food even when named explicitly', () => {
    const d = addDino();                                       // triceratops, herbivore
    expect(() => feedDino(ctx, 'u1', d.id, 'fish'))
      .toThrow("Triceratops is a herbivore — it won't eat Fish.");
  });
  it('auto-picks the cheapest owned matching item and overfills with premium', () => {
    ctx.economy.apply('u1', { foods: { royal_greens: 100 } }, 'seed', 0);
    const d = addDino();
    // ferns (tier 1) owned from the task-wide seed — auto-pick prefers them over royal_greens
    const auto = feedDino(ctx, 'u1', d.id);
    expect(auto.food.id).toBe('ferns');
    const premium = feedDino(ctx, 'u1', d.id, 'royal_greens');
    expect(premium.food.fillTo).toBe(150);
    expect(dinoRow(d.id).hunger).toBe(150);
  });
  it('errors with a shop hint when no matching-diet food is held', () => {
    ctx.db.delete(schema.foodInventory).run();
    const d = addDino();
    expect(() => feedDino(ctx, 'u1', d.id)).toThrow('You have no herbivore food — buy Ferns with /shop food.');
  });

  it('discounts feed cost for Thrifty and surcharges it for Gluttonous', () => {
    expect(feedCostFor('rare', [], 0)).toBe(20);
    expect(feedCostFor('rare', ['thrifty'], 0)).toBe(15);
    expect(feedCostFor('rare', ['gluttonous'], 0)).toBe(25);
  });

  it('discounts a common feed cost to a sensible positive amount', () => {
    // Not a floor-guard test: common feedCost 5 * thrifty 0.75 = 3.75, well clear of the
    // Math.max(1, ...) floor in feedCostFor. Under today's data (single care-domain trait,
    // 5 the lowest feedCost) the floor is unreachable — see the comment at its definition —
    // so this only pins the discounted value itself, not the floor.
    expect(feedCostFor('common', ['thrifty'], 0)).toBe(4);
  });

  it('charges the discounted amount when feeding a Thrifty dino', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    // getOrCreateUser seeds STARTER_FOOD (10 ferns); economy.apply is a delta, not a set,
    // so clear it first — otherwise the credit below lands at 110, not 100.
    ctx.db.delete(schema.foodInventory).run();
    ctx.economy.apply('u1', { foods: { ferns: 100 } }, 'test', 0);
    const dino = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 10, lastFedAt: 0, hatchedAt: 0,
      traits: ['thrifty'],
    }).returning().get();

    feedDino(ctx, 'u1', dino.id, 'ferns');
    // common feedCost 5, thrifty 0.75 -> 4 (rounded)
    expect(ctx.economy.getFoodInventory('u1').ferns).toBe(96);
  });
});

describe('feedAll', () => {
  it('feeds hungriest-first and skips escaped dinos', () => {
    const hungry = addDino({ hunger: 100, lastFedAt: 0 });
    const escaped = addDino({ hunger: 100, lastFedAt: 0, escapedAt: 1 });
    ctx.setNow(48 * H);
    const { fed } = feedAll(ctx, 'u1');
    expect(fed).toContain(hungry.id);
    expect(fed).not.toContain(escaped.id);
    expect(dinoRow(hungry.id).hunger).toBe(100);
  });
  it('feeds as many as affordable, reports the rest skipped', () => {
    ctx.db.delete(schema.foodInventory).where(eq(schema.foodInventory.userId, 'u1')).run();
    ctx.db.insert(schema.foodInventory).values({ userId: 'u1', foodId: 'ferns', qty: 7 }).run();  // two commons need 5 each
    const a = addDino({ hunger: 100, lastFedAt: 0 });
    const b = addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(48 * H);
    const { fed, skipped } = feedAll(ctx, 'u1');
    expect(fed).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(food()).toBe(2);                              // 7 - 5
  });
  it('feedAll picks per-dino diets and reports spend per item', () => {
    ctx.economy.apply('u1', { foods: { fish: 100 } }, 'seed', 0);
    const herb = addDino({ hunger: 100, lastFedAt: 0 });
    const carn = ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'dilophosaurus', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    ctx.setNow(48 * H);
    const { fed, spent } = feedAll(ctx, 'u1');
    expect(fed).toEqual(expect.arrayContaining([herb.id, carn.id]));
    expect(spent.ferns).toBe(5);                               // common herbivore
    expect(spent.fish).toBe(10);                               // uncommon carnivore, feedCost 10
  });
});

describe('rescueDino', () => {
  it('rescues an escaped dino: charges the fee, clears escape, restores ~50% comfort', () => {
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    // triceratops in herb paddock, no decor → fit 0.75; escaped
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 0, lastFedAt: 0, hatchedAt: 0, escapedAt: 40 * 3_600_000 }).returning().get();
    const cashBefore = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash;
    const res = rescueDino(ctx, 'u1', d.id);
    expect(res.fee).toBe(4 * 60);                        // 4h * common incomePerHr(60) = 240
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(cashBefore - 240);
    const row = dinoRow(d.id);
    expect(row.escapedAt).toBeNull();
    // hunger = min(100, round(50/0.75)) = 67 → comfort = 0.67 * 0.75 ≈ 0.5
    expect(row.hunger).toBe(67);
  });
  // The `50 / fit` divisor must stay UNCLAMPED at an enriched fit (spec §14): a better
  // paddock needs LESS hunger to land the dino back at the same ~0.5 comfort, which is
  // the whole reason the restore is a division and not a constant. A Math.min(1, fit)
  // there would silently restore 50 at every rung, and docs/gameplay.md publishes these
  // exact figures. Decor goes on through the real decorateLot, so the stored slug shape
  // is exercised end-to-end rather than hand-assembled.
  const escapedIn = (lotId: number) => ctx.db.insert(schema.dinos).values({
    userId: 'u1', lotId, speciesId: 'triceratops', hunger: 0, lastFedAt: 0, hatchedAt: 0,
    escapedAt: 40 * 3_600_000,
  }).returning().get();

  it('restores 48 hunger at fit 1.05 — two matching decor kinds', () => {
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    decorateLot(ctx, 'u1', lot.id, 'palm_tree');
    decorateLot(ctx, 'u1', lot.id, 'fern');            // two distinct forest kinds → fit 1.05
    const d = escapedIn(lot.id);
    rescueDino(ctx, 'u1', d.id);
    // round(50 / 1.05) = 48 → comfort 0.48 × 1.05 ≈ 0.504, still the ~50% target.
    expect(dinoRow(d.id).hunger).toBe(48);
    expect(dinoRow(d.id).escapedAt).toBeNull();
  });

  it('restores 45 hunger at fit 1.10 — three matching decor kinds', () => {
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    decorateLot(ctx, 'u1', lot.id, 'palm_tree');
    decorateLot(ctx, 'u1', lot.id, 'fern');
    decorateLot(ctx, 'u1', lot.id, 'cycad_grove');     // third distinct forest kind → fit 1.10
    const d = escapedIn(lot.id);
    rescueDino(ctx, 'u1', d.id);
    // round(50 / 1.1) = 45 → comfort 0.45 × 1.1 ≈ 0.495.
    expect(dinoRow(d.id).hunger).toBe(45);
    expect(dinoRow(d.id).escapedAt).toBeNull();
  });

  it('refuses to rescue a dino that has not escaped', () => {
    const d = addDino();
    expect(() => rescueDino(ctx, 'u1', d.id)).toThrow(CareError);
  });
});

type CarePayload = { embeds: EmbedBuilder[]; files?: Array<{ name: string | null }> };
const careReply = (i: { replies: unknown[] }) => i.replies[0] as CarePayload;

describe('care module', () => {
  it('/feed all feeds hungry dinos via the command, replying with a Care embed', async () => {
    const d = addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(48 * 3_600_000);
    const i = fakeCommand({ name: 'feed', sub: 'all', user: 'u1' });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    expect(i.replies).toHaveLength(1);
    expect(dinoRow(d.id).hunger).toBe(100);
    const json = careReply(i).embeds[0].toJSON();
    expect(json.title).toBe('🍖 Care');                    // dw_food fallback — no emoji map in tests
    expect(json.description).toBe('Fed 1 dino(s) (−5 Ferns).');
  });

  it('/feed one replies with a Care embed describing the fed dino', async () => {
    const d = addDino({ hunger: 50, lastFedAt: 0 });
    ctx.setNow(24 * H);
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: d.id } });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    const json = careReply(i).embeds[0].toJSON();
    expect(json.title).toBe('🍖 Care');
    expect(json.description).toBe('Fed your Triceratops (−5 Ferns).');
  });

  it('care banner is care.webp when no dino is very hungry', async () => {
    addDino({ hunger: 100, lastFedAt: 1 * H });               // fed recently, well under VERY_HUNGRY_MS
    ctx.setNow(1 * H);
    const i = fakeCommand({ name: 'feed', sub: 'all', user: 'u1' });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    const payload = careReply(i);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://care.webp');
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('care.webp');
  });

  it('care banner is care_neglect.webp when a dino has gone unfed past VERY_HUNGRY_MS', async () => {
    const neglected = addDino({ hunger: 100, lastFedAt: 0 });  // never fed — stays behind
    const fedNow = addDino({ hunger: 100, lastFedAt: 0 });     // this one gets fed by the command below
    ctx.setNow(VERY_HUNGRY_MS + 4 * H);
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: fedNow.id } });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    expect(dinoRow(neglected.id).lastFedAt).toBe(0);           // confirms it really was left behind
    const payload = careReply(i);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://care_neglect.webp');
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('care_neglect.webp');
  });

  it('care banner stays care.webp when the long-unfed dino has escaped', async () => {
    const escaped = addDino({ hunger: 100, lastFedAt: 0, escapedAt: 1 }); // never fed, but escaped — must not count as neglected
    const fedNow = addDino({ hunger: 100, lastFedAt: 0 });                // this one gets fed by the command below
    ctx.setNow(VERY_HUNGRY_MS + 4 * H);
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: fedNow.id } });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    expect(dinoRow(escaped.id).lastFedAt).toBe(0);              // confirms it really was left unfed
    const payload = careReply(i);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://care.webp');
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('care.webp');
  });

  it('/feed one food:<id> passes the explicit pick through (wrong diet is an ephemeral error)', async () => {
    const d = addDino();
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: d.id, food: 'fish' } });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    const reply = i.replies[0] as { content?: string; flags?: unknown };
    expect(reply.content).toBe("Triceratops is a herbivore — it won't eat Fish.");
    expect(reply.flags).toBeDefined();
  });
});

describe('/rescue execute', () => {
  const rescueCmd = careModule.commands.find((c) => c.data.name === 'rescue')!;
  it('recaptures an escaped dino for the fee, replying with the rescue banner embed', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, escapedAt: 100,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as CarePayload;
    expect(payload.embeds[0].toJSON().description).toContain('Recaptured');
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://rescue.webp');
    expect(payload.files!.map((f) => f.name)).toEqual(['rescue.webp']);
    expect(ctx.db.select().from(schema.dinos).all()[0].escapedAt).toBeNull();
  });
  it('rejects a dino that has not escaped, ephemeral', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('not escaped');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
  it('maps InsufficientFundsError to the recapture-fee message', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, escapedAt: 100,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('recapture fee');
  });
});

describe('/feed one ownership check', () => {
  it('/feed one rejects a dino you do not own', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.insert(schema.dinos).values({
      userId: 'u2', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const cmd = careModule.commands.find((c) => c.data.name === 'feed')!;
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: dino.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(replyText(i.replies[0])).toContain('own');
  });
});
