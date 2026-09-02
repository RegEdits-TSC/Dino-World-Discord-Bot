import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { hubView } from './service.js';
import { hubCardPayload } from './embeds.js';

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
        await i.reply({
          ...hubCardPayload(hubView(ctx, i.user.id), i.user.id),
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  ],
  components: [
    {
      prefix: 'hub',
      async execute(ctx, i) {
        const [, action, uid] = i.customId.split(':');
        // Unknown actions are acknowledged before anything else touches the DB.
        if (action !== 'open' && action !== 'refresh') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) {
          await i.reply({ content: 'Not your hub.', flags: MessageFlags.Ephemeral });
          return;
        }
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        const payload = hubCardPayload(hubView(ctx, i.user.id), i.user.id);
        if (action === 'open') {
          // A REPLY, never an update: this id is minted on the park card and on the alert
          // DM, and updating would replace the surface the player clicked from.
          await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
          return;
        }
        // content: '' clears a result line an earlier hub:feedall wrote; attachments: []
        // sheds the previous render's uploads.
        await i.update({ content: '', ...payload, attachments: [] });
      },
    },
  ],
};
