import { eq, and } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { accruedIncome, escapeAt, ESCAPE_WARN_MS, type ClockDino } from '../../core/clock.js';
import { getSpecies } from '../../data/species/index.js';
import { FACILITIES } from '../../data/facilities.js';
import { PADDOCKS } from '../../data/paddocks.js';
import { lotSlots } from '../../data/progression.js';
import { STARTER_FOOD } from '../../data/foods.js';
import { recomputeRating } from './rating.js';
import { track } from '../../core/stats.js';

export const BASE_LOT_SLOTS = 3;
export class LotLimitError extends Error {}
export class UnknownKindError extends Error {}
// Carries the facility's display name as its message so /build can name it in the reply.
// LotLimitError has no message, which is why its text is hardcoded at the call site.
export class DuplicateFacilityError extends Error {}

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

// Best row per kind. buildLot now blocks new duplicates, but rows that predate that block
// still exist on live databases, and `find` resolved them to whichever the unordered SELECT
// returned first — usually the lowest id, i.e. the one the player did NOT upgrade.
// Returns 0 when the kind is absent; callers branch on that rather than indexing with a
// computed maximum, because Math.max() of an empty list is -Infinity and neither level
// table guards its index.
export function facilityLevel(lots: Lot[], kind: string): number {
  return lots.reduce((best, l) => (l.kind === kind && l.level > best ? l.level : best), 0);
}

/**
 * Read a per-level facility array safely. `level` is 1-based; 0 means "absent" and takes
 * the fallback. A level ABOVE the array clamps to its top entry rather than reading
 * undefined — the safe direction, because `undefined` does not throw here, it silently
 * disables the thing being read: `count >= undefined` is false (no incubation cap at all),
 * and `from + undefined` is NaN (no income, and a literal "Collect NaN" button). Neither
 * npm test nor npm run typecheck can see that class of bug; tsconfig has strict but not
 * noUncheckedIndexedAccess.
 */
export function levelValue(table: number[] | undefined, level: number, fallback: number): number {
  if (level <= 0 || !table || table.length === 0) return fallback;
  return table[Math.min(level, table.length) - 1] ?? fallback;
}

// Routed through levelValue like capHours/incubatorSlots/breedingSlots, so every per-level
// facility array in the codebase resolves the same way. It kept its own inline `?? 0` for a
// while, which was safe (a bonus of 0 cannot make NaN) but differed in its out-of-range
// semantics: a level above the array silently zeroed the whole facility's contribution.
// levelValue clamps to the top entry instead — chosen deliberately, because a level past the
// array's end means the array is stale, and paying the top bonus is the direction that does
// not quietly cut income for a player who legitimately upgraded.
export function facilityBonusPct(lots: Lot[]): number {
  return Object.keys(FACILITIES).reduce(
    (sum, kind) => sum + levelValue(FACILITIES[kind].incomeBonusPct, facilityLevel(lots, kind), 0), 0);
}

export function capHours(lots: Lot[]): number {
  return levelValue(FACILITIES.visitor_center.capHours, facilityLevel(lots, 'visitor_center'), 8);
}

// Returns 0 without a Gene Lab, unlike capHours/incubatorSlots: there is no free
// breeding slot the way every park gets a free incubator.
export function breedingSlots(lots: Lot[]): number {
  return levelValue(FACILITIES.gene_lab.breedingSlots, facilityLevel(lots, 'gene_lab'), 0);
}

