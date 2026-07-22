import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { parkModule } from '../src/modules/park/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';

const cmd = (name: string) => parkModule.commands.find((c) => c.data.name === name)!;

function seedLot(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.lots.$inferInsert> = {}) {
  return ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock', ...over,
  }).returning().get();
}
function seedDino(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.dinos.$inferInsert> = {}) {
  return ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();
}

describe('/upgrade lot autocomplete', () => {
  it('tags maxed lots and ranks upgradable first', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const maxed = seedLot(ctx, { level: 4 });                      // paddock maxLevel is 4
    const open = seedLot(ctx, { type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab', level: 2 }); // maxLevel 3
    const i = fakeAutocomplete({ name: 'upgrade', user: 'u1', focused: { name: 'lot', value: '' } });
    await cmd('upgrade').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([open.id, maxed.id]);
    expect(rows[0].name).toBe(`🏗️ #${open.id} Hatchery Lab (lvl 2)`);
    expect(rows[1].name).toBe(`🏗️ #${maxed.id} Herbivore Paddock (lvl 4) — MAX LEVEL`);
  });

  it('shows the empty-state row with no lots', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const i = fakeAutocomplete({ name: 'upgrade', user: 'u1', focused: { name: 'lot', value: '' } });
    await cmd('upgrade').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No lots — /build one first', value: 0 }]);
  });
});

describe('/dino assign autocomplete', () => {
  it('dino option: escaped dinos rank last and are tagged', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const escaped = seedDino(ctx, { escapedAt: 1 });
    const ok = seedDino(ctx, { speciesId: 'triceratops' });
    const i = fakeAutocomplete({ name: 'dino', sub: 'assign', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('dino').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows.map((r) => r.value)).toEqual([ok.id, escaped.id]);
  });

  it('lot option: only paddocks, FULL ones tagged and ranked last', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const full = seedLot(ctx);                                     // lvl 1 => capacity 2
    seedDino(ctx, { lotId: full.id }); seedDino(ctx, { lotId: full.id });
    const open = seedLot(ctx, { kind: 'carnivore_paddock', name: 'Carnivore Paddock' });
    seedLot(ctx, { type: 'facility', kind: 'visitor_center', name: 'Visitor Center' }); // excluded entirely
    const i = fakeAutocomplete({ name: 'dino', sub: 'assign', user: 'u1', focused: { name: 'lot', value: '' } });
    await cmd('dino').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([open.id, full.id]);
    expect(rows[0].name).toBe(`🏗️ #${open.id} Carnivore Paddock (lvl 1, 0/2)`);
    expect(rows[1].name).toBe(`🏗️ #${full.id} Herbivore Paddock (lvl 1, 2/2) — FULL`);
  });
});

describe('/dino unassign autocomplete', () => {
  it('assigned dinos rank first', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const lot = seedLot(ctx);
    const unassigned = seedDino(ctx);
    const assigned = seedDino(ctx, { speciesId: 'triceratops', lotId: lot.id });
    const i = fakeAutocomplete({ name: 'dino', sub: 'unassign', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('dino').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows.map((r) => r.value)).toEqual([assigned.id, unassigned.id]);
  });
});

describe('/decorate lot autocomplete', () => {
  it('lists only paddocks', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const pad = seedLot(ctx);
    seedLot(ctx, { type: 'facility', kind: 'food_court', name: 'Food Court' });
    const i = fakeAutocomplete({ name: 'decorate', user: 'u1', focused: { name: 'lot', value: '' } });
    await cmd('decorate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: `🏗️ #${pad.id} Herbivore Paddock (lvl 1)`, value: pad.id });
  });
});
