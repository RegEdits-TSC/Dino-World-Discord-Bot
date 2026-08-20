import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { settleEscapes } from './escapes.js';
import { dashboardPayload, withParkImage } from './embeds.js';
import { buildParkSnapshot } from './snapshot.js';
import { renderPark } from '../../core/render/client.js';
import { toClockDinos, needsAttentionCount } from './service.js';

export interface VisitPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}

/**
 * Every park worth visiting, best rating first, discordId as the tiebreak so the order is
 * TOTAL and stable between clicks — `scored()` deliberately has no tiebreak, but a tour
 * that reorders mid-walk would revisit and skip parks, so this one does.
 *
 * parkRating > 0 filters out anyone who ran one command and left: a tour must never land
 * on an empty lot.
 */
export function tourRing(ctx: Ctx): string[] {
  return ctx.db.select().from(schema.users).all()
    .filter((u) => u.parkRating > 0)
    .sort((a, b) => b.parkRating - a.parkRating
      || (a.discordId < b.discordId ? -1 : a.discordId > b.discordId ? 1 : 0))
    .map((u) => u.discordId);
}

/** The next park after `afterUserId`, wrapping at the end. Null when the ring is empty. */
export function nextInRing(ctx: Ctx, afterUserId: string): string | null {
  const ring = tourRing(ctx);
  if (!ring.length) return null;
  const idx = ring.indexOf(afterUserId);
  // A park that has LEFT the ring (rating dropped, adminReset) has no position, and a
  // button minted for it can still be live on an old message — so restart at the top
  // rather than dead-ending.
  return idx === -1 ? ring[0] : ring[(idx + 1) % ring.length];
}

/**
 * The "keep touring" row. Null when the ring has no next member to offer (an empty ring —
 * `nextInRing` never returns null just because `targetUserId` is the ring's only member, it
 * wraps to itself instead).
 *
 * The customId carries the park to go TO, not the one on screen — so the park:tour handler
 * renders that id directly and mints the next hop from there. No owner id: this is public
 * and read-only, and the segment is a target, never an owner.
 *
 * Shared by visitPayload (the initial park:tour hop) and renderTab's visit branches
 * (src/modules/park/index.ts, every tab switch on a visited card) so this button survives
 * navigation instead of dead-ending the tour the first time a visitor clicks a tab — that
 * was a real gap: renderTab replaces `components` wholesale on every branch and, before
 * this existed, never re-minted this row.
 */
export function nextParkRow(ctx: Ctx, targetUserId: string): ActionRowBuilder<ButtonBuilder> | null {
  const next = nextInRing(ctx, targetUserId);
  if (!next) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`park:tour:${next}`)
      .setLabel('Next park ▶').setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Somebody else's park, read-only — the Park tab, rendered with `visit: true`. Null when
 * they have no park row at all.
 *
 * Renders via dashboardPayload directly rather than hand-building a payload, because
 * `visit: true` already resolves both things that must happen here: it suppresses
 * park:collect at the source (that button carries no user id, so a viewer clicking it
 * would collect the CLICKER's income from a message about another player) while still
 * minting the tab row under the `park:vtab:<targetUserId>:<tab>` family, so a visitor can
 * navigate to the other three tabs. The old hand-built `components: []` dropped both —
 * correctly for Collect, silently wrong for the tab row.
 *
 * Settles the TARGET's escapes, which is what makes the rendered park accurate. It writes
 * nothing for the viewer — no getOrCreateUser, no row minted for a passer-by.
 */
export async function visitPayload(ctx: Ctx, targetUserId: string): Promise<VisitPayload | null> {
  const exists = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, targetUserId)).get();
  if (!exists) return null;
  settleEscapes(ctx, targetUserId);
  const { clockDinos, user, dinos } = toClockDinos(ctx, targetUserId);
  const nowMs = ctx.now();
  const escaped = dinos.filter((d) => d.escapedAt !== null).length;
  // needsAttentionCount is the SAME shared computation renderTab's Park tab (and /park
  // view's own execute path) use — see its doc comment in service.ts — not a second copy,
  // so a visited card's attention marker reads the same number whether it was reached via
  // park:tour or park:vtab:<target>:park. They disagreed before this (this function
  // counted escaped dinos only), which is the same two-copies-drifting defect class this
  // repo already paid a fix round for once elsewhere.
  const attention = escaped + needsAttentionCount(clockDinos, nowMs);
  const built = dashboardPayload(user, 0, {
    motto: user.motto, now: nowMs, dinoCount: dinos.length,
    attention, visit: true,
  });
  // components come straight from the builder now: `visit: true` suppresses park:collect
  // at the source rather than filtering it out here, and the tab row must survive so a
  // visitor can navigate. The old hand-built `components: []` would strip both.
  const payload: VisitPayload = { embeds: built.embeds, components: built.components };
  if (built.files) payload.files = built.files;
  const next = nextParkRow(ctx, targetUserId);
  if (next) payload.components.push(next);
  let png: Buffer | undefined;
  try { png = await renderPark(buildParkSnapshot(ctx, targetUserId)); } catch { png = undefined; }
  return png ? withParkImage(payload, png) : payload;
}
