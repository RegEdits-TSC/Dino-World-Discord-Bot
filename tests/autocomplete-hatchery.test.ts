import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';

const H = 3_600_000;
const cmd = (name: string) => hatcheryModule.commands.find((c) => c.data.name === name)!;

function seedEggs(ctx: ReturnType<typeof makeCtx>) {
  getOrCreateUser(ctx, 'u1', 'u1');
  const mk = (over: Partial<typeof schema.eggs.$inferInsert>) =>
    ctx.db.insert(schema.eggs).values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, ...over }).returning().get();
  const inventory = mk({ rarity: 'common' });                                        // not incubating
  const hatching = mk({ rarity: 'epic', incubationStartedAt: 0, hatchesAt: 12 * H }); // incubating
  const ready = mk({ rarity: 'rare', incubationStartedAt: 0, hatchesAt: 1 });         // ready
  return { inventory, hatching, ready };
}

describe('/incubate egg autocomplete', () => {
  it('ranks non-incubating eggs first with state-tagged labels', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { inventory, hatching, ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0]).toEqual({ name: `🥚 #${inventory.id} Common — in inventory`, value: inventory.id });
    expect(rows.map((r) => r.value)).toEqual([inventory.id, hatching.id, ready.id]);
    expect(rows[1].name).toBe(`🥚 #${hatching.id} Epic — hatching, 10h left`);
    expect(rows[2].name).toBe(`🥚 #${ready.id} Rare — READY`);
  });

  it('filters by the typed query', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: 'rare' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows.map((r) => r.value)).toEqual([ready.id]);
  });

  it('shows the empty-state row when the user has no eggs', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No eggs — get one from /shop egg or /expedition', value: 0 }]);
  });
});

describe('/hatch egg autocomplete', () => {
  it('ranks READY eggs first', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'hatch', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows[0].value).toBe(ready.id);
    expect(rows).toHaveLength(3);
  });

  it('never lists another user\'s eggs', async () => {
    const ctx = makeCtx();
    seedEggs(ctx);
    getOrCreateUser(ctx, 'u2', 'u2');
    const i = fakeAutocomplete({ name: 'hatch', user: 'u2', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No eggs — get one from /shop egg or /expedition', value: 0 }]);
  });
});
