import { eq, and, gt } from 'drizzle-orm';
import { ButtonStyle } from 'discord.js';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { locksFor } from '../../core/locks.js';
import { activeExpedition } from '../expeditions/service.js';
import { activeBreedings } from '../genelab/service.js';
import { escapeAt, ESCAPE_WARN_MS, accruedIncome, DAY_MS } from '../../core/clock.js';
import { toClockDinos, capHours, facilityBonusPct, facilityLevel, maxLevelFor } from '../park/service.js';
import { incubatingCount, incubatorSlots } from '../hatchery/service.js';
import { seasonIndexFor, SEASON_DAYS } from '../../core/world.js';
import { TRADE_EXPIRY_MS } from '../../data/trade.js';
import { questProgress, achievementsView } from '../daily/service.js';
import { seasonView } from '../daily/season.js';
import { claimableMilestones, nextMilestone } from '../guests/service.js';
import { nextRatingGate } from './gates.js';
import { settleEnergy } from '../../data/battle/energy.js';
import { energyLine } from '../battles/embeds.js';
import type { HubSignal } from './types.js';

/**
 * Every live signal for one player, in section order, ready to rank and render.
 *
 * A READ. It never calls getOrCreateUser or settleEscapes — the handler owns both, runs them
 * once per interaction before this, and running them here would make every caller pay a
 * write. The full forbidden list is in the plan's Global Constraints and in spec §3.1; the
 * short version is that nothing here may roll a board, stamp a hint, latch a high-water,
 * expire a trade, record an alert, or claim anything.
 *
 * toClockDinos is called ONCE and its four returns are threaded through every derived row.
 * Later sections in this function must reuse them rather than calling it again.
 *
 * Every control it mints for ANOTHER module is gated on that module's own flag.
 * ModuleRegistry.findComponent (src/core/modules.ts) searches only ENABLED modules and
 * routeInteraction falls through in silence when it misses, so an ungated cross-module mint
 * is a button that silently does nothing — the same rule park's own `hub:open` mint follows.
 * The ROW is never gated, only the control: the text is still a true statement about the
 * park, and suppressing rows would have to reach the countdown and goal rows too (which
 * carry no control to gate) or the card would hide "an egg is ready to hatch" while still
 * printing the incubating countdown beside it. `hub:feedall` and `hub:refresh` are the hub's
 * own ids and need no gate.
 */
