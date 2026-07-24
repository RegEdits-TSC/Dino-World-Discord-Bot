import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import type { TradeSide } from '../../core/db/schema.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser } from '../park/service.js';
import { createTrade, acceptTrade, declineTrade, cancelTrade, expireStale, listTrades, TradeError } from './service.js';
import { parseIdList } from './validate.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { matches, respondRanked, emptyRow, listCompleter, type ListCandidate } from '../../core/autocomplete.js';
import { getSpecies } from '../../data/species/index.js';
import { FOODS, type FoodId } from '../../data/foods.js';
import { TRADE_MAX_ITEMS_PER_SIDE } from '../../data/trade.js';
import { paginate, pageRow } from '../../core/paginate.js';
import type { Ctx } from '../../core/context.js';
import { emojiTag, EMOJI_FALLBACK } from '../../core/emojis.js';
import { assetImage } from '../../core/images.js';

// Default formatter is the unicode fallback table, so autocomplete call
// sites (Discord renders custom emoji as literal text there) can call
// summarize(side) unchanged and keep their verbatim-label tests passing.
// Reply/notify call sites pass emojiTag explicitly.
function summarize(side: TradeSide, e: (name: string) => string = (n) => EMOJI_FALLBACK[n] ?? ''): string {
  const parts: string[] = [];
  if (side.dinoIds.length) parts.push(`🦕 dinos ${side.dinoIds.join(',')}`);
  if (side.eggIds.length) parts.push(`🥚 eggs ${side.eggIds.join(',')}`);
  if (side.cash) parts.push(`${e('dw_cash')} ${side.cash}`);
  for (const [id, q] of Object.entries(side.foods)) {
    const f = FOODS[id as FoodId];
    parts.push(`${e(f?.emoji ?? 'dw_food')} ${q} ${f?.name ?? id}`);
  }
  return parts.join(' + ') || 'nothing';
}

function tradeableDinos(ctx: Ctx, userId: string): ListCandidate[] {
  return ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all()
    .filter((d) => !d.locked && d.escapedAt === null && getSpecies(d.speciesId).rarity !== 'mythic')
    .map((d) => {
      const s = getSpecies(d.speciesId);
      return { id: d.id, label: `🦖 ${s.name} (${s.rarity})` };
    });
}

function tradeableEggs(ctx: Ctx, userId: string): ListCandidate[] {
  return ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, userId)).all()
    .filter((e) => !e.locked && e.rarity !== 'mythic' && e.incubationStartedAt === null)
    .map((e) => ({ id: e.id, label: `🥚 ${e.rarity} egg` }));
}

function tradeListPayload(ctx: Ctx, userId: string, page: number) {
  const all = listTrades(ctx, userId);
  const { items, page: p, pages } = paginate(all, page);
  const lines = items.length ? items.map((t) => {
    const dir = t.fromUser === userId ? `→ <@${t.toUser}>` : `← <@${t.fromUser}>`;
    return `**#${t.id}** ${dir} — give ${summarize(t.fromUser === userId ? t.offer : t.request, emojiTag)} / get ${summarize(t.fromUser === userId ? t.request : t.offer, emojiTag)}`;
  }).join('\n') : 'No pending trades.';
  const embed = new EmbedBuilder().setTitle('🤝 Pending trades').setDescription(lines).setColor(0x5865F2)
    .setFooter({ text: `Page ${p}/${pages}` });
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: pages > 1 ? [pageRow('trade', 'list', userId, p, pages)] : [] };
  const banner = assetImage('banners', 'trading');
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  return payload;
}

