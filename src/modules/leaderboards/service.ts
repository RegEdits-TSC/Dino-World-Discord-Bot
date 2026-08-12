import { eq, inArray } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { RARITY_WEIGHT } from '../../data/progression.js';
import { allSpecies, getSpecies } from '../../data/species/index.js';

export type Metric = 'rating' | 'cash' | 'collection' | 'legacy' | 'stars' | 'duels';
export type Scope = 'server' | 'global';

export function collectionScore(ctx: Ctx, userId: string): number {
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
  const owned = new Set(dinos.map((d) => d.speciesId));
  return [...owned].reduce((s, id) => s + RARITY_WEIGHT[getSpecies(id).rarity], 0);
}

/**
 * One read per source table, grouped in JS — never a query per user. This is
 * src/core/locks.ts's batch-per-user rule widened to batch-per-BOARD: `scored()`
 * used to call collectionScore once per candidate, so a global collection board
 * cost one query per player on the roster.
 *
 * `userIds` scopes a SERVER board through the same `inArray` predicate the candidate
 * query already uses; omitted, the whole table is read for a global one; `[]` reads
 * nothing at all.
 *
 * Deliberately NOT a GROUP BY. Nothing in src/ has ever used groupBy/count()/sum(),
 * every read here is `.all()` plus JS aggregation, and SUM() over an empty row set
 * returns SQL NULL where `.reduce(…, 0)` returns 0 — which would turn a fresh
 * account's legacy points into NaN, and `NaN >= threshold` is false, so the rank
 * would read as "no rank" rather than fail visibly.
 */
export function collectionScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const rows = userIds === undefined
    ? ctx.db.select().from(schema.dinos).all()
    : userIds.length
      ? ctx.db.select().from(schema.dinos).where(inArray(schema.dinos.userId, userIds)).all()
      : [];
  const owned = new Map<string, Set<string>>();
  for (const d of rows) {
    let set = owned.get(d.userId);
    if (!set) { set = new Set(); owned.set(d.userId, set); }
    set.add(d.speciesId);
  }
  const out = new Map<string, number>();
  for (const [userId, species] of owned) {
    let total = 0;
    // getSpecies THROWS on an id not in the roster, exactly as collectionScore does —
    // parity is the point, so this is deliberately not guarded.
    for (const id of species) total += RARITY_WEIGHT[getSpecies(id).rarity];
    out.set(userId, total);
  }
  return out;
}

export function starScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const rows = userIds === undefined
    ? ctx.db.select().from(schema.battleProgress).all()
    : userIds.length
      ? ctx.db.select().from(schema.battleProgress).where(inArray(schema.battleProgress.userId, userIds)).all()
      : [];
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.userId, (out.get(r.userId) ?? 0) + r.stars);
  return out;
}

/**
 * The board-wide twin of legacyPoints (src/modules/park/ranks.ts). The two must agree
 * for any given user — a board that disagrees with the rank on the player's own park
 * card is worse than no board.
 */
export function legacyScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const seenRows = userIds === undefined
    ? ctx.db.select().from(schema.speciesSeen).all()
    : userIds.length
      ? ctx.db.select().from(schema.speciesSeen).where(inArray(schema.speciesSeen.userId, userIds)).all()
      : [];
  const claimRows = userIds === undefined
    ? ctx.db.select().from(schema.achievementClaims).all()
    : userIds.length
      ? ctx.db.select().from(schema.achievementClaims).where(inArray(schema.achievementClaims.userId, userIds)).all()
      : [];
  const out = new Map<string, number>();
  // dexProgress counts the seen set INTERSECTED with the live roster, so a retired
  // species id contributes nothing. earnedTierCount, by contrast, is a plain row
  // count with no filter against ACHIEVEMENTS — matching each one exactly is what
  // keeps this in agreement with legacyPoints.
  const roster = new Set(allSpecies().map((s) => s.id));
  for (const r of seenRows) {
    if (!roster.has(r.speciesId)) continue;
    out.set(r.userId, (out.get(r.userId) ?? 0) + 1);
  }
  for (const r of claimRows) out.set(r.userId, (out.get(r.userId) ?? 0) + 1);
  for (const [userId, stars] of starScores(ctx, userIds)) {
    out.set(userId, (out.get(userId) ?? 0) + stars);
  }
  return out;
}

function scored(
  ctx: Ctx, metric: Metric, scope: Scope, guildId: string | null,
): Array<{ userId: string; displayName: string; value: number }> {
  // Candidate set: server scope = users seen in this guild (via user_guilds); global = all users.
  // memberIds stays undefined for a global board, which is what tells the score builders
  // below to read a whole table rather than an inArray-scoped slice.
  let users: Array<typeof schema.users.$inferSelect>;
  let memberIds: string[] | undefined;
  if (scope === 'server') {
    if (!guildId) { users = []; memberIds = []; }
    else {
      memberIds = ctx.db.select().from(schema.userGuilds)
        .where(eq(schema.userGuilds.guildId, guildId)).all().map((g) => g.userId);
      users = memberIds.length
        ? ctx.db.select().from(schema.users).where(inArray(schema.users.discordId, memberIds)).all()
        : [];
    }
  } else {
    users = ctx.db.select().from(schema.users).all();
  }
  // One read per source table, never one per candidate — see the builders above. This
  // replaces the old `collectionScore(ctx, u.discordId)` call inside the map, which cost
  // a query per player and was the documented v1-scale limitation here.
  // Limitation kept as-is: `rating` reads the stored parkRating without settling each
  // ranked user's escapes first (settling everyone on every read would be expensive), so
  // a board rating can lag an unsettled escape until that user next interacts.
  // Note: parkRating is stored ×100 (stars×100); formatValue in index.ts divides for display.
  const byUser = metric === 'collection' ? collectionScores(ctx, memberIds)
    : metric === 'legacy' ? legacyScores(ctx, memberIds)
    : metric === 'stars' ? starScores(ctx, memberIds)
    : null;
  const rows = users.map((u) => ({
    userId: u.discordId,
    displayName: u.displayName || u.discordId,
    value: metric === 'cash' ? u.cash
      : metric === 'rating' ? u.parkRating
      : metric === 'duels' ? u.duelRating
      : byUser!.get(u.discordId) ?? 0,
  }));
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

export function topPlayers(
  ctx: Ctx, metric: Metric, scope: Scope, guildId: string | null, limit = 10,
): Array<{ userId: string; displayName: string; value: number }> {
  return scored(ctx, metric, scope, guildId).slice(0, Math.max(0, limit));
}

export function playerRank(
  ctx: Ctx, metric: Metric, scope: Scope, guildId: string | null, userId: string,
): { rank: number; value: number } | null {
  const all = scored(ctx, metric, scope, guildId);
  const idx = all.findIndex((r) => r.userId === userId);
  return idx === -1 ? null : { rank: idx + 1, value: all[idx].value };
}
