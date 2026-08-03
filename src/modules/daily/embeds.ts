import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { assetImage, attach } from '../../core/images.js';
import { emojiTag } from '../../core/emojis.js';
import { FOODS, type FoodId } from '../../data/foods.js';
import { nextChestAt } from '../../data/quests.js';
import { questProgress, type ClaimResult } from './service.js';

export interface Payload { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }

export function bar(cur: number, target: number): string {
  const filled = Math.max(0, Math.min(5, Math.floor((cur / target) * 5)));
  return '▰'.repeat(filled) + '▱'.repeat(5 - filled);
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