export const tradingModule: ModuleManifest = {
  name: 'trading',
  commands: [
    { data: new SlashCommandBuilder().setName('trade').setDescription('Trade with another player')
        .addSubcommand((s) => s.setName('offer').setDescription('Offer a trade')
          .addUserOption((o) => o.setName('user').setDescription('Who to trade with').setRequired(true))
          .addStringOption((o) => o.setName('give-dinos').setDescription('Your dinos — type to add, comma-separated').setAutocomplete(true))
          .addStringOption((o) => o.setName('give-eggs').setDescription('Your eggs — type to add, comma-separated').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('give-cash').setDescription('Cash you give').setMinValue(0))
          .addStringOption((o) => o.setName('want-dinos').setDescription('Their dinos — pick the user first').setAutocomplete(true))
          .addStringOption((o) => o.setName('want-eggs').setDescription('Their eggs — pick the user first').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('want-cash').setDescription('Cash you want').setMinValue(0)))
        .addSubcommand((s) => s.setName('list').setDescription('Your pending trades'))
        .addSubcommand((s) => s.setName('accept').setDescription('Accept a trade')
          .addIntegerOption((o) => o.setName('id').setDescription('Trade — type to search').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('decline').setDescription('Decline a trade')
          .addIntegerOption((o) => o.setName('id').setDescription('Trade — type to search').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a trade you sent')
          .addIntegerOption((o) => o.setName('id').setDescription('Trade — type to search').setRequired(true).setAutocomplete(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        expireStale(ctx, i.user.id);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'offer') {
            const target = i.options.getUser('user', true);
            if (target.bot) { await i.reply({ content: 'You cannot trade with a bot.', flags: MessageFlags.Ephemeral }); return; }
            getOrCreateUser(ctx, target.id, target.displayName);   // ensure the recipient has a park row
            expireStale(ctx, target.id);
            const offer: TradeSide = {
              dinoIds: parseIdList(i.options.getString('give-dinos') ?? ''),
              eggIds: parseIdList(i.options.getString('give-eggs') ?? ''),
              cash: i.options.getInteger('give-cash') ?? 0,
              foods: {},
            };
            const request: TradeSide = {
              dinoIds: parseIdList(i.options.getString('want-dinos') ?? ''),
              eggIds: parseIdList(i.options.getString('want-eggs') ?? ''),
              cash: i.options.getInteger('want-cash') ?? 0,
              foods: {},
            };
            const t = createTrade(ctx, i.user.id, target.id, offer, request);
            await i.reply({ content: `🤝 Trade **#${t.id}** sent to <@${target.id}>.\nYou give: ${summarize(offer, emojiTag)}\nYou want: ${summarize(request, emojiTag)}\nThey run \`/trade accept id:${t.id}\`.` });
            // originGuildId is the acting user's guild, so delivery falls back to DM when the counterparty isn't in that guild's notify channel.
            await ctx.notify(target.id, i.guildId,
              `📨 Trade #${t.id} from **${i.user.displayName}** — they give ${summarize(offer, emojiTag)}, they want ${summarize(request, emojiTag)}. Run \`/trade accept id:${t.id}\`.`);
          } else if (sub === 'list') {
            await i.reply(tradeListPayload(ctx, i.user.id, 1));
          } else if (sub === 'accept') {
            const t = acceptTrade(ctx, i.user.id, i.options.getInteger('id', true));
            await i.reply({ content: `✅ Trade #${t.id} completed!` });
            await ctx.notify(t.fromUser, i.guildId, `✅ **${i.user.displayName}** accepted your trade #${t.id}!`);
          } else if (sub === 'decline') {
            const declineId = i.options.getInteger('id', true);
            const declined = ctx.db.select().from(schema.trades).where(eq(schema.trades.id, declineId)).get();
            declineTrade(ctx, i.user.id, declineId);
            await i.reply({ content: '❌ Trade declined.' });
            if (declined) await ctx.notify(declined.fromUser, i.guildId, `❌ Your trade #${declined.id} was declined.`);
          } else {
            cancelTrade(ctx, i.user.id, i.options.getInteger('id', true));
            await i.reply({ content: '🚫 Trade cancelled.' });
          }
        } catch (e) {
          if (e instanceof TradeError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash/food for that trade.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
      async autocomplete(ctx, i) {
        const sub = i.options.getSubcommand();
        if (sub === 'accept' || sub === 'decline' || sub === 'cancel') {
          expireStale(ctx, i.user.id);
          const q = String(i.options.getFocused());
          const trades = listTrades(ctx, i.user.id).filter((t) => matches(q, t.id));
          if (!trades.length) { await respondRanked(i, [emptyRow('No pending trades', 0)]); return; }
          const wantIncoming = sub !== 'cancel';
          await respondRanked(i, trades.map((t) => {
            const incoming = t.toUser === i.user.id;
            const other = incoming ? t.fromUser : t.toUser;
            const otherName = ctx.db.select().from(schema.users)
              .where(eq(schema.users.discordId, other)).get()?.displayName ?? other;
            const mineGive = t.fromUser === i.user.id ? t.offer : t.request;
            const mineGet = t.fromUser === i.user.id ? t.request : t.offer;
            const base = `🤝 #${t.id} ${incoming ? '←' : '→'} ${otherName} — give ${summarize(mineGive)} / get ${summarize(mineGet)}`;
            const valid = incoming === wantIncoming;
            return {
              value: t.id, valid,
              label: valid ? base : `${base} — ${incoming ? 'incoming, use /trade accept' : 'your outgoing, use /trade cancel'}`,
            };
          }));
          return;
        }
        if (sub === 'offer') {
          const focused = i.options.getFocused(true);
          const isWant = focused.name.startsWith('want-');
          const isDino = focused.name.endsWith('-dinos');
          if (!focused.name.endsWith('-dinos') && !focused.name.endsWith('-eggs')) { await i.respond([]); return; }
          let ownerId = i.user.id;
          if (isWant) {
            const target = i.options.get('user')?.value;
            if (typeof target !== 'string') { await i.respond([{ name: 'Pick the user option first', value: '-' }]); return; }
            ownerId = target;
          }
          const candidates = isDino ? tradeableDinos(ctx, ownerId) : tradeableEggs(ctx, ownerId);
          const rows = listCompleter(String(focused.value), candidates, { maxItems: TRADE_MAX_ITEMS_PER_SIDE });
          await i.respond(rows.length ? rows
            : [{ name: candidates.length ? 'No more matches' : (isWant ? 'They have no tradeable items' : 'You have no tradeable items'), value: '-' }]);
          return;
        }
        await i.respond([]);
      } },
  ],
  components: [
    { prefix: 'trade', async execute(ctx, i) {
        const [, action, uid, pageStr] = i.customId.split(':');
        if (action !== 'list') return;
        if (i.user.id !== uid) { await i.reply({ content: 'Not your list.', flags: MessageFlags.Ephemeral }); return; }
        expireStale(ctx, i.user.id);
        await i.update({ ...tradeListPayload(ctx, i.user.id, Number(pageStr)), attachments: [] });
      } },
  ],
};
