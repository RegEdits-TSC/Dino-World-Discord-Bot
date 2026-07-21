import { and, eq, gt, inArray } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { TradeSide } from '../../core/db/schema.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { TradeError, sideItemCount } from './validate.js';
import { TRADE_MIN_RATING, TRADE_DAILY_CAP, TRADE_MAX_ITEMS_PER_SIDE, TRADE_EXPIRY_MS } from '../../data/trade.js';
import { recomputeRating } from '../park/rating.js';

export { TradeError } from './validate.js';
export type Trade = typeof schema.trades.$inferSelect;

// The stored parkRating IS the live rating (maintained by every recompute-triggering action, unlike
// ratingHighWater). Read it directly — do NOT recompute here.
export function liveRating(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!.parkRating;
}

// Verify a user owns every dino/egg in a side, none Mythic, none locked (unless skipLockCheck), no escaped dino, and has the cash/food.
// skipLockCheck: at accept time, the OFFER side's items are locked BY THIS trade — expected, not an exploit.
export function verifySide(ctx: Ctx, userId: string, side: TradeSide, opts: { skipLockCheck?: boolean } = {}): void {
  if (sideItemCount(side) > TRADE_MAX_ITEMS_PER_SIDE) throw new TradeError(`At most ${TRADE_MAX_ITEMS_PER_SIDE} items per side.`);
  if (side.cash < 0 || side.food < 0) throw new TradeError('Amounts cannot be negative.');
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) throw new TradeError('Unknown user.');
  if (user.cash < side.cash) throw new TradeError('Not enough cash for the trade.');
  if (user.food < side.food) throw new TradeError('Not enough food for the trade.');
  for (const id of side.dinoIds) {
    const d = ctx.db.select().from(schema.dinos).where(and(eq(schema.dinos.id, id), eq(schema.dinos.userId, userId))).get();
    if (!d) throw new TradeError(`You do not own dino #${id}.`);
    if (!opts.skipLockCheck && d.locked) throw new TradeError(`Dino #${id} is already in a pending trade.`);
    if (d.escapedAt !== null) throw new TradeError(`Dino #${id} has escaped — rescue it first.`);
    if (getSpecies(d.speciesId).rarity === 'mythic') throw new TradeError('Mythics cannot be traded.');
  }
  for (const id of side.eggIds) {
    const e = ctx.db.select().from(schema.eggs).where(and(eq(schema.eggs.id, id), eq(schema.eggs.userId, userId))).get();
    if (!e) throw new TradeError(`You do not own egg #${id}.`);
    if (!opts.skipLockCheck && e.locked) throw new TradeError(`Egg #${id} is already in a pending trade.`);
    if (e.rarity === 'mythic') throw new TradeError('Mythic eggs cannot be traded.');
  }
}

export function createTrade(ctx: Ctx, fromUser: string, toUser: string, offer: TradeSide, request: TradeSide): Trade {
  if (fromUser === toUser) throw new TradeError('You cannot trade with yourself.');
  if (liveRating(ctx, fromUser) < TRADE_MIN_RATING) throw new TradeError('You need a 2★ park rating to trade.');
  if (liveRating(ctx, toUser) < TRADE_MIN_RATING) throw new TradeError('That player needs a 2★ park rating to trade.');
  const since = ctx.now() - TRADE_EXPIRY_MS;
  const recent = ctx.db.select().from(schema.trades)
    .where(and(eq(schema.trades.fromUser, fromUser), gt(schema.trades.createdAt, since))).all().length;
  if (recent >= TRADE_DAILY_CAP) throw new TradeError(`You can only start ${TRADE_DAILY_CAP} trades per day.`);
  verifySide(ctx, fromUser, offer);
  verifySide(ctx, toUser, request);
  return ctx.db.transaction(() => {
    const trade = ctx.db.insert(schema.trades).values({
      fromUser, toUser, offer, request, status: 'pending', createdAt: ctx.now(),
    }).returning().get();
    if (offer.dinoIds.length) ctx.db.update(schema.dinos).set({ locked: true }).where(inArray(schema.dinos.id, offer.dinoIds)).run();
    if (offer.eggIds.length) ctx.db.update(schema.eggs).set({ locked: true }).where(inArray(schema.eggs.id, offer.eggIds)).run();
    return trade;
  });
}

