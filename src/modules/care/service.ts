import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Species } from '../../data/types.js';
import { RARITY } from '../../data/rarity.js';
import { getSpecies } from '../../data/species/index.js';
import { hungerAt, paddockFit } from '../../core/clock.js';
import { toClockDinos } from '../park/service.js';
import { recomputeRating } from '../park/rating.js';
import { PADDOCKS } from '../../data/paddocks.js';
import { RECAPTURE_FEE_HOURS } from '../../data/care.js';

export class CareError extends Error {}

export function feedDino(ctx: Ctx, userId: string, dinoId: number): { species: Species; cost: number } {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new CareError('You do not own that dino.');
  if (dino.escapedAt !== null) throw new CareError('That dino has escaped — rescue it first.');
  const species = getSpecies(dino.speciesId);
  const cost = RARITY[species.rarity].feedCost;
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { food: -cost }, `feed:${species.id}`, ctx.now());
    ctx.db.update(schema.dinos).set({ hunger: 100, lastFedAt: ctx.now() })
      .where(eq(schema.dinos.id, dinoId)).run();
  });
  recomputeRating(ctx, userId);
  return { species, cost };
}

export function feedAll(ctx: Ctx, userId: string): { fed: number[]; skipped: number[] } {
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  const candidates = dinos
    .map((d, i) => ({ id: d.id, species: clockDinos[i].species, hunger: hungerAt(d.hunger, d.lastFedAt, ctx.now()), escaped: d.escapedAt !== null }))
    .filter((c) => !c.escaped && c.hunger < 100)
    .sort((a, b) => a.hunger - b.hunger);                // hungriest first
  const fed: number[] = []; const skipped: number[] = [];
  for (const c of candidates) {
    const cost = RARITY[c.species.rarity].feedCost;
    const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
    if (user.food < cost) { skipped.push(c.id); continue; }
    ctx.db.transaction(() => {
      ctx.economy.apply(userId, { food: -cost }, `feed:${c.species.id}`, ctx.now());
      ctx.db.update(schema.dinos).set({ hunger: 100, lastFedAt: ctx.now() })
        .where(eq(schema.dinos.id, c.id)).run();
    });
    fed.push(c.id);
  }
  if (fed.length) recomputeRating(ctx, userId);
  return { fed, skipped };
}

export function rescueDino(ctx: Ctx, userId: string, dinoId: number): { fee: number; species: Species } {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new CareError('You do not own that dino.');
  if (dino.escapedAt === null) throw new CareError('That dino has not escaped.');
  const species = getSpecies(dino.speciesId);
  const lot = dino.lotId != null
    ? ctx.db.select().from(schema.lots).where(eq(schema.lots.id, dino.lotId)).get() : undefined;
  // Escaped dinos always have a paddock (unassigned dinos never escape); the 0.5
  // fallback is defensive only, in case that invariant is ever violated.
  const fit = lot && lot.type === 'paddock' ? paddockFit(species, PADDOCKS[lot.kind], lot.decor) : 0.5;
  const fee = RECAPTURE_FEE_HOURS * RARITY[species.rarity].incomePerHr;
  const newHunger = Math.min(100, Math.round(50 / fit));   // comfort re-evaluates to ~0.5 (spec §3.4)
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -fee }, `rescue:${species.id}`, ctx.now());
    ctx.db.update(schema.dinos).set({ hunger: newHunger, lastFedAt: ctx.now(), escapedAt: null })
      .where(eq(schema.dinos.id, dinoId)).run();
  });
  recomputeRating(ctx, userId);
  return { fee, species };
}
