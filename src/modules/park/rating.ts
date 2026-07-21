import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { allSpecies } from '../../data/species/index.js';
import { comfortAt } from '../../core/clock.js';
import { toClockDinos } from './service.js';
import { RARITY_WEIGHT, RATING_WEIGHTS, PARK_TARGET } from '../../data/progression.js';

// re-export the pure gating helpers so later modules can import from './rating.js'
export { siteUnlocked, lotSlots, shopCeiling, mythicUnlocked } from '../../data/progression.js';

const TOTAL_SPECIES_WEIGHT = allSpecies().reduce((s, sp) => s + RARITY_WEIGHT[sp.rarity], 0);

export function recomputeRating(ctx: Ctx, userId: string): { rating: number; highWater: number } {
  const { clockDinos, lots, user } = toClockDinos(ctx, userId);
  const owned = new Map(clockDinos.map((d) => [d.species.id, d.species.rarity]));
  const ownedWeight = [...owned.values()].reduce((s, rarity) => s + RARITY_WEIGHT[rarity], 0);
  const collection = TOTAL_SPECIES_WEIGHT === 0 ? 0 : ownedWeight / TOTAL_SPECIES_WEIGHT;
  const parkRaw = lots.reduce((s, l) => s + l.level + l.decor.length, 0);
  const park = Math.min(1, parkRaw / PARK_TARGET);
  const assigned = clockDinos.filter((d) => d.paddock !== null && d.escapedAt === null);
  const comfort = assigned.length === 0 ? 0
    : assigned.reduce((s, d) => s + comfortAt(d, ctx.now()), 0) / assigned.length;
  const rating = Math.round(500 * (
    RATING_WEIGHTS.collection * collection + RATING_WEIGHTS.park * park + RATING_WEIGHTS.comfort * comfort));
  const highWater = Math.max(user.ratingHighWater, rating);
  ctx.db.update(schema.users).set({ parkRating: rating, ratingHighWater: highWater })
    .where(eq(schema.users.discordId, userId)).run();
  return { rating, highWater };
}
