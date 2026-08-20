import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import type { User, Lot } from './service.js';
import { emojiTag } from '../../core/emojis.js';
import { eventHeaderLine } from '../world/embeds.js';
import type { LandmarkDef } from '../../data/landmarks.js';
import type { LegacyTier } from './ranks.js';
import { dinoImage, assetImage, attach } from '../../core/images.js';
import type { Featured } from './showcase.js';
import { seasonNumberOf } from '../../core/world.js';
import { ATTENDANCE_MAX } from '../../data/attendance.js';

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
  opts: { atRiskCount?: number; capped?: boolean; mismatchCount?: number; foodLine?: string; earnedTiers?: number; legacyRank?: LegacyTier | null; motto?: string; featured?: Featured | null; now?: number; seasonBadges?: { count: number; latest: number | null }; attendance?: number } = {},
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
      // Attendance is deliberately PUBLIC here, unlike shards (hidden everywhere to avoid
      // a public wealth display) — it's a prestige number, /top ranks on it, and a visited
      // park is meant to advertise it. ATTENDANCE_MAX, never ATTENDANCE_SCALE — see
      // guestsPayload's identical note; the scale understates the real ceiling by 92%.
      // No test pins this card's field count, so the decision lives here as a comment.
      { name: '🎡 Attendance', value: `${(opts.attendance ?? 0).toLocaleString()} / ${ATTENDANCE_MAX.toLocaleString()}`, inline: true },
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
  // Inline, after Legacy. Achievements + Legacy + Featured were exactly one inline row of
  // three, so this fourth wraps Featured onto its own row — accepted, since the
  // income-capped case already breaks that row with a full-width field.
  if (opts.seasonBadges && opts.seasonBadges.count > 0) {
    const { count, latest } = opts.seasonBadges;
    embed.addFields({
      name: '🎖️ Seasons',
      value: `${count} badge${count === 1 ? '' : 's'}${latest === null ? '' : ` · latest Season ${seasonNumberOf(latest)}`}`,
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
  // dinoImage, not assetImage: a hero species with its own committed portrait overrides the
  // shared archetype art, and everything else falls back to exactly what shipped before.
  attach(embed, payload, 'thumbnail',
    opts.featured ? dinoImage(opts.featured.speciesId, opts.featured.archetype, opts.featured.diet) : null);
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
  const payload: {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
    files?: AttachmentBuilder[];
  } = { embeds: [embed], components: [] };
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
  // attach(), never a hand-assigned payload.files — the idiom that shipped three
  // attachment defects in round 2 and is banned outright by tests/images.test.ts.
  // `components` stays non-optional: tests/landmarks.test.ts indexes components[0]
  // directly to read the buy button's customId back.
  attach(embed, payload, 'image', assetImage('banners', 'landmark'));
  return payload;
}

export type ParkTab = 'park' | 'animals' | 'lots' | 'prestige';

// Order is display order AND the order tabRow mints buttons in; tests pin it.
export const PARK_TABS: readonly ParkTab[] = ['park', 'animals', 'lots', 'prestige'];

const TAB_LABEL: Record<ParkTab, { label: string; emoji: string }> = {
  park: { label: 'Park', emoji: '🏞️' },
  animals: { label: 'Animals', emoji: '🦕' },
  lots: { label: 'Lots', emoji: '🏗️' },
  prestige: { label: 'Prestige', emoji: '🏛️' },
};

// The tab segment is CLIENT-supplied, so it is validated against the real union rather
// than cast — the parseDexFilters rule. `__proto__` and `constructor` are the reason this
// is an array membership test and not a lookup into TAB_LABEL: a prototype key reads back
// truthy from a plain object, which is exactly the hole buildLot has.
export function isParkTab(s: string): s is ParkTab {
  return (PARK_TABS as readonly string[]).includes(s);
}

/**
 * The navigation row. `id` is the OWNER's id for the own-park family and the TARGET's id
 * for the visit family — the visit tabs deliberately carry a target and are not owner
 * checked, the same shape park:tour already uses.
 *
 * Unicode glyphs in the label, never emojiTag/setEmoji: the app-emoji map returns '' when
 * unloaded and setEmoji throws on that rather than degrading.
 */
export function tabRow(id: string, active: ParkTab, visit = false): ActionRowBuilder<ButtonBuilder> {
  const action = visit ? 'vtab' : 'tab';
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...PARK_TABS.map((t) => new ButtonBuilder()
      .setCustomId(`park:${action}:${id}:${t}`)
      .setLabel(`${TAB_LABEL[t].emoji} ${TAB_LABEL[t].label}`)
      .setStyle(t === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      // The active tab is disabled so a click cannot re-render the screen already shown —
      // and this is a UX affordance ONLY, never a lock: the router guard does not read
      // `disabled`, so every handler still validates for itself.
      .setDisabled(t === active)),
  );
}
