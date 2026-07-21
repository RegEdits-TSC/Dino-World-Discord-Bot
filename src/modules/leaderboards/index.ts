import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { topPlayers, type Metric, type Scope } from './service.js';

const METRIC_LABEL: Record<Metric, string> = { rating: '⭐ Rating', cash: '💰 Cash', collection: '🦕 Collection' };
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
        await i.reply({ embeds: [new EmbedBuilder()
          .setTitle(`🏆 Top ${METRIC_LABEL[metric]} — ${scope}`)
          .setDescription(body).setColor(0xf1c40f)] });
      } },
  ],
  components: [],
};
