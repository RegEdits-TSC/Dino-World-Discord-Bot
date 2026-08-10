import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { LANDMARKS, landmarkFor, MAX_LANDMARK_TIER, type LandmarkDef } from '../../data/landmarks.js';

export class LandmarkMaxedError extends Error {
  // The top rung's name is read off LANDMARKS rather than retyped: nothing else pinned
  // the literal to the table, so renaming the last rung or appending a seventh would
  // have left this message naming a landmark that is no longer the top of the ladder.
  constructor() {
    super(`Your park already has the ${LANDMARKS[MAX_LANDMARK_TIER - 1].name} — there is nothing further to build.`);
  }
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
 * That is a property of THIS function, not of the surface: a buy button is a durable
 * message that nobody refreshes, so the rung it was minted for has to travel in its
 * customId and be re-checked against the live tier before this is called. Without that
 * check, one button labelled "Build Stone Marker" charged 5M, 10M, 20M and then 40M on
 * four clicks — see the landmark branch in src/modules/park/index.ts.
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
