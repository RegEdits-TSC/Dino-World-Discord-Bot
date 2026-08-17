import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { toClockDinos, facilityLevel, levelValue } from './service.js';
import { attractionFor } from '../../data/attractions.js';
import { attendanceFrom } from '../../data/attendance.js';

export interface Attendance {
  attendance: number; distinctSpecies: number; drawTotal: number; vcLevel: number;
}

/**
 * Guests per hour, derived at read time and stored never — the same philosophy as escrow
 * locks, quest progress and world events.
 *
 * PURE. It must never write, because it is read for OTHER players' parks (the leaderboard,
 * a visit, another player's park card). The monotone high-water is stamped separately, by
 * recomputeRating, which only ever runs in a write context — the legacyRank / bumpLegacyBest
 * split (./ranks.ts) applied again.
 *
 * The dino predicate is byte-identical to recomputeRating's `assigned` filter (./rating.ts:18)
 * on purpose: it reads the STORED escapedAt column, never the computed escapeAt instant, so
 * every surface that settles escapes first sees a fresh value and no surface has to settle
 * just to render a number.
 *
 * Nothing here reads hunger, comfort, the world event or the season: attendance is a GATE,
 * and a gate that moves with the clock or the calendar has no stable threshold. It also never
 * reads the cosmetic landmark prestige column on users — that would convert a deliberately
 * powerless ladder into a power ladder, and tests/landmarks.test.ts polices (by identifier,
 * so it is never named literally here) the closed file list allowed to mention it at all.
 */
export function attendanceOf(ctx: Ctx, userId: string): Attendance {
  const { clockDinos, lots } = toClockDinos(ctx, userId);
  const assigned = clockDinos.filter((d) => d.paddock !== null && d.escapedAt === null);
  const distinctSpecies = new Set(assigned.map((d) => d.species.id)).size;

  const rows = ctx.db.select().from(schema.attractions)
    .where(eq(schema.attractions.userId, userId)).all();
  // An unknown or retired kind contributes 0 rather than throwing — the same tolerance
  // matchedKindCount gives a retired decor slug. levelValue clamps a level above the
  // array to its top entry; a raw index would read undefined and poison this with NaN.
  const drawTotal = rows.reduce(
    (sum, r) => sum + levelValue(attractionFor(r.kind)?.draw, r.level, 0), 0);

  const vcLevel = facilityLevel(lots, 'visitor_center');
  return { attendance: attendanceFrom(distinctSpecies, drawTotal, vcLevel), distinctSpecies, drawTotal, vcLevel };
}
