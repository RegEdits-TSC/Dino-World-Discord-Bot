import { and, eq, gt, inArray } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { TradeSide } from '../../core/db/schema.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { TradeError, sideItemCount } from './validate.js';
import { TRADE_MIN_RATING, TRADE_DAILY_CAP, TRADE_MAX_ITEMS_PER_SIDE, TRADE_EXPIRY_MS } from '../../data/trade.js';

export { TradeError } from './validate.js';
export type Trade = typeof schema.trades.$inferSelect;

// The stored parkRating IS the live rating (maintained by every recompute-triggering action, unlike
// ratingHighWater). Read it directly — do NOT recompute here.
export function liveRating(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!.parkRating;
}

// Verify a user owns every dino/egg in a side, none Mythic, none locked, no escaped dino, and has the cash/food.
export function verifySide(ctx: Ctx, userId: string, side: TradeSide): void {
  if (sideItemCount(side) > TRADE_MAX_ITEMS_PER_SIDE) throw new TradeError(`At most ${TRADE_MAX_ITEMS_PER_SIDE} items per side.`);
  if (side.cash < 0 || side.food < 0) throw new TradeError('Amounts cannot be negative.');
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) throw new TradeError('Unknown user.');
  if (user.cash < side.cash) throw new TradeError('Not enough cash for the trade.');
  if (user.food < side.food) throw new TradeError('Not enough food for the trade.');
  for (const id of side.dinoIds) {
    const d = ctx.db.select().from(schema.dinos).where(and(eq(schema.dinos.id, id), eq(schema.dinos.userId, userId))).get();
    if (!d) throw new TradeError(`You do not own dino #${id}.`);
    if (d.locked) throw new TradeError(`Dino #${id} is already in a pending trade.`);
    if (d.escapedAt !== null) throw new TradeError(`Dino #${id} has escaped — rescue it first.`);
    if (getSpecies(d.speciesId).rarity === 'mythic') throw new TradeError('Mythics cannot be traded.');
  }
  for (const id of side.eggIds) {
    const e = ctx.db.select().from(schema.eggs).where(and(eq(schema.eggs.id, id), eq(schema.eggs.userId, userId))).get();
    if (!e) throw new TradeError(`You do not own egg #${id}.`);
    if (e.locked) throw new TradeError(`Egg #${id} is already in a pending trade.`);
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
