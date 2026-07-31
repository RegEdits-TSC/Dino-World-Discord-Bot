import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { incubateEgg, hatchEgg, incubatorSlots, HatcheryError } from '../src/modules/hatchery/service.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';
import { preHatchPayload, eggListPayload, revealPayload } from '../src/modules/hatchery/embeds.js';
import { getSpecies } from '../src/data/species/index.js';
import { mythicSpeciesChoices } from '../src/modules/shop/shards.js';
import { RARITY } from '../src/data/rarity.js';
import { assetImage } from '../src/core/images.js';
import { createTrade } from '../src/modules/trading/service.js';

// assetImage is a pass-through spy by default (calls the real implementation),
// so every test in this file except the two degrade-path tests below is
// unaffected. Those two override exactly one queued call via
// mockImplementationOnce to force a miss without touching real asset files.
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return { ...actual, assetImage: vi.fn(actual.assetImage) };
});

const M = 60_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });
const addEgg = (rarity: string, speciesId: string | null = null) =>
  ctx.db.insert(schema.eggs).values({ userId: 'u1', rarity: rarity as never, speciesId, source: 'expedition', obtainedAt: 0 }).returning().get();

describe('hatchery', () => {
  it('incubates an egg, sets hatchesAt by rarity, enqueues a hatch timer', () => {
    const egg = addEgg('common');
    const inc = incubateEgg(ctx, 'u1', egg.id, 'g1');
    expect(inc.hatchesAt).toBe(ctx.now() + 15 * M);
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
  });
  it('blocks incubating beyond the slot limit (1 without a Hatchery Lab)', () => {
    const a = addEgg('common'); const b = addEgg('common');
    incubateEgg(ctx, 'u1', a.id, 'g1');
    expect(() => incubateEgg(ctx, 'u1', b.id, 'g1')).toThrow(HatcheryError);
    expect(incubatorSlots([])).toBe(1);
  });
  it('hatch before ready fails; hatch after ready creates a dino of the egg rarity and removes the egg', () => {
    const egg = addEgg('rare');
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    expect(() => hatchEgg(ctx, 'u1', egg.id)).toThrow(HatcheryError);
    ctx.setNow(ctx.now() + 4 * 3_600_000);
    const { species, dinoId } = hatchEgg(ctx, 'u1', egg.id);
    expect(species.rarity).toBe('rare');
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()).toBeUndefined();
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, dinoId)).get()!.speciesId).toBe(species.id);
  });
  it('a preset-species egg hatches exactly that species', () => {
    const egg = addEgg('mythic', 'indominus');
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    ctx.setNow(ctx.now() + 48 * 3_600_000);
    expect(hatchEgg(ctx, 'u1', egg.id).species.id).toBe('indominus');
  });

  it('refuses to incubate an egg escrowed in a pending trade', () => {
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, locked: true })
      .returning().get();
    expect(() => incubateEgg(ctx, 'u1', egg.id, 'g1')).toThrow(HatcheryError);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!.incubationStartedAt).toBeNull();
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(0);
  });

  it('refuses to hatch an egg that was locked after incubation started', () => {
    // Unreachable through services — createTrade refuses an incubating egg and is the
    // only writer of eggs.locked — so the belt guard is exercised by locking the row
    // directly, which is exactly the pre-existing state bug 1 could leave behind.
    const egg = addEgg('common');
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    ctx.db.update(schema.eggs).set({ locked: true }).where(eq(schema.eggs.id, egg.id)).run();
    ctx.setNow(ctx.now() + 15 * M);
    expect(() => hatchEgg(ctx, 'u1', egg.id)).toThrow(HatcheryError);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()).toBeDefined();
    expect(ctx.db.select().from(schema.dinos).all()).toHaveLength(0);
  });
});

describe('hatchery module', () => {
  it('/eggs replies with an embed', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'eggs', user: 'u1' });
    await hatcheryModule.commands[0].execute(ctx, i.asChatInput());
    expect((i.replies[0] as { embeds: unknown[] }).embeds).toHaveLength(1);
  });
  it('the crack button hatches and reveals the species', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const egg = addEgg('common');
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    ctx.setNow(ctx.now() + 15 * 60_000);
    const b = fakeButton({ customId: `hatch:crack:${egg.id}`, user: 'u1', guild: 'g1' });
    // harness has no asButton(); asInteraction() carries the same raw object (customId/update/user resolve)
    await hatcheryModule.components[0].execute(ctx, b.asInteraction() as ButtonInteraction);
    // reveal payload recorded via update()
    const payload = b.replies[0] as { embeds: unknown[] };
    expect(payload.embeds).toHaveLength(1);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'u1')).all()).toHaveLength(1);
  });
});

