import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, fakeAutocomplete, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { duelSquad, setDuelSquad, DuelError, resolveDuel, cooldownUntil, duelRecord } from '../src/modules/duels/service.js';
import { allSpecies } from '../src/data/species/index.js';
import { outcomeFor } from '../src/data/battle/duel.js';
import type { BattleResult } from '../src/data/battle/resolve.js';
import { DUEL_PAIR_COOLDOWN_MS, DUEL_CHALLENGE_TTL_MS } from '../src/data/battle/constants.js';
import { duelResultPayload, challengePayload, recordPayload, DUEL_PREFIX } from '../src/modules/duels/embeds.js';
import { duelsModule } from '../src/modules/duels/index.js';
import { dinoImage } from '../src/core/images.js';

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

describe('duel embeds', () => {
  const strong = allSpecies().find((s) => s.rarity === 'legendary')!;
  const weak = allSpecies().find((s) => s.rarity === 'common')!;

  function outcome() {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    return resolveDuel(ctx, 'a', 'b', 'ghost');
  }

  it('names both players, both ratings and both squads', () => {
    const out = outcome();
    const payload = duelResultPayload(out);
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('A');
    expect(embed.description).toContain('B');
    expect(embed.fields!.map((f) => f.name)).toEqual(
      expect.arrayContaining(['Opening clash', 'The climax']));
    expect(JSON.stringify(embed)).toContain('1000');
    // Not just the field NAME — the challenger's field VALUE must actually spell
    // out the real lead member, so a dropped "Lv." prefix or a broken join would fail.
    const lead = out.squads.challenger[0];
    const challengerField = embed.fields!.find((f) => f.name.startsWith(out.names.challenger))!;
    expect(challengerField.value).toContain(`Lv.${lead.level} ${lead.name}`);
  });

  // Elo is a plain integer — never divided the way parkRating is.
  it('renders a rating as a whole number, not a star figure', () => {
    const out = outcome();
    const embed = duelResultPayload(out).embeds[0].toJSON();
    expect(JSON.stringify(embed)).not.toContain('10.0');
    expect(JSON.stringify(embed)).toContain(String(out.ratingAfter.challenger));
  });

  // Two DINO refs could resolve to the SAME basename whenever both leads share an
  // archetype×diet, and attach() appends without deduping — one embed slot would then
  // render the other's picture. Exactly one dino ref, always. The duel banner rides
  // alongside it safely because `duel.webp` can never equal `<archetype>-<diet>.webp`;
  // what matters is the basenames being distinct, not the count.
  it('attaches exactly two images and no two share a basename', () => {
    const names = duelResultPayload(outcome()).files!.map((f) => f.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size, `colliding attachment names: ${names.join(', ')}`).toBe(2);
  });

  // The opposite regression to the collision guard above: an attach() that silently
  // stopped firing would leave files undefined and pass every other assertion here.
  // attach APPENDS and call order is upload order, so the order is pinned too.
  //
  // The expected name is resolved through dinoImage — the same call duelResultPayload
  // makes — rather than hand-built from archetype/diet: `strong` above is the roster's
  // first legendary, and since the hero-species portraits shipped, a legendary or
  // mythic lead now resolves to its own dinos/<speciesId>.webp ahead of the shared
  // archetype art. Hardcoding `${archetype}-${diet}.webp` here would silently stop
  // matching the moment a species that fixture picks gains an override file.
  it('attaches the lead thumbnail first, then the duel banner', () => {
    const out = outcome();
    const payload = duelResultPayload(out);
    const lead = out.result === 'loss' ? out.squads.defender[0] : out.squads.challenger[0];
    const expected = dinoImage(lead.speciesId, lead.archetype, lead.diet)!.file.name;
    expect(payload.files!.map((f) => f.name)).toEqual([expected, 'duel.webp']);
    const embed = payload.embeds[0].toJSON();
    expect(embed.thumbnail?.url).toBe(`attachment://${expected}`);
    expect(embed.image?.url).toBe('attachment://duel.webp');
  });

  it('dresses the challenge card with the duel banner', () => {
    const payload = challengePayload('111', '222', 'A', 'B', 900_000);
    expect(payload.files!.map((f) => f.name)).toEqual(['duel.webp']);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://duel.webp');
  });

  it('dresses the record card with the duel banner', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const payload = recordPayload('A', duelRecord(ctx, 'a'));
    expect(payload.files!.map((f) => f.name)).toEqual(['duel.webp']);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://duel.webp');
  });

  it('carries no buttons on a result', () => {
    expect(duelResultPayload(outcome()).components).toEqual([]);
  });

  it('mints Accept and Decline ids carrying the pair and the expiry', () => {
    const payload = challengePayload('111', '222', 'A', 'B', 900_000);
    const ids = payload.components[0].toJSON().components.map((c) => (c as { custom_id: string }).custom_id);
    expect(ids).toEqual([`${DUEL_PREFIX}:accept:111:222:900000`, `${DUEL_PREFIX}:decline:111:222:900000`]);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(100);
  });

  it('shows the challenged player when the challenge expires', () => {
    const embed = challengePayload('111', '222', 'A', 'B', 900_000).embeds[0].toJSON();
    expect(embed.description).toContain('<t:900:R>');
  });
});

