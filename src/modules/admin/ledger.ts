import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { paginate } from '../../core/paginate.js';
import {
  RESET_MARKER_REASON, movedNothing, movementOf, resetBoundaryOf, sideEffectNoteFor,
} from './service.js';
import type { Ctx } from '../../core/context.js';

/** The page-button slug that turns zero-movement rows back on. Never anything else. */
const SHOW_ALL_SLUG = 'all';
/** The page-button slug for the default, filtered view. Never a real setting. */
const HIDE_SLUG = '-';

/**
 * Read the show-all flag back out of a page button's customId.
 *
 * Everything after the prefix is CLIENT-supplied, so this recognises exactly one literal and
 * degrades everything else — the absent-slug placeholder, a stale id from an older deploy, a
 * forged value, an absent segment — to the DEFAULT, which hides. Degrading toward hiding is
 * the safe direction: the footer then says rows are hidden and the operator can ask for them,
 * whereas degrading toward showing would silently drop the filter the button was minted with.
 * Same discipline as parseDexFilters (src/modules/dex/service.ts).
 */
export function parseShowAll(raw?: string): boolean {
  return raw === SHOW_ALL_SLUG;
}

/**
 * The ledger's own page row: `admin:ledger:<targetId>:<page>:<all|->`.
 *
 * Built here rather than through the shared `pageRow` (src/core/paginate.ts) because that
 * customId is `<prefix>:<action>:<userId>:<page>` and has nowhere to put filter state — and
 * paging a FILTERED list without it silently returns the UNFILTERED page: wrong rows, wrong
 * count, no error. That defect already shipped once on /dex list, which is why `dexPageRow`
 * (src/modules/dex/embeds.ts) exists; teaching `pageRow` about a ledger flag would push an
 * admin concern onto its four other callers (`ach`, `hatch`, `park:dinos`, `trade:list`), so
 * the format lives beside the payload that reads it back, exactly as the dex's does.
 *
 * Worst case is 39 of Discord's 100 customId characters: 'admin:ledger:' (13) + a 19-digit
 * snowflake + ':' + a 3-digit page + ':all'. The harness validates every payload's custom_id
 * length anyway.
 */
function ledgerPageRow(targetId: string, page: number, pages: number, showAll: boolean) {
  const slug = showAll ? SHOW_ALL_SLUG : HIDE_SLUG;
  const id = (p: number) => `admin:ledger:${targetId}:${p}:${slug}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(id(page - 1)).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(id(page + 1)).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages),
  );
}

// The operator's window onto tx_log.
//
// Rows that moved NOTHING are hidden unless showAll is set. They are not noise in the abstract:
// on the live table 112 of 173 rows were these, because every feed writes a zero-delta base row
// alongside its food row — so page one of a real ledger was almost entirely 'no movement' and
// the charges an operator opens this view to find sat pages back. Hiding them costs nothing,
// because there is nothing to be gained by reversing one: it moves no money AND permanently
// consumes that row's single reversal. It is a DISPLAY choice and only that — /admin reverse
// still accepts a hidden row's id if the operator types it.
export function ledgerPayload(ctx: Ctx, targetId: string, page: number, showAll = false) {
  const rows = ctx.db.select().from(schema.txLog)
    .where(eq(schema.txLog.userId, targetId)).orderBy(desc(schema.txLog.id)).all();
  // Both derivations below run over the FULL row set and must keep doing so, whatever the
  // filter or the page hides. Narrowing this map to the rendered rows is the subtle failure:
  // a charge whose compensating row is filtered out (or simply sits on another page) would
  // then read as UN-reversed, and the operator's next move on a charge that reads that way is
  // to reverse it — the second reversal is refused by EconomyService, but only after they have
  // already decided the player is owed money.
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

  // The marker takes its own branch here for the same reason it takes one in the renderer
  // below: it is zero-delta by construction, so the movement test would hide it, and it is a
  // boundary the operator has to be able to see — every row below it is unreversible.
  const shown = showAll ? rows : rows.filter((r) => r.reason === RESET_MARKER_REASON || !movedNothing(r));
  const hiddenCount = rows.length - shown.length;

  const { items, page: p, pages } = paginate(shown, page);
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

  // A filtered list that cannot be told apart from a complete one is how an operator concludes
  // a charge does not exist. So the footer names the count that is missing whenever anything
  // is — and says so out loud in the other direction too, since an operator who set show-all
  // on an account that happens to have no zero-movement rows would otherwise be left checking
  // whether the option took.
  const filterNote = showAll
    ? ' · showing every row, including those that moved nothing'
    : hiddenCount
      ? ` · ${hiddenCount} row${hiddenCount === 1 ? '' : 's'} that moved nothing hidden — set show-all to list them`
      : '';

  // Named as well as numbered: a bare snowflake is not something an operator can check a
  // refund against. The id stays alongside it, the shape /admin inspect already uses.
  const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, targetId)).get();
  const who = u?.displayName ? `${u.displayName} (${targetId})` : targetId;
  const embed = new EmbedBuilder()
    .setTitle(`🧾 Ledger — ${who}`)
    // 'No transactions.' would be a lie for a player whose every row was filtered away, and
    // the difference matters: one of those players has no history and the other has one this
    // view is choosing not to print. The footer carries the count either way.
    .setDescription(lines.join('\n') || (rows.length ? 'No rows moved anything.' : 'No transactions.'))
    .setFooter({ text: `Page ${p}/${pages}${filterNote}` });
  const components: ActionRowBuilder<ButtonBuilder>[] =
    pages > 1 ? [ledgerPageRow(targetId, p, pages, showAll)] : [];
  return { embeds: [embed], components };
}
