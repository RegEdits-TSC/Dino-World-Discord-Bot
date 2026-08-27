import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { eq, or } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { allSpecies } from '../../data/species/index.js';
import { matches, respondRanked, emptyRow } from '../../core/autocomplete.js';
import { requireOwner } from './guard.js';
import { adminGive, adminReset, adminFastForward, adminReverse, AdminError, NOTE_MAX } from './service.js';
import { FOODS, type FoodId } from '../../data/foods.js';
import { emojiTag } from '../../core/emojis.js';
import { ledgerPayload } from './ledger.js';

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
    { name: `${emojiTag('dw_cash')} / ${emojiTag('dw_food')} / ${emojiTag('dw_shard')}`,
      value: `${u.cash} / ${Object.entries(ctx.economy.getFoodInventory(targetId)).map(([id, q]) => `${id}:${q}`).join(' ') || '0'} / ${u.shards}`, inline: true },
    { name: `${emojiTag('dw_star')} Rating`, value: `${(u.parkRating / 100).toFixed(1)} (hw ${(u.ratingHighWater / 100).toFixed(1)})`, inline: true },
    { name: '🦕 Dinos', value: line(dinos.map((d) => `#${d.id} ${d.speciesId}${d.escapedAt !== null ? ` ${emojiTag('dw_alert')}` : ''}${d.lotId ? ` @${d.lotId}` : ''}`).join('\n')), inline: false },
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
          .addStringOption((o) => o.setName('food-item').setDescription('Food item')
            .addChoices(...Object.values(FOODS).map((f) => ({ name: f.name, value: f.id }))))
          .addIntegerOption((o) => o.setName('food-qty').setDescription('Food quantity').setMinValue(1))
          .addIntegerOption((o) => o.setName('shards').setDescription('Shards').setMinValue(0))
          .addStringOption((o) => o.setName('egg-rarity').setDescription('Grant an egg of this rarity')
            .addChoices(...RARITIES.map((r) => ({ name: r, value: r }))))
          .addStringOption((o) => o.setName('dino-species').setDescription('Species — type to search').setAutocomplete(true)))
        .addSubcommand((s) => s.setName('inspect').setDescription('Dump a player’s raw state')
          .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true)))
        .addSubcommand((s) => s.setName('ledger').setDescription('Read a player’s transaction ledger')
          .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
          .addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1)))
        .addSubcommand((s) => s.setName('reverse').setDescription('Reverse one ledger transaction')
          .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
          .addIntegerOption((o) => o.setName('tx').setDescription('Transaction id').setRequired(true).setMinValue(1))
          .addStringOption((o) => o.setName('note').setDescription('Reason — also queued to the player').setMaxLength(NOTE_MAX)))
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
            const foodItem = i.options.getString('food-item') as FoodId | null;
            const foodQty = i.options.getInteger('food-qty');
            if ((foodItem === null) !== (foodQty === null)) {
              await i.reply({ content: 'Set both food-item and food-qty, or neither.', flags: MessageFlags.Ephemeral });
              return;
            }
            adminGive(ctx, target.id, target.displayName, {
              cash: i.options.getInteger('cash') ?? 0,
              food: foodItem && foodQty ? { foodId: foodItem, qty: foodQty } : undefined,
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
          } else if (sub === 'ledger') {
            const page = i.options.getInteger('page') ?? 1;
            await i.reply({ ...ledgerPayload(ctx, target.id, page), flags: MessageFlags.Ephemeral });
          } else if (sub === 'reverse') {
            const out = adminReverse(ctx, target.id, i.options.getInteger('tx', true),
              i.options.getString('note') ?? undefined);
            // "queued", never "sent": adminReverse passes a null origin guild, so
            // deliverNotification skips the channel branch entirely and this note is a DM —
            // and a DM to a player who has closed them fails silently, so claiming delivery
            // would imply a confirmation the bot never gets. NOT a mute claim:
            // users.alertsEnabled gates the park alert sweep, never this path, so
            // /park alerts off does not stop a reversal note.
            await i.reply({
              // The row, the amount and the resulting balance, all three. The redundant `user`
              // option cannot catch a transposed digit that still lands on a row belonging to
              // the right player — reading them back is what makes that visible before it
              // becomes a support ticket. No side-effect clause when it is empty: a payout
              // under a reason the table has never heard of, where the fallback text would
              // only be noise. A reason WITH an entry always prints: see sideEffectNoteFor.
              content: `↩ Reversed #${out.txId} for <@${target.id}>: ${out.moved}.`
                + ` They now hold ${out.balance}.`
                + (out.sideEffect ? ` Not undone: ${out.sideEffect}.` : '')
                + (out.notified ? ' Note queued to the player.' : ''),
              flags: MessageFlags.Ephemeral,
            });
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
      },
      async autocomplete(ctx, i) {
        if (i.user.id !== ctx.config.ownerId) { await i.respond([]); return; }
        const focused = i.options.getFocused(true);
        if (i.options.getSubcommand() !== 'give' || focused.name !== 'dino-species') { await i.respond([]); return; }
        const q = String(focused.value);
        const hits = allSpecies().filter((s) => matches(q, s.id, s.name, s.rarity));
        if (!hits.length) { await respondRanked(i, [emptyRow('No species match', '-')]); return; }
        await respondRanked(i, hits.map((s) => ({
          value: s.id, valid: true, label: `${s.name} (${s.rarity}, ${s.diet})`,
        })));
      } },
  ],
  components: [
    {
      // Component prefixes are matched against customId.split(':')[0] (ModuleRegistry.
      // findComponent), so this MUST be the single segment 'admin', not 'admin:ledger' —
      // every other module's component prefix follows the same convention (e.g. 'park'
      // dispatches park:tab, park:vtab, park:tour, ... internally, never one prefix per
      // action). Only one components entry may carry prefix 'admin' (the duplicate-prefix
      // check flattens every component in this array), so a future admin action switches
      // on the id's own action segment the same way, rather than adding a second entry.
      prefix: 'admin',
      async execute(ctx, i) {
        const [, action, targetId, pageStr] = i.customId.split(':');
        if (action !== 'ledger') { await i.deferUpdate(); return; }
        // The id segment is the TARGET, not the clicker — the park:tour precedent — so the
        // gate is ownership of the BOT, never a match against the segment.
        if (i.user.id !== ctx.config.ownerId) { await i.deferUpdate(); return; }
        await i.update(ledgerPayload(ctx, targetId!, Number(pageStr)));
      },
    },
  ],
};
