import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import type { Ctx } from '../../core/context.js';
import { paginate } from '../../core/paginate.js';
import { attach, assetImage } from '../../core/images.js';
import { rarityEmoji } from '../../core/emojis.js';
import { fmtDuration, capitalize } from '../../core/autocomplete.js';
import { DECOR } from '../../data/decor.js';
import { dexRows, dexEntry, dexProgress, FILTER_NONE, type DexFilters } from './service.js';

export interface Payload { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }

function filterLabel(filters: DexFilters): string {
  const parts = [filters.rarity, filters.diet, filters.archetype].filter(Boolean).map((p) => capitalize(String(p)));
  return parts.length ? ` — ${parts.join(' · ')}` : '';
}

/**
 * The page row, `dex:page:<uid>:<page>:<rarity|->:<diet|->:<archetype|->`.
 *
 * Built here rather than through the shared `pageRow` (src/core/paginate.ts) because
 * that customId has no room for filter state, and paging a FILTERED list without it
 * silently returns the unfiltered page — wrong rows, wrong title, wrong page count, no
 * error. Teaching `pageRow` about dex filters would push a dex concern onto its four
 * other callers (`ach`, `hatch`, `park:dinos`, `trade:list`), so the format lives beside
 * the payload that reads it back.
 *
 * Worst case is 59 of Discord's 100 customId characters: 'dex:page:' (9) + a 19-digit
 * snowflake + ':' + a 2-digit page + ':legendary' + ':herbivore' + ':bruiser'. Pinned in
 * tests/dex.test.ts, and the harness validates every payload's custom_id length anyway.
 */
export function dexPageRow(userId: string, filters: DexFilters, page: number, pages: number) {
  const slugs = [filters.rarity ?? FILTER_NONE, filters.diet ?? FILTER_NONE, filters.archetype ?? FILTER_NONE].join(':');
  const id = (p: number) => `dex:page:${userId}:${p}:${slugs}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(id(page - 1)).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(id(page + 1)).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages),
  );
}

// Models achievementsPayload (src/modules/daily/embeds.ts:92): the payload builder
// calls the read service itself, paginate() clamps the page, and the page row only
// renders once there's more than one page. Ships no banner — this spec has no art
// (tests/images.test.ts scrapes every `assetImage('banners', ...)` call and would
// demand a committed file for one).
export function dexListPayload(ctx: Ctx, userId: string, filters: DexFilters, page: number): Payload {
  const all = dexRows(ctx, userId, filters);
  const { items, page: p, pages } = paginate(all, page);
  const progress = dexProgress(ctx, userId);
  const lines = items.length
    ? items.map((r) => `${r.seen ? '✅' : '▫️'} ${rarityEmoji(r.species.rarity)}${r.species.name} — ${capitalize(r.species.diet)} ${capitalize(r.species.archetype)}`).join('\n')
    : 'No species match that filter.';
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`📖 Dex${filterLabel(filters)}`)
    .setDescription(lines)
    .setFooter({ text: `${progress.seen}/${progress.total} seen · Page ${p}/${pages}` });
  return {
    embeds: [embed],
    components: pages > 1 ? [dexPageRow(userId, filters, p, pages)] : [],
  };
}

// The cross-link that makes the dex worth consulting before a purchase: decor is
// permanent once bought, so "Enriched by" names the kinds that count toward this
// species' enrichment (src/data/decor.ts) before the player spends on one.
export function dexViewPayload(ctx: Ctx, userId: string, speciesId: string): Payload {
  const e = dexEntry(ctx, userId, speciesId);
  const kinds = e.enrichingKinds.map((k) => DECOR[k].name).join(', ');
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`${rarityEmoji(e.species.rarity)}${e.species.name}`)
    .setDescription(e.species.flavor)
    .addFields(
      { name: 'Rarity', value: capitalize(e.species.rarity), inline: true },
      { name: 'Diet', value: capitalize(e.species.diet), inline: true },
      { name: 'Role', value: capitalize(e.species.archetype), inline: true },
      // "base rate", not "at full comfort": this is the bare rarity figure, and income
      // traits, enrichment and facility bonuses all scale it upward from here — so a
      // player reading this on /dex view must not take it for what a dino will pay.
      { name: 'Income', value: `${e.incomePerHr.toLocaleString('en-US')}/hr base rate`, inline: true },
      { name: 'Incubation', value: fmtDuration(e.incubationMs), inline: true },
      { name: 'Habitat', value: e.species.biomeTags.map(capitalize).join(', '), inline: true },
      { name: 'Enriched by', value: kinds },
      {
        name: 'Your record',
        value: e.firstAt === null ? 'Never owned' : `First owned <t:${Math.floor(e.firstAt / 1000)}:D>`,
      },
    );
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'thumbnail', assetImage('dinos', `${e.species.archetype}-${e.species.diet}`));
  return payload;
}
