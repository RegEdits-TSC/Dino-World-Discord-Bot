import { and, eq, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { DECOR } from '../../data/decor.js';
import { comfortAt } from '../../core/clock.js';
import { toClockDinos, type Lot } from './service.js';
import { recomputeRating } from './rating.js';

export class AssignError extends Error {}
export function paddockCapacity(level: number): number { return 2 * level; }

function ownedPaddock(ctx: Ctx, userId: string, lotId: number): Lot {
  const lot = ctx.db.select().from(schema.lots)
    .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, userId))).get();
  if (!lot) throw new AssignError('You do not own that lot.');
  if (lot.type !== 'paddock') throw new AssignError('Dinos can only go in paddocks.');
  return lot;
}

export function assignDino(ctx: Ctx, userId: string, dinoId: number, lotId: number): void {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new AssignError('You do not own that dino.');
  if (dino.escapedAt !== null) throw new AssignError('That dino has escaped — rescue it first.');
  const lot = ownedPaddock(ctx, userId, lotId);
  const occupants = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.userId, userId), eq(schema.dinos.lotId, lotId), ne(schema.dinos.id, dinoId))).all().length;
  if (occupants >= paddockCapacity(lot.level)) throw new AssignError('That paddock is full.');
  ctx.db.update(schema.dinos).set({ lotId }).where(eq(schema.dinos.id, dinoId)).run();
  recomputeRating(ctx, userId);
}

export function unassignDino(ctx: Ctx, userId: string, dinoId: number): void {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new AssignError('You do not own that dino.');
  ctx.db.update(schema.dinos).set({ lotId: null }).where(eq(schema.dinos.id, dinoId)).run();
  recomputeRating(ctx, userId);
}

export function decorateLot(ctx: Ctx, userId: string, lotId: number, decorKind: string): void {
  const lot = ownedPaddock(ctx, userId, lotId);
  const def = DECOR[decorKind];
  if (!def) throw new AssignError('Unknown decoration.');
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -def.cost }, `decorate:${decorKind}`, ctx.now());
    ctx.db.update(schema.lots).set({ decor: [...lot.decor, decorKind] })
      .where(eq(schema.lots.id, lotId)).run();
  });
  recomputeRating(ctx, userId);
}

export function listDinos(ctx: Ctx, userId: string) {
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  return dinos.map((d, i) => ({ dino: d, species: getSpecies(d.speciesId), comfort: comfortAt(clockDinos[i], ctx.now()) }));
}
