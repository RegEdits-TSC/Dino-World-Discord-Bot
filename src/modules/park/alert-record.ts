import { and, eq, lt } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { ESCAPE_WARN_MS } from '../../core/clock.js';

export type AlertKind = 'escape' | 'income_cap';
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

/** True when this exact (user, kind, ref, tier) has already fired FOR THIS INSTANT.
 *  Comparing firedForMs rather than mere row existence is what lets a moved instant —
 *  the player fed, reassigned, or spliced — earn exactly one fresh warning. */
export function alreadySent(
  ctx: Ctx, userId: string, kind: AlertKind, refId: number, tier: string, firedForMs: number,
): boolean {
  const row = ctx.db.select().from(schema.alertsSent)
    .where(and(
      eq(schema.alertsSent.userId, userId), eq(schema.alertsSent.kind, kind),
      eq(schema.alertsSent.refId, refId), eq(schema.alertsSent.tier, tier),
    )).get();
  return row !== undefined && row.firedForMs === firedForMs;
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
 *  `escapeAt > now` and `pending > 0` conjuncts in alert-detect already exclude. */
export function pruneAlertRecords(ctx: Ctx): void {
  ctx.db.delete(schema.alertsSent)
    .where(lt(schema.alertsSent.sentAt, ctx.now() - ALERT_RECORD_TTL_MS)).run();
}
