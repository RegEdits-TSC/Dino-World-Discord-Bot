import { and, eq, gt, inArray } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { TradeSide } from '../../core/db/schema.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { locksFor, type LockReason } from '../../core/locks.js';
import { TradeError, sideItemCount } from './validate.js';
import { FOODS, type FoodId } from '../../data/foods.js';
import { TRADE_MIN_RATING, TRADE_DAILY_CAP, TRADE_MAX_ITEMS_PER_SIDE, TRADE_EXPIRY_MS } from '../../data/trade.js';
import { recomputeRating } from '../park/rating.js';
import { track } from '../../core/stats.js';
import { recordSpeciesSeen } from '../../core/species-seen.js';
import { stampSeasonBadge } from '../daily/season.js';

export { TradeError } from './validate.js';
export type Trade = typeof schema.trades.$inferSelect;

// The stored parkRating IS the live rating (maintained by every recompute-triggering action, unlike
// ratingHighWater). Read it directly — do NOT recompute here.
export function liveRating(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!.parkRating;
}

// Verify a user owns every dino/egg in a side, none Mythic, none escrowed, no escaped dino, and has the cash/food.
// forTradeId waives EXACTLY ONE lock: the named trade's own escrow, because at accept time the offer side is
// locked BY THAT TRADE — expected, not an exploit. Every other reason still rejects. This must stay scoped to a
// single trade id rather than a blanket skip: escrow now carries a second reason, and a blanket skip would let
// acceptTrade transfer a dino whose unclaimed breeding is still in flight — which src/core/db/schema.ts's
// `breedings` note ("their parents are locked, so they cannot vanish mid-flight") relies on being impossible.
export function verifySide(ctx: Ctx, userId: string, side: TradeSide, opts: { forTradeId?: number } = {}): void {
  if (sideItemCount(side) > TRADE_MAX_ITEMS_PER_SIDE) throw new TradeError(`At most ${TRADE_MAX_ITEMS_PER_SIDE} items per side.`);
  if (side.cash < 0) throw new TradeError('Amounts cannot be negative.');
  for (const [foodId, qty] of Object.entries(side.foods)) {
    if (!(foodId in FOODS)) throw new TradeError('Unknown food in trade.');
    if (!Number.isInteger(qty) || qty <= 0) throw new TradeError('Food amounts must be positive integers.');
  }
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) throw new TradeError('Unknown user.');
  if (user.cash < side.cash) throw new TradeError('Not enough cash for the trade.');
  const inv = ctx.economy.getFoodInventory(userId);
  for (const [foodId, qty] of Object.entries(side.foods)) {
    if ((inv[foodId as FoodId] ?? 0) < qty)
      throw new TradeError(`Not enough ${FOODS[foodId as FoodId].name} for the trade.`);
  }
  // One batched lock read for the whole side — never one per id.
  const locks = locksFor(ctx, userId);
  // Undefined forTradeId waives nothing: `r.tradeId === undefined` is never true for a real row.
  const escrowed = (r: LockReason | undefined): boolean =>
    r !== undefined && !(r.kind === 'trade' && r.tradeId === opts.forTradeId);
  for (const id of side.dinoIds) {
    const d = ctx.db.select().from(schema.dinos).where(and(eq(schema.dinos.id, id), eq(schema.dinos.userId, userId))).get();
    if (!d) throw new TradeError(`You do not own dino #${id}.`);
    if (escrowed(locks.dinos.get(id))) throw new TradeError(`Dino #${id} is already in a pending trade or breeding.`);
    if (d.escapedAt !== null) throw new TradeError(`Dino #${id} has escaped — rescue it first.`);
    if (getSpecies(d.speciesId).rarity === 'mythic') throw new TradeError('Mythics cannot be traded.');
  }
  for (const id of side.eggIds) {
    const e = ctx.db.select().from(schema.eggs).where(and(eq(schema.eggs.id, id), eq(schema.eggs.userId, userId))).get();
    if (!e) throw new TradeError(`You do not own egg #${id}.`);
    if (escrowed(locks.eggs.get(id))) throw new TradeError(`Egg #${id} is already in a pending trade.`);
    if (e.rarity === 'mythic') throw new TradeError('Mythic eggs cannot be traded.');
    if (e.incubationStartedAt !== null) throw new TradeError(`Egg #${id} is incubating — it cannot be traded.`);
  }
}

export function createTrade(ctx: Ctx, fromUser: string, toUser: string, offer: TradeSide, request: TradeSide): Trade {
  if (fromUser === toUser) throw new TradeError('You cannot trade with yourself.');
  if (liveRating(ctx, fromUser) < TRADE_MIN_RATING) throw new TradeError('You need a 4★ park rating to trade.');
  if (liveRating(ctx, toUser) < TRADE_MIN_RATING) throw new TradeError('That player needs a 4★ park rating to trade.');
  const since = ctx.now() - TRADE_EXPIRY_MS;
  const recent = ctx.db.select().from(schema.trades)
    .where(and(eq(schema.trades.fromUser, fromUser), gt(schema.trades.createdAt, since))).all().length;
  if (recent >= TRADE_DAILY_CAP) throw new TradeError(`You can only start ${TRADE_DAILY_CAP} trades per day.`);
  verifySide(ctx, fromUser, offer);
  verifySide(ctx, toUser, request);
  // Inserting the pending row IS the lock: locksFor (src/core/locks.ts) derives escrow
  // from this row, so there is nothing to flip on the dino/egg.
  return ctx.db.insert(schema.trades).values({
    fromUser, toUser, offer, request, status: 'pending', createdAt: ctx.now(),
  }).returning().get();
}

