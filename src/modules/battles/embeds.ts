import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
import { assetImage, dinoImage, attach } from '../../core/images.js';
import { getSpecies } from '../../data/species/index.js';
import { FOODS } from '../../data/foods.js';
import { CAMPAIGN, STAGES, stageUnlocked, chapterUnlocked, rosterFor, type ProgressMap } from '../../data/battle/chapters/index.js';
import { ENERGY_CAP, ENERGY_REGEN_MS } from '../../data/battle/constants.js';
import type { BeatSummary } from '../../data/battle/resolve.js';
import type { FightOutcome } from './service.js';
import { energyCostFor } from './service.js';
import { eventHeaderLine } from '../world/embeds.js';

export interface FramePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
  // Always [] in this codebase — it exists only to clear the previous frame's
  // uploads on edit, never to keep specific prior attachments by id. Typed as
  // an empty tuple (not AttachmentBuilder[]) because discord.js's real
  // MessageEditOptions.attachments accepts Attachment/MessageEditAttachmentData,
  // not AttachmentBuilder — a wider type here would fail against i.editReply.
  attachments?: readonly [];
}

// Display-only snapshot: energy already settled in locals (previewSell precedent).
export interface ChaptersView {
  progress: ProgressMap;
  ratingHighWater: number;
  energy: number;
  energyUpdatedAtMs: number;
  // Optional, not because a real caller ever omits it (chaptersView always sets
  // it from ctx.now()) but so existing fixtures built without it — this is a
  // pure display snapshot, same shape as energy/energyUpdatedAtMs above — keep
  // compiling. Missing defaults to a calm day: declared cost, unadjusted.
  now?: number;
}

// <t:..:R> does not render inside embed footers, so energy lines live in a field.
export function energyLine(energy: number, updatedAtMs: number): string {
  if (energy >= ENERGY_CAP) return `⚡ ${energy}/${ENERGY_CAP} · full`;
  return `⚡ ${energy}/${ENERGY_CAP} · +1 <t:${Math.floor((updatedAtMs + ENERGY_REGEN_MS) / 1000)}:R>`;
}

function starGlyphs(stars: number): string {
  return '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
}

