import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import { emojiTag, rarityEmoji } from '../../core/emojis.js';
import { traitLines } from '../../core/trait-display.js';
import { fmtDuration } from '../../core/autocomplete.js';
import type { Breeding } from './service.js';

export interface Payload { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }

// userId is a SEED, never a lookup: banners have no object to key on, so the gene_lab
// banner keys on who is looking and each player gets one stable Gene Lab. Every builder
// in this file that ships that banner takes it, so the three Gene Lab screens agree with
// each other for a given player. claimPayload carries eggId as well — two seeds keying
// two different things (the banner keys on the viewer, the egg thumbnail on the egg).
export function confirmPayload(opts: {
  aId: number; bId: number; aName: string; bName: string;
  aTraits: string[]; bTraits: string[];
  rarity: string; fee: number; durationMs: number; upgradeChance: number;
  userId: string;
}): Payload {
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('🧬 Gene Lab — confirm pairing')
    .setDescription(`Pair **${opts.aName}** with **${opts.bName}**?`)
    .addFields(
      { name: `#${opts.aId} ${opts.aName}`, value: traitLines(opts.aTraits), inline: true },
      { name: `#${opts.bId} ${opts.bName}`, value: traitLines(opts.bTraits), inline: true },
      { name: `${emojiTag('dw_cash') || '💰'} Fee`, value: opts.fee.toLocaleString('en-US'), inline: true },
      { name: '⏳ Time', value: fmtDuration(opts.durationMs), inline: true },
      { name: 'Egg', value: `${rarityEmoji(opts.rarity)}${opts.rarity} — ${Math.round(opts.upgradeChance * 100)}% chance to upgrade`, inline: true },
    );
  const payload: Payload = {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`breed:confirm:${opts.aId}:${opts.bId}`)
        .setLabel('Breed').setStyle(ButtonStyle.Success),
    )],
  };
  attach(embed, payload, 'image', assetImage('banners', 'gene_lab', opts.userId));
  return payload;
}

export function statusPayload(rows: Array<Breeding & { ready: boolean }>, userId: string): Payload {
  const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle('🧬 Gene Lab');
  if (!rows.length) {
    embed.setDescription('No pairings in progress. Start one with `/breed start`.');
  } else {
    embed.setDescription(rows.map((b) => b.ready
      ? `**#${b.id}** — ✅ ready! \`/breed claim\``
      : `**#${b.id}** — ⏳ ready <t:${Math.floor(b.readyAt / 1000)}:R>`).join('\n'));
  }
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', 'gene_lab', userId));
  return payload;
}

export function claimPayload(opts: {
  rarity: string; traits: string[]; upgraded: boolean;
  speciesName: string | null; remaining: number; eggId: number; userId: string;
}): Payload {
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('🧬 A new egg!')
    .setDescription(opts.upgraded
      ? `The pairing produced a **${rarityEmoji(opts.rarity)}${opts.rarity}** egg — an upgrade!`
      : `The pairing produced a **${rarityEmoji(opts.rarity)}${opts.rarity}** egg.`)
    .addFields({ name: '🧬 Inherited traits', value: traitLines(opts.traits) });
  if (opts.speciesName) embed.addFields({ name: 'Species', value: `Pinned: ${opts.speciesName}`, inline: true });
  if (opts.remaining > 0) {
    embed.setFooter({ text: `${opts.remaining} more pairing${opts.remaining === 1 ? '' : 's'} ready — run /breed claim again.` });
  }
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', 'gene_lab', opts.userId));
  attach(embed, payload, 'thumbnail', assetImage('eggs', opts.rarity, String(opts.eggId)));
  return payload;
}

export function splicePreviewPayload(opts: {
  dinoId: number; speciesName: string; traits: string[]; slot: number; cost: number;
}): Payload {
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('🧬 Gene Lab — confirm splice')
    .setDescription(`Re-roll trait slot **${opts.slot + 1}** on **#${opts.dinoId} ${opts.speciesName}**? The replacement is random.`)
    .addFields(
      { name: 'Current traits', value: traitLines(opts.traits) },
      { name: `${emojiTag('dw_shard') || '💎'} Cost`, value: `${opts.cost.toLocaleString('en-US')} shards`, inline: true },
    );
  const payload: Payload = {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`splice:confirm:${opts.dinoId}:${opts.slot}`)
        .setLabel('Splice').setStyle(ButtonStyle.Danger),
    )],
  };
  // Distinct basename from the /breed banner (gene_lab) — see docs/superpowers/specs/
  // 2026-07-31-gene-lab-design.md §6.
  attach(embed, payload, 'image', assetImage('banners', 'gene_splice'));
  return payload;
}

export function splicedPayload(opts: {
  dinoId: number; speciesName: string; before: string[]; after: string[]; slot: number;
}): Payload {
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('🧬 Splice complete')
    .setDescription(`**#${opts.dinoId} ${opts.speciesName}** — trait slot **${opts.slot + 1}** re-rolled.`)
    .addFields(
      { name: 'Before', value: traitLines(opts.before), inline: true },
      { name: 'After', value: traitLines(opts.after), inline: true },
    );
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', 'gene_splice'));
  return payload;
}
