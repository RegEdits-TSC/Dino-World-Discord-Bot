import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { feedDino, feedAll, feedSkipReport, rescueDino, feedCostFor, CareError } from './service.js';
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
import { hungerAt, drainMsFor } from '../../core/clock.js';
import { getSpecies } from '../../data/species/index.js';
import { FOODS, foodsForDiet, type FoodId } from '../../data/foods.js';
import { matches, respondRanked, emptyRow, dinoLabel, VERY_HUNGRY_MS } from '../../core/autocomplete.js';
import { emojiTag } from '../../core/emojis.js';
import { assetImage, attach } from '../../core/images.js';

// Care replies carry a banner: care_neglect.webp when any of the player's non-escaped
// dinos has gone unfed past the VERY HUNGRY threshold, care.webp otherwise.
//
// userId seeds the banner: a banner has no object to key on, so it keys on who is
// looking, and each player gets one stable face of this surface. The seed rides the
// WHOLE ternary, including the care_neglect arm, which ships no -vN siblings today:
// assetImage returns the base file unchanged when a name has no faces (see
// pickVariant's `count === 0` early return in src/core/images.ts), so that arm's seed
// is a contract no-op rather than a mistake — and it starts working on its own the day
// care_neglect-v2 ships, with no edit here. One call also keeps this readable; what
// must never happen is hoisting the NAME into a `const`, which
// tests/images.test.ts's banner-name scrape cannot follow.
function carePayload(ctx: Ctx, userId: string, description: string) {
  const embed = new EmbedBuilder().setTitle(`${emojiTag('dw_food')} Care`).setColor(0x3ba55c).setDescription(description);
  const now = ctx.now();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
  const neglected = dinos.some((d) => d.escapedAt === null && now - d.lastFedAt >= VERY_HUNGRY_MS);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', neglected ? 'care_neglect' : 'care', userId));
  return payload;
}

