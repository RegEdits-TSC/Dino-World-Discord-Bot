import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Species } from '../../data/types.js';
import { RARITY } from '../../data/rarity.js';

const RARITY_COLOR: Record<string, number> = {
  common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf1c40f, mythic: 0xe74c3c,
};

export function crackButton(eggId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hatch:crack:${eggId}`).setLabel('🔨 Crack it open!').setStyle(ButtonStyle.Success),
  );
}
export function preHatchEmbed(rarity: string) {
  return new EmbedBuilder().setColor(RARITY_COLOR[rarity] ?? 0x95a5a6)
    .setTitle(`🥚 A ${rarity} egg trembles…`).setDescription('Something stirs inside. Crack it open!');
}
export function revealPayload(species: Species) {
  const stats = RARITY[species.rarity];
  const embed = new EmbedBuilder().setColor(RARITY_COLOR[species.rarity] ?? 0x95a5a6)
    .setTitle(`✨ ${species.rarity.toUpperCase()} — ${species.name}!`)
    .setDescription(species.flavor)
    .addFields(
      { name: 'Diet', value: species.diet, inline: true },
      { name: 'Biome', value: species.biomeTags.join(', '), inline: true },
      { name: 'Income/hr', value: String(stats.incomePerHr), inline: true },
    );
  return { embeds: [embed], components: [] };
}
