import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Ctx } from '../../core/context.js';
import { attendanceOf } from '../park/attendance.js';
import { levelValue } from '../park/service.js';
import { FOODS } from '../../data/foods.js';
import { ATTRACTIONS, attractionFor, type AttractionDef } from '../../data/attractions.js';
import {
  ATTENDANCE_MAX, ATTENDANCE_SPECIES_TARGET, ATTRACTION_DRAW_TARGET,
  type MilestoneDef,
} from '../../data/attendance.js';
import { attractionRows, buildableKinds, claimableMilestones, nextMilestone } from './service.js';

// Matches dex/embeds.ts's Payload shape: no `files` here at all, ever — this module
// ships no art, so there is nothing for attach() to append and no attachment set that
// a later i.update could ever need to shed.
export interface Payload { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] }

/**
 * One reward line per milestone: cash, shards, food and egg all render only when the
 * reward actually carries them, same discipline as seasonClaimPayload
 * (src/modules/daily/season-embeds.ts).
 */
function rewardLine(m: MilestoneDef): string {
  const parts: string[] = [];
  if (m.reward.cash) parts.push(`${m.reward.cash.toLocaleString()} cash`);
  if (m.reward.shards) parts.push(`${m.reward.shards} shards`);
  for (const [foodId, qty] of Object.entries(m.reward.foods ?? {})) {
    parts.push(`${FOODS[foodId as keyof typeof FOODS].name} ×${qty}`);
  }
  if (m.reward.egg) parts.push(`1 ${m.reward.egg} egg`);
  return parts.join(', ');
}

// Discord allows five buttons per row. Every milestone shares the same claim customId
// shape and there are only six total, but a player who lets several stack up unclaimed
// can legally have all six ready at once — chunk rather than assume one row covers it,
// the same reasoning leaderboards' visitRow chunks Visit buttons at five.
function claimRows(userId: string, milestones: readonly MilestoneDef[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let idx = 0; idx < milestones.length; idx += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...milestones.slice(idx, idx + 5).map((m) =>
        // No setEmoji here — a rarity/custom tag resolving to '' throws rather than
        // degrading (the repo-wide setEmoji hazard); the glyph lives in the label text.
        new ButtonBuilder().setCustomId(`guests:claim:${userId}:${m.at}`)
          .setLabel(`Claim: ${m.name}`).setStyle(ButtonStyle.Success)),
    ));
  }
  return rows;
}

/**
 * The /guests view dashboard: attendance and its three resolved terms (variety,
 * attraction draw, Visitor Center level), the owned attraction catalog, the next kind
 * still locked and the attendance it needs, and a claim button per milestone the
 * high-water has already crossed and not yet claimed.
 *
 * "Locked" is derived from buildableKinds rather than re-deriving the high-water gate
 * here: every ATTRACTIONS kind that is neither owned nor currently buildable is locked,
 * and the lowest unlockAt among those is what attendance opens next — unlockAt is
 * monotone with the catalog's own power order (tests/attractions-content.test.ts), so
 * sorting by it is sorting by "what unlocks next".
 */
