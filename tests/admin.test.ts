import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, pendingIncome } from '../src/modules/park/service.js';
import { requireOwner } from '../src/modules/admin/guard.js';
import { adminGive, adminReset, adminFastForward, AdminError } from '../src/modules/admin/service.js';
import { adminModule } from '../src/modules/admin/index.js';
import { createTrade } from '../src/modules/trading/service.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });   // config.ownerId === 'owner'

describe('requireOwner', () => {
  it('lets the owner through with no reply', async () => {
    const cmd = fakeCommand({ name: 'admin', sub: 'give', user: 'owner' });
    expect(await requireOwner(ctx, cmd.asChatInput())).toBe(true);
    expect(cmd.replies).toHaveLength(0);
  });
  it('rejects a non-owner ephemerally', async () => {
    const cmd = fakeCommand({ name: 'admin', sub: 'give', user: 'mallory' });
    expect(await requireOwner(ctx, cmd.asChatInput())).toBe(false);
    expect((cmd.replies[0] as { content: string }).content).toContain('Owner only');
  });
});

describe('adminGive', () => {
  it('grants cash + a dino atomically and recomputes rating', () => {
    getOrCreateUser(ctx, 'p', 'P');   // starts with 500 cash
    adminGive(ctx, 'p', 'P', { cash: 1000, dinoSpecies: 'triceratops' });
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.cash).toBe(1500);
    const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).all();
    expect(dinos).toHaveLength(1);
    expect(dinos[0].speciesId).toBe('triceratops');
    expect(u.parkRating).toBeGreaterThan(0);   // recomputed with the new dino
  });
  it('grants an egg with the admin source and null species', () => {
    adminGive(ctx, 'p', 'P', { eggRarity: 'legendary' });   // getOrCreateUser seeds p
    const egg = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).get()!;
    expect(egg.rarity).toBe('legendary');
    expect(egg.source).toBe('admin');
    expect(egg.speciesId).toBeNull();
  });
  it('rejects an empty give and an unknown species', () => {
    expect(() => adminGive(ctx, 'p', 'P', {})).toThrow(AdminError);
    expect(() => adminGive(ctx, 'p', 'P', { dinoSpecies: 'godzilla' })).toThrow(AdminError);
  });
  it('grants a typed food stack', () => {
    adminGive(ctx, 'p', 'P', { food: { foodId: 'goat', qty: 5 } });   // getOrCreateUser seeds p
    expect(ctx.economy.getFoodInventory('p').goat).toBe(5);
  });
});

describe('adminReset', () => {
  it('wipes a player’s stuff and restores new-player defaults', () => {
    getOrCreateUser(ctx, 'p', 'P');
    adminGive(ctx, 'p', 'P', { cash: 9000, shards: 50, dinoSpecies: 'triceratops', eggRarity: 'rare' });
    ctx.db.insert(schema.lots).values({ userId: 'p', type: 'paddock', kind: 'carnivore_paddock', name: 'Pen' }).run();
    adminReset(ctx, 'p');
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.cash).toBe(500);
    expect(ctx.economy.getFoodInventory('p')).toEqual({ ferns: 10, fish: 10 });
    expect(u.shards).toBe(0);
    expect(u.parkRating).toBe(0);
    expect(u.ratingHighWater).toBe(0);
    expect(u.parkName).toBe('New Park');
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'p')).all()).toHaveLength(0);
    expect(u.displayName).toBe('P');   // user row kept
  });
});

