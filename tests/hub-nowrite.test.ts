import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, toClockDinos } from '../src/modules/park/service.js';
import { escapeAt, ESCAPE_WARN_MS, DAY_MS } from '../src/core/clock.js';
import { rollDailyQuests, questProgress } from '../src/modules/daily/service.js';
import { rollSeason, seasonView } from '../src/modules/daily/season.js';
import { SEASON_DAYS } from '../src/core/world.js';
import { QUESTS } from '../src/data/quests.js';
import { hubView } from '../src/modules/hub/service.js';
import { hubCardPayload } from '../src/modules/hub/embeds.js';
import { TRADE_EXPIRY_MS } from '../src/data/trade.js';
import { track } from '../src/core/stats.js';
import { ATTENDANCE_MILESTONES } from '../src/data/attendance.js';

// The gate task-14-brief.md exists to build: hubView is a READ, and every task before this
// one only CLAIMS that. This file targets hubView and hubCardPayload DIRECTLY — never a
// routed click — because routeInteraction itself writes users.displayName and a user_guilds
// row through touchPresence before dispatch, and the hub's own component handlers
// legitimately write (getOrCreateUser, settleEscapes). A gate built on a routed click would
// either fail on those or have to whitelist so much it proved nothing.
//
// Reimplements (rather than imports) the seeding helpers tests/hub-service.test.ts and
// tests/hub-routing.test.ts already built and proved out — they are unexported locals in
// those files, so there is nothing to import — but keeps every shape identical to them:
// same table columns, same real functions (toClockDinos, escapeAt) for any derived instant,
// nothing hand-computed. The one deliberate difference is combining every subsystem's live
// state onto ONE shared clock position instead of each test's own isolated one.

let ctx: ReturnType<typeof makeCtx>;

const paddockLot = (kind: 'herbivore_paddock' | 'carnivore_paddock', name: string) =>
  ctx.db.insert(schema.lots).values({ userId: 'u1', type: 'paddock', kind, name }).returning().get();

const seedDino = (over: Partial<typeof schema.dinos.$inferInsert> = {}) =>
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();

const egg = (over: Partial<typeof schema.eggs.$inferInsert> = {}) =>
  ctx.db.insert(schema.eggs).values({
    userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, ...over,
  }).run();

/**
 * Seed a park live in every subsystem hubView reads, all resolved against ONE shared clock
 * position — the branch coverage the task brief asks for, so this gate is not exercising an
 * empty park (most forbidden calls the break-and-watch step injects sit unconditionally at
 * the TOP of hubView, but the point of a live park is confidence that hubView's OWN reads —
 * toClockDinos, activeExpedition, activeBreedings, questProgress, achievementsView,
 * seasonView, claimableMilestones — are pure across every branch, not only the trivial one).
 *
 * Two branches the task brief lists cannot literally coexist and are called out rather than
 * silently dropped:
 *  - "a dig out" and "a dig returned" are the SAME activeExpedition() row (.get(), not
 *    .all() — startExpedition refuses a second dig while one is active), so a single park can
 *    be in only one of those states at a time. This fixture seeds RETURNED (expedition-ready)
 *    so the READY section gets full coverage (egg, expedition, breeding all firing); WAITING
 *    coverage still comes from the incubating egg and the still-cooking breeding below.
 *  - "income-capped" (ATTENTION) and "income-pending" (CLAIM) looked mutually exclusive
 *    before checking the actual conditions — one hypothesis in this file that turned out
 *    wrong. hubView's income-pending row fires on `pending > 0` alone; income-capped adds
 *    `&& now - user.lastCollectAt >= capMs` on top of the SAME `pending > 0`. capped is a
 *    strict subset of pending, so both fire together whenever the cap has been cleared —
 *    confirmed by the sanity test below, which asserts both are present rather than
 *    asserting the exclusion this comment first assumed.
 *
 * A THIRD, more consequential divergence from the brief's literal fixture list: a claimable
 * daily quest and a claimable season rung both require a row in dailyQuests / seasonProgress
 * for TODAY's key before questProgress / seasonView will report anything as claimable at
 * all — and rollDailyQuests / rollSeason (two of the five forbidden calls Step 3 injects)
 * each short-circuit with a bare `if (existing) return` / `if (currentRow(...)) return`
 * against that exact row. Seeding today's board to exercise the CLAIM branch would make the
 * corresponding break-and-watch case a guaranteed no-op — the same blind spot the brief
 * calls out explicitly for expireStale, just one level upstream. Confirmed empirically, not
 * assumed — task-14-report.md records a standalone check calling rollDailyQuests/rollSeason
 * twice in a row and observing the second call write nothing once a row for today exists —
 * so this fixture leaves BOTH tables with no row for today, trading away the
 * daily-claimable / season-claimable render branches (both already covered by
 * tests/hub-service.test.ts) for a break-and-watch that actually catches the write it
 * exists to catch.
 */
