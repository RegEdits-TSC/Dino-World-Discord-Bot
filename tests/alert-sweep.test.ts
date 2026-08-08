import { describe, it, expect } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import type { NotifyPayload, Sender } from '../src/core/notify.js';
import { armAlertSweep, alertSweepHandler, ALERT_TIMER, SWEEP_MS } from '../src/modules/park/alert-sweep.js';
import { ESCAPE_WARN_MS, GRACE_MS, HUNGER_DRAIN_MS } from '../src/core/clock.js';

function capture() {
  const dms: Array<{ userId: string; payload: NotifyPayload }> = [];
  const sender: Sender = {
    channelSend: async () => { throw new Error('alerts are DM-only'); },
    dmSend: async (userId, payload) => { dms.push({ userId, payload }); },
  };
  return { dms, sender };
}

// A Triceratops in a herbivore paddock fed at t=0, with no biome-matching decor
// (seedAtRiskPlayer's lot has none), sits at paddockFit 0.75 rather than 1.0 —
// see clock.ts's paddockFit. At fit 0.75 the comfort-threshold hunger is
// (0.25/0.75)*100 = 33.3%, so the crossing lands at 2/3 of the drain window, not
// 3/4. Matches tests/alert-detect.test.ts's pinned escapeAt for this exact fixture.
const ESCAPE_AT = HUNGER_DRAIN_MS * (2 / 3) + GRACE_MS;

function seedAtRiskPlayer(ctx: ReturnType<typeof makeCtx>, id = 'u1') {
  ctx.db.insert(schema.users).values({ discordId: id, lastCollectAt: 0, createdAt: 0 }).run();
  const lot = ctx.db.insert(schema.lots)
    .values({ userId: id, type: 'paddock', kind: 'herbivore_paddock', name: 'p' }).returning().get();
  ctx.db.insert(schema.dinos).values({
    userId: id, lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
  }).run();
}

// id 999, deliberately: the handler's re-arm excludes its OWN row by id, and the rows it
// inserts start at 1. A fake id of 1 would collide with the first inserted row, making the
// re-arm exclude the real successor and enqueue a second one — the test would then assert
// the bug rather than the fix.
const timer = (firesAt: number) =>
  ({ id: 999, kind: ALERT_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt, handledAt: null });

