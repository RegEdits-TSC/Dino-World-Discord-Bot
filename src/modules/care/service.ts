import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Species, Diet } from '../../data/types.js';
import { FOODS, foodsForDiet, type FoodDef, type FoodId } from '../../data/foods.js';
import { RARITY } from '../../data/rarity.js';
import { getSpecies } from '../../data/species/index.js';
import { hungerAt, drainMsFor, paddockFit } from '../../core/clock.js';
import { toClockDinos } from '../park/service.js';
import { recomputeRating } from '../park/rating.js';
import { PADDOCKS } from '../../data/paddocks.js';
import { RECAPTURE_FEE_HOURS } from '../../data/care.js';

export class CareError extends Error {}

function pickFood(ctx: Ctx, userId: string, diet: Diet, cost: number): FoodDef | null {
  const inv = ctx.economy.getFoodInventory(userId);
  return foodsForDiet(diet).find((f) => (inv[f.id] ?? 0) >= cost) ?? null;
}

export function feedDino(ctx: Ctx, userId: string, dinoId: number, foodId?: string):
    { species: Species; food: FoodDef; cost: number } {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new CareError('You do not own that dino.');
  if (dino.escapedAt !== null) throw new CareError('That dino has escaped — rescue it first.');
  const species = getSpecies(dino.speciesId);
  const cost = RARITY[species.rarity].feedCost;
  let food: FoodDef;
  if (foodId) {
    const chosen = (FOODS as Record<string, FoodDef | undefined>)[foodId];
    if (!chosen) throw new CareError('Unknown food.');
    if (chosen.diet !== species.diet)
      throw new CareError(`${species.name} is a ${species.diet} — it won't eat ${chosen.name}.`);
    food = chosen;
  } else {
    const picked = pickFood(ctx, userId, species.diet, cost);
    if (!picked) throw new CareError(
      `You have no ${species.diet} food — buy ${foodsForDiet(species.diet)[0].name} with /shop food.`);
    food = picked;
  }
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { foods: { [food.id]: -cost } }, `feed:${species.id}`, ctx.now());
    ctx.db.update(schema.dinos).set({ hunger: food.fillTo, lastFedAt: ctx.now() })
      .where(eq(schema.dinos.id, dinoId)).run();
  });
  recomputeRating(ctx, userId);
  return { species, food, cost };
}

export function feedAll(ctx: Ctx, userId: string):
    { fed: number[]; skipped: number[]; spent: Partial<Record<FoodId, number>> } {
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  const candidates = dinos
    .map((d, i) => ({ id: d.id, species: clockDinos[i].species, hunger: hungerAt(d.hunger, d.lastFedAt, ctx.now(), drainMsFor(d.traits)), escaped: d.escapedAt !== null }))
    .filter((c) => !c.escaped && c.hunger < 100)
    .sort((a, b) => a.hunger - b.hunger);                // hungriest first
  const fed: number[] = []; const skipped: number[] = [];
  const spent: Partial<Record<FoodId, number>> = {};
  for (const c of candidates) {
    const cost = RARITY[c.species.rarity].feedCost;
    const food = pickFood(ctx, userId, c.species.diet, cost);
    if (!food) { skipped.push(c.id); continue; }
    ctx.db.transaction(() => {
      ctx.economy.apply(userId, { foods: { [food.id]: -cost } }, `feed:${c.species.id}`, ctx.now());
      ctx.db.update(schema.dinos).set({ hunger: food.fillTo, lastFedAt: ctx.now() })
        .where(eq(schema.dinos.id, c.id)).run();
    });
    fed.push(c.id);
    spent[food.id] = (spent[food.id] ?? 0) + cost;
  }
  if (fed.length) recomputeRating(ctx, userId);
  return { fed, skipped, spent };
}

export function rescueDino(ctx: Ctx, userId: string, dinoId: number): { fee: number; species: Species } {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new CareError('You do not own that dino.');
  if (dino.escapedAt === null) throw new CareError('That dino has not escaped.');
  const species = getSpecies(dino.speciesId);
  const lot = dino.lotId != null
    ? ctx.db.select().from(schema.lots).where(eq(schema.lots.id, dino.lotId)).get() : undefined;
  // Escaped dinos always have a paddock (unassigned dinos never escape); the 0.5
  // fallback is defensive only, in case that invariant is ever violated.
  const fit = lot && lot.type === 'paddock' ? paddockFit(species, PADDOCKS[lot.kind], lot.decor) : 0.5;
  const fee = RECAPTURE_FEE_HOURS * RARITY[species.rarity].incomePerHr;
  const newHunger = Math.min(100, Math.round(50 / fit));   // comfort re-evaluates to ~0.5 (spec §3.4)
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -fee }, `rescue:${species.id}`, ctx.now());
    ctx.db.update(schema.dinos).set({ hunger: newHunger, lastFedAt: ctx.now(), escapedAt: null })
      .where(eq(schema.dinos.id, dinoId)).run();
  });
  recomputeRating(ctx, userId);
  return { fee, species };
}
