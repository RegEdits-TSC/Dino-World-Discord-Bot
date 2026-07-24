import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { mulberry32 } from '../../core/rolls.js';
import { shopCeiling } from '../park/rating.js';
import { SHOP_EGG_PRICES, LEGENDARY_DAY_CHANCE } from '../../data/shop.js';
import { FOODS, type FoodDef } from '../../data/foods.js';

export class ShopError extends Error {}
type Egg = typeof schema.eggs.$inferSelect;
const LADDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export function dailyEggOffers(highWater: number, now: number): Rarity[] {
  const ceiling = shopCeiling(highWater);
  const ceilIdx = LADDER.indexOf(ceiling);
  const pool = LADDER.slice(0, ceilIdx + 1);
  const day = Math.floor(now / 86_400_000);
  const rng = mulberry32(day);
  const canLegendary = ceiling === 'legendary';
  const base: Rarity[] = pool.filter((r) => r !== 'legendary');
  const offers: Rarity[] = [...base].sort(() => rng() - 0.5).slice(0, 3);
  if (canLegendary && rng() < LEGENDARY_DAY_CHANCE) offers.push('legendary');
  return offers;
}

export function buyEgg(ctx: Ctx, userId: string, rarity: Rarity): Egg {
  if (rarity === 'mythic') throw new ShopError('Mythic eggs are not sold in the shop.');
  const price = SHOP_EGG_PRICES[rarity];
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -price }, `shop-egg:${rarity}`, ctx.now());
    return ctx.db.insert(schema.eggs).values({
      userId, rarity, speciesId: null, source: 'shop', obtainedAt: ctx.now(),
    }).returning().get();
  });
}

export function buyFood(ctx: Ctx, userId: string, foodId: string, units: number): { food: FoodDef; total: number } {
  if (units <= 0) throw new ShopError('Amount must be positive.');
  const food = (FOODS as Record<string, FoodDef | undefined>)[foodId];
  if (!food) throw new ShopError('Unknown food.');
  const total = units * food.unitCost;
  ctx.economy.apply(userId, { cash: -total, foods: { [food.id]: units } }, `shop-food:${food.id}:${units}`, ctx.now());
  return { food, total };
}