describe('alert sweep', () => {
  it('arms one timer and is idempotent on a second call', () => {
    const ctx = makeCtx();
    armAlertSweep(ctx); armAlertSweep(ctx);
    const rows = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('0');         // sentinel: adminReset/fastForward filter by userId
    expect(rows[0].firesAt).toBe(ctx.now() + SWEEP_MS);
  });

  it('DMs an at-risk player exactly once, then stays quiet on the next sweep', async () => {
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    seedAtRiskPlayer(ctx);
    const { dms, sender } = capture();
    const handler = alertSweepHandler(sender, ctx);
    await handler(timer(ctx.now()));
    expect(dms).toHaveLength(1);
    expect(dms[0].userId).toBe('u1');
    // seedAtRiskPlayer's lastCollectAt: 0 puts the park past its income cap too, so this
    // round-trips BOTH alert keys, not just the escape one — stated explicitly so a future
    // seed "tidy-up" (e.g. lastCollectAt: ctx.now()) that silently drops income-cap
    // coverage fails this assertion instead of passing unnoticed. Symmetric for the escape
    // half: `now` sits exactly on the inclusive heads_up boundary (remaining === leadMs), so
    // without this line a regression that stopped the escape predicate from firing would
    // still pass every assertion above via the income-cap alert alone.
    expect(JSON.stringify(dms[0].payload)).toContain('Income capped');
    expect(JSON.stringify(dms[0].payload)).toContain('Unsettled dinos');
    ctx.setNow(ctx.now() + SWEEP_MS);
    await handler(timer(ctx.now()));
    expect(dms).toHaveLength(1);              // idempotent: same escapeAt, already recorded
  });

  it('re-running the SAME timer row does not double-alert', async () => {
    // Not reachable within a single process: scheduler.ts:28 adds the id to `attempted`
    // BEFORE the `await handler(t)`, so the due-snapshot filter (scheduler.ts:25) already
    // excludes this row from the very next tick (src/index.ts:42) of that same process.
    // This pins the two-process case instead — this repo's one-instance-per-token rule is
    // a convention the DB does not enforce, so a second stray process racing the same due
    // row is exactly the scenario `attempted` (an in-memory, per-process set) cannot stop.
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    seedAtRiskPlayer(ctx);
    const { dms, sender } = capture();
    const handler = alertSweepHandler(sender, ctx);
    await handler(timer(ctx.now()));
    await handler(timer(ctx.now()));
    expect(dms).toHaveLength(1);
  });

  it('never DMs a muted player', async () => {
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    seedAtRiskPlayer(ctx);
    ctx.db.update(schema.users).set({ alertsEnabled: false })
      .where(eq(schema.users.discordId, 'u1')).run();
    const { dms, sender } = capture();
    await alertSweepHandler(sender, ctx)(timer(ctx.now()));
    expect(dms).toHaveLength(0);
  });

  it('re-arms exactly once, and only when no other pending row exists', async () => {
    const ctx = makeCtx();
    const { sender } = capture();
    await alertSweepHandler(sender, ctx)(timer(ctx.now()));
    let pending = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    expect(pending).toHaveLength(1);
    expect(pending[0].firesAt).toBe(ctx.now() + SWEEP_MS);
    // A duplicate pending row must make the next re-arm a no-op, so the pair converges
    // back to one instead of doubling every sweep (2^n).
    await alertSweepHandler(sender, ctx)(timer(ctx.now()));
    pending = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    expect(pending).toHaveLength(1);
  });

  it('one player with a broken species id does not stop the others', async () => {
    // getSpecies throws on an unknown id and toClockDinos calls it per dino, so without
    // the per-user catch a single bad row kills alerts for the whole process.
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    ctx.db.insert(schema.users).values({ discordId: 'bad', lastCollectAt: 0, createdAt: 0 }).run();
    const badLot = ctx.db.insert(schema.lots)
      .values({ userId: 'bad', type: 'paddock', kind: 'herbivore_paddock', name: 'p' }).returning().get();
    ctx.db.insert(schema.dinos).values({
      userId: 'bad', lotId: badLot.id, speciesId: 'not_a_species', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    seedAtRiskPlayer(ctx, 'u2');
    const { dms, sender } = capture();
    await expect(alertSweepHandler(sender, ctx)(timer(ctx.now()))).resolves.toBeUndefined();
    expect(dms.map((d) => d.userId)).toEqual(['u2']);
  });

  it('excludes its own still-pending row when re-arming, so a real due row still gets a successor', async () => {
    // Scheduler.tick writes handledAt only AFTER the handler resolves (scheduler.ts:32-34),
    // so a REAL due row is still `handledAt: null` in the table for the whole time its own
    // handler is running. Unlike the fake `timer()` fixture (id 999, which never matches a
    // real row), this test hands the handler a Timer whose id genuinely IS the row sitting
    // in the table — the actual shape of a live tick. Without `ne(timers.id, t.id)`, the
    // re-arm's "others" query would find this still-pending row, conclude a successor
    // already exists, and skip creating one — the chain dies the instant Scheduler.tick
    // marks this row handled, since nothing else was ever queued.
    const ctx = makeCtx();
    const row = ctx.db.insert(schema.timers).values({
      kind: ALERT_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: ctx.now(),
    }).returning().get();
    const { sender } = capture();
    await alertSweepHandler(sender, ctx)({ ...row, handledAt: null });
    const pending = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    // A fresh successor alongside the still-pending original: 2 rows, not 1 (suppressed)
    // and not 0. Proves self-exclusion, not merely "a row exists".
    expect(pending).toHaveLength(2);
    expect(pending.some((p) => p.id !== row.id)).toBe(true);
  });

  it('re-arms even when every DM fails to send', async () => {
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    seedAtRiskPlayer(ctx);
    const sender: Sender = {
      channelSend: async () => { throw new Error('nope'); },
      dmSend: async () => { throw new Error('blocked'); },
    };
    await expect(alertSweepHandler(sender, ctx)(timer(ctx.now()))).resolves.toBeUndefined();
    const pending = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    expect(pending).toHaveLength(1);
  });
});
