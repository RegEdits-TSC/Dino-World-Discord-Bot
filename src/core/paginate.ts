import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const PAGE_SIZE = 10;

export function paginate<T>(all: T[], page: number, perPage = PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { items: all.slice((p - 1) * perPage, p * perPage), page: p, pages };
}

// customId: `<prefix>:<action>:<userId>:<targetPage>` — the embedded userId locks
// paging to the list owner (these buttons sit on public messages).
export function pageRow(prefix: string, action: string, userId: string, page: number, pages: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:${action}:${userId}:${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`${prefix}:${action}:${userId}:${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages),
  );
}
