import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { resolveDuel, DuelError } from './service.js';
import { duelResultPayload, DUEL_PREFIX } from './embeds.js';

export const duelsModule: ModuleManifest = {
  name: 'duels',
  commands: [
    {
      data: new SlashCommandBuilder().setName('duel').setDescription('Exhibition duels — free, and pay nothing but a record')
        .addSubcommand((s) => s.setName('ghost').setDescription("Duel a snapshot of another player's squad")
          .addUserOption((o) => o.setName('opponent').setDescription('Who to duel').setRequired(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        if (sub === 'ghost') {
          const target = i.options.getUser('opponent', true);
          if (target.id === i.user.id) {
            await i.reply({ content: "You can't duel yourself.", flags: MessageFlags.Ephemeral });
            return;
          }
          if (target.bot) {
            await i.reply({ content: 'You cannot duel a bot.', flags: MessageFlags.Ephemeral });
            return;
          }
          // The challenger ran a command, so settling their escapes here is exactly the
          // documented rule. The DEFENDER is never settled — duelSquad evaluates their
          // escapes read-only instead.
          settleEscapes(ctx, i.user.id);
          try {
            const outcome = resolveDuel(ctx, i.user.id, target.id, 'ghost');
            await i.reply(duelResultPayload(outcome));
          } catch (e) {
            if (e instanceof DuelError) {
              await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              return;
            }
            throw e;
          }
          return;
        }
        // Never the /park dispatch trap: an unrecognised subcommand reports failure
        // rather than silently rendering something plausible.
        await i.reply({ content: 'Unknown /duel subcommand.', flags: MessageFlags.Ephemeral });
      },
    },
  ],
  components: [
    {
      prefix: DUEL_PREFIX,
      async execute(ctx, i) {
        // Placeholder until Task 8: absorb unknown actions rather than letting Discord
        // show "This interaction failed" (the dex/ach/top discipline).
        await i.deferUpdate();
      },
    },
  ],
};