// Move one side's dinos/eggs to their new owner: unassigned (no lot) and flagged via_trade
// (via_trade items sell for 0 shards — closes the sell-for-shards alt-funnel through trading).
function moveItems(ctx: Ctx, side: TradeSide, toUser: string): void {
  if (side.dinoIds.length) {
    // Credit the RECIPIENT's dex before the ownership change: a traded dino is a
    // species that player now owns, and nothing else on this path records it. Read
    // first — after the update below these rows belong to toUser and the id list is
    // the only handle back to which species just moved.
    const moving = ctx.db.select().from(schema.dinos)
      .where(inArray(schema.dinos.id, side.dinoIds)).all();
    for (const d of moving) recordSpeciesSeen(ctx, toUser, d.speciesId);
    ctx.db.update(schema.dinos)
      .set({ userId: toUser, lotId: null, viaTrade: true })
      .where(inArray(schema.dinos.id, side.dinoIds)).run();
  }
  // Eggs are deliberately NOT credited: eggs.speciesId is nullable (a wild egg rolls
  // its species at hatch), and hatchEgg credits the hatcher itself.
  if (side.eggIds.length) ctx.db.update(schema.eggs)
    .set({ userId: toUser, viaTrade: true })
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
  // The offer's items are locked BY THIS trade → waive that one lock and nothing else, so a second
  // pending trade or an unclaimed breeding still blocks the transfer. The request side is verified
  // with no waiver at all.
  verifySide(ctx, trade.fromUser, trade.offer, { forTradeId: trade.id });
  verifySide(ctx, trade.toUser, trade.request);
  if (liveRating(ctx, trade.fromUser) < TRADE_MIN_RATING || liveRating(ctx, trade.toUser) < TRADE_MIN_RATING)
    throw new TradeError('Both players must be at 4★ to complete the trade.');
  // An empty-for-empty trade is legal at creation (no minimum content is enforced), so
  // credit trades_completed only when something real actually moves — otherwise two
  // players could farm the daily quest with no-op trades.
  const moves = sideItemCount(trade.offer) + sideItemCount(trade.request)
    + trade.offer.cash + trade.request.cash > 0;
  const done = ctx.db.transaction(() => {
    moveItems(ctx, trade.offer, trade.toUser);      // offer → recipient
    moveItems(ctx, trade.request, trade.fromUser);  // request → sender
    // cash/food net: sender pays offer.*, receives request.*; recipient the inverse (sums to zero → no money created)
    const foodNet = (get: TradeSide, give: TradeSide): Partial<Record<FoodId, number>> => {
      const out: Record<string, number> = {};
      for (const [id, q] of Object.entries(get.foods)) out[id] = (out[id] ?? 0) + q;
      for (const [id, q] of Object.entries(give.foods)) out[id] = (out[id] ?? 0) - q;
      for (const id of Object.keys(out)) if (out[id] === 0) delete out[id];
      return out;
    };
    ctx.economy.apply(trade.fromUser, { cash: trade.request.cash - trade.offer.cash, foods: foodNet(trade.request, trade.offer) }, `trade:${trade.id}`, ctx.now());
    ctx.economy.apply(trade.toUser, { cash: trade.offer.cash - trade.request.cash, foods: foodNet(trade.offer, trade.request) }, `trade:${trade.id}`, ctx.now());
    if (moves) {
      track(ctx, trade.fromUser, 'trades_completed', 1);
      track(ctx, trade.toUser, 'trades_completed', 1);
      // trade.fromUser is not the dispatching user (trade.toUser is, by calling
      // acceptTrade), so no postDispatch hook will run for them off this interaction —
      // their season points just moved with nothing to stamp the capstone badge. Without
      // this, a sender who crosses the capstone on this trade alone and never dispatches
      // again before the season rolls loses the badge permanently: points are never
      // derived for a past season. A write context, so stamping another player's row here
      // does not bend the read-path rule stampSeasonBadge's own comment documents.
      stampSeasonBadge(ctx, trade.fromUser);
    }
    return ctx.db.update(schema.trades).set({ status: 'accepted', resolvedAt: ctx.now() })
      .where(eq(schema.trades.id, tradeId)).returning().get();
  });
  recomputeRating(ctx, trade.fromUser);
  recomputeRating(ctx, trade.toUser);
  return done;
}

// Closing the trade IS the unlock: locksFor only counts pending, unexpired rows.
function closeTrade(ctx: Ctx, trade: Trade, status: 'declined' | 'cancelled' | 'expired'): void {
  ctx.db.update(schema.trades).set({ status, resolvedAt: ctx.now() }).where(eq(schema.trades.id, trade.id)).run();
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

// No longer load-bearing for escrow: locksFor (src/core/locks.ts) evaluates expiry
// at read time, so a stale lock cannot exist. This only flips status for /trade list
// and history, and callers no longer have to sweep before reading a lock.
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
