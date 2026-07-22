import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { eq, or } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { requireOwner } from './guard.js';
import { adminGive, adminReset, adminFastForward, AdminError } from './service.js';

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

function inspectEmbed(ctx: Ctx, targetId: string, displayName: string): EmbedBuilder | null {
  const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, targetId)).get();
  if (!u) return null;
  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, targetId)).all();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, targetId)).all();
  const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, targetId)).all();
  const trades = ctx.db.select().from(schema.trades)
    .where(or(eq(schema.trades.fromUser, targetId), eq(schema.trades.toUser, targetId))).all()
    .filter((t) => t.status === 'pending').length;
  const exps = ctx.db.select().from(schema.expeditions).where(eq(schema.expeditions.userId, targetId)).all()
    .filter((e) => e.claimedAt === null).length;
  const line = (s: string) => (s.length ? s.slice(0, 1024) : 'none');
  return new EmbedBuilder().setTitle(`🔧 ${displayName} (${targetId})`).setColor(0x9b59d0).addFields(
    { name: '💰 / 🍖 / 💎', value: `${u.cash} / ${u.food} / ${u.shards}`, inline: true },
    { name: '⭐ Rating', value: `${(u.parkRating / 100).toFixed(1)} (hw ${(u.ratingHighWater / 100).toFixed(1)})`, inline: true },
    { name: '🦕 Dinos', value: line(dinos.map((d) => `#${d.id} ${d.speciesId}${d.escapedAt !== null ? ' 🚨' : ''}${d.lotId ? ` @${d.lotId}` : ''}`).join('\n')), inline: false },
    { name: '🥚 Eggs', value: line(eggs.map((e) => `#${e.id} ${e.rarity}${e.incubationStartedAt ? ' (incubating)' : ''}`).join('\n')), inline: false },
    { name: '🏗️ Lots', value: line(lots.map((l) => `#${l.id} ${l.kind} lv${l.level}`).join('\n')), inline: false },
    { name: '🤝 Trades / 🧭 Expeditions', value: `${trades} pending / ${exps} active`, inline: false },
  );
}

export const adminModule: ModuleManifest = {
  name: 'admin',
  commands: [
    { data: new SlashCommandBuilder().setName('admin').setDescription('Owner tools')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((s) => s.setName('give').setDescription('Grant resources to a player')
          .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
          .addIntegerOption((o) => o.setName('cash').setDescription('Cash').setMinValue(0))
          .addIntegerOption((o) => o.setName('food').setDescription('Food').setMinValue(0))
          .addIntegerOption((o) => o.setName('shards').setDescription('Shards').setMinValue(0))
          .addStringOption((o) => o.setName('egg-rarity').setDescription('Grant an egg of this rarity')
            .addChoices(...RARITIES.map((r) => ({ name: r, value: r }))))
          .addStringOption((o) => o.setName('dino-species').setDescription('Grant a dino of this species id')))
        .addSubcommand((s) => s.setName('inspect').setDescription('Dump a player’s raw state')
          .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true)))
        .addSubcommand((s) => s.setName('reset').setDescription('Reset a player to a fresh start')
          .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
          .addStringOption((o) => o.setName('confirm').setDescription('Type the player’s user id to confirm').setRequired(true)))
        .addSubcommand((s) => s.setName('fast-forward').setDescription('Advance a player’s clock (QA)')
          .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
          .addIntegerOption((o) => o.setName('hours').setDescription('Hours to advance (1-720)').setRequired(true).setMinValue(1).setMaxValue(720))),
      async execute(ctx, i) {
        if (!(await requireOwner(ctx, i))) return;
        const target = i.options.getUser('user', true);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'give') {
            adminGive(ctx, target.id, target.displayName, {
              cash: i.options.getInteger('cash') ?? 0,
              food: i.options.getInteger('food') ?? 0,
              shards: i.options.getInteger('shards') ?? 0,
              eggRarity: (i.options.getString('egg-rarity') as Rarity | null) ?? undefined,
              dinoSpecies: i.options.getString('dino-species') ?? undefined,
            });
            await i.reply({ content: `✅ Gave resources to <@${target.id}>.`, flags: MessageFlags.Ephemeral });
          } else if (sub === 'inspect') {
            settleEscapes(ctx, target.id);
            const embed = inspectEmbed(ctx, target.id, target.displayName);
            if (!embed) { await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral }); return; }
            await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          } else if (sub === 'reset') {
            const confirm = i.options.getString('confirm', true);
            if (confirm !== target.id) {
              await i.reply({ content: `To reset, set \`confirm\` to the player's id: \`${target.id}\``, flags: MessageFlags.Ephemeral });
              return;
            }
            const exists = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, target.id)).get();
            if (!exists) { await i.reply({ content: 'That player has no park to reset.', flags: MessageFlags.Ephemeral }); return; }
            adminReset(ctx, target.id);
            await i.reply({ content: `♻️ Reset <@${target.id}> to a fresh start.`, flags: MessageFlags.Ephemeral });
          } else if (sub === 'fast-forward') {
            getOrCreateUser(ctx, target.id, target.displayName);
            const escaped = adminFastForward(ctx, target.id, i.options.getInteger('hours', true));
            await i.reply({ content: `⏩ Fast-forwarded <@${target.id}>. ${escaped} dino(s) escaped.`, flags: MessageFlags.Ephemeral });
          } else {
            throw new AdminError('Unknown subcommand.');
          }
        } catch (e) {
          if (e instanceof AdminError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
  ],
  components: [],
};