// Move one side's dinos/eggs to their new owner: unassigned (no lot), unlocked, and flagged via_trade
// (via_trade items sell for 0 shards — closes the sell-for-shards alt-funnel through trading).
function moveItems(ctx: Ctx, side: TradeSide, toUser: string): void {
  if (side.dinoIds.length) ctx.db.update(schema.dinos)
    .set({ userId: toUser, lotId: null, viaTrade: true, locked: false })
    .where(inArray(schema.dinos.id, side.dinoIds)).run();
  if (side.eggIds.length) ctx.db.update(schema.eggs)
    .set({ userId: toUser, viaTrade: true, locked: false })
    .where(inArray(schema.eggs.id, side.eggIds)).run();
}

export function acceptTrade(ctx: Ctx, userId: string, tradeId: number): Trade {
  const trade = ctx.db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) throw new TradeError('No such trade.');
  if (trade.status !== 'pending') throw new TradeError('That trade is no longer open.');
  if (trade.toUser !== userId) throw new TradeError('Only the recipient can accept this trade.');
  if (trade.createdAt + TRADE_EXPIRY_MS <= ctx.now()) throw new TradeError('That trade has expired.');
  // Re-verify against current state (reads, outside the transaction — a failed verify leaves the trade
  // pending with the offer's items still locked, so the sender can still /trade cancel).
  // The offer's items are locked BY THIS trade → skipLockCheck. The request side is verified normally
  // (its items must not be locked in some other pending trade).
  verifySide(ctx, trade.fromUser, trade.offer, { skipLockCheck: true });
  verifySide(ctx, trade.toUser, trade.request);
  if (liveRating(ctx, trade.fromUser) < TRADE_MIN_RATING || liveRating(ctx, trade.toUser) < TRADE_MIN_RATING)
    throw new TradeError('Both players must be at 2★ to complete the trade.');
  const done = ctx.db.transaction(() => {
    moveItems(ctx, trade.offer, trade.toUser);      // offer → recipient
    moveItems(ctx, trade.request, trade.fromUser);  // request → sender
    // cash/food net: sender pays offer.*, receives request.*; recipient the inverse (sums to zero → no money created)
    ctx.economy.apply(trade.fromUser, { cash: trade.request.cash - trade.offer.cash, food: trade.request.food - trade.offer.food }, `trade:${trade.id}`, ctx.now());
    ctx.economy.apply(trade.toUser, { cash: trade.offer.cash - trade.request.cash, food: trade.offer.food - trade.request.food }, `trade:${trade.id}`, ctx.now());
    return ctx.db.update(schema.trades).set({ status: 'accepted', resolvedAt: ctx.now() })
      .where(eq(schema.trades.id, tradeId)).returning().get();
  });
  recomputeRating(ctx, trade.fromUser);
  recomputeRating(ctx, trade.toUser);
  return done;
}

function unlockSide(ctx: Ctx, side: TradeSide): void {
  if (side.dinoIds.length) ctx.db.update(schema.dinos).set({ locked: false }).where(inArray(schema.dinos.id, side.dinoIds)).run();
  if (side.eggIds.length) ctx.db.update(schema.eggs).set({ locked: false }).where(inArray(schema.eggs.id, side.eggIds)).run();
}

function closeTrade(ctx: Ctx, trade: Trade, status: 'declined' | 'cancelled' | 'expired'): void {
  ctx.db.transaction(() => {
    unlockSide(ctx, trade.offer);   // only the offerer's items were ever locked
    ctx.db.update(schema.trades).set({ status, resolvedAt: ctx.now() }).where(eq(schema.trades.id, trade.id)).run();
  });
}

export function declineTrade(ctx: Ctx, userId: string, tradeId: number): void {
  const t = ctx.db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!t || t.status !== 'pending') throw new TradeError('That trade is no longer open.');
  if (t.toUser !== userId) throw new TradeError('Only the recipient can decline.');
  closeTrade(ctx, t, 'declined');
}

export function cancelTrade(ctx: Ctx, userId: string, tradeId: number): void {
  const t = ctx.db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!t || t.status !== 'pending') throw new TradeError('That trade is no longer open.');
  if (t.fromUser !== userId) throw new TradeError('Only the sender can cancel.');
  closeTrade(ctx, t, 'cancelled');
}

export function expireStale(ctx: Ctx, userId: string): void {
  const cutoff = ctx.now() - TRADE_EXPIRY_MS;
  const stale = ctx.db.select().from(schema.trades).where(eq(schema.trades.status, 'pending')).all()
    .filter((t) => (t.fromUser === userId || t.toUser === userId) && t.createdAt <= cutoff);
  for (const t of stale) closeTrade(ctx, t, 'expired');
}

export function listTrades(ctx: Ctx, userId: string): Trade[] {
  return ctx.db.select().from(schema.trades).where(eq(schema.trades.status, 'pending')).all()
    .filter((t) => t.fromUser === userId || t.toUser === userId);
}
