import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import {
  alreadySent, recordSent, recordEscapeSent, pruneAlertRecords,
  ESCAPE_TIERS, ALERT_RECORD_TTL_MS, ALERT_INSTANT_EPSILON_MS,
} from '../src/modules/park/alert-record.js';

const seed = (ctx: ReturnType<typeof makeCtx>) =>
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();

describe('alert record', () => {
  it('reports not-sent for an unseen key and sent after recording it', () => {
    const ctx = makeCtx(); seed(ctx);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000)).toBe(false);
    recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000)).toBe(true);
  });

  it('reports not-sent when the instant moved beyond the tolerance, so a changed escapeAt re-alerts once', () => {
    // The whole point of storing firedForMs rather than a bare boolean: feeding moves
    // the escape instant, and a dino still inside its window deserves one fresh warning.
    // The move must clear ALERT_INSTANT_EPSILON_MS (2h) — this pins a 3h move, not the
    // sub-tolerance moves ALERT_INSTANT_EPSILON_MS exists to absorb (see the dedicated
    // epsilon test below).
    const ctx = makeCtx(); seed(ctx);
    recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000 + 3 * 3_600_000)).toBe(false);
  });

  it('treats an instant within the epsilon as already warned, in both directions', () => {
    // Enrichment moves an escape instant by only 34-65 minutes (one or two rungs) — well
    // inside this tolerance — while a real re-alert-worthy move (feeding, an income-cap
    // shift) clears it. See ALERT_INSTANT_EPSILON_MS's own comment for the reasoning.
    const ctx = makeCtx(); seed(ctx);
    const base = 100 * 3_600_000;
    recordSent(ctx, 'u1', 'escape', 1, 'heads_up', base);
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', base)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', base + 3_600_000)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', base - 3_600_000)).toBe(true);
    // Exact boundary, inclusive.
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', base + ALERT_INSTANT_EPSILON_MS)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', base + ALERT_INSTANT_EPSILON_MS + 1)).toBe(false);
  });

  it('recordSent overwrites rather than throwing on the composite primary key', () => {
    const ctx = makeCtx(); seed(ctx);
    recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 5000);
    expect(() => recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 9000)).not.toThrow();
    const rows = ctx.db.select().from(schema.alertsSent).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].firedForMs).toBe(9000);
  });

  it('tier collapse: firing last_call also marks heads_up for the same instant', () => {
    // A dino that first becomes observable already inside 1h fires last_call now. Without
    // collapse, the wider heads_up window is still satisfied next sweep and its key is
    // still free, so the player gets a second, less urgent warning after the urgent one.
    const ctx = makeCtx(); seed(ctx);
    recordEscapeSent(ctx, 'u1', 7, 'last_call', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'last_call', 5000)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000)).toBe(true);
  });

  it('tier collapse never runs backwards: firing heads_up leaves last_call free', () => {
    const ctx = makeCtx(); seed(ctx);
    recordEscapeSent(ctx, 'u1', 7, 'heads_up', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'last_call', 5000)).toBe(false);
  });

  it('ESCAPE_TIERS is ordered most urgent first', () => {
    // alert-detect picks the FIRST matching tier; a reordered list would classify every
    // dino as heads_up and the last call would never fire.
    expect(ESCAPE_TIERS.map((t) => t.tier)).toEqual(['last_call', 'heads_up']);
    expect(ESCAPE_TIERS[0].leadMs).toBeLessThan(ESCAPE_TIERS[1].leadMs);
  });

  it('prune deletes records older than the TTL and keeps newer ones', () => {
    const ctx = makeCtx({ nowMs: 10 * ALERT_RECORD_TTL_MS }); seed(ctx);
    ctx.db.insert(schema.alertsSent).values([
      { userId: 'u1', kind: 'escape', refId: 1, tier: 'heads_up', firedForMs: 0, sentAt: 0 },
      { userId: 'u1', kind: 'escape', refId: 2, tier: 'heads_up', firedForMs: 0, sentAt: ctx.now() },
    ]).run();
    pruneAlertRecords(ctx);
    const left = ctx.db.select().from(schema.alertsSent).all();
    expect(left.map((r) => r.refId)).toEqual([2]);
  });

  // S4 finding: incomeCapAlertFor's pending is FROZEN the moment the cap is reached
  // (accruedIncome clamps the window at capAt), so an idle park's capAt never moves —
  // unlike escape, where escapeAt > now already excludes a pruned row from re-firing.
  // A player who is capped and never plays again would, pre-fix, get the identical
  // income-cap DM every ALERT_RECORD_TTL_MS forever: the prune deletes the record at
  // T+30d, and the next sweep's alreadySent finds nothing even though incomeCapAlertFor
  // still returns the exact same {capAt, pending} it always has.
  it('never prunes an income_cap record — its instant is frozen while idle and would re-fire forever', () => {
    const ctx = makeCtx(); seed(ctx);
    const capAt = 8 * 3_600_000;   // a Visitor Center L1 park, capped 8h after collect
    recordSent(ctx, 'u1', 'income_cap', 0, '', capAt);
    ctx.setNow(ALERT_RECORD_TTL_MS + 1);   // 30 days later, park never touched again
    pruneAlertRecords(ctx);
    expect(alreadySent(ctx, 'u1', 'income_cap', 0, '', capAt)).toBe(true);
  });

  it('still prunes escape and season_end records past the TTL', () => {
    const ctx = makeCtx(); seed(ctx);
    recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 5000);
    recordSent(ctx, 'u1', 'season_end', 0, '', 5000);
    ctx.setNow(ALERT_RECORD_TTL_MS + 1);
    pruneAlertRecords(ctx);
    expect(ctx.db.select().from(schema.alertsSent).all()).toEqual([]);
  });
});
