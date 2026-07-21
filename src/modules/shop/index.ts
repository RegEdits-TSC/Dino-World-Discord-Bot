import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import type { Rarity } from '../../data/types.js';
import { getOrCreateUser } from '../park/service.js';
import { dailyEggOffers, buyEgg, buyFood, ShopError } from './service.js';
import { sellDino, previewSell, ShardError } from './shards.js';
import { SHOP_EGG_PRICES, FOOD_BUNDLES, FOOD_UNIT_COST } from '../../data/shop.js';
import { DECOR } from '../../data/decor.js';
import { InsufficientFundsError } from '../../core/economy.js';

const eggRarityChoices = (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((r) => ({ name: r, value: r }));

export const shopModule: ModuleManifest = {
  name: 'shop',
  commands: [
    { data: new SlashCommandBuilder().setName('shop').setDescription('Buy eggs, food, and decor')
        .addSubcommand((s) => s.setName('view').setDescription("Today's shop"))
        .addSubcommand((s) => s.setName('egg').setDescription('Buy an egg')
          .addStringOption((o) => o.setName('rarity').setDescription('Egg rarity').setRequired(true).addChoices(...eggRarityChoices)))
        .addSubcommand((s) => s.setName('food').setDescription('Buy food units')
          .addIntegerOption((o) => o.setName('units').setDescription('How many').setRequired(true).setMinValue(1))),
      async execute(ctx, i) {
        const user = getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'view') {
            const offers = dailyEggOffers(user.ratingHighWater, ctx.now());
            const eggLines = offers.length ? offers.map((r) => `• ${r} egg — ${SHOP_EGG_PRICES[r].toLocaleString()} cash`).join('\n') : 'No eggs today.';
            const foodLine = FOOD_BUNDLES.map((b) => `${b} food (${b * FOOD_UNIT_COST} cash)`).join(' · ');
            const decorLine = Object.values(DECOR).map((d) => `${d.name} (${d.cost})`).join(' · ');
            await i.reply({ embeds: [new EmbedBuilder().setTitle('🏪 Shop — today').setColor(0x5865F2).addFields(
              { name: '🥚 Eggs (/shop egg)', value: eggLines },
              { name: '🍖 Food (/shop food)', value: foodLine },
              { name: '🌴 Decor (/decorate)', value: decorLine },
            )] });
          } else if (sub === 'egg') {
            const rarity = i.options.getString('rarity', true) as Rarity;
            const offers = dailyEggOffers(user.ratingHighWater, ctx.now());
            if (!offers.includes(rarity)) { await i.reply({ content: `A ${rarity} egg isn't in today's rotation — see /shop view.`, flags: MessageFlags.Ephemeral }); return; }
            const egg = buyEgg(ctx, i.user.id, rarity);
            await i.reply({ content: `🥚 Bought a ${egg.rarity} egg (#${egg.id}). Incubate it with /incubate ${egg.id}.` });
          } else {
            buyFood(ctx, i.user.id, i.options.getInteger('units', true));
            await i.reply({ content: '🍖 Food purchased.' });
          }
        } catch (e) {
          if (e instanceof ShopError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
    { data: new SlashCommandBuilder().setName('sell').setDescription('Sell a dino for cash + shards')
        .addIntegerOption((o) => o.setName('dino').setDescription('Dino id from /dino list').setRequired(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const dinoId = i.options.getInteger('dino', true);
        try {
          const p = previewSell(ctx, i.user.id, dinoId);
          if (!p.sellable) { await i.reply({ content: 'That dino cannot be sold (Mythic or locked).', flags: MessageFlags.Ephemeral }); return; }
          const shardText = p.capReached ? '0 shards (daily cap reached)' : `${p.minShards}–${p.maxShards} shards`;
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`sell:confirm:${dinoId}`).setLabel('💰 Confirm sale').setStyle(ButtonStyle.Danger));
          await i.reply({ content: `Sell dino #${dinoId} for ${p.cashValue.toLocaleString()} cash + ${shardText}?`, components: [row], flags: MessageFlags.Ephemeral });
        } catch (e) { if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      } },
  ],
  components: [
    { prefix: 'sell', async execute(ctx, i) {
        const [, action, idStr] = i.customId.split(':');
        if (action !== 'confirm') return;
        try {
          const res = sellDino(ctx, i.user.id, Number(idStr));
          const cap = res.capped ? ' (shard cap reached)' : '';
          await i.update({ content: `💰 Sold for **${res.cash.toLocaleString()}** cash and **${res.shards}** shards${cap}.`, components: [] });
        } catch (e) { if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      } },
  ],
};
