import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser, buildLot, upgradeLot, upgradeCostFor, collectIncome, pendingIncome, capHours, LotLimitError, UnknownKindError, DuplicateFacilityError, toClockDinos } from './service.js';
import { feedAll, feedSkipReport } from '../care/service.js';
import { settleEscapes } from './escapes.js';
import { assignDino, unassignDino, decorateLot, listDinos, paddockCapacity, AssignError, DietMismatchError, renameDino } from './dinos.js';
import { dashboardPayload, animalsPayload, lotsPayload, prestigePayload, withParkImage, landmarkPayload, isParkTab, type ParkTab } from './embeds.js';
import { guestsPayload } from '../guests/embeds.js';
import { visitPayload } from './visit.js';
import { bumpLegacyBest, legacyRank } from './ranks.js';
import { buildParkSnapshot } from './snapshot.js';
import { renderPark } from '../../core/render/client.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { buyLandmark, nextLandmark, landmarkTierOf, LandmarkMaxedError } from './landmarks.js';
import { landmarkFor, MAX_LANDMARK_TIER } from '../../data/landmarks.js';
import { setMotto, setFeaturedDino, featuredFor, ShowcaseError } from './showcase.js';
import { defangLinks } from '../../core/text.js';
import { escapeAt, ESCAPE_WARN_MS } from '../../core/clock.js';
import { PADDOCKS } from '../../data/paddocks.js';
import { FACILITIES } from '../../data/facilities.js';
import { DECOR } from '../../data/decor.js';
import { FOODS, type FoodId } from '../../data/foods.js';
import { getSpecies } from '../../data/species/index.js';
import { matches, respondRanked, emptyRow, dinoLabel } from '../../core/autocomplete.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { emojiTag, foodEmoji } from '../../core/emojis.js';
import { traitDefs } from '../../data/traits.js';
import type { Ctx } from '../../core/context.js';
import { assetImage, attach } from '../../core/images.js';
import { attendanceOf } from './attendance.js';
import { earnedTierCount } from '../daily/service.js';
import { seasonBadges } from '../daily/season.js';
import { lotSlots } from '../../data/progression.js';
import type { AttachmentBuilder, ButtonInteraction } from 'discord.js';

const kindChoices = [...Object.keys(PADDOCKS), ...Object.keys(FACILITIES)]
  .map((k) => ({ name: k.replaceAll('_', ' '), value: k }));

// emojiTag is resolved per call, never at module scope — the app-emoji map only
// loads after client ready.
function collectPayload(amount: number) {
  const embed = new EmbedBuilder().setColor(0x3ba55c)
    .setTitle(`${emojiTag('dw_cash')} Park income`)
    .setDescription(amount > 0
      ? `Collected **${amount.toLocaleString()}** cash.`
      : 'Nothing to collect yet — give your dinos time to earn.');
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[]; flags: MessageFlags.Ephemeral } =
    { embeds: [embed], flags: MessageFlags.Ephemeral };
  attach(embed, payload, 'image', assetImage('banners', 'collect'));
  return payload;
}

function dinoListPayload(ctx: Ctx, userId: string, page: number) {
  const all = listDinos(ctx, userId);
  const { items, page: p, pages } = paginate(all, page);
  const nowMs = ctx.now();
  const lines = items.length
    ? items.map((d) => {
        // Comfort is clamped for display only: the raw value drives income and the
        // escape instant, but "is this animal all right" is a 0-100% question, and
        // docs/gameplay.md states in writing that it does not exceed 100%. The rung
        // gets its own mark so the player can see what the decor bought.
        const comfortPct = Math.round(Math.min(1, d.comfort) * 100);
        const rung = d.enrichment > 1 ? ` · enriched +${Math.round((d.enrichment - 1) * 100)}%` : '';
        const status = d.dino.escapedAt !== null
          ? `${emojiTag('dw_alert')} ESCAPED — /rescue`
          : `${comfortPct}% comfort${rung}`;
        const warn = d.dino.escapedAt === null && d.escapeAt !== null && d.escapeAt - nowMs <= ESCAPE_WARN_MS
          ? ` — ${emojiTag('dw_hunger')} escapes <t:${Math.floor(d.escapeAt / 1000)}:R>` : '';
        const loc = d.dino.lotId ? `lot ${d.dino.lotId}` : 'unassigned';
        const habitat = d.mismatch ? ' — ⚠️ wrong habitat' : '';
        const title = d.dino.nickname ? `${d.dino.nickname} (${d.species.name})` : d.species.name;
        // Compact one-line inline form — never traitLines(): the list is paginated at 10 rows
        // and traitLines()'s one-line-per-trait-plus-blurb block would risk the embed limits
        // that a single trait mark per row stays comfortably under.
        const marks = traitDefs(d.dino.traits).map((t) => `${emojiTag(t.emoji) || t.fallback} ${t.name}`).join(' · ');
        const marksLine = marks ? ` — ${marks}` : '';
        return `#${d.dino.id} ${title} — ${status}${warn}${habitat} — ${loc}${marksLine}`;
      }).join('\n')
    : 'No dinos yet. Hatch one!';
  const embed = new EmbedBuilder().setTitle('🦕 Your dinos').setDescription(lines).setColor(0x3ba55c)
    .setFooter({ text: `Page ${p}/${pages}` });
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: pages > 1 ? [pageRow('park', 'dinos', userId, p, pages)] : [] };
  attach(embed, payload, 'image', assetImage('banners', 'dino_roster'));
  return payload;
}

