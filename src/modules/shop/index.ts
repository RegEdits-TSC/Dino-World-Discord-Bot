import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import type { Rarity } from '../../data/types.js';
import { getOrCreateUser } from '../park/service.js';
import { dailyEggOffers, buyEgg, buyFood, ShopError } from './service.js';
import { sellDino, previewSell, ShardError } from './shards.js';
import { schema } from '../../core/db/index.js';
import { getSpecies } from '../../data/species/index.js';
import { SHOP_EGG_PRICES, FOOD_BUNDLES } from '../../data/shop.js';
import { SELL_CASH } from '../../data/sell.js';
import { DECOR } from '../../data/decor.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { matches, respondRanked, emptyRow, capitalize } from '../../core/autocomplete.js';
import { assetImage } from '../../core/images.js';
import { RARITY_COLOR } from '../hatchery/embeds.js';
import { RARITY } from '../../data/rarity.js';
import type { AttachmentBuilder } from 'discord.js';
import { emojiTag, rarityEmoji, foodEmoji } from '../../core/emojis.js';
import { FOODS, foodsForDiet } from '../../data/foods.js';

const eggRarityChoices = (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((r) => ({ name: r, value: r }));

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
            const offers = dailyEggOffers(user.ratingHighWater, ctx.now());
            const eggLines = offers.length ? offers.map((r) => `• ${rarityEmoji(r)}${r} egg — ${SHOP_EGG_PRICES[r].toLocaleString()} cash`).join('\n') : 'No eggs today.';
            const foodLines = (['herbivore', 'carnivore'] as const).map((diet) =>
              foodsForDiet(diet).map((f) => `${foodEmoji(f.id)}${f.name} — ${f.unitCost}/unit, fills ${f.fillTo}`).join('\n'))
              .join('\n');
            const bundleHint = `Buy any amount — e.g. ${FOOD_BUNDLES.join('/')}.`;
            const decorLine = Object.values(DECOR).map((d) => `${d.name} (${d.cost})`).join(' · ');
            const embed = new EmbedBuilder().setTitle('🏪 Shop — today').setColor(0x5865F2).addFields(
              { name: '🥚 Eggs (/shop egg)', value: eggLines },
              { name: `${emojiTag('dw_food')} Food Market (/shop food)`, value: `${foodLines}\n${bundleHint}` },
              { name: '🌴 Decor (/decorate)', value: decorLine },
            );
            const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
            const order = Object.keys(RARITY);
            const best = offers.length ? offers.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a)) : null;
            const img = best ? assetImage('eggs', best) : null;
            if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
            const foodBanner = assetImage('banners', 'shop_food_market');
            if (foodBanner) { embed.setImage(foodBanner.url); payload.files = [...(payload.files ?? []), foodBanner.file]; }
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
            const eggImg = assetImage('eggs', egg.rarity);
            if (eggImg) { eggEmbed.setThumbnail(eggImg.url); eggPayload.files = [eggImg.file]; }
            await i.reply(eggPayload);
          } else {
            const { food, total } = buyFood(ctx, i.user.id, i.options.getString('item', true), i.options.getInteger('units', true));
            await i.reply({ content: `${emojiTag(food.emoji)} Bought ${i.options.getInteger('units', true)}× ${food.name} for ${total.toLocaleString()} cash.` });
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
          await respondRanked(i, Object.values(FOODS)
            .filter((f) => matches(q, f.id, f.name, f.diet))
            .map((f) => ({ value: f.id, valid: true,
              // Unicode fallback only — custom tags render literally in autocomplete.
              label: `${f.fallback} ${f.name} — ${f.unitCost} cash/unit, fills ${f.fillTo} (own ${inv[f.id] ?? 0})` })));
          return;
        }
        if (i.options.getSubcommand() !== 'egg') { await i.respond([]); return; }
        const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, i.user.id)).get();
        const offers = dailyEggOffers(user?.ratingHighWater ?? 0, ctx.now());
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
              ? `🥚 ${capitalize(r)} — ${SHOP_EGG_PRICES[r].toLocaleString('en-US')} cash`
              : `🥚 ${capitalize(r)} — not in today's shop`,
          })));
      } },
    { data: new SlashCommandBuilder().setName('sell').setDescription('Sell a dino for cash + shards')
        .addIntegerOption((o) => o.setName('dino').setDescription('Dino id from /dino list').setRequired(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const dinoId = i.options.getInteger('dino', true);
        try {
          const p = previewSell(ctx, i.user.id, dinoId);
          if (!p.sellable) { await i.reply({ content: 'That dino cannot be sold (Mythic or locked).', flags: MessageFlags.Ephemeral }); return; }
          const shardText = p.capReached ? '0 shards (daily cap reached)' : `${p.minShards}–${p.maxShards} shards`;
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`sell:confirm:${dinoId}`).setEmoji(emojiTag('dw_cash')).setLabel('Confirm sale').setStyle(ButtonStyle.Danger));
          await i.reply({ content: `Sell dino #${dinoId} for ${p.cashValue.toLocaleString()} cash + ${shardText}?`, components: [row], flags: MessageFlags.Ephemeral });
        } catch (e) { if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      },
      async autocomplete(ctx, i) {
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        if (!dinos.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          .map(({ d, species }) => {
            const sellable = species.rarity !== 'mythic' && !d.locked;   // mirrors shards.ts:53
            const label = !sellable
              ? `🦖 #${d.id} ${species.name} — ${species.rarity === 'mythic' ? "MYTHIC, can't sell" : 'locked in a trade'}`
              : `🦖 #${d.id} ${species.name} — ${SELL_CASH[species.rarity].toLocaleString('en-US')} cash${d.viaTrade ? ', 0 shards (via trade)' : ''}`;
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
          await i.update({ content: `${emojiTag('dw_cash')} Sold for **${res.cash.toLocaleString()}** cash and **${res.shards}** shards${cap}.`, components: [] });
        } catch (e) { if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      } },
  ],
};
