import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { settleEscapes } from './escapes.js';
import { dashboardPayload, withParkImage } from './embeds.js';
import { buildParkSnapshot } from './snapshot.js';
import { renderPark } from '../../core/render/client.js';

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
 * Somebody else's park, read-only. Null when they have no park row at all.
 *
 * Builds its OWN components rather than filtering dashboardPayload's, because the two
 * things that must happen here pull in opposite directions: `components` must be dropped
 * (park:collect carries no user id, so a viewer clicking it would collect the CLICKER's
 * income from a message about another player) while `files` must be KEPT (the featured
 * dino's upload, or the embed holds a dangling attachment:// URL). The old
 * `const base = { embeds: payload.embeds }` in /park view did both — correctly for one,
 * silently wrong for the other.
 *
 * Settles the TARGET's escapes, which is what makes the rendered park accurate. It writes
 * nothing for the viewer — no getOrCreateUser, no row minted for a passer-by.
 */
export async function visitPayload(ctx: Ctx, targetUserId: string): Promise<VisitPayload | null> {
  const exists = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, targetUserId)).get();
  if (!exists) return null;
  settleEscapes(ctx, targetUserId);
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, targetUserId)).get()!;
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, targetUserId)).all();
  const escaped = dinos.filter((d) => d.escapedAt !== null).length;
  // Minimal fixup for the Task 2 signature change only — this call renders the Park tab
  // alone and drops the Food/Attendance/Achievements/Legacy/Seasons/Featured content this
  // function used to assemble. Task 8 rewrites visitPayload to walk all four tabs; do not
  // expand this further in the meantime.
  const built = dashboardPayload(user, 0, {
    attention: escaped,
    motto: user.motto,
    now: ctx.now(),
    dinoCount: dinos.length,
    visit: true,
  });
  const payload: VisitPayload = { embeds: built.embeds, components: [] };
  if (built.files) payload.files = built.files;
  const next = nextInRing(ctx, targetUserId);
  if (next) {
    // The customId carries the park to go TO, not the one on screen — so the handler
    // renders parts[2] directly and mints the next hop from there. No owner id: this is
    // public and read-only, and the segment is a target, never an owner.
    payload.components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`park:tour:${next}`)
        .setLabel('Next park ▶').setStyle(ButtonStyle.Secondary),
    ));
  }
  let png: Buffer | undefined;
  try { png = await renderPark(buildParkSnapshot(ctx, targetUserId)); } catch { png = undefined; }
  return png ? withParkImage(payload, png) : payload;
}
