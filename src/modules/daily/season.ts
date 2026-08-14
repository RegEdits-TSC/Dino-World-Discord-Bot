import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { seasonIndexFor, seasonFor, seasonDay, SEASON_DAYS, SEASON_EPOCH, type Season } from '../../core/world.js';
import { readStats, STATS, type StatId } from '../../core/stats.js';
import {
  HEAD_START_CAP, SEASON_SOURCES, SEASON_RUNGS, sourcePoints,
  type SeasonSource, type SeasonRung,
} from '../../data/seasons.js';
import { dexProgress } from '../dex/service.js';

export function currentRow(ctx: Ctx, userId: string) {
  return ctx.db.select().from(schema.seasonProgress)
    .where(and(
      eq(schema.seasonProgress.userId, userId),
      eq(schema.seasonProgress.seasonIndex, seasonIndexFor(ctx.now())),
    )).get();
}

/**
 * A veteran head start, paid once on a player's FIRST season ever — not on calendar
 * season 1, so a returning player who first appears in season 5 is still credited and a
 * genuinely new account computes to ~0 with no special case.
 *
 * Reads ONLY signals that are complete for every account: species_seen (credited at all
 * three mint/transfer sites and backfilled by scripts/backfill-species-seen.ts), battle
 * stars, and ratingHighWater. Achievement claims are excluded even though they look like
 * the obvious fourth term — 7 of 12 ACHIEVEMENTS tracks sit on user_stats counters
 * migration 0006 never backfilled, so including them would under-credit the oldest
 * accounts, the same inversion legacyPoints was built across three other tables to avoid.
 *
 * Rating is divided by 25, not 10, so its term (max 40) stays the smallest of the three:
 * it is the one signal a veteran can still move DURING the season, and weighting it
 * heavier would drift toward double-counting live progress.
 */
export function headStartFor(ctx: Ctx, userId: string): number {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  if (!user) return 0;
  const stars = ctx.db.select().from(schema.battleProgress)
    .where(eq(schema.battleProgress.userId, userId)).all()
    .reduce((s, r) => s + r.stars, 0);
  const species = dexProgress(ctx, userId).seen;
  return Math.min(HEAD_START_CAP, species + stars + Math.floor(user.ratingHighWater / 25));
}

/**
 * Freeze this season's baselines. Lazy and idempotent, the same shape as
 * rollDailyQuests — but WITHOUT its delete-other-keys sweep: past rows are retained
 * because badgeAt on one is the permanent record of that season's capstone.
 *
 * Freezes EVERY StatId, not only the ones SEASON_SOURCES currently reads. A source added
 * in a later season would otherwise find no baseline key, read it as 0, and credit that
 * player's entire lifetime counter in a single tick.
 */
export function rollSeason(ctx: Ctx, userId: string): void {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  if (!user) return;
  if (currentRow(ctx, userId)) return;
  const now = ctx.now();
  const seasonIndex = seasonIndexFor(now);
  const stats = readStats(ctx, userId);
  const baselines: Record<string, number> = {};
  for (const stat of Object.keys(STATS) as StatId[]) baselines[stat] = stats[stat] ?? 0;
  // First season EVER for this player, not season 1 of the calendar.
  const isFirstEver = ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, userId)).get() === undefined;
  ctx.db.insert(schema.seasonProgress).values({
    userId, seasonIndex, baselines,
    headStart: isFirstEver ? headStartFor(ctx, userId) : 0,
    createdAt: now,
  }).onConflictDoNothing().run();
}

export interface SeasonBreakdown { source: SeasonSource; points: number }
export interface SeasonRungView { idx: number; rung: SeasonRung; unlocked: boolean; claimed: boolean }
export interface SeasonView {
  index: number; number: number; season: Season;
  dayOfSeason: number; daysLeft: number;
  headStart: number; points: number;
  breakdown: SeasonBreakdown[]; rungs: SeasonRungView[];
  badgeAt: number | null;
}

/**
 * Deltas since this season's frozen baseline, per stat, clamped at 0.
 *
 * The clamp is not defensive noise: adminReset deletes user_stats rows, so a baseline row
 * surviving a step behind its counters yields current - baseline < 0.
 */
function deltas(ctx: Ctx, userId: string, baselines: Record<string, number>): Partial<Record<StatId, number>> {
  const stats = readStats(ctx, userId);
  const out: Partial<Record<StatId, number>> = {};
  for (const stat of Object.keys(STATS) as StatId[]) {
    out[stat] = Math.max(0, (stats[stat] ?? 0) - (baselines[stat] ?? 0));
  }
  return out;
}

/** Batches with ONE readStats call — never a query per source. */
export function seasonPoints(ctx: Ctx, userId: string): number {
  const row = currentRow(ctx, userId);
  if (!row) return 0;
  const d = deltas(ctx, userId, row.baselines);
  return row.headStart + SEASON_SOURCES.reduce((s, src) => s + sourcePoints(src, d), 0);
}

export function seasonView(ctx: Ctx, userId: string): SeasonView | null {
  const row = currentRow(ctx, userId);
  if (!row) return null;
  const now = ctx.now();
  const d = deltas(ctx, userId, row.baselines);
  const breakdown = SEASON_SOURCES.map((source) => ({ source, points: sourcePoints(source, d) }));
  const points = row.headStart + breakdown.reduce((s, b) => s + b.points, 0);
  const claimed = new Set(ctx.db.select().from(schema.seasonClaims)
    .where(and(
      eq(schema.seasonClaims.userId, userId),
      eq(schema.seasonClaims.seasonIndex, row.seasonIndex),
    )).all().map((c) => c.rung));
  return {
    index: row.seasonIndex,
    number: row.seasonIndex - SEASON_EPOCH + 1,
    season: seasonFor(now),
    dayOfSeason: seasonDay(now),
    daysLeft: SEASON_DAYS - seasonDay(now) + 1,
    headStart: row.headStart,
    points,
    breakdown,
    rungs: SEASON_RUNGS.map((rung, idx) => ({
      idx, rung, unlocked: points >= rung.points, claimed: claimed.has(idx),
    })),
    badgeAt: row.badgeAt,
  };
}
