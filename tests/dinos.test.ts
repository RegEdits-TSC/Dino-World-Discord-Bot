import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino, unassignDino, decorateLot, paddockCapacity, listDinos, AssignError, DietMismatchError } from '../src/modules/park/dinos.js';
import { parkModule } from '../src/modules/park/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0); });
const addDino = () => ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();

type CollectPayload = {
  embeds: Array<{ toJSON(): { description?: string; image?: { url: string } } }>;
  files?: Array<{ name: string | null }>;
  flags?: number;
};

describe('dino assignment', () => {
  it('assigns a dino to a paddock and blocks past capacity (2×level)', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');   // level 1 → capacity 2
    expect(paddockCapacity(1)).toBe(2);
    assignDino(ctx, 'u1', addDino().id, lot.id);
    assignDino(ctx, 'u1', addDino().id, lot.id);
    expect(() => assignDino(ctx, 'u1', addDino().id, lot.id)).toThrow(AssignError);
  });
  it('re-assigning a dino to the full lot it already occupies is a no-op, not a "full" error', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');   // capacity 2
    const a = addDino(); const b = addDino();
    assignDino(ctx, 'u1', a.id, lot.id);
    assignDino(ctx, 'u1', b.id, lot.id);                    // lot now full (2/2)
    expect(() => assignDino(ctx, 'u1', a.id, lot.id)).not.toThrow();   // a is already there
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, a.id)).get()!.lotId).toBe(lot.id);
  });
  it('rejects assigning to a facility lot', () => {
    const vc = buildLot(ctx, 'u1', 'visitor_center');
    expect(() => assignDino(ctx, 'u1', addDino().id, vc.id)).toThrow(AssignError);
  });
  it('unassign clears the lot', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = addDino(); assignDino(ctx, 'u1', d.id, lot.id);
    unassignDino(ctx, 'u1', d.id);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBeNull();
  });
  it('decorateLot charges cost and appends decor', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    decorateLot(ctx, 'u1', lot.id, 'palm_tree');
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.decor).toEqual(['palm_tree']);
  });
  // Regression for a bug that shipped invisibly: decorateLot stores the decor KIND
  // slug ('grass_tuft', 'palm_tree', ...), and paddockFit must map each slug through
  // DECOR to its own biomeTags before comparing against the species' — comparing the
  // stored slug directly against biomeTags (the old, broken comparison) can never
  // match, since decor kinds and biome tags are disjoint vocabularies. Goes through
  // decorateLot's real storage shape end-to-end via listDinos, not a hand-built
  // ClockDino, so it would have caught the original bug.
  it('decor matching the species biome raises comfort to fit 1.0, via decorateLot\'s real storage shape', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'gallimimus', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    decorateLot(ctx, 'u1', lot.id, 'grass_tuft');   // Grass Tuft is tagged 'plains', matching Gallimimus
    const row = listDinos(ctx, 'u1').find((x) => x.dino.id === d.id)!;
    expect(row.comfort).toBeCloseTo(1.0);
  });
  it('non-biome-matching decor leaves comfort at fit 0.75, via decorateLot\'s real storage shape', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'gallimimus', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    decorateLot(ctx, 'u1', lot.id, 'palm_tree');    // Palm Tree is tagged 'forest' — Gallimimus is 'plains'
    const row = listDinos(ctx, 'u1').find((x) => x.dino.id === d.id)!;
    expect(row.comfort).toBeCloseTo(0.75);
  });
  it('listDinos returns each dino paired with species and comfort', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = addDino(); assignDino(ctx, 'u1', d.id, lot.id);
    addDino();                                       // one unassigned
    const list = listDinos(ctx, 'u1');
    expect(list).toHaveLength(2);
    const assigned = list.find((x) => x.dino.id === d.id)!;
    expect(assigned.species.id).toBe('triceratops');
    expect(assigned.comfort).toBeGreaterThan(0);     // assigned + fed
  });
  it('reports enrichment alongside comfort', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    decorateLot(ctx, 'u1', lot.id, 'palm_tree');
    decorateLot(ctx, 'u1', lot.id, 'fern');           // palm_tree + fern both match triceratops' forest tag
    const d = addDino(); assignDino(ctx, 'u1', d.id, lot.id);
    const rows = listDinos(ctx, 'u1');
    expect(rows[0].comfort).toBeCloseTo(1.05);
    expect(rows[0].enrichment).toBe(1.05);
  });
  it('the roster row clamps comfort at 100% and shows the rung separately', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    decorateLot(ctx, 'u1', lot.id, 'palm_tree');
    decorateLot(ctx, 'u1', lot.id, 'fern');
    const d = addDino(); assignDino(ctx, 'u1', d.id, lot.id);
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'dino')!.execute(ctx, i.asChatInput());
    const text = JSON.stringify(i.replies[0]);
    expect(text).toContain('100% comfort');
    expect(text).toContain('enriched +5%');
    expect(text).not.toContain('105% comfort');
  });
});

