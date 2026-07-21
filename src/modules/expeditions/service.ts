import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { EXPEDITION_SITES, type SiteDef } from '../../data/sites.js';
import { siteUnlocked } from '../park/rating.js';
import { rollRarityFromOdds, rollIntInclusive } from '../../core/rolls.js';

export class ExpeditionError extends Error {}
export type Expedition = typeof schema.expeditions.$inferSelect;
export interface Loot { eggRarity: Rarity; cash: number; food: number }

function highWater(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!.ratingHighWater;
}
export function listSites(hw: number): SiteDef[] {
  return Object.values(EXPEDITION_SITES).filter((s) => siteUnlocked(s.unlockRating, hw));
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
  const returnsAt = now + site.durationMs;
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -site.cost }, `expedition:${siteId}`, now);
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
  const eggRarity = rollRarityFromOdds(site.eggOdds, ctx.rng);
  const loot: Loot = {
    eggRarity,
    cash: rollIntInclusive(site.bonusCash[0], site.bonusCash[1], ctx.rng),
    food: rollIntInclusive(site.bonusFood[0], site.bonusFood[1], ctx.rng),
  };
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: loot.cash, food: loot.food }, `expedition-loot:${exp.siteId}`, ctx.now());
    ctx.db.insert(schema.eggs).values({
      userId, rarity: eggRarity, speciesId: null, source: 'expedition', obtainedAt: ctx.now(),
    }).run();
    ctx.db.update(schema.expeditions).set({ claimedAt: ctx.now(), loot })
      .where(eq(schema.expeditions.id, exp.id)).run();
    return { loot, site };
  });
}
