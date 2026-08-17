import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { track } from '../../core/stats.js';
import { levelValue } from '../park/service.js';
import { recomputeRating } from '../park/rating.js';
import { ATTRACTIONS, attractionFor, type AttractionDef } from '../../data/attractions.js';
export class UnknownAttractionError extends Error {}
/** Carries the attraction's display name so the caller can name it. */
export class AttractionLockedError extends Error {}
export class DuplicateAttractionError extends Error {}
export class AttractionMaxedError extends Error {}

export function attractionRows(ctx: Ctx, userId: string) {
  return ctx.db.select().from(schema.attractions)
    .where(eq(schema.attractions.userId, userId)).all();
}

function highWaterOf(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get()?.attendanceHighWater ?? 0;
}

/**
 * Build one attraction. Charge and insert share an outer transaction because
 * ctx.economy.apply commits its own — without it a failed insert after a successful
 * charge leaves the player debited with nothing. track() sits inside that same
 * transaction so a rolled-back build never counts.
 */
export function buildAttraction(ctx: Ctx, userId: string, kind: string): AttractionDef {
  const def = attractionFor(kind);
  if (!def) throw new UnknownAttractionError(kind);
  const highWater = highWaterOf(ctx, userId);
  if (highWater < def.unlockAt) throw new AttractionLockedError(def.name);
  const rows = attractionRows(ctx, userId);
  // Each kind is buildable once, and its own unlockAt is the only gate — there is no
  // separate slot pool. A slot ladder on the same high-water would have been a second
  // table to keep in lockstep, and its check could never fire.
  if (rows.some((r) => r.kind === kind)) throw new DuplicateAttractionError(def.name);

  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -def.buildCost }, `attraction:${kind}`, ctx.now());
    ctx.db.insert(schema.attractions)
      .values({ userId, kind, level: 1, builtAt: ctx.now() }).run();
    track(ctx, userId, 'attractions_built', 1);
  });
  // Attractions feed attendance, so the high-water must move in the same action.
  recomputeRating(ctx, userId);
  return def;
}

export function upgradeAttraction(ctx: Ctx, userId: string, kind: string): { def: AttractionDef; level: number } {
  const def = attractionFor(kind);
  if (!def) throw new UnknownAttractionError(kind);
  const row = ctx.db.select().from(schema.attractions)
    .where(and(eq(schema.attractions.userId, userId), eq(schema.attractions.kind, kind))).get();
  if (!row) throw new UnknownAttractionError(kind);
  if (row.level >= def.maxLevel) throw new AttractionMaxedError(def.name);
  // levelValue, never a raw index: upgradeCosts is a per-level array like every other.
  const cost = levelValue(def.upgradeCosts, row.level, 0);
  const level = row.level + 1;

  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -cost }, `attraction:${kind}:${level}`, ctx.now());
    ctx.db.update(schema.attractions).set({ level })
      .where(eq(schema.attractions.id, row.id)).run();
  });
  recomputeRating(ctx, userId);
  return { def, level };
}

/** Every kind the player could build right now, for the catalog embed and autocomplete. */
export function buildableKinds(ctx: Ctx, userId: string): AttractionDef[] {
  const highWater = highWaterOf(ctx, userId);
  const owned = new Set(attractionRows(ctx, userId).map((r) => r.kind));
  return Object.values(ATTRACTIONS).filter((d) => highWater >= d.unlockAt && !owned.has(d.kind));
}
