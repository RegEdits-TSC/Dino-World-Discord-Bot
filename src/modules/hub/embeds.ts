import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { rankSignals } from './rank.js';
import type { HubSignal, HubSection } from './types.js';

export interface Payload {
  embeds: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}

// Display order, and the order fields are added in. Not the ranking — rankSignals owns that
// and reads lossAtMs, never this array.
const SECTIONS: Array<{ key: HubSection; title: string }> = [
  { key: 'ready', title: 'Ready now' },
  { key: 'attention', title: 'Needs you' },
  { key: 'claim', title: 'Ready to claim' },
  { key: 'waiting', title: 'Waiting on' },
  { key: 'goals', title: 'Working toward' },
];

export function hubCardPayload(signals: HubSignal[], userId: string): Payload {
  const embed = new EmbedBuilder()
    .setTitle('🧭 What now?')
    .setColor(0x3ba55c);

  for (const section of SECTIONS) {
    const lines = signals.filter((s) => s.section === section.key).map((s) => s.text);
    // An empty field VALUE throws in tests/lib/discord-limits.ts, which every fake send runs.
    // Omitting the field is the house answer for a section with nothing in it; the goals
    // section is never empty by construction, so the card can never be fieldless.
    if (lines.length > 0) embed.addFields({ name: section.title, value: lines.join('\n') });
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const ranked = rankSignals(signals);
  if (ranked.length > 0) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...ranked.map((s) => new ButtonBuilder()
        .setCustomId(s.control!.customId)
        .setLabel(s.control!.label)
        .setStyle(s.control!.style)),
    ));
  }

  // Refresh sits alone on its own row rather than taking a seat from the ranked actions.
  // It exists because most reused controls reply ephemerally and leave THIS card's labels
  // stale; one Refresh retires that whole class instead of a proxy handler per subsystem.
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hub:refresh:${userId}`)
      .setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary),
  ));

  // No `files` key: this payload ships no art, and an empty array would read as "replace the
  // attachment set" at a send site that means "there are none".
  return { embeds: [embed], components };
}
