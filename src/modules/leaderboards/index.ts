import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { topPlayers, playerRank, type Metric, type Scope } from './service.js';
import { assetImage, attach } from '../../core/images.js';
import { emojiTag } from '../../core/emojis.js';

// Never call emojiTag at module scope — the app-emoji map loads after the
// client is ready, so a module-level constant would freeze the unicode
// fallback forever. Compute the label per call instead.
//
// Metric was widened (to add 'legacy' | 'stars') ahead of this command surface
// gaining those choices — the `addChoices` list below still only offers the
// original three, so this function can never actually be called with the new
// values yet. The `as` narrowing is only here to keep this object-literal
// lookup assignable to the wider union; a later change adds real labels for
// the new metrics alongside their command choices.
function metricLabel(metric: Metric): string {
  return { rating: `${emojiTag('dw_star')} Rating`, cash: `${emojiTag('dw_cash')} Cash`, collection: '🦕 Collection' }[metric as 'rating' | 'cash' | 'collection'];
}
function formatValue(metric: Metric, value: number): string {
  return metric === 'rating' ? (value / 100).toFixed(1) : value.toLocaleString();
}

export const leaderboardsModule: ModuleManifest = {
  name: 'leaderboards',
  commands: [
    { data: new SlashCommandBuilder().setName('top').setDescription('Leaderboards')
        .addStringOption((o) => o.setName('metric').setDescription('Rank by').setRequired(true)
          .addChoices({ name: 'rating', value: 'rating' }, { name: 'cash', value: 'cash' }, { name: 'collection', value: 'collection' }))
        .addStringOption((o) => o.setName('scope').setDescription('server or global')
          .addChoices({ name: 'server', value: 'server' }, { name: 'global', value: 'global' })),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const metric = i.options.getString('metric', true) as Metric;
        const scope = (i.options.getString('scope') as Scope | null) ?? (i.guildId ? 'server' : 'global');
        const rows = topPlayers(ctx, metric, scope, i.guildId);
        const body = rows.length
          ? rows.map((r, idx) => `**${idx + 1}.** ${r.displayName} — ${formatValue(metric, r.value)}`).join('\n')
          : 'No players yet.';
        const embed = new EmbedBuilder()
          .setTitle(`🏆 Top ${metricLabel(metric)} — ${scope}`)
          .setDescription(body).setColor(0xf1c40f);
        if (!rows.some((r) => r.userId === i.user.id)) {
          const mine = playerRank(ctx, metric, scope, i.guildId, i.user.id);
          if (mine) embed.setFooter({ text: `Your rank: #${mine.rank} — ${formatValue(metric, mine.value)}` });
        }
        const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
        attach(embed, payload, 'image', assetImage('banners', 'leaderboards'));
        await i.reply(payload);
      } },
  ],
  components: [],
};
