import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, replyText } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, activeExpedition, claimExpedition, listSites, ExpeditionError } from '../src/modules/expeditions/service.js';
import { schema } from '../src/core/db/index.js';
import { STARTER_FOOD } from '../src/data/foods.js';
import { eq } from 'drizzle-orm';
import { assetImage } from '../src/core/images.js';

// assetImage is a pass-through spy by default (calls the real implementation),
// so every test in this file except the two degrade-path tests below is
// unaffected. Those two override exactly one queued call via
// mockImplementationOnce to force a miss without touching real asset files.
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return { ...actual, assetImage: vi.fn(actual.assetImage) };
});

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0); });

describe('expeditions', () => {
  it('lists only unlocked sites by high-water', () => {
    expect(listSites(0).map((s) => s.id)).toEqual(['coastal_dig']);
    expect(listSites(400).length).toBe(4);
  });
  it('starts an expedition, charges cost, enqueues a return timer, blocks a second start', () => {
    const exp = startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    expect(exp.returnsAt).toBe(ctx.now() + 15 * 60_000);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(500 + 50_000 - 200); // 500 starting + 50,000 seed - 200 cost
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
    expect(() => startExpedition(ctx, 'u1', 'coastal_dig', 'g1')).toThrow(ExpeditionError);
  });
  it('rejects a locked site', () => {
    expect(() => startExpedition(ctx, 'u1', 'volcano_core', 'g1')).toThrow(ExpeditionError);
  });
  it('claim before return fails; claim after return yields an egg + bonuses and unblocks the next start', () => {
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    expect(() => claimExpedition(ctx, 'u1')).toThrow(ExpeditionError);
    ctx.setNow(ctx.now() + 15 * 60_000);
    const { loot } = claimExpedition(ctx, 'u1');
    expect(['common', 'uncommon']).toContain(loot.eggRarity);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all()).toHaveLength(1);
    expect(loot.food.qty).toBeGreaterThanOrEqual(2);
    expect(['ferns', 'fish']).toContain(loot.food.foodId);
    expect(ctx.economy.getFoodInventory('u1')[loot.food.foodId]).toBe((STARTER_FOOD[loot.food.foodId] ?? 0) + loot.food.qty);
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
  });
});

import { expeditionsModule } from '../src/modules/expeditions/index.js';

describe('expeditions module', () => {
  it('/expedition start dispatches and enqueues a return timer', async () => {
    const i = fakeCommand({ name: 'expedition', sub: 'start', user: 'u1', guild: 'g1', options: { site: 'coastal_dig' } });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    expect(i.replies).toHaveLength(1);
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
  });
  it('/expedition claim on nothing gives an ephemeral error', async () => {
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    expect((i.replies[0] as { flags?: unknown }).flags).toBeDefined();   // ephemeral
  });
});

describe('expedition visuals', () => {
  it('/expedition start replies with a site embed', async () => {
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    const i = fakeCommand({ name: 'expedition', sub: 'start', user: 'u1', guild: 'g1', options: { site: 'coastal_dig' } });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> };
    expect(payload.embeds[0].toJSON().title).toBe('🧭 🐚 Coastal Dig');
  });
  it('/expedition claim ships the site banner AND thumb together', async () => {
    // Two assets in one payload: the second assetImage must APPEND. A plain
    // `payload.files = [thumb.file]` drops the banner and leaves the embed's
    // image pointing at an attachment:// URL that was never uploaded.
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; image?: { url: string }; thumbnail?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toBe('🧭 🐚 Coastal Dig — returned!');
    expect(embed.image?.url).toBe('attachment://coastal_dig-banner.png');
    expect(embed.thumbnail?.url).toBe('attachment://coastal_dig-thumb.png');
    const names = payload.files!.map((f) => f.name);
    expect(names).toContain('coastal_dig-banner.png');
    expect(names).toContain('coastal_dig-thumb.png');
  });
  it('/expedition claim still attaches the thumb when the banner is missing', async () => {
    // Degrade path 1/2: the two assetImage lookups are independent `if`
    // blocks — a miss on the banner call must not suppress the thumb.
    vi.mocked(assetImage).mockImplementationOnce(() => null);   // banner call (1st) -> missing
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    expect(i.replies).toHaveLength(1);   // embed still sends
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; image?: { url: string }; thumbnail?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toBe('🧭 🐚 Coastal Dig — returned!');
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail?.url).toBe('attachment://coastal_dig-thumb.png');
    expect(payload.files!.map((f) => f.name)).toEqual(['coastal_dig-thumb.png']);
  });
  it('/expedition claim still attaches the banner when the thumb is missing', async () => {
    // Degrade path 2/2: the mirror case — a miss on the thumb call must not
    // suppress the banner that was already appended to payload.files.
    const { assetImage: realAssetImage } = await vi.importActual<typeof import('../src/core/images.js')>('../src/core/images.js');
    vi.mocked(assetImage)
      .mockImplementationOnce((kind, name) => realAssetImage(kind, name))   // banner call (1st) -> real
      .mockImplementationOnce(() => null);                                 // thumb call (2nd) -> missing
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    expect(i.replies).toHaveLength(1);   // embed still sends
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; image?: { url: string }; thumbnail?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toBe('🧭 🐚 Coastal Dig — returned!');
    expect(embed.image?.url).toBe('attachment://coastal_dig-banner.png');
    expect(embed.thumbnail).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['coastal_dig-banner.png']);
  });
  it('/expedition status with none active is an ephemeral hint', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = expeditionsModule.commands.find((c) => c.data.name === 'expedition')!;
    const i = fakeCommand({ name: 'expedition', sub: 'status', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('No active expedition');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
  it('/expedition status while digging shows the countdown embed', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    startExpedition(ctx, 'u1', 'coastal_dig', null);
    const cmd = expeditionsModule.commands.find((c) => c.data.name === 'expedition')!;
    const i = fakeCommand({ name: 'expedition', sub: 'status', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    const embeds = (i.replies[0] as { embeds?: Array<{ toJSON?: () => unknown }> }).embeds ?? [];
    expect(embeds.length).toBe(1);
    expect(JSON.stringify(embeds.map((e) => (e.toJSON ? e.toJSON() : e)))).toContain('Digging');
  });
});
