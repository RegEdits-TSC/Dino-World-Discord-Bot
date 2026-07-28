import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
import type { Species } from '../../data/types.js';
import { RARITY } from '../../data/rarity.js';
import { assetImage } from '../../core/images.js';
import { rarityEmoji } from '../../core/emojis.js';
import { paginate, pageRow } from '../../core/paginate.js';
import type { Egg } from './service.js';

export const RARITY_COLOR: Record<string, number> = {
  common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf1c40f, mythic: 0xe74c3c,
};

export function crackButton(eggId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hatch:crack:${eggId}`).setLabel('🔨 Crack it open!').setStyle(ButtonStyle.Success),
  );
}
export function preHatchEmbed(rarity: string) {
  return new EmbedBuilder().setColor(RARITY_COLOR[rarity] ?? 0x95a5a6)
    .setTitle(`🥚 A ${rarityEmoji(rarity)}${rarity} egg trembles…`).setDescription('Something stirs inside. Crack it open!');
}
export function preHatchPayload(rarity: string, eggId: number) {
  const embed = preHatchEmbed(rarity);
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof crackButton>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: [crackButton(eggId)] };
  const img = assetImage('eggs', rarity);
  if (img) { embed.setImage(img.url); payload.files = [img.file]; }
  return payload;
}
export function revealPayload(species: Species) {
  const stats = RARITY[species.rarity];
  const embed = new EmbedBuilder().setColor(RARITY_COLOR[species.rarity] ?? 0x95a5a6)
    .setTitle(`✨ ${rarityEmoji(species.rarity)}${species.rarity.toUpperCase()} — ${species.name}!`)
    .setDescription(species.flavor)
    .addFields(
      { name: 'Diet', value: species.diet, inline: true },
      { name: 'Biome', value: species.biomeTags.join(', '), inline: true },
      { name: 'Income/hr', value: String(stats.incomePerHr), inline: true },
    );
  embed.setFooter({ text: 'Next: /dino assign — unassigned dinos earn nothing.' });
  // attachments is always empty: discord.js's InteractionUpdateOptions#attachments takes
  // existing-attachment descriptors to keep (Attachment | MessageEditAttachmentData), not
  // AttachmentBuilder — an empty tuple both satisfies that type and, passed to i.update(),
  // drops the pre-hatch egg upload so only the crack (via `files`) survives on the message.
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[];
    files: AttachmentBuilder[]; attachments: never[];
  } = { embeds: [embed], components: [], files: [], attachments: [] };
  const crack = assetImage('hatch', `${species.rarity}-crack`);
  if (crack) { embed.setImage(crack.url); payload.files = [crack.file]; }
  return payload;
}

// The egg the player most likely acts on next: ready-to-hatch, else incubating, else newest.
function featuredEgg(eggs: Egg[], now: number): Egg | undefined {
  return eggs.find((e) => e.hatchesAt !== null && e.hatchesAt <= now)
    ?? eggs.find((e) => e.hatchesAt !== null && e.hatchesAt > now)
    ?? [...eggs].sort((a, b) => b.obtainedAt - a.obtainedAt)[0];
}

export function eggListPayload(eggs: Egg[], now: number, userId: string, page = 1) {
  const { items, page: p, pages } = paginate(eggs, page);
  const lines = items.length ? items.map((e) => {
    const status = e.hatchesAt === null ? 'in inventory'
      : e.hatchesAt <= now ? 'READY — /hatch' : `hatching (ready <t:${Math.floor(e.hatchesAt / 1000)}:R>)`;
    return `#${e.id} — ${rarityEmoji(e.rarity)}${e.rarity} egg — ${status}`;
  }).join('\n') : 'No eggs. Run /expedition or /shop.';
  const embed = new EmbedBuilder().setTitle('🥚 Eggs').setDescription(lines).setColor(0x3ba55c)
    .setFooter({ text: `Page ${p}/${pages}` });
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: pages > 1 ? [pageRow('hatch', 'eggs', userId, p, pages)] : [] };
  // Featured thumbnail is computed from ALL eggs, not just the current page, so the
  // "act on next" egg keeps showing even when it lives on a different page.
  const featured = featuredEgg(eggs, now);
  const img = featured ? assetImage('eggs', featured.rarity) : null;
  if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
  return payload;
}
