import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { feedDino, feedAll, rescueDino, CareError } from './service.js';
import { InsufficientFundsError } from '../../core/economy.js';

export const careModule: ModuleManifest = {
  name: 'care',
  commands: [
    { data: new SlashCommandBuilder().setName('feed').setDescription('Feed your dinos')
        .addSubcommand((s) => s.setName('one').setDescription('Feed a single dino')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino id from /dino list').setRequired(true)))
        .addSubcommand((s) => s.setName('all').setDescription('Feed every hungry dino, hungriest first')),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        try {
          if (i.options.getSubcommand() === 'all') {
            const { fed, skipped } = feedAll(ctx, i.user.id);
            const msg = fed.length ? `🍖 Fed ${fed.length} dino(s).` : '🍖 Nothing needed feeding.';
            await i.reply({ content: skipped.length ? `${msg} Skipped ${skipped.length} (not enough food).` : msg });
          } else {
            const { species, cost } = feedDino(ctx, i.user.id, i.options.getInteger('dino', true));
            await i.reply({ content: `🍖 Fed your ${species.name} (−${cost} food).` });
          }
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough food — buy some with /shop food.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
    { data: new SlashCommandBuilder().setName('rescue').setDescription('Recapture an escaped dino')
        .addIntegerOption((o) => o.setName('dino').setDescription('Dino id').setRequired(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        try {
          const { species, fee } = rescueDino(ctx, i.user.id, i.options.getInteger('dino', true));
          await i.reply({ content: `🪝 Recaptured your ${species.name} for ${fee.toLocaleString()} cash.` });
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for the recapture fee.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
  ],
  components: [],
};
