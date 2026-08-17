import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { baseComfortAt } from '../../core/clock.js';
import { toClockDinos } from './service.js';
import { attendanceOf } from './attendance.js';
import { RARITY_WEIGHT, RATING_WEIGHTS, PARK_TARGET, COLLECTION_TARGET, RATING_SCALE } from '../../data/progression.js';

// re-export the pure gating helpers so later modules can import from './rating.js'
export { siteUnlocked, lotSlots, shopCeiling, mythicUnlocked } from '../../data/progression.js';

export function recomputeRating(ctx: Ctx, userId: string): { rating: number; highWater: number } {
  const { clockDinos, lots, user } = toClockDinos(ctx, userId);
  const owned = new Map(clockDinos.map((d) => [d.species.id, d.species.rarity]));
  const ownedWeight = [...owned.values()].reduce((s, rarity) => s + RARITY_WEIGHT[rarity], 0);
  const collection = Math.min(1, ownedWeight / COLLECTION_TARGET);
  const parkRaw = lots.reduce((s, l) => s + l.level + l.decor.length, 0);
  const park = Math.min(1, parkRaw / PARK_TARGET);
  const assigned = clockDinos.filter((d) => d.paddock !== null && d.escapedAt === null);
  // baseComfortAt, never comfortAt: enrichment must not move rating, because
  // ratingHighWater is monotone and gates lot slots, sites, the shop ceiling and the
  // mythic unlock. See src/core/clock.ts's comment at baseComfortAt.
  const comfort = assigned.length === 0 ? 0
    : assigned.reduce((s, d) => s + baseComfortAt(d, ctx.now()), 0) / assigned.length;
  const rating = Math.round(RATING_SCALE * (
    RATING_WEIGHTS.collection * collection + RATING_WEIGHTS.park * park + RATING_WEIGHTS.comfort * comfort));
  const highWater = Math.max(user.ratingHighWater, rating);
  // Attendance rides the same recompute rather than 14 new call sites: its inputs are
  // dinos, lots and attractions, so every mutation that moves rating can move it too.
  // The real cost is steeper than that framing suggests: attendanceOf calls
  // toClockDinos a SECOND time rather than reusing the read above, so this line issues
  // four extra SELECTs (users, lots, dinos, attractions) — three of them (lots, dinos,
  // attractions) against tables with no index on userId — plus the one extra column on
  // the UPDATE that was already being issued. Folding attendanceOf's read into the
  // toClockDinos call above would cut three of those four; left as a possible
  // optimisation, not done here.
  const attendanceBest = Math.max(user.attendanceHighWater, attendanceOf(ctx, userId).attendance);
  ctx.db.update(schema.users)
    .set({ parkRating: rating, ratingHighWater: highWater, attendanceHighWater: attendanceBest })
    .where(eq(schema.users.discordId, userId)).run();
  return { rating, highWater };
}