describe('park dino commands', () => {
  it('/dino assign via command puts a dino in a paddock', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    const dinoCmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'assign', user: 'u1', options: { dino: d.id, lot: lot.id } });
    await dinoCmd.execute(ctx, i.asChatInput());
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBe(lot.id);
  });

  it('/dino assign settles escapes first, so a logically-escaped dino is rejected', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');   // no decor → fit 0.75
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    ctx.setNow(60 * 3_600_000);                             // past escape (40h) — but escapedAt still null
    const dinoCmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'assign', user: 'u1', options: { dino: d.id, lot: lot.id } });
    await dinoCmd.execute(ctx, i.asChatInput());
    // settle ran first → dino stamped escaped → assignDino throws AssignError → ephemeral reply, no silent success
    const reply = i.replies[0] as { flags?: unknown };
    expect(reply.flags).toBeDefined();                      // ephemeral error, not a plain "Assigned."
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.escapedAt).not.toBeNull();
  });

  it('/dino list marks escaped dinos as ESCAPED', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, escapedAt: 40 * 3_600_000 }).run();
    const dinoCmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    await dinoCmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ data: { description?: string } }> };
    expect(payload.embeds[0].data.description).toContain('ESCAPED');
  });

  it('/dino list sets the roster banner as the embed image and attaches it', async () => {
    ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    const dinoCmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    await dinoCmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { image?: { url: string } } }>; files?: Array<{ name: string | null }>;
    };
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://dino_roster.webp');
    expect(payload.files!.map((f) => f.name)).toEqual(['dino_roster.webp']);
  });
});

