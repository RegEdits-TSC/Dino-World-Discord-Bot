import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { battleLevel } from '../../data/battle/stats.js';
import { escapeMoment } from '../../core/clock.js';
import { toClockDinos } from '../park/service.js';

export class DuelError extends Error {}

export const MAX_DUEL_SQUAD = 3;

/** One combatant as the duel surfaces see it. `archetype`/`diet` are the art key. */
export interface DuelSquadMember {
  dinoId: number; name: string; speciesId: string;
  archetype: string; diet: string; level: number; traits: string[];
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
