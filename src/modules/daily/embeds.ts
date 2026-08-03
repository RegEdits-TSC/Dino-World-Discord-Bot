import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { assetImage, attach } from '../../core/images.js';
import { emojiTag } from '../../core/emojis.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { FOODS, type FoodId } from '../../data/foods.js';
import { nextChestAt } from '../../data/quests.js';
import { ACHIEVEMENTS, TIER_NAMES } from '../../data/achievements.js';
import { questProgress, achievementsView, claimAchievements, type ClaimResult, type TrackView } from './service.js';

export interface Payload { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }

export function bar(cur: number, target: number): string {
  const filled = Math.max(0, Math.min(5, Math.floor((cur / target) * 5)));
  return '▰'.repeat(filled) + '▱'.repeat(5 - filled);
}

// Bronze/silver/gold/platinum, index-aligned with `def.tiers[i]` — 0-based
// throughout the module (achievementsView, claimAchievements, TIER_NAMES).
const TIER_GLYPHS = ['🥉', '🥈', '🥇', '🏆'];

function tierGlyphs(claimedTiers: Set<number>): string {
  return TIER_GLYPHS.filter((_, tier) => claimedTiers.has(tier)).join('');
}

// The bar/fraction track RAW STAT PROGRESS toward the next tier the value hasn't
// crossed yet — independent of claim status, so a crossed-but-unclaimed tier still
// reads as "MAXED"/full rather than looking stuck behind a lower threshold. The medal
// glyphs are the separate, permanent record of what's actually been claimed.
function trackLine(v: TrackView): string {
  const glyphs = tierGlyphs(v.claimedTiers);
  const nextTier = v.def.tiers.findIndex((threshold) => v.value < threshold);
  if (nextTier === -1) return `${glyphs} MAXED`.trim();
  const nextThreshold = v.def.tiers[nextTier];
  return `${glyphs} ${bar(v.value, nextThreshold)} ${v.value}/${nextThreshold}`.trim();
}

export function hubPayload(ctx: Ctx, userId: string): Payload {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  const lines = questProgress(ctx, userId).map((v) => (v.complete || v.row.claimedAt !== null)
    ? `✅ ${v.def.description}`
    : `${emojiTag('dw_quest')} ${v.def.description} ${bar(v.progress, v.row.target)} ${v.progress}/${v.row.target}`);
  const nextChest = nextChestAt(user.questStreak, user.questStreakBest);
  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle('📅 Daily Quests')
    .setDescription(lines.join('\n'))
    .addFields({
      name: `${emojiTag('dw_streak')} Streak: ${user.questStreak} day${user.questStreak === 1 ? '' : 's'}`,
      value: `Next chest at day ${nextChest}.`,
    });
  const payload: Payload = {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`daily:claim:${userId}`).setLabel('Claim').setStyle(ButtonStyle.Success),
    )],
  };
  attach(embed, payload, 'image', assetImage('banners', 'daily'));
  return payload;
}

export function claimPayload(result: ClaimResult): Payload {
  const lines = result.claimed.map((v) => `✅ ${v.def.description}`);
  const rewardParts: string[] = [];
  if (result.rewards.cash) rewardParts.push(`${emojiTag('dw_cash') || '💰'} ${result.rewards.cash.toLocaleString('en-US')} cash`);
  if (result.rewards.shards) rewardParts.push(`${emojiTag('dw_shard') || '💎'} ${result.rewards.shards.toLocaleString('en-US')} shards`);
  for (const [id, qty] of Object.entries(result.rewards.foods) as [FoodId, number][]) {
    rewardParts.push(`${FOODS[id].fallback} ${FOODS[id].name} ×${qty}`);
  }
  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle('📅 Quests claimed')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Rewards', value: rewardParts.join(', ') });
  if (result.chest) {
    const chestParts: string[] = [];
    if (result.chest.cash) chestParts.push(`${result.chest.cash.toLocaleString('en-US')} cash`);
    if (result.chest.shards) chestParts.push(`${result.chest.shards.toLocaleString('en-US')} shards`);
    if (result.chest.eggRarity) chestParts.push(`a ${result.chest.eggRarity} egg`);
    embed.addFields({
      name: 'Chest!',
      value: `${emojiTag('dw_chest')} ${result.chest.streak}-day chest: ${chestParts.join(', ')}`,
    });
  }
  return { embeds: [embed] };
}

// Follows the /dino list pagination idiom exactly (src/modules/park/index.ts,
// dinoListPayload): the payload builder calls the read service itself, paginate()
// clamps the page, and the page row only renders once there's more than one page.
export function achievementsPayload(ctx: Ctx, userId: string, page: number): Payload {
  const all = achievementsView(ctx, userId);
  const { items, page: p, pages } = paginate(all, page);
  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle('🏆 Achievements')
    .addFields(items.map((v) => ({ name: v.def.name, value: trackLine(v) })))
    .setFooter({ text: `Page ${p}/${pages}` });
  const payload: Payload = {
    embeds: [embed],
    components: [
      ...(pages > 1 ? [pageRow('ach', 'page', userId, p, pages)] : []),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ach:claimall:${userId}`).setLabel('Claim all').setStyle(ButtonStyle.Success),
      ),
    ],
  };
  attach(embed, payload, 'image', assetImage('banners', 'achievements'));
  return payload;
}

export function claimAllPayload(result: ReturnType<typeof claimAchievements>): Payload {
  const lines = result.claimed.map((c) => {
    const def = ACHIEVEMENTS.find((a) => a.id === c.trackId)!;
    return `✅ ${def.name} — ${TIER_NAMES[c.tier]}`;
  });
  const rewardParts: string[] = [];
  if (result.cash) rewardParts.push(`${emojiTag('dw_cash') || '💰'} ${result.cash.toLocaleString('en-US')} cash`);
  if (result.shards) rewardParts.push(`${emojiTag('dw_shard') || '💎'} ${result.shards.toLocaleString('en-US')} shards`);
  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle('🏆 Achievements claimed')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Rewards', value: rewardParts.join(', ') });
  return { embeds: [embed] };
}
