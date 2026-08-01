import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeAutocomplete, fakeButton, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { geneLabModule } from '../src/modules/genelab/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { BREED_FEE, BREED_MS, SPLICE_SHARD_COST } from '../src/data/breeding.js';

const breedCmd = geneLabModule.commands.find((c) => c.data.name === 'breed')!;
const breedBtn = geneLabModule.components.find((c) => c.prefix === 'breed')!;
const spliceCmd = geneLabModule.commands.find((c) => c.data.name === 'splice')!;
const spliceBtn = geneLabModule.components.find((c) => c.prefix === 'splice')!;

function lab(ctx: ReturnType<typeof makeCtx>) {
  getOrCreateUser(ctx, 'u1', 'u1');
  ctx.economy.apply('u1', { cash: 500_000 }, 'test', 0);
  buildLot(ctx, 'u1', 'gene_lab');
  buildLot(ctx, 'u1', 'herbivore_paddock');
  return ctx.db.select().from(schema.lots).all().find((l) => l.kind === 'herbivore_paddock')!;
}

function pair(ctx: ReturnType<typeof makeCtx>, lotId: number) {
  const a = ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', lotId, lastFedAt: 0, hatchedAt: 0,
  }).returning().get();
  const b = ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'gallimimus', lotId, lastFedAt: 0, hatchedAt: 0,
  }).returning().get();
  return { a, b };
}

describe('/breed autocomplete', () => {
  it('responds empty for an unknown player and creates no user row', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const i = fakeAutocomplete({
      name: 'breed', sub: 'start', user: 'ghost',
      focused: { name: 'parent-a', value: '' },
    });
    await breedCmd.autocomplete!(ctx, i.asAutocomplete());
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
    expect(i.replies[0]).toEqual([]);
  });

  it('excludes a dino already locked in a breeding', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = lab(ctx);
    const { a, b } = pair(ctx, lot.id);
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: a.id, parentB: b.id, rarity: 'common', startedAt: 0, readyAt: 999,
    }).run();

    const i = fakeAutocomplete({
      name: 'breed', sub: 'start', user: 'u1',
      focused: { name: 'parent-a', value: '' },
    });
    await breedCmd.autocomplete!(ctx, i.asAutocomplete());
    const values = (i.replies[0] as Array<{ value: number }>).map((c) => c.value);
    expect(values).not.toContain(a.id);
  });

  it('excludes an escaped dino and a mythic dino outright, not just as invalid', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = lab(ctx);
    const ok = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lotId: lot.id, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const escaped = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lotId: lot.id, lastFedAt: 0, hatchedAt: 0, escapedAt: 0,
    }).returning().get();
    const mythic = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'indominus', lotId: lot.id, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();

    const i = fakeAutocomplete({
      name: 'breed', sub: 'start', user: 'u1',
      focused: { name: 'parent-a', value: '' },
    });
    await breedCmd.autocomplete!(ctx, i.asAutocomplete());
    const values = (i.replies[0] as Array<{ value: number }>).map((c) => c.value);
    expect(values).toContain(ok.id);
    expect(values).not.toContain(escaped.id);
    expect(values).not.toContain(mythic.id);
  });

  it('never puts a custom emoji tag in a label', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = lab(ctx);
    pair(ctx, lot.id);
    const i = fakeAutocomplete({
      name: 'breed', sub: 'start', user: 'u1',
      focused: { name: 'parent-a', value: '' },
    });
    await breedCmd.autocomplete!(ctx, i.asAutocomplete());
    for (const c of i.replies[0] as Array<{ name: string }>) {
      expect(c.name).not.toMatch(/<:\w+:\d+>/);
    }
  });

  // The pair-relative branch (index.ts:50-53, :73-77) reads the OTHER option via
  // i.options.get() and greys out a rarity/diet mismatch as visible-but-invalid, rather
  // than hard-filtering it. None of the tests above pass `options`, so otherId/otherSpecies
  // were always 0/null and this whole branch ran untested — the focusedName ternary could
  // invert, or any of the three state labels could be wrong, with the suite still green.
  it('marks a candidate that does not match the other, already-picked parent as invalid and sorts it after valid ones', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = lab(ctx);
    // triceratops: common/herbivore. Already picked as parent-b.
    const partner = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lotId: lot.id, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    // gallimimus: common/herbivore — matches the partner, stays valid.
    const valid = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'gallimimus', lotId: lot.id, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    // compsognathus: common/carnivore — diet mismatch against the herbivore partner.
    const mismatched = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'compsognathus', lotId: lot.id, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();

    const i = fakeAutocomplete({
      name: 'breed', sub: 'start', user: 'u1',
      focused: { name: 'parent-a', value: '' },
      options: { 'parent-b': partner.id },
    });
    await breedCmd.autocomplete!(ctx, i.asAutocomplete());
    const choices = i.replies[0] as Array<{ value: number; name: string }>;

    const mismatchedChoice = choices.find((c) => c.value === mismatched.id)!;
    expect(mismatchedChoice.name).toMatch(/does not match the other parent/);
    // Still present (visible-but-invalid), not hard-filtered like a lock/escape/mythic.
    const validIndex = choices.findIndex((c) => c.value === valid.id);
    const mismatchedIndex = choices.findIndex((c) => c.value === mismatched.id);
    expect(validIndex).toBeGreaterThanOrEqual(0);
    expect(validIndex).toBeLessThan(mismatchedIndex);
  });
});

