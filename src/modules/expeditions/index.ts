import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { startExpedition, claimExpedition, activeExpedition, expeditionFeeFor, ExpeditionError } from './service.js';
import { EXPEDITION_SITES } from '../../data/sites.js';
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
import { schema } from '../../core/db/index.js';
import { siteUnlocked } from '../park/rating.js';
import { FOODS } from '../../data/foods.js';
import { matches, respondRanked, fmtDuration } from '../../core/autocomplete.js';
import { assetImage, attach } from '../../core/images.js';
import { emojiTag, rarityEmoji } from '../../core/emojis.js';
import { eventMods } from '../../core/world.js';
import { eventHeaderLine } from '../world/embeds.js';
import { incubateRow } from '../hatchery/embeds.js';

// '🌋 ' when the site marker resolves, '' when it doesn't — keeps titles clean either way.
function siteMarker(siteId: string): string {
  const t = emojiTag(`dw_site_${siteId}`);
  return t ? `${t} ` : '';
}

// /expedition start's header key list, exported so
// tests/world-module.test.ts's per-key anyModRelevant tests exercise this
// exact array. Deliberately excludes expeditionCash/expeditionOddsShift:
// those two are sampled fresh at CLAIM time (see claimExpedition's "Loot is
// priced at CLAIM time" comment in ./service.ts), not locked in here — every
// site but coastal_dig runs 1-24h, so advertising a payout condition at
// dispatch that a later UTC-midnight crossing can silently no longer match
// would be actively misleading. Only expeditionMs/expeditionFee are genuinely
// locked in by startExpedition before this line runs.
export const EXPEDITION_START_HEADER_KEYS = ['expeditionMs', 'expeditionFee'] as const;

// /expedition claim's header key list — the mirror image of the exclusion
// above. This ONE is allowed to name expeditionCash/expeditionOddsShift
// precisely because this line renders AFTER claimExpedition (see the claim
// branch below) has already sampled eventMods moments earlier in this same
// synchronous call. claimExpedition takes no `now` parameter and calls
// ctx.now() itself, so the header's own ctx.now() read below is a SEPARATE
// call, not the same sample threaded through — unlike /expedition start,
// /shop view, /battle chapters, and /park view, which each compute `now`
// once and pass it into both the business logic and eventHeaderLine. That's
// fine here only because nothing awaits between the two reads, so both land
// in the same UTC day and the header can't disagree with the loot beside
// it. Do not introduce an await between claimExpedition and the header
// line below — that is the only way the two could straddle a midnight.
// /expedition status is the screen that must NOT get this header — a dig
// that has not returned yet is forward-looking, and a header there would
// repeat exactly the bug that was just fixed on /expedition start
// (advertising a payout condition that a later UTC-midnight crossing could
// still invalidate before claim).
export const EXPEDITION_CLAIM_HEADER_KEYS = ['expeditionCash', 'expeditionOddsShift'] as const;

function sitePayload(siteId: string, description: string) {
  const embed = new EmbedBuilder().setColor(0xe8590c)
    .setTitle(`🧭 ${siteMarker(siteId)}${EXPEDITION_SITES[siteId].name}`).setDescription(description);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  attach(embed, payload, 'thumbnail', assetImage('sites', `${siteId}-thumb`));
  return payload;
}

/**
 * The Dig again control, minted onto both surfaces that END an expedition: the
 * /expedition claim reply and the exp:claim button's own update. Both are PUBLIC messages,
 * so the owner id rides in the customId and the handler rejects a mismatch before the
 * service call — startExpedition resolves against the CALLER, so a bystander's click would
 * silently dispatch their own crew rather than be refused.
 *
 * Unicode in the LABEL, never setEmoji: emojiTag returns '' when no emoji map is loaded and
 * ButtonBuilder#setEmoji throws on that rather than degrading.
 *
 * No price in this id, deliberately. The fee moves with the world event at every UTC
 * midnight and a public message is durable — the price is quoted, and baked into an id,
 * only on the ephemeral confirm card this button opens (Task 20 (G7-B)).
 */
export function digAgainRow(userId: string, siteId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`exp:again:${userId}:${siteId}`)
      .setLabel('🧭 Dig again').setStyle(ButtonStyle.Primary));
}