describe('hatchery visuals', () => {
  it('preHatchPayload sets the hero egg image and attaches the file', () => {
    const p = preHatchPayload('rare', 7);
    expect(p.embeds[0].toJSON().image?.url).toBe('attachment://rare.webp');
    expect(p.files).toHaveLength(1);
    expect(p.components).toHaveLength(1); // crack button preserved
  });
  it('preHatchPayload degrades to no image when the asset is missing', () => {
    const p = preHatchPayload('not-a-rarity', 7);
    expect(p.embeds[0].toJSON().image).toBeUndefined();
    expect(p.files).toBeUndefined();
  });
  it('revealPayload swaps the intact egg for the rarity crack, thumbnails the archetype, and keeps attachments cleared', () => {
    // attachments: [] is load-bearing — discord.js pushes the new descriptors into
    // the array we pass, so the pre-hatch egg upload is dropped and only these two
    // survive on the edited message.
    const p = revealPayload(getSpecies('velociraptor'));   // rare, swift/carnivore
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://rare-crack.webp');
    expect(embed.thumbnail?.url).toBe('attachment://swift-carnivore.webp');
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.webp', 'swift-carnivore.webp']);
    expect(p.attachments).toEqual([]);
  });
  it('revealPayload keys the thumbnail off the hatched species, not a constant', () => {
    const p = revealPayload(getSpecies('triceratops'));   // common, tank/herbivore
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://tank-herbivore.webp');
    expect(p.files.map((f) => f.name)).toEqual(['common-crack.webp', 'tank-herbivore.webp']);
  });
  it('revealPayload still ships the archetype thumb when the crack art is missing', () => {
    // Degrade path 1/2: two files on one payload, two independent attach calls —
    // a miss on the crack must not suppress the thumb.
    vi.mocked(assetImage).mockImplementationOnce(() => null);   // crack call (1st) -> missing
    const p = revealPayload(getSpecies('velociraptor'));
    const embed = p.embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail?.url).toBe('attachment://swift-carnivore.webp');
    expect(p.files.map((f) => f.name)).toEqual(['swift-carnivore.webp']);
  });
  it('revealPayload still ships the crack when the archetype art is missing', async () => {
    // Degrade path 2/2: the mirror case — a miss on the thumb must not drop the
    // crack that attach already appended to payload.files.
    const { assetImage: realAssetImage } = await vi.importActual<typeof import('../src/core/images.js')>('../src/core/images.js');
    vi.mocked(assetImage)
      .mockImplementationOnce((kind, name) => realAssetImage(kind, name))   // crack call (1st) -> real
      .mockImplementationOnce(() => null);                                  // thumb call (2nd) -> missing
    const p = revealPayload(getSpecies('velociraptor'));
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://rare-crack.webp');
    expect(embed.thumbnail).toBeUndefined();
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.webp']);
  });
  it('reveal embed points at /dino assign', () => {
    const p = revealPayload(getSpecies('velociraptor'));
    expect(p.embeds[0].toJSON().footer?.text).toContain('/dino assign');
  });
  it('eggListPayload thumbnails the ready egg over incubating and newest, under the incubator banner', () => {
    const ready = { ...addEgg('epic'), hatchesAt: 5, incubationStartedAt: 1 };
    const incubating = { ...addEgg('rare'), hatchesAt: 999_999, incubationStartedAt: 1 };
    const newest = addEgg('common');
    const p = eggListPayload([newest, incubating, ready], 10, 'u1');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://epic.webp');
    expect(p.embeds[0].toJSON().image?.url).toBe('attachment://eggs_incubator.webp');
    expect(p.files!.map((f) => f.name)).toEqual(['epic.webp', 'eggs_incubator.webp']);
  });
  it('eggListPayload still ships the incubator banner when the featured thumb is missing', () => {
    // Degrade path 1/2: the two assetImage lookups are independent `if` blocks —
    // a miss on the thumb call must not suppress the banner.
    vi.mocked(assetImage).mockImplementationOnce(() => null);   // thumb call (1st) -> missing
    const ready = { ...addEgg('epic'), hatchesAt: 5, incubationStartedAt: 1 };
    const p = eggListPayload([ready], 10, 'u1');
    const embed = p.embeds[0].toJSON();
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.image?.url).toBe('attachment://eggs_incubator.webp');
    expect(p.files!.map((f) => f.name)).toEqual(['eggs_incubator.webp']);
  });
  it('eggListPayload still ships the featured thumb when the incubator banner is missing', async () => {
    // Degrade path 2/2: the mirror case — a miss on the banner call must not
    // suppress the thumb that was already appended to payload.files.
    const { assetImage: realAssetImage } = await vi.importActual<typeof import('../src/core/images.js')>('../src/core/images.js');
    vi.mocked(assetImage)
      .mockImplementationOnce((kind, name) => realAssetImage(kind, name))   // thumb call (1st) -> real
      .mockImplementationOnce(() => null);                                 // banner call (2nd) -> missing
    const ready = { ...addEgg('epic'), hatchesAt: 5, incubationStartedAt: 1 };
    const p = eggListPayload([ready], 10, 'u1');
    const embed = p.embeds[0].toJSON();
    expect(embed.thumbnail?.url).toBe('attachment://epic.webp');
    expect(embed.image).toBeUndefined();
    expect(p.files!.map((f) => f.name)).toEqual(['epic.webp']);
  });
  it('eggListPayload falls back to newest-obtained when nothing is incubating', () => {
    const older = { ...addEgg('common'), obtainedAt: 1 };
    const newer = { ...addEgg('legendary'), obtainedAt: 2 };
    const p = eggListPayload([older, newer], 10, 'u1');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://legendary.webp');
  });
  it('eggListPayload with no eggs has no thumbnail but still banners the incubator', () => {
    const p = eggListPayload([], 10, 'u1');
    expect(p.embeds[0].toJSON().thumbnail).toBeUndefined();
    expect(p.files!.map((f) => f.name)).toEqual(['eggs_incubator.webp']);
  });
});

