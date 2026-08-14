import { and, eq, isNull, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { logger } from '../../core/logger.js';
import type { Ctx } from '../../core/context.js';
import type { Timer } from '../../core/scheduler.js';
import { type Sender, deliverNotification } from '../../core/notify.js';
import { toClockDinos } from './service.js';
import { escapeAlertsFor, incomeCapAlertFor, seasonEndAlertFor } from './alert-detect.js';
import { alreadySent, recordSent, recordEscapeSent, pruneAlertRecords } from './alert-record.js';
import { alertPayload } from './alert-embeds.js';
import { seasonView } from '../daily/season.js';

export const ALERT_TIMER = 'alert_sweep';
export const SWEEP_MS = 15 * 60_000;

// Not per-user, but Scheduler.enqueue requires a userId. '0' can never collide with a
// real Discord snowflake, which matters because adminReset deletes timers BY userId and
// adminFastForward shifts them BY userId (src/modules/admin/service.ts) — a colliding
// sentinel would let one player's reset kill alerts for every server.
const SENTINEL_USER = '0';

/** Seed the first timer. Idempotent: `timers` has NO unique index, so an unguarded
 *  boot-time enqueue accumulates duplicate rows and, with them, duplicate sweeps. */
export function armAlertSweep(ctx: Ctx): void {
  const pending = ctx.db.select().from(schema.timers)
    .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
  if (pending.length > 0) return;
  ctx.scheduler.enqueue({
    kind: ALERT_TIMER, userId: SENTINEL_USER, refId: 0,
    originGuildId: null, firesAt: ctx.now() + SWEEP_MS,
  });
}

export function alertSweepHandler(sender: Sender, ctx: Ctx) {
  return async (t: Timer): Promise<void> => {
    // ONE clock read for the whole sweep: every predicate and the re-arm must agree on
    // "now", or a slow fan-out would classify late users against a different instant.
    const now = ctx.now();

    // No window, no anchor arithmetic. The sweep asks "does the condition hold NOW, and
    // have I already sent for THIS instant?" — which is why a late fire, a re-run of the
    // same row, or a multi-day outage cannot produce a duplicate or a miss.
    //
    // Guarded like the per-user work and the prune below: a thrown SELECT (SQLITE_BUSY is
    // realistic under contention) must not propagate. scheduler.ts:28 already added this
    // timer's id to `attempted` before the handler ran, and the due-snapshot filter
    // (scheduler.ts:25) excludes anything in `attempted` for the rest of the process — an
    // uncaught throw here would leave alerts dead until restart. Skipping this sweep's
    // fan-out and still reaching the re-arm below turns that into "one late sweep" instead.
    let targets: Array<typeof schema.users.$inferSelect> = [];
    try {
      targets = ctx.db.select().from(schema.users)
        .where(eq(schema.users.alertsEnabled, true)).all();
    } catch (err) {
      logger.error({ err }, 'alert sweep target query failed');
    }

    for (const u of targets) {
      // Individually caught, like world/broadcast.ts's fan-out: Scheduler.tick writes
      // handledAt only after the handler RESOLVES and parks a thrower in `attempted` for
      // the life of the process, so one bad user would otherwise abort the sweep AND
      // block the re-arm below. getSpecies throws on an unknown species id and
      // toClockDinos calls it per dino — that is the realistic thrower.
      try {
        const { clockDinos, lots, user, dinos } = toClockDinos(ctx, u.discordId);
        if (lots.length === 0) continue;

        const escapes = escapeAlertsFor(clockDinos, dinos, now)
          .filter((e) => !alreadySent(ctx, u.discordId, 'escape', e.dinoId, e.tier, e.escapeAt));

        const cap = incomeCapAlertFor(clockDinos, lots, user.lastCollectAt, now);
        const income = cap && !alreadySent(ctx, u.discordId, 'income_cap', 0, '', cap.capAt)
          ? cap : null;

        const seasonEnd = seasonEndAlertFor(seasonView(ctx, u.discordId), now);
        // firedForMs is the season's END instant, not `now` — so however many sweeps run
        // inside the window, exactly one DM goes out per season.
        const season = seasonEnd && !alreadySent(ctx, u.discordId, 'season_end', 0, '', seasonEnd.endsAt)
          ? seasonEnd : null;

        if (escapes.length === 0 && !income && !season) continue;

        // A FRESH payload per user. deliverNotification forwards ONE object to two send
        // sites (channel then DM), so a shared object is the finalPayload() hazard from
        // fightFrames. Building inside the loop also keeps `attachments` absent.
        const payload = alertPayload(u.discordId, escapes, income, season, now);
        // alertPayload returns null only when escapes.length === 0 && !income && !season —
        // the `continue` above already excludes that case, so this is unreachable in
        // practice. Handled explicitly rather than with a non-null assertion so a future
        // change to either guard fails loudly instead of forwarding `null` into
        // deliverNotification, which requires a non-null NotifyPayload.
        if (!payload) continue;

        // originGuildId null → deliverNotification skips the channel branch entirely and
        // DMs. Deliberate: a sweep has no originating interaction, and guessing a guild
        // from user_guilds routes into channels the player may no longer be able to see.
        await deliverNotification(sender, ctx, u.discordId, null, payload);

        // Recorded immediately after the send resolves — NOTHING awaited in between. These
        // are synchronous better-sqlite3 writes, so the sent-but-not-yet-recorded window is
        // sub-millisecond. Putting the throttle sleep here (between the send and the
        // records, as it once was) would widen that window to the sleep's own duration: a
        // process death inside it re-sends this exact alert on the next boot, which
        // alerts_sent exists to prevent — most likely during the very first-sweep backfill
        // the throttle below was added for. deliverNotification never throws, so these
        // always run — but keeping the order (record only after the send) means a future
        // throwing sender leaves the alert owed rather than silently consumed.
        for (const e of escapes) recordEscapeSent(ctx, u.discordId, e.dinoId, e.tier, e.escapeAt);
        if (income) recordSent(ctx, u.discordId, 'income_cap', 0, '', income.capAt);
        if (season) recordSent(ctx, u.discordId, 'season_end', 0, '', season.endsAt);

        // Throttle only AFTER the send is fully recorded, never before the first send and
        // never for a skipped user (the `continue`s above never reach this line). This
        // exists for the first sweep after a fresh deploy: alerts_enabled defaults to true
        // for every pre-existing row, and essentially every idle player satisfies the
        // income-cap predicate by then, so an unbounded fan-out would fire a serial burst of
        // DMs — each potentially opening a new DM channel — which is exactly what Discord
        // rate-limits hardest. In steady state very few users trip either predicate per
        // sweep, so this rarely adds meaningful wall-clock time. Left unconditional even
        // after the loop's last actual send (a harmless trailing 250ms) rather than tracking
        // "will any later target also send", which isn't knowable without processing them.
        await ctx.sleep(250);
      } catch (err) {
        logger.warn({ err, userId: u.discordId }, 'alert sweep failed for user');
      }
    }

    // Both of these are in their own try: world/broadcast.ts leaves its re-arm unguarded,
    // and here that is the difference between "one late sweep" and "alerts are dead until
    // the process restarts" — scheduler.ts parks a throwing handler in `attempted` behind
    // a single logger.error and never retries it this process.
    try { pruneAlertRecords(ctx); }
    catch (err) { logger.warn({ err }, 'alert record prune failed'); }

    try {
      // Re-arm LAST and unconditionally, but excluding this timer's own row. Without the
      // exclusion two processes racing the same due row both re-arm, leaving 2 pending;
      // next sweep each re-arms again, and growth is 2^n. With it, a duplicate pair
      // converges back to one on the next fire.
      const others = ctx.db.select().from(schema.timers)
        .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt),
                   ne(schema.timers.id, t.id))).all();
      if (others.length === 0) {
        ctx.scheduler.enqueue({
          kind: ALERT_TIMER, userId: SENTINEL_USER, refId: 0,
          originGuildId: null, firesAt: now + SWEEP_MS,
        });
      }
    } catch (err) { logger.error({ err }, 'alert sweep re-arm failed'); }
  };
}
