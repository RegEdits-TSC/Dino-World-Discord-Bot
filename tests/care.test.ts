import { describe, it, expect, beforeEach } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { makeCtx, fakeCommand } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { feedDino, feedAll, rescueDino, CareError } from '../src/modules/care/service.js';
import { careModule } from '../src/modules/care/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';
import { VERY_HUNGRY_MS } from '../src/core/autocomplete.js';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); ctx.economy.apply('u1', { food: 1_000 }, 'seed', 0); });
const addDino = (over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();
const food = () => ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.food;
const dinoRow = (id: number) => ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;

describe('feedDino', () => {
  it('refills hunger to 100, charges feed cost, stamps lastFedAt', () => {
    const d = addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(24 * H);
    const before = food();
    const res = feedDino(ctx, 'u1', d.id);               // triceratops = common, feedCost 5
    expect(res.cost).toBe(5);
    expect(food()).toBe(before - 5);
    const row = dinoRow(d.id);
    expect(row.hunger).toBe(100);
    expect(row.lastFedAt).toBe(24 * H);
  });
  it('refuses to feed an escaped dino', () => {
    const d = addDino({ escapedAt: 1 });
    expect(() => feedDino(ctx, 'u1', d.id)).toThrow(CareError);
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
    ctx.db.update(schema.users).set({ food: 7 }).where(eq(schema.users.discordId, 'u1')).run();
    const a = addDino({ hunger: 100, lastFedAt: 0 });
    const b = addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(48 * H);
    const { fed, skipped } = feedAll(ctx, 'u1');
    expect(fed).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(food()).toBe(2);                              // 7 - 5
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
    expect(json.description).toBe('Fed 1 dino(s).');
  });

  it('/feed one replies with a Care embed describing the fed dino', async () => {
    const d = addDino({ hunger: 50, lastFedAt: 0 });
    ctx.setNow(24 * H);
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: d.id } });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    const json = careReply(i).embeds[0].toJSON();
    expect(json.title).toBe('🍖 Care');
    expect(json.description).toBe('Fed your Triceratops (−5 food).');
  });

  it('care banner is care.png when no dino is very hungry', async () => {
    addDino({ hunger: 100, lastFedAt: 1 * H });               // fed recently, well under VERY_HUNGRY_MS
    ctx.setNow(1 * H);
    const i = fakeCommand({ name: 'feed', sub: 'all', user: 'u1' });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    const payload = careReply(i);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://care.png');
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('care.png');
  });

  it('care banner is care_neglect.png when a dino has gone unfed past VERY_HUNGRY_MS', async () => {
    const neglected = addDino({ hunger: 100, lastFedAt: 0 });  // never fed — stays behind
    const fedNow = addDino({ hunger: 100, lastFedAt: 0 });     // this one gets fed by the command below
    ctx.setNow(VERY_HUNGRY_MS + 4 * H);
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: fedNow.id } });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    expect(dinoRow(neglected.id).lastFedAt).toBe(0);           // confirms it really was left behind
    const payload = careReply(i);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://care_neglect.png');
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('care_neglect.png');
  });

  it('care banner stays care.png when the long-unfed dino has escaped', async () => {
    const escaped = addDino({ hunger: 100, lastFedAt: 0, escapedAt: 1 }); // never fed, but escaped — must not count as neglected
    const fedNow = addDino({ hunger: 100, lastFedAt: 0 });                // this one gets fed by the command below
    ctx.setNow(VERY_HUNGRY_MS + 4 * H);
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: fedNow.id } });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    expect(dinoRow(escaped.id).lastFedAt).toBe(0);              // confirms it really was left unfed
    const payload = careReply(i);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://care.png');
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('care.png');
  });
});
