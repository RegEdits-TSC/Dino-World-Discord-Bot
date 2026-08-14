import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser } from '../park/service.js';
import { topPlayers, playerRank, type Metric, type Scope } from './service.js';
import { assetImage, attach } from '../../core/images.js';
import { emojiTag } from '../../core/emojis.js';
import { visitPayload } from '../park/visit.js';

// Never call emojiTag at module scope — the app-emoji map loads after the
// client is ready, so a module-level constant would freeze the unicode
// fallback forever. Compute the label per call instead.
function metricLabel(metric: Metric): string {
  return {
    rating: `${emojiTag('dw_star')} Rating`,
    cash: `${emojiTag('dw_cash')} Cash`,
    collection: '🦕 Collection',
    legacy: '🏛️ Legacy',
    stars: '⭐ Battle Stars',
    duels: '⚔️ Duel Rating',
    season: '🎖️ Season',
  }[metric];
}
function formatValue(metric: Metric, value: number): string {
  return metric === 'rating' ? (value / 100).toFixed(1) : value.toLocaleString();
}

// Up to five Visit buttons, one per top row — discovery starts from the board you are
// already reading. Discord allows five buttons per action row and the board shows ten.
// Unlike pageRow these carry NO viewer id: the message is public and the path is
// read-only, so the id segment is the TARGET park, not an owner. Worst case is 30 of
// Discord's 100 customId characters ('top:visit:' — 10 — plus a 20-digit snowflake).
// No setEmoji anywhere here — a tag that resolves to '' throws rather than degrading.
function visitRow(rows: Array<{ userId: string }>) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...rows.slice(0, 5).map((r, idx) =>
      new ButtonBuilder().setCustomId(`top:visit:${r.userId}`)
        .setLabel(`Visit #${idx + 1}`).setStyle(ButtonStyle.Secondary)),
  );
}

export const leaderboardsModule: ModuleManifest = {
  name: 'leaderboards',
  commands: [
    { data: new SlashCommandBuilder().setName('top').setDescription('Leaderboards')
        .addStringOption((o) => o.setName('metric').setDescription('Rank by').setRequired(true)
          .addChoices(
            { name: 'rating', value: 'rating' },
            { name: 'cash', value: 'cash' },
            { name: 'collection', value: 'collection' },
            { name: 'legacy', value: 'legacy' },
            { name: 'stars', value: 'stars' },
            { name: 'duels', value: 'duels' },
            { name: 'season', value: 'season' },
          ))
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
        const payload: {
          embeds: EmbedBuilder[];
          components: ActionRowBuilder<ButtonBuilder>[];
          files?: AttachmentBuilder[];
        } = { embeds: [embed], components: rows.length ? [visitRow(rows)] : [] };
        attach(embed, payload, 'image', assetImage('banners', 'leaderboards'));
        await i.reply(payload);
      } },
  ],
  components: [
    {
      prefix: 'top',
      async execute(ctx, i) {
        const [, action, targetId] = i.customId.split(':');
        // Unknown actions absorb rather than erroring — the dex/ach/alert discipline, so
        // a customId shape from an older deploy never shows "This interaction failed".
        if (action !== 'visit') { await i.deferUpdate(); return; }
        // The existence check stays AHEAD of the defer: deferReply commits this interaction
        // to a PUBLIC message, so answering the miss afterwards posted "That player has no
        // park yet" to the whole channel. Both sibling surfaces (/park view user:,
        // park:tour) answer that same condition ephemerally.
        const target = ctx.db.select().from(schema.users)
          .where(eq(schema.users.discordId, targetId)).get();
        if (!target) { await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral }); return; }
        // deferReply + editReply, never i.update: the leaderboard these buttons sit on
        // must survive the click. Rendering a park runs a worker render, so the defer is
        // also what keeps this inside Discord's 3-second window.
        await i.deferReply();
        await i.editReply((await visitPayload(ctx, targetId))!);
      },
    },
  ],
};