describe('egg list pagination', () => {
  it('/eggs with 11 eggs shows Page 1/2 footer and a hatch:eggs:u1:2 Next button', async () => {
    for (let n = 0; n < 11; n++) addEgg('common');
    const i = fakeCommand({ name: 'eggs', user: 'u1' });
    await hatcheryModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { footer?: { text: string } } }>;
      components: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }>;
    };
    expect(payload.embeds[0].toJSON().footer?.text).toBe('Page 1/2');
    expect(payload.components[0].toJSON().components[1].custom_id).toBe('hatch:eggs:u1:2');
  });
  it('hatch:eggs button click by the owner updates to page 2', async () => {
    for (let n = 0; n < 11; n++) addEgg('common');
    const b = fakeButton({ customId: 'hatch:eggs:u1:2', user: 'u1', guild: 'g1' });
    const hatchComponent = hatcheryModule.components.find((c) => c.prefix === 'hatch')!;
    await hatchComponent.execute(ctx, b.asInteraction() as never);
    const payload = b.replies[0] as { embeds: Array<{ toJSON(): { footer?: { text: string } } }> };
    expect(payload.embeds[0].toJSON().footer?.text).toBe('Page 2/2');
  });
  it('rejects another user\'s click', async () => {
    const hatchComponent = hatcheryModule.components.find((c) => c.prefix === 'hatch')!;
    const b = fakeButton({ customId: 'hatch:eggs:u1:2', user: 'u2', guild: 'g1' });
    await hatchComponent.execute(ctx, b.asInteraction() as never);
    expect((b.replies[0] as { content: string }).content).toContain('Not your');
  });
});

describe('/mythic confirm flow', () => {
  const mythicId = mythicSpeciesChoices()[0].id;
  beforeEach(() => {
    ctx.economy.apply('u1', { shards: 500 }, 'seed', 0);
    ctx.db.update(schema.users).set({ ratingHighWater: 400 }).where(eq(schema.users.discordId, 'u1')).run();
  });
  it('command replies with a confirm button and spends nothing', async () => {
    const i = fakeCommand({ name: 'mythic', user: 'u1', options: { species: mythicId } });
    await hatcheryModule.commands.find((c) => c.data.name === 'mythic')!.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { components: unknown[]; content: string };
    expect(payload.content).toContain('500 shards');
    expect(payload.components).toHaveLength(1);
    const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(user.shards).toBe(500); // nothing charged yet
  });
  it('confirm button buys the egg', async () => {
    const b = fakeButton({ customId: `mythic:confirm:${mythicId}`, user: 'u1', guild: 'g1' });
    const mythicComponent = hatcheryModule.components.find((c) => c.prefix === 'mythic')!;
    await mythicComponent.execute(ctx, b.asInteraction() as never);
    const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all();
    expect(eggs.some((e) => e.rarity === 'mythic')).toBe(true);
  });
});

