import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import type { TradeSide } from '../../core/db/schema.js';
import { getOrCreateUser } from '../park/service.js';
import { createTrade, acceptTrade, declineTrade, cancelTrade, expireStale, listTrades, TradeError } from './service.js';
import { parseIdList } from './validate.js';
import { InsufficientFundsError } from '../../core/economy.js';

function summarize(side: TradeSide): string {
  const parts: string[] = [];
  if (side.dinoIds.length) parts.push(`🦕 dinos ${side.dinoIds.join(',')}`);
  if (side.eggIds.length) parts.push(`🥚 eggs ${side.eggIds.join(',')}`);
  if (side.cash) parts.push(`💰 ${side.cash}`);
  if (side.food) parts.push(`🍖 ${side.food}`);
  return parts.join(' + ') || 'nothing';
}

export const tradingModule: ModuleManifest = {
  name: 'trading',
  commands: [
    { data: new SlashCommandBuilder().setName('trade').setDescription('Trade with another player')
        .addSubcommand((s) => s.setName('offer').setDescription('Offer a trade')
          .addUserOption((o) => o.setName('user').setDescription('Who to trade with').setRequired(true))
          .addStringOption((o) => o.setName('give-dinos').setDescription('Your dino ids (comma-separated)'))
          .addStringOption((o) => o.setName('give-eggs').setDescription('Your egg ids'))
          .addIntegerOption((o) => o.setName('give-cash').setDescription('Cash you give').setMinValue(0))
          .addIntegerOption((o) => o.setName('give-food').setDescription('Food you give').setMinValue(0))
          .addStringOption((o) => o.setName('want-dinos').setDescription('Their dino ids you want'))
          .addStringOption((o) => o.setName('want-eggs').setDescription('Their egg ids you want'))
          .addIntegerOption((o) => o.setName('want-cash').setDescription('Cash you want').setMinValue(0))
          .addIntegerOption((o) => o.setName('want-food').setDescription('Food you want').setMinValue(0)))
        .addSubcommand((s) => s.setName('list').setDescription('Your pending trades'))
        .addSubcommand((s) => s.setName('accept').setDescription('Accept a trade')
          .addIntegerOption((o) => o.setName('id').setDescription('Trade id from /trade list').setRequired(true)))
        .addSubcommand((s) => s.setName('decline').setDescription('Decline a trade')
          .addIntegerOption((o) => o.setName('id').setDescription('Trade id').setRequired(true)))
        .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a trade you sent')
          .addIntegerOption((o) => o.setName('id').setDescription('Trade id').setRequired(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        expireStale(ctx, i.user.id);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'offer') {
            const target = i.options.getUser('user', true);
            if (target.bot) { await i.reply({ content: 'You cannot trade with a bot.', flags: MessageFlags.Ephemeral }); return; }
            getOrCreateUser(ctx, target.id, target.displayName);   // ensure the recipient has a park row
            expireStale(ctx, target.id);
            const offer: TradeSide = {
              dinoIds: parseIdList(i.options.getString('give-dinos') ?? ''),
              eggIds: parseIdList(i.options.getString('give-eggs') ?? ''),
              cash: i.options.getInteger('give-cash') ?? 0,
              food: i.options.getInteger('give-food') ?? 0,
            };
            const request: TradeSide = {
              dinoIds: parseIdList(i.options.getString('want-dinos') ?? ''),
              eggIds: parseIdList(i.options.getString('want-eggs') ?? ''),
              cash: i.options.getInteger('want-cash') ?? 0,
              food: i.options.getInteger('want-food') ?? 0,
            };
            const t = createTrade(ctx, i.user.id, target.id, offer, request);
            await i.reply({ content: `🤝 Trade **#${t.id}** sent to <@${target.id}>.\nYou give: ${summarize(offer)}\nYou want: ${summarize(request)}\nThey run \`/trade accept id:${t.id}\`.` });
          } else if (sub === 'list') {
            const trades = listTrades(ctx, i.user.id);
            const lines = trades.length ? trades.map((t) => {
              const dir = t.fromUser === i.user.id ? `→ <@${t.toUser}>` : `← <@${t.fromUser}>`;
              return `**#${t.id}** ${dir} — give ${summarize(t.fromUser === i.user.id ? t.offer : t.request)} / get ${summarize(t.fromUser === i.user.id ? t.request : t.offer)}`;
            }).join('\n') : 'No pending trades.';
            await i.reply({ embeds: [new EmbedBuilder().setTitle('🤝 Pending trades').setDescription(lines).setColor(0x5865F2)] });
          } else if (sub === 'accept') {
            const t = acceptTrade(ctx, i.user.id, i.options.getInteger('id', true));
            await i.reply({ content: `✅ Trade #${t.id} completed!` });
          } else if (sub === 'decline') {
            declineTrade(ctx, i.user.id, i.options.getInteger('id', true));
            await i.reply({ content: '❌ Trade declined.' });
          } else {
            cancelTrade(ctx, i.user.id, i.options.getInteger('id', true));
            await i.reply({ content: '🚫 Trade cancelled.' });
          }
        } catch (e) {
          if (e instanceof TradeError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash/food for that trade.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
  ],
  components: [],
};
