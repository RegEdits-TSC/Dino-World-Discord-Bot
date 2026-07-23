import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser } from '../park/service.js';
import { incubateEgg, hatchEgg, HatcheryError } from './service.js';
import { buyMythicEgg, mythicSpeciesChoices, ShardError } from '../shop/shards.js';
import { getSpecies } from '../../data/species/index.js';
import { preHatchPayload, revealPayload, eggListPayload } from './embeds.js';
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
        await i.reply(eggListPayload(eggs, ctx.now()));
      } },
    { data: new SlashCommandBuilder().setName('incubate').setDescription('Start incubating an egg')
        .addIntegerOption((o) => o.setName('egg').setDescription('Egg — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const egg = incubateEgg(ctx, i.user.id, i.options.getInteger('egg', true), i.guildId);
          await i.reply({ content: `🥚 Incubating your ${egg.rarity} egg — ready <t:${Math.floor(egg.hatchesAt! / 1000)}:R>.` });
        } catch (e) { if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      },
      async autocomplete(ctx, i) {
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        if (!eggs.length) { await respondRanked(i, [emptyRow('No eggs — get one from /shop egg or /expedition', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, eggs
          .filter((e) => matches(q, e.id, e.rarity))
          .map((e) => ({ value: e.id, label: eggLabel(e, ctx.now()), valid: e.incubationStartedAt === null })));
      } },
    { data: new SlashCommandBuilder().setName('hatch').setDescription('Hatch a ready egg')
        .addIntegerOption((o) => o.setName('egg').setDescription('Egg — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const eggId = i.options.getInteger('egg', true);
        const egg = ctx.db.select().from(schema.eggs).where(and(eq(schema.eggs.id, eggId), eq(schema.eggs.userId, i.user.id))).get();
        if (!egg) { await i.reply({ content: 'You do not own that egg.', flags: MessageFlags.Ephemeral }); return; }
        if (egg.hatchesAt === null || egg.hatchesAt > ctx.now()) { await i.reply({ content: 'That egg is not ready to hatch.', flags: MessageFlags.Ephemeral }); return; }
        await i.reply(preHatchPayload(egg.rarity, eggId));
      },
      async autocomplete(ctx, i) {
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        if (!eggs.length) { await respondRanked(i, [emptyRow('No eggs — get one from /shop egg or /expedition', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, eggs
          .filter((e) => matches(q, e.id, e.rarity))
          .map((e) => ({ value: e.id, label: eggLabel(e, ctx.now()), valid: e.hatchesAt !== null && e.hatchesAt <= ctx.now() })));
      } },
    { data: new SlashCommandBuilder().setName('mythic').setDescription('Spend 500 shards on a Mythic egg (needs 4★)')
        .addStringOption((o) => o.setName('species').setDescription('Which Mythic').setRequired(true).addChoices(...mythicChoices)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const egg = buyMythicEgg(ctx, i.user.id, i.options.getString('species', true));
          await i.reply({ content: `🌟 A Mythic **${getSpecies(egg.speciesId!).name}** egg is yours! Incubate it with /incubate ${egg.id}.` });
        } catch (e) {
          if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough shards (need 500).', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
  ],
  components: [
    { prefix: 'hatch', async execute(ctx, i) {
        const [, action, idStr] = i.customId.split(':');
        if (action !== 'crack') return;
        try {
          const { species } = hatchEgg(ctx, i.user.id, Number(idStr));
          await i.update(revealPayload(species));
        } catch (e) {
          if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e;
        }
      } },
  ],
};
