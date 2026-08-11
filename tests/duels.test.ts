import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { duelSquad, setDuelSquad, DuelError, resolveDuel, cooldownUntil } from '../src/modules/duels/service.js';
import { allSpecies } from '../src/data/species/index.js';
import { outcomeFor } from '../src/data/battle/duel.js';
import type { BattleResult } from '../src/data/battle/resolve.js';
import { DUEL_PAIR_COOLDOWN_MS, DUEL_CHALLENGE_TTL_MS } from '../src/data/battle/constants.js';

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

describe('outcomeFor', () => {
  const base: BattleResult = {
    won: false, rounds: 30, squadKos: 0, squadSurvivors: [],
    beats: [{ title: 'Opening clash', lines: ['x'] }, { title: 'The climax', lines: ['y'] }],
    finalHp: {},
  };

  it('reads a side-0 win as a challenger win when the challenger is side 0', () => {
    expect(outcomeFor({ ...base, won: true, squadSurvivors: ['d1'] }, true)).toBe('win');
  });

  it('reads a side-0 win as a challenger LOSS when the defender is side 0', () => {
    expect(outcomeFor({ ...base, won: true, squadSurvivors: ['d1'] }, false)).toBe('loss');
  });

  // The only correct draw inference. `rounds === MAX_ROUNDS` is not equivalent — a
  // fight can be decided on the last round — and no squadKos test is equivalent either.
  it('reads survivors on a non-win as a draw, whichever side the challenger is', () => {
    expect(outcomeFor({ ...base, won: false, squadSurvivors: ['d1'] }, true)).toBe('draw');
    expect(outcomeFor({ ...base, won: false, squadSurvivors: ['d1'] }, false)).toBe('draw');
  });

  it('reads a wiped side 0 as a win for the other side', () => {
    expect(outcomeFor({ ...base, won: false, squadSurvivors: [] }, true)).toBe('loss');
    expect(outcomeFor({ ...base, won: false, squadSurvivors: [] }, false)).toBe('win');
  });
});

describe('resolveDuel', () => {
  const strong = allSpecies().find((s) => s.rarity === 'legendary')!;
  const weak = allSpecies().find((s) => s.rarity === 'common')!;

  function pair(): void {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
  }

  it('is zero-sum: the defender loses exactly what the challenger gains', () => {
    pair();
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    const out = resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(out.ratingAfter.challenger + out.ratingAfter.defender)
      .toBe(out.ratingBefore.challenger + out.ratingBefore.defender);
    expect(out.ratingAfter.challenger - out.ratingBefore.challenger).toBe(out.eloDelta);
    expect(out.ratingAfter.defender - out.ratingBefore.defender).toBe(-out.eloDelta);
  });

  it('conserves rating in the database across unequal starting ratings', () => {
    for (const [ra, rb] of [[1000, 1000], [1240, 900], [903, 1477], [1500, 1501]]) {
      const c = makeCtx();
      getOrCreateUser(c, 'a', 'A'); getOrCreateUser(c, 'b', 'B');
      for (const [u, sp] of [['a', strong.id], ['b', weak.id]] as const) {
        c.db.insert(schema.dinos)
          .values({ userId: u, speciesId: sp, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
      }
      c.db.update(schema.users).set({ duelRating: ra }).where(eq(schema.users.discordId, 'a')).run();
      c.db.update(schema.users).set({ duelRating: rb }).where(eq(schema.users.discordId, 'b')).run();
      resolveDuel(c, 'a', 'b', 'ghost');
      const after = c.db.select().from(schema.users).all()
        .reduce((sum, u) => sum + u.duelRating, 0);
      expect(after, `ratings ${ra}/${rb}`).toBe(ra + rb);
    }
  });

  it('persists both ratings and exactly one log row', () => {
    pair();
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    const out = resolveDuel(ctx, 'a', 'b', 'ghost');
    const rowA = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!;
    const rowB = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'b')).get()!;
    expect(rowA.duelRating).toBe(out.ratingAfter.challenger);
    expect(rowB.duelRating).toBe(out.ratingAfter.defender);
    const log = ctx.db.select().from(schema.duels).all();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      challengerId: 'a', defenderId: 'b', mode: 'ghost',
      result: out.result, eloDelta: out.eloDelta,
    });
  });

  it('a heavily outmatched defender loses', () => {
    pair();
    addDino('a', strong.id, 3200);
    addDino('a', strong.id, 3200);
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    expect(resolveDuel(ctx, 'a', 'b', 'ghost').result).toBe('win');
  });

  it('pays nothing but a record — no cash, shards, energy or XP moves', () => {
    pair();
    const mine = addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    const before = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!;
    resolveDuel(ctx, 'a', 'b', 'ghost');
    const after = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!;
    expect(after.cash).toBe(before.cash);
    expect(after.shards).toBe(before.shards);
    expect(after.energy).toBe(before.energy);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, mine)).get()!.battleXp).toBe(3200);
    expect(ctx.db.select().from(schema.battleProgress).all()).toEqual([]);
    expect(ctx.db.select().from(schema.userStats).all()).toEqual([]);
  });

  it('reports both squads and both survivor counts', () => {
    pair();
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    const out = resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(out.squads.challenger).toHaveLength(1);
    expect(out.squads.defender).toHaveLength(1);
    // Deterministic fixture (default ctx rng): a single max-level legendary against
    // a single level-1 common wins outright with its lone combatant still standing
    // and wipes the defender's lone combatant. Exact counts, not a vacuous >= 0.
    expect(out.survivors.challenger).toBe(1);
    expect(out.survivors.defender).toBe(0);
    expect(out.names).toEqual({ challenger: 'A', defender: 'B' });
    expect(out.beats).toHaveLength(2);
  });

  it('refuses a defender with no park row', () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', strong.id, 0);
    expect(() => resolveDuel(ctx, 'a', 'nobody', 'ghost')).toThrow(/no park yet/);
  });

  it('refuses when the challenger has no battle-ready dinos', () => {
    pair();
    addDino('b', weak.id, 0);
    // Tightened to the challenger-specific rephrasing so this can no longer pass
    // against the defender's un-rephrased "That player has no battle-ready dinos."
    expect(() => resolveDuel(ctx, 'a', 'b', 'ghost')).toThrow(/hatch or rescue/);
  });

  it('refuses a self-duel and writes no log row', () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', strong.id, 3200);
    expect(() => resolveDuel(ctx, 'a', 'a', 'ghost')).toThrow(/duel yourself/);
    expect(ctx.db.select().from(schema.duels).all()).toHaveLength(0);
  });

  // Side 0 gets a free first strike on every speed tie (resolveBattle sorts by
  // spd desc, then side asc), so the coin flip is what stops a mirror match being
  // decided by argument order. Both branches must be reachable from ctx.rng.
  it('flips a coin for side 0 rather than always seating the challenger first', () => {
    const seen = new Set<boolean>();
    for (const first of [true, false]) {
      const c = makeCtx({ rng: () => (first ? 0.1 : 0.9) });
      getOrCreateUser(c, 'a', 'A'); getOrCreateUser(c, 'b', 'B');
      for (const u of ['a', 'b']) {
        c.db.insert(schema.dinos)
          .values({ userId: u, speciesId: weak.id, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
      }
      const out = resolveDuel(c, 'a', 'b', 'ghost');
      seen.add(out.challengerWasSideZero);
      // Identical species and level on both sides, constant rng, so side 0 wins
      // every initiative tie: this proves seating actually follows the flag, not
      // just that the flag varies (an implementation that always seated the
      // challenger side 0 would still produce {true, false} from the flag alone).
      expect(out.result).toBe(out.challengerWasSideZero ? 'win' : 'loss');
    }
    expect(seen).toEqual(new Set([true, false]));
  });
});

