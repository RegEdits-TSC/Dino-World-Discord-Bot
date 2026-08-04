import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser } from '../park/service.js';
import { incubateEgg, hatchEgg, HatcheryError } from './service.js';
import { buyMythicEgg, mythicSpeciesChoices, ShardError } from '../shop/shards.js';
import { locksFor } from '../../core/locks.js';
import { getSpecies } from '../../data/species/index.js';
import { preHatchPayload, revealPayload, eggListPayload, RARITY_COLOR } from './embeds.js';
import { assetImage, attach } from '../../core/images.js';
import { rarityEmoji } from '../../core/emojis.js';
import { traitLines } from '../../core/trait-display.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { matches, respondRanked, emptyRow, eggLabel } from '../../core/autocomplete.js';

const mythicChoices = mythicSpeciesChoices().map((s) => ({ name: s.name, value: s.id }));

export const hatcheryModule: ModuleManifest = {
  name: 'hatchery',
  commands: [
    { data: new SlashCommandBuilder().setName('eggs').setDescription('Your eggs and incubator'),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        await i.reply(eggListPayload(eggs, ctx.now(), i.user.id, 1, locksFor(ctx, i.user.id).eggs));
      } },
    { data: new SlashCommandBuilder().setName('incubate').setDescription('Start incubating an egg')
        .addIntegerOption((o) => o.setName('egg').setDescription('Egg — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const egg = incubateEgg(ctx, i.user.id, i.options.getInteger('egg', true), i.guildId);
          const embed = new EmbedBuilder().setColor(RARITY_COLOR[egg.rarity] ?? 0x95a5a6)
            .setTitle(`🥚 Incubating your ${rarityEmoji(egg.rarity)}${egg.rarity} egg`)
            .setDescription(`Ready <t:${Math.floor(egg.hatchesAt! / 1000)}:R> — then run \`/hatch egg:${egg.id}\`.`);
          const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
          attach(embed, payload, 'thumbnail', assetImage('eggs', egg.rarity));
          await i.reply(payload);
        } catch (e) { if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      },
      async autocomplete(ctx, i) {
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        if (!eggs.length) { await respondRanked(i, [emptyRow('No eggs — get one from /shop egg or /expedition', 0)]); return; }
        const locks = locksFor(ctx, i.user.id);   // one batched read, not one per row
        const q = String(i.options.getFocused());
        await respondRanked(i, eggs
          .filter((e) => matches(q, e.id, e.rarity))
          .map((e) => ({ value: e.id, label: eggLabel(e, ctx.now(), locks.eggs.has(e.id)),
            valid: e.incubationStartedAt === null && !locks.eggs.has(e.id) })));
      } },
    { data: new SlashCommandBuilder().setName('hatch').setDescription('Hatch a ready egg')
        .addIntegerOption((o) => o.setName('egg').setDescription('Egg — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const eggId = i.options.getInteger('egg', true);
        const egg = ctx.db.select().from(schema.eggs).where(and(eq(schema.eggs.id, eggId), eq(schema.eggs.userId, i.user.id))).get();
        if (!egg) { await i.reply({ content: 'You do not own that egg.', flags: MessageFlags.Ephemeral }); return; }
        if (locksFor(ctx, i.user.id).eggs.has(eggId)) { await i.reply({ content: 'That egg is locked in a pending trade.', flags: MessageFlags.Ephemeral }); return; }
        if (egg.hatchesAt === null || egg.hatchesAt > ctx.now()) { await i.reply({ content: 'That egg is not ready to hatch.', flags: MessageFlags.Ephemeral }); return; }
        await i.reply(preHatchPayload(egg.rarity, eggId));
      },
      async autocomplete(ctx, i) {
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        if (!eggs.length) { await respondRanked(i, [emptyRow('No eggs — get one from /shop egg or /expedition', 0)]); return; }
        const locks = locksFor(ctx, i.user.id);   // one batched read, not one per row
        const q = String(i.options.getFocused());
        await respondRanked(i, eggs
          .filter((e) => matches(q, e.id, e.rarity))
          .map((e) => ({ value: e.id, label: eggLabel(e, ctx.now(), locks.eggs.has(e.id)),
            valid: e.hatchesAt !== null && e.hatchesAt <= ctx.now() && !locks.eggs.has(e.id) })));
      } },
    { data: new SlashCommandBuilder().setName('mythic').setDescription('Spend 500 shards on a Mythic egg (needs 8★)')
        .addStringOption((o) => o.setName('species').setDescription('Which Mythic').setRequired(true).addChoices(...mythicChoices)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const speciesId = i.options.getString('species', true);
        const species = getSpecies(speciesId);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`mythic:confirm:${speciesId}`).setLabel('🌟 Confirm — 500 shards').setStyle(ButtonStyle.Danger),
        );
        await i.reply({ content: `Spend **500 shards** on a Mythic **${species.name}** egg?`, components: [row], flags: MessageFlags.Ephemeral });
      } },
  ],
  components: [
    { prefix: 'hatch', async execute(ctx, i) {
        const [, action, a2, a3] = i.customId.split(':');
        if (action === 'eggs') {
          if (i.user.id !== a2) { await i.reply({ content: 'Not your list.', flags: MessageFlags.Ephemeral }); return; }
          const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
          await i.update({ ...eggListPayload(eggs, ctx.now(), i.user.id, Number(a3), locksFor(ctx, i.user.id).eggs), attachments: [] });
          return;
        }
        if (action !== 'crack') return;
        const idStr = a2;
        try {
          const { species, traits } = hatchEgg(ctx, i.user.id, Number(idStr));
          const payload = revealPayload(species);
          // Traits field appended after revealPayload's Diet/Biome/Income/hr fields —
          // added here rather than inside revealPayload so the two attach() calls
          // there (crack image, archetype thumbnail) stay untouched.
          payload.embeds[0].addFields({ name: '🧬 Traits', value: traitLines(traits), inline: false });
          await i.update(payload);
        } catch (e) {
          if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e;
        }
      } },
    { prefix: 'mythic', async execute(ctx, i) {
        const [, action, speciesId] = i.customId.split(':');
        if (action !== 'confirm') return;
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const egg = buyMythicEgg(ctx, i.user.id, speciesId);
          await i.update({ content: `🌟 A Mythic **${getSpecies(egg.speciesId!).name}** egg is yours! Incubate it with /incubate ${egg.id}.`, components: [] });
        } catch (e) {
          if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough shards (need 500).', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
  ],
};