describe('/breed start', () => {
  it('previews without charging, then the confirm button commits', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = lab(ctx);
    const { a, b } = pair(ctx, lot.id);
    const before = ctx.db.select().from(schema.users).all()[0].cash;

    const i = fakeCommand({
      name: 'breed', sub: 'start', user: 'u1',
      options: { 'parent-a': a.id, 'parent-b': b.id },
    });
    await breedCmd.execute(ctx, i.asChatInput());
    // Preview only — nothing charged, nothing scheduled.
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before);
    expect(ctx.db.select().from(schema.breedings).all()).toHaveLength(0);

    const btn = fakeButton({ customId: `breed:confirm:${a.id}:${b.id}`, user: 'u1' });
    await breedBtn.execute(ctx, btn.asChatInput() as never);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before - BREED_FEE.common);
    expect(ctx.db.select().from(schema.breedings).all()).toHaveLength(1);
  });

  it('refuses without a Gene Lab', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test', 0);
    buildLot(ctx, 'u1', 'herbivore_paddock');
    const lot = ctx.db.select().from(schema.lots).all()[0];
    const { a, b } = pair(ctx, lot.id);

    const i = fakeCommand({
      name: 'breed', sub: 'start', user: 'u1',
      options: { 'parent-a': a.id, 'parent-b': b.id },
    });
    await breedCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toMatch(/Gene Lab/);
  });

  it('rejects a confirm for dinos the clicker does not own', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = lab(ctx);
    const { a, b } = pair(ctx, lot.id);
    getOrCreateUser(ctx, 'u2', 'u2');

    const btn = fakeButton({ customId: `breed:confirm:${a.id}:${b.id}`, user: 'u2' });
    await breedBtn.execute(ctx, btn.asChatInput() as never);
    expect(replyText(btn.replies[0])).toMatch(/do not own/);
    expect(ctx.db.select().from(schema.breedings).all()).toHaveLength(0);
  });
});

describe('/breed status and claim', () => {
  it('reports an active pairing, then hands over the egg', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = lab(ctx);
    const { a, b } = pair(ctx, lot.id);
    const btn = fakeButton({ customId: `breed:confirm:${a.id}:${b.id}`, user: 'u1' });
    await breedBtn.execute(ctx, btn.asChatInput() as never);

    const status = fakeCommand({ name: 'breed', sub: 'status', user: 'u1' });
    await breedCmd.execute(ctx, status.asChatInput());
    expect(JSON.stringify(status.replies[0])).toMatch(/Gene Lab|breeding/i);

    ctx.setNow(BREED_MS.common);
    const claim = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1' });
    await breedCmd.execute(ctx, claim.asChatInput());
    expect(ctx.db.select().from(schema.eggs).all()).toHaveLength(1);
  });

  it('says so when there is nothing to claim', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    lab(ctx);
    const i = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1' });
    await breedCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toMatch(/nothing|no breeding/i);
  });

  it('claims the oldest ready pairing first and reports how many remain', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = lab(ctx);
    // Level-3 Gene Lab -> 3 breeding slots, so two pairings can be active at once.
    const geneLabLot = ctx.db.select().from(schema.lots).all().find((l) => l.kind === 'gene_lab')!;
    ctx.db.update(schema.lots).set({ level: 3 }).where(eq(schema.lots.id, geneLabLot.id)).run();

    const { a, b } = pair(ctx, lot.id);
    const btn1 = fakeButton({ customId: `breed:confirm:${a.id}:${b.id}`, user: 'u1' });
    await breedBtn.execute(ctx, btn1.asChatInput() as never);

    // The second pairing starts 10s later, so its readyAt is strictly later than the first's.
    ctx.setNow(10_000);
    const c = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'dryosaurus', lotId: lot.id, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'othnielia', lotId: lot.id, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const btn2 = fakeButton({ customId: `breed:confirm:${c.id}:${d.id}`, user: 'u1' });
    await breedBtn.execute(ctx, btn2.asChatInput() as never);
    expect(ctx.db.select().from(schema.breedings).all()).toHaveLength(2);

    // Past both readyAt values: both pairings are ready.
    ctx.setNow(BREED_MS.common + 10_000);

    const claim1 = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1' });
    await breedCmd.execute(ctx, claim1.asChatInput());
    const claimedFirst = ctx.db.select().from(schema.breedings).all().find((r) => r.claimedAt !== null)!;
    expect(claimedFirst.parentA).toBe(a.id);   // the OLDER pairing was claimed first
    expect(JSON.stringify(claim1.replies[0])).toMatch(/1 more pairing/);

    const claim2 = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1' });
    await breedCmd.execute(ctx, claim2.asChatInput());
    expect(ctx.db.select().from(schema.eggs).all()).toHaveLength(2);
    expect(JSON.stringify(claim2.replies[0])).not.toMatch(/more pairing/);
  });
});

