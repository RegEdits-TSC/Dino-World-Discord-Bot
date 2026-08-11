import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import type { User, Lot } from './service.js';
import { emojiTag } from '../../core/emojis.js';
import { eventHeaderLine } from '../world/embeds.js';
import type { LandmarkDef } from '../../data/landmarks.js';
import type { LegacyTier } from './ranks.js';
import { assetImage, attach } from '../../core/images.js';
import type { Featured } from './showcase.js';

const LOT_EMOJI: Record<string, string> = {
  carnivore_paddock: 'dw_lot_carnivore', herbivore_paddock: 'dw_lot_herbivore',
  food_court: 'dw_lot_food_court', hatchery_lab: 'dw_lot_hatchery', visitor_center: 'dw_lot_visitor',
  gene_lab: 'dw_lot_genelab',
};

// Single source of truth for the dashboard's header key list: exported so
// tests/world-module.test.ts's per-key anyModRelevant tests exercise this
// exact array, not a duplicated literal that could silently drift from it.
export const PARK_HEADER_KEYS = ['income'] as const;

export function dashboardPayload(
  user: User, lots: Lot[], dinoCount: number, pending: number, escapedCount = 0,
  // now is optional because a handful of existing fixtures build a payload
  // without a ctx at all (tests/park.test.ts, tests/park-view-image.test.ts) —
  // every real call site (src/modules/park/index.ts) always passes ctx.now().
  // Missing defaults to a calm day, the same convention ChaptersView.now uses
  // in src/modules/battles/embeds.ts.
  opts: { atRiskCount?: number; capped?: boolean; mismatchCount?: number; foodLine?: string; earnedTiers?: number; legacyRank?: LegacyTier | null; motto?: string; featured?: Featured | null; now?: number } = {},
) {
  const extras: string[] = [];
  if (escapedCount > 0) extras.push(`${escapedCount} ${emojiTag('dw_alert')} escaped`);
  if (opts.atRiskCount) extras.push(`${emojiTag('dw_hunger')} ${opts.atRiskCount} at risk`);
  if (opts.mismatchCount) extras.push(`⚠️ ${opts.mismatchCount} wrong habitat`);
  const dinoValue = extras.length ? `${dinoCount} (${extras.join(', ')})` : String(dinoCount);
  const embed = new EmbedBuilder()
    .setTitle(`🏞️ ${user.parkName}`)
    .setColor(0x3ba55c)
    // The world-event header owns this slot; the motto is appended BENEATH it rather
    // than replacing it. A second .setDescription anywhere downstream would silently
    // delete the header, and tests/world-module.test.ts checks anyModRelevant, not the
    // embed, so nothing would notice.
    .setDescription([
      eventHeaderLine(opts.now ?? 0, PARK_HEADER_KEYS),
      opts.motto ? `*“${opts.motto}”*` : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: `${emojiTag('dw_cash')} Cash`, value: user.cash.toLocaleString(), inline: true },
      { name: `${emojiTag('dw_food')} Food`, value: opts.foodLine ?? 'none — /shop food', inline: true },
      { name: `${emojiTag('dw_star')} Rating`, value: (user.parkRating / 100).toFixed(1), inline: true },
      { name: '🦕 Dinos', value: dinoValue, inline: true },
      { name: '🏗️ Lots', value: lots.map((l) => {
        const e = emojiTag(LOT_EMOJI[l.kind] ?? '');
        return `#${l.id} ${e ? `${e} ` : ''}${l.name} (lvl ${l.level})`;
      }).join('\n') || 'None — /build', inline: false },
    );
  const earnedTiers = opts.earnedTiers ?? 0;
  if (earnedTiers > 0) {
    embed.addFields({ name: '🏆 Achievements', value: `${earnedTiers} tier${earnedTiers === 1 ? '' : 's'} earned`, inline: true });
  }
  if (opts.legacyRank) {
    embed.addFields({
      name: '🏛️ Legacy',
      value: `${opts.legacyRank.title} (rank ${opts.legacyRank.rank})`,
      inline: true,
    });
  }
  if (opts.capped) {
    embed.addFields({ name: '⛔ Income capped', value: 'Idle earnings hit the Visitor Center cap — collect now to restart them.' });
  }
  if (opts.featured) {
    embed.addFields({ name: '🦖 Featured', value: opts.featured.name, inline: true });
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('park:collect').setEmoji(emojiTag('dw_cash')).setLabel(`Collect ${pending.toLocaleString()}`).setStyle(ButtonStyle.Success),
  );
  // Explicit type, not inferred: `files` must be optional so attach() can create it, and
  // withParkImage's generic now reads it back.
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[];
  } = { embeds: [embed], components: [row] };
  // The ternary guards on DOMAIN data (is anything featured), so it stays outside attach —
  // "nothing featured" is not an asset miss. Same shape as shop's `best ? … : null`.
  attach(embed, payload, 'thumbnail',
    opts.featured ? assetImage('dinos', `${opts.featured.archetype}-${opts.featured.diet}`) : null);
  return payload;
}

// Set a rendered PNG as the embed's image and attach it. Mutates the (freshly built)
// embed in place and preserves components (e.g. the Collect button).
//
// APPENDS to `files` rather than assigning. dashboardPayload now calls attach() for the
// featured dino's thumbnail, and the old assignment would have silently dropped that
// upload at both /park view call sites and at /help topic:park, leaving a dangling
// attachment:// URL in the embed with no error and no failing test. park.png goes last,
// so call order stays upload order.
export function withParkImage<T extends { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }>(
  payload: T, png: Buffer,
): T & { files: AttachmentBuilder[] } {
  payload.embeds[0].setImage('attachment://park.png');
  return { ...payload, files: [...(payload.files ?? []), new AttachmentBuilder(png, { name: 'park.png' })] };
}

// No setEmoji here on purpose: rarityEmoji and friends return '' with no emoji map
// loaded (always true in tests), and setEmoji throws on that rather than degrading —
// see the repo-wide note on this. The unicode glyph lives in the title text instead.
export function landmarkPayload(user: User, current: LandmarkDef | null, next: LandmarkDef | null) {
  const embed = new EmbedBuilder()
    .setTitle('🏛️ Park Landmark')
    .setColor(0xc9a227)
    .setDescription(current
      ? `**${user.parkName}** is crowned by the **${current.name}**.`
      : `**${user.parkName}** has no landmark yet. It buys nothing but standing.`)
    .addFields(
      { name: 'Built', value: current ? `Tier ${current.tier} — ${current.name}` : 'Nothing yet', inline: true },
      { name: 'Next', value: next ? `${next.name} — ${next.cost.toLocaleString('en-US')} cash` : 'The ladder is complete', inline: true },
    );
  const payload: { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } = { embeds: [embed], components: [] };
  if (next) {
    // The OFFERED tier travels in the customId — the hatch:crack:<eggId> /
    // dex:page:<uid>:<page>:<slugs> precedent — because the label is frozen the moment
    // this message is posted while buyLandmark re-derives current+1 on every click. The
    // handler rejects any rung that is no longer next. Worst case 40 of Discord's 100
    // characters: 18 for the prefix, 20 for a snowflake, 1 colon, 1 digit of tier.
    payload.components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`park:landmark:buy:${user.discordId}:${next.tier}`)
        .setLabel(`Build ${next.name}`).setStyle(ButtonStyle.Primary),
    ));
  }
  return payload;
}