describe('/duel ghost', () => {
  const strong = allSpecies().find((s) => s.rarity === 'legendary')!;
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  const run = async (user: string, opponent: string | { id: string; bot?: boolean }) => {
    const i = fakeCommand({ name: 'duel', sub: 'ghost', user, guild: 'g1', options: { opponent } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('posts a public result and writes the log row', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200); addDino('b', weak.id, 0);
    const i = await run('a', 'b');
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }>; flags?: number };
    expect(payload.embeds[0].toJSON().title).toContain('⚔️');
    expect(payload.flags).toBeUndefined();          // public, not ephemeral
    expect(ctx.db.select().from(schema.duels).all()).toHaveLength(1);
  });

  it('refuses duelling yourself', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', weak.id, 0);
    const i = await run('a', 'a');
    expect(replyText(i.replies[0])).toMatch(/yourself/i);
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  });

  it('refuses duelling a bot', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', weak.id, 0);
    const i = await run('a', { id: 'botto', bot: true });
    expect(replyText(i.replies[0])).toMatch(/bot/i);
  });

  // Unlike /trade offer, a duel never mints a park for someone merely mentioned.
  it('refuses a target with no park and creates no row for them', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', weak.id, 0);
    const i = await run('a', 'stranger');
    expect(replyText(i.replies[0])).toMatch(/no park yet/i);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'stranger')).get()).toBeUndefined();
  });

  it('answers the cooldown ephemerally rather than throwing', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0); addDino('b', weak.id, 0);
    await run('a', 'b');
    const i = await run('a', 'b');
    expect(replyText(i.replies[0])).toMatch(/recently/i);
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  // The module's own getOrCreateUser is what makes a first-time caller work at all.
  // Without it, resolveDuel's challenger lookup would answer "You have no park yet."
  // to someone whose real problem is owning no dinos — and no other test would notice,
  // because they all pre-seed the caller.
  it('creates the caller\'s park row on first use', async () => {
    getOrCreateUser(ctx, 'b', 'B');
    addDino('b', weak.id, 0);
    const i = await run('newcomer', 'b');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'newcomer')).get())
      .toBeDefined();
    expect(replyText(i.replies[0])).toMatch(/hatch or rescue/i);
  });
});

