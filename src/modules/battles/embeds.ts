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
  const outcomeBanner = assetImage('banners', outcome.won ? 'battle_victory' : 'battle_defeat');

  // Files attach on F1 and F4 only, and each attaching frame uploads exactly the
  // files its embed references. F2/F3 carry no files/attachments key at all, so
  // F1's uploads survive and their attachment:// URLs keep resolving. F4 replaces
  // the set (see below) — never add a file here that no frame references, it
  // renders as a bare attachment card under the message.
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
  if (portrait) f4Embed.setThumbnail(portrait.url);
  // attachments: [] is unconditional. discord.js pushes F4's own descriptors into
  // it, so the chapter banner is dropped from the message either way — including
  // the no-art case, where F4 has no files and would otherwise strand F1's upload
  // as a bare attachment card. Same payload is replayed by the skip button.
  const f4: FramePayload = { embeds: [f4Embed], components: [], attachments: [] };
  const f4Files = [outcomeBanner?.file, portrait?.file].filter((f): f is AttachmentBuilder => f != null);
  if (f4Files.length) f4.files = f4Files;

  const withSkip = (p: FramePayload, idx: 0 | 1 | 2): FramePayload => {
    const row = includeSkipButton(idx);
    if (row) p.components.push(row);
    return p;
  };
  return [withSkip(f1, 0), withSkip(beatFrame(outcome.result.beats[0]), 1),
    withSkip(beatFrame(outcome.result.beats[1]), 2), f4];
}

export function chaptersPayload(userId: string, chapterIndex: number, view: ChaptersView): FramePayload {
  const idx = Math.min(Math.max(0, chapterIndex), CAMPAIGN.length - 1);
  const ch = CAMPAIGN[idx];
  const unlocked = chapterUnlocked(ch.id, view.progress, view.ratingHighWater);
  const stageLines = ch.stages.map((s) => {
    const open = unlocked && stageUnlocked(s.id, view.progress);
    const marker = open ? starGlyphs(view.progress.get(s.id)?.stars ?? 0) : '🔒';
    return `${marker} ${s.boss ? '👑 ' : ''}${s.name} (⚡${s.energyCost})`;
  }).join('\n');
  const embed = new EmbedBuilder().setColor(unlocked ? 0xd35400 : 0x95a5a6)
    .setTitle(`📖 Chapter ${idx + 1}/${CAMPAIGN.length} — ${ch.name}${unlocked ? '' : ' 🔒'}`)
    .setDescription(unlocked ? ch.tagline
      : `${ch.tagline}\n\n🔒 Locked — beat the previous chapter's boss and raise your park rating.`)
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
  const banner = assetImage('sites', `${ch.id}-banner`);
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  // APPEND — a second assignment would drop the banner file.
  const thumb = assetImage('sites', `${ch.id}-thumb`);
  if (thumb) { embed.setThumbnail(thumb.url); payload.files = [...(payload.files ?? []), thumb.file]; }
  return payload;
}