export const expeditionsModule: ModuleManifest = {
  name: 'expeditions',
  commands: [
    { data: new SlashCommandBuilder().setName('expedition').setDescription('Send a dig crew out')
        .addSubcommand((s) => s.setName('start').setDescription('Start an expedition')
          .addStringOption((o) => o.setName('site').setDescription('Dig site — locked ones show their star requirement').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('status').setDescription('Check your active expedition'))
        .addSubcommand((s) => s.setName('claim').setDescription('Claim a returned expedition')),
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'start') { await i.respond([]); return; }
        const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, i.user.id)).get();
        const hw = user?.ratingHighWater ?? 0;
        const q = String(i.options.getFocused());
        // Read-only + pure: eventMods has no db access, so calling it here is
        // safe for an autocomplete provider. Without this the picker would
        // quote the site's unmodified cost/duration straight off SiteDef —
        // wrong during, say, an Amber Storm's doubled fee.
        const mods = eventMods(ctx.now());
        await respondRanked(i, Object.values(EXPEDITION_SITES)
          .filter((s) => matches(q, s.id, s.name))
          .map((s) => {
            const unlocked = siteUnlocked(s.unlockRating, hw);
            return {
              value: s.id, valid: unlocked,
              label: unlocked
                // 'en-US' pinned: labels are asserted verbatim in tests.
                ? `🧭 ${s.name} — ${expeditionFeeFor(s.cost, mods.expeditionFee).toLocaleString('en-US')} cash, ${fmtDuration(Math.round(s.durationMs * mods.expeditionMs))}`
                : `🧭 ${s.name} — LOCKED, needs ★${(s.unlockRating / 100).toFixed(1)}`,
            };
          }));
      },
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'start') {
            const exp = startExpedition(ctx, i.user.id, i.options.getString('site', true), i.guildId);
            // See EXPEDITION_START_HEADER_KEYS above for why the payout keys
            // (expeditionCash/expeditionOddsShift) are excluded.
            const header = eventHeaderLine(ctx.now(), EXPEDITION_START_HEADER_KEYS);
            await i.reply(sitePayload(exp.siteId, `${header}\n\nCrew dispatched — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.`));
          } else if (sub === 'status') {
            const exp = activeExpedition(ctx, i.user.id);
            if (!exp) { await i.reply({ content: 'No active expedition. Start one with /expedition start.', flags: MessageFlags.Ephemeral }); return; }
            await i.reply(sitePayload(exp.siteId, exp.returnsAt <= ctx.now()
              ? '✅ Back! Use /expedition claim.'
              : `⏳ Digging — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.`));
          } else {
            const { loot, site } = claimExpedition(ctx, i.user.id);
            // See EXPEDITION_CLAIM_HEADER_KEYS above for why this header is
            // safe here and must never move to /expedition status.
            const header = eventHeaderLine(ctx.now(), EXPEDITION_CLAIM_HEADER_KEYS);
            const embed = new EmbedBuilder().setColor(0xe8590c).setTitle(`🧭 ${siteMarker(site.id)}${site.name} — returned!`)
              .setDescription(`${header}\n\nFound a **${rarityEmoji(loot.eggRarity)}${loot.eggRarity}** egg!`)
              .addFields(
                { name: `${emojiTag('dw_cash')} Cash`, value: `+${loot.cash}`, inline: true },
                { name: `${emojiTag(FOODS[loot.food.foodId].emoji)} ${FOODS[loot.food.foodId].name}`, value: `+${loot.food.qty}`, inline: true });
            // components starts EMPTY and is PUSHED into. Spec §3 gives this surface two
            // controls from two separate tasks; assigning the array wholesale would make
            // whichever lands second silently delete the other's button, with nothing failing.
            const payload: {
              embeds: EmbedBuilder[];
              components: ActionRowBuilder<ButtonBuilder>[];
              files?: AttachmentBuilder[];
            } = { embeds: [embed], components: [] };
            payload.components.push(digAgainRow(i.user.id, site.id));
            // i.user.id seeds the banner — the viewer, same rule as every other banner call.
            attach(embed, payload, 'image', assetImage('sites', `${site.id}-banner`, i.user.id));
            attach(embed, payload, 'thumbnail', assetImage('sites', `${site.id}-thumb`));
            await i.reply(payload);
          }
        } catch (e) {
          if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // Only `start` charges — claimExpedition credits and nothing else — but the site
            // option is read behind the `sub` check rather than unconditionally, because
            // getString('site', true) THROWS on a subcommand that does not declare it.
            const what = sub === 'start'
              ? EXPEDITION_SITES[i.options.getString('site', true)].name
              : 'that expedition';
            await i.reply({ content: `Not enough cash — ${what} ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
          }
          else throw e;
        }
      } },
  ],
  components: [
    {
      prefix: 'exp',
      async execute(ctx, i) {
        const parts = i.customId.split(':');
        const [, action, uid] = parts;
        // Unknown action FIRST, and it must acknowledge: a bare return paints "This
        // interaction failed" after three seconds, and a stale id from an older deploy lands
        // exactly here. The ordering is pinned by tests/alert-buttons.test.ts's 'exp defers
        // before the owner check on an unknown action, even with a mismatched uid'. Any
        // future exp action needs its own arm below or it lands here silently.
        if (action !== 'claim' && action !== 'again' && action !== 'againyes') {
          await i.deferUpdate();
          return;
        }
        // Shared by all three arms. A customId is client-supplied and this handler is
        // reachable from anywhere; both services behind it resolve against the CALLER —
        // claimExpedition takes no id at all, and startExpedition dispatches the clicker's
        // own crew — so without this check a bystander clicking someone else's public card
        // would silently act on their OWN park rather than being refused.
        if (i.user.id !== uid) {
          await i.reply({ content: 'That is not your expedition.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === 'claim') {
          try {
            const { loot, site, egg } = claimExpedition(ctx, i.user.id);
            // ONE named local, PUSHED into, never assigned: spec §3 puts two controls on this
            // message and an assignment would silently delete whichever one it did not name.
            const rows: ActionRowBuilder<ButtonBuilder>[] = [];
            rows.push(digAgainRow(i.user.id, site.id));
            // Cross-module mint. hatch:inc is handled in the HATCHERY module and
            // ModuleRegistry.findComponent searches only ENABLED modules (src/core/modules.ts),
            // so with "hatchery": false in modules.json this button would be a dead control on
            // a durable public message — a click nothing answers at all.
            if (ctx.config.modules.hatchery) rows.push(incubateRow(i.user.id, egg.id));
            await i.update({
              content: `🧭 **${site.name}** claimed — a **${loot.eggRarity}** egg, **${loot.cash}** cash, and **${loot.food.qty}× ${FOODS[loot.food.foodId].name}**.`,
              embeds: [], components: rows, attachments: [],
            });
          } catch (e) {
            if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
            else throw e;
          }
          return;
        }
        const siteId = parts[3];
        // Object.hasOwn, never a truthiness test: EXPEDITION_SITES is a plain object literal
        // (src/data/sites.ts), so EXPEDITION_SITES['constructor'] reads back truthy through
        // Object.prototype with an undefined .cost, and the card would quote "undefined for
        // NaN cash" off a segment the client chose. A truncated id has no fourth segment at
        // all; hasOwn coerces that undefined to the string 'undefined', which is not a site.
        if (!Object.hasOwn(EXPEDITION_SITES, siteId)) { await i.deferUpdate(); return; }
        const site = EXPEDITION_SITES[siteId];
        const now = ctx.now();
        // ONE expression, both arms: the price the card QUOTES and the price the confirm
        // RECHECKS are the same call, so they cannot drift apart.
        const price = expeditionFeeFor(site.cost, eventMods(now).expeditionFee);
        if (action === 'again') {
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`exp:againyes:${i.user.id}:${siteId}:${price}`)
              .setLabel(`Dig — ${price.toLocaleString('en-US')} cash`).setStyle(ButtonStyle.Success));
          await i.reply({
            // EXPEDITION_START_HEADER_KEYS, not the claim keys: this card is about to LOCK IN
            // a duration and a fee, which is exactly what those two keys cover, and it is what
            // tells a player why an Amber Storm doubled the number in front of them.
            content: `${eventHeaderLine(now, EXPEDITION_START_HEADER_KEYS)}\n\nSend a crew back to **${site.name}** for **${price.toLocaleString('en-US')}** cash?`,
            components: [row],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const quoted = Number(parts[4]);
        if (!Number.isInteger(quoted)) { await i.deferUpdate(); return; }
        // The whole point of the segment. An expedition fee moves with the world event at
        // every UTC midnight, so a confirm card left open across one would charge today's
        // price under yesterday's label. Refusing is the PURPOSE of the segment, not a
        // nicety — the repaint below is a second layer only, because any OTHER open card
        // still holds a button minted at the old price.
        if (price !== quoted) {
          await i.reply({
            content: `${site.name} costs ${price.toLocaleString('en-US')} cash now, not ${quoted.toLocaleString('en-US')} — open the Dig again card for the current price.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        try {
          // startExpedition is what makes a second click of this same confirm harmless: it
          // refuses while a dig is out. There is no idempotency key here and none is needed.
          const exp = startExpedition(ctx, i.user.id, siteId, i.guildId);
          await i.update({
            content: `🧭 Crew dispatched to **${site.name}** — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.`,
            embeds: [], components: [], attachments: [],
          });
        } catch (e) {
          if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // A site is a proper place name, so no article — the same clause /expedition
            // start renders (Task 3 (G1-C)), and the numbers come off the error rather than
            // being re-derived here.
            await i.reply({
              content: `Not enough cash — ${site.name} ${shortfallLine(e)}.`,
              flags: MessageFlags.Ephemeral,
            });
          } else throw e;
        }
      },
    },
  ],
};
