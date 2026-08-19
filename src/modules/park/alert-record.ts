import { and, eq, lt, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { ESCAPE_WARN_MS } from '../../core/clock.js';

export type AlertKind = 'escape' | 'income_cap' | 'season_end';
export type EscapeTier = 'heads_up' | 'last_call';

/** Last call lead. Deliberately separate from ESCAPE_WARN_MS, which is reused as the
 *  heads-up lead so the DM lands at exactly the instant /park view starts badging. */
export const ESCAPE_LAST_CALL_MS = 3_600_000;

/** MOST URGENT FIRST. alert-detect picks the first tier whose lead the dino is inside,
 *  and recordEscapeSent collapses every LESS urgent tier behind it. Reversing this list
 *  classifies every dino as heads_up and the last call never fires. */
export const ESCAPE_TIERS: ReadonlyArray<{ tier: EscapeTier; leadMs: number }> = [
  { tier: 'last_call', leadMs: ESCAPE_LAST_CALL_MS },
  { tier: 'heads_up', leadMs: ESCAPE_WARN_MS },
];

export const ALERT_RECORD_TTL_MS = 30 * 86_400_000;

/** How long before a season ends the nudge may fire. */
export const SEASON_END_WARN_MS = 3 * 86_400_000;

/**
 * How far an alert instant may move before it counts as a genuinely new instant.
 *
 * Enrichment moves a dino's escapeAt by only 34-65 minutes (one or two rungs), which
 * leaves it inside the 12h heads-up window — so an exact firedForMs comparison would
 * send a fresh DM on every decor purchase, up to four an hour at SWEEP_MS. Two hours
 * sits above the largest enrichment move and below the smallest move any care action
 * produces: feeding shifts the instant by a day or more and usually clear of the
 * window entirely, and an income-cap capAt only moves when lastCollectAt moves (by at
 * least capHours, 8h) or the Visitor Center is upgraded (by 4h).
 *
 * Row existence alone is NOT an alternative: it would suppress the legitimate case
 * where a fed dino leaves the window and later re-enters it with a genuinely new
 * instant, which is exactly what comparing firedForMs exists to prevent.
 */
export const ALERT_INSTANT_EPSILON_MS = 2 * 3_600_000;

/** True when this exact (user, kind, ref, tier) has already fired for an instant within
 *  ALERT_INSTANT_EPSILON_MS of this one. Comparing firedForMs (with tolerance) rather
 *  than mere row existence is what lets a moved instant — the player fed, reassigned,
 *  or spliced — earn exactly one fresh warning, while a small move (a decor rung) that
 *  never leaves the window earns none. */
export function alreadySent(
  ctx: Ctx, userId: string, kind: AlertKind, refId: number, tier: string, firedForMs: number,
): boolean {
  const row = ctx.db.select().from(schema.alertsSent)
    .where(and(
      eq(schema.alertsSent.userId, userId), eq(schema.alertsSent.kind, kind),
      eq(schema.alertsSent.refId, refId), eq(schema.alertsSent.tier, tier),
    )).get();
  return row !== undefined && Math.abs(row.firedForMs - firedForMs) <= ALERT_INSTANT_EPSILON_MS;
}

export function recordSent(
  ctx: Ctx, userId: string, kind: AlertKind, refId: number, tier: string, firedForMs: number,
): void {
  ctx.db.insert(schema.alertsSent)
    .values({ userId, kind, refId, tier, firedForMs, sentAt: ctx.now() })
    .onConflictDoUpdate({
      target: [schema.alertsSent.userId, schema.alertsSent.kind,
               schema.alertsSent.refId, schema.alertsSent.tier],
      set: { firedForMs, sentAt: ctx.now() },
    }).run();
}

/** Record an escape alert AND collapse every less urgent tier for the same instant.
 *  Without the collapse, a dino that first becomes observable already inside the last
 *  call fires it now and then fires the heads-up next sweep: the wider window is still
 *  satisfied and its key is still free. Collapse runs one direction only — firing the
 *  heads-up must leave the last call free, because that is a genuinely later beat. */
export function recordEscapeSent(
  ctx: Ctx, userId: string, dinoId: number, tier: EscapeTier, firedForMs: number,
): void {
  const from = ESCAPE_TIERS.findIndex((t) => t.tier === tier);
  for (const t of ESCAPE_TIERS.slice(from)) {
    recordSent(ctx, userId, 'escape', dinoId, t.tier, firedForMs);
  }
}

/** Bound the table. A pruned row can only re-fire for an instant TTL-old, which the
 *  `escapeAt > now` and `pending > 0` conjuncts in alert-detect already exclude for
 *  `escape` and `season_end` — but NOT for `income_cap`. incomeCapAlertFor's `pending`
 *  is frozen the instant a park hits its cap (accruedIncome clamps the window at
 *  capAt), so an idle park's capAt never ages out on its own the way an escape instant
 *  or a season boundary does. Pruning that row would let alreadySent find nothing and
 *  re-send the identical DM every TTL, forever, for a player who never plays again —
 *  income_cap rows are therefore exempt from this sweep and retained indefinitely.
 *  The table cost is bounded regardless: (userId, kind, refId, tier) is unique, and
 *  income_cap always uses refId 0 and tier '', so this is at most one extra row per
 *  idle user. */
export function pruneAlertRecords(ctx: Ctx): void {
  ctx.db.delete(schema.alertsSent)
    .where(and(
      lt(schema.alertsSent.sentAt, ctx.now() - ALERT_RECORD_TTL_MS),
      ne(schema.alertsSent.kind, 'income_cap'),
    )).run();
}
