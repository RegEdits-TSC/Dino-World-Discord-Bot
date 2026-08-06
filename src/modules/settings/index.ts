import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';

export const settingsModule: ModuleManifest = {
  name: 'settings',
  commands: [
    { data: new SlashCommandBuilder().setName('settings').setDescription('Server settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) => s.setName('channel').setDescription('Set the hatch/expedition notification channel')
          .addChannelOption((o) => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((s) => s.setName('world-news').setDescription('Post the daily world bulletin in the notification channel')
          .addStringOption((o) => o.setName('state').setDescription('On or off').setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }))),
      async execute(ctx, i) {
        if (!i.guildId) { await i.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral }); return; }
        const sub = i.options.getSubcommand();
        if (sub === 'world-news') {
          const on = i.options.getString('state', true) === 'on';
          // Its OWN upsert: the channel branch's onConflictDoUpdate sets only
          // notifyChannelId, and reusing it here would blank the other field.
          ctx.db.insert(schema.guildSettings).values({ guildId: i.guildId, worldBroadcast: on })
            .onConflictDoUpdate({ target: schema.guildSettings.guildId, set: { worldBroadcast: on } }).run();
          // /settings world-news on can legitimately succeed before a notification
          // channel is ever set — worldBroadcastHandler requires BOTH worldBroadcast
          // and a non-null notifyChannelId, so promising a post here would be wrong
          // for a guild that hasn't run /settings channel yet.
          const gs = ctx.db.select().from(schema.guildSettings).where(eq(schema.guildSettings.guildId, i.guildId)).get();
          const onMsg = gs?.notifyChannelId
            ? '🗞️ The daily world bulletin will post in the notification channel.'
            : '🗞️ The daily world bulletin is on, but no notification channel is set yet — run `/settings channel` first, or nothing will post.';
          await i.reply({ content: on ? onMsg : '🗞️ The daily world bulletin is now off.', flags: MessageFlags.Ephemeral });
          return;
        }
        const channelId = i.options.getChannel('channel', true).id;
        ctx.db.insert(schema.guildSettings).values({ guildId: i.guildId, notifyChannelId: channelId })
          .onConflictDoUpdate({ target: schema.guildSettings.guildId, set: { notifyChannelId: channelId } }).run();
        await i.reply({ content: `🔔 Notifications will post in <#${channelId}>.`, flags: MessageFlags.Ephemeral });
      } },
  ],
  components: [],
};
