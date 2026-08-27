import { EmbedBuilder, type ActionRowBuilder, type ButtonBuilder } from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { sideEffectFor } from '../../data/tx-reasons.js';
import { RESET_MARKER_REASON, resetBoundaryOf } from './service.js';
import type { Ctx } from '../../core/context.js';

function amount(r: typeof schema.txLog.$inferSelect): string {
  if (r.foodId) return `${r.foodDelta > 0 ? '+' : ''}${r.foodDelta} ${r.foodId}`;
  const parts: string[] = [];
  if (r.cashDelta) parts.push(`${r.cashDelta > 0 ? '+' : ''}${r.cashDelta} cash`);
  if (r.shardsDelta) parts.push(`${r.shardsDelta > 0 ? '+' : ''}${r.shardsDelta} shards`);
  return parts.join(' ') || '0';
}

// A row with no negative movement is a payout — income, a grant, a reversal's own credit —
// never a charge, and "what does this leave behind" has no meaning for one. Showing the
// side-effect note there anyway is what buried the column: collect, quest, season, battle
// and every other payout reason are all absent from SIDE_EFFECTS (src/data/tx-reasons.ts),
// so every ordinary income row — collect above all, the single most frequent row in the
// table — read "unrecognised — check manually", training the operator to skip the column on
// the one row where it actually matters. A genuine debit with an unrecognised reason still
// gets the note: fail CLOSED for money actually taken, never for money paid out.
function isCharge(r: typeof schema.txLog.$inferSelect): boolean {
  return r.cashDelta < 0 || r.shardsDelta < 0 || r.foodDelta < 0;
}

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
  // view marks — see resetBoundaryOf for why they must not be two separate derivations.
  const resetAt = resetBoundaryOf(rows);

  const { items, page: p, pages } = paginate(rows, page);
  const lines = items.map((r) => {
    if (r.reason === RESET_MARKER_REASON) {
      // Rendered distinctly from an ordinary row on purpose: it moved nothing (cash and
      // shards are both 0 by construction — see adminReset), so it must never read like a
      // charge an operator might reach for /admin reverse against.
      return `\`#${r.id}\` — account reset — every row below predates it`;
    }
    if (r.reversesId !== null) {
      return `\`#${r.id}\` ↩ reverses #${r.reversesId} — ${amount(r)}${r.note ? ` · ${r.note}` : ''}`;
    }
    const marks: string[] = [];
    const by = reversedBy.get(r.id);
    if (by !== undefined) marks.push(`already reversed by #${by}`);
    if (r.createdAt < resetAt) marks.push('pre-reset');
    const tail = marks.length ? ` · **${marks.join(' · ')}**` : '';
    const note = isCharge(r) ? ` — ${sideEffectFor(r.reason)}` : '';
    return `\`#${r.id}\` \`${r.reason}\` ${amount(r)}${note}${tail}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🧾 Ledger — ${targetId}`)
    .setDescription(lines.join('\n') || 'No transactions.')
    .setFooter({ text: `Page ${p}/${pages}` });
  const components: ActionRowBuilder<ButtonBuilder>[] =
    pages > 1 ? [pageRow('admin', 'ledger', targetId, p, pages)] : [];
  return { embeds: [embed], components };
}
