import { and, eq } from 'drizzle-orm';
import { schema } from './db/index.js';
import type { Ctx } from './context.js';

/**
 * Credit a player with a species. Idempotent by the composite key, so the first
 * acquisition's instant survives every later one. Lives in core, not in the dex
 * module, for the same reason track() does (src/core/stats.ts): three modules write
 * it and one reads it.
 *
 * Every call site sits inside the transaction that mints or transfers the dino — a
 * rolled-back hatch or trade must not leave a credit behind.
 */
export function recordSpeciesSeen(ctx: Ctx, userId: string, speciesId: string): void {
  ctx.db.insert(schema.speciesSeen)
    .values({ userId, speciesId, firstAt: ctx.now() })
    .onConflictDoNothing().run();
}

/**
 * The player's whole seen set, in ONE query. Batch-per-user, never per-species: the
 * dex renders 52 rows and a per-id lookup would be the N+1 the escrow locks
 * (src/core/locks.ts) exist to forbid.
 */
export function seenSpecies(ctx: Ctx, userId: string): Set<string> {
  return new Set(ctx.db.select().from(schema.speciesSeen)
    .where(eq(schema.speciesSeen.userId, userId)).all()
    .map((r) => r.speciesId));
}

export function firstSeenAt(ctx: Ctx, userId: string, speciesId: string): number | null {
  const row = ctx.db.select().from(schema.speciesSeen)
    .where(and(eq(schema.speciesSeen.userId, userId), eq(schema.speciesSeen.speciesId, speciesId)))
    .get();
  return row?.firstAt ?? null;
}