describe('duel pacing', () => {
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  function pairWithDinos(): void {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0);
    addDino('b', weak.id, 0);
  }

  it('refuses a second ghost duel against the same defender inside the window', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(() => resolveDuel(ctx, 'a', 'b', 'ghost')).toThrow(DuelError);
  });

  it('allows the ghost again once the window has passed', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'ghost');
    ctx.setNow(DUEL_PAIR_COOLDOWN_MS + 1);
    expect(() => resolveDuel(ctx, 'a', 'b', 'ghost')).not.toThrow();
  });

  // Directional: being ghosted does not stop you hitting back immediately.
  it('lets the defender counter-attack straight away', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(() => resolveDuel(ctx, 'b', 'a', 'ghost')).not.toThrow();
  });

  it('counts a live duel against the pair cooldown too', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'live', DUEL_CHALLENGE_TTL_MS);
    expect(() => resolveDuel(ctx, 'a', 'b', 'ghost')).toThrow(DuelError);
  });

  it('does not cool down the live path itself — the defender consented by clicking', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'live', DUEL_CHALLENGE_TTL_MS);
    expect(() => resolveDuel(ctx, 'a', 'b', 'live', 2 * DUEL_CHALLENGE_TTL_MS)).not.toThrow();
  });

  // A double-clicked Accept: i.update removes the buttons, but Discord can deliver
  // two clicks before that lands, and each would move Elo. The customId's expiry
  // stamp is the idempotency key — no stored challenge row anywhere.
  it('refuses a second accept of the SAME challenge', () => {
    pairWithDinos();
    const expiresAt = DUEL_CHALLENGE_TTL_MS;
    resolveDuel(ctx, 'a', 'b', 'live', expiresAt);
    expect(() => resolveDuel(ctx, 'a', 'b', 'live', expiresAt)).toThrow(/already/i);
    expect(ctx.db.select().from(schema.duels).all()).toHaveLength(1);
  });

  // Accepted design limitation (owner ruling): a live challenge stores nothing, so
  // two overlapping challenges to one defender inside a single TTL share a window and
  // cannot be told apart. The second accept is refused rather than resolving twice —
  // the safe direction. Change this only by giving a challenge a real stored identity.
  //
  // The overlap only bites when the OLDER challenge is accepted late — after the newer
  // one has already gone out — so its accept instant lands inside both windows: card 1
  // posted at t=0 (expiresAt = TTL), card 2 posted at t=60_000 (expiresAt = TTL +
  // 60_000). The defender is slow and only accepts card 1 at t=60_000, once card 2 is
  // already live; that same instant is >= card 2's own (expiresAt - TTL), so accepting
  // card 2 next collides with it.
  it('refuses a second, genuinely different challenge inside the same window', () => {
    pairWithDinos();
    ctx.setNow(60_000);
    resolveDuel(ctx, 'a', 'b', 'live', DUEL_CHALLENGE_TTL_MS);          // late accept of challenge 1
    expect(() => resolveDuel(ctx, 'a', 'b', 'live', DUEL_CHALLENGE_TTL_MS + 60_000))
      .toThrow(/already duelled this player/i);
  });

  it('reports when a cooled-down pair frees up, and null when it is free now', () => {
    pairWithDinos();
    expect(cooldownUntil(ctx, 'a', 'b')).toBeNull();
    resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(cooldownUntil(ctx, 'a', 'b')).toBe(DUEL_PAIR_COOLDOWN_MS);
    expect(cooldownUntil(ctx, 'b', 'a')).toBeNull();
  });
});
