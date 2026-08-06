import { and, eq, isNull, isNotNull, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { logger } from '../../core/logger.js';
import type { Sender } from '../../core/notify.js';
import type { Ctx } from '../../core/context.js';
import type { Timer } from '../../core/scheduler.js';
import { dayIndex } from '../../core/world.js';
import { worldPayload } from './embeds.js';

export const WORLD_TIMER = 'world_broadcast';
const DAY_MS = 86_400_000;

// The broadcast is not per-user, but Scheduler.enqueue requires a userId.
// '0' can never collide with a real Discord snowflake — which matters because
// adminReset deletes timers BY userId (admin/service.ts) and
// adminFastForward shifts them by userId. A colliding sentinel would let
// resetting one player kill the world broadcast for every server.
const SENTINEL_USER = '0';

function nextMidnight(now: number): number {
  return (dayIndex(now) + 1) * DAY_MS;
}

/** Seed the first timer. Idempotent: `timers` has NO unique index, so an
 *  unguarded boot-time enqueue accumulates duplicate rows and, with them,
 *  duplicate broadcasts. */
export function armWorldBroadcast(ctx: Ctx): void {
  const pending = ctx.db.select().from(schema.timers)
    .where(and(eq(schema.timers.kind, WORLD_TIMER), isNull(schema.timers.handledAt))).all();
  if (pending.length > 0) return;
  ctx.scheduler.enqueue({
    kind: WORLD_TIMER, userId: SENTINEL_USER, refId: 0,
    originGuildId: null, firesAt: nextMidnight(ctx.now()),
  });
}

export function worldBroadcastHandler(sender: Sender, ctx: Ctx) {
  return async (t: Timer): Promise<void> => {
    const now = ctx.now();
    // Opted in AND has somewhere to post: /settings world-news on before
    // /settings channel legitimately leaves notify_channel_id null.
    const targets = ctx.db.select().from(schema.guildSettings)
      .where(and(eq(schema.guildSettings.worldBroadcast, true),
                 isNotNull(schema.guildSettings.notifyChannelId))).all();

    for (const g of targets) {
      // Individually caught: Scheduler.tick writes handledAt only after the
      // handler RESOLVES and parks a thrower in `attempted`, so one unpostable
      // channel would otherwise abort the fan-out and block the re-arm below
      // for the whole process.
      try {
        // A FRESH payload per send. discord.js's MessagePayload pushes into
        // options.attachments and create() only shallow-copies it, so one
        // object forwarded to two sends accumulates duplicate attachment ids on
        // whichever resolves second. This is the finalPayload() lesson from
        // fightFrames (src/modules/battles/embeds.ts).
        await sender.channelSend(g.notifyChannelId!, worldPayload(now));
      } catch (err) {
        logger.warn({ err, guildId: g.guildId }, 'world broadcast send failed');
      }
    }

    // Re-arm LAST, and unconditionally — even if every send above threw. BUT
    // guarded, unlike the other three timer kinds: those degrade to at most
    // one duplicate message per stray fire, because nothing about handling
    // them creates a NEW pending row. This handler does — it always enqueues
    // its own successor — so an unguarded re-arm compounds instead of just
    // duplicating. Two processes racing the same due timer (this repo's
    // CLAUDE.md: exactly one bot instance per token, but the DB does not
    // enforce it) both re-arm, leaving 2 pending; next midnight each of those
    // re-arms again, giving 4; growth is 2^n. Worse, a single process is
    // enough to make a duplicate permanent rather than exponential: if the
    // process dies (or the `handledAt` UPDATE fails) between this enqueue and
    // Scheduler.tick recording the fire as handled, the same timer fires
    // again next tick and enqueues a second successor that never converges on
    // its own. Excluding this timer's own row (`ne(..., t.id)`) mirrors
    // armWorldBroadcast's boot-time guard: if another pending world_broadcast
    // row already exists, this one's re-arm is a no-op and the pair
    // converges back to one on the next fire instead of doubling.
    const others = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, WORLD_TIMER), isNull(schema.timers.handledAt),
                 ne(schema.timers.id, t.id))).all();
    if (others.length === 0) {
      ctx.scheduler.enqueue({
        kind: WORLD_TIMER, userId: SENTINEL_USER, refId: 0,
        originGuildId: null, firesAt: nextMidnight(now),
      });
    }
  };
}
