import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { careModule } from '../src/modules/care/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';

const H = 3_600_000;
const cmd = (name: string) => careModule.commands.find((c) => c.data.name === name)!;

function seedDino(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.dinos.$inferInsert> = {}) {
  return ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();
}

describe('/feed one autocomplete', () => {
  it('lists non-escaped dinos first, hungriest first', async () => {
    const ctx = makeCtx({ nowMs: 10 * H });
    getOrCreateUser(ctx, 'u1', 'u1');
    const fresh = seedDino(ctx, { lastFedAt: 9 * H });            // fed 1h ago
    const hungry = seedDino(ctx, { speciesId: 'triceratops' });   // fed 10h ago — hungrier
    const escaped = seedDino(ctx, { speciesId: 'stegosaurus', escapedAt: 1 });
    const i = fakeAutocomplete({ name: 'feed', sub: 'one', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([hungry.id, fresh.id, escaped.id]);
    expect(rows[0].name).toBe(`🦖 #${hungry.id} Triceratops — fed 10h ago (unassigned)`);
    expect(rows[2].name).toBe(`🦖 #${escaped.id} Stegosaurus — ESCAPED, rescue first`);
  });

  it('responds the empty-state row for a user with no row (and does not crash)', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'feed', sub: 'one', user: 'ghost', focused: { name: 'dino', value: '' } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No dinos — hatch an egg first', value: 0 }]);
  });

  // No test for the "wrong subcommand" branch of the autocomplete guard:
  // 'all' defines zero options, so Discord can never focus 'dino' (or
  // anything) on it — there is no builder-realistic fixture that reaches
  // that branch, and the harness now rejects unrealistic ones.
});

describe('/feed one food autocomplete', () => {
  it('lists only the target dino\'s diet, affordable first, with unicode labels', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');                          // starter: 10 ferns, 10 fish
    const d = seedDino(ctx, { speciesId: 'triceratops' });     // herbivore, feedCost 5
    const i = fakeAutocomplete({ name: 'feed', sub: 'one', user: 'u1',
      focused: { name: 'food', value: '' }, options: { dino: d.id } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: string }>;
    expect(rows.map((r) => r.value)).toEqual(['ferns', 'fruit_basket', 'royal_greens']);
    expect(rows[0].name).toBe('🌿 Ferns ×10 — fills 100');
    expect(rows[1].name).toBe('🍎 Fruit Basket ×0 — fills 125, not enough');
  });
  it('hints to pick the dino first when the dino option is empty', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const i = fakeAutocomplete({ name: 'feed', sub: 'one', user: 'u1', focused: { name: 'food', value: '' } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'Pick the dino option first', value: '-' }]);
  });
});

describe('/rescue autocomplete', () => {
  it('ranks escaped dinos first with the ESCAPED tag', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const safe = seedDino(ctx);
    const escaped = seedDino(ctx, { speciesId: 'triceratops', escapedAt: 1 });
    const i = fakeAutocomplete({ name: 'rescue', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('rescue').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([escaped.id, safe.id]);
    expect(rows[0].name).toBe(`🦖 #${escaped.id} Triceratops — ESCAPED, rescue first`);
  });
});
