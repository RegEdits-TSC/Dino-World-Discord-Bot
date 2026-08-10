import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { landmarkFor, MAX_LANDMARK_TIER, type LandmarkDef } from '../../data/landmarks.js';

export class LandmarkMaxedError extends Error {
  constructor() { super('Your park already has the Titan Monument — there is nothing further to build.'); }
}

export function landmarkTierOf(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()?.landmarkTier ?? 0;
}

/** The only rung a player may buy: the one after their current tier. */
export function nextLandmark(ctx: Ctx, userId: string): LandmarkDef | null {
  return landmarkFor(landmarkTierOf(ctx, userId) + 1);
}

/**
 * Buy the next rung. There is no tier argument on purpose: the only legal purchase is the
 * next one, which is what removes the misclick surface a catalog of 5,000,000-plus objects
 * would have had — and therefore the refund path this feature does not ship.
 *
 * Charge and increment share one transaction, so a rejected charge cannot leave the tier
 * advanced. economy.apply throws InsufficientFundsError, which the caller reports.
 */
export function buyLandmark(ctx: Ctx, userId: string): LandmarkDef {
  const tier = landmarkTierOf(ctx, userId) + 1;
  const def = landmarkFor(tier);
  if (!def) throw new LandmarkMaxedError();
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -def.cost }, `landmark:${tier}`, ctx.now());
    ctx.db.update(schema.users).set({ landmarkTier: tier })
      .where(eq(schema.users.discordId, userId)).run();
  });
  return def;
}

export { MAX_LANDMARK_TIER };
