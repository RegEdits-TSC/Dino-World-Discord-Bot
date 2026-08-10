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
 * Thresholds are fractions of the 180-point ceiling: 8.3 / 19.4 / 36.1 / 55.6 / 77.8 / 94.4%.
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
 * The ceiling, derived from the three content tables rather than written down: 42 species
 * + 48 achievement tiers + 90 battle stars = 180 today. New content must move this, or the
 * top rank silently drifts from "nearly everything" to "a fraction of it".
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

/** The highest tier reached, or null below the first threshold. */
export function legacyRank(ctx: Ctx, userId: string): LegacyTier | null {
  const points = legacyPoints(ctx, userId);
  let out: LegacyTier | null = null;
  for (const tier of LEGACY_TIERS) if (points >= tier.points) out = tier;
  return out;
}