export function buildLot(ctx: Ctx, userId: string, kind: string): Lot {
  const paddock = PADDOCKS[kind]; const facility = FACILITIES[kind];
  if (!paddock && !facility) throw new UnknownKindError(kind);
  const lots = ctx.db.select().from(schema.lots)
    .where(eq(schema.lots.userId, userId)).all();
  // One facility per kind. capHours/incubatorSlots/facilityBonusPct each resolve a kind
  // to its best row, so a second one costs cash and changes nothing. Paddocks are exempt:
  // building more of one kind IS the capacity progression.
  // Checked before the slot cap: with 3 base slots and 4 facility kinds a player who owns
  // all four is already capped, and naming the facility is the more actionable message.
  if (facility && lots.some((l) => l.kind === kind)) throw new DuplicateFacilityError(facility.name);
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  if (lots.length >= lotSlots(user.ratingHighWater)) throw new LotLimitError();
  const cost = paddock ? paddock.buildCost : facility!.buildCost;
  // Charge + insert must be atomic: EconomyService.apply commits its own transaction,
  // so without this outer transaction a failed insert after a successful charge would
  // leave the user debited with no lot to show for it.
  const lot = ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -cost }, `build:${kind}`, ctx.now());
    const built = ctx.db.insert(schema.lots).values({
      userId, type: paddock ? 'paddock' : 'facility', kind,
      name: paddock ? paddock.name : facility!.name,
    }).returning().get();
    track(ctx, userId, 'lots_built', 1);
    return built;
  });
  // Lots are 35% of park rating (see rating.ts); recompute so the dashboard and
  // ratingHighWater (which gates lot slots / sites / shop / mythic) stay current.
  recomputeRating(ctx, userId);
  return lot;
}

/**
 * Cost to take `kind` from `level` to `level + 1`. One helper so the autocomplete label,
 * the failure message and the actual charge cannot disagree — the same rule the shop's
 * price helpers follow. Bounds-guarded through levelValue for the same reason capHours is.
 */
export function upgradeCostFor(kind: string, level: number): number {
  const def = FACILITIES[kind];
  if (def) return levelValue(def.upgradeCosts, level, def.upgradeCosts[def.upgradeCosts.length - 1] ?? 0);
  return Math.round(PADDOCKS[kind].buildCost * 2.5 ** level);
}

export function upgradeLot(ctx: Ctx, userId: string, lotId: number): Lot {
  const lot = ctx.db.select().from(schema.lots)
    .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, userId))).get();
  if (!lot) throw new UnknownKindError(String(lotId));
  const def = FACILITIES[lot.kind];
  const maxLevel = def ? def.maxLevel : 4;                       // paddock max level 4 (capacity 8)
  if (lot.level >= maxLevel) throw new LotLimitError();
  const cost = upgradeCostFor(lot.kind, lot.level);
  // See buildLot: charge + level bump must be atomic against a failed update.
  const updated = ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -cost }, `upgrade:${lot.kind}:${lot.level + 1}`, ctx.now());
    const bumped = ctx.db.update(schema.lots).set({ level: lot.level + 1 })
      .where(eq(schema.lots.id, lotId)).returning().get();
    track(ctx, userId, 'lots_upgraded', 1);
    return bumped;
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
      traits: d.traits,
    };
  });
  return { clockDinos, lots, user, dinos };
}

/**
 * Counts DISTINCT dinos needing attention — at risk of escape or in the wrong habitat — as
 * a single pass over clockDinos, never a sum of the two predicates: a dino can trip both (an
 * off-diet paddock is paddockFit 0.5, which is exactly what pulls escapeAt into the warning
 * window), and summing them separately would double-count it.
 *
 * The one shared definition for the /park view command's own execute path
 * (src/modules/park/index.ts), `renderTab`'s Park tab (same file) and `visitPayload`
 * (src/modules/park/visit.ts), so a park's attention marker reads the same number no
 * matter which of the three rendered it. The latter two disagreed before this existed
 * (visitPayload counted escaped dinos only) — exactly the kind of two-copies-drifting
 * defect this repo already paid a fix round for once. Do not inline a copy of this filter
 * anywhere; import this instead.
 */
export function needsAttentionCount(clockDinos: ClockDino[], nowMs: number): number {
  return clockDinos.filter((c) => {
    if (c.escapedAt !== null) return false;
    const e = escapeAt(c);
    const atRisk = e !== null && e - nowMs <= ESCAPE_WARN_MS;
    const mismatch = c.paddock !== null && c.paddock.diet !== c.species.diet;
    return atRisk || mismatch;
  }).length;
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
      track(ctx, userId, 'income_collected', amount);
      track(ctx, userId, 'income_collections', 1);
    });
  }
  return { amount };
}
