import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser, buildLot, upgradeLot, upgradeCostFor, maxLevelFor, collectIncome, pendingIncome, capHours, LotLimitError, UnknownKindError, DuplicateFacilityError, StaleLevelError, toClockDinos, needsAttentionCount } from './service.js';
import { feedAll, feedSkipReport } from '../care/service.js';
import { settleEscapes } from './escapes.js';
import { assignDino, unassignDino, decorateLot, listDinos, paddockCapacity, eligiblePaddocks, PADDOCK_FULL, DINO_ESCAPED, AssignError, DietMismatchError, renameDino } from './dinos.js';
import { dashboardPayload, animalsPayload, lotsPayload, prestigePayload, confirmPayload, assignRow, assignSelectRow, withParkImage, landmarkPayload, isParkTab, type ParkTab } from './embeds.js';
import { guestsPayload } from '../guests/embeds.js';
import { visitPayload, nextParkRow } from './visit.js';
import { bumpLegacyBest, legacyRank } from './ranks.js';
import { buildParkSnapshot } from './snapshot.js';
import { renderPark } from '../../core/render/client.js';
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
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
import { submittedValuesAreOnMessage } from '../../core/components.js';
import { attendanceOf } from './attendance.js';
import { earnedTierCount } from '../daily/service.js';
import { seasonBadges } from '../daily/season.js';
import { lotSlots, nextLotSlot } from '../../data/progression.js';
import type { AttachmentBuilder, ButtonInteraction, MessageComponentInteraction } from 'discord.js';

const kindChoices = [...Object.keys(PADDOCKS), ...Object.keys(FACILITIES)]
  .map((k) => ({ name: k.replaceAll('_', ' '), value: k }));

// emojiTag is resolved per call, never at module scope — the app-emoji map only
// loads after client ready.
//
// userId is a seed, not a lookup key: a banner has no object to key on, so it keys on
// who is looking and each player gets one stable face of this surface. It is NOT the
// card owner — park:collect deliberately carries no owner segment and always collects
// the CLICKER's own income, so the clicker is the viewer here.
function collectPayload(amount: number, userId: string) {
  const embed = new EmbedBuilder().setColor(0x3ba55c)
    .setTitle(`${emojiTag('dw_cash')} Park income`)
    .setDescription(amount > 0
      ? `Collected **${amount.toLocaleString()}** cash.`
      : 'Nothing to collect yet — give your dinos time to earn.');
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[]; flags: MessageFlags.Ephemeral } =
    { embeds: [embed], flags: MessageFlags.Ephemeral };
  attach(embed, payload, 'image', assetImage('banners', 'collect', userId));
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
  attach(embed, payload, 'image', assetImage('banners', 'dino_roster', userId));
  return payload;
}

/**
 * The slot-cap sentence for a LotLimitError thrown by `buildLot`. `upgradeLot` throws the SAME
 * class to mean "already at max level" — see `maxLevelLine` and §per-menu-error-mapping — so a
 * shared mapping here would tell a player "All lots full" when they meant the other thing.
 *
 * Both ratings are named on purpose. The gate reads `ratingHighWater`, which is monotone,
 * while `parkRating` is live and falls as comfort decays; a player whose live rating has
 * dipped below their best would otherwise read this as the gate having moved under them.
 *
 * Reads the row and the count itself rather than taking them as parameters: it runs on an
 * error path only, after the transaction has already rolled back, and the two call sites hold
 * different subsets of what it needs. The `!` is sound because buildLot reads that row and
 * dereferences `user.ratingHighWater` on the line immediately above its throw — an absent row
 * would have crashed there with a TypeError, so reaching this line proves it exists.
 */
function lotSlotCapLine(ctx: Ctx, userId: string): string {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get()!;
  const lots = ctx.db.select().from(schema.lots)
    .where(eq(schema.lots.userId, userId)).all().length;
  const head = `All lots full (${lots}/${lotSlots(user.ratingHighWater)})`;
  const next = nextLotSlot(user.ratingHighWater);
  if (!next) return `${head} — every slot is unlocked.`;
  return `${head}. Slot ${next.slot} unlocks at ★${(next.threshold / 100).toFixed(1)}`
    + ` — you're at ★${(user.parkRating / 100).toFixed(1)} (best ★${(user.ratingHighWater / 100).toFixed(1)}).`;
}

