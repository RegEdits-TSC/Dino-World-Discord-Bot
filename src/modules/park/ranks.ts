import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { dexProgress } from '../dex/service.js';
import { earnedTierCount } from '../daily/service.js';
import { allSpecies } from '../../data/species/index.js';
import { ACHIEVEMENTS } from '../../data/achievements.js';
import { CAMPAIGN } from '../../data/battle/chapters/index.js';

export interface LegacyTier { rank: number; title: string; points: number }

/**
 * Earned standing, front-loaded so rank 1 arrives early and Director stays rare.
 * Thresholds are fractions of the 190-point ceiling: 7.9 / 18.4 / 34.2 / 52.6 / 73.7 / 89.5%.
 */
export const LEGACY_TIERS: readonly LegacyTier[] = [
  { rank: 1, title: 'Groundskeeper', points: 15 },
  { rank: 2, title: 'Keeper', points: 35 },
  { rank: 3, title: 'Curator', points: 65 },
  { rank: 4, title: 'Warden', points: 100 },
  { rank: 5, title: 'Conservator', points: 140 },
  { rank: 6, title: 'Director', points: 170 },
];

/**
 * The ceiling, derived from the three content tables rather than written down: 52 species
 * + 48 achievement tiers + 90 battle stars = 190 today.
 * Director has slid from 94.4% of the ceiling to 89.5% because LEGACY_TIERS was
 * deliberately NOT retuned: nothing persists an earned rank, so raising a threshold
 * demotes live players on their next /park view and contradicts docs/gameplay.md's
 * promise that nothing can ever be lost. Discharging this needs a monotone
 * users.legacyRankBest, not a threshold edit. See the 4a spec, section 8.
 */
export function legacyMaxPoints(): number {
  return allSpecies().length
    + ACHIEVEMENTS.reduce((s, t) => s + t.tiers.length, 0)
    + CAMPAIGN.reduce((s, c) => s + c.stages.length * 3, 0);
}

/**
 * Breadth, never wealth. Three batched reads, no per-id work.
 *
 * Deliberately NOT built on user_stats: migration 0006 backfilled only 6 of its 18
 * counters, so the other twelve start at 0 for every pre-0006 account and are
 * unrecoverable — a rank spanning them would under-rank the oldest players, the exact
 * inversion this feature exists to prevent. Also not on income_collected (that ranks cash
 * velocity, and it grows at the rate the landmark ladder is draining), not on
 * ratingHighWater (it already gates slots, sites, chapters, the shop ceiling and the
 * mythic unlock), and not on users.createdAt (zero readers, and the one signal
 * adminFastForward cannot shift, so a high rank would have no QA path).
 */
export function legacyPoints(ctx: Ctx, userId: string): number {
  const stars = ctx.db.select().from(schema.battleProgress)
    .where(eq(schema.battleProgress.userId, userId)).all()
    .reduce((s, r) => s + r.stars, 0);
  return dexProgress(ctx, userId).seen + earnedTierCount(ctx, userId) + stars;
}

/**
 * Resolve an already-known point total to the highest tier reached, or null below the
 * first threshold. Pure — no DB access — so a caller that has already paid for a
 * users-row read and a legacyPoints computation (bumpLegacyBest's callers, via its
 * returned high-water number) can resolve a tier without doing either a second time.
 * legacyRank below is the DB-reading counterpart for callers that have not.
 */
export function tierForPoints(points: number): LegacyTier | null {
  let out: LegacyTier | null = null;
  for (const tier of LEGACY_TIERS) if (points >= tier.points) out = tier;
  return out;
}

/**
 * The highest tier reached, or null below the first threshold.
 *
 * Resolves against max(stored, computed), never the stored value alone. The column is a
 * SAFETY NET, not a source of truth: whenever the live total is higher — the normal case —
 * it wins, so the rank is always at least what the player has actually earned. That is
 * what makes a missed bumpLegacyBest call harmless; the stored value only ever matters
 * when the computed value DROPS, which is the case it exists to cover.
 *
 * Does its own users-row read and its own legacyPoints computation, on purpose: this is
 * what lets src/modules/park/visit.ts call it standalone, with exactly these two
 * arguments, for a player who is NOT the caller (a bumpLegacyBest write there would
 * mutate a row the viewer never touched — see that function's own comment). A caller
 * that both owns the row AND has already called bumpLegacyBest this request should
 * resolve the tier via tierForPoints(bestPoints) instead of calling back in here — doing
 * so would repeat the same read and the same legacyPoints computation a second time.
 */
export function legacyRank(ctx: Ctx, userId: string): LegacyTier | null {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  const points = Math.max(user?.legacyRankBest ?? 0, legacyPoints(ctx, userId));
  return tierForPoints(points);
}

/**
 * Latch the live total into the monotone high-water column, and return the resolved
 * best (max(stored, computed)) so an owner-path caller can resolve a tier via
 * tierForPoints from that number, rather than calling legacyRank right after and paying
 * for the users-row read and the legacyPoints computation a second time.
 *
 * Deliberately NOT folded into legacyRank: src/modules/park/visit.ts calls that for
 * ANOTHER player's id, so a write there would mutate the row of a user who took no
 * action. Call this only on paths where the acting user owns the row.
 */
export function bumpLegacyBest(ctx: Ctx, userId: string): number {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  if (!user) return 0;
  const best = Math.max(user.legacyRankBest, legacyPoints(ctx, userId));
  if (best !== user.legacyRankBest) {
    ctx.db.update(schema.users).set({ legacyRankBest: best })
      .where(eq(schema.users.discordId, userId)).run();
  }
  return best;
}