export const parkModule: ModuleManifest = {
  name: 'park',
  commands: [
    {
      data: new SlashCommandBuilder().setName('park').setDescription('Your park')
        .addSubcommand((s) => s.setName('view').setDescription('Park dashboard')
          .addUserOption((o) => o.setName('user').setDescription('View another player\'s park').setRequired(false)))
        .addSubcommand((s) => s.setName('rename').setDescription('Rename your park')
          .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(60)))
        .addSubcommand((s) => s.setName('alerts').setDescription('Turn proactive park alerts on or off')
          .addStringOption((o) => o.setName('state').setDescription('On or off').setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
        .addSubcommand((s) => s.setName('landmark').setDescription('Your park landmark — the prestige ladder'))
        .addSubcommand((s) => s.setName('motto').setDescription('The line visitors see on your park card')
          .addStringOption((o) => o.setName('text').setDescription('Up to 80 characters — leave blank to clear').setRequired(false).setMaxLength(80)))
        .addSubcommand((s) => s.setName('feature').setDescription('Feature one dino on your park card')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search; leave blank to clear').setRequired(false).setAutocomplete(true))),
      async execute(ctx, i) {
        const user = getOrCreateUser(ctx, i.user.id, i.user.displayName);
        // A real switch, not a chain of equality checks with the view path as the
        // fallthrough: /park previously reported success for any subcommand nobody had
        // implemented, because the last branch WAS the dashboard.
        switch (i.options.getSubcommand()) {
          case 'rename': {
            // Defanged before it is stored, the same way setMotto/renameDino are: parkName
            // reaches landmarkPayload's public embed DESCRIPTION (`/park landmark`), where
            // `[text](url)` renders as a masked link. Storing the defanged value once is
            // what keeps this reply and every later read (dashboard title, landmark
            // description) in agreement — nothing downstream re-defangs.
            const name = defangLinks(i.options.getString('name', true));
            ctx.db.update(schema.users).set({ parkName: name })
              .where(eq(schema.users.discordId, i.user.id)).run();
            await i.reply({ content: `Park renamed to **${name}**.` });
            return;
          }
          case 'alerts': {
            const on = i.options.getString('state', true) === 'on';
            ctx.db.update(schema.users).set({ alertsEnabled: on })
              .where(eq(schema.users.discordId, i.user.id)).run();
            await i.reply({
              content: on
                ? '🔔 Park alerts are **on** — you will get a DM before a dino escapes, when your park hits its income cap, and when another player duels your park.'
                : '🔕 Park alerts are **off**. Duel results are muted too. Egg, breeding, and expedition notifications are unaffected. Turn them back on with `/park alerts state:on`.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          case 'landmark': {
            // getOrCreateUser already returned the row with landmarkTier in hand:
            // landmarkTierOf and nextLandmark would each re-select the same row for one render.
            await i.reply(landmarkPayload(user, landmarkFor(user.landmarkTier), landmarkFor(user.landmarkTier + 1)));
            return;
          }
          case 'motto': {
            try {
              const saved = setMotto(ctx, i.user.id, i.options.getString('text'));
              await i.reply({ content: saved ? `📣 Motto set to **${saved}**.` : '📣 Motto cleared.' });
            } catch (e) {
              if (e instanceof ShowcaseError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              else throw e;
            }
            return;
          }
          case 'feature': {
            try {
              const species = setFeaturedDino(ctx, i.user.id, i.options.getInteger('dino'));
              await i.reply({
                content: species
                  ? `🦖 Featured **${species.name}** on your park card.`
                  : '🦖 Featured dino cleared.',
              });
            } catch (e) {
              if (e instanceof ShowcaseError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              else throw e;
            }
            return;
          }
          case 'view':
            break;
          default:
            await i.reply({ content: 'Unknown /park subcommand.', flags: MessageFlags.Ephemeral });
            return;
        }
        const targetUser = i.options.getUser('user');
        if (targetUser && targetUser.id !== i.user.id) {
          // The existence check stays ahead of the defer: "no park yet" is an ephemeral
          // reply, and deferReply would commit this interaction to a public one.
          const targetRow = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, targetUser.id)).get();
          if (!targetRow) { await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral }); return; }
          await i.deferReply();
          await i.editReply((await visitPayload(ctx, targetUser.id))!);
          return;
        }
        await i.deferReply();
        settleEscapes(ctx, i.user.id);
        const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all();
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        const escapedCount = dinos.filter((d) => d.escapedAt !== null).length;
        const { clockDinos } = toClockDinos(ctx, i.user.id);
        const nowMs = ctx.now();
        const pending = pendingIncome(ctx, i.user.id);
        const capped = pending > 0 && ctx.now() - user.lastCollectAt >= capHours(lots) * 3_600_000;
        // Counts DISTINCT dinos, not distinct problems: at-risk and mismatch are independent
        // predicates over the same non-escaped dinos, so one dino can trip both (an off-diet
        // paddock is paddockFit 0.5, which is exactly what drives comfort down and pulls
        // escapeAt into the warning window — mismatched dinos are disproportionately the
        // at-risk ones). Summing three separate counts here double-counted that dino, which
        // could render more "need attention" than the park actually holds. The Animals tab's
        // itemised breakdown is unaffected by this — it lists issues, not dinos, so summing
        // there is correct.
        const needsAttentionCount = clockDinos.filter((c) => {
          if (c.escapedAt !== null) return false;
          const e = escapeAt(c);
          const atRisk = e !== null && e - nowMs <= ESCAPE_WARN_MS;
          const mismatch = c.paddock !== null && c.paddock.diet !== c.species.diet;
          return atRisk || mismatch;
        }).length;
        // bumpLegacyBest stays on this path even though its result is no longer displayed
        // here: the Park tab is the first thing every /park view renders, so the legacy
        // high-water still latches on every view. The Legacy display itself moves to the
        // Prestige tab.
        bumpLegacyBest(ctx, i.user.id);
        const attention = escapedCount + needsAttentionCount;
        const base = dashboardPayload(user, pending, {
          attention, capped, now: nowMs, motto: user.motto, dinoCount: dinos.length,
        });
        let png: Buffer | undefined;
        try { png = await renderPark(buildParkSnapshot(ctx, i.user.id)); } catch { png = undefined; }
        await i.editReply(png ? withParkImage(base, png) : base);
      },
      async autocomplete(ctx, i) {
        // /park's only autocompleting option, on `feature`. Provider contract: i.respond
        // only, never getOrCreateUser (no row creation on a keystroke), read-only.
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        if (!dinos.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const q = String(i.options.getFocused());
        const now = ctx.now();
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          // Every owned dino is valid: featuring neither consumes nor moves one, so an
          // escaped or unassigned dino is a fine target — the /dino rename reasoning.
          .map(({ d, species }) => ({ value: d.id, label: dinoLabel(d, species, now), valid: true })));
      },
    },
    {
      data: new SlashCommandBuilder().setName('build').setDescription('Build on an empty lot')
        .addStringOption((o) => o.setName('kind').setDescription('What to build').setRequired(true)
          .addChoices(...kindChoices)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const lot = buildLot(ctx, i.user.id, i.options.getString('kind', true));
          const hint = lot.type === 'paddock' ? ' Assign a dino with /dino assign to start earning.' : '';
          await i.reply({ content: `🏗️ Built **${lot.name}** (lot #${lot.id}).${hint}` });
        } catch (e) {
          if (e instanceof DuplicateFacilityError) await i.reply({ content: `You already have a ${e.message} — upgrade it instead.`, flags: MessageFlags.Ephemeral });
          else if (e instanceof LotLimitError) await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
    },
    {
      data: new SlashCommandBuilder().setName('upgrade').setDescription('Upgrade a lot')
        .addIntegerOption((o) => o.setName('lot').setDescription('Lot — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const lotId = i.options.getInteger('lot', true);
        // Hoisted so the InsufficientFundsError branch below can quote the price: upgradeLot
        // does the same lookup internally, so this is one cheap extra read, not a second
        // source of truth for the cost (upgradeCostFor stays the only place that computes it).
        const lotRow = ctx.db.select().from(schema.lots)
          .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
        try {
          const lot = upgradeLot(ctx, i.user.id, lotId);
          await i.reply({ content: `⬆️ **${lot.name}** is now level ${lot.level}.` });
        } catch (e) {
          if (e instanceof LotLimitError) await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });
          else if (e instanceof UnknownKindError) await i.reply({ content: 'No such lot.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({
            content: `Not enough cash — that upgrade costs ${upgradeCostFor(lotRow!.kind, lotRow!.level).toLocaleString('en-US')}.`,
            flags: MessageFlags.Ephemeral,
          });
          else throw e;
        }
      },
      async autocomplete(ctx, i) {
        const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all();
        if (!lots.length) { await respondRanked(i, [emptyRow('No lots — /build one first', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, lots
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => {
            const maxLevel = FACILITIES[l.kind]?.maxLevel ?? 4;
            const valid = l.level < maxLevel;
            const price = valid ? ` — ${upgradeCostFor(l.kind, l.level).toLocaleString('en-US')} cash` : '';
            return { value: l.id, valid, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})${valid ? price : ' — MAX LEVEL'}` };
          }));
      },
    },
    {
      data: new SlashCommandBuilder().setName('dino').setDescription('Manage your dinos')
        .addSubcommand((s) => s.setName('list').setDescription('List your dinos'))
        .addSubcommand((s) => s.setName('assign').setDescription('Assign a dino to a paddock')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('lot').setDescription('Paddock — type to search').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('unassign').setDescription('Remove a dino from its paddock')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('rename').setDescription('Give a dino a nickname')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName('nickname').setDescription('New nickname — leave blank to clear it').setRequired(false).setMaxLength(32))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'list') {
            await i.reply(dinoListPayload(ctx, i.user.id, 1));
          } else if (sub === 'assign') {
            const dinoId = i.options.getInteger('dino', true);
            const lotId = i.options.getInteger('lot', true);
            try {
              assignDino(ctx, i.user.id, dinoId, lotId);
              await i.reply({ content: '🦕 Assigned.' });
            } catch (e) {
              if (!(e instanceof DietMismatchError)) throw e;
              const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`park:assignyes:${i.user.id}:${dinoId}:${lotId}`)
                  .setLabel('Assign anyway').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`park:assignno:${i.user.id}`)
                  .setLabel('Cancel').setStyle(ButtonStyle.Secondary));
              await i.reply({ content: `⚠️ ${e.message}`, components: [row], flags: MessageFlags.Ephemeral });
            }
          } else if (sub === 'rename') {
            const nickname = i.options.getString('nickname');
            renameDino(ctx, i.user.id, i.options.getInteger('dino', true), nickname);
            const cleared = !nickname || !nickname.trim();
            // renameDino defangs what it stores but returns void, so the echo re-defangs
            // the trimmed input rather than trusting the raw nickname — this nickname
            // reaches public battle embeds, where `[text](url)` renders as a masked link.
            await i.reply({ content: cleared ? '🦕 Nickname cleared.' : `🦕 Renamed to **${defangLinks(nickname!.trim())}**.` });
          } else {
            unassignDino(ctx, i.user.id, i.options.getInteger('dino', true));
            await i.reply({ content: '🦕 Unassigned.' });
          }
        } catch (e) { if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      },
      async autocomplete(ctx, i) {
        const focused = i.options.getFocused(true);
        const q = String(focused.value);
        const now = ctx.now();
        if (focused.name === 'dino') {
          const sub = i.options.getSubcommand();
          const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
          if (!dinos.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
          await respondRanked(i, dinos
            .map((d) => ({ d, species: getSpecies(d.speciesId) }))
            .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
            .map(({ d, species }) => ({
              value: d.id, label: dinoLabel(d, species, now),
              // renameDino has no lot/escape restriction (ownership + length only), so an
              // escaped or unassigned dino is a fully valid rename target, unlike assign.
              valid: sub === 'unassign' ? d.lotId !== null : sub === 'rename' ? true : d.escapedAt === null,
            })));
          return;
        }
        // focused.name === 'lot' (assign target) — paddocks only, FULL tagged
        const paddocks = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all()
          .filter((l) => l.type === 'paddock');
        if (!paddocks.length) { await respondRanked(i, [emptyRow('No paddocks — /build one first', 0)]); return; }
        const occupants = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        await respondRanked(i, paddocks
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => {
            const occ = occupants.filter((d) => d.lotId === l.id).length;
            const cap = paddockCapacity(l.level);
            const valid = occ < cap;
            return { value: l.id, valid, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level}, ${occ}/${cap})${valid ? '' : ' — FULL'}` };
          }));
      },
    },
    {
      data: new SlashCommandBuilder().setName('decorate').setDescription('Add decor to a paddock')
        .addIntegerOption((o) => o.setName('lot').setDescription('Paddock — type to search').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('item').setDescription('Decoration — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          decorateLot(ctx, i.user.id, i.options.getInteger('lot', true), i.options.getString('item', true));
          await i.reply({ content: '🌴 Decoration added.' });
        } catch (e) {
          if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
      async autocomplete(ctx, i) {
        const focused = i.options.getFocused(true);
        if (focused.name === 'item') {
          // Static data only — no DB read, no user row. Biomes and cost are in the
          // label because the purchase is permanent: there is no removal or refund
          // path short of adminReset, so the buying surface is the only place a
          // mistake can be prevented.
          await respondRanked(i, Object.values(DECOR)
            .filter((d) => matches(String(focused.value), d.name, d.kind, ...d.biomeTags))
            .map((d) => ({
              value: d.kind, valid: true,
              label: `${d.name} — ${d.biomeTags.join('/')} — ${d.cost} cash`,
            })));
          return;
        }
        const paddocks = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all()
          .filter((l) => l.type === 'paddock');
        if (!paddocks.length) { await respondRanked(i, [emptyRow('No paddocks — /build one first', 0)]); return; }
        const q = String(focused.value);
        await respondRanked(i, paddocks
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => ({ value: l.id, valid: true, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})` })));
      },
    },
  ],
  components: [
    {
      prefix: 'park',
      async execute(ctx, i) {
        if (i.customId === 'park:collect') {
          // This customId carries no owner segment by design — a viewer clicking it on
          // someone else's park card collects their OWN income, not the card owner's —
          // so there is no id to owner-check, and unlike every other component handler
          // this one never called getOrCreateUser either. A clicker who has never run
          // any command holds no users row at all, and collectIncome's toClockDinos
          // assumed one existed, crashing with a TypeError instead of replying.
          // getOrCreateUser mints the row first, same as mythic:confirm, so a
          // first-time clicker collects a clean $0 rather than crashing.
          getOrCreateUser(ctx, i.user.id, i.user.displayName);
          settleEscapes(ctx, i.user.id);
          const { amount } = collectIncome(ctx, i.user.id);
          await i.reply(collectPayload(amount));
          return;
        }
        const parts = i.customId.split(':');
        const [, action, uid, pageStr] = parts;
        // A real switch with a default arm, not a chain of equality checks that falls off
        // the end. An action nobody wrote a branch for — a stale id from an older deploy,
        // or a tab name that was renamed — used to return without acknowledging, and
        // Discord paints "This interaction failed" after 3 seconds. The default answers
        // with deferUpdate for the same reason the router's guard rejection does: a silent
        // ack is correct where a bare return is visibly broken, and a distinct text reply
        // would be an oracle. Any future park action MUST be added as its own case.
        switch (action) {
          case 'assignyes':
          case 'assignno': {
            if (i.user.id !== uid) { await i.reply({ content: 'Not your assignment.', flags: MessageFlags.Ephemeral }); return; }
            if (action === 'assignno') { await i.update({ content: 'Assignment cancelled.', components: [] }); return; }
            settleEscapes(ctx, i.user.id);
            try {
              assignDino(ctx, i.user.id, Number(parts[3]), Number(parts[4]), { allowMismatch: true });
              await i.update({ content: '🦕 Assigned — wrong habitat, comfort halved.', components: [] });
            } catch (e) {
              if (e instanceof AssignError) await i.update({ content: e.message, components: [] });
              else throw e;
            }
            return;
          }
          case 'dinos': {
            if (i.user.id !== uid) { await i.reply({ content: 'Not your list.', flags: MessageFlags.Ephemeral }); return; }
            settleEscapes(ctx, i.user.id);
            await i.update({ ...dinoListPayload(ctx, i.user.id, Number(pageStr)), attachments: [] });
            return;
          }
          case 'tour': {
            // NO owner check on purpose: a park visit is public and read-only, and `uid`
            // here is the TARGET park, not an owner. Turning this into an ownership check
            // would make Next park work only for the player whose park is on screen.
            //
            // The existence check stays AHEAD of the acknowledgement so "no park yet" can
            // still be an ephemeral reply — the /park view user: ordering exactly.
            const exists = ctx.db.select().from(schema.users)
              .where(eq(schema.users.discordId, uid)).get();
            if (!exists) { await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral }); return; }
            // Acknowledge BEFORE rendering: visitPayload awaits renderPark, whose own
            // RENDER_TIMEOUT_MS is already 3000 — Discord's entire initial-response window —
            // and renders serialize process-wide, so queue wait stacks on top of it. Rendering
            // first meant a slow render lost the interaction to 10062 and the user saw "This
            // interaction failed" with no park, which is also the one case visitPayload's
            // render-failure degrade could never be delivered for.
            //
            // deferUpdate + editReply, never deferReply: a tour advances ONE message rather
            // than accumulating a new one per hop.
            await i.deferUpdate();
            const payload = await visitPayload(ctx, uid);
            // attachments: [] — the message being replaced carries the previous park's
            // uploads, and this payload brings its own.
            await i.editReply({ ...payload!, attachments: [] });
            return;
          }
          case 'landmark': {
            // customId is park:landmark:buy:<userId>:<tier> — five parts, so the owner id sits
            // at index 3 (not the outer destructure's `uid`, which caught 'buy' there) and the
            // rung the button OFFERED at index 4.
            //
            // The tier is checked, not trusted, and that check is the actual guard against a
            // stale button: a /park landmark message is never refreshed by anything else, so its
            // label stays frozen on the rung it was minted for while buyLandmark re-derives
            // current+1 fresh on every click. Four clicks of one button labelled "Build Stone
            // Marker" charged 5,000,000, 10,000,000, 20,000,000 and 40,000,000 — 32x its own
            // label, and there is no refund path. The i.update on success is a second layer
            // only: another open message still holds a stale button.
            const [, , , landmarkUid, tierStr] = parts;
            if (i.user.id !== landmarkUid) { await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral }); return; }
            // tierStr is CLIENT-supplied. Number('') is 0 and Number(undefined) is NaN, so a
            // truncated or forged customId is rejected here rather than reaching buyLandmark.
            const offered = Number(tierStr);
            if (!Number.isInteger(offered) || offered < 1 || offered > MAX_LANDMARK_TIER) {
              await i.reply({ content: 'That landmark button is no longer valid — run `/park landmark` again.', flags: MessageFlags.Ephemeral });
              return;
            }
            const rung = landmarkFor(offered)!;
            const current = landmarkTierOf(ctx, i.user.id);
            // At the top of the ladder there is no next rung at all, so every button is stale
            // in the same way and buyLandmark's LandmarkMaxedError names the reason better than
            // this branch could — only a below-the-top mismatch is answered here.
            if (current < MAX_LANDMARK_TIER && offered !== current + 1) {
              // A genuinely stale button always offers a rung at or below the current tier, but
              // offered > current + 1 is reachable two ways — a forged customId, and an old
              // higher-rung message still live after adminReset zeroed the tier — so the two
              // directions get their own wording rather than one claiming a rung is built when
              // it is actually still ahead of the player.
              await i.reply({
                content: offered <= current
                  ? `Tier ${offered} — the ${rung.name} — is already built. Run \`/park landmark\` again for the rung you can buy now.`
                  : `Tier ${offered} — the ${rung.name} — isn't next: you can buy tier ${current + 1}. Run \`/park landmark\` again.`,
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            try {
              const def = buyLandmark(ctx, i.user.id);
              const fresh = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, i.user.id)).get()!;
              // i.update, not i.reply: the message the player just clicked must stop offering a
              // rung it has already sold. No attachments key by hand — landmarkPayload attaches
              // banners/landmark on every call, so this update replaces the message's attachment
              // set with an identical one. Setting `attachments: []` here would be the fightFrames
              // rule misapplied: that rule exists because one MessagePayload object reaches two
              // send sites and each must shed the other's set, and landmarkPayload builds a fresh
              // object per call that is spread into exactly one send.
              await i.update({
                ...landmarkPayload(fresh, def, nextLandmark(ctx, i.user.id)),
                content: `🏛️ Built the **${def.name}**.`,
              });
            } catch (e) {
              if (e instanceof LandmarkMaxedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              else if (e instanceof InsufficientFundsError) {
                await i.reply({
                  content: `Not enough cash — the ${rung.name} costs ${rung.cost.toLocaleString('en-US')}.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else throw e;
            }
            return;
          }
          case 'tab': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            const tab = parts[3];
            // Client-supplied: validated against the real union, never cast. An
            // unrecognised name is absorbed silently rather than falling through to a
            // default screen, which would report success for a tab nobody implemented.
            if (!isParkTab(tab)) { await i.deferUpdate(); return; }
            await renderTab(ctx, i, i.user.id, tab, false);
            return;
          }
          case 'feedall': {
            // park:feedall:<uid> acts on the alerted user's park — same shape as the
            // alert:feedall handler, not the tour/collect self-serve pattern.
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            settleEscapes(ctx, i.user.id);
            const { fed, skipped } = feedAll(ctx, i.user.id);
            const report = feedSkipReport(ctx, i.user.id, skipped);
            const head = fed.length === 0
              ? (skipped.length > 0 ? '🍖 Nothing could be fed.' : '🍖 Nothing to feed — every dino is already full.')
              : `🍖 Fed **${fed.length}** ${fed.length === 1 ? 'dino' : 'dinos'}.`;
            // Re-renders the Animals tab beneath the result line rather than collapsing to
            // a bare confirmation: alert:feedall collapses because an alert DM has nothing
            // to return to, but this card is the screen the player is standing on.
            await renderTab(ctx, i, i.user.id, 'animals', false, report ? `${head}\n\n${report}` : head);
            return;
          }
          case 'goto': {
            // park:goto:<target>:<uid> — four parts, so the owner sits at index 3 (not the
            // outer destructure's `uid`, which caught 'landmark'/'guests' there).
            const [, , target, gotoUid] = parts;
            if (i.user.id !== gotoUid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            // Ephemeral, never i.update: a routed payload mints its own components under a
            // foreign prefix, and those handlers re-render THEIR message with no tab row —
            // so updating in place would strand the player one click from losing navigation.
            const fresh = ctx.db.select().from(schema.users)
              .where(eq(schema.users.discordId, i.user.id)).get()!;
            if (target === 'landmark') {
              await i.reply({
                ...landmarkPayload(fresh, landmarkFor(fresh.landmarkTier), landmarkFor(fresh.landmarkTier + 1)),
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            if (target === 'guests') {
              await i.reply({ ...guestsPayload(ctx, i.user.id), flags: MessageFlags.Ephemeral });
              return;
            }
            await i.deferUpdate();
            return;
          }
          case 'vtab': {
            // NO owner check, deliberately: `uid` here is the TARGET park, not an owner,
            // exactly like park:tour. An ownership check would make visiting work only for
            // the player whose park happens to be on screen.
            const tab = parts[3];
            if (!isParkTab(tab)) { await i.deferUpdate(); return; }
            // The existence check stays AHEAD of any acknowledgement so "no park yet" can
            // still be ephemeral — the /park view user: ordering exactly.
            const exists = ctx.db.select().from(schema.users)
              .where(eq(schema.users.discordId, uid)).get();
            if (!exists) {
              await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral });
              return;
            }
            await renderTab(ctx, i, uid, tab, true);
            return;
          }
          default:
            await i.deferUpdate();
            return;
        }
      },
    },
    {
      prefix: 'alert',
      async execute(ctx, i) {
        const [, action, uid] = i.customId.split(':');
        // deferUpdate BEFORE the owner check, copying daily/ach: a customId shape from an
        // older deploy must be absorbed rather than shown as "This interaction failed".
        if (action !== 'feedall' && action !== 'collect' && action !== 'mute') {
          await i.deferUpdate();
          return;
        }
        // Every alert button acts on the ALERTED user, so ownership is checked here — the
        // park:assignyes pattern, not the self-serve park:collect one.
        if (i.user.id !== uid) {
          await i.reply({ content: 'That is not your park.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === 'mute') {
          ctx.db.update(schema.users).set({ alertsEnabled: false })
            .where(eq(schema.users.discordId, i.user.id)).run();
          // attachments: [] sheds the alert's banner upload — this update carries no files.
          await i.update({
            content: '🔕 Park alerts muted. Turn them back on with `/park alerts state:on`.',
            embeds: [], components: [], attachments: [],
          });
          return;
        }
        if (action === 'collect') {
          settleEscapes(ctx, i.user.id);
          const { amount } = collectIncome(ctx, i.user.id);
          await i.update({
            content: amount > 0
              ? `💰 Collected **${amount.toLocaleString('en-US')}** cash.`
              : 'Nothing to collect yet — give your dinos time to earn.',
            embeds: [], components: [], attachments: [],
          });
          return;
        }
        // feedall
        settleEscapes(ctx, i.user.id);
        const { fed, skipped } = feedAll(ctx, i.user.id);
        // The bare count stranded the player: feedSkipReport names each skipped dino and
        // the food it is short of, so the next step is a purchase rather than a hunt.
        const report = feedSkipReport(ctx, i.user.id, skipped);
        const head = fed.length === 0
          ? (skipped.length > 0
              ? '🍖 Nothing could be fed.'
              : '🍖 Nothing to feed — every dino is already full.')
          : `🍖 Fed **${fed.length}** ${fed.length === 1 ? 'dino' : 'dinos'}.`;
        await i.update({
          content: report ? `${head}\n\n${report}` : head,
          embeds: [], components: [], attachments: [],
        });
      },
    },
  ],
};

/**
 * Renders one tab onto the message that was clicked.
 *
 * settleEscapes runs ONCE here rather than in each builder: it is write-bearing, and
 * buildParkSnapshot settles again internally, so a per-builder call would multiply a
 * mutation across a navigation click.
 *
 * The Park tab defers first. renderPark's own RENDER_TIMEOUT_MS is 3000 — Discord's entire
 * initial-response window — and renders serialize process-wide, so rendering before
 * acknowledging loses the interaction to 10062 and shows "This interaction failed".
 * deferUpdate, never deferReply: a tab advances ONE message rather than accumulating one
 * per click, the park:tour reasoning exactly.
 *
 * Every branch sends attachments: [] — a tab switch is a different-banner render, and
 * without it the outgoing tab's uploads survive alongside the incoming one as orphan
 * attachment cards. This is the opposite of the omit-idiom landmarkPayload uses.
 *
 * `content` is an optional trailing result line — today only park:feedall's "Fed N
 * dinos" / skip report, spread onto the Animals tab it re-renders. It is spread FIRST
 * in every branch's payload object: none of the four tab builders set a `content` key
 * themselves today, so the order is cosmetic right now, but a future builder that does
 * set one must win over a stale caller-supplied value — reordering the spread would
 * silently let this parameter clobber a builder's own content instead.
 */
async function renderTab(
  ctx: Ctx, i: ButtonInteraction, ownerId: string, tab: ParkTab, visit: boolean, content?: string,
): Promise<void> {
  settleEscapes(ctx, ownerId);
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, ownerId)).get()!;
  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, ownerId)).all();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, ownerId)).all();
  if (tab === 'park') {
    await i.deferUpdate();
    const { clockDinos } = toClockDinos(ctx, ownerId);
    const nowMs = ctx.now();
    const escaped = dinos.filter((d) => d.escapedAt !== null).length;
    // A single pass over DISTINCT dinos, matching /park view's own execute path (below):
    // at-risk and mismatch are independent predicates over the same non-escaped dinos, so
    // one dino can trip both, and summing them separately double-counts it.
    const needsAttention = clockDinos.filter((c) => {
      if (c.escapedAt !== null) return false;
      const e = escapeAt(c);
      const atRisk = e !== null && e - nowMs <= ESCAPE_WARN_MS;
      const mismatch = c.paddock !== null && c.paddock.diet !== c.species.diet;
      return atRisk || mismatch;
    }).length;
    const pending = visit ? 0 : pendingIncome(ctx, ownerId);
    const capped = pending > 0 && ctx.now() - user.lastCollectAt >= capHours(lots) * 3_600_000;
    const base = dashboardPayload(user, pending, {
      attention: escaped + needsAttention, capped, now: nowMs,
      motto: user.motto, dinoCount: dinos.length, visit,
    });
    let png: Buffer | undefined;
    try { png = await renderPark(buildParkSnapshot(ctx, ownerId)); } catch { png = undefined; }
    await i.editReply({ ...(content ? { content } : {}), ...(png ? withParkImage(base, png) : base), attachments: [] });
    return;
  }
  if (tab === 'animals') {
    const { clockDinos } = toClockDinos(ctx, ownerId);
    const nowMs = ctx.now();
    const inv = ctx.economy.getFoodInventory(ownerId);
    const foodLine = (Object.entries(inv) as Array<[FoodId, number]>)
      .map(([id, q]) => `${foodEmoji(id)}${FOODS[id].name} ×${q}`).join(' · ') || 'none — /shop food';
    await i.update({
      ...(content ? { content } : {}),
      ...animalsPayload(user, dinos.length, {
        escaped: dinos.filter((d) => d.escapedAt !== null).length,
        atRisk: clockDinos.filter((c) => {
          if (c.escapedAt !== null) return false;
          const e = escapeAt(c);
          return e !== null && e - nowMs <= ESCAPE_WARN_MS;
        }).length,
        mismatch: clockDinos.filter((c) =>
          c.paddock !== null && c.escapedAt === null && c.paddock.diet !== c.species.diet).length,
        foodLine, featured: featuredFor(ctx, user), visit,
      }),
      attachments: [],
    });
    return;
  }
  if (tab === 'lots') {
    await i.update({
      ...(content ? { content } : {}),
      ...lotsPayload(user, lots, lotSlots(user.ratingHighWater), { visit }),
      attachments: [],
    });
    return;
  }
  // prestige — legacyRank (pure), never bumpLegacyBest: the high-water latches on the
  // Park tab, which every /park view renders first, so a navigation click never writes.
  await i.update({
    ...(content ? { content } : {}),
    ...prestigePayload(user, {
      attendance: attendanceOf(ctx, ownerId).attendance,
      earnedTiers: earnedTierCount(ctx, ownerId),
      legacyRank: legacyRank(ctx, ownerId),
      seasonBadges: seasonBadges(ctx, ownerId),
      landmark: landmarkFor(user.landmarkTier),
      visit,
    }),
    attachments: [],
  });
}
