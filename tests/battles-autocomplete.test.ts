import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { battlesModule } from '../src/modules/battles/index.js';
import { CAMPAIGN } from '../src/data/battle/chapters/index.js';

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
  it('stage: the newest chapter survives the 25-choice slice for a fully unlocked player', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    // Unlock everything the way a real endgame player does: rating high-water past the
    // last gate, and a full 3-star clear on every stage. A 1-star clear no longer suffices
    // here: founders_park's chapterUnlocked branch sums stars across the WHOLE progress
    // map and needs >=75, and 35 stages at 1 star each is only 35 — only a full clear
    // (105 stars over 35 stages) clears that bar. This player still emits all 35 entries.
    ctx.db.update(schema.users).set({ ratingHighWater: 1000 }).where(eq(schema.users.discordId, 'u1')).run();
    for (const ch of CAMPAIGN) {
      for (const s of ch.stages) {
        ctx.db.insert(schema.battleProgress)
          .values({ userId: 'u1', stageId: s.id, stars: 3, firstClearedAt: 1, attempts: 1 }).run();
      }
    }
    const fake = fakeAutocomplete({ name: 'battle', sub: 'fight', user: 'u1', focused: { name: 'stage', value: '' } });
    await battleCmd.autocomplete!(ctx, fake.asAutocomplete());
    const choices = fake.replies[0] as Choice[];
    expect(choices).toHaveLength(25);
    const last = CAMPAIGN[CAMPAIGN.length - 1];
    for (const s of last.stages) {
      expect(choices.map((c) => c.value), `${s.id} dropped by the 25-choice slice`).toContain(s.id);
    }
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
