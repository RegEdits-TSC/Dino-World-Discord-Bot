import { describe, it, expect, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { incubateEgg, hatchEgg, incubatorSlots, HatcheryError } from '../src/modules/hatchery/service.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';
import { preHatchPayload, eggListPayload, revealPayload } from '../src/modules/hatchery/embeds.js';
import { getSpecies } from '../src/data/species/index.js';
import { mythicSpeciesChoices } from '../src/modules/shop/shards.js';

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
    expect(p.embeds[0].toJSON().image?.url).toBe('attachment://rare.png');
    expect(p.files).toHaveLength(1);
    expect(p.components).toHaveLength(1); // crack button preserved
  });
  it('preHatchPayload degrades to no image when the asset is missing', () => {
    const p = preHatchPayload('not-a-rarity', 7);
    expect(p.embeds[0].toJSON().image).toBeUndefined();
    expect(p.files).toBeUndefined();
  });
  it('revealPayload clears attachments so the egg image disappears on crack', () => {
    const p = revealPayload(getSpecies('velociraptor'));
    expect(p.files).toEqual([]);
    expect(p.attachments).toEqual([]);
  });
  it('reveal embed points at /dino assign', () => {
    const p = revealPayload(getSpecies('velociraptor'));
    expect(p.embeds[0].toJSON().footer?.text).toContain('/dino assign');
  });
  it('eggListPayload thumbnails the ready egg over incubating and newest', () => {
    const ready = { ...addEgg('epic'), hatchesAt: 5, incubationStartedAt: 1 };
    const incubating = { ...addEgg('rare'), hatchesAt: 999_999, incubationStartedAt: 1 };
    const newest = addEgg('common');
    const p = eggListPayload([newest, incubating, ready], 10, 'u1');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://epic.png');
    expect(p.files).toHaveLength(1);
  });
  it('eggListPayload falls back to newest-obtained when nothing is incubating', () => {
    const older = { ...addEgg('common'), obtainedAt: 1 };
    const newer = { ...addEgg('legendary'), obtainedAt: 2 };
    const p = eggListPayload([older, newer], 10, 'u1');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://legendary.png');
  });
  it('eggListPayload with no eggs has no thumbnail', () => {
    const p = eggListPayload([], 10, 'u1');
    expect(p.embeds[0].toJSON().thumbnail).toBeUndefined();
    expect(p.files).toBeUndefined();
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
