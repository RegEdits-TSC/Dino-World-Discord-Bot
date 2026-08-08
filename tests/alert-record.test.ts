import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import {
  alreadySent, recordSent, recordEscapeSent, pruneAlertRecords,
  ESCAPE_TIERS, ALERT_RECORD_TTL_MS,
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

  it('reports not-sent when the instant moved, so a changed escapeAt re-alerts once', () => {
    // The whole point of storing firedForMs rather than a bare boolean: feeding moves
    // the escape instant, and a dino still inside its window deserves one fresh warning.
    const ctx = makeCtx(); seed(ctx);
    recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 9000)).toBe(false);
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
});