function seedLivePark(): { now: number } {
  getOrCreateUser(ctx, 'u2', 'U2');   // trade counterpart; toUser/fromUser are FKs

  // --- Establishes the shared clock position: one hour before the at-risk dino's real
  // escape instant, exactly as tests/hub-service.test.ts's seedAtRiskDino computes it. ---
  const riskLot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
  const atRiskDino = seedDino({ lotId: riskLot.id });
  const { clockDinos: preDinos, dinos: preRows } = toClockDinos(ctx, 'u1');
  const preIdx = preRows.findIndex((d) => d.id === atRiskDino.id);
  const escapeInstant = escapeAt(preDinos[preIdx]);
  if (escapeInstant === null) throw new Error('fixture dino never crosses the escape threshold');
  ctx.setNow(escapeInstant - 3_600_000);
  const now = ctx.now();
  expect(escapeAt(toClockDinos(ctx, 'u1').clockDinos[preIdx]), 'fixture already escaped').toBeGreaterThan(now);
  expect(escapeInstant - now, 'fixture is not within the warn window').toBeLessThanOrEqual(ESCAPE_WARN_MS);

  // --- dinos: escaped, unassigned, wrong-habitat (freshly fed, so it stays singularly
  // off-diet rather than ALSO reading as at-risk) ---
  seedDino({ lotId: riskLot.id, escapedAt: now - 3_600_000 });
  seedDino({ lotId: null, lastFedAt: now });
  const carnivoreLot = paddockLot('carnivore_paddock', 'Carnivore Paddock');
  const mismatchDino = seedDino({ lotId: carnivoreLot.id, lastFedAt: now });
  const { clockDinos: mismatchClock, dinos: mismatchRows } = toClockDinos(ctx, 'u1');
  const mismatchIdx = mismatchRows.findIndex((d) => d.id === mismatchDino.id);
  expect(mismatchClock[mismatchIdx].paddock?.diet, 'fixture is not actually off-diet')
    .not.toBe(mismatchClock[mismatchIdx].species.diet);

  // --- eggs: idle, ready, incubating ---
  egg();                                                     // eggs-idle
  egg({ incubationStartedAt: 0, hatchesAt: now });           // eggs-ready
  egg({ incubationStartedAt: 0, hatchesAt: now + 100_000 }); // waiting-eggs

  // --- expedition: returned (see the class doc comment above for why not "out" too) ---
  ctx.db.insert(schema.expeditions).values({
    userId: 'u1', siteId: 'coastal_dig', departedAt: 0, returnsAt: now - 1_000,
  }).run();

  // --- breedings: one finished, one still cooking (activeBreedings reads .all(), so both
  // coexist, unlike the single-row expedition above) ---
  ctx.db.insert(schema.breedings).values({
    userId: 'u1', parentA: 1, parentB: 2, rarity: 'common', startedAt: 0, readyAt: now - 1_000,
  }).run();
  ctx.db.insert(schema.breedings).values({
    userId: 'u1', parentA: 3, parentB: 4, rarity: 'common', startedAt: 0, readyAt: now + 100_000,
  }).run();

  // --- a claimable achievement tier: writes only user_stats (not a forbidden table), reads
  // as claimable because nothing has claimed it ---
  track(ctx, 'u1', 'eggs_hatched', 60);

  // --- a claimable attendance milestone: attendanceHighWater set DIRECTLY rather than via
  // recomputeRating (the real writer everywhere else in this codebase) — recomputeRating is
  // one of the five forbidden calls under test in Step 3, and calling it here to seed the
  // milestone would already latch ratingHighWater/attendanceHighWater to their live values,
  // making a later injected recomputeRating(ctx, 'u1') call a same-value no-op UPDATE that
  // this test's toEqual comparison cannot distinguish from no write at all. Leaving
  // ratingHighWater at its fresh-user 0 guarantees the injected call in case (c) moves it. ---
  ctx.db.update(schema.users).set({ attendanceHighWater: ATTENDANCE_MILESTONES[0].at })
    .where(eq(schema.users.discordId, 'u1')).run();

  // --- legacy points: bumpLegacyBest (case d) only writes if the computed total exceeds the
  // stored legacyRankBest (0 on a fresh user). legacyPoints sums dex species seen +
  // claimed achievement tiers + battle stars, and this fixture seeds none of those through
  // any OTHER path, so without this row bumpLegacyBest's injected call would also be a
  // same-value no-op. One direct species_seen row is enough to make it move. ---
  ctx.db.insert(schema.speciesSeen).values({ userId: 'u1', speciesId: 'triceratops', firstAt: 0 }).run();

  // --- trades: one live incoming offer (trade-incoming), one already-expired pending offer
  // addressed to u1 that nothing has closed — the fixture case (e) needs. expireStale
  // filters on (fromUser === userId || toUser === userId) && createdAt <= now - TRADE_EXPIRY_MS;
  // hubView's own read filters the opposite way (gt(createdAt, cutoff)), so this row is
  // invisible to the normal render and exists purely to give expireStale something to close. ---
  ctx.db.insert(schema.trades).values({
    fromUser: 'u2', toUser: 'u1',
    offer: { dinoIds: [], eggIds: [], cash: 100, foods: {} },
    request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
    status: 'pending', createdAt: now - 1_000,
  } as typeof schema.trades.$inferInsert).run();
  ctx.db.insert(schema.trades).values({
    fromUser: 'u2', toUser: 'u1',
    offer: { dinoIds: [], eggIds: [], cash: 50, foods: {} },
    request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
    status: 'pending', createdAt: now - TRADE_EXPIRY_MS - 1_000,
  } as typeof schema.trades.$inferInsert).run();

  return { now };
}

