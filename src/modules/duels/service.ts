import { and, eq, or } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { battleLevel, statsFor } from '../../data/battle/stats.js';
import { escapeMoment } from '../../core/clock.js';
import { toClockDinos } from '../park/service.js';
import { resolveBattle, type BeatSummary, type Combatant } from '../../data/battle/resolve.js';
import { outcomeFor, type DuelMode, type DuelResult } from '../../data/battle/duel.js';
import { eloDelta } from '../../data/battle/elo.js';
import { DUEL_PAIR_COOLDOWN_MS, DUEL_CHALLENGE_TTL_MS } from '../../data/battle/constants.js';
import type { Archetype, Diet } from '../../data/types.js';

export class DuelError extends Error {}

export const MAX_DUEL_SQUAD = 3;

/** One combatant as the duel surfaces see it. `archetype`/`diet` are the art key. */
export interface DuelSquadMember {
  dinoId: number; name: string; speciesId: string;
  archetype: Archetype; diet: Diet; level: number; traits: string[];
}

type DinoRow = typeof schema.dinos.$inferSelect;

function toMember(d: DinoRow): DuelSquadMember {
  const sp = getSpecies(d.speciesId);
  return {
    dinoId: d.id, name: d.nickname ?? sp.name, speciesId: d.speciesId,
    archetype: sp.archetype, diet: sp.diet, level: battleLevel(d.battleXp), traits: d.traits,
  };
}

/**
 * Every dino this player could field right now, escaped ones removed.
 *
 * Escape is evaluated READ-ONLY, via escapeMoment. settleEscapes writes, and a duel
 * resolves the DEFENDER's squad from a command they never ran — stamping their rows
 * there would break the documented rule that escapes settle only when a command
 * touches your park (the same rule the alert sweep refuses to break). A challenger's
 * own path calls settleEscapes in the command layer before reaching here.
 */
function eligibleDinos(ctx: Ctx, userId: string): DinoRow[] {
  // toClockDinos asserts the users row exists (.get()!), so guard it first.
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) throw new DuelError('That player has no park yet.');
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  const now = ctx.now();
  return dinos.filter((_, k) => escapeMoment(clockDinos[k], now) === null);
}

/**
 * The squad a player fields: their explicitly set one if any of it survives, else
 * their top 3 by battle XP (ties by id ascending — deterministic, no rng).
 *
 * Stale ids self-heal here rather than being swept, the same tolerance featuredFor
 * gives a sold featured dino: this is a read path and must stay one.
 */
export function duelSquad(ctx: Ctx, userId: string): DuelSquadMember[] {
  const eligible = eligibleDinos(ctx, userId);
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  const byId = new Map(eligible.map((d) => [d.id, d]));
  const chosen = user.duelSquad
    .map((id) => byId.get(id))
    .filter((d): d is DinoRow => d !== undefined);
  const roster = chosen.length
    ? chosen
    : [...eligible].sort((a, b) => b.battleXp - a.battleXp || a.id - b.id);
  const squad = roster.slice(0, MAX_DUEL_SQUAD).map(toMember);
  if (!squad.length) throw new DuelError('That player has no battle-ready dinos.');
  return squad;
}

/**
 * Store a squad, or clear it with an empty list. Validated at the boundary AND
 * filtered at read time: set-time validation makes a typo a visible error, and
 * read-time filtering handles a dino sold after it was set, which no amount of
 * set-time checking can prevent.
 */
export function setDuelSquad(ctx: Ctx, userId: string, dinoIds: number[]): DuelSquadMember[] {
  if (dinoIds.length > MAX_DUEL_SQUAD) throw new DuelError(`A duel squad holds at most ${MAX_DUEL_SQUAD} dinos.`);
  if (new Set(dinoIds).size !== dinoIds.length) throw new DuelError('Each dino can only fight once per squad.');
  const eligible = new Map(eligibleDinos(ctx, userId).map((d) => [d.id, d]));
  for (const id of dinoIds) {
    if (!eligible.has(id)) throw new DuelError(`#${id} is not one of your battle-ready dinos.`);
  }
  ctx.db.update(schema.users).set({ duelSquad: dinoIds })
    .where(eq(schema.users.discordId, userId)).run();
  return duelSquad(ctx, userId);
}