/**
 * The already-at-max-level sentence for a LotLimitError thrown by `upgradeLot`. The build
 * handler reads the same class as "slot cap" — see `lotSlotCapLine`.
 *
 * The cap comes from maxLevelFor, the same resolver upgradeLot uses to decide whether to
 * throw, and never from a literal: a paddock caps at 4, gene_lab and food_court at 3,
 * visitor_center and hatchery_lab at 5, so any one number written here would be wrong for
 * most lots. The capacity then follows FROM that number through paddockCapacity rather than
 * being written down beside it, so a change to the paddock cap moves both halves together.
 */
function maxLevelLine(kind: string): string {
  const max = maxLevelFor(kind);
  const def = FACILITIES[kind];
  if (def) return `Already max level (${max}) — the ${def.name} is fully upgraded.`;
  return `Already max level (${max}) — that paddock holds ${paddockCapacity(max)}.`;
}

// The Upgrade menu's stale-anchor wording, minus its "for current prices" tail: an assign
// moves no money, and pointing a player at prices they never asked about reads as a
// different bug. The stem is identical on purpose — it is the same class of failure, an id
// naming a lot that no longer answers for what its label promised.
const STALE_ASSIGN = 'That lot changed — open `/park view` again.';

// The AssignError texts a follow-through clicker reads VERBATIM. Everything else assignDino
// can raise ('You do not own that dino.', 'You do not own that lot.', 'Dinos can only go in
// paddocks.') describes an id that should never have been clickable, and those become
// STALE_ASSIGN.
//
// This Set IS the room re-check. There is no second occupancy read before the call: one
// would answer with the same sentence a layer earlier and could never be watched failing.
// Emptying this Set is what makes the full-paddock and escaped-dino cases go red — see the
// break step in this task.
const PASS_THROUGH = new Set<string>([PADDOCK_FULL, DINO_ESCAPED]);

/**
 * The refusal a follow-through assign control owes for this dino, or null when it may
 * proceed. ONE rule, and it is the one rule nothing else in this feature provides.
 *
 * assignDino relocates a dino perfectly happily, and `park:assign:<uid>:<dinoId>:<lotId>`
 * sits on a PUBLIC hatch reveal that is never repainted. Without this: hatch, click
 * "Assign to #1", later run `/dino assign dino:… lot:3`, scroll up, click the old button —
 * and the dino is silently dragged back to lot 1, with a different decor set, a different
 * level, and a different comfort, income and rating behind it. The router's
 * clickedIdIsOnMessage closes CROSS-message anchoring only and says nothing about this.
 * So the follow-through is a FIRST-HOME control: it gives a brand-new dino its first
 * paddock and refuses thereafter. Moving a dino that already has one is `/dino assign`'s job.
 *
 * A dino this caller does not own, or a junk id, deliberately falls through as `null`:
 * assignDino refuses both and the catch turns them into STALE_ASSIGN. An arm here would
 * produce the identical sentence one layer earlier and could never be watched failing.
 *
 * Synchronous by design: the caller's read and its write must have no suspension point
 * between them, and an async helper here would put an `await` inside that pair.
 */
function assignRefusal(ctx: Ctx, userId: string, dinoId: number): string | null {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (dino && dino.lotId !== null) return `Already assigned to lot #${dino.lotId}.`;
  return null;
}

/**
 * The one place a follow-through assign control turns a (dinoId, lotId) pair into an
 * assignment, shared by the park:assign button and the park:assignsel menu so the two
 * cannot validate differently.
 *
 * assignDino IS THE AUTHORITY, and the catch below is the whole of this handler's contract
 * with it: PASS_THROUGH decides which of its refusals a player reads as written and which
 * collapse to staleness. Nothing is re-checked ahead of the call except the first-home rule,
 * which assignDino has no opinion about.
 *
 * No `await` sits between assignRefusal's read and assignDino's write, deliberately:
 * better-sqlite3 is synchronous and the absence of a suspension point is what makes that
 * pair atomic.
 */