beforeEach(() => {
  ctx = makeCtx({ nowMs: 1_000_000 });
  getOrCreateUser(ctx, 'u1', 'U1');
});

const TABLES_THE_HUB_MAY_NOT_TOUCH = [
  'dailyQuests', 'seasonProgress', 'achievementClaims', 'alertsSent',
  'trades', 'eggs', 'expeditions', 'breedings', 'dinos', 'lots',
  // The stat/ledger side, widened after the whole-branch review: a future hub row calling
  // track(...) is the most plausible accidental write on a render path, and track writes
  // user_stats — which then feeds quest progress, achievement tiers and season points, so
  // the damage is not confined to the row that caused it. speciesSeen and seasonClaims are
  // the two other "first touch" records the read path sits next to, foodInventory is what a
  // stray feed would move, and txLog is where any cash movement lands. None of these were
  // visible to this gate before.
  'userStats', 'speciesSeen', 'seasonClaims', 'foodInventory', 'txLog',
] as const;

// Confirmed against src/core/db/schema.ts:
//   grep -n "^export const" src/core/db/schema.ts
// every name above is a real export; no renaming was needed.

describe('the hub no-write gate', () => {
  it('sanity: the seeded park actually renders every row named below', () => {
    // The claim is deliberately scoped to the rows this list names rather than to "every
    // branch": food-empty, for one, cannot coexist with the fed dinos this fixture needs,
    // and the two CLAIM rows below are excluded on purpose. What the list has to be is
    // complete for the rows it does assert, which is why the two goals rows are in it —
    // they render on the fresh-user zeroes this fixture leaves in place, and leaving them
    // out let the list look narrower than the fixture actually is.
    const { now } = seedLivePark();
    const rows = hubView(ctx, 'u1');
    const ids = rows.map((s) => s.id);
    for (const id of [
      'eggs-idle', 'eggs-ready', 'waiting-eggs',
      'expedition-ready',
      'breeding-ready', 'waiting-breeding',
      'dinos-escaped', 'dinos-unassigned', 'dinos-wrong-habitat', 'dinos-at-risk',
      'achievements-claimable', 'guests-claimable',
      'trade-incoming',
      'income-capped', 'income-pending',
      'goal-rating', 'goal-attendance', 'goal-energy',
    ]) {
      expect(ids, `fixture does not exercise the ${id} branch`).toContain(id);
    }
    // The two branches this fixture deliberately does not exercise, and why, per the doc
    // comment above: no row exists for today's dayKey / seasonIndex.
    expect(ids).not.toContain('daily-claimable');
    expect(ids).not.toContain('season-claimable');
    expect(now).toBeGreaterThan(1_000_000);
  });

  it('hubView writes nothing to any table it reads', () => {
    seedLivePark();
    const before = Object.fromEntries(
      TABLES_THE_HUB_MAY_NOT_TOUCH.map((t) => [t, ctx.db.select().from(schema[t]).all()]),
    );
    hubCardPayload(hubView(ctx, 'u1'), 'u1');
    for (const t of TABLES_THE_HUB_MAY_NOT_TOUCH) {
      expect(ctx.db.select().from(schema[t]).all(), `hubView wrote to ${t}`).toEqual(before[t]);
    }
  });

  it('hubView moves no high-water on the users row', () => {
    // These three are monotone latches. recomputeRating, bumpLegacyBest and the attendance
    // bump each move one, and each is a write a READ screen must never perform — recompute
    // in particular can drop parkRating below TRADE_MIN_RATING and kill pending offers.
    seedLivePark();
    const before = ctx.db.select().from(schema.users).all();
    hubCardPayload(hubView(ctx, 'u1'), 'u1');
    expect(ctx.db.select().from(schema.users).all()).toEqual(before);
  });
});

