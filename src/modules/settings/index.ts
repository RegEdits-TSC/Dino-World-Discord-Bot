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
          .addChannelOption((o) => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true))),
      async execute(ctx, i) {
        if (!i.guildId) { await i.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral }); return; }
        const channelId = i.options.getChannel('channel', true).id;
        ctx.db.insert(schema.guildSettings).values({ guildId: i.guildId, notifyChannelId: channelId })
          .onConflictDoUpdate({ target: schema.guildSettings.guildId, set: { notifyChannelId: channelId } }).run();
        await i.reply({ content: `🔔 Notifications will post in <#${channelId}>.`, flags: MessageFlags.Ephemeral });
      } },
  ],
  components: [],
};
