import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { rollDailyQuests, claimQuests, achievementsView } from './service.js';
import { hubPayload, claimPayload } from './embeds.js';

export const dailyModule: ModuleManifest = {
  name: 'daily',
  commands: [
    {
      data: new SlashCommandBuilder().setName('daily').setDescription('Your daily quests, streak, and chest'),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        rollDailyQuests(ctx, i.user.id);
        await i.reply(hubPayload(ctx, i.user.id));
      },
    },
    {
      data: new SlashCommandBuilder().setName('achievements').setDescription('Your lifetime achievement tracks'),
      // Interim /achievements handler — Task 11 replaces this with the paginated embed.
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const lines = achievementsView(ctx, i.user.id)
          .map((t) => `${t.def.name}: ${t.value}`).join('\n');
        await i.reply({ content: lines, flags: MessageFlags.Ephemeral });
      },
    },
  ],
  components: [
    {
      prefix: 'daily',
      async execute(ctx, i) {
        // The custom id is client-supplied: the owner segment is a plain Discord
        // snowflake string (never parsed to a number), checked directly against
        // the clicker's own id before any read or write happens.
        const [, action, uid] = i.customId.split(':');
        if (action !== 'claim') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) { await i.reply({ content: 'Not your quests.', flags: MessageFlags.Ephemeral }); return; }
        const result = claimQuests(ctx, i.user.id);
        if (!result.claimed.length) {
          await i.reply({ content: 'Nothing to claim — quests reset at UTC midnight.', flags: MessageFlags.Ephemeral });
          return;
        }
        await i.reply({ ...claimPayload(result), flags: MessageFlags.Ephemeral });
      },
    },
  ],
};
