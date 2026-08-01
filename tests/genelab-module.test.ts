import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeAutocomplete, fakeButton, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { geneLabModule } from '../src/modules/genelab/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { BREED_FEE, BREED_MS } from '../src/data/breeding.js';

const breedCmd = geneLabModule.commands.find((c) => c.data.name === 'breed')!;
const breedBtn = geneLabModule.components.find((c) => c.prefix === 'breed')!;

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
});
