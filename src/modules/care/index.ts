import { SlashCommandBuilder, MessageFlags, EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { feedDino, feedAll, rescueDino, CareError } from './service.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { hungerAt } from '../../core/clock.js';
import { getSpecies } from '../../data/species/index.js';
import { FOODS, foodsForDiet, type FoodId } from '../../data/foods.js';
import { RARITY } from '../../data/rarity.js';
import { matches, respondRanked, emptyRow, dinoLabel, VERY_HUNGRY_MS } from '../../core/autocomplete.js';
import { emojiTag } from '../../core/emojis.js';
import { assetImage } from '../../core/images.js';

// Care replies carry a banner: care_neglect.png when any of the player's non-escaped
// dinos has gone unfed past the VERY HUNGRY threshold, care.png otherwise.
function carePayload(ctx: Ctx, userId: string, description: string) {
  const embed = new EmbedBuilder().setTitle(`${emojiTag('dw_food')} Care`).setColor(0x3ba55c).setDescription(description);
  const now = ctx.now();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
  const neglected = dinos.some((d) => d.escapedAt === null && now - d.lastFedAt >= VERY_HUNGRY_MS);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  const banner = assetImage('banners', neglected ? 'care_neglect' : 'care');
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  return payload;
}

// /rescue success carries the rescue banner; the two failure branches stay
// content-only ephemerals (care.test.ts pins them via replyText).
function rescuePayload(speciesName: string, fee: number) {
  const embed = new EmbedBuilder().setTitle('🪝 Rescue').setColor(0x3ba55c)
    .setDescription(`Recaptured your ${speciesName} for ${fee.toLocaleString()} cash.`);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  const banner = assetImage('banners', 'rescue');
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  return payload;
}

// Autocomplete-safe dino listing: settleEscapes crashes for users with no row
// (toClockDinos uses .get()!), so guard on row existence and never create one here.
function settledDinos(ctx: Ctx, userId: string) {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) return null;
  settleEscapes(ctx, userId);
  return ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
}

export const careModule: ModuleManifest = {
  name: 'care',
  commands: [
    { data: new SlashCommandBuilder().setName('feed').setDescription('Feed your dinos')
        .addSubcommand((s) => s.setName('one').setDescription('Feed a single dino')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName('food').setDescription('Food — leave empty to auto-pick the cheapest').setAutocomplete(true)))
        .addSubcommand((s) => s.setName('all').setDescription('Feed every hungry dino, hungriest first')),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        try {
          if (i.options.getSubcommand() === 'all') {
            const { fed, skipped, spent } = feedAll(ctx, i.user.id);
            const spentText = Object.entries(spent)
              .map(([id, q]) => `−${q} ${FOODS[id as FoodId].name}`).join(', ');
            const msg = fed.length ? `Fed ${fed.length} dino(s) (${spentText}).` : 'Nothing needed feeding.';
            await i.reply(carePayload(ctx, i.user.id, skipped.length
              ? `${msg} Skipped ${skipped.length} (no matching food — /shop food).` : msg));
          } else {
            const { species, food, cost } = feedDino(ctx, i.user.id,
              i.options.getInteger('dino', true), i.options.getString('food') ?? undefined);
            await i.reply(carePayload(ctx, i.user.id, `Fed your ${species.name} (−${cost} ${food.name}).`));
          }
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `${e.message} — buy more with /shop food.`, flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'one') { await i.respond([]); return; }
        const focused = i.options.getFocused(true);
        if (focused.name === 'food') {
          const dinoId = i.options.get('dino')?.value;
          if (dinoId == null) { await i.respond([{ name: 'Pick the dino option first', value: '-' }]); return; }
          const dino = ctx.db.select().from(schema.dinos)
            .where(and(eq(schema.dinos.id, Number(dinoId)), eq(schema.dinos.userId, i.user.id))).get();
          if (!dino) { await i.respond([{ name: 'Pick the dino option first', value: '-' }]); return; }
          const species = getSpecies(dino.speciesId);
          const cost = RARITY[species.rarity].feedCost;
          const inv = ctx.economy.getFoodInventory(i.user.id);
          const q = String(focused.value);
          await respondRanked(i, foodsForDiet(species.diet)
            .filter((f) => matches(q, f.id, f.name))
            .map((f) => {
              const held = inv[f.id] ?? 0;
              const affordable = held >= cost;
              // Unicode fallback only: custom emoji tags render as literal text in autocomplete.
              return { value: f.id, valid: affordable,
                label: `${f.fallback} ${f.name} ×${held} — fills ${f.fillTo}${affordable ? '' : ', not enough'}` };
            }));
          return;
        }
        const dinos = settledDinos(ctx, i.user.id);
        if (!dinos?.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const q = String(focused.value);
        const now = ctx.now();
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          .sort((a, b) => hungerAt(a.d.hunger, a.d.lastFedAt, now) - hungerAt(b.d.hunger, b.d.lastFedAt, now))
          .map(({ d, species }) => ({ value: d.id, label: dinoLabel(d, species, now), valid: d.escapedAt === null })));
      } },
    { data: new SlashCommandBuilder().setName('rescue').setDescription('Recapture an escaped dino')
        .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        try {
          const { species, fee } = rescueDino(ctx, i.user.id, i.options.getInteger('dino', true));
          await i.reply(rescuePayload(species.name, fee));
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for the recapture fee.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
      async autocomplete(ctx, i) {
        const dinos = settledDinos(ctx, i.user.id);
        if (!dinos?.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const q = String(i.options.getFocused());
        const now = ctx.now();
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          .map(({ d, species }) => ({ value: d.id, label: dinoLabel(d, species, now), valid: d.escapedAt !== null })));
      } },
  ],
  components: [],
};
