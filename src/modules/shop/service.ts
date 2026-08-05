import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { mulberry32 } from '../../core/rolls.js';
import { shopCeiling } from '../park/rating.js';
import { SHOP_EGG_PRICES, LEGENDARY_DAY_CHANCE } from '../../data/shop.js';
import { FOODS, type FoodDef } from '../../data/foods.js';
import { track } from '../../core/stats.js';
import { eventMods } from '../../core/world.js';

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

/**
 * Round-with-floor at 1 cash — the shape every shop charge shares with
 * feedCostFor (src/modules/care/service.ts:28-32) and expeditionFeeFor
 * (src/modules/expeditions/service.ts:36-38). Round, not ceil: ceil is
 * float-unsafe on an integer x fractional-multiplier product (e.g. an
 * 8_000 * 1.1 style product can land on a .0000000000003 tail) and there is
 * no Math.ceil left on any money value in this repo. Exported as its own
 * (base, mult) pure function — same shape as expeditionFeeFor/
 * expeditionCashFor — for two reasons: a fractional multiplier can be unit
 * tested directly (no shipped world event produces a fractional eggPrice
 * product against any SHOP_EGG_PRICES rarity — bumper_harvest's 1.25 and
 * market_panic's 0.7 both land on exact integers for every price in the
 * table), and a future second multiplier (a daily-deal discount) composes
 * cleanly by folding into `mult` before this call, with no parallel code
 * path.
 */
export function roundCharge(base: number, mult: number): number {
  return Math.max(1, Math.round(base * mult));
}

// Egg price after the day's world event. Exported so the /shop view lines,
// the rarity autocomplete label, and buyEgg's own charge all read one number.
export function eggPriceAt(rarity: Rarity, now: number): number {
  return roundCharge(SHOP_EGG_PRICES[rarity], eventMods(now).eggPrice);
}

// Per-unit food price after the day's world event. buyFood multiplies this
// ALREADY-ROUNDED per-unit price by units — never rounds the raw
// units*unitCost*mult product — because the quote everywhere (/shop view,
// the food autocomplete label) is the per-unit price; charging anything else
// would desync the display from the charge for units > 1.
export function foodPriceAt(food: FoodDef, now: number): number {
  return roundCharge(food.unitCost, eventMods(now).foodPrice);
}

export function buyEgg(ctx: Ctx, userId: string, rarity: Rarity): Egg {
  if (rarity === 'mythic') throw new ShopError('Mythic eggs are not sold in the shop.');
  const price = eggPriceAt(rarity, ctx.now());
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -price }, `shop-egg:${rarity}`, ctx.now());
    const egg = ctx.db.insert(schema.eggs).values({
      userId, rarity, speciesId: null, source: 'shop', obtainedAt: ctx.now(),
    }).returning().get();
    track(ctx, userId, 'shop_purchases', 1);
    return egg;
  });
}

export function buyFood(ctx: Ctx, userId: string, foodId: string, units: number): { food: FoodDef; total: number } {
  if (units <= 0) throw new ShopError('Amount must be positive.');
  const food = (FOODS as Record<string, FoodDef | undefined>)[foodId];
  if (!food) throw new ShopError('Unknown food.');
  const total = units * foodPriceAt(food, ctx.now());
  ctx.economy.apply(userId, { cash: -total, foods: { [food.id]: units } }, `shop-food:${food.id}:${units}`, ctx.now());
  track(ctx, userId, 'shop_purchases', 1);   // one purchase transaction, never scaled by units
  return { food, total };
}
