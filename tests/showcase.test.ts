import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { setMotto, setFeaturedDino, featuredFor, ShowcaseError, MAX_MOTTO } from '../src/modules/park/showcase.js';

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
