import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { mulberry32, shuffle } from '../../core/rolls.js';
import { shopCeiling } from '../park/rating.js';
import { SHOP_EGG_PRICES, LEGENDARY_DAY_CHANCE, DEAL_EGG_DISCOUNT, DEAL_FOOD_DISCOUNT } from '../../data/shop.js';
import { FOODS, type FoodDef, type FoodId } from '../../data/foods.js';
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
  // Fisher-Yates (shuffle, src/core/rolls.ts) — not `sort(() => rng() - 0.5)`,
  // a comparator shuffle that's measurably biased AND whose draw COUNT varies
  // with base.length, which is exactly what made the old legendary roll below
  // consume a different number of prior draws per rarity ceiling.
  const offers: Rarity[] = shuffle(base, rng).slice(0, 3);
  if (canLegendary && rng() < LEGENDARY_DAY_CHANCE) offers.push('legendary');
  return offers;
}

// Distinct from WORLD_SALT (0x2c0, src/core/world.ts) and from
// dailyEggOffers' own UNSALTED mulberry32(day) above — a fresh, independently
// salted generator, so for any given day the deal's draws don't retrace
// either existing per-day stream. (mulberry32(day ^ DEAL_SALT) is still
// bit-identical to dailyEggOffers' mulberry32(day) stream for whichever OTHER
// day equals `day ^ DEAL_SALT` — harmless, since that's a different day's
// offers shuffle, not this day's, but worth being precise about.)
const DEAL_SALT = 0xface;

/**
 * Today's discounted egg rarity and food item, drawn from `offers` — never
 * the whole ladder. /shop egg rejects any rarity outside `offers` before it
 * ever reaches buyEgg (src/modules/shop/index.ts), so a deal outside `offers`
 * would be unbuyable.
 *
 * Uses a FRESH mulberry32 instance, never dailyEggOffers' own generator: that
 * one consumes a variable number of draws depending on the caller's rarity
 * ceiling (Fisher-Yates draws base.length - 1, plus one more when the
 * legendary roll executes), so a deal riding that same stream would differ
 * per player — the opposite of a global, everyone-sees-the-same-shop deal.
 */
export function dailyDeal(offers: Rarity[], now: number): { rarity: Rarity; food: FoodId } {
  const day = Math.floor(now / 86_400_000);
  const rng = mulberry32(day ^ DEAL_SALT);
  const rarity = offers[Math.floor(rng() * offers.length)];
  const foods = Object.values(FOODS);
  const food = foods[Math.floor(rng() * foods.length)].id;
  return { rarity, food };
}

/**
 * The one global daily deal. Computed from the uncommon-ceiling offers
 * (highWater 0) rather than any specific player's own rotation, because that
 * ceiling band is the one place dailyEggOffers' pool (2 entries: common,
 * uncommon) is never truncated by the slice(0, 3) below the epic ceiling —
 * order is shuffled but the SET is always both rarities. Same for the rare
 * ceiling's exactly-3-entry pool. So the deal is always visible and buyable
 * by every player at the uncommon or rare ceiling — precisely the population
 * Defect 8.2 exists to help, since below a 4.0★ (epic-ceiling) best-ever
 * rating the offer SET cannot vary at all and the deal is the only day-to-day
 * variety those players get. eggPriceAt/foodPriceAt below and /shop view's
 * banner (src/modules/shop/index.ts) all call this one function, so the
 * charged price and the displayed price can never disagree.
 */
export function todaysDeal(now: number): { rarity: Rarity; food: FoodId } {
  return dailyDeal(dailyEggOffers(0, now), now);
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
 * table), and it lets a second multiplier — the daily-deal discount
 * (DEAL_EGG_DISCOUNT/DEAL_FOOD_DISCOUNT, src/data/shop.ts) — compose cleanly
 * by folding into `mult` before this call in eggPriceAt/foodPriceAt below,
 * with no parallel code path.
 */
export function roundCharge(base: number, mult: number): number {
  return Math.max(1, Math.round(base * mult));
}

// Egg price after the day's world event AND the day's deal. Exported so the
// /shop view lines, the rarity autocomplete label, and buyEgg's own charge
// all read one number — the deal discount folds straight into the `mult`
// argument here, so there is no separate "quote" vs "charge" computation to
// let drift apart.
export function eggPriceAt(rarity: Rarity, now: number): number {
  const dealMult = rarity === todaysDeal(now).rarity ? DEAL_EGG_DISCOUNT : 1;
  return roundCharge(SHOP_EGG_PRICES[rarity], eventMods(now).eggPrice * dealMult);
}

// Per-unit food price after the day's world event AND the day's deal.
// buyFood multiplies this ALREADY-ROUNDED per-unit price by units — never
// rounds the raw units*unitCost*mult product — because the quote everywhere
// (/shop view, the food autocomplete label) is the per-unit price; charging
// anything else would desync the display from the charge for units > 1.
export function foodPriceAt(food: FoodDef, now: number): number {
  const dealMult = food.id === todaysDeal(now).food ? DEAL_FOOD_DISCOUNT : 1;
  return roundCharge(food.unitCost, eventMods(now).foodPrice * dealMult);
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
