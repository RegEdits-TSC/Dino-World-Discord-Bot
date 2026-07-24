import { eq, and } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { accruedIncome, type ClockDino } from '../../core/clock.js';
import { getSpecies } from '../../data/species/index.js';
import { FACILITIES } from '../../data/facilities.js';
import { PADDOCKS } from '../../data/paddocks.js';
import { lotSlots } from '../../data/progression.js';
import { STARTER_FOOD } from '../../data/foods.js';
import { recomputeRating } from './rating.js';

export const BASE_LOT_SLOTS = 3;
export class LotLimitError extends Error {}
export class UnknownKindError extends Error {}

export type User = typeof schema.users.$inferSelect;
export type Lot = typeof schema.lots.$inferSelect;

export function getOrCreateUser(ctx: Ctx, userId: string, displayName: string): User {
  const existing = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  if (existing) return existing;
  return ctx.db.transaction(() => {
    const u = ctx.db.insert(schema.users).values({
      discordId: userId, displayName, lastCollectAt: ctx.now(), createdAt: ctx.now(),
    }).returning().get();
    for (const [foodId, qty] of Object.entries(STARTER_FOOD)) {
      ctx.db.insert(schema.foodInventory).values({ userId, foodId, qty }).run();
    }
    return u;
  });
}

export function facilityBonusPct(lots: Lot[]): number {
  return lots.filter((l) => l.type === 'facility')
    .reduce((sum, l) => sum + (FACILITIES[l.kind]?.incomeBonusPct[l.level - 1] ?? 0), 0);
}

export function capHours(lots: Lot[]): number {
  const vc = lots.find((l) => l.kind === 'visitor_center');
  return vc ? FACILITIES.visitor_center.capHours![vc.level - 1] : 8;
}

export function buildLot(ctx: Ctx, userId: string, kind: string): Lot {
  const paddock = PADDOCKS[kind]; const facility = FACILITIES[kind];
  if (!paddock && !facility) throw new UnknownKindError(kind);
  const count = ctx.db.select().from(schema.lots)
    .where(eq(schema.lots.userId, userId)).all().length;
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  if (count >= lotSlots(user.ratingHighWater)) throw new LotLimitError();
  const cost = paddock ? paddock.buildCost : facility!.buildCost;
  // Charge + insert must be atomic: EconomyService.apply commits its own transaction,
  // so without this outer transaction a failed insert after a successful charge would
  // leave the user debited with no lot to show for it.
  const lot = ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -cost }, `build:${kind}`, ctx.now());
    return ctx.db.insert(schema.lots).values({
      userId, type: paddock ? 'paddock' : 'facility', kind,
      name: paddock ? paddock.name : facility!.name,
    }).returning().get();
  });
  // Lots are 35% of park rating (see rating.ts); recompute so the dashboard and
  // ratingHighWater (which gates lot slots / sites / shop / mythic) stay current.
  recomputeRating(ctx, userId);
  return lot;
}

export function upgradeLot(ctx: Ctx, userId: string, lotId: number): Lot {
  const lot = ctx.db.select().from(schema.lots)
    .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, userId))).get();
  if (!lot) throw new UnknownKindError(String(lotId));
  const def = FACILITIES[lot.kind];
  const maxLevel = def ? def.maxLevel : 4;                       // paddock max level 4 (capacity 8)
  if (lot.level >= maxLevel) throw new LotLimitError();
  const cost = def ? def.upgradeCosts[lot.level - 1]
                   : Math.round(PADDOCKS[lot.kind].buildCost * 2.5 ** lot.level);
  // See buildLot: charge + level bump must be atomic against a failed update.
  const updated = ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -cost }, `upgrade:${lot.kind}:${lot.level + 1}`, ctx.now());
    return ctx.db.update(schema.lots).set({ level: lot.level + 1 })
      .where(eq(schema.lots.id, lotId)).returning().get();
  });
  // See buildLot: lot level is part of park rating, so recompute after mutating it.
  recomputeRating(ctx, userId);
  return updated;
}

export function toClockDinos(ctx: Ctx, userId: string): { clockDinos: ClockDino[]; lots: Lot[]; user: User; dinos: Array<typeof schema.dinos.$inferSelect> } {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get()!;
  const lots = ctx.db.select().from(schema.lots)
    .where(eq(schema.lots.userId, userId)).all();
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const dinos = ctx.db.select().from(schema.dinos)
    .where(eq(schema.dinos.userId, userId)).all();
  const clockDinos: ClockDino[] = dinos.map((d) => {
    const lot = d.lotId != null ? lotById.get(d.lotId) : undefined;
    const isPaddock = lot?.type === 'paddock';
    return {
      species: getSpecies(d.speciesId),
      paddock: isPaddock ? PADDOCKS[lot!.kind] : null,
      decor: isPaddock ? lot!.decor : [],
      hungerAtFed: d.hunger, lastFedAt: d.lastFedAt, escapedAt: d.escapedAt,
    };
  });
  return { clockDinos, lots, user, dinos };
}

export function pendingIncome(ctx: Ctx, userId: string): number {
  const { clockDinos, lots, user } = toClockDinos(ctx, userId);
  return accruedIncome(clockDinos, facilityBonusPct(lots), capHours(lots), user.lastCollectAt, ctx.now());
}

export function collectIncome(ctx: Ctx, userId: string): { amount: number } {
  const amount = pendingIncome(ctx, userId);
  if (amount > 0) {
    // See buildLot: without this, a failed lastCollectAt update after a successful
    // credit would let the same income window be collected again (money creation).
    ctx.db.transaction(() => {
      ctx.economy.apply(userId, { cash: amount }, 'collect', ctx.now());
      ctx.db.update(schema.users).set({ lastCollectAt: ctx.now() })
        .where(eq(schema.users.discordId, userId)).run();
    });
  }
  return { amount };
}
