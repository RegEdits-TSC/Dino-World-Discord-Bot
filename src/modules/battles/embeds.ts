import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
import { assetImage } from '../../core/images.js';
import { getSpecies } from '../../data/species/index.js';
import { FOODS } from '../../data/foods.js';
import { CAMPAIGN, STAGES, stageUnlocked, chapterUnlocked, rosterFor, type ProgressMap } from '../../data/battle/chapters/index.js';
import { ENERGY_CAP, ENERGY_REGEN_MS } from '../../data/battle/constants.js';
import type { BeatSummary } from '../../data/battle/resolve.js';
import type { FightOutcome } from './service.js';

export interface FramePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}

// Display-only snapshot: energy already settled in locals (previewSell precedent).
export interface ChaptersView {
  progress: ProgressMap;
  ratingHighWater: number;
  energy: number;
  energyUpdatedAtMs: number;
}

// <t:..:R> does not render inside embed footers, so energy lines live in a field.
export function energyLine(energy: number, updatedAtMs: number): string {
  if (energy >= ENERGY_CAP) return `⚡ ${energy}/${ENERGY_CAP} · full`;
  return `⚡ ${energy}/${ENERGY_CAP} · +1 <t:${Math.floor((updatedAtMs + ENERGY_REGEN_MS) / 1000)}:R>`;
}

function starGlyphs(stars: number): string {
  return '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
}

export function fightFrames(
  outcome: FightOutcome,
  includeSkipButton: (frameIdx: 0 | 1 | 2) => ActionRowBuilder<ButtonBuilder> | null,
): [FramePayload, FramePayload, FramePayload, FramePayload] {
  const stage = STAGES.get(outcome.stageId);
  if (!stage) throw new Error(`Unknown stage: ${outcome.stageId}`);
  const banner = assetImage('sites', `${stage.chapterId}-banner`);
  const portrait = stage.boss ? assetImage('battles', `${stage.boss.bossId}-portrait`) : null;

  // Files upload once on F1; every later frame re-references them by
  // attachment:// URL. An uploaded file the current embed does not reference
  // renders as a bare attachment under the message, so the banner images and
  // boss portrait thumbnail appear on every frame (contract minimum: F3/F4).
  const dress = (embed: EmbedBuilder) => {
    if (banner) embed.setImage(banner.url);
    if (portrait) embed.setThumbnail(portrait.url);
    return embed;
  };

  const squadLines = outcome.squad
    .map((m) => `Lv.${m.level} ${m.name} — ${getSpecies(m.speciesId).name}`).join('\n');
  // Single source of truth for who actually fought AND which entry is the
  // boss is rosterFor (shared with runFight) — never re-derived here.
  const roster = rosterFor(stage, outcome.squad.length);
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
  };
  const files = [banner?.file, portrait?.file].filter((f): f is AttachmentBuilder => f != null);
  if (files.length) f1.files = files;   // attachments only on F1

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
  const f4: FramePayload = {
    embeds: [dress(new EmbedBuilder()
      .setColor(outcome.won ? 0x2ecc71 : 0xe74c3c)
      .setTitle(outcome.won ? `🏆 Victory — ${stage.name}` : `💀 Defeat — ${stage.name}`)
      .setDescription(`${starGlyphs(outcome.stars)} · ${outcome.result.rounds} round(s)`)
      .addFields(
        { name: 'Rewards', value: lines.join('\n') },
        { name: 'Energy', value: energyLine(outcome.energyAfter, outcome.energyUpdatedAtMs) },
      ))],
    components: [],
  };

  const withSkip = (p: FramePayload, idx: 0 | 1 | 2): FramePayload => {
    const row = includeSkipButton(idx);
    if (row) p.components.push(row);
    return p;
  };
  return [withSkip(f1, 0), withSkip(beatFrame(outcome.result.beats[0]), 1),
    withSkip(beatFrame(outcome.result.beats[1]), 2), f4];
}
