import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';

export const hubModule: ModuleManifest = {
  name: 'hub',
  commands: [
    {
      data: new SlashCommandBuilder().setName('hub')
        .setDescription('What to do now — what is ready, what needs you, what you can claim'),
      async execute(ctx, i) {
        // getOrCreateUser BEFORE settleEscapes, and both before any read: settleEscapes
        // goes through toClockDinos, which asserts the users row with `.get()!` and throws
        // a TypeError without one. This is the same entry sequence /feed all uses
        // (src/modules/care/index.ts).
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        await i.reply({ content: 'The hub is not wired up yet.', flags: MessageFlags.Ephemeral });
      },
    },
  ],
  components: [],
};
