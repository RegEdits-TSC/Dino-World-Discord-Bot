import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import type { User, Lot } from './service.js';

export function dashboardPayload(
  user: User, lots: Lot[], dinoCount: number, pending: number, escapedCount = 0,
  opts: { atRiskCount?: number; capped?: boolean } = {},
) {
  const extras: string[] = [];
  if (escapedCount > 0) extras.push(`${escapedCount} 🚨 escaped`);
  if (opts.atRiskCount) extras.push(`⚠ ${opts.atRiskCount} at risk`);
  const dinoValue = extras.length ? `${dinoCount} (${extras.join(', ')})` : String(dinoCount);
  const embed = new EmbedBuilder()
    .setTitle(`🏞️ ${user.parkName}`)
    .setColor(0x3ba55c)
    .addFields(
      { name: '💰 Cash', value: user.cash.toLocaleString(), inline: true },
      { name: '⭐ Rating', value: (user.parkRating / 100).toFixed(1), inline: true },
      { name: '🦕 Dinos', value: dinoValue, inline: true },
      { name: '🏗️ Lots', value: lots.map((l) => `#${l.id} ${l.name} (lvl ${l.level})`).join('\n') || 'None — /build', inline: false },
    );
  if (opts.capped) {
    embed.addFields({ name: '⛔ Income capped', value: 'Idle earnings hit the Visitor Center cap — collect now to restart them.' });
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('park:collect').setLabel(`💰 Collect ${pending.toLocaleString()}`).setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

// Set a rendered PNG as the embed's image and attach it. Mutates the (freshly built)
// embed in place and preserves components (e.g. the Collect button).
export function withParkImage<T extends { embeds: EmbedBuilder[] }>(payload: T, png: Buffer): T & { files: AttachmentBuilder[] } {
  payload.embeds[0].setImage('attachment://park.png');
  return { ...payload, files: [new AttachmentBuilder(png, { name: 'park.png' })] };
}