describe('/splice autocomplete', () => {
  it('excludes a locked and an escaped dino outright, but keeps a Mythic visible', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const ok = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const escaped = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0, escapedAt: 0,
    }).returning().get();
    // spliceDino places no rarity gate (unlike breeding/trading), so a Mythic must
    // stay listed — hiding it here would be a UI restriction the service itself
    // does not enforce.
    const mythic = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'indominus', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const locked = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: locked.id, parentB: locked.id, rarity: 'common', startedAt: 0, readyAt: 999,
    }).run();

    const i = fakeAutocomplete({ name: 'splice', user: 'u1', focused: { name: 'dino', value: '' } });
    await spliceCmd.autocomplete!(ctx, i.asAutocomplete());
    const values = (i.replies[0] as Array<{ value: number }>).map((c) => c.value);
    expect(values).toContain(ok.id);
    expect(values).toContain(mythic.id);
    expect(values).not.toContain(escaped.id);
    expect(values).not.toContain(locked.id);
  });

  it('responds empty for an unknown player and creates no user row', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const i = fakeAutocomplete({ name: 'splice', user: 'ghost', focused: { name: 'dino', value: '' } });
    await spliceCmd.autocomplete!(ctx, i.asAutocomplete());
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
    expect(i.replies[0]).toEqual([]);
  });
});

describe('/splice', () => {
  it('previews without charging, then the confirm button commits', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { shards: 100 }, 'test', 0);
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0, traits: ['prolific', 'savage'],
    }).returning().get();

    const i = fakeCommand({ name: 'splice', user: 'u1', options: { dino: d.id, slot: 1 } });
    await spliceCmd.execute(ctx, i.asChatInput());
    // Preview only — nothing charged, nothing mutated.
    expect(ctx.db.select().from(schema.users).all()[0].shards).toBe(100);
    expect(ctx.db.select().from(schema.dinos).all()[0].traits).toEqual(['prolific', 'savage']);

    const btn = fakeButton({ customId: `splice:confirm:${d.id}:0`, user: 'u1' });
    await spliceBtn.execute(ctx, btn.asChatInput() as never);
    expect(ctx.db.select().from(schema.users).all()[0].shards).toBe(100 - SPLICE_SHARD_COST);
    const after = ctx.db.select().from(schema.dinos).all()[0].traits;
    expect(after[1]).toBe('savage');
  });

  it('rejects a confirm for a dino the clicker does not own', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { shards: 100 }, 'test', 0);
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0, traits: ['prolific'],
    }).returning().get();
    getOrCreateUser(ctx, 'u2', 'u2');

    const btn = fakeButton({ customId: `splice:confirm:${d.id}:0`, user: 'u2' });
    await spliceBtn.execute(ctx, btn.asChatInput() as never);
    expect(replyText(btn.replies[0])).toMatch(/do not own/);
    // Untouched: neither the trait nor u1's shards moved.
    expect(ctx.db.select().from(schema.dinos).all()[0].traits).toEqual(['prolific']);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.shards).toBe(100);
  });

  it('refuses in the preview when the dino is locked', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { shards: 100 }, 'test', 0);
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: d.id, parentB: d.id, rarity: 'common', startedAt: 0, readyAt: 999,
    }).run();

    const i = fakeCommand({ name: 'splice', user: 'u1', options: { dino: d.id, slot: 1 } });
    await spliceCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toMatch(/busy|locked/i);
  });

  it('refuses in the preview without enough shards', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();

    const i = fakeCommand({ name: 'splice', user: 'u1', options: { dino: d.id, slot: 1 } });
    await spliceCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toMatch(/shards/i);
  });
});