// userId seeds the two art lookups that have faces to choose from — the chapter's site
// banner and the outcome banner. It is NOT on FightOutcome, because the fight itself does
// not care who is watching: presentFight already holds it for the skip and replay
// customIds and passes it straight through. Seeding on the viewer rather than the fight
// is deliberate — a `battle:again` replay re-renders the same message, so a face that
// moved per fight would flicker the banner under a player who never left the screen.
export function fightFrames(
  outcome: FightOutcome,
  includeSkipButton: (frameIdx: 0 | 1 | 2) => ActionRowBuilder<ButtonBuilder> | null,
  userId: string,
): [FramePayload, FramePayload, FramePayload, FramePayload] {
  const stage = STAGES.get(outcome.stageId);
  if (!stage) throw new Error(`Unknown stage: ${outcome.stageId}`);
  // Every ref built in this function deliberately does NOT use attach(): each is
  // dressed onto several different embeds and the files are then distributed across
  // two payloads by the F1/F4 contract below, which attach's one-embed-one-payload
  // shape cannot express. fightFrames is the only such site in the repo —
  // everywhere else attach() is mandatory.
  const banner = assetImage('sites', `${stage.chapterId}-banner`, userId);
  // No seed on the portrait: boss art ships no -vN siblings, and a boss is a named
  // individual — one face is the point, so it must never gain them either.
  const portrait = stage.boss ? assetImage('battles', `${stage.boss.bossId}-portrait`) : null;
  const outcomeBanner = assetImage('banners', outcome.won ? 'battle_victory' : 'battle_defeat', userId);
  // Single source of truth for who actually fought AND which entry is the
  // boss is rosterFor (shared with runFight) — never re-derived here. Hoisted
  // above dress() because the thumbnail is now derived from it.
  const roster = rosterFor(stage, outcome.squad.length);
  // A boss stage shows its named individual and nothing else: if the portrait is
  // missing it degrades to no thumbnail, never to species or archetype art standing in
  // for a boss. Non-boss stages have no individual, so they show the lead enemy rosterFor
  // fields — the same entry the enemy list opens with — through dinoImage, which prefers
  // that species' own portrait and falls back to its archetype art.
  const lead = stage.boss ? null : getSpecies(roster[0].speciesId);
  const thumb = portrait ?? (lead ? dinoImage(lead.id, lead.archetype, lead.diet) : null);

  // Files attach on F1 and F4 only, and each attaching frame uploads exactly the
  // files its embed references. F1 and F4 both replace the message's whole
  // attachment set (`attachments: []`, unconditional on both); F2/F3 carry no
  // files/attachments key at all, so F1's uploads survive and their
  // attachment:// URLs keep resolving. Never add a file here that no frame
  // references — it renders as a bare attachment card under the message.
  const dress = (embed: EmbedBuilder) => {
    if (banner) embed.setImage(banner.url);
    if (thumb) embed.setThumbnail(thumb.url);
    return embed;
  };

  const squadLines = outcome.squad
    .map((m) => `Lv.${m.level} ${m.name} — ${getSpecies(m.speciesId).name}`).join('\n');
  const enemyLines = roster.map((e) =>
    e.boss
      ? `👑 ${e.boss.title} — Lv.${stage.npcLevel + e.boss.levelBonus} ${getSpecies(e.speciesId).name}`
      : `Lv.${stage.npcLevel} ${getSpecies(e.speciesId).name}`).join('\n');

  const f1: FramePayload = {
    embeds: [dress(new EmbedBuilder().setColor(0xd35400)
      .setTitle(`⚔️ ${stage.name}`)
      .setDescription(stage.boss ? 'A chapter boss blocks the path…' : 'The squads square up…')
      .addFields(
        { name: 'Your squad', value: squadLines, inline: true },
        { name: 'Enemies', value: enemyLines, inline: true },
      ))],
    components: [],
    // Unconditional, for the same reason as F4's below: `battle:again` re-edits
    // the message F4 last wrote, so on a deploy with no chapter art F1 would
    // carry no files AND no attachments key and Discord would keep F4's outcome
    // banner alive under F1-F3, whose embeds reference nothing.
    attachments: [],
  };
  const files = [banner?.file, thumb?.file].filter((f): f is AttachmentBuilder => f != null);
  if (files.length) f1.files = files;   // uploads on F1; F2/F3 ride on them

  const beatFrame = (beat: BeatSummary): FramePayload => ({
    embeds: [dress(new EmbedBuilder().setColor(0xd35400)
      .setTitle(beat.title).setDescription(beat.lines.join('\n') || '…'))],
    components: [],
  });

  const r = outcome.rewards;
  const lines: string[] = [];
  if (outcome.won) {
    lines.push(`💰 +${r.cash.toLocaleString('en-US')} cash`);
    if (r.food) lines.push(`${FOODS[r.food.foodId].fallback} +${r.food.qty} ${FOODS[r.food.foodId].name}`);
    if (r.shards > 0) lines.push(`💠 +${r.shards} shards — first clear!`);
  }
  const xpTotal = r.xpPerDino.reduce((a, b) => a + b, 0);
  lines.push(`📈 +${xpTotal} battle XP split across the squad${outcome.won ? '' : ' (consolation)'}`);
  if (outcome.bossEgg) lines.push(`🥚 A ${outcome.bossEgg.rarity} egg! Check /eggs.`);
  const f4Embed = new EmbedBuilder()
    .setColor(outcome.won ? 0x2ecc71 : 0xe74c3c)
    .setTitle(outcome.won ? `🏆 Victory — ${stage.name}` : `💀 Defeat — ${stage.name}`)
    .setDescription(`${starGlyphs(outcome.stars)} · ${outcome.result.rounds} round(s)`)
    .addFields(
      { name: 'Rewards', value: lines.join('\n') },
      { name: 'Energy', value: energyLine(outcome.energyAfter, outcome.energyUpdatedAtMs) },
    );
  // Deliberately NOT dress()ed: F4 shows the outcome banner, not the chapter one.
  if (outcomeBanner) f4Embed.setImage(outcomeBanner.url);
  if (thumb) f4Embed.setThumbnail(thumb.url);
  // attachments: [] is unconditional. discord.js pushes F4's own descriptors into
  // it, so the chapter banner is dropped from the message either way — including
  // the no-art case, where F4 has no files and would otherwise strand F1's upload
  // as a bare attachment card. Same payload is replayed by the skip button.
  const f4: FramePayload = { embeds: [f4Embed], components: [], attachments: [] };
  const f4Files = [outcomeBanner?.file, thumb?.file].filter((f): f is AttachmentBuilder => f != null);
  if (f4Files.length) f4.files = f4Files;

  const withSkip = (p: FramePayload, idx: 0 | 1 | 2): FramePayload => {
    const row = includeSkipButton(idx);
    if (row) p.components.push(row);
    return p;
  };
  return [withSkip(f1, 0), withSkip(beatFrame(outcome.result.beats[0]), 1),
    withSkip(beatFrame(outcome.result.beats[1]), 2), f4];
}

