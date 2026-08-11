import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { duelSquad, setDuelSquad, DuelError } from '../src/modules/duels/service.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

/** Insert a dino for `user` and return its row id. `.returning().get()` is the repo idiom. */
function addDino(user: string, speciesId: string, battleXp = 0): number {
  return ctx.db.insert(schema.dinos)
    .values({ userId: user, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, battleXp })
    .returning().get().id;
}

describe('duelSquad', () => {
  it('auto-picks the top three by battle level, highest first', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const weak = addDino('a', 'triceratops', 0);
    const mid = addDino('a', 'triceratops', 700);
    const strong = addDino('a', 'triceratops', 3200);
    const fourth = addDino('a', 'triceratops', 100);
    const squad = duelSquad(ctx, 'a');
    expect(squad.map((m) => m.dinoId)).toEqual([strong, mid, fourth]);
    expect(squad.some((m) => m.dinoId === weak)).toBe(false);
  });

  it('breaks equal-XP ties by id ascending, with no rng', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const first = addDino('a', 'triceratops', 500);
    const second = addDino('a', 'triceratops', 500);
    const third = addDino('a', 'triceratops', 500);
    addDino('a', 'triceratops', 500);
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([first, second, third]);
  });

  it('prefers an explicitly set squad over the auto pick', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const weak = addDino('a', 'triceratops', 0);
    addDino('a', 'triceratops', 3200);
    setDuelSquad(ctx, 'a', [weak]);
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([weak]);
  });

  it('drops a stale id from a set squad and keeps the rest', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const kept = addDino('a', 'triceratops', 0);
    const sold = addDino('a', 'triceratops', 0);
    setDuelSquad(ctx, 'a', [kept, sold]);
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.id, sold)).run();
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([kept]);
  });

  it('falls back to auto when every id in the set squad is gone', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const gone = addDino('a', 'triceratops', 0);
    setDuelSquad(ctx, 'a', [gone]);
    const live = addDino('a', 'triceratops', 3200);
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.id, gone)).run();
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([live]);
  });

  it('excludes an escaped dino', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const fit = addDino('a', 'triceratops', 0);
    const escaped = addDino('a', 'triceratops', 3200);
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, escaped)).run();
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([fit]);
  });

  it('throws for a player with no eligible dinos', () => {
    getOrCreateUser(ctx, 'a', 'A');
    expect(() => duelSquad(ctx, 'a')).toThrow(DuelError);
  });

  it('throws for a player with no park row at all', () => {
    expect(() => duelSquad(ctx, 'ghost-user')).toThrow(DuelError);
  });

  it('carries the archetype and diet the art is keyed on', () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', 'triceratops', 0);
    const [lead] = duelSquad(ctx, 'a');
    expect(lead.archetype).toBeTruthy();
    expect(lead.diet).toBeTruthy();
    expect(lead.level).toBe(1);
  });
});

describe('setDuelSquad', () => {
  it('rejects a dino the caller does not own', () => {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
    addDino('a', 'triceratops', 0);
    const theirs = addDino('b', 'triceratops', 0);
    expect(() => setDuelSquad(ctx, 'a', [theirs])).toThrow(DuelError);
  });

  it('rejects the same dino listed twice', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const one = addDino('a', 'triceratops', 0);
    expect(() => setDuelSquad(ctx, 'a', [one, one])).toThrow(/once per squad/);
  });

  it('rejects an escaped dino at set time', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const escaped = addDino('a', 'triceratops', 0);
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, escaped)).run();
    expect(() => setDuelSquad(ctx, 'a', [escaped])).toThrow(DuelError);
  });

  it('rejects more than three', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const ids = [0, 0, 0, 0].map(() => addDino('a', 'triceratops', 0));
    expect(() => setDuelSquad(ctx, 'a', ids)).toThrow(/at most 3/);
  });

  it('clears back to auto when passed an empty list', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const weak = addDino('a', 'triceratops', 0);
    const strong = addDino('a', 'triceratops', 3200);
    setDuelSquad(ctx, 'a', [weak]);
    const cleared = setDuelSquad(ctx, 'a', []);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!.duelSquad).toEqual([]);
    expect(cleared.map((m) => m.dinoId)).toEqual([strong, weak]);
  });
});