/** Everything the surfaces need. `result` and `eloDelta` are the challenger's. */
export interface DuelOutcome {
  challengerId: string; defenderId: string; mode: DuelMode;
  names: { challenger: string; defender: string };
  result: DuelResult;
  eloDelta: number;
  ratingBefore: { challenger: number; defender: number };
  ratingAfter: { challenger: number; defender: number };
  squads: { challenger: DuelSquadMember[]; defender: DuelSquadMember[] };
  survivors: { challenger: number; defender: number };
  beats: [BeatSummary, BeatSummary];
  rounds: number;
  challengerWasSideZero: boolean;
  /** Read from the defender's row here so the caller needs no second query. */
  defenderAlertsEnabled: boolean;
}

// Dino row ids are globally unique and nobody can duel themselves, so one key
// scheme is safe for both sides. finalHp is a flat record with no namespacing by
// side — two combatants sharing a key would silently collapse into one entry.
const keyOf = (m: DuelSquadMember) => `d${m.dinoId}`;

function combatants(squad: DuelSquadMember[], side: 0 | 1): Combatant[] {
  return squad.map((m) => {
    const s = statsFor(m.speciesId, m.level, m.traits);   // traits on BOTH sides, unlike PvE
    return {
      key: keyOf(m), name: m.name, speciesId: m.speciesId,
      archetype: m.archetype,
      maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, side,
    };
  });
}

/**
 * When this ordered pair frees up, or null if it is free now. Derived: the newest
 * log row for (challenger → defender) plus the window. Two unindexed table filters,
 * filtered in SQL — the locksFor shape. Nothing sweeps, nothing is stored.
 */
export function cooldownUntil(ctx: Ctx, challengerId: string, defenderId: string): number | null {
  const rows = ctx.db.select().from(schema.duels)
    .where(and(eq(schema.duels.challengerId, challengerId), eq(schema.duels.defenderId, defenderId))).all();
  if (!rows.length) return null;
  const until = Math.max(...rows.map((r) => r.createdAt)) + DUEL_PAIR_COOLDOWN_MS;
  return until > ctx.now() ? until : null;
}

/**
 * Has this exact challenge already been accepted? A live challenge stores nothing,
 * so its identity is the expiry instant baked into the button's customId: any live
 * duel for this pair inside that challenge's own lifetime IS this challenge.
 */
function challengeAlreadyResolved(
  ctx: Ctx, challengerId: string, defenderId: string, expiresAtMs: number,
): boolean {
  return ctx.db.select().from(schema.duels)
    .where(and(
      eq(schema.duels.challengerId, challengerId),
      eq(schema.duels.defenderId, defenderId),
      eq(schema.duels.mode, 'live'),
    )).all()
    // Inclusive lower bound: a challenge posted at t has expiresAtMs = t + TTL, so its
    // own duel lands at exactly `expiresAtMs - TTL`. An exclusive `>` would miss the
    // duel it is meant to detect — and at ctx.now() === 0, which is where the tests
    // live, it misses every one of them.
    .some((r) => r.createdAt >= expiresAtMs - DUEL_CHALLENGE_TTL_MS && r.createdAt <= expiresAtMs);
}

/**
 * Resolve one duel and commit it. Writes exactly two things — both ratings and one
 * log row — in a single transaction that closes before any Discord call, so the
 * router's "nothing was charged" error path stays honest (commit-before-present).
 *
 * No world event reaches a duel: eventMods is sampled by hand in runFight and its
 * enemyHp term is meaningless in a symmetric match, where "the enemy" is whichever
 * player the coin flip happened to seat second.
 */
