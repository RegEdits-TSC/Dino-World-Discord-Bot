import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { User, Lot } from './service.js';

export function dashboardPayload(user: User, lots: Lot[], dinoCount: number, pending: number, escapedCount = 0) {
  const embed = new EmbedBuilder()
    .setTitle(`🏞️ ${user.parkName}`)
    .setColor(0x3ba55c)
    .addFields(
      { name: '💰 Cash', value: user.cash.toLocaleString(), inline: true },
      { name: '⭐ Rating', value: (user.parkRating / 100).toFixed(1), inline: true },
      { name: '🦕 Dinos', value: escapedCount > 0 ? `${dinoCount} (${escapedCount} 🚨 escaped)` : String(dinoCount), inline: true },
      { name: '🏗️ Lots', value: lots.map((l) => `#${l.id} ${l.name} (lvl ${l.level})`).join('\n') || 'None — /build', inline: false },
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('park:collect').setLabel(`💰 Collect ${pending.toLocaleString()}`).setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}
