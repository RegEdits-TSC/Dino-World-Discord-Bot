import { and, eq, isNotNull } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Species } from '../../data/types.js';
import { RARITY } from '../../data/rarity.js';
import { FACILITIES } from '../../data/facilities.js';
import { getSpecies } from '../../data/species/index.js';
import { rollSpeciesInRarity } from '../../core/rolls.js';
import { rollTraits } from '../../data/traits.js';
import { locksFor } from '../../core/locks.js';
import { eventMods } from '../../core/world.js';
import { recomputeRating } from '../park/rating.js';
import { facilityLevel, levelValue, type Lot } from '../park/service.js';
import { track } from '../../core/stats.js';
import { recordSpeciesSeen } from '../../core/species-seen.js';

export class HatcheryError extends Error {}
export type Egg = typeof schema.eggs.$inferSelect;

export function incubatorSlots(lots: Lot[]): number {
  return levelValue(FACILITIES.hatchery_lab.incubatorSlots, facilityLevel(lots, 'hatchery_lab'), 1);
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
  track(ctx, userId, 'eggs_incubated', 1);
  ctx.scheduler.enqueue({ kind: 'egg_hatch', userId, refId: eggId, originGuildId: guildId, firesAt: hatchesAt });
  return { ...egg, incubationStartedAt: now, hatchesAt };
}

export function hatchEgg(ctx: Ctx, userId: string, eggId: number): { species: Species; dinoId: number; traits: string[] } {
  const egg = ctx.db.select().from(schema.eggs)
    .where(and(eq(schema.eggs.id, eggId), eq(schema.eggs.userId, userId))).get();
  if (!egg) throw new HatcheryError('You do not own that egg.');
  if (locksFor(ctx, userId).eggs.has(eggId)) throw new HatcheryError('That egg is locked in a pending trade.');
  if (egg.incubationStartedAt === null || egg.hatchesAt === null) throw new HatcheryError('That egg is not incubating.');
  if (egg.hatchesAt > ctx.now()) throw new HatcheryError('That egg is not ready to hatch yet.');
  const species = egg.speciesId ? getSpecies(egg.speciesId) : rollSpeciesInRarity(egg.rarity, ctx.rng);
  // A bred egg's inheritance was rolled at /breed claim and is authoritative,
  // INCLUDING when it came out empty — BRED_SLOT_ODDS gives 0 traits 25% of the
  // time, and re-rolling those on wild odds would silently replace the bred
  // distribution with [13.75%, 53.75%, 32.5%]. `source` is the discriminator, not
  // `traits.length`: breeding is the only writer of eggs.traits, and a trade moves
  // an egg without touching either column, so it survives changing hands.
  // Migration Season only ever touches a WILD roll: passing `undefined` on every
  // other day keeps rollTraits' own WILD_SLOT_ODDS default, so rng consumption on
  // a calm day is byte-identical to before this event existed (tests/hatchery.test.ts's
  // seeded ['fleet', 'prodigy'] replay pins this).
  const traits = egg.source === 'breeding' ? egg.traits
    : rollTraits(ctx.rng, eventMods(ctx.now()).hatchTraitOdds ?? undefined);
  const dinoId = ctx.db.transaction(() => {
    const dino = ctx.db.insert(schema.dinos).values({
      userId, lotId: null, speciesId: species.id, hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      // Provenance survives the hatch: without this the dino takes the column default and a
      // traded egg launders into a full-shard sale, reopening the alt-to-main funnel that
      // moveItems (src/modules/trading/service.ts) closes for dinos.
      viaTrade: egg.viaTrade,
      traits,
    }).returning().get();
    ctx.db.delete(schema.eggs).where(eq(schema.eggs.id, eggId)).run();
    track(ctx, userId, 'eggs_hatched', 1);
    // Inside the transaction on purpose: a rolled-back hatch must not credit the dex.
    recordSpeciesSeen(ctx, userId, species.id);
    return dino.id;
  });
  recomputeRating(ctx, userId);
  return { species, dinoId, traits };
}
