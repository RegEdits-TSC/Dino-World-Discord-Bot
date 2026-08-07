import { SlashCommandBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { worldPayload } from './embeds.js';

export const worldModule: ModuleManifest = {
  name: 'world',
  commands: [
    {
      data: new SlashCommandBuilder().setName('world')
        .setDescription("Today's world event, the season, and what changes"),
      async execute(ctx, i) {
        await i.reply(worldPayload(ctx.now()));
      },
    },
  ],
  components: [],
};
