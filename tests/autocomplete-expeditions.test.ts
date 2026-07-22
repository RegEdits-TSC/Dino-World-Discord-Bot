import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { expeditionsModule } from '../src/modules/expeditions/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

const cmd = () => expeditionsModule.commands[0];

describe('/expedition start site autocomplete', () => {
  it('unlocked sites first with cost and duration; locked tagged with the star requirement', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ ratingHighWater: 150 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = fakeAutocomplete({ name: 'expedition', sub: 'start', user: 'u1', focused: { name: 'site', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: string }>;
    expect(rows.map((r) => r.value)).toEqual(['coastal_dig', 'amber_ridge', 'frozen_cliffs', 'volcano_core']);
    expect(rows[0].name).toBe('🧭 Coastal Dig — 200 cash, 15m');
    expect(rows[1].name).toBe('🧭 Amber Ridge — 1,000 cash, 1h');
    expect(rows[2].name).toBe('🧭 Frozen Cliffs — LOCKED, needs ★2.5');
    expect(rows[3].name).toBe('🧭 Volcano Core — LOCKED, needs ★4.0');
  });

  it('missing user row = high-water 0, no row created', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'expedition', sub: 'start', user: 'ghost', focused: { name: 'site', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string }>;
    expect(rows[0].name).toBe('🧭 Coastal Dig — 200 cash, 15m');
    expect(rows.filter((r) => r.name.includes('LOCKED'))).toHaveLength(3);
    expect(ctx.db.select().from(schema.users).all()).toEqual([]);
  });

  it('responds [] for other subcommands', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'expedition', sub: 'status', user: 'u1', focused: { name: 'site', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
  });
});