async function assignFollowThrough(
  ctx: Ctx, i: MessageComponentInteraction, dinoId: number, lotId: number,
): Promise<void> {
  settleEscapes(ctx, i.user.id);
  const refusal = assignRefusal(ctx, i.user.id, dinoId);
  if (refusal !== null) { await i.reply({ content: refusal, flags: MessageFlags.Ephemeral }); return; }
  try {
    assignDino(ctx, i.user.id, dinoId, lotId);
  } catch (e) {
    // DietMismatchError is a SEPARATE class, not an AssignError subclass, so it needs its
    // own arm. It always means a forged id: the mint side never offers an off-diet paddock,
    // and the "Assign anyway" confirm lives on /dino assign alone.
    if (e instanceof DietMismatchError) {
      await i.reply({ content: STALE_ASSIGN, flags: MessageFlags.Ephemeral });
      return;
    }
    if (e instanceof AssignError) {
      await i.reply({
        content: PASS_THROUGH.has(e.message) ? e.message : STALE_ASSIGN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw e;
  }
  await i.reply({ content: `🦕 Assigned to lot #${lotId}.`, flags: MessageFlags.Ephemeral });
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
        // needsAttentionCount (service.ts) is the single shared definition — DISTINCT dinos,
        // not distinct problems: at-risk and mismatch are independent predicates over the
        // same non-escaped dinos, so one dino can trip both (an off-diet paddock is
        // paddockFit 0.5, which is exactly what drives comfort down and pulls escapeAt into
        // the warning window — mismatched dinos are disproportionately the at-risk ones).
        // Summing three separate counts here would double-count that dino, which could
        // render more "need attention" than the park actually holds. renderTab's Park tab
        // and visitPayload both call the same function, so this number can never drift from
        // theirs. The Animals tab's itemised breakdown is unaffected by any of this — it
        // lists issues, not dinos, so summing there is correct.
        //
        // bumpLegacyBest stays on this path even though its result is no longer displayed
        // here: the Park tab is the first thing every /park view renders, so the legacy
        // high-water still latches on every view. The Legacy display itself moves to the
        // Prestige tab.
        bumpLegacyBest(ctx, i.user.id);
        const attention = escapedCount + needsAttentionCount(clockDinos, nowMs);
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
        // Hoisted out of the call below because the InsufficientFundsError arm in the catch
        // dereferences it to name the building. Do NOT re-inline this read: the catch stops
        // compiling (TS2304) and the reply loses the name the message is supposed to carry.
        // buildLot's own Object.hasOwn check runs first, so by the time that arm is reached
        // `kind` is a real key of PADDOCKS or FACILITIES.
        const kind = i.options.getString('kind', true);
        try {
          const lot = buildLot(ctx, i.user.id, kind);
          const hint = lot.type === 'paddock' ? ' Assign a dino with /dino assign to start earning.' : '';
          await i.reply({ content: `🏗️ Built **${lot.name}** (lot #${lot.id}).${hint}` });
        } catch (e) {
          if (e instanceof DuplicateFacilityError) await i.reply({ content: `You already have a ${e.message} — upgrade it instead.`, flags: MessageFlags.Ephemeral });
          else if (e instanceof LotLimitError) await i.reply({ content: lotSlotCapLine(ctx, i.user.id), flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            const def = PADDOCKS[kind] ?? FACILITIES[kind]!;
            await i.reply({ content: `Not enough cash — the ${def.name} ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
          }
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
        // Hoisted for upgradeLot's expectedLevel argument below, NOT for the price: the price
        // now comes off the error the guard threw, so upgradeCostFor is no longer called on
        // this path at all. It is still used by this command's autocomplete, by the Lots-tab
        // upgrade select and by its confirm label — `grep -n "upgradeCostFor" src/modules/park/index.ts`.
        const lotRow = ctx.db.select().from(schema.lots)
          .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
        try {
          // The one legitimate place to pass a freshly-read level: this command quotes no
          // frozen label, so there is no client anchor to carry. The `?? -1` sentinel is
          // only reached when the hoisted read found nothing, in which case upgradeLot's
          // own read also finds nothing and UnknownKindError fires first.
          const lot = upgradeLot(ctx, i.user.id, lotId, lotRow?.level ?? -1);
          await i.reply({ content: `⬆️ **${lot.name}** is now level ${lot.level}.` });
        } catch (e) {
          if (e instanceof LotLimitError) await i.reply({ content: maxLevelLine(lotRow!.kind), flags: MessageFlags.Ephemeral });
          else if (e instanceof UnknownKindError) await i.reply({ content: 'No such lot.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({
            content: `Not enough cash — that upgrade ${shortfallLine(e)}.`,
            flags: MessageFlags.Ephemeral,
          });
          else if (e instanceof StaleLevelError) await i.reply({
            // Unreachable today — the hoisted read and upgradeLot's own read happen in the
            // same tick with no write between them — but `else throw e` on a spend path is
            // not where anyone wants to discover otherwise.
            content: 'That lot changed — run `/upgrade` again for the current price.',
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
            const maxLevel = maxLevelFor(l.kind);
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
        // Hoisted so the InsufficientFundsError arm can name the decoration, same rule as
        // /build's `kind`. decorateLot throws AssignError('Unknown decoration.') for a kind
        // absent from DECOR and that arm is checked first, so `item` is a real key here.
        const item = i.options.getString('item', true);
        try {
          decorateLot(ctx, i.user.id, i.options.getInteger('lot', true), item);
          await i.reply({ content: '🌴 Decoration added.' });
        } catch (e) {
          if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({
            content: `Not enough cash — the ${DECOR[item].name} ${shortfallLine(e)}.`,
            flags: MessageFlags.Ephemeral,
          });
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
  selects: [
    {
      prefix: 'park',
      async execute(ctx, i) {
        const [, action, uid] = i.customId.split(':');
        if (i.user.id !== uid) {
          await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
          return;
        }
        // The router proves BOTH halves centrally before this handler is ever reached:
        // clickedIdIsOnMessage that the bot minted this menu on this message, then
        // submittedValuesAreOnMessage that every submitted value was one the bot offered
        // on it (src/core/router.ts). This copy is defence in depth for the callers that
        // invoke execute() directly and so never pass through the router at all —
        // scripts/test-live.ts's select() helper and every direct-dispatch test.
        if (!submittedValuesAreOnMessage(i)) { await i.deferUpdate(); return; }
        const value = i.values[0]!;
        const user = ctx.db.select().from(schema.users)
          .where(eq(schema.users.discordId, i.user.id)).get()!;
        if (action === 'build') {
          // Defence in depth over Task 0a, which is what actually closed this: the tables
          // are null-prototype now and buildLot owns an Object.hasOwn check of its own.
          // This copy earns its place because nearly every fakeButton site, and every
          // case in scripts/test-live.ts, calls execute directly rather than through
          // routeInteraction, so a handler-level check is what those paths exercise.
          if (!Object.hasOwn(PADDOCKS, value) && !Object.hasOwn(FACILITIES, value)) {
            await i.deferUpdate();
            return;
          }
          const def = PADDOCKS[value] ?? FACILITIES[value]!;
          // The confirm carries the lot COUNT it was minted against, the same way
          // park:upgyes carries the level it was minted against. Build has no level to
          // anchor on and its price never moves, so the count is what makes the id
          // single-use: buildLot only ever increases it and nothing outside adminReset
          // removes a lot, so the second of two clicks racing the first repaint provably
          // reads a different count and is rejected. Facilities were already safe
          // (DuplicateFacilityError stops the second), but paddocks are duplicable by
          // design and lotSlots caps at 10 with no demolish path anywhere — a doubled
          // paddock burns a slot permanently.
          const lotCount = ctx.db.select().from(schema.lots)
            .where(eq(schema.lots.userId, i.user.id)).all().length;
          await i.update(confirmPayload(
            user,
            `Build **${def.name}** for **${def.buildCost.toLocaleString('en-US')}** cash?`,
            `park:buildyes:${i.user.id}:${value}:${lotCount}`, `park:buildno:${i.user.id}`,
            `Build ${def.name}`,
          ));
          return;
        }
        if (action === 'upgrade') {
          const [lotStr, levelStr] = value.split(':');
          const lotId = Number(lotStr); const expected = Number(levelStr);
          if (!Number.isInteger(lotId) || !Number.isInteger(expected)) { await i.deferUpdate(); return; }
          const lot = ctx.db.select().from(schema.lots)
            .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
          if (!lot || lot.level !== expected) {
            await i.reply({
              content: 'That lot changed — open `/park view` again for current prices.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await i.update(confirmPayload(
            user,
            `Upgrade **${lot.name}** to level ${lot.level + 1} for **${upgradeCostFor(lot.kind, lot.level).toLocaleString('en-US')}** cash?`,
            `park:upgyes:${i.user.id}:${lotId}:${expected}`, `park:upgno:${i.user.id}`,
            `Upgrade to lvl ${lot.level + 1}`,
          ));
          return;
        }
        if (action === 'assignsel') {
          // The router proved both halves centrally (clickedIdIsOnMessage, then
          // submittedValuesAreOnMessage), and the owner check at the top of this handler
          // proved the clicker. What is left is DOMAIN validity, which no guard can give
          // us: the first-home rule, and whether that lot is still a diet-matching paddock
          // with room. Both live in assignFollowThrough, which park:assign shares — the
          // two paths cannot answer the same question differently.
          await assignFollowThrough(ctx, i, Number(i.customId.split(':')[3]), Number(value));
          return;
        }
        await i.deferUpdate();
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
          await i.reply(collectPayload(amount, i.user.id));
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
          case 'assign': {
            // park:assign:<uid>:<dinoId>:<lotId> — minted where exactly one paddock was
            // eligible. This owner check is a MESSAGE-QUALITY layer, not the write barrier:
            // assignRefusal and assignDino both resolve the dino against the CLICKER, so a
            // bystander is already refused one level down. What it buys is that the
            // bystander is told "not yours" instead of a staleness line that would
            // misdescribe what happened.
            if (i.user.id !== uid) { await i.reply({ content: 'Not your assignment.', flags: MessageFlags.Ephemeral }); return; }
            await assignFollowThrough(ctx, i, Number(parts[3]), Number(parts[4]));
            return;
          }
          case 'assignpick': {
            // park:assignpick:<uid>:<dinoId> — the menu's options are derived HERE, at click
            // time, and never carried in the id: this button may have been minted an hour ago.
            if (i.user.id !== uid) { await i.reply({ content: 'Not your assignment.', flags: MessageFlags.Ephemeral }); return; }
            const pickDinoId = Number(parts[3]);
            settleEscapes(ctx, i.user.id);
            // Same first-home rule the write path applies, checked before the menu opens so
            // an already-housed dino is told so once rather than after a pointless pick.
            const pickRefusal = assignRefusal(ctx, i.user.id, pickDinoId);
            if (pickRefusal !== null) { await i.reply({ content: pickRefusal, flags: MessageFlags.Ephemeral }); return; }
            const eligible = eligiblePaddocks(ctx, i.user.id, pickDinoId);
            // NEVER fall through to assignSelectRow with an empty list: a zero-option select
            // is rejected outright, which would turn a legible refusal into the router's
            // generic failure line. This also covers a forged or junk dinoId, which
            // eligiblePaddocks answers with [].
            if (eligible.length === 0) { await i.reply({ content: STALE_ASSIGN, flags: MessageFlags.Ephemeral }); return; }
            // Ephemeral, never i.update: this button can sit on a PUBLIC hatch reveal, and
            // rewriting somebody's reveal card into a private chooser is the wrong trade.
            await i.reply({
              content: 'Which paddock?',
              components: [assignSelectRow(i.user.id, pickDinoId, eligible)],
              flags: MessageFlags.Ephemeral,
            });
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
                  content: `Not enough cash — the ${rung.name} ${shortfallLine(e)}.`,
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
            if (target === 'roster') {
              // Same ephemeral-reply shape as landmark/guests above — the Animals tab's
              // Full roster button mints this id rather than the pre-existing
              // park:dinos:<uid>:<page> so an i.update here never destroys the tab card's
              // own navigation. settleEscapes first, matching the (still-live)
              // park:dinos:<page> handler below and /dino list's own execute path.
              settleEscapes(ctx, i.user.id);
              await i.reply({ ...dinoListPayload(ctx, i.user.id, 1), flags: MessageFlags.Ephemeral });
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
          case 'buildno':
          case 'upgno': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            await renderTab(ctx, i, i.user.id, 'lots', false);
            return;
          }
          case 'buildyes': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            const kind = parts[3] ?? '';
            // Re-validated here and not merely at the menu: another open message may still
            // hold a stale confirm button, and the customId is client-supplied regardless.
            if (!Object.hasOwn(PADDOCKS, kind) && !Object.hasOwn(FACILITIES, kind)) {
              await i.reply({
                content: 'That build button is no longer valid — open `/park view` again.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            // park:buildyes:<uid>:<kind>:<lotCount> — the count anchor, validated in the
            // same order upgyes validates its level: integer parse first, then a FRESH
            // read, both before any write. It is what makes this id single-use, which
            // matters most for paddocks: they are duplicable by design, so a second click
            // landing before the first repaint would build a second one, and lotSlots caps
            // at 10 with no demolish path short of adminReset — the slot is gone for good.
            const offeredCount = Number(parts[4]);
            if (!Number.isInteger(offeredCount)) {
              await i.reply({
                content: 'That build button is no longer valid — open `/park view` again.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            // NO `await` may sit between this read and buildLot below. better-sqlite3 is
            // synchronous and Node is single-threaded, so a check-then-write with no
            // suspension point between them cannot interleave with a second interaction;
            // introducing one here reopens the very race this anchor closes.
            const lotCount = ctx.db.select().from(schema.lots)
              .where(eq(schema.lots.userId, i.user.id)).all().length;
            if (lotCount !== offeredCount) {
              await i.reply({
                content: `Your park has ${lotCount} lot${lotCount === 1 ? '' : 's'} now, not ${offeredCount} — open \`/park view\` again to build.`,
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            try {
              const lot = buildLot(ctx, i.user.id, kind);
              await renderTab(ctx, i, i.user.id, 'lots', false, `🏗️ Built **${lot.name}** (lot #${lot.id}).`);
            } catch (e) {
              // Mapped for the BUILD menu specifically: LotLimitError means "slot cap" here
              // and "already max level" in upgradeLot, and UnknownKindError is likewise
              // overloaded. Reusing /upgrade's mapping would tell a player "already max
              // level" when they meant "all lots full".
              if (e instanceof DuplicateFacilityError) {
                await i.reply({ content: `You already have a ${e.message} — upgrade it instead.`, flags: MessageFlags.Ephemeral });
              } else if (e instanceof LotLimitError) {
                await i.reply({ content: lotSlotCapLine(ctx, i.user.id), flags: MessageFlags.Ephemeral });
              } else if (e instanceof InsufficientFundsError) {
                const def = PADDOCKS[kind] ?? FACILITIES[kind]!;
                await i.reply({
                  content: `Not enough cash — the ${def.name} ${shortfallLine(e)}.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else throw e;
            }
            return;
          }
          case 'upgyes': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            // park:upgyes:<uid>:<lotId>:<expectedLevel> — both client-supplied. Parsed as
            // integers first, then checked against a FRESH read, in that order, before any
            // write. This is the guard, not the confirm click: another open message may
            // still hold a stale button for the same lot.
            const lotId = Number(parts[3]); const expected = Number(parts[4]);
            if (!Number.isInteger(lotId) || !Number.isInteger(expected)) {
              await i.reply({ content: 'That upgrade button is no longer valid — open `/park view` again.', flags: MessageFlags.Ephemeral });
              return;
            }
            const lot = ctx.db.select().from(schema.lots)
              .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
            if (!lot || lot.level !== expected) {
              await i.reply({
                content: lot
                  ? `That lot is level ${lot.level} now, not ${expected} — open \`/park view\` again for the current price.`
                  : 'No such lot.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            try {
              // `expected` is the CLIENT-SUPPLIED anchor parsed out of the customId, never
              // `lot.level` from the fresh read above. Passing the fresh read would make
              // upgradeLot compare a value against itself, so its StaleLevelError could
              // never fire — two layers over ONE anchor, not one layer applied twice.
              const upgraded = upgradeLot(ctx, i.user.id, lotId, expected);
              await renderTab(ctx, i, i.user.id, 'lots', false, `⬆️ **${upgraded.name}** is now level ${upgraded.level}.`);
            } catch (e) {
              // Mapped for the UPGRADE menu: LotLimitError means "already max level" here,
              // where the build handler reads the same class as "slot cap".
              if (e instanceof LotLimitError) {
                await i.reply({ content: maxLevelLine(lot.kind), flags: MessageFlags.Ephemeral });
              } else if (e instanceof UnknownKindError) {
                await i.reply({ content: 'No such lot.', flags: MessageFlags.Ephemeral });
              } else if (e instanceof StaleLevelError) {
                // Unreachable while the pre-check above stands, and kept anyway: without
                // it, relaxing that pre-check turns a price change into the router's
                // generic error. e.actual/e.expected save a second read.
                await i.reply({
                  content: `That lot is level ${e.actual} now, not ${e.expected} — open \`/park view\` again for the current price.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else if (e instanceof InsufficientFundsError) {
                await i.reply({
                  content: `Not enough cash — that upgrade ${shortfallLine(e)}.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else throw e;
            }
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
 * dinos" / skip report, spread onto the Animals tab it re-renders. It is sent as
 * `content: content ?? ''` — an explicit empty string when absent, NEVER an omitted key
 * — in every branch's payload object. discord.js's MessagePayload drops an omitted
 * `content` key from the request body entirely, and Discord then leaves the message's
 * EXISTING content unchanged rather than clearing it: an omitted-when-absent version of
 * this parameter left a feed-all result line pinned above every tab the player switched
 * to afterwards, until the next full /park view. `content` is set FIRST in every
 * branch's payload object for the same reason it always was: none of the four tab
 * builders set a `content` key themselves today, so the order is cosmetic right now, but
 * a future builder that does set one must win over a stale caller-supplied value —
 * reordering the spread would silently let this parameter clobber a builder's own
 * content instead.
 *
 * `tourRow` (visit only) is re-minted here and pushed onto every branch's components,
 * never just the Park tab's: each of the four tab builders returns a fresh components
 * array, so without this a tour that navigated to any tab would lose the Next park
 * button and strand the visitor unable to advance without re-running a command.
 */
async function renderTab(
  ctx: Ctx, i: ButtonInteraction, ownerId: string, tab: ParkTab, visit: boolean, content?: string,
): Promise<void> {
  settleEscapes(ctx, ownerId);
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, ownerId)).get()!;
  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, ownerId)).all();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, ownerId)).all();
  const tourRow = visit ? nextParkRow(ctx, ownerId) : null;
  if (tab === 'park') {
    await i.deferUpdate();
    const { clockDinos } = toClockDinos(ctx, ownerId);
    const nowMs = ctx.now();
    const escaped = dinos.filter((d) => d.escapedAt !== null).length;
    const pending = visit ? 0 : pendingIncome(ctx, ownerId);
    const capped = pending > 0 && ctx.now() - user.lastCollectAt >= capHours(lots) * 3_600_000;
    const base = dashboardPayload(user, pending, {
      // needsAttentionCount is the SAME shared computation visitPayload uses (see its doc
      // comment in service.ts) — the one-pass-over-DISTINCT-dinos rule, not a sum of the
      // two predicates — so this number can never drift from a visited card's Park tab.
      attention: escaped + needsAttentionCount(clockDinos, nowMs), capped, now: nowMs,
      motto: user.motto, dinoCount: dinos.length, visit,
    });
    if (tourRow) base.components.push(tourRow);
    let png: Buffer | undefined;
    try { png = await renderPark(buildParkSnapshot(ctx, ownerId)); } catch { png = undefined; }
    await i.editReply({ content: content ?? '', ...(png ? withParkImage(base, png) : base), attachments: [] });
    return;
  }
  if (tab === 'animals') {
    const { clockDinos } = toClockDinos(ctx, ownerId);
    const nowMs = ctx.now();
    const inv = ctx.economy.getFoodInventory(ownerId);
    const foodLine = (Object.entries(inv) as Array<[FoodId, number]>)
      .map(([id, q]) => `${foodEmoji(id)}${FOODS[id].name} ×${q}`).join(' · ') || 'none — /shop food';
    const built = animalsPayload(user, dinos.length, {
      escaped: dinos.filter((d) => d.escapedAt !== null).length,
      atRisk: clockDinos.filter((c) => {
        if (c.escapedAt !== null) return false;
        const e = escapeAt(c);
        return e !== null && e - nowMs <= ESCAPE_WARN_MS;
      }).length,
      mismatch: clockDinos.filter((c) =>
        c.paddock !== null && c.escapedAt === null && c.paddock.diet !== c.species.diet).length,
      foodLine, featured: featuredFor(ctx, user), visit,
    });
    if (tourRow) built.components.push(tourRow);
    await i.update({ content: content ?? '', ...built, attachments: [] });
    return;
  }
  if (tab === 'lots') {
    const owned = new Set(lots.map((l) => l.kind));
    const full = lots.length >= lotSlots(user.ratingHighWater);
    // Facilities are one per park; paddocks are duplicable — building more of one kind IS
    // the capacity progression. Filtering here keeps the menu honest, but it is NOT the
    // guard: buildLot re-checks both, and a stale menu is rejected there.
    const buildable = full ? [] : [
      ...Object.entries(PADDOCKS).map(([kind, d]) => ({ kind, name: d.name, cost: d.buildCost })),
      ...Object.entries(FACILITIES)
        .filter(([kind]) => !owned.has(kind))
        .map(([kind, d]) => ({ kind, name: d.name, cost: d.buildCost })),
    ];
    // maxLevelFor is the one resolver upgradeLot itself charges through, so this menu cannot
    // drift from it. Filtering here keeps the menu honest but is NOT the guard: a maxed lot
    // offered anyway is rejected by LotLimitError, it is just a wasted click.
    const upgradable = lots
      .filter((l) => l.level < maxLevelFor(l.kind))
      .map((l) => ({ lotId: l.id, name: l.name, level: l.level, cost: upgradeCostFor(l.kind, l.level) }));
    const built = lotsPayload(user, lots, lotSlots(user.ratingHighWater), { visit, buildable, upgradable });
    if (tourRow) built.components.push(tourRow);
    await i.update({ content: content ?? '', ...built, attachments: [] });
    return;
  }
  // prestige — legacyRank (pure), never bumpLegacyBest: the high-water latches on the
  // Park tab, which every /park view renders first, so a navigation click never writes.
  const built = prestigePayload(user, {
    attendance: attendanceOf(ctx, ownerId).attendance,
    earnedTiers: earnedTierCount(ctx, ownerId),
    legacyRank: legacyRank(ctx, ownerId),
    seasonBadges: seasonBadges(ctx, ownerId),
    landmark: landmarkFor(user.landmarkTier),
    visit,
  });
  if (tourRow) built.components.push(tourRow);
  await i.update({ content: content ?? '', ...built, attachments: [] });
}