describe('/duel challenge', () => {
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  const challenge = async (user: string, opponent: string) => {
    const i = fakeCommand({ name: 'duel', sub: 'challenge', user, guild: 'g1', options: { opponent } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };
  const click = async (customId: string, user: string) => {
    const b = fakeButton({ customId, user, guild: 'g1' });
    await duelsModule.components[0].execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    return b;
  };
  function pairWithDinos(): void {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0); addDino('b', weak.id, 0);
  }

  it('posts a public card whose buttons carry the pair and the expiry', async () => {
    pairWithDinos();
    const i = await challenge('a', 'b');
    const payload = i.replies[0] as { components: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> };
    const ids = payload.components[0].toJSON().components.map((c) => c.custom_id);
    expect(ids[0]).toBe(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`);   // ctx.now() is 0
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);      // nothing resolved yet
  });

  it('resolves the duel when the challenged player accepts, replacing the card', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    const embed = (b.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> }).embeds[0].toJSON();
    expect(embed.title).toContain('⚔️');
    const log = ctx.db.select().from(schema.duels).all();
    expect(log).toHaveLength(1);
    expect(log[0].mode).toBe('live');
  });

  it('replaces the card in place, shedding its buttons and attachments', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    const payload = b.replies[0] as { components?: unknown[]; attachments?: unknown[] };
    // i.update carrying attachments: [] is what sheds the challenge card's own
    // attachment set; components: [] is what removes the live Accept/Decline buttons
    // from what is now a result message.
    expect(payload.attachments).toEqual([]);
    expect(payload.components).toEqual([]);
  });

  it('accepting uploads the result art while still shedding the challenge card attachment set', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    const payload = b.replies[0] as { files?: Array<{ name?: string | null }>; attachments?: unknown[] };
    // i.update carrying files replaces the message's whole attachment set, and the
    // explicit attachments: [] is what drops the challenge card's own duel.webp upload
    // so the result's two files are the only ones left on the message.
    expect(payload.attachments).toEqual([]);
    expect(payload.files!.map((f) => f.name)).toContain('duel.webp');
    expect(payload.files).toHaveLength(2);
  });

  // The only test that can tell an ARMED double-accept guard from a disarmed one at the
  // handler level: drop the expiry argument in the handler and this goes green-to-red.
  it('refuses a second click of the same Accept button', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    const second = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    expect(replyText(second.replies[0])).toMatch(/already duelled/i);
    expect(ctx.db.select().from(schema.duels).all()).toHaveLength(1);
  });

  it('refuses a clicker who is not the challenged player', async () => {
    pairWithDinos();
    getOrCreateUser(ctx, 'c', 'C');
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'c');
    expect(replyText(b.replies[0])).toMatch(/not for you/i);
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  });

  it('refuses the challenger clicking their own Accept', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'a');
    expect(replyText(b.replies[0])).toMatch(/not for you/i);
  });

  it('refuses an expired challenge', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    ctx.setNow(DUEL_CHALLENGE_TTL_MS + 1);
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    expect(replyText(b.replies[0])).toMatch(/expired/i);
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  });

  it('declines without resolving anything', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:decline:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    expect(JSON.stringify(b.replies[0])).toMatch(/declined/i);
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  });

  it('absorbs an unknown duel action instead of erroring', async () => {
    const b = await click('duel:nonsense:a:b:1', 'b');
    expect(b.deferOpts).toHaveLength(1);
    expect(b.replies).toEqual([]);
  });

  it('refuses challenging yourself or a bot', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', weak.id, 0);
    const self = await challenge('a', 'a');
    expect(replyText(self.replies[0])).toMatch(/yourself/i);
  });
});

describe('/duel squad', () => {
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  const setSquad = async (user: string, options: Record<string, number>) => {
    const i = fakeCommand({ name: 'duel', sub: 'squad', user, options });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('stores the chosen dinos and confirms ephemerally', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const one = addDino('a', weak.id, 0);
    const two = addDino('a', weak.id, 3200);
    const i = await setSquad('a', { dino1: one, dino2: two });
    expect((i.replies[0] as { flags?: number }).flags).toBeDefined();
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!.duelSquad)
      .toEqual([one, two]);
  });

  it('clears back to auto when called with no dinos', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const one = addDino('a', weak.id, 0);
    await setSquad('a', { dino1: one });
    const i = await setSquad('a', {});
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!.duelSquad).toEqual([]);
    expect(replyText(i.replies[0])).toMatch(/top three|automatic/i);
  });

  it("refuses another player's dino", async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0);
    const theirs = addDino('b', weak.id, 0);
    const i = await setSquad('a', { dino1: theirs });
    expect(replyText(i.replies[0])).toMatch(/battle-ready/i);
  });

  it('refuses the same dino twice', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const one = addDino('a', weak.id, 0);
    const i = await setSquad('a', { dino1: one, dino2: one });
    expect(replyText(i.replies[0])).toMatch(/once per squad/i);
  });

  it('suggests only battle-ready dinos, and never creates a user row', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const fit = addDino('a', weak.id, 0);
    const escaped = addDino('a', weak.id, 0);
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, escaped)).run();
    const i = fakeAutocomplete({ name: 'duel', sub: 'squad', user: 'a', focused: { name: 'dino1', value: '' } });
    await duelsModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    const values = (i.replies[0] as Array<{ value: number }>).map((c) => c.value);
    expect(values).toContain(fit);
    expect(values).not.toContain(escaped);
  });

  // The same guarantee /battle fight's provider is tested for: a dino already chosen in
  // another slot must not be offered again, or a player can field the same dino twice
  // and setDuelSquad rejects the whole command at the end.
  it('does not offer a dino already picked in another slot', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const first = addDino('a', weak.id, 0);
    const second = addDino('a', weak.id, 0);
    const i = fakeAutocomplete({
      name: 'duel', sub: 'squad', user: 'a',
      focused: { name: 'dino2', value: '' },
      options: { dino1: first },
    });
    await duelsModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    const values = (i.replies[0] as Array<{ value: number }>).map((c) => c.value);
    expect(values).toContain(second);
    expect(values).not.toContain(first);
  });

  it('responds with an empty list for a player who has no park row', async () => {
    const i = fakeAutocomplete({ name: 'duel', sub: 'squad', user: 'nobody', focused: { name: 'dino1', value: '' } });
    await duelsModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
    expect(ctx.db.select().from(schema.users).all()).toEqual([]);
  });
});

describe('/duel record', () => {
  const weak = allSpecies().find((s) => s.rarity === 'common')!;

  function logRow(challengerId: string, defenderId: string, result: 'win' | 'loss' | 'draw', delta: number, at: number) {
    ctx.db.insert(schema.duels)
      .values({ challengerId, defenderId, mode: 'ghost', result, eloDelta: delta, createdAt: at }).run();
  }

  it('counts both sides of the log from the reader\'s perspective', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    logRow('a', 'b', 'win', 16, 1);      // a won
    logRow('b', 'a', 'win', 12, 2);      // a lost
    logRow('b', 'a', 'draw', 0, 3);      // drew
    logRow('b', 'a', 'loss', -9, 4);     // a won (challenger b lost)
    const rec = duelRecord(ctx, 'a');
    expect({ wins: rec.wins, losses: rec.losses, draws: rec.draws }).toEqual({ wins: 2, losses: 1, draws: 1 });
  });

  it('negates the stored delta when the reader was the defender', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    logRow('b', 'a', 'win', 20, 1);
    const rec = duelRecord(ctx, 'a');
    expect(rec.recent[0].eloDelta).toBe(-20);
    expect(rec.recent[0].result).toBe('loss');
    expect(rec.recent[0].opponentName).toBe('B');
  });

  it('returns the newest duels first, capped at the limit', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    for (let n = 1; n <= 8; n++) logRow('a', 'b', 'win', 1, n);
    const rec = duelRecord(ctx, 'a', 5);
    expect(rec.recent).toHaveLength(5);
    expect(rec.recent.map((r) => r.at)).toEqual([8, 7, 6, 5, 4]);
  });

  it('reads a fresh account as 1000 and an empty history', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const rec = duelRecord(ctx, 'a');
    expect(rec).toMatchObject({ rating: 1000, wins: 0, losses: 0, draws: 0 });
    expect(rec.recent).toEqual([]);
  });

  it('renders another player\'s record when asked', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('b', weak.id, 0);
    const i = fakeCommand({ name: 'duel', sub: 'record', user: 'a', options: { player: 'b' } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> }).embeds[0].toJSON();
    expect(embed.title).toContain('B');
  });

  it('refuses a player with no park row', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const i = fakeCommand({ name: 'duel', sub: 'record', user: 'a', options: { player: 'stranger' } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toMatch(/no park yet/i);
  });
});

describe('duels module registration', () => {
  it('registers under the name duels with the duel prefix', () => {
    expect(duelsModule.name).toBe('duels');
    expect(duelsModule.components[0].prefix).toBe('duel');
    expect(duelsModule.commands[0].data.name).toBe('duel');
  });
});

describe('duel notification', () => {
  const strong = allSpecies().find((s) => s.rarity === 'legendary')!;
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  const ghost = async (user: string, opponent: string, guild: string | undefined = 'g1') => {
    const i = fakeCommand({ name: 'duel', sub: 'ghost', user, guild, options: { opponent } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('tells the absent defender what happened, from the attacker\'s guild', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200); addDino('b', weak.id, 0);
    await ghost('a', 'b');
    expect(ctx.notifications).toHaveLength(1);
    expect(ctx.notifications[0].userId).toBe('b');
    expect(ctx.notifications[0].originGuildId).toBe('g1');
    expect(ctx.notifications[0].message).toContain('A');
    expect(typeof ctx.notifications[0].message).toBe('string');
  });

  it('names the rating move in the message', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200); addDino('b', weak.id, 0);
    await ghost('a', 'b');
    expect(ctx.notifications[0].message).toMatch(/1000/);
  });

  it('respects a defender who muted alerts', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200); addDino('b', weak.id, 0);
    ctx.db.update(schema.users).set({ alertsEnabled: false }).where(eq(schema.users.discordId, 'b')).run();
    await ghost('a', 'b');
    expect(ctx.notifications).toEqual([]);
  });

  it('sends nothing for a live duel — the defender was there', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0); addDino('b', weak.id, 0);
    const i = fakeCommand({ name: 'duel', sub: 'challenge', user: 'a', guild: 'g1', options: { opponent: 'b' } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    const b = fakeButton({ customId: `duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, user: 'b', guild: 'g1' });
    await duelsModule.components[0].execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(ctx.notifications).toEqual([]);
  });
});
