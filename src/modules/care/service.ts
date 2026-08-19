import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Species, Diet, Rarity } from '../../data/types.js';
import { FOODS, foodsForDiet, type FoodDef, type FoodId } from '../../data/foods.js';
import { RARITY } from '../../data/rarity.js';
import { getSpecies } from '../../data/species/index.js';
import { hungerAt, drainMsFor, paddockFit } from '../../core/clock.js';
import { toClockDinos } from '../park/service.js';
import { recomputeRating } from '../park/rating.js';
import { PADDOCKS } from '../../data/paddocks.js';
import { RECAPTURE_FEE_HOURS } from '../../data/care.js';
import { modProduct } from '../../data/traits.js';
import { track } from '../../core/stats.js';
import { eventMods } from '../../core/world.js';
import { foodEmoji } from '../../core/emojis.js';

export class CareError extends Error {}

// Feed cost in food units, after trait modifiers and the day's world event.
// Floored at 1: a discount must never make feeding free. Forward-looking guard,
// not currently exercised: the lowest pre-floor value reachable today is 2.625
// (common's feedCost 5 * voracious's 0.70 * cold_snap's 0.75 — the one-trait-per-
// domain rule means no second care-domain trait discount can stack on top), so
// the floor can't trigger yet. It exists so a future cheaper food tier or a
// stronger discount can't make feeding free.
// `now` is REQUIRED, not defaulted, for the same reason hungerAt's drainMs is:
// a default would let a call site silently keep the unmodified cost.
export function feedCostFor(rarity: Rarity, traits: string[], now: number): number {
  return Math.max(1, Math.round(
    RARITY[rarity].feedCost * modProduct(traits, 'feed') * eventMods(now).feedCost,
  ));
}

function pickFood(ctx: Ctx, userId: string, diet: Diet, cost: number): FoodDef | null {
  const inv = ctx.economy.getFoodInventory(userId);
  return foodsForDiet(diet).find((f) => (inv[f.id] ?? 0) >= cost) ?? null;
}

// The single fact behind every "why was this one skipped" surface: the largest stack
// of that diet the player actually holds. pickFood returns null for two genuinely
// different reasons — an empty pantry, and a pantry that is merely short — and quoting
// the wrong one sends players to /shop food while the stock they need sits in plain
// sight. Falls back to the tier-1 food (foodsForDiet is tier-sorted), which is both the
// cheapest restock and the one the empty-pantry wording already names.
function bestStock(ctx: Ctx, userId: string, diet: Diet): { food: FoodDef; qty: number } {
  const inv = ctx.economy.getFoodInventory(userId);
  const foods = foodsForDiet(diet);
  let best = { food: foods[0], qty: inv[foods[0].id] ?? 0 };
  for (const f of foods) {
    const qty = inv[f.id] ?? 0;
    if (qty > best.qty) best = { food: f, qty };
  }
  return best;
}

function stockPhrase(stock: { food: FoodDef; qty: number }, diet: Diet): string {
  return stock.qty > 0 ? `**${stock.qty} ${stock.food.name}**` : `**no ${diet} food**`;
}

// A skipped dino carries everything the player needs in order to act on it: which dino,
// what diet it eats, and the exact unit cost. feedAll computes all three at the skip
// point already; the original shape returned bare ids and threw the rest away, leaving
// every surface able to print only a count.
export interface FeedSkip { id: number; name: string; diet: Diet; cost: number }

export function feedDino(ctx: Ctx, userId: string, dinoId: number, foodId?: string):
    { species: Species; food: FoodDef; cost: number } {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new CareError('You do not own that dino.');
  if (dino.escapedAt !== null) throw new CareError('That dino has escaped — rescue it first.');
  const species = getSpecies(dino.speciesId);
  const cost = feedCostFor(species.rarity, dino.traits, ctx.now());
  let food: FoodDef;
  if (foodId) {
    const chosen = (FOODS as Record<string, FoodDef | undefined>)[foodId];
    if (!chosen) throw new CareError('Unknown food.');
    if (chosen.diet !== species.diet)
      throw new CareError(`${species.name} is a ${species.diet} — it won't eat ${chosen.name}.`);
    food = chosen;
  } else {
    const picked = pickFood(ctx, userId, species.diet, cost);
    if (!picked) {
      // Two causes, two messages: telling a player holding 12 Fish that they have no
      // carnivore food is a false statement, not merely a vague one.
      const stock = bestStock(ctx, userId, species.diet);
      throw new CareError(stock.qty > 0
        ? `Your ${species.name} needs ${cost} ${stock.food.name} — you only have ${stock.qty}.`
          + ` Buy more with /shop food.`
        : `You have no ${species.diet} food — buy ${foodsForDiet(species.diet)[0].name} with /shop food.`);
    }
    food = picked;
  }
  const wasHungry = hungerAt(dino.hunger, dino.lastFedAt, ctx.now(), drainMsFor(dino.traits)) < 100;
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { foods: { [food.id]: -cost } }, `feed:${species.id}`, ctx.now());
    ctx.db.update(schema.dinos).set({ hunger: food.fillTo, lastFedAt: ctx.now() })
      .where(eq(schema.dinos.id, dinoId)).run();
    if (wasHungry) track(ctx, userId, 'dinos_fed', 1);   // re-feeding a full dino is not care
  });
  recomputeRating(ctx, userId);
  return { species, food, cost };
}

