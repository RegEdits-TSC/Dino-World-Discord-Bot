import { and, eq, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { DECOR } from '../../data/decor.js';
import { PADDOCKS } from '../../data/paddocks.js';
import type { Diet } from '../../data/types.js';
import { comfortAt, escapeAt, enrichmentAt } from '../../core/clock.js';
import { defangLinks } from '../../core/text.js';
import { toClockDinos, type Lot } from './service.js';
import { recomputeRating } from './rating.js';

export class AssignError extends Error {}
export class DietMismatchError extends Error {
  constructor(public speciesName: string, public dinoDiet: Diet, public paddockName: string) {
    super(`${speciesName} is a ${dinoDiet} — ${paddockName} halves its comfort: it earns less and escapes sooner.`);
  }
}
export function paddockCapacity(level: number): number { return 2 * level; }

/**
 * The two AssignError texts a caller may hand a player VERBATIM.
 *
 * Both name a condition the player can act on right now — free a slot, rescue the dino —
 * so a follow-through button that swallowed them into a generic staleness line would be
 * telling the player the wrong thing. Every other AssignError text describes an id that
 * should never have been clickable, and those DO belong behind a staleness line.
 *
 * Constants rather than literals at the throw sites because the handler that decides which
 * ones pass through compares against them: two copies of a sentence, one in a throw and one
 * in a Set, drift the first time somebody edits the wording, and nothing fails.
 */
export const PADDOCK_FULL = 'That paddock is full.';
export const DINO_ESCAPED = 'That dino has escaped — rescue it first.';

/**
 * Would `lot` take one more dino of `diet`, given `occupants` already in it?
 *
 * The ONE place the assign rule — paddock, diet match, room — is written down, because it
 * gets asked in two opposite directions and a change to either half has to move both:
 *
 *   dino fixed, lots vary  → eligiblePaddocks below, which picks the shape of the hatch
 *                            reveal's Assign control
 *   lot fixed, dinos vary  → the /build follow-through's picker, which asks this once per
 *                            candidate dino, with that dino's own diet
 *
 * Neither direction is the authority and neither may claim to be: assignDino re-reads and
 * re-checks all three conditions itself and is the only thing standing between a forged id
 * and the database.
 *
 * `lot.type === 'paddock'` MUST stay the first term. PADDOCKS is a null-prototype map, so
 * PADDOCKS[<a facility kind>] is undefined and reading .diet off it throws a TypeError
 * rather than degrading to false. Reordering these two is a crash, not a miss.
 *
 * `occupants` is the CALLER's count and is never re-read here, because the two directions
 * count differently: a dino being MOVED must be excluded from the paddock it already sits
 * in — assignDino does exactly that with ne(schema.dinos.id, dinoId) — while a picker
 * choosing among unassigned dinos has nobody to exclude.
 */
export function paddockAccepts(lot: Lot, diet: Diet, occupants: number): boolean {
  return lot.type === 'paddock'
    && PADDOCKS[lot.kind].diet === diet
    && occupants < paddockCapacity(lot.level);
}

function ownedPaddock(ctx: Ctx, userId: string, lotId: number): Lot {
  const lot = ctx.db.select().from(schema.lots)
    .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, userId))).get();
  if (!lot) throw new AssignError('You do not own that lot.');
  if (lot.type !== 'paddock') throw new AssignError('Dinos can only go in paddocks.');
  return lot;
}

export function assignDino(ctx: Ctx, userId: string, dinoId: number, lotId: number, opts: { allowMismatch?: boolean } = {}): void {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new AssignError('You do not own that dino.');
  if (dino.escapedAt !== null) throw new AssignError(DINO_ESCAPED);
  const lot = ownedPaddock(ctx, userId, lotId);
  const occupants = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.userId, userId), eq(schema.dinos.lotId, lotId), ne(schema.dinos.id, dinoId))).all().length;
  if (occupants >= paddockCapacity(lot.level)) throw new AssignError(PADDOCK_FULL);
  const species = getSpecies(dino.speciesId);
  const paddock = PADDOCKS[lot.kind];
  if (!opts.allowMismatch && paddock.diet !== species.diet)
    throw new DietMismatchError(species.name, species.diet, paddock.name);
  ctx.db.update(schema.dinos).set({ lotId }).where(eq(schema.dinos.id, dinoId)).run();
  recomputeRating(ctx, userId);
}

/**
 * The paddocks this dino could be assigned to right now, decided through paddockAccepts.
 *
 * A MINT-SIDE chooser, not a barrier: it picks which of assignRow's three shapes to mint,
 * and assignDino independently refuses everything it filters out. What it buys is that the
 * control a player is OFFERED and the rule that executes come from one definition — in
 * particular the diet term, which is what keeps an off-diet paddock off a one-press
 * follow-through at all. The wrong-habitat "Assign anyway" confirm stays reachable from
 * /dino assign only.
 *
 * Returns [] rather than throwing for a dino that is unowned, escaped, or named by a junk
 * segment: every caller is a mint site deciding which control to offer, and "offer nothing"
 * is the right answer to all three. Number('x') is NaN, which better-sqlite3 binds as a
 * legal no-match, so a forged id lands in the `!dino` arm rather than crashing.
 */
export function eligiblePaddocks(ctx: Ctx, userId: string, dinoId: number): Lot[] {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino || dino.escapedAt !== null) return [];
  const diet = getSpecies(dino.speciesId).diet;
  const lots = ctx.db.select().from(schema.lots)
    .where(eq(schema.lots.userId, userId)).all();
  const owned = ctx.db.select().from(schema.dinos)
    .where(eq(schema.dinos.userId, userId)).all();
  return lots.filter((l) => paddockAccepts(
    l, diet, owned.filter((d) => d.lotId === l.id && d.id !== dinoId).length));
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

export const MAX_NICKNAME = 32;

export function renameDino(ctx: Ctx, userId: string, dinoId: number, nickname: string | null): void {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new AssignError('You do not own that dino.');
  // Defanged between the trim and the length check, the same way setMotto is: a nickname
  // reaches public battle embeds, where `[text](url)` renders as a masked link. Defanging
  // only lengthens, so running it before the guard is what keeps MAX_NICKNAME true of what
  // is stored.
  const trimmed = defangLinks(nickname?.trim() ?? '');
  if (trimmed.length > MAX_NICKNAME) throw new AssignError(`Nicknames are at most ${MAX_NICKNAME} characters.`);
  ctx.db.update(schema.dinos).set({ nickname: trimmed === '' ? null : trimmed })
    .where(eq(schema.dinos.id, dinoId)).run();
}

export function listDinos(ctx: Ctx, userId: string) {
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  return dinos.map((d, i) => ({
    dino: d,
    species: getSpecies(d.speciesId),
    comfort: comfortAt(clockDinos[i], ctx.now()),
    enrichment: enrichmentAt(clockDinos[i]),
    escapeAt: escapeAt(clockDinos[i]),
    mismatch: clockDinos[i].paddock !== null && clockDinos[i].paddock!.diet !== clockDinos[i].species.diet,
  }));
}