export function hubView(ctx: Ctx, userId: string): HubSignal[] {
  const now = ctx.now();
  const locks = locksFor(ctx, userId);
  const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, userId)).all();
  // Hoisted above the READY section rather than sitting beside the ATTENTION rows that first
  // needed it: `lots` is what the eggs-idle row below asks incubatorSlots about, and reading
  // the lots table again for that one question would pay twice for rows already in hand.
  const { clockDinos, lots, user, dinos } = toClockDinos(ctx, userId);

  const out: HubSignal[] = [];

  // READY — things finished and waiting on one click. None of them carries a deadline:
  // an egg, a returned dig and a finished pairing all keep indefinitely, which is exactly
  // what lossAtMs: null means and why they rank below anything that expires.
  const ready = eggs.filter((e) =>
    e.hatchesAt !== null && e.hatchesAt <= now && !locks.eggs.has(e.id));
  if (ready.length > 0) {
    out.push({
      id: 'eggs-ready',
      section: 'ready',
      text: `🥚 ${ready.length === 1 ? 'An egg is' : `${ready.length} eggs are`} ready to hatch`,
      lossAtMs: null,
      // hatch:crack carries no owner segment. That is safe HERE and only here, because the
      // hub is ephemeral and therefore owner-only; it is not a property of the id.
      ...(ctx.config.modules.hatchery
        ? { control: { customId: `hatch:crack:${ready[0].id}`, label: '🔨 Crack it open!', style: ButtonStyle.Success } }
        : {}),
    });
  }

  // The row nothing in the product has ever shown: an egg bought or won and then forgotten.
  // It earns nothing and finishes nothing while it sits there.
  const idle = eggs.filter((e) => e.incubationStartedAt === null && !locks.eggs.has(e.id));
  if (idle.length > 0) {
    // incubatingCount issues its own query — read it once here rather than inside both the
    // text and the control. incubatorSlots is 1 with no Hatchery Lab, so a player holding a
    // second shop egg reaches this row routinely, not as an edge case.
    const slots = incubatorSlots(lots);
    const busy = incubatingCount(ctx, userId);
    const freeSlots = slots - busy;
    const subject = idle.length === 1 ? 'An egg is' : `${idle.length} eggs are`;
    // The full row names the blocker AND the remedy, and the remedy depends on the lab. An
    // earlier version said only "every incubator slot is full", which left a player unable
    // to learn from the screen how many slots they had or that slots come from the Hatchery
    // Lab at all — on a card whose whole job is answering "what do I do now", that is half
    // a sentence. Naming the WRONG remedy would be worse than silence, so it branches:
    //
    //   no lab   — building alone gains nothing, because incubatorSlots is [1,2,3,4,5]
    //              indexed by level and the no-lab fallback is already 1. Level 2 is the
    //              first real slot, so the advice has to carry both steps.
    //   below max — one lot to upgrade, and `/upgrade` autocompletes it.
    //   at max   — neither remedy exists; promising one sends the player to a command that
    //              refuses. Something has to hatch first, and a ready-but-uncracked egg
    //              still holds its slot, so cracking one is the fastest route.
    const labLevel = facilityLevel(lots, 'hatchery_lab');
    const remedy = labLevel === 0
      ? 'a Hatchery Lab adds slots from level 2 — `/build kind:hatchery_lab`, then `/upgrade`'
      : labLevel < maxLevelFor('hatchery_lab')
        ? 'upgrade your Hatchery Lab for another slot — `/upgrade`'
        : 'every slot your Hatchery Lab can hold is in use — one has to hatch first';
    out.push({
      id: 'eggs-idle',
      section: 'ready',
      // The row is worth showing either way — an egg earning nothing is the fact — but it
      // must not say "not incubating" as though that were a choice when there is nowhere to
      // put it.
      text: freeSlots > 0
        ? `🥚 ${subject} sitting in your inventory, not incubating`
        : `🥚 ${subject} sitting in your inventory — incubator full (${busy}/${slots}). ${remedy[0].toUpperCase()}${remedy.slice(1)}.`,
      lossAtMs: null,
      // No control with the incubator full: incubateEgg refuses on exactly this condition
      // (src/modules/hatchery/service.ts), so Incubate here is a button that can only fail —
      // the same reasoning dinos-at-risk applies to Feed all with an empty larder below.
      ...(freeSlots > 0 && ctx.config.modules.hatchery
        ? { control: { customId: `hatch:inc:${userId}:${idle[0].id}`, label: '🥚 Incubate', style: ButtonStyle.Primary } }
        : {}),
    });
  }

  const dig = activeExpedition(ctx, userId);
  if (dig !== undefined && dig.returnsAt <= now) {
    out.push({
      id: 'expedition-ready',
      section: 'ready',
      text: '🧭 Your dig crew is back with a haul',
      lossAtMs: null,
      // exp:claim takes no expedition id: claimExpedition resolves the CALLER's current dig
      // and takes no id, so the uid segment is the whole address.
      ...(ctx.config.modules.expeditions
        ? { control: { customId: `exp:claim:${userId}`, label: '🧭 Claim', style: ButtonStyle.Success } }
        : {}),
    });
  }

  // Hoisted rather than filtered inline: Task 9's WAITING section reuses this same list for
  // the pairings still cooking, and calling activeBreedings twice would pay for two reads of
  // the same rows.
  const breedings = activeBreedings(ctx, userId);
  const pairings = breedings.filter((b) => b.readyAt <= now);
  if (pairings.length > 0) {
    // Oldest-ready-first, matching how /breed claim picks when several are done, so the hub
    // and that command never disagree about which one a single click takes.
    const first = pairings.reduce((a, b) => (a.readyAt <= b.readyAt ? a : b));
    out.push({
      id: 'breeding-ready',
      section: 'ready',
      text: `🧬 ${pairings.length === 1 ? 'A pairing has' : `${pairings.length} pairings have`} produced an egg`,
      lossAtMs: null,
      // breed:claim carries no owner segment either, and for the same ephemeral-surface
      // reason as hatch:crack above.
      ...(ctx.config.modules.genelab
        ? { control: { customId: `breed:claim:${first.id}`, label: '🧬 Claim', style: ButtonStyle.Success } }
        : {}),
    });
  }

  // ATTENTION. Each dino predicate below names one distinct thing gone wrong, and none of
  // them is a roll-up of the others: the hub prints them as separate lines rather than as a
  // single "need attention" tally, because /park view already prints that label over a
  // DIFFERENT figure — needsAttentionCount's union of at-risk and off-diet plus the escaped
  // count — and two screens carrying the same label over different figures is the drift this
  // repo has already paid to fix once.
  const escaped = dinos.filter((d) => d.escapedAt !== null);
  if (escaped.length > 0) {
    out.push({
      id: 'dinos-escaped',
      section: 'attention',
      // No control: rescueDino is reachable only from /rescue, and adding a button would be
      // new spend surface in the care module. Recorded in spec §5.5, not an oversight.
      text: `🏃 ${escaped.length} escaped — bring them back with \`/rescue\``,
      lossAtMs: null,
    });
  }

  const unassigned = dinos.filter((d) => d.lotId === null && d.escapedAt === null);
  if (unassigned.length > 0) {
    out.push({
      id: 'dinos-unassigned',
      section: 'attention',
      // No control, and unlike the escaped and off-diet rows beside it this one is a
      // DELIBERATE omission rather than a structural impossibility: spec §5.1 lists the
      // whole park:assign family as hub-safe, and it is — every one of those handlers, the
      // park:goto:lots landing included, answers with an ephemeral i.reply that leaves this
      // card standing. What blocks it is a SHAPE mismatch at the mint, not the read cost.
      // assignRow (src/modules/park/embeds.ts) picks between park:assign / park:assignpick /
      // park:goto:lots from eligiblePaddocks(ctx, userId, dinoId) and returns an
      // ActionRowBuilder<ButtonBuilder>, while HubSignal.control is a flat
      // {customId,label,style} — so nothing can be shared, and the hub would need a second,
      // frozen copy of that three-way chooser, silently stuck on today's shapes the day
      // assignRow grows another — the same two-copies-drifting class this branch just retired
      // elsewhere. eligiblePaddocks itself only reads the dinos and lots tables, and on this
      // path would be called once, for the first unassigned dino — the same shape eggs-idle
      // already accepts above — so cost was never the blocker. `/dino assign` stays the route;
      // revisit if HubControl and assignRow ever meet in one shape.
      text: `🦕 ${unassigned.length} ${unassigned.length === 1 ? 'dino has' : 'dinos have'} no paddock — they earn nothing · \`/dino assign\``,
      lossAtMs: null,
    });
  }

  const atRisk = clockDinos
    .map((c, idx) => ({ c, d: dinos[idx] }))
    .filter(({ c }) => c.escapedAt === null)
    // escapeAt, never escapeMoment: escapeMoment returns null until the instant has already
    // PASSED, which would make this row permanently empty and nothing would fail.
    .map(({ c, d }) => ({ d, at: escapeAt(c) }))
    .filter((e): e is { d: typeof e.d; at: number } =>
      e.at !== null && e.at - now <= ESCAPE_WARN_MS);

  // getFoodInventory OMITS zero quantities, so emptiness is a test on the entries, never a
  // sum with `?? 0` — a larder holding {ferns: 0} would read as stocked either way round if
  // you got this backwards.
  const larder = ctx.economy.getFoodInventory(userId);
  const hasFood = Object.values(larder).some((q) => (q ?? 0) > 0);

  if (atRisk.length > 0) {
    const soonest = atRisk.reduce((a, b) => (a.at <= b.at ? a : b)).at;
    out.push({
      id: 'dinos-at-risk',
      section: 'attention',
      text: `⚠️ ${atRisk.length} at risk of escaping — the first goes <t:${Math.floor(soonest / 1000)}:R>`,
      // An absolute instant, never a duration: rankSignals compares it against other
      // absolute instants, and a duration here sorts as though the dino escaped in 1970.
      lossAtMs: soonest,
      // No control with an empty larder: Feed all with nothing to feed with is a button that
      // can only fail. The food-empty row below says what to do instead.
      ...(hasFood
        ? { control: { customId: `hub:feedall:${userId}`, label: '🍖 Feed all', style: ButtonStyle.Primary } }
        : {}),
    });
  }

  const mismatch = clockDinos.filter((c) =>
    c.paddock !== null && c.escapedAt === null && c.paddock.diet !== c.species.diet);
  if (mismatch.length > 0) {
    out.push({
      id: 'dinos-wrong-habitat',
      section: 'attention',
      // No control, and this one is structural rather than an omission: assignRefusal blocks
      // a dino that already has a lot, and eligiblePaddocks never offers an off-diet
      // paddock, so there is no one-click move to offer.
      text: `🏝️ ${mismatch.length} in the wrong habitat — comfort halved`,
      lossAtMs: null,
    });
  }

  if (!hasFood && dinos.length > 0) {
    out.push({
      id: 'food-empty',
      section: 'attention',
      text: '🥩 No food in stock — `/shop food`',
      lossAtMs: null,
    });
  }

  // accruedIncome directly, not pendingIncome: pendingIncome opens with its own
  // toClockDinos, and this function has already paid for one.
  const capMs = capHours(lots) * 3_600_000;
  const pending = accruedIncome(
    clockDinos, facilityBonusPct(lots), capHours(lots), user.lastCollectAt, now);
  // The instant the park stopped earning, and whether it has passed. Capped is a strict
  // SUBSET of pending — it is the same `pending > 0` with one extra term — so both rows fire
  // together, and the pair has to be computed once here for the CLAIM section to reuse it.
  const cappedAtMs = user.lastCollectAt + capMs;
  const capped = pending > 0 && now >= cappedAtMs;
  if (capped) {
    out.push({
      id: 'income-capped',
      section: 'attention',
      text: '⛔ Idle earnings hit the Visitor Center cap — collect to restart them',
      // Deliberately in the PAST: the park stopped earning at this instant and has been
      // losing ever since, which is what ranks it above a row that merely expires later.
      // This row carries NO control — the Collect button lives on income-pending — so
      // rankSignals drops it before sorting; income-pending carries the same instant so the
      // ranking can actually act on it.
      lossAtMs: cappedAtMs,
    });
  }

  // Incoming offers only. locksFor deliberately reads from_user — escrow holds the OFFERER's
  // items — so this is the one read in the repo scoped by recipient, and migration 0020's
  // trades_status_to is what keeps it a search instead of a scan of every pending trade in
  // the database.
  //
  // The createdAt predicate IS the expiry check. expireStale would also do it and is a
  // write; a render must never close another player's offer as a side effect of being
  // looked at.
  const tradeCutoff = now - TRADE_EXPIRY_MS;
  const offers = ctx.db.select().from(schema.trades)
    .where(and(
      eq(schema.trades.status, 'pending'),
      eq(schema.trades.toUser, userId),
      gt(schema.trades.createdAt, tradeCutoff),
    )).all();
  if (offers.length > 0) {
    const soonest = offers.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    const expiresAt = soonest.createdAt + TRADE_EXPIRY_MS;
    out.push({
      id: 'trade-incoming',
      section: 'attention',
      text: `🤝 ${offers.length === 1 ? 'A trade offer is' : `${offers.length} trade offers are`} waiting on you`
        + ` — the first expires <t:${Math.floor(expiresAt / 1000)}:R> · \`/trade list\``,
      lossAtMs: expiresAt,
    });
  }

  // CLAIM. Every control below is reused verbatim from its owning command, never proxied.
  // daily:claim, ach:claimall, season:claim and park:collect all reply ephemerally, so
  // clicking any of them leaves the hub card standing — with a now-stale label, which is
  // what the Refresh button is for. guests:claim is the odd one out: its handler calls
  // i.update with a fresh guestsPayload, so clicking it replaces the hub card with the
  // guests card instead of leaving it up.
  const claimableQuests = questProgress(ctx, userId)
    // `complete` alone re-offers a quest that was already claimed, forever.
    .filter((v) => v.complete && v.row.claimedAt === null);
  if (claimableQuests.length > 0) {
    out.push({
      id: 'daily-claimable',
      section: 'claim',
      text: `🎯 ${claimableQuests.length} daily quest${claimableQuests.length === 1 ? '' : 's'} ready to claim`,
      lossAtMs: null,
      ...(ctx.config.modules.daily
        ? { control: { customId: `daily:claim:${userId}`, label: '🎯 Claim dailies', style: ButtonStyle.Success } }
        : {}),
    });
  }

  // Count TIERS, not tracks: one track can hold several claimable tiers at once.
  const claimableTiers = achievementsView(ctx, userId).flatMap((t) => t.claimable);
  if (claimableTiers.length > 0) {
    out.push({
      id: 'achievements-claimable',
      section: 'claim',
      text: `🏆 ${claimableTiers.length} achievement tier${claimableTiers.length === 1 ? '' : 's'} ready`,
      lossAtMs: null,
      // ach:claimall is registered under the `ach` prefix by the DAILY module, not one of
      // its own — the prefix and the owner do not have to match, and the flag follows the
      // owner.
      ...(ctx.config.modules.daily
        ? { control: { customId: `ach:claimall:${userId}`, label: '🏆 Claim all', style: ButtonStyle.Success } }
        : {}),
    });
  }

  const season = seasonView(ctx, userId);
  if (season !== null) {
    const rungs = season.rungs.filter((r) => r.unlocked && !r.claimed);
    if (rungs.length > 0) {
      out.push({
        id: 'season-claimable',
        section: 'claim',
        text: `🎖️ ${rungs.length} season reward${rungs.length === 1 ? '' : 's'} unclaimed`
          + ` — the season ends in ${season.daysLeft} day${season.daysLeft === 1 ? '' : 's'}`,
        // The EXACT forfeit instant, derived the way seasonIndexFor derives the index it is
        // the inverse of: dayIndex is `floor(now / DAY_MS)` and a season is SEASON_DAYS of
        // those, so the next season opens at the boundary below. SeasonView's own daysLeft
        // is day-granular and rounds UP, which over-estimated this by as much as a day and
        // let a trade offer dying tonight outrank a rung forfeiting this afternoon. The
        // TEXT stays day-granular on purpose — that is the sentence a player can act on —
        // and only the ranking reads the exact instant.
        lossAtMs: (seasonIndexFor(now) + 1) * SEASON_DAYS * DAY_MS,
        // The season index rides in the id because the handler rejects a stale one. It comes
        // from the view, never from a literal.
        ...(ctx.config.modules.daily
          ? {
            control: {
              customId: `season:claim:${userId}:${season.index}`,
              label: '🎖️ Claim season',
              style: ButtonStyle.Success,
            },
          }
          : {}),
      });
    }
  }

  const milestones = claimableMilestones(ctx, userId);
  if (milestones.length > 0) {
    const first = milestones[0];
    out.push({
      id: 'guests-claimable',
      section: 'claim',
      text: `🎁 ${first.name} milestone ready to claim`,
      lossAtMs: null,
      ...(ctx.config.modules.guests
        ? {
          control: {
            customId: `guests:claim:${userId}:${first.at}`,
            label: '🎁 Claim milestone',
            style: ButtonStyle.Success,
          },
        }
        : {}),
    });
  }

  if (pending > 0) {
    out.push({
      id: 'income-pending',
      section: 'claim',
      text: `💰 ${pending.toLocaleString()} idle earnings waiting`,
      // The capped deadline belongs on THIS row, because this is the row that carries the
      // Collect button and rankSignals drops every row that carries none before it sorts.
      // Left on income-capped alone it could never reach the ranking at all, and Collect —
      // pushed last — was the first control dropped whenever more than a row's worth of
      // buttons competed. Until the cap is reached there is no deadline: idle earnings
      // accrue and wait.
      lossAtMs: capped ? cappedAtMs : null,
      // park:collect carries NO owner segment by design — a clicker collects their OWN
      // income. On an owner-only ephemeral that is exactly right, which is why this row
      // needs no hub proxy. Its label goes stale after the click; Refresh is the answer,
      // not a proxy handler.
      ...(ctx.config.modules.park
        ? { control: { customId: 'park:collect', label: '💰 Collect', style: ButtonStyle.Success } }
        : {}),
    });
  }

  // WAITING. One combined row rather than three: this section answers "how long until
  // something happens", and three separate lines for three countdowns crowds the card
  // without saying more. It carries no control by construction — there is nothing to
  // click on a wait.
  const incubating = eggs.filter((e) => e.hatchesAt !== null && e.hatchesAt > now);
  if (incubating.length > 0) {
    const soonest = Math.min(...incubating.map((e) => e.hatchesAt!));
    out.push({
      id: 'waiting-eggs',
      section: 'waiting',
      text: `🥚 ${incubating.length} incubating — next <t:${Math.floor(soonest / 1000)}:R>`,
      lossAtMs: null,
    });
  }

  if (dig !== undefined && dig.returnsAt > now) {
    out.push({
      id: 'waiting-dig',
      section: 'waiting',
      text: `🧭 Dig crew back <t:${Math.floor(dig.returnsAt / 1000)}:R>`,
      lossAtMs: null,
    });
  }

  const cooking = breedings.filter((b) => b.readyAt > now);
  if (cooking.length > 0) {
    const soonest = Math.min(...cooking.map((b) => b.readyAt));
    out.push({
      id: 'waiting-breeding',
      section: 'waiting',
      text: `🧬 ${cooking.length} pairing${cooking.length === 1 ? '' : 's'} — next <t:${Math.floor(soonest / 1000)}:R>`,
      lossAtMs: null,
    });
  }

  // WORKING TOWARD. Always emitted — the energy row alone keeps this section non-empty
  // even when the gate and the milestone are both null, which is what makes a caught-up
  // park render as the hub with its earlier sections absent rather than a blank card.
  const gate = nextRatingGate(user.ratingHighWater);
  if (gate !== null) {
    out.push({
      id: 'goal-rating',
      section: 'goals',
      // ★ is rating/100 to one decimal — the house format, matching the lot-slot sentence in
      // src/modules/park/index.ts. The live parkRating and the monotone high-water are BOTH
      // shown because the gates key off the high-water while the player sees the live number
      // move, and showing only one makes the gap look like a bug.
      text: `★${(gate.threshold / 100).toFixed(1)} unlocks ${gate.labels.join(', ')}`
        + ` — you're at ★${(user.parkRating / 100).toFixed(1)} (best ★${(user.ratingHighWater / 100).toFixed(1)})`,
      lossAtMs: null,
    });
  }

  const milestone = nextMilestone(ctx, userId);
  if (milestone !== null) {
    out.push({
      id: 'goal-attendance',
      section: 'goals',
      text: `🎡 Next milestone: ${milestone.name} at ${milestone.at.toLocaleString()} attendance`,
      lossAtMs: null,
    });
  }

  const settled = settleEnergy(user.energy, user.energyUpdatedAt, now);
  out.push({
    id: 'goal-energy',
    section: 'goals',
    // settleEnergy is PURE and this is a read: the settled pair is rendered and never
    // written back. users.energy is only accurate immediately after a fight, so printing it
    // raw would show a number hours stale with nothing to catch it.
    text: energyLine(settled.energy, settled.updatedAtMs),
    lossAtMs: null,
  });

  return out;
}
