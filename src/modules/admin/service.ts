import { eq, or, and, isNull, isNotNull, sql } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { FOODS, STARTER_FOOD, type FoodId } from '../../data/foods.js';
import { getSpecies } from '../../data/species/index.js';
import { getOrCreateUser } from '../park/service.js';
import { recomputeRating } from '../park/rating.js';
import { settleEscapes } from '../park/escapes.js';
import { ENERGY_CAP } from '../../data/battle/constants.js';

export class AdminError extends Error {}

export interface GiveArgs {
  cash?: number; food?: { foodId: FoodId; qty: number }; shards?: number; eggRarity?: Rarity; dinoSpecies?: string;
}

// Grant resources to a player. Atomic; currency via economy.apply; rating recomputed after.
export function adminGive(ctx: Ctx, targetId: string, displayName: string, args: GiveArgs): void {
  const { cash = 0, food, shards = 0, eggRarity, dinoSpecies } = args;
  if (!cash && !food && !shards && !eggRarity && !dinoSpecies) throw new AdminError('Nothing to give.');
  if (food && !(food.foodId in FOODS)) throw new AdminError(`Unknown food: ${food.foodId}`);
  if (dinoSpecies) {
    try { getSpecies(dinoSpecies); } catch { throw new AdminError(`Unknown species: ${dinoSpecies}`); }
  }
  getOrCreateUser(ctx, targetId, displayName);
  ctx.db.transaction(() => {
    if (cash || food || shards) ctx.economy.apply(targetId,
      { cash, shards, foods: food ? { [food.foodId]: food.qty } : {} }, 'admin:give', ctx.now());
    if (eggRarity) ctx.db.insert(schema.eggs).values({
      userId: targetId, rarity: eggRarity, speciesId: null, source: 'admin', obtainedAt: ctx.now(),
    }).run();
    if (dinoSpecies) ctx.db.insert(schema.dinos).values({
      userId: targetId, lotId: null, speciesId: dinoSpecies, hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
    }).run();
  });
  recomputeRating(ctx, targetId);
}

// Reset a player to a fresh start: delete their content, restore new-player defaults. One transaction.
export function adminReset(ctx: Ctx, targetId: string): void {
  ctx.db.transaction(() => {
    // Deleting the trade rows below IS the unlock, including for the counterparty: escrow is
    // derived from pending trades (src/core/locks.ts), never stored on the dino/egg. When
    // targetId is the recipient (toUser) the offer belongs to a different player, and their
    // items free up the moment the row is gone.
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.userId, targetId)).run();
    ctx.db.delete(schema.eggs).where(eq(schema.eggs.userId, targetId)).run();
    ctx.db.delete(schema.lots).where(eq(schema.lots.userId, targetId)).run();
    ctx.db.delete(schema.expeditions).where(eq(schema.expeditions.userId, targetId)).run();
    ctx.db.delete(schema.timers).where(eq(schema.timers.userId, targetId)).run();
    ctx.db.delete(schema.trades)
      .where(or(eq(schema.trades.fromUser, targetId), eq(schema.trades.toUser, targetId))).run();
    ctx.db.delete(schema.battleProgress).where(eq(schema.battleProgress.userId, targetId)).run();
    ctx.db.update(schema.users).set({
      cash: 500, shards: 0, parkRating: 0, ratingHighWater: 0, parkName: 'New Park',
      shardsWindowStart: 0, shardsWindowEarned: 0, lastCollectAt: ctx.now(),
      energy: ENERGY_CAP, energyUpdatedAt: ctx.now(),
    }).where(eq(schema.users.discordId, targetId)).run();
    ctx.db.delete(schema.foodInventory).where(eq(schema.foodInventory.userId, targetId)).run();
    for (const [foodId, qty] of Object.entries(STARTER_FOOD)) {
      ctx.db.insert(schema.foodInventory).values({ userId: targetId, foodId, qty }).run();
    }
  });
}

const HOUR_MS = 3_600_000;

// Advance a player's clock by shifting their time-bearing columns backward, so the lazy
// income/hunger/escape/incubation/expedition math sees `hours` of elapsed time. Returns the
// number of dinos that escaped as a result.
export function adminFastForward(ctx: Ctx, targetId: string, hours: number): number {
  if (hours < 1 || hours > 720) throw new AdminError('hours must be between 1 and 720.');
  const shift = hours * HOUR_MS;
  ctx.db.transaction(() => {
    ctx.db.update(schema.users).set({
      lastCollectAt: sql`${schema.users.lastCollectAt} - ${shift}`,
      shardsWindowStart: sql`${schema.users.shardsWindowStart} - ${shift}`,
      energyUpdatedAt: sql`${schema.users.energyUpdatedAt} - ${shift}`,
    }).where(eq(schema.users.discordId, targetId)).run();
    ctx.db.update(schema.dinos).set({ lastFedAt: sql`${schema.dinos.lastFedAt} - ${shift}` })
      .where(eq(schema.dinos.userId, targetId)).run();
    ctx.db.update(schema.eggs).set({
      incubationStartedAt: sql`${schema.eggs.incubationStartedAt} - ${shift}`,
      hatchesAt: sql`${schema.eggs.hatchesAt} - ${shift}`,
    }).where(and(eq(schema.eggs.userId, targetId), isNotNull(schema.eggs.incubationStartedAt))).run();
    ctx.db.update(schema.expeditions).set({
      departedAt: sql`${schema.expeditions.departedAt} - ${shift}`,
      returnsAt: sql`${schema.expeditions.returnsAt} - ${shift}`,
    }).where(eq(schema.expeditions.userId, targetId)).run();
    ctx.db.update(schema.timers).set({ firesAt: sql`${schema.timers.firesAt} - ${shift}` })
      .where(and(eq(schema.timers.userId, targetId), isNull(schema.timers.handledAt))).run();
  });
  return settleEscapes(ctx, targetId).length;
}
