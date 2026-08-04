import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { RARITY } from '../../data/rarity.js';
import { getSpecies, speciesByRarity } from '../../data/species/index.js';
import { rollSellShards } from '../../core/rolls.js';
import { locksFor } from '../../core/locks.js';
import { mythicUnlocked, recomputeRating } from '../park/rating.js';
import { SHARD_DAILY_CAP, SHARD_WINDOW_MS, MYTHIC_SHARD_COST, SELL_CASH } from '../../data/sell.js';
import { track } from '../../core/stats.js';
export { SHARD_DAILY_CAP } from '../../data/sell.js';

export class ShardError extends Error {}
type Egg = typeof schema.eggs.$inferSelect;
type Species = ReturnType<typeof getSpecies>;

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
  const cash = SELL_CASH[species.rarity];
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
    cashValue: SELL_CASH[species.rarity],
    sellable: species.rarity !== 'mythic' && !locksFor(ctx, userId).dinos.has(dinoId),
    capReached: earned >= SHARD_DAILY_CAP,
  };
}

export function buyMythicEgg(ctx: Ctx, userId: string, speciesId: string): Egg {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  if (!mythicUnlocked(user.ratingHighWater)) throw new ShardError('Reach 4★ park rating to unlock Mythic purchases.');
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