// /battle chapters' header key list, exported so tests/world-module.test.ts's
// per-key anyModRelevant tests exercise this exact array, not a duplicated
// literal that could silently drift from it.
export const BATTLE_CHAPTERS_HEADER_KEYS = ['energyCostDelta', 'battleXp', 'enemyHp'] as const;

export function chaptersPayload(userId: string, chapterIndex: number, view: ChaptersView): FramePayload {
  const idx = Math.min(Math.max(0, chapterIndex), CAMPAIGN.length - 1);
  const ch = CAMPAIGN[idx];
  const unlocked = chapterUnlocked(ch.id, view.progress, view.ratingHighWater);
  const stageLines = ch.stages.map((s) => {
    const open = unlocked && stageUnlocked(s.id, view.progress);
    const marker = open ? starGlyphs(view.progress.get(s.id)?.stars ?? 0) : '🔒';
    const cost = energyCostFor(s.energyCost, view.now ?? 0);
    return `${marker} ${s.boss ? '👑 ' : ''}${s.name} (⚡${cost})`;
  }).join('\n');
  const header = eventHeaderLine(view.now ?? 0, BATTLE_CHAPTERS_HEADER_KEYS);
  // Two gate kinds now (see chapterUnlocked), and both are real, independent
  // requirements — this card is reachable by navigation alone (the Next ▶
  // button satisfies no gate), so a player can easily be sitting on this
  // locked screen with the previous chapter's boss still unbeaten. The copy
  // must therefore name every requirement rather than assume any one of them
  // is already satisfied. Reads ch.starGate directly; never keep a second
  // copy of the number here.
  const lockLine = ch.starGate != null
    ? `🔒 Locked — beat the previous chapter's boss and earn ${[...view.progress.values()].reduce((sum, p) => sum + p.stars, 0)}/${ch.starGate} campaign stars.`
    : '🔒 Locked — beat the previous chapter\'s boss and raise your park rating.';
  const tagline = unlocked ? ch.tagline : `${ch.tagline}\n\n${lockLine}`;
  const embed = new EmbedBuilder().setColor(unlocked ? 0xd35400 : 0x95a5a6)
    .setTitle(`📖 Chapter ${idx + 1}/${CAMPAIGN.length} — ${ch.name}${unlocked ? '' : ' 🔒'}`)
    .setDescription(`${header}\n\n${tagline}`)
    .addFields(
      { name: 'Stages', value: stageLines },
      { name: 'Energy', value: energyLine(view.energy, view.energyUpdatedAtMs) },
    );
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`battle:chapter:${userId}:${idx - 1}`).setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary).setDisabled(idx <= 0),
    new ButtonBuilder().setCustomId(`battle:chapter:${userId}:${idx + 1}`).setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary).setDisabled(idx >= CAMPAIGN.length - 1),
  );
  const payload: FramePayload = { embeds: [embed], components: [nav] };
  // chapterId === siteId invariant (content test) makes the site art legal here.
  // userId seeds the banner — the viewer, same rule as every other banner call.
  attach(embed, payload, 'image', assetImage('sites', `${ch.id}-banner`, userId));
  attach(embed, payload, 'thumbnail', assetImage('sites', `${ch.id}-thumb`));
  return payload;
}
