import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { startExpedition, claimExpedition, activeExpedition, ExpeditionError } from './service.js';
import { EXPEDITION_SITES } from '../../data/sites.js';
import { InsufficientFundsError } from '../../core/economy.js';

const siteChoices = Object.values(EXPEDITION_SITES).map((s) => ({ name: s.name, value: s.id }));

export const expeditionsModule: ModuleManifest = {
  name: 'expeditions',
  commands: [
    { data: new SlashCommandBuilder().setName('expedition').setDescription('Send a dig crew out')
        .addSubcommand((s) => s.setName('start').setDescription('Start an expedition')
          .addStringOption((o) => o.setName('site').setDescription('Dig site').setRequired(true).addChoices(...siteChoices)))
        .addSubcommand((s) => s.setName('status').setDescription('Check your active expedition'))
        .addSubcommand((s) => s.setName('claim').setDescription('Claim a returned expedition')),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'start') {
            const exp = startExpedition(ctx, i.user.id, i.options.getString('site', true), i.guildId);
            await i.reply({ content: `🧭 Crew dispatched to **${EXPEDITION_SITES[exp.siteId].name}** — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.` });
          } else if (sub === 'status') {
            const exp = activeExpedition(ctx, i.user.id);
            await i.reply(exp
              ? { content: exp.returnsAt <= ctx.now() ? '✅ Back! Use /expedition claim.' : `⏳ At **${EXPEDITION_SITES[exp.siteId].name}**, back <t:${Math.floor(exp.returnsAt / 1000)}:R>.` }
              : { content: 'No active expedition. Start one with /expedition start.', flags: MessageFlags.Ephemeral });
          } else {
            const { loot, site } = claimExpedition(ctx, i.user.id);
            await i.reply({ embeds: [new EmbedBuilder().setColor(0xe8590c).setTitle(`🧭 ${site.name} — returned!`)
              .setDescription(`Found a **${loot.eggRarity}** egg!`)
              .addFields({ name: '💰 Cash', value: `+${loot.cash}`, inline: true }, { name: '🍖 Food', value: `+${loot.food}`, inline: true })] });
          }
        } catch (e) {
          if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for that expedition.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
  ],
  components: [],
};