/**
 * The two CLAIM branches seedLivePark deliberately cannot reach, on a fixture of their own.
 *
 * seedLivePark leaves dailyQuests and seasonProgress with no row for today ON PURPOSE:
 * rollDailyQuests and rollSeason each short-circuit the moment such a row exists, so seeding
 * one would make the break-and-watch injection of those two calls a guaranteed no-op and the
 * gate above would prove nothing about them. That trade costs it the daily-claimable and
 * season-claimable render branches — the rows a player sees on most days.
 *
 * So this fixture is the mirror image and stands entirely apart: it pre-seeds both of today's
 * rows THROUGH THEIR REAL WRITERS, drives the quests and the season track to claimable, and
 * then asserts the narrower claim that is still available once those rows exist — that
 * rendering with the CLAIM rows LIVE writes nothing to either table. It must never be merged
 * into seedLivePark, and neither fixture makes the other redundant.
 */
describe('the hub no-write gate, with today\'s claim rows already seeded', () => {
  function seedClaimableDay(): void {
    // A season boundary the calendar actually reaches, matching tests/hub-service.test.ts's
    // own S1 anchor, rather than the epoch-adjacent index 0 the default clock sits on.
    ctx.setNow(690 * SEASON_DAYS * DAY_MS + 12 * 3_600_000);
    // The real writers, in the order the real commands call them: both snapshot baselines
    // off current stats, so every track below has to come after them or it lands in the
    // baseline instead of in the progress.
    rollDailyQuests(ctx, 'u1');
    rollSeason(ctx, 'u1');

    // Drive whatever board was rolled to complete, reading each quest's own stat and target
    // off the seeded row — never a hardcoded quest id, which pickBoard is free to stop
    // rolling the day the roster changes.
    for (const v of questProgress(ctx, 'u1')) {
      const def = QUESTS.find((q) => q.id === v.row.questId)!;
      track(ctx, 'u1', def.stat, v.row.target);
    }
    // 5 points per expedition claimed clears the first season rung on its own.
    track(ctx, 'u1', 'expeditions_claimed', 10);
  }

  it('sanity: this fixture reaches the two branches seedLivePark cannot', () => {
    seedClaimableDay();
    const ids = hubView(ctx, 'u1').map((s) => s.id);
    expect(ids, 'no claimable quest — the no-write claim below would be vacuous')
      .toContain('daily-claimable');
    expect(ids, 'no unlocked season rung — the no-write claim below would be vacuous')
      .toContain('season-claimable');
    expect(seasonView(ctx, 'u1'), 'no season row for today at all').not.toBeNull();
  });

  it('hubView writes nothing to daily_quests or season_progress with both rows live', () => {
    seedClaimableDay();
    const beforeQuests = ctx.db.select().from(schema.dailyQuests).all();
    const beforeSeason = ctx.db.select().from(schema.seasonProgress).all();
    hubCardPayload(hubView(ctx, 'u1'), 'u1');
    expect(ctx.db.select().from(schema.dailyQuests).all(), 'hubView wrote to daily_quests')
      .toEqual(beforeQuests);
    expect(ctx.db.select().from(schema.seasonProgress).all(), 'hubView wrote to season_progress')
      .toEqual(beforeSeason);
  });
});
