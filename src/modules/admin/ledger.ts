import { EmbedBuilder, type ActionRowBuilder, type ButtonBuilder } from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { sideEffectFor } from '../../data/tx-reasons.js';
import type { Ctx } from '../../core/context.js';

function amount(r: typeof schema.txLog.$inferSelect): string {
  if (r.foodId) return `${r.foodDelta > 0 ? '+' : ''}${r.foodDelta} ${r.foodId}`;
  const parts: string[] = [];
  if (r.cashDelta) parts.push(`${r.cashDelta > 0 ? '+' : ''}${r.cashDelta} cash`);
  if (r.shardsDelta) parts.push(`${r.shardsDelta > 0 ? '+' : ''}${r.shardsDelta} shards`);
  return parts.join(' ') || '0';
}

// The operator's window onto tx_log. Every row for the player is listed, food rows included —
// this is the ledger, not a curated summary.
export function ledgerPayload(ctx: Ctx, targetId: string, page: number) {
  const rows = ctx.db.select().from(schema.txLog)
    .where(eq(schema.txLog.userId, targetId)).orderBy(desc(schema.txLog.id)).all();
  const reversedBy = new Map<number, number>();
  for (const r of rows) if (r.reversesId !== null) reversedBy.set(r.reversesId, r.id);
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, targetId)).get();
  const resetAt = user?.createdAt ?? 0;

  const { items, page: p, pages } = paginate(rows, page);
  const lines = items.map((r) => {
    if (r.reversesId !== null) {
      return `\`#${r.id}\` ↩ reverses #${r.reversesId} — ${amount(r)}${r.note ? ` · ${r.note}` : ''}`;
    }
    const marks: string[] = [];
    const by = reversedBy.get(r.id);
    if (by !== undefined) marks.push(`already reversed by #${by}`);
    if (r.createdAt < resetAt) marks.push('pre-reset');
    const tail = marks.length ? ` · **${marks.join(' · ')}**` : '';
    return `\`#${r.id}\` \`${r.reason}\` ${amount(r)} — ${sideEffectFor(r.reason)}${tail}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🧾 Ledger — ${targetId}`)
    .setDescription(lines.join('\n') || 'No transactions.')
    .setFooter({ text: `Page ${p}/${pages}` });
  const components: ActionRowBuilder<ButtonBuilder>[] =
    pages > 1 ? [pageRow('admin', 'ledger', targetId, p, pages)] : [];
  return { embeds: [embed], components };
}
