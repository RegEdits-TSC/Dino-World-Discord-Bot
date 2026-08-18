import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { RARITY_WEIGHT } from '../../data/progression.js';
import { allSpecies, getSpecies } from '../../data/species/index.js';
import { seasonIndexFor } from '../../core/world.js';
import { pointsFrom } from '../../data/seasons.js';
import { attendanceFrom } from '../../data/attendance.js';
import { attractionFor } from '../../data/attractions.js';
import { facilityLevel, levelValue } from '../park/service.js';

export type Metric = 'rating' | 'cash' | 'collection' | 'legacy' | 'stars' | 'duels' | 'season' | 'attendance';
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
 * The board-wide twin of legacyPoints (src/modules/park/ranks.ts) — deliberately, not of
 * legacyRank's max(stored, computed) high-water. The two must agree for any given user —
 * a board that disagrees with the rank on the player's own park card is worse than no
 * board. Pairing with legacyRankBest instead would answer a different question than the
 * board exists to answer: the board is "who is ahead right now," a live standing that can
 * legitimately fall if a player's live total drops (see adminReset); legacyRankBest is
 * "what have you ever earned," a monotone high-water mark that must never fall. Mixing
 * the two would let a wiped or otherwise-dropped account keep outranking players who are
 * currently ahead of it for real.
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

/**
 * Live season points, the board-wide twin of seasonPoints — deliberately live, never the
 * badge high-water. The board answers "who is ahead right now"; the park card answers
 * "what have you ever earned". Same split legacyScores draws against legacyRankBest.
 *
 * Two reads, both batched: season_progress scoped to the CURRENT season index (rows are
 * retained per season, so an unfiltered read would return a player's whole history and
 * pick an arbitrary baseline), and user_stats once for the whole board — the per-stat
 * filter is a JS predicate, not a second query.
 *
 * A player with no row for this season scores 0 and is NOT rolled here: minting a baseline
 * from a read path would be one write per candidate on every /top render.
 */
export function seasonScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const index = seasonIndexFor(ctx.now());
  const progressRows = userIds === undefined
    ? ctx.db.select().from(schema.seasonProgress)
        .where(eq(schema.seasonProgress.seasonIndex, index)).all()
    : userIds.length
      ? ctx.db.select().from(schema.seasonProgress)
          .where(and(eq(schema.seasonProgress.seasonIndex, index),
                     inArray(schema.seasonProgress.userId, userIds))).all()
      : [];
  const statRows = userIds === undefined
    ? ctx.db.select().from(schema.userStats).all()
    : userIds.length
      ? ctx.db.select().from(schema.userStats).where(inArray(schema.userStats.userId, userIds)).all()
      : [];
  const byUserStats = new Map<string, Record<string, number>>();
  for (const r of statRows) {
    let m = byUserStats.get(r.userId);
    if (!m) { m = {}; byUserStats.set(r.userId, m); }
    m[r.stat] = r.value;
  }
  const out = new Map<string, number>();
  for (const row of progressRows) {
    const stats = byUserStats.get(row.userId) ?? {};
    out.set(row.userId, pointsFrom(row.baselines, stats, row.headStart).total);
  }
  return out;
}

/**
 * The board-wide twin of attendanceOf (../park/attendance.ts) — deliberately NOT calling
 * attendanceOf per candidate, which is the exact per-user-query trap collectionScores was
 * introduced to retire (see that function's own comment): one dinos + one lots + one
 * attractions read PER PLAYER on a global board. Three reads for the whole board instead,
 * grouped in JS, then recomputed through attendanceFrom exactly like attendanceOf does —
 * so the board and /guests view can never disagree on the formula.
 *
 * The dino predicate matches attendanceOf/recomputeRating's `assigned` filter byte for
 * byte: a dino counts only when its lot is PADDOCK-typed (never a facility) and its
 * stored escapedAt is null. That is the STORED column, never the computed escape instant
 * — the same "no surface has to settle just to render a number" discipline attendanceOf
 * documents.
 *
 * All three reads are memberIds-scoped through the same three-branch shape as
 * collectionScores; a user with no row in any of the three tables is simply absent from
 * the output map and scores 0 via scored()'s `?? 0`, same as every other builder here.
 */
export function attendanceScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const dinoRows = userIds === undefined
    ? ctx.db.select().from(schema.dinos).all()
    : userIds.length
      ? ctx.db.select().from(schema.dinos).where(inArray(schema.dinos.userId, userIds)).all()
      : [];
  const lotRows = userIds === undefined
    ? ctx.db.select().from(schema.lots).all()
    : userIds.length
      ? ctx.db.select().from(schema.lots).where(inArray(schema.lots.userId, userIds)).all()
      : [];
  const attractionRows = userIds === undefined
    ? ctx.db.select().from(schema.attractions).all()
    : userIds.length
      ? ctx.db.select().from(schema.attractions).where(inArray(schema.attractions.userId, userIds)).all()
      : [];

  const lotById = new Map(lotRows.map((l) => [l.id, l]));
  const lotsByUser = new Map<string, typeof lotRows>();
  for (const l of lotRows) {
    let arr = lotsByUser.get(l.userId);
    if (!arr) { arr = []; lotsByUser.set(l.userId, arr); }
    arr.push(l);
  }

  const speciesByUser = new Map<string, Set<string>>();
  for (const d of dinoRows) {
    if (d.escapedAt !== null) continue;
    const lot = d.lotId != null ? lotById.get(d.lotId) : undefined;
    if (!lot || lot.type !== 'paddock') continue;
    let set = speciesByUser.get(d.userId);
    if (!set) { set = new Set(); speciesByUser.set(d.userId, set); }
    set.add(d.speciesId);
  }

  const drawByUser = new Map<string, number>();
  for (const r of attractionRows) {
    // An unknown or retired kind contributes 0 rather than throwing — the same
    // tolerance attendanceOf gives it.
    const draw = levelValue(attractionFor(r.kind)?.draw, r.level, 0);
    drawByUser.set(r.userId, (drawByUser.get(r.userId) ?? 0) + draw);
  }

  // Candidates are the union of every user who appears in any of the three tables —
  // never derived from the formula's own zero cases (e.g. skipping anyone with 0
  // distinct species), which would silently couple this loop to attendanceFrom's
  // internals instead of just calling it.
  const candidateIds = new Set<string>();
  for (const d of dinoRows) candidateIds.add(d.userId);
  for (const r of attractionRows) candidateIds.add(r.userId);
  for (const l of lotRows) candidateIds.add(l.userId);

  const out = new Map<string, number>();
  for (const userId of candidateIds) {
    const distinctSpecies = speciesByUser.get(userId)?.size ?? 0;
    const drawTotal = drawByUser.get(userId) ?? 0;
    const vcLevel = facilityLevel(lotsByUser.get(userId) ?? [], 'visitor_center');
    out.set(userId, attendanceFrom(distinctSpecies, drawTotal, vcLevel));
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
    : metric === 'season' ? seasonScores(ctx, memberIds)
    : metric === 'attendance' ? attendanceScores(ctx, memberIds)
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
