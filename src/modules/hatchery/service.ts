import { and, eq, isNotNull } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Species } from '../../data/types.js';
import { RARITY } from '../../data/rarity.js';
import { FACILITIES } from '../../data/facilities.js';
import { getSpecies } from '../../data/species/index.js';
import { rollSpeciesInRarity } from '../../core/rolls.js';
import { locksFor } from '../../core/locks.js';
import { recomputeRating } from '../park/rating.js';
import { facilityLevel, type Lot } from '../park/service.js';

export class HatcheryError extends Error {}
export type Egg = typeof schema.eggs.$inferSelect;

export function incubatorSlots(lots: Lot[]): number {
  const level = facilityLevel(lots, 'hatchery_lab');
  return level > 0 ? FACILITIES.hatchery_lab.incubatorSlots![level - 1] : 1;
}

export function incubatingCount(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.eggs)
    .where(and(eq(schema.eggs.userId, userId), isNotNull(schema.eggs.incubationStartedAt))).all().length;
}

export function incubateEgg(ctx: Ctx, userId: string, eggId: number, guildId: string | null): Egg {
  const egg = ctx.db.select().from(schema.eggs)
    .where(and(eq(schema.eggs.id, eggId), eq(schema.eggs.userId, userId))).get();
  if (!egg) throw new HatcheryError('You do not own that egg.');
  // Trade escrow: hatching CONSUMES the egg, so unlike battling a locked dino
  // (src/modules/battles/service.ts) it would make the pending trade unfulfillable.
  if (locksFor(ctx, userId).eggs.has(eggId)) throw new HatcheryError('That egg is locked in a pending trade.');
  if (egg.incubationStartedAt !== null) throw new HatcheryError('That egg is already incubating.');
  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, userId)).all();
  if (incubatingCount(ctx, userId) >= incubatorSlots(lots))
    throw new HatcheryError('All incubator slots are full. Upgrade the Hatchery Lab for more.');
  const now = ctx.now();
  const hatchesAt = now + RARITY[egg.rarity].incubationMs;
  ctx.db.update(schema.eggs).set({ incubationStartedAt: now, hatchesAt })
    .where(eq(schema.eggs.id, eggId)).run();
  ctx.scheduler.enqueue({ kind: 'egg_hatch', userId, refId: eggId, originGuildId: guildId, firesAt: hatchesAt });
  return { ...egg, incubationStartedAt: now, hatchesAt };
}

export function hatchEgg(ctx: Ctx, userId: string, eggId: number): { species: Species; dinoId: number } {
  const egg = ctx.db.select().from(schema.eggs)
    .where(and(eq(schema.eggs.id, eggId), eq(schema.eggs.userId, userId))).get();
  if (!egg) throw new HatcheryError('You do not own that egg.');
  if (locksFor(ctx, userId).eggs.has(eggId)) throw new HatcheryError('That egg is locked in a pending trade.');
  if (egg.incubationStartedAt === null || egg.hatchesAt === null) throw new HatcheryError('That egg is not incubating.');
  if (egg.hatchesAt > ctx.now()) throw new HatcheryError('That egg is not ready to hatch yet.');
  const species = egg.speciesId ? getSpecies(egg.speciesId) : rollSpeciesInRarity(egg.rarity, ctx.rng);
  const dinoId = ctx.db.transaction(() => {
    const dino = ctx.db.insert(schema.dinos).values({
      userId, lotId: null, speciesId: species.id, hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      // Provenance survives the hatch: without this the dino takes the column default and a
      // traded egg launders into a full-shard sale, reopening the alt-to-main funnel that
      // moveItems (src/modules/trading/service.ts) closes for dinos.
      viaTrade: egg.viaTrade,
    }).returning().get();
    ctx.db.delete(schema.eggs).where(eq(schema.eggs.id, eggId)).run();
    return dino.id;
  });
  recomputeRating(ctx, userId);
  return { species, dinoId };
}
