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
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
import { matches, respondRanked, emptyRow, eggLabel } from '../../core/autocomplete.js';
import { eligiblePaddocks } from '../park/dinos.js';
import { assignRow } from '../park/embeds.js';

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
          attach(embed, payload, 'thumbnail', assetImage('eggs', egg.rarity, String(egg.id)));
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
        if (action === 'inc') {
          // These buttons sit on PUBLIC messages (the /expedition claim, /shop egg and
          // /breed claim replies are not ephemeral), so the owner is checked here,
          // explicitly, before any read. incubateEgg's own (id, userId) filter would
          // refuse a bystander too — it resolves the egg against the CALLER, so a
          // bystander's click finds no row — but it refuses with "You do not own that
          // egg.", which is true and the wrong sentence for a click on somebody else's
          // card. This check buys the right MESSAGE, not the write protection.
          if (i.user.id !== a2) {
            await i.reply({ content: 'That is not your egg.', flags: MessageFlags.Ephemeral });
            return;
          }
          // Client-supplied and not even trusted to parse: a malformed segment must not
          // reach the DB lookup as NaN. (It binds fine and misses, so the cost is again
          // the wrong sentence — "You do not own that egg." for a mangled link.)
          const eggId = Number(a3);
          if (!Number.isInteger(eggId)) {
            await i.reply({ content: 'That incubate link is invalid — use `/incubate`.', flags: MessageFlags.Ephemeral });
            return;
          }
          try {
            const egg = incubateEgg(ctx, i.user.id, eggId, i.guildId);
            // i.update, and neither `embeds` nor `attachments` is sent. The message this
            // button sits on carries an egg embed whose image is an attachment:// URL into
            // its own upload: `attachments: []` would drop that upload and leave the embed
            // pointing at nothing, and `embeds: []` would throw the reveal away. Only
            // content and components are replaced — components: [] REMOVES the spent
            // button, which is how a one-shot flow is closed here, because neither router
            // guard reads `disabled`. i.reply would leave the button standing.
            await i.update({
              content: `🥚 Egg #${egg.id} is incubating — ready <t:${Math.floor(egg.hatchesAt! / 1000)}:R>, then \`/hatch egg:${egg.id}\`.`,
              components: [],
            });
          } catch (e) {
            if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e;
          }
          return;
        }
        // deferUpdate, never a bare return: a bare return paints "This interaction failed"
        // after 3 seconds, and a stale id from an older deploy lands right here.
        if (action !== 'crack') { await i.deferUpdate(); return; }
        const idStr = a2;
        try {
          const { species, dinoId, traits } = hatchEgg(ctx, i.user.id, Number(idStr));
          const payload = revealPayload(species, Number(idStr));
          // Traits field appended after revealPayload's Diet/Biome/Income/hr fields —
          // added here rather than inside revealPayload so the two attach() calls
          // there (crack image, archetype thumbnail) stay untouched.
          payload.embeds[0].addFields({ name: '🧬 Traits', value: traitLines(traits), inline: false });
          // CROSS-MODULE mint, so it is gated on park being enabled: ModuleRegistry resolves
          // a component's handler only among ENABLED modules (src/core/modules.ts), and a
          // park: id minted while park is off is a button that silently answers nothing. The
          // gate belongs at the MINT — the handler lives in the module that may be absent, so
          // it cannot possibly refuse on its own behalf.
          if (ctx.config.modules.park) {
            const eligible = eligiblePaddocks(ctx, i.user.id, dinoId);
            // PUSHED, never assigned: revealPayload's empty components array is what this
            // i.update uses to strip the crack button, and an assignment would work by
            // accident today and break the moment revealPayload mints a row of its own.
            payload.components.push(assignRow(i.user.id, dinoId, eligible));
            // The footer is decided HERE, beside the control, because it is a function of
            // which of assignRow's three shapes was just minted — something revealPayload
            // cannot see. With an Assign control on the card, "Next: /dino assign" was the
            // exact instruction this change exists to replace, so it goes. With only "Build a
            // paddock", the pointer is still the step AFTER building, so it stays.
            if (eligible.length === 0) {
              payload.embeds[0].setFooter({
                text: 'Build a paddock, then /dino assign — unassigned dinos earn nothing.',
              });
            }
          }
          await i.update(payload);
        } catch (e) {
          if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e;
        }
      } },
    { prefix: 'mythic', async execute(ctx, i) {
        const [, action, speciesId] = i.customId.split(':');
        // Same reason as the hatch handler above: an unrecognised action must acknowledge.
        if (action !== 'confirm') { await i.deferUpdate(); return; }
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const egg = buyMythicEgg(ctx, i.user.id, speciesId);
          await i.update({ content: `🌟 A Mythic **${getSpecies(egg.speciesId!).name}** egg is yours! Incubate it with /incubate ${egg.id}.`, components: [] });
        } catch (e) {
          if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `Not enough shards — a Mythic egg ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
  ],
};
