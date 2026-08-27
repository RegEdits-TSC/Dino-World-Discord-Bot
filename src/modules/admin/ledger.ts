import { EmbedBuilder, type ActionRowBuilder, type ButtonBuilder } from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { RESET_MARKER_REASON, movementOf, resetBoundaryOf, sideEffectNoteFor } from './service.js';
import type { Ctx } from '../../core/context.js';

// The operator's window onto tx_log. Every row for the player is listed, food rows included —
// this is the ledger, not a curated summary.
export function ledgerPayload(ctx: Ctx, targetId: string, page: number) {
  const rows = ctx.db.select().from(schema.txLog)
    .where(eq(schema.txLog.userId, targetId)).orderBy(desc(schema.txLog.id)).all();
  const reversedBy = new Map<number, number>();
  for (const r of rows) if (r.reversesId !== null) reversedBy.set(r.reversesId, r.id);
  // The reset boundary is the newest admin:reset marker row (adminReset writes one, in the
  // same transaction as the rest of the reset — src/modules/admin/service.ts) — never
  // users.createdAt: adminReset only ever UPDATEs the users row and never touches createdAt,
  // which means account CREATION, so a boundary derived from that column could never move
  // and could never fire. Derived from the full row set, not the paginated page below: a
  // reset many pages back must still mark an old charge on whichever page it's viewed from.
  // The reduction itself is shared with adminReverse, which refuses to reverse anything this
  // view marks — see resetBoundaryOf for why they must not be two separate derivations, why
  // the cut is the row ID rather than its timestamp, and what a 0 cannot tell you.
  const resetBoundary = resetBoundaryOf(rows);

  const { items, page: p, pages } = paginate(rows, page);
  const lines = items.map((r) => {
    if (r.reason === RESET_MARKER_REASON) {
      // Rendered distinctly from an ordinary row on purpose: it moved nothing (cash and
      // shards are both 0 by construction — see adminReset), so it must never read like a
      // charge an operator might reach for /admin reverse against.
      return `\`#${r.id}\` — account reset — every row below predates it`;
    }
    if (r.reversesId !== null) {
      return `\`#${r.id}\` ↩ reverses #${r.reversesId} — ${movementOf(r)}${r.note ? ` · ${r.note}` : ''}`;
    }
    const marks: string[] = [];
    const by = reversedBy.get(r.id);
    if (by !== undefined) marks.push(`already reversed by #${by}`);
    if (r.id < resetBoundary) marks.push('pre-reset');
    const tail = marks.length ? ` · **${marks.join(' · ')}**` : '';
    // Never re-derived here: sideEffectNoteFor is what adminReverse's reply prints for the
    // same row, and the two disagreeing once is why it is shared at all. movementOf is shared
    // with that same reply for the same reason.
    const effect = sideEffectNoteFor(r);
    const note = effect ? ` — ${effect}` : '';
    return `\`#${r.id}\` \`${r.reason}\` ${movementOf(r)}${note}${tail}`;
  });

  // Named as well as numbered: a bare snowflake is not something an operator can check a
  // refund against. The id stays alongside it, the shape /admin inspect already uses.
  const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, targetId)).get();
  const who = u?.displayName ? `${u.displayName} (${targetId})` : targetId;
  const embed = new EmbedBuilder()
    .setTitle(`🧾 Ledger — ${who}`)
    .setDescription(lines.join('\n') || 'No transactions.')
    .setFooter({ text: `Page ${p}/${pages}` });
  const components: ActionRowBuilder<ButtonBuilder>[] =
    pages > 1 ? [pageRow('admin', 'ledger', targetId, p, pages)] : [];
  return { embeds: [embed], components };
}
