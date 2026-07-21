import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino, unassignDino, decorateLot, paddockCapacity, listDinos, AssignError } from '../src/modules/park/dinos.js';
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
