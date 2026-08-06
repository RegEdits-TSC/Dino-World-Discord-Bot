import { EmbedBuilder } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import { emojiTag } from '../../core/emojis.js';
import { worldEventFor, eventMods, seasonFor, seasonDay, SEASON_DAYS, dayIndex } from '../../core/world.js';
import { NEUTRAL_MODS, type EventMods } from '../../data/world-events.js';

const DAY_MS = 86_400_000;
const SEASON_LABEL = { wet: 'Wet', dry: 'Dry', cold: 'Cold' } as const;

export interface Payload { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }

/** True when any of `keys` differs from its neutral value. EventMods has
 *  three different neutral shapes: 1 for most fields, 0 for
 *  expeditionOddsShift/energyCostDelta, and null for hatchTraitOdds.
 *  Hardcoding "1 or 0 means neutral" misreads a field whose OWN neutral is
 *  the other one (a future energyCostDelta: +1 would look neutral against a
 *  literal 1/0 check). Comparing against NEUTRAL_MODS is neutral-shape-agnostic.
 *  Exported so the boundary cases no shipped event can reach are testable
 *  with a synthetic EventMods, without mocking the derivation. */
export function anyModRelevant(mods: EventMods, keys: ReadonlyArray<keyof EventMods>): boolean {
  return keys.some((k) => mods[k] !== NEUTRAL_MODS[k]);
}

/** One line for another module's embed, naming only the effects that screen
 *  cares about. A function, never a constant — emojiTag must resolve at render
 *  time or the unicode fallback freezes at module init. */
export function eventHeaderLine(now: number, keys: ReadonlyArray<keyof EventMods>): string {
  const e = worldEventFor(now);
  const mods = eventMods(now);
  const tag = emojiTag(e.emoji);
  if (!anyModRelevant(mods, keys)) return `${tag} **${e.name}** — no effect here today`;
  return `${tag} **${e.name}** — ${e.effects.join(' · ')}`;
}

export function worldPayload(now: number): Payload {
  const e = worldEventFor(now);
  const season = seasonFor(now);
  const nextMidnight = (dayIndex(now) + 1) * DAY_MS;
  const tomorrow = worldEventFor(nextMidnight);

  const embed = new EmbedBuilder()
    .setTitle(`${emojiTag(e.emoji)} ${e.name}`)
    .setDescription(e.blurb);

  embed.addFields({
    name: 'Today',
    value: e.effects.length ? e.effects.map((l) => `• ${l}`).join('\n') : '• Nothing out of the ordinary',
  });
  embed.addFields(
    { name: 'Season', value: `${SEASON_LABEL[season]} — day ${seasonDay(now)} of ${SEASON_DAYS}`, inline: true },
    { name: 'Turns over', value: `<t:${Math.floor(nextMidnight / 1000)}:R>`, inline: true },
  );
  // Tomorrow's NAME only. It is derivable either way, so hiding it entirely
  // would be a fiction — the name is the hook, the numbers are the reveal.
  embed.setFooter({ text: `Tomorrow: ${tomorrow.name}` });

  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', `event-${e.id}`));
  return payload;
}
