import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import type { Rarity } from '../../data/types.js';
import { getOrCreateUser } from '../park/service.js';
import { dailyEggOffers, buyEgg, buyFood, eggPriceAt, foodPriceAt, todaysDeal, roundCharge, ShopError } from './service.js';
import { eventMods } from '../../core/world.js';
import { eventHeaderLine } from '../world/embeds.js';
import { sellDino, previewSell, sellCashAt, ShardError } from './shards.js';
import { locksFor } from '../../core/locks.js';
import { schema } from '../../core/db/index.js';
import { getSpecies } from '../../data/species/index.js';
import { FOOD_BUNDLES, SHOP_EGG_PRICES } from '../../data/shop.js';
import { DECOR } from '../../data/decor.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { matches, respondRanked, emptyRow, capitalize } from '../../core/autocomplete.js';
import { assetImage, attach } from '../../core/images.js';
import { RARITY_COLOR } from '../hatchery/embeds.js';
import { RARITY } from '../../data/rarity.js';
import type { AttachmentBuilder } from 'discord.js';
import { emojiTag, rarityEmoji, foodEmoji } from '../../core/emojis.js';
import { FOODS, foodsForDiet } from '../../data/foods.js';

const eggRarityChoices = (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((r) => ({ name: r, value: r }));

// Single source of truth for /shop view's header key list: exported so
// tests/world-module.test.ts's per-key anyModRelevant tests exercise this
// exact array, not a duplicated literal that could silently drift from it.
export const SHOP_VIEW_HEADER_KEYS = ['eggPrice', 'foodPrice', 'sellCash'] as const;

export const shopModule: ModuleManifest = {
  name: 'shop',
  commands: [
    { data: new SlashCommandBuilder().setName('shop').setDescription('Buy eggs, food, and decor')
        .addSubcommand((s) => s.setName('view').setDescription("Today's shop"))
        .addSubcommand((s) => s.setName('egg').setDescription('Buy an egg')
          .addStringOption((o) => o.setName('rarity').setDescription("Egg rarity — today's rotation shows prices").setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('food').setDescription('Buy food')
          .addStringOption((o) => o.setName('item').setDescription('Food — type to search').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('units').setDescription('How many').setRequired(true).setMinValue(1))),
      async execute(ctx, i) {
        const user = getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'view') {
            const now = ctx.now();
            const offers = dailyEggOffers(user.ratingHighWater, now);
            const eggLines = offers.length ? offers.map((r) => `• ${rarityEmoji(r)}${r} egg — ${eggPriceAt(r, now).toLocaleString()} cash`).join('\n') : 'No eggs today.';
            const foodLines = (['herbivore', 'carnivore'] as const).map((diet) =>
              foodsForDiet(diet).map((f) => `${foodEmoji(f.id)}${f.name} — ${foodPriceAt(f, now)}/unit, fills ${f.fillTo}`).join('\n'))
              .join('\n');
            const bundleHint = `Buy any amount — e.g. ${FOOD_BUNDLES.join('/')}.`;
            const decorLine = Object.values(DECOR).map((d) => `${d.name} (${d.cost})`).join(' · ');
            // The one global deal (src/modules/shop/service.ts's todaysDeal) —
            // "original" is the event-adjusted price WITHOUT the deal, computed
            // through the same roundCharge primitive eggPriceAt/foodPriceAt use,
            // so this line can never show a number the deal-folded charge disagrees with.
            const deal = todaysDeal(now);
            const dealFood = FOODS[deal.food];
            const dealFoodOriginal = roundCharge(dealFood.unitCost, eventMods(now).foodPrice);
            const dealFoodLine = `${foodEmoji(dealFood.id)}${dealFood.name} — ~~${dealFoodOriginal.toLocaleString()}~~ **${foodPriceAt(dealFood, now).toLocaleString()}** cash/unit`;
            // todaysDeal is computed from the uncommon-ceiling offers (service.ts),
            // not this viewer's own rotation — an epic/legendary-ceiling player's
            // actual `offers` can legitimately exclude it. Showing the egg half
            // unconditionally would sometimes advertise a rarity /shop egg
            // rejects outright, so gate it on the viewer's own offers. Food has
            // no rotation/ceiling gate at all, so its line always shows.
            const dealEggOriginal = roundCharge(SHOP_EGG_PRICES[deal.rarity], eventMods(now).eggPrice);
            const dealEggLine = `${rarityEmoji(deal.rarity)}${capitalize(deal.rarity)} egg — ~~${dealEggOriginal.toLocaleString()}~~ **${eggPriceAt(deal.rarity, now).toLocaleString()}** cash`;
            const dealLine = offers.includes(deal.rarity) ? `${dealEggLine}\n${dealFoodLine}` : dealFoodLine;
            const embed = new EmbedBuilder().setTitle('🏪 Shop — today').setColor(0x5865F2)
              .setDescription(eventHeaderLine(now, SHOP_VIEW_HEADER_KEYS))
              .addFields(
                { name: '🏷️ Daily Deal', value: dealLine },
                { name: '🥚 Eggs (/shop egg)', value: eggLines },
                { name: `${emojiTag('dw_food')} Food Market (/shop food)`, value: `${foodLines}\n${bundleHint}` },
                { name: '🌴 Decor (/decorate)', value: decorLine },
              );
            const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
            const order = Object.keys(RARITY);
            const best = offers.length ? offers.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a)) : null;
            // No seed: this previews what CAN be bought, so no egg exists yet to key on.
            // Seeding from the viewer would make this preview disagree with the egg they buy.
            attach(embed, payload, 'thumbnail', best ? assetImage('eggs', best) : null);
            // The banner DOES take a seed, unlike the egg preview above it: a banner has no
            // object to key on, so it keys on who is looking and each player gets one stable
            // shopfront. That is the opposite of the preview's problem — a face keyed to the
            // viewer is exactly right for furniture, and exactly wrong for an unbought egg.
            attach(embed, payload, 'image', assetImage('banners', 'shop_food_market', i.user.id));
            await i.reply(payload);
          } else if (sub === 'egg') {
            const rarity = i.options.getString('rarity', true) as Rarity;
            const offers = dailyEggOffers(user.ratingHighWater, ctx.now());
            if (!offers.includes(rarity)) { await i.reply({ content: `A ${rarity} egg isn't in today's rotation — see /shop view.`, flags: MessageFlags.Ephemeral }); return; }
            const egg = buyEgg(ctx, i.user.id, rarity);
            const eggEmbed = new EmbedBuilder().setColor(RARITY_COLOR[egg.rarity] ?? 0x95a5a6)
              .setTitle(`🥚 Bought a ${rarityEmoji(egg.rarity)}${egg.rarity} egg (#${egg.id})`)
              .setDescription(`Incubate it with /incubate ${egg.id}.`);
            const eggPayload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [eggEmbed] };
            attach(eggEmbed, eggPayload, 'thumbnail', assetImage('eggs', egg.rarity, String(egg.id)));
            await i.reply(eggPayload);
          } else {
            const units = i.options.getInteger('units', true);
            const { food, total } = buyFood(ctx, i.user.id, i.options.getString('item', true), units);
            const foodEmbed = new EmbedBuilder().setColor(0x3ba55c)
              .setTitle(`${emojiTag(food.emoji)} Bought ${units}× ${food.name}`)
              .setDescription(`Paid ${total.toLocaleString()} cash — fills hunger to ${food.fillTo}. Serve it with \`/feed all\`.`);
            const foodPayload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [foodEmbed] };
            attach(foodEmbed, foodPayload, 'image', assetImage('banners', 'shop_food_market', i.user.id));
            await i.reply(foodPayload);
          }
        } catch (e) {
          if (e instanceof ShopError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() === 'food') {
          const inv = ctx.economy.getFoodInventory(i.user.id);
          const q = String(i.options.getFocused());
          const now = ctx.now();
          await respondRanked(i, Object.values(FOODS)
            .filter((f) => matches(q, f.id, f.name, f.diet))
            .map((f) => ({ value: f.id, valid: true,
              // Unicode fallback only — custom tags render literally in autocomplete.
              label: `${f.fallback} ${f.name} — ${foodPriceAt(f, now)} cash/unit, fills ${f.fillTo} (own ${inv[f.id] ?? 0})` })));
          return;
        }
        if (i.options.getSubcommand() !== 'egg') { await i.respond([]); return; }
        const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, i.user.id)).get();
        const now = ctx.now();
        const offers = dailyEggOffers(user?.ratingHighWater ?? 0, now);
        const q = String(i.options.getFocused());
        await respondRanked(i, eggRarityChoices
          .map((c) => c.value as Rarity)
          .filter((r) => matches(q, r))
          .map((r) => ({
            value: r,
            valid: offers.includes(r),
            label: offers.includes(r)
              // 'en-US' pinned: autocomplete labels are asserted verbatim in tests,
              // and the host locale must not change them.
              ? `🥚 ${capitalize(r)} — ${eggPriceAt(r, now).toLocaleString('en-US')} cash`
              : `🥚 ${capitalize(r)} — not in today's shop`,
          })));
      } },
    { data: new SlashCommandBuilder().setName('sell').setDescription('Sell a dino for cash + shards')
        .addIntegerOption((o) => o.setName('dino').setDescription('Dino id from /dino list').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const dinoId = i.options.getInteger('dino', true);
        try {
          const p = previewSell(ctx, i.user.id, dinoId);
          if (!p.sellable) { await i.reply({ content: 'That dino cannot be sold (Mythic or locked).', flags: MessageFlags.Ephemeral }); return; }
          const shardText = p.capReached ? '0 shards (daily cap reached)' : `${p.minShards}–${p.maxShards} shards`;
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`sell:confirm:${dinoId}`).setEmoji(emojiTag('dw_cash')).setLabel('Confirm sale').setStyle(ButtonStyle.Danger));
          const sellEmbed = new EmbedBuilder().setColor(0xe67e22)
            .setTitle(`${emojiTag('dw_cash')} Confirm sale`)
            .setDescription(`Sell dino #${dinoId} for ${p.cashValue.toLocaleString()} cash + ${shardText}?`);
          const sellPayload: {
            embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[];
            files?: AttachmentBuilder[]; flags: MessageFlags.Ephemeral;
          } = { embeds: [sellEmbed], components: [row], flags: MessageFlags.Ephemeral };
          attach(sellEmbed, sellPayload, 'image', assetImage('banners', 'sell', i.user.id));
          await i.reply(sellPayload);
        } catch (e) { if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      },
      async autocomplete(ctx, i) {
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        if (!dinos.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const locks = locksFor(ctx, i.user.id);   // one batched read, not one per row
        const q = String(i.options.getFocused());
        const now = ctx.now();
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          .map(({ d, species }) => {
            const sellable = species.rarity !== 'mythic' && !locks.dinos.has(d.id);   // mirrors shards.ts
            const label = !sellable
              ? `🦖 #${d.id} ${species.name} — ${species.rarity === 'mythic' ? "MYTHIC, can't sell" : 'locked in a trade'}`
              : `🦖 #${d.id} ${species.name} — ${sellCashAt(species.rarity, now).toLocaleString('en-US')} cash${d.viaTrade ? ', 0 shards (via trade)' : ''}`;
            return { value: d.id, label, valid: sellable };
          }));
      } },
  ],
  components: [
    { prefix: 'sell', async execute(ctx, i) {
        const [, action, idStr] = i.customId.split(':');
        if (action !== 'confirm') return;
        try {
          const res = sellDino(ctx, i.user.id, Number(idStr));
          const cap = res.capped ? ' (shard cap reached)' : '';
          await i.update({ content: `${emojiTag('dw_cash')} Sold for **${res.cash.toLocaleString()}** cash and **${res.shards}** shards${cap}.`,
            embeds: [], components: [], attachments: [] });
        } catch (e) { if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      } },
  ],
};
