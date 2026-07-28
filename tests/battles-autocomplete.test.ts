import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { battlesModule } from '../src/modules/battles/index.js';

const battleCmd = battlesModule.commands[0];
type Choice = { name: string; value: string | number };

function seedDino(ctx: ReturnType<typeof makeCtx>, userId: string, speciesId: string, escapedAt: number | null = null): number {
  ctx.db.insert(schema.dinos).values({ userId, speciesId, lastFedAt: ctx.now(), hatchedAt: ctx.now(), escapedAt }).run();
  const rows = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
  return rows[rows.length - 1].id;
}

describe('/battle autocomplete', () => {
  it('stage: unknown user gets [] and no row is created', async () => {
    const ctx = makeCtx();
    const fake = fakeAutocomplete({ name: 'battle', sub: 'fight', user: 'ghost', focused: { name: 'stage', value: '' } });
    await battleCmd.autocomplete!(ctx, fake.asAutocomplete());
    expect(fake.replies[0]).toEqual([]);
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
  });
  it('dino1: unknown user gets [] and no row is created (settleEscapes never runs)', async () => {
    const ctx = makeCtx();
    const fake = fakeAutocomplete({ name: 'battle', sub: 'fight', user: 'ghost', focused: { name: 'dino1', value: '' } });
    await battleCmd.autocomplete!(ctx, fake.asAutocomplete());
    expect(fake.replies[0]).toEqual([]);
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
  });
  it('stage: playable stage ranks first, locked stages tagged, labels unicode-only', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const fake = fakeAutocomplete({ name: 'battle', sub: 'fight', user: 'u1', focused: { name: 'stage', value: '' } });
    await battleCmd.autocomplete!(ctx, fake.asAutocomplete());
    const choices = fake.replies[0] as Choice[];
    expect(choices[0].value).toBe('coastal_dig_1');    // only playable stage for a fresh row
    expect(choices[0].name).toContain('⚡');
    expect(choices.some((c) => c.name.startsWith('🔒'))).toBe(true);
    for (const c of choices) expect(c.name).not.toMatch(/<a?:\w+:\d+>/);  // no custom emoji tags
  });
  it('dino: escaped dinos are excluded; labels are Lv.N Name (archetype)', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const fit = seedDino(ctx, 'u1', 'tyrannosaurus');
    seedDino(ctx, 'u1', 'triceratops', 1);             // already escaped
    const fake = fakeAutocomplete({ name: 'battle', sub: 'fight', user: 'u1', focused: { name: 'dino1', value: '' } });
    await battleCmd.autocomplete!(ctx, fake.asAutocomplete());
    const choices = fake.replies[0] as Choice[];
    expect(choices.map((c) => c.value)).toEqual([fit]);
    expect(choices[0].name).toMatch(/^Lv\.1 Tyrannosaurus \(\w+\)$/);
  });
  it('dino: a dino picked in another slot is not offered again', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const a = seedDino(ctx, 'u1', 'tyrannosaurus');
    const b = seedDino(ctx, 'u1', 'triceratops');
    const fake = fakeAutocomplete({ name: 'battle', sub: 'fight', user: 'u1',
      focused: { name: 'dino2', value: '' }, options: { dino1: a } });
    await battleCmd.autocomplete!(ctx, fake.asAutocomplete());
    expect((fake.replies[0] as Choice[]).map((c) => c.value)).toEqual([b]);
  });
});
