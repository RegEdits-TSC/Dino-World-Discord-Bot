import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino, unassignDino, decorateLot, paddockCapacity, listDinos, AssignError } from '../src/modules/park/dinos.js';
import { parkModule } from '../src/modules/park/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0); });
const addDino = () => ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();

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
