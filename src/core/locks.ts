import { and, eq, gt, isNull } from 'drizzle-orm';
import { schema } from './db/index.js';
import type { Ctx } from './context.js';
import { TRADE_EXPIRY_MS } from '../data/trade.js';

export type LockReason =
  | { kind: 'trade'; tradeId: number }
  | { kind: 'breeding'; breedingId: number };

export interface Locks {
  dinos: Map<number, LockReason>;
  eggs: Map<number, LockReason>;
}

/**
 * Everything this user currently has in escrow, derived rather than stored.
 *
 * The predicate is evaluated at READ time, so a stale lock cannot exist and
 * nothing needs sweeping — which is what retires the `locked` columns and the
 * fourteen expireStale call sites that guarded them.
 *
 * Batch-per-user on purpose: callers take one map and test membership. A
 * per-id isLocked() would be an N+1 inside /dino list and every autocomplete
 * handler.
 */
export function locksFor(ctx: Ctx, userId: string): Locks {
  const dinos = new Map<number, LockReason>();
  const eggs = new Map<number, LockReason>();

  // Only the OFFER side is ever escrowed, and the offer belongs to fromUser.
  const cutoff = ctx.now() - TRADE_EXPIRY_MS;
  const trades = ctx.db.select().from(schema.trades)
    .where(and(
      eq(schema.trades.status, 'pending'),
      eq(schema.trades.fromUser, userId),
      gt(schema.trades.createdAt, cutoff),
    )).all();
  for (const t of trades) {
    const reason: LockReason = { kind: 'trade', tradeId: t.id };
    for (const id of t.offer.dinoIds) dinos.set(id, reason);
    for (const id of t.offer.eggIds) eggs.set(id, reason);
  }

  const breeds = ctx.db.select().from(schema.breedings)
    .where(and(eq(schema.breedings.userId, userId), isNull(schema.breedings.claimedAt))).all();
  for (const b of breeds) {
    const reason: LockReason = { kind: 'breeding', breedingId: b.id };
    dinos.set(b.parentA, reason);
    dinos.set(b.parentB, reason);
  }

  return { dinos, eggs };
}

export function lockLabel(r: LockReason): string {
  return r.kind === 'trade' ? 'locked in a pending trade' : 'busy in the Gene Lab';
}