describe('/incubate execute', () => {
  it('incubates and replies with an illustrated ready-timestamp embed, enqueues egg_hatch timer', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', guild: 'g1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; description?: string; thumbnail?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toContain('Incubating your common egg');
    expect(embed.description).toContain('<t:');   // relative ready stamp survives the promotion
    // Attach-all-or-nothing: a thumbnail URL with no matching file renders broken.
    expect(embed.thumbnail?.url).toBe('attachment://common.webp');
    expect(payload.files!.map((f) => f.name)).toContain('common.webp');
    const timer = ctx.db.select().from(schema.timers).all().find((t) => t.kind === 'egg_hatch');
    expect(timer?.refId).toBe(egg.id);
  });
  it('rejects an egg you do not own, ephemeral', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u2', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('do not own');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('rejects an egg locked in a pending trade, ephemeral', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();   // both sides ≥ 2★ gate
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('locked in a pending trade');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('sweeps an expired trade first, so a stale lock does not block incubation', async () => {
    // expireStale is lazy and only ever ran from /trade surfaces, so without the sweep
    // a dead trade would hold the lock — and reject with a statement that is false.
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    ctx.setNow(ctx.now() + 25 * 3_600_000);          // TRADE_EXPIRY_MS is 24h
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    const after = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!;
    expect(after.locked).toBe(false);
    expect(after.incubationStartedAt).not.toBeNull();
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('expired');
  });
});

describe('/hatch execute', () => {
  it('not-yours and not-ready are ephemeral rejections', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'hatch')!;
    const notMine = fakeCommand({ name: 'hatch', user: 'u1', options: { egg: 9999 } });
    await cmd.execute(ctx, notMine.asChatInput());
    expect(replyText(notMine.replies[0])).toContain('do not own');
    expect((notMine.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    const notReady = fakeCommand({ name: 'hatch', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, notReady.asChatInput());
    expect(replyText(notReady.replies[0])).toContain('not ready to hatch');
    expect((notReady.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
  it('ready egg gets the pre-hatch embed with a crack button', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    incubateEgg(ctx, 'u1', egg.id, null);
    ctx.setNow(RARITY.common.incubationMs + 1);
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'hatch')!;
    const i = fakeCommand({ name: 'hatch', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { components?: unknown[] };
    expect(JSON.stringify(payload.components ?? [])).toContain(`hatch:crack:${egg.id}`);
  });

  it('locked egg is an ephemeral rejection, with no crack button', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    incubateEgg(ctx, 'u1', egg.id, null);
    ctx.db.update(schema.eggs).set({ locked: true }).where(eq(schema.eggs.id, egg.id)).run();
    ctx.setNow(RARITY.common.incubationMs + 1);
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'hatch')!;
    const i = fakeCommand({ name: 'hatch', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('locked in a pending trade');
    expect(JSON.stringify(i.replies[0])).not.toContain('hatch:crack');
  });
});

describe('mythic:confirm and hatch:crack error branches', () => {
  it('mythic:confirm blocks below 4-star rating and on empty wallet', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const comp = hatcheryModule.components.find((c) => c.prefix === 'mythic')!;
    const gated = fakeButton({ customId: 'mythic:confirm:indominus', user: 'u1' });
    await comp.execute(ctx, gated.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(gated.replies[0])).toContain('4★');
    ctx.db.update(schema.users).set({ ratingHighWater: 400, shards: 0 }).run();
    const broke = fakeButton({ customId: 'mythic:confirm:indominus', user: 'u1' });
    await comp.execute(ctx, broke.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(broke.replies[0])).toContain('Not enough shards');
  });
  it('hatch:crack on a non-incubating egg is an ephemeral error', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const comp = hatcheryModule.components.find((c) => c.prefix === 'hatch')!;
    const b = fakeButton({ customId: `hatch:crack:${egg.id}`, user: 'u1' });
    await comp.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(b.replies[0])).toContain('not incubating');
  });
});
