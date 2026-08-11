import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, replyText, fakeAutocomplete } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { setMotto, setFeaturedDino, featuredFor, ShowcaseError, MAX_MOTTO } from '../src/modules/park/showcase.js';
import { parkModule } from '../src/modules/park/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

const row = (id = 'u1') =>
  ctx.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!;
const addDino = (userId = 'u1', speciesId = 'triceratops') =>
  ctx.db.insert(schema.dinos)
    .values({ userId, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();

describe('setMotto', () => {
  it('trims and stores', () => {
    expect(setMotto(ctx, 'u1', '  Where the big ones live  ')).toBe('Where the big ones live');
    expect(row().motto).toBe('Where the big ones live');
  });

  it('blank and null both clear it', () => {
    setMotto(ctx, 'u1', 'something');
    expect(setMotto(ctx, 'u1', '   ')).toBe('');
    expect(row().motto).toBe('');
    setMotto(ctx, 'u1', 'again');
    expect(setMotto(ctx, 'u1', null)).toBe('');
    expect(row().motto).toBe('');
  });

  it('rejects an over-length motto and stores nothing', () => {
    // The builder caps input at 80 too, but the service guard is the real one: a client
    // that ignores the builder still reaches this, and only this is reachable from a test.
    expect(() => setMotto(ctx, 'u1', 'x'.repeat(MAX_MOTTO + 1))).toThrow(ShowcaseError);
    expect(row().motto).toBe('');
  });

  it('accepts exactly the maximum length', () => {
    expect(setMotto(ctx, 'u1', 'x'.repeat(MAX_MOTTO))).toHaveLength(MAX_MOTTO);
  });
});

describe('setFeaturedDino', () => {
  it('stores an owned dino and returns its species', () => {
    const d = addDino();
    expect(setFeaturedDino(ctx, 'u1', d.id)!.id).toBe('triceratops');
    expect(row().featuredDinoId).toBe(d.id);
  });

  it('null clears it', () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    expect(setFeaturedDino(ctx, 'u1', null)).toBeNull();
    expect(row().featuredDinoId).toBeNull();
  });

  it('rejects a dino owned by someone else and stores nothing', () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    const theirs = addDino('u2');
    expect(() => setFeaturedDino(ctx, 'u1', theirs.id)).toThrow(ShowcaseError);
    expect(row().featuredDinoId).toBeNull();
  });

  it('rejects a dino id that does not exist', () => {
    expect(() => setFeaturedDino(ctx, 'u1', 9999)).toThrow(ShowcaseError);
  });
});

describe('featuredFor', () => {
  it('resolves to the archetype and diet the art is keyed on', () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    expect(featuredFor(ctx, row())).toEqual({ name: 'Triceratops', archetype: 'tank', diet: 'herbivore' });
  });

  it('prefers the nickname over the species name', () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    ctx.db.update(schema.dinos).set({ nickname: 'Trixie' }).where(eq(schema.dinos.id, d.id)).run();
    expect(featuredFor(ctx, row())!.name).toBe('Trixie');
  });

  it('reads back as no feature once the dino is sold', () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.id, d.id)).run();
    // A dangling id is not an error — it is simply no feature. Nothing sweeps this column,
    // so read-time resolution is the ONLY thing standing between a sold dino and a broken card.
    expect(featuredFor(ctx, row())).toBeNull();
    expect(row().featuredDinoId).toBe(d.id);   // and the stale id is deliberately left alone
  });

  it('reads back as no feature once the dino is traded away', () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    ctx.db.update(schema.dinos).set({ userId: 'u2' }).where(eq(schema.dinos.id, d.id)).run();
    expect(featuredFor(ctx, row())).toBeNull();
  });

  it('is null when nothing is featured', () => {
    expect(featuredFor(ctx, row())).toBeNull();
  });
});

describe('/park motto', () => {
  const run = async (options?: Record<string, string>) => {
    const i = fakeCommand({ name: 'park', sub: 'motto', user: 'u1', options });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('sets the motto and says so', async () => {
    const i = await run({ text: 'Where the big ones live' });
    expect(row().motto).toBe('Where the big ones live');
    expect(replyText(i.replies[0])).toContain('Where the big ones live');
  });

  it('omitting the option clears it', async () => {
    setMotto(ctx, 'u1', 'something');
    const i = await run();
    expect(row().motto).toBe('');
    expect(replyText(i.replies[0]).toLowerCase()).toContain('cleared');
  });
});

describe('/park feature', () => {
  const run = async (options?: Record<string, number>) => {
    const i = fakeCommand({ name: 'park', sub: 'feature', user: 'u1', options });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('features an owned dino', async () => {
    const d = addDino();
    const i = await run({ dino: d.id });
    expect(row().featuredDinoId).toBe(d.id);
    expect(replyText(i.replies[0])).toContain('Triceratops');
  });

  it('omitting the option clears it', async () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    const i = await run();
    expect(row().featuredDinoId).toBeNull();
    expect(replyText(i.replies[0]).toLowerCase()).toContain('cleared');
  });

  it("refuses someone else's dino ephemerally and stores nothing", async () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    const theirs = addDino('u2');
    const i = await run({ dino: theirs.id });
    expect(row().featuredDinoId).toBeNull();
    expect(replyText(i.replies[0])).toContain('do not own');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('suggests the caller\'s dinos and creates no user row for a stranger', async () => {
    addDino();
    const i = fakeAutocomplete({ name: 'park', sub: 'feature', user: 'nobody', focused: { name: 'dino', value: '' } });
    await parkModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    // A provider must never call getOrCreateUser: a row per keystroke is the bug the
    // provider contract exists to prevent.
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'nobody')).get()).toBeUndefined();
    expect(i.replies[0]).toEqual([{ name: 'No dinos — hatch an egg first', value: 0 }]);
  });

  it('offers an escaped dino as a valid target', async () => {
    const d = addDino();
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, d.id)).run();
    const i = fakeAutocomplete({ name: 'park', sub: 'feature', user: 'u1', focused: { name: 'dino', value: '' } });
    await parkModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    // Featuring neither consumes nor moves a dino, so escape state is irrelevant here —
    // the same reasoning /dino rename's provider records.
    expect((i.replies[0] as Array<{ value: number }>).map((c) => c.value)).toEqual([d.id]);
  });
});