export function resolveDuel(
  ctx: Ctx, challengerId: string, defenderId: string, mode: DuelMode,
  challengeExpiresAtMs?: number,
): DuelOutcome {
  // Defence in depth: the command surfaces reject this, but a self-duel would
  // collide both squads on one finalHp key scheme AND apply both rating updates
  // to one row — the second write wins, so a loss would ADD rating.
  if (challengerId === defenderId) throw new DuelError("You can't duel yourself.");

  const challenger = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, challengerId)).get();
  if (!challenger) throw new DuelError('You have no park yet.');
  const defender = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, defenderId)).get();
  if (!defender) throw new DuelError('That player has no park yet.');

  if (mode === 'ghost') {
    const until = cooldownUntil(ctx, challengerId, defenderId);
    if (until !== null) {
      throw new DuelError(
        `You duelled ${defender.displayName || defenderId} recently — you can again <t:${Math.floor(until / 1000)}:R>.`);
    }
  } else if (challengeExpiresAtMs !== undefined
      && challengeAlreadyResolved(ctx, challengerId, defenderId, challengeExpiresAtMs)) {
    throw new DuelError('That challenge has already been accepted.');
  }

  let mySquad: DuelSquadMember[];
  try {
    mySquad = duelSquad(ctx, challengerId);
  } catch (e) {
    // Only re-phrase the "no battle-ready dinos" case for the challenger's own
    // point of view; anything else (a retired species id, a DB fault) must not be
    // disguised as an empty roster.
    if (!(e instanceof DuelError)) throw e;
    throw new DuelError('You have no battle-ready dinos — hatch or rescue one first.');
  }
  const theirSquad = duelSquad(ctx, defenderId);   // already phrased for the other player

  // Side 0 wins every initiative tie (resolveBattle sorts spd desc, then side asc,
  // then array index), and `side` is a field on each combatant rather than a
  // consequence of argument order — so without this flip the challenger would get a
  // free first strike in every mirror match.
  const challengerWasSideZero = ctx.rng() < 0.5;
  const mine = combatants(mySquad, challengerWasSideZero ? 0 : 1);
  const theirs = combatants(theirSquad, challengerWasSideZero ? 1 : 0);
  const battle = challengerWasSideZero
    ? resolveBattle(mine, theirs, ctx.rng)
    : resolveBattle(theirs, mine, ctx.rng);

  const result = outcomeFor(battle, challengerWasSideZero);
  const alive = (squad: DuelSquadMember[]) =>
    squad.filter((m) => (battle.finalHp[keyOf(m)] ?? 0) > 0).length;

  const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  // ONE delta, negated for the defender. Rounding each side independently would not
  // conserve points — see src/data/battle/elo.ts.
  const delta = eloDelta(challenger.duelRating, defender.duelRating, score);
  const ratingBefore = { challenger: challenger.duelRating, defender: defender.duelRating };
  const ratingAfter = {
    challenger: challenger.duelRating + delta,
    defender: defender.duelRating - delta,
  };
  const now = ctx.now();

  ctx.db.transaction(() => {
    ctx.db.update(schema.users).set({ duelRating: ratingAfter.challenger })
      .where(eq(schema.users.discordId, challengerId)).run();
    ctx.db.update(schema.users).set({ duelRating: ratingAfter.defender })
      .where(eq(schema.users.discordId, defenderId)).run();
    ctx.db.insert(schema.duels).values({
      challengerId, defenderId, mode, result, eloDelta: delta, createdAt: now,
    }).run();
  });

  return {
    challengerId, defenderId, mode,
    names: { challenger: challenger.displayName || challengerId, defender: defender.displayName || defenderId },
    result, eloDelta: delta, ratingBefore, ratingAfter,
    squads: { challenger: mySquad, defender: theirSquad },
    survivors: { challenger: alive(mySquad), defender: alive(theirSquad) },
    beats: battle.beats, rounds: battle.rounds,
    challengerWasSideZero,
    defenderAlertsEnabled: defender.alertsEnabled,
  };
}
