import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import { FOODS } from '../../data/foods.js';
import type { Payload } from './embeds.js';
import { bar } from './embeds.js';
import type { SeasonView, SeasonClaimResult } from './season.js';

const SEASON_NAMES: Record<string, string> = { wet: 'Wet Season', dry: 'Dry Season', cold: 'Cold Front' };

export function seasonPayload(view: SeasonView, userId: string): Payload {
  const sources = view.breakdown
    .filter((b) => b.points > 0)
    .map((b) => `${b.source.name} **${b.points}**/${b.source.cap}`)
    .join(' · ') || 'No progress yet — play anything.';
  const rungs = view.rungs.map((r) => {
    const mark = r.claimed ? '✅' : r.unlocked ? '🎁' : '🔒';
    const parts: string[] = [];
    if (r.rung.rewards.cash) parts.push(`${r.rung.rewards.cash.toLocaleString()} cash`);
    if (r.rung.rewards.shards) parts.push(`${r.rung.rewards.shards} shards`);
    if (r.rung.rewards.food) parts.push(`${FOODS[r.rung.rewards.food.foodId].name} ×${r.rung.rewards.food.qty}`);
    if (r.rung.rewards.eggRarity) parts.push(`1 ${r.rung.rewards.eggRarity} egg`);
    return `${mark} **${r.rung.points}** — ${parts.join(', ')}`;
  }).join('\n');
  const capstone = view.rungs[view.rungs.length - 1].rung.points;

  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`🎖️ Season ${view.number} — ${SEASON_NAMES[view.season] ?? view.season}`)
    .setDescription([
      `${bar(Math.min(view.points, capstone), capstone)} **${view.points}**/${capstone} — ${view.daysLeft} days left`,
      view.headStart > 0 ? `*Veteran head start: ${view.headStart}*` : '',
      view.badgeAt !== null ? '**Badge earned — it is yours permanently.**' : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: 'Where your points came from', value: sources },
      { name: 'Rewards', value: rungs },
    );
  const payload: Payload = {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      // The season index is IN the customId. A /season card left open across a rollover
      // would otherwise pay this season's rungs against last season's ladder — the
      // park:landmark:buy stale-button lesson, applied before it can be relearned.
      new ButtonBuilder().setCustomId(`season:claim:${userId}:${view.index}`)
        .setLabel('Claim').setStyle(ButtonStyle.Success),
    )],
  };
  attach(embed, payload, 'image', assetImage('banners', 'season'));
  return payload;
}

export function seasonClaimPayload(res: SeasonClaimResult): Payload {
  const parts: string[] = [];
  if (res.rewards.cash) parts.push(`**${res.rewards.cash.toLocaleString()}** cash`);
  if (res.rewards.shards) parts.push(`**${res.rewards.shards}** shards`);
  for (const [foodId, qty] of Object.entries(res.rewards.foods)) {
    parts.push(`${FOODS[foodId as keyof typeof FOODS].name} ×${qty}`);
  }
  for (const rarity of res.eggs) parts.push(`1 **${rarity}** egg`);
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`🎖️ Claimed ${res.claimed.length} reward${res.claimed.length === 1 ? '' : 's'}`)
    .setDescription(parts.join('\n') || 'Nothing to claim.');
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', 'season'));
  return payload;
}