export function feedAll(ctx: Ctx, userId: string):
    { fed: number[]; skipped: FeedSkip[]; spent: Partial<Record<FoodId, number>> } {
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  const candidates = dinos
    .map((d, i) => ({
      id: d.id, species: clockDinos[i].species, traits: d.traits,
      name: d.nickname ?? clockDinos[i].species.name,
      hunger: hungerAt(d.hunger, d.lastFedAt, ctx.now(), drainMsFor(d.traits)), escaped: d.escapedAt !== null,
    }))
    .filter((c) => !c.escaped && c.hunger < 100)
    .sort((a, b) => a.hunger - b.hunger);                // hungriest first
  const fed: number[] = []; const skipped: FeedSkip[] = [];
  const spent: Partial<Record<FoodId, number>> = {};
  for (const c of candidates) {
    const cost = feedCostFor(c.species.rarity, c.traits, ctx.now());
    const food = pickFood(ctx, userId, c.species.diet, cost);
    if (!food) { skipped.push({ id: c.id, name: c.name, diet: c.species.diet, cost }); continue; }
    ctx.db.transaction(() => {
      ctx.economy.apply(userId, { foods: { [food.id]: -cost } }, `feed:${c.species.id}`, ctx.now());
      ctx.db.update(schema.dinos).set({ hunger: food.fillTo, lastFedAt: ctx.now() })
        .where(eq(schema.dinos.id, c.id)).run();
      track(ctx, userId, 'dinos_fed', 1);
    });
    fed.push(c.id);
    spent[food.id] = (spent[food.id] ?? 0) + cost;
  }
  if (fed.length) recomputeRating(ctx, userId);
  return { fed, skipped, spent };
}

// How many dinos one diet's line names before it collapses to "+N more". Six keeps the
// worst case (both diets, long nicknames) well inside the 2000-character message content
// limit, which the alert Feed all button's i.update writes into directly.
const SKIP_NAMES_SHOWN = 6;

/**
 * The player-facing answer to "which ones were not fed, and what do they need".
 * Grouped by DIET rather than per dino because the remedy is a single purchase per diet;
 * diets appear in the order feedAll skipped them (hungriest first). Stock is read fresh
 * rather than captured at the skip point, because feedAll keeps spending after a skip — a
 * captured figure would disagree with the pantry the player is about to open.
 * Returns '' when nothing was skipped, so callers can test it as the whole condition.
 */
export function feedSkipReport(ctx: Ctx, userId: string, skipped: FeedSkip[]): string {
  if (!skipped.length) return '';
  const byDiet = new Map<Diet, FeedSkip[]>();
  for (const s of skipped) {
    const group = byDiet.get(s.diet);
    if (group) group.push(s); else byDiet.set(s.diet, [s]);
  }
  const lines = [`⚠️ **${skipped.length} skipped — not enough food**`];
  for (const [diet, group] of byDiet) {
    const stock = bestStock(ctx, userId, diet);
    const need = group.reduce((sum, s) => sum + s.cost, 0);
    lines.push(`${foodEmoji(stock.food.id)}**${diet[0].toUpperCase()}${diet.slice(1)}**`
      + ` — need **${need}**, you have ${stockPhrase(stock, diet)}`);
    const named = group.slice(0, SKIP_NAMES_SHOWN).map((s) => `#${s.id} ${s.name} (${s.cost})`);
    const rest = group.length - named.length;
    lines.push(`└ ${named.join(' · ')}${rest > 0 ? ` · +${rest} more` : ''}`);
  }
  lines.push('Restock with `/shop food`.');
  return lines.join('\n');
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
    track(ctx, userId, 'dinos_rescued', 1);
  });
  recomputeRating(ctx, userId);
  return { fee, species };
}