describe('dino list pagination', () => {
  it('page button re-renders the requested page for the owner', async () => {
    for (let n = 0; n < 11; n++) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    const b = fakeButton({ customId: 'park:dinos:u1:2', user: 'u1', guild: 'g1' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    const payload = b.replies[0] as { embeds: Array<{ toJSON(): { footer?: { text: string } } }> };
    expect(payload.embeds[0].toJSON().footer?.text).toBe('Page 2/2');
    // Matches the hatch:eggs precedent: the page flip re-uploads the banner, so the
    // previous page's copy must be cleared or the message keeps both.
    expect((b.replies[0] as { attachments?: unknown[] }).attachments).toEqual([]);
  });
  it('rejects another user\'s click', async () => {
    const b = fakeButton({ customId: 'park:dinos:u1:2', user: 'u2', guild: 'g1' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    expect((b.replies[0] as { content: string }).content).toContain('Not your');
  });
});

describe('park visits', () => {
  it('/park view user:<other> shows a read-only dashboard with no components', async () => {
    getOrCreateUser(ctx, 'other', 'Other');
    const parkCmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1', options: { user: 'other' } });
    await parkCmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: unknown[]; components?: unknown[] };
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components).toBeUndefined();
  });
});

describe('diet mismatch confirm', () => {
  it('throws DietMismatchError for a wrong-diet assignment unless allowMismatch', () => {
    const lot = buildLot(ctx, 'u1', 'carnivore_paddock');
    const d = addDino();                                       // triceratops, herbivore
    expect(() => assignDino(ctx, 'u1', d.id, lot.id)).toThrow(DietMismatchError);
    assignDino(ctx, 'u1', d.id, lot.id, { allowMismatch: true });
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBe(lot.id);
  });
  it('matched-diet assignment is unaffected', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    expect(() => assignDino(ctx, 'u1', addDino().id, lot.id)).not.toThrow();
  });
  it('listDinos flags mismatched dinos', () => {
    const lot = buildLot(ctx, 'u1', 'carnivore_paddock');
    const d = addDino();
    assignDino(ctx, 'u1', d.id, lot.id, { allowMismatch: true });
    const row = listDinos(ctx, 'u1').find((x) => x.dino.id === d.id)!;
    expect(row.mismatch).toBe(true);
  });
  it('/dino assign replies with Confirm/Cancel buttons on mismatch, and the yes button assigns', async () => {
    const lot = buildLot(ctx, 'u1', 'carnivore_paddock');
    const d = addDino();
    const dinoCmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'assign', user: 'u1', options: { dino: d.id, lot: lot.id } });
    await dinoCmd.execute(ctx, i.asChatInput());
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBeNull();
    const payload = i.replies[0] as { content: string; components: unknown[] };
    expect(payload.content).toContain('herbivore');
    expect(payload.components).toHaveLength(1);
    const b = fakeButton({ customId: `park:assignyes:u1:${d.id}:${lot.id}`, user: 'u1' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBe(lot.id);
  });
  it('rejects another user\'s confirm click', async () => {
    const b = fakeButton({ customId: 'park:assignyes:u1:1:1', user: 'u2' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    expect((b.replies[0] as { content: string }).content).toContain('Not your');
  });
  it('cancel button leaves the dino unassigned and reports cancellation', async () => {
    const d = addDino();
    const b = fakeButton({ customId: 'park:assignno:u1', user: 'u1' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBeNull();
    expect((b.replies[0] as { content: string }).content).toContain('cancelled');
  });
});

describe('/dino unassign and park:collect execute', () => {
  it('/dino unassign execute unassigns through the command layer', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, lotId: lot.id,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const cmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'unassign', user: 'u1', options: { dino: dino.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Unassigned');
    expect(ctx.db.select().from(schema.dinos).all()[0].lotId).toBeNull();
  });
  it('park:collect button replies with the collect banner embed, then the empty branch', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, lotId: lot.id,
    }).run();
    ctx.db.update(schema.users).set({ lastCollectAt: 0 }).run();
    ctx.setNow(2 * 3_600_000);
    const comp = parkModule.components.find((c) => c.prefix === 'park')!;
    const b1 = fakeButton({ customId: 'park:collect', user: 'u1' });
    await comp.execute(ctx, b1.asInteraction() as unknown as ButtonInteraction);
    const first = b1.replies[0] as CollectPayload;
    expect(first.embeds[0].toJSON().description).toContain('Collected');
    expect(first.embeds[0].toJSON().image?.url).toBe('attachment://collect.webp');
    expect(first.files!.map((f) => f.name)).toEqual(['collect.webp']);
    expect(first.flags).toBe(MessageFlags.Ephemeral);   // stays private
    const b2 = fakeButton({ customId: 'park:collect', user: 'u1' });
    await comp.execute(ctx, b2.asInteraction() as unknown as ButtonInteraction);
    const second = b2.replies[0] as CollectPayload;
    expect(second.embeds[0].toJSON().description).toContain('Nothing to collect');
    expect(second.files!.map((f) => f.name)).toEqual(['collect.webp']);
  });
});
