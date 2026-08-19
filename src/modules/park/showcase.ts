import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { defangLinks } from '../../core/text.js';
import type { Species } from '../../data/types.js';

/** Matches the builder's .setMaxLength(80) on /park motto. */
export const MAX_MOTTO = 80;

export class ShowcaseError extends Error {}

/** Trims, defangs, validates, stores. Blank or null clears. Returns what was stored. */
export function setMotto(ctx: Ctx, userId: string, motto: string | null): string {
  // Defanged between the trim and the length check: a motto lands in a public embed
  // description, where `[text](url)` renders as a masked link. Defanging only lengthens,
  // so running it before the guard is what keeps MAX_MOTTO true of what is stored.
  const text = defangLinks(motto?.trim() ?? '');
  if (text.length > MAX_MOTTO) throw new ShowcaseError(`Mottos are at most ${MAX_MOTTO} characters.`);
  ctx.db.update(schema.users).set({ motto: text })
    .where(eq(schema.users.discordId, userId)).run();
  return text;
}

/**
 * Feature one dino, or clear with null. Ownership is checked HERE as well as in
 * featuredFor below — two checks on purpose: this one makes featuring someone else's
 * dino a visible error rather than a silent no-op, and the read-time one handles the
 * dino changing hands afterwards, which no amount of set-time checking can prevent.
 */
export function setFeaturedDino(ctx: Ctx, userId: string, dinoId: number | null): Species | null {
  if (dinoId === null) {
    ctx.db.update(schema.users).set({ featuredDinoId: null })
      .where(eq(schema.users.discordId, userId)).run();
    return null;
  }
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new ShowcaseError('You do not own that dino.');
  ctx.db.update(schema.users).set({ featuredDinoId: dinoId })
    .where(eq(schema.users.discordId, userId)).run();
  return getSpecies(dino.speciesId);
}

/**
 * What the card renders: a display name, the species id (the art OVERRIDE key) and the
 * archetype×diet pair its art falls back to. speciesId is required, not optional — every
 * producer resolves a real dino row, and an optional field would let a call site silently
 * skip the override and always render the shared archetype art.
 */
export interface Featured { name: string; speciesId: string; archetype: string; diet: string }

/**
 * Resolve the stored id to something renderable, or null.
 *
 * A featured dino can be sold, traded away or wiped by adminReset between being set and
 * being rendered, and nothing sweeps the column — so a dangling id must read back as "no
 * feature" rather than error. Same tolerance a retired decor kind gets from
 * matchedKindCount. The stale id is deliberately left in place: clearing it here would
 * make a read path a write path.
 */
export function featuredFor(
  ctx: Ctx, user: { discordId: string; featuredDinoId: number | null },
): Featured | null {
  if (user.featuredDinoId === null) return null;
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, user.featuredDinoId), eq(schema.dinos.userId, user.discordId))).get();
  if (!dino) return null;
  const species = getSpecies(dino.speciesId);
  return { name: dino.nickname ?? species.name, speciesId: species.id, archetype: species.archetype, diet: species.diet };
}