// /rescue success carries the rescue banner; the two failure branches stay
// content-only ephemerals (care.test.ts pins them via replyText).
//
// A rescued dino comes back at roughly half comfort and drains from there, so feeding is the
// next move and it ships as a control. ONE CLICK, NO CONFIRM: the park:feedall button on
// /park view (src/modules/park/embeds.ts) has consumed food on a single click since it
// shipped, and it is safe there because feedAll skips a dino already at 100. The handler on
// the care component below reproduces that skip before it spends anything, which is what
// makes the two genuinely equivalent — the confirm rule in this feature is scoped to CASH.
//
// This reply is PUBLIC, so the owner uid rides in the customId beside the dino id.
function rescuePayload(speciesName: string, fee: number, userId: string, dinoId: number) {
  const embed = new EmbedBuilder().setTitle('🪝 Rescue').setColor(0x3ba55c)
    .setDescription(`Recaptured your ${speciesName} for ${fee.toLocaleString()} cash.`);
  // A named local that is PUSHED onto, never an array assigned wholesale: the next task to
  // add a row to this reply must be able to join it rather than rewrite this expression.
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`care:feed:${userId}:${dinoId}`)
      .setLabel('🍖 Feed it').setStyle(ButtonStyle.Success)));
  const payload: {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
    files?: AttachmentBuilder[];
  } = { embeds: [embed], components: rows };
  attach(embed, payload, 'image', assetImage('banners', 'rescue'));
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
            const report = feedSkipReport(ctx, i.user.id, skipped);
            await i.reply(carePayload(ctx, i.user.id, report ? `${msg}\n\n${report}` : msg));
          } else {
            const { species, food, cost } = feedDino(ctx, i.user.id,
              i.options.getInteger('dino', true), i.options.getString('food') ?? undefined);
            await i.reply(carePayload(ctx, i.user.id, `Fed your ${species.name} (−${cost} ${food.name}).`));
          }
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // /feed spends only food, so this is always the food wallet — but the noun is
            // derived from the error rather than assumed, because `wallet` is what decides
            // whether shortfallLine says "need" or "costs" and the two must not disagree.
            const what = e.foodId ? FOODS[e.foodId].name : e.wallet;
            await i.reply({
              content: `Not enough ${what} — ${shortfallLine(e)}. Buy more with /shop food.`,
              flags: MessageFlags.Ephemeral,
            });
          }
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
          // Routed through feedCostFor, not a raw RARITY table read: on an event
          // day (Heat Wave/Cold Snap scale feedCost, Gluttonous/Thrifty compose
          // with it) the raw table value quotes the wrong cost, so an
          // affordable food can render "not enough" (or vice versa) and
          // feedDino — which DOES call feedCostFor — then disagrees with what
          // this menu just showed. Pure and read-only: safe in an autocomplete
          // provider.
          const cost = feedCostFor(species.rarity, dino.traits, ctx.now());
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
          .sort((a, b) => hungerAt(a.d.hunger, a.d.lastFedAt, now, drainMsFor(a.d.traits))
                        - hungerAt(b.d.hunger, b.d.lastFedAt, now, drainMsFor(b.d.traits)))
          .map(({ d, species }) => ({ value: d.id, label: dinoLabel(d, species, now), valid: d.escapedAt === null })));
      } },
    { data: new SlashCommandBuilder().setName('rescue').setDescription('Recapture an escaped dino')
        .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        try {
          const dinoId = i.options.getInteger('dino', true);
          const { species, fee } = rescueDino(ctx, i.user.id, dinoId);
          await i.reply(rescuePayload(species.name, fee, i.user.id, dinoId));
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `Not enough cash — that recapture ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
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
  components: [
    {
      // The care module's first component prefix. It must be the FIRST customId segment and
      // nothing more: findComponent resolves on customId.split(':')[0] (src/core/modules.ts),
      // so 'care:feed' here would match nothing and this button would be dead in production
      // while every direct-execute test still passed.
      prefix: 'care',
      async execute(ctx, i) {
        const [, action, uid, dinoIdRaw] = i.customId.split(':');
        // deferUpdate, never a bare return — a bare return paints "This interaction failed"
        // after three seconds, and a stale id from an older deploy lands right here.
        if (action !== 'feed') { await i.deferUpdate(); return; }
        // The /rescue reply is a PUBLIC message. feedDino resolves against the CALLER, so a
        // bystander spends nothing either way; without this they would simply be told they do
        // not own a dino they never named. A message-quality layer, not the spend barrier.
        if (i.user.id !== uid) { await i.reply({ content: 'Not your dino.', flags: MessageFlags.Ephemeral }); return; }
        // No integer guard on the dino segment: Number('nonsense') is NaN, better-sqlite3
        // binds NaN as a legal no-match, and both reads below therefore land on the same
        // not-found arm that answers every other unowned id.
        const dinoId = Number(dinoIdRaw);
        // No getOrCreateUser: the uid was checked against the clicker and the id came off that
        // player's own /rescue reply, so the row exists. settleEscapes matches what /feed one
        // does, and it only ever stamps an escape — it never clears one.
        settleEscapes(ctx, i.user.id);
        // feedAll skips a dino already at 100 (its `.filter((c) => !c.escaped && c.hunger < 100)`
        // in src/modules/care/service.ts); feedDino does NOT — its `wasHungry` gates only the
        // dinos_fed stat, never the spend — so without this the second of two clicks landing
        // before the repaint buys a second full meal for a dino that is already full. THIS is
        // what makes "the same as Feed all" a true statement, and it is the reason this button
        // ships with no confirm. Do not remove it, and do not "fix" a double charge later by
        // adding a confirm to this button alone.
        const dino = ctx.db.select().from(schema.dinos)
          .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, i.user.id))).get();
        if (dino && dino.escapedAt === null
            && hungerAt(dino.hunger, dino.lastFedAt, ctx.now(), drainMsFor(dino.traits)) >= 100) {
          await i.update({
            ...carePayload(ctx, i.user.id, `Your ${getSpecies(dino.speciesId).name} is already full.`),
            content: '', components: [], attachments: [],
          });
          return;
        }
        try {
          // No food id, so feedDino auto-picks the cheapest affordable stack and, when there is
          // none, throws a CareError that already names the cost and what is held.
          const { species, food, cost } = feedDino(ctx, i.user.id, dinoId);
          await i.update({
            ...carePayload(ctx, i.user.id, `Fed your ${species.name} (−${cost} ${food.name}).`),
            // content: '' because discord.js drops an OMITTED content key and Discord then
            // leaves the message's existing content in place. components: [] strips the spent
            // one-shot button — neither router guard reads `disabled`, so a disabled button is
            // not a lock. attachments: [] because this update replaces a message already
            // carrying rescue.webp, which would otherwise strand as an orphan attachment card
            // beside the care banner.
            content: '', components: [], attachments: [],
          });
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // Backstop only, and deliberately uncovered: this call passes no food id, so
            // feedDino routes through pickFood, which refuses an unaffordable stack with a
            // CareError BEFORE economy.apply is reached — apply cannot overdraw a stack
            // pickFood already proved sufficient. It still renders through shortfallLine, in
            // the same shape the /feed one arm uses, so the §5.1 sweep holds if that changes.
            const what = e.foodId ? FOODS[e.foodId].name : e.wallet;
            await i.reply({
              content: `Not enough ${what} — ${shortfallLine(e)}. Buy more with /shop food.`,
              flags: MessageFlags.Ephemeral,
            });
          }
          else throw e;
        }
      },
    },
  ],
};
