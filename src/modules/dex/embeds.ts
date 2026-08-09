import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import type { Ctx } from '../../core/context.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { attach, assetImage } from '../../core/images.js';
import { rarityEmoji } from '../../core/emojis.js';
import { fmtDuration, capitalize } from '../../core/autocomplete.js';
import { DECOR } from '../../data/decor.js';
import { dexRows, dexEntry, dexProgress, type DexFilters } from './service.js';

export interface Payload { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }

function filterLabel(filters: DexFilters): string {
  const parts = [filters.rarity, filters.diet, filters.archetype].filter(Boolean).map((p) => capitalize(String(p)));
  return parts.length ? ` — ${parts.join(' · ')}` : '';
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
    components: pages > 1 ? [pageRow('dex', 'page', userId, p, pages)] : [],
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
      { name: 'Income', value: `${e.incomePerHr.toLocaleString('en-US')}/hr at full comfort`, inline: true },
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