describe('adminReset + trades', () => {
  it('unlocks a counterparty’s escrowed items when the reset target is the recipient', () => {
    getOrCreateUser(ctx, 'o', 'O');
    getOrCreateUser(ctx, 't', 'T');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();   // both 2★ so createTrade passes
    const dino = ctx.db.insert(schema.dinos).values({ userId: 'o', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    createTrade(ctx, 'o', 't', { dinoIds: [dino.id], eggIds: [], cash: 0, foods: {} }, { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    // dino now locked, owned by o, in a pending o->t trade
    adminReset(ctx, 't');   // t is the RECIPIENT
    const d = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, dino.id)).get()!;
    expect(d.userId).toBe('o');     // still o's
    expect(d.locked).toBe(false);   // unlocked, not stranded
  });
});

describe('adminFastForward', () => {
  it('advances income and starves an assigned dino into escaping', () => {
    getOrCreateUser(ctx, 'p', 'P');   // lastCollectAt = now = 0
    const lot = ctx.db.insert(schema.lots).values({ userId: 'p', type: 'paddock', kind: 'carnivore_paddock', name: 'Pen' }).returning().get();
    ctx.db.insert(schema.dinos).values({ userId: 'p', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    const escaped = adminFastForward(ctx, 'p', 720);   // 30 days back
    expect(escaped).toBe(1);                            // starved past the escape threshold
    expect(pendingIncome(ctx, 'p')).toBeGreaterThan(0); // income accrued over the elapsed time
    const d = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).get()!;
    expect(d.escapedAt).not.toBeNull();
  });
  it('rejects hours outside 1..720', () => {
    expect(() => adminFastForward(ctx, 'p', 0)).toThrow(AdminError);
    expect(() => adminFastForward(ctx, 'p', 721)).toThrow(AdminError);
  });
});

async function run(user: string, sub: string, options: Record<string, string | number>) {
  const cmd = fakeCommand({ name: 'admin', sub, user, options });
  await adminModule.commands[0].execute(ctx, cmd.asChatInput());
  return cmd;
}

describe('admin module', () => {
  it('blocks a non-owner and mutates nothing', async () => {
    getOrCreateUser(ctx, 't', 'T');
    const cmd = await run('mallory', 'give', { user: 't', cash: 5000 });
    expect((cmd.replies[0] as { content: string }).content).toContain('Owner only');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 't')).get()!.cash).toBe(500);
  });
  it('owner give adds the cash', async () => {
    await run('owner', 'give', { user: 't', cash: 250 });
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 't')).get()!.cash).toBe(750);
  });
  it('inspect returns an ephemeral embed with the player state', async () => {
    getOrCreateUser(ctx, 't', 'T');           // 500 cash by default
    adminGive(ctx, 't', 'T', { cash: 777 });  // -> 1277
    const cmd = await run('owner', 'inspect', { user: 't' });
    const reply = cmd.replies[0] as { embeds: Array<{ data: { fields: Array<{ value: string }> } }>; flags?: number };
    expect(reply.embeds).toHaveLength(1);
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    const values = reply.embeds[0].data.fields.map((f) => f.value).join(' ');
    expect(values).toContain('1277');   // cash field reflects the real state
  });
  it('reset requires the confirm to equal the target id', async () => {
    getOrCreateUser(ctx, 't', 'T');
    adminGive(ctx, 't', 'T', { cash: 9000 });
    const bad = await run('owner', 'reset', { user: 't', confirm: 'wrong' });
    expect((bad.replies[0] as { content: string }).content).toContain('confirm');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 't')).get()!.cash).toBe(9500);
    await run('owner', 'reset', { user: 't', confirm: 't' });
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 't')).get()!.cash).toBe(500);
  });
  it('reset on a player with no park aborts cleanly', async () => {
    const cmd = await run('owner', 'reset', { user: 'ghost', confirm: 'ghost' });
    expect((cmd.replies[0] as { content: string }).content).toContain('no park to reset');
  });
  it('/admin fast-forward shifts time through the command layer', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'target', 'target');
    const cmd = adminModule.commands[0];
    const i = fakeCommand({ name: 'admin', sub: 'fast-forward', user: 'owner', options: { user: 'target', hours: 24 } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Fast-forwarded');
  });
  it('/admin give rejects half-set food pairing', async () => {
    const ctx = makeCtx();
    const cmd = adminModule.commands[0];
    const i = fakeCommand({ name: 'admin', sub: 'give', user: 'owner', options: { user: 'target', 'food-item': 'ferns' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Set both food-item and food-qty');
  });
});