export function guestsPayload(ctx: Ctx, userId: string): Payload {
  const att = attendanceOf(ctx, userId);
  const owned = attractionRows(ctx, userId);
  const ownedSet = new Set(owned.map((r) => r.kind));
  const buildable = new Set(buildableKinds(ctx, userId).map((d) => d.kind));
  const nextLocked = Object.values(ATTRACTIONS)
    .filter((d) => !ownedSet.has(d.kind) && !buildable.has(d.kind))
    .sort((a, b) => a.unlockAt - b.unlockAt)[0] ?? null;

  const builtLines = owned.length
    ? owned.map((r) => {
        const def = attractionFor(r.kind);
        return def ? `${def.name} — Lv ${r.level}/${def.maxLevel}` : `${r.kind} — Lv ${r.level}`;
      }).join('\n')
    : 'None yet — `/guests build`';

  const claimable = claimableMilestones(ctx, userId);

  const embed = new EmbedBuilder()
    .setTitle('🎡 Park Guests')
    .setColor(0xe67e22)
    // ATTENDANCE_MAX, never ATTENDANCE_SCALE — the scale is the base multiplier
    // attendanceFrom is built on, not a ceiling; the real closed-form maximum is
    // 92% higher (1,920 vs 1,000), and two milestones (1,400 / 1,800) sit above the
    // scale entirely, so quoting against it would print a park's own next milestone
    // as "past 100%".
    .setDescription(`**Attendance:** ${att.attendance.toLocaleString()} / ${ATTENDANCE_MAX.toLocaleString()}`)
    .addFields(
      { name: 'Variety', value: `${att.distinctSpecies} / ${ATTENDANCE_SPECIES_TARGET} species`, inline: true },
      { name: 'Attractions', value: `${att.drawTotal} / ${ATTRACTION_DRAW_TARGET} draw`, inline: true },
      { name: 'Visitor Center', value: `Level ${att.vcLevel}`, inline: true },
      { name: 'Built', value: builtLines },
      {
        name: 'Next unlock',
        value: nextLocked
          ? `${nextLocked.name} at ${nextLocked.unlockAt.toLocaleString()} attendance`
          : 'Every attraction is unlocked.',
      },
    );
  if (claimable.length) {
    embed.addFields({
      name: 'Ready to claim',
      value: claimable.map((m) => `🎁 **${m.name}** — ${rewardLine(m)}`).join('\n'),
    });
  }
  return { embeds: [embed], components: claimRows(userId, claimable) };
}

/** Confirmation after /guests build — covers both a fresh build (level 1) and an upgrade. */
export function builtPayload(ctx: Ctx, userId: string, def: AttractionDef, level: number): Payload {
  // levelValue, never a raw index — the same discipline capHours/facilityBonusPct use
  // for every other per-level facility array, even though buildAttraction/
  // upgradeAttraction already guarantee level sits inside [1, def.maxLevel] here.
  const draw = levelValue(def.draw, level, 0);
  const nextCost = level < def.maxLevel ? levelValue(def.upgradeCosts, level, 0) : null;
  const embed = new EmbedBuilder()
    .setTitle(`🎡 ${def.name} — Lv ${level}/${def.maxLevel}`)
    .setColor(0xe67e22)
    .setDescription(level === 1 ? 'Built and drawing guests.' : 'Upgraded.')
    .addFields(
      { name: 'Draw', value: `+${draw} attendance draw`, inline: true },
      { name: 'Next upgrade', value: nextCost !== null ? `${nextCost.toLocaleString()} cash` : 'Top level', inline: true },
    );
  return { embeds: [embed] };
}

/**
 * The /guests claim screen: whatever the high-water has already crossed and not yet
 * claimed, with a claim button for each. "Next" for an empty board comes from
 * nextMilestone (service.ts), which derives it from the high-water and the claimed set
 * — never from live attendance (attendanceOf), which can fall (a sold or escaped dino
 * since the high-water was set). A hint keyed on live attendance could re-name an
 * already-claimed rung as "next" once the live figure dropped back below it; the
 * high-water and the claimed set only ever grow, so this always names a genuinely
 * unclaimed one.
 */
export function milestonePayload(ctx: Ctx, userId: string): Payload {
  const claimable = claimableMilestones(ctx, userId);
  const att = attendanceOf(ctx, userId);
  const embed = new EmbedBuilder()
    .setTitle('🎁 Attendance Milestones')
    .setColor(0xe67e22)
    // ATTENDANCE_MAX, not ATTENDANCE_SCALE — see guestsPayload's identical note.
    .setDescription(`**Attendance:** ${att.attendance.toLocaleString()} / ${ATTENDANCE_MAX.toLocaleString()}`);
  if (claimable.length) {
    embed.addFields({
      name: 'Ready to claim',
      value: claimable.map((m) => `🎁 **${m.name}** (${m.at.toLocaleString()}) — ${rewardLine(m)}`).join('\n'),
    });
  } else {
    const next = nextMilestone(ctx, userId);
    embed.addFields({
      name: 'Nothing to claim yet',
      value: next ? `Next: **${next.name}** at ${next.at.toLocaleString()} attendance.` : 'Every milestone is claimed.',
    });
  }
  return { embeds: [embed], components: claimRows(userId, claimable) };
}
