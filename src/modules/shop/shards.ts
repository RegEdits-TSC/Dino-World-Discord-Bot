import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { RARITY } from '../../data/rarity.js';
import { getSpecies, speciesByRarity } from '../../data/species/index.js';
import { rollSellShards } from '../../core/rolls.js';
import { locksFor } from '../../core/locks.js';
import { mythicUnlocked, recomputeRating } from '../park/rating.js';
import { SHARD_DAILY_CAP, SHARD_WINDOW_MS, MYTHIC_SHARD_COST, SELL_CASH } from '../../data/sell.js';
import { track } from '../../core/stats.js';
import { eventMods } from '../../core/world.js';
export { SHARD_DAILY_CAP } from '../../data/sell.js';

export class ShardError extends Error {}
type Egg = typeof schema.eggs.$inferSelect;
type Species = ReturnType<typeof getSpecies>;

/**
 * Round-only (no floor) — a payout, not a charge, same shape as
 * expeditionCashFor (src/modules/expeditions/service.ts:50-52). SELL_CASH's
 * minimum is common at 50, and the only shipped event touching sellCash
 * (market_panic) sets it to a flat 0.8 — 50 * 0.8 = 40, nowhere near 0, so a
 * floor has nothing to guard against today. Exported as its own (base, mult)
 * pure function, same reasoning as service.ts's roundCharge: no shipped
 * event's sellCash lands on a fractional SELL_CASH product either, so a
 * fractional multiplier has to be unit tested directly against this.
 */
export function roundPayout(base: number, mult: number): number {
  return Math.round(base * mult);
}

// Sell payout after the day's world event. Exported so sellDino's charge,
// previewSell's quote, and the /sell autocomplete label all read one number.
export function sellCashAt(rarity: Rarity, now: number): number {
  return roundPayout(SELL_CASH[rarity], eventMods(now).sellCash);
}

export function sellDino(ctx: Ctx, userId: string, dinoId: number): { cash: number; shards: number; capped: boolean } {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new ShardError('You do not own that dino.');
  if (locksFor(ctx, userId).dinos.has(dinoId)) throw new ShardError('That dino is locked (pending trade or breeding).');
  const species = getSpecies(dino.speciesId);
  if (species.rarity === 'mythic') throw new ShardError('Mythics cannot be sold.');
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  const now = ctx.now();
  let windowStart = user.shardsWindowStart; let windowEarned = user.shardsWindowEarned;
  if (now - windowStart >= SHARD_WINDOW_MS) { windowStart = now; windowEarned = 0; }
  const rolled = dino.viaTrade ? 0 : rollSellShards(species.rarity, ctx.rng);
  const allowed = Math.max(0, SHARD_DAILY_CAP - windowEarned);
  const shards = Math.min(rolled, allowed);
  const cash = sellCashAt(species.rarity, now);
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash, shards }, `sell:${species.id}`, now);
    ctx.db.update(schema.users)
      .set({ shardsWindowStart: windowStart, shardsWindowEarned: windowEarned + shards })
      .where(eq(schema.users.discordId, userId)).run();
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.id, dinoId)).run();
    track(ctx, userId, 'dinos_sold', 1);
  });
  recomputeRating(ctx, userId);
  return { cash, shards, capped: shards < rolled };
}

export function previewSell(ctx: Ctx, userId: string, dinoId: number) {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new ShardError('You do not own that dino.');
  const species = getSpecies(dino.speciesId);
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  const inWindow = ctx.now() - user.shardsWindowStart < SHARD_WINDOW_MS;
  const earned = inWindow ? user.shardsWindowEarned : 0;
  const [lo, hi] = RARITY[species.rarity].sellShards;
  return {
    minShards: dino.viaTrade ? 0 : lo, maxShards: dino.viaTrade ? 0 : hi,
    cashValue: sellCashAt(species.rarity, ctx.now()),
    sellable: species.rarity !== 'mythic' && !locksFor(ctx, userId).dinos.has(dinoId),
    capReached: earned >= SHARD_DAILY_CAP,
  };
}

export function buyMythicEgg(ctx: Ctx, userId: string, speciesId: string): Egg {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  if (!mythicUnlocked(user.ratingHighWater)) throw new ShardError('Reach 8★ park rating to unlock Mythic purchases.');
  const species = getSpecies(speciesId);
  if (species.rarity !== 'mythic') throw new ShardError('That is not a Mythic species.');
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { shards: -MYTHIC_SHARD_COST }, `mythic:${speciesId}`, ctx.now());
    const egg = ctx.db.insert(schema.eggs).values({
      userId, rarity: 'mythic', speciesId, source: 'shop', obtainedAt: ctx.now(),
    }).returning().get();
    track(ctx, userId, 'shop_purchases', 1);
    return egg;
  });
}

export function mythicSpeciesChoices(): Species[] { return speciesByRarity('mythic'); }
