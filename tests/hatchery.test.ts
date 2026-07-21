import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { incubateEgg, hatchEgg, incubatorSlots, HatcheryError } from '../src/modules/hatchery/service.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

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
