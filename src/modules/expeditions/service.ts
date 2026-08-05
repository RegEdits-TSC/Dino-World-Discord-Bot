import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { EXPEDITION_SITES, type SiteDef } from '../../data/sites.js';
import { siteUnlocked } from '../park/rating.js';
import { rollRarityFromOdds, rollIntInclusive } from '../../core/rolls.js';
import { foodsForDiet, type FoodId } from '../../data/foods.js';
import { track } from '../../core/stats.js';
import { RARITY_LADDER } from '../../data/breeding.js';
import { eventMods } from '../../core/world.js';

export class ExpeditionError extends Error {}
export type Expedition = typeof schema.expeditions.$inferSelect;
export interface Loot { eggRarity: Rarity; cash: number; food: { foodId: FoodId; qty: number } }

function highWater(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!.ratingHighWater;
}
export function listSites(hw: number): SiteDef[] {
  return Object.values(EXPEDITION_SITES).filter((s) => siteUnlocked(s.unlockRating, hw));
}

/**
 * Move every entry `step` places along the rarity ladder, clamping at both ends
 * and merging entries that collide. Total weight is preserved, so this changes
 * the SHAPE of the distribution without changing how many rng draws follow —
 * claimExpedition's draw ORDER is load-bearing for seeded fixtures.
 */
export function shiftOdds(
  odds: Array<{ rarity: Rarity; weight: number }>,
  step: -1 | 0 | 1,
): Array<{ rarity: Rarity; weight: number }> {
  if (step === 0) return odds;
  const merged = new Map<Rarity, number>();
  for (const o of odds) {
    const idx = RARITY_LADDER.indexOf(o.rarity);
    const moved = RARITY_LADDER[Math.min(RARITY_LADDER.length - 1, Math.max(0, idx + step))];
    merged.set(moved, (merged.get(moved) ?? 0) + o.weight);
  }
  return RARITY_LADDER
    .filter((r) => merged.has(r))
    .map((r) => ({ rarity: r, weight: merged.get(r)! }));
}
export function activeExpedition(ctx: Ctx, userId: string): Expedition | undefined {
  return ctx.db.select().from(schema.expeditions)
    .where(and(eq(schema.expeditions.userId, userId), isNull(schema.expeditions.claimedAt))).get();
}
export function startExpedition(ctx: Ctx, userId: string, siteId: string, guildId: string | null): Expedition {
  const site = EXPEDITION_SITES[siteId];
  if (!site) throw new ExpeditionError('Unknown site.');
  if (!siteUnlocked(site.unlockRating, highWater(ctx, userId))) throw new ExpeditionError('That site is not unlocked yet.');
  if (activeExpedition(ctx, userId)) throw new ExpeditionError('You already have an expedition out — claim it first.');
  const now = ctx.now();
  // Duration and fee are captured HERE, at start — not re-derived at claim.
  // returnsAt is written to the row and drives the scheduler timer; an event
  // ending (or starting) mid-flight must never retroactively move it.
  const mods = eventMods(now);
  const returnsAt = now + Math.round(site.durationMs * mods.expeditionMs);
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -Math.ceil(site.cost * mods.expeditionFee) }, `expedition:${siteId}`, now);
    const exp = ctx.db.insert(schema.expeditions).values({
      userId, siteId, departedAt: now, returnsAt, loot: null, claimedAt: null,
    }).returning().get();
    ctx.scheduler.enqueue({ kind: 'expedition_return', userId, refId: exp.id, originGuildId: guildId, firesAt: returnsAt });
    return exp;
  });
}
export function claimExpedition(ctx: Ctx, userId: string): { loot: Loot; site: SiteDef } {
  const exp = activeExpedition(ctx, userId);
  if (!exp) throw new ExpeditionError('You have no expedition to claim.');
  if (exp.returnsAt > ctx.now()) throw new ExpeditionError('Your expedition has not returned yet.');
  const site = EXPEDITION_SITES[exp.siteId];
  // Loot is priced at CLAIM time, unlike duration/fee — the payout has not
  // happened yet, so there is nothing to retroactively move.
  const mods = eventMods(ctx.now());
  // shiftOdds is a pure array transform consuming zero rng: the draw order
  // below (eggRarity -> lootDiet -> bonusCash -> bonusFood) stays fixed, so
  // seeded fixtures in tests/expeditions.test.ts are unaffected on a calm day.
  const eggRarity = rollRarityFromOdds(shiftOdds(site.eggOdds, mods.expeditionOddsShift), ctx.rng);
  const lootDiet = ctx.rng() < 0.5 ? 'herbivore' : 'carnivore';
  const loot: Loot = {
    eggRarity,
    cash: Math.round(rollIntInclusive(site.bonusCash[0], site.bonusCash[1], ctx.rng) * mods.expeditionCash),
    food: { foodId: foodsForDiet(lootDiet)[0].id, qty: rollIntInclusive(site.bonusFood[0], site.bonusFood[1], ctx.rng) },
  };
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: loot.cash, foods: { [loot.food.foodId]: loot.food.qty } }, `expedition-loot:${exp.siteId}`, ctx.now());
    ctx.db.insert(schema.eggs).values({
      userId, rarity: eggRarity, speciesId: null, source: 'expedition', obtainedAt: ctx.now(),
    }).run();
    ctx.db.update(schema.expeditions).set({ claimedAt: ctx.now(), loot })
      .where(eq(schema.expeditions.id, exp.id)).run();
    track(ctx, userId, 'expeditions_claimed', 1);
    return { loot, site };
  });
}
