import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, toClockDinos, needsAttentionCount, capHours, facilityBonusPct } from '../src/modules/park/service.js';
import { escapeAt, ESCAPE_WARN_MS, accruedIncome, HUNGER_DRAIN_MS, hungerAt, drainMsFor, dayKeyUTC, DAY_MS } from '../src/core/clock.js';
import { hubView } from '../src/modules/hub/service.js';
import { nextRatingGate } from '../src/modules/hub/gates.js';
import { TRADE_EXPIRY_MS } from '../src/data/trade.js';
import { track, readStat } from '../src/core/stats.js';
import { QUESTS } from '../src/data/quests.js';
import { claimQuests } from '../src/modules/daily/service.js';
import { rollSeason, seasonView } from '../src/modules/daily/season.js';
import { SEASON_DAYS } from '../src/core/world.js';
import { recomputeRating } from '../src/modules/park/rating.js';
import { claimableMilestones, nextMilestone } from '../src/modules/guests/service.js';
import { ATTENDANCE_MILESTONES } from '../src/data/attendance.js';
import { settleEnergy } from '../src/data/battle/energy.js';
import { energyLine } from '../src/modules/battles/embeds.js';
import { LOT_SLOT_THRESHOLDS, SHOP_CEILING, MYTHIC_UNLOCK_RATING } from '../src/data/progression.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx({ nowMs: 1_000_000 }); getOrCreateUser(ctx, 'u1', 'U1'); });

const egg = (over: Partial<typeof schema.eggs.$inferInsert> = {}) =>
  ctx.db.insert(schema.eggs).values({
    userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, ...over,
  }).run();

const ids = (userId = 'u1') => hubView(ctx, userId).map((s) => s.id);

// --- NEEDS YOU fixtures -----------------------------------------------------------------
// These build real rows against the real schema and hand back through the real clock
// (toClockDinos/escapeAt/accruedIncome) rather than hand-deriving instants, and each one
// asserts the state it claims to produce before any hub assertion relies on it.

const seedDino = (over: Partial<typeof schema.dinos.$inferInsert> = {}) =>
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();

const paddockLot = (kind: 'herbivore_paddock' | 'carnivore_paddock', name: string) =>
  ctx.db.insert(schema.lots).values({ userId: 'u1', type: 'paddock', kind, name }).returning().get();

// Escape-instant math is independent of `now` (see escapeAt's own doc comment), so it can
// be computed once right after the insert and reused after ctx.setNow moves `now` under it.
const escapeInstantFor = (dinoId: number): number => {
  const { clockDinos, dinos } = toClockDinos(ctx, 'u1');
  const idx = dinos.findIndex((d) => d.id === dinoId);
  const at = escapeAt(clockDinos[idx]);
  if (at === null) throw new Error('fixture dino never crosses the escape threshold');
  return at;
};

/** The instant hubView's dinos-at-risk row must carry for this dino, per the real clock. */
const expectedEscapeInstantFor = (dino: { id: number }): number => escapeInstantFor(dino.id);

// Herbivore in a herbivore paddock, no decor -> fit 0.75 (same shape tests/escapes.test.ts
// uses for its settleEscapes fixture). Comfort crosses ESCAPE_COMFORT at ~32h, +8h grace.
const seedAtRiskDino = () => {
  const lot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
  const dino = seedDino({ lotId: lot.id });
  const at = escapeInstantFor(dino.id);
  ctx.setNow(at - 3_600_000);   // one hour before the escape instant — inside the 12h window
  // Precondition: genuinely at risk, not yet escaped and inside ESCAPE_WARN_MS — never
  // faked via escapedAt, which is a different state (see the task brief).
  expect(escapeAt(toClockDinos(ctx, 'u1').clockDinos[0]), 'fixture already escaped').toBeGreaterThan(ctx.now());
  expect(at - ctx.now(), 'fixture is not within the warn window').toBeLessThanOrEqual(ESCAPE_WARN_MS);
  return dino;
};

// Triceratops (herbivore) parked in a carnivore paddock: paddockFit is pinned to 0.5
// whenever diet mismatches, independent of decor, so this alone is enough to trip
// needsAttentionCount's mismatch predicate.
const seedWrongHabitatDino = () => {
  const lot = paddockLot('carnivore_paddock', 'Carnivore Paddock');
  const dino = seedDino({ lotId: lot.id });
  const { clockDinos, dinos } = toClockDinos(ctx, 'u1');
  const idx = dinos.findIndex((d) => d.id === dino.id);
  expect(clockDinos[idx].paddock?.diet, 'fixture is not actually off-diet').not.toBe(clockDinos[idx].species.diet);
  return dino;
};

// A dino whose hunger has fully drained (48h since its last feed, nothing eaten): genuinely
// needs food, not merely "not at 100".
const seedHungryDino = () => {
  const lot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
  const dino = seedDino({ lotId: lot.id });
  ctx.setNow(HUNGER_DRAIN_MS);
  const { clockDinos, dinos } = toClockDinos(ctx, 'u1');
  const idx = dinos.findIndex((d) => d.id === dino.id);
  const c = clockDinos[idx];
  expect(hungerAt(c.hungerAtFed, c.lastFedAt, ctx.now(), drainMsFor(c.traits)), 'fixture is not actually hungry')
    .toBeLessThanOrEqual(0);
  return dino;
};

// A paddocked, freshly-fed dino earning income from the very instant the player's cap
// window opens (lastCollectAt), then `now` pushed a full cap + 1h past that — so the
// window is genuinely capped, not merely old.
const seedIncomeAtCap = () => {
  const lot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
  const before = toClockDinos(ctx, 'u1');
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', lotId: lot.id,
    hunger: 100, lastFedAt: before.user.lastCollectAt, hatchedAt: 0,
  }).run();
  const capMs = capHours(before.lots) * 3_600_000;   // no visitor_center lot -> falls back to 8h
  ctx.setNow(before.user.lastCollectAt + capMs + 3_600_000);
  const after = toClockDinos(ctx, 'u1');
  const pending = accruedIncome(
    after.clockDinos, facilityBonusPct(after.lots), capHours(after.lots), after.user.lastCollectAt, ctx.now());
  // Precondition: the fixture actually accrues income AND the elapsed time already clears
  // the cap — both halves of hubView's income-capped condition.
  expect(pending, 'fixture accrues no income — cannot exercise the cap').toBeGreaterThan(0);
  expect(ctx.now() - after.user.lastCollectAt, 'fixture has not cleared the cap window').toBeGreaterThanOrEqual(capMs);
};

describe('hubView — the READY section', () => {
  it('is empty for a player with nothing ready', () => {
    expect(hubView(ctx, 'u1').filter((s) => s.section === 'ready')).toEqual([]);
  });

  it('reports an egg whose hatch time has arrived, and offers Crack', () => {
    egg({ incubationStartedAt: 0, hatchesAt: 1_000_000 });   // exactly now — the boundary
    const row = hubView(ctx, 'u1').find((s) => s.id === 'eggs-ready');
    expect(row, 'no eggs-ready row').toBeTruthy();
    expect(row!.section).toBe('ready');
    expect(row!.lossAtMs, 'a ready egg waits forever and must not carry a deadline').toBeNull();
    expect(row!.control!.customId).toBe('hatch:crack:1');
  });

  it('does NOT report an egg still cooking as ready', () => {
    egg({ incubationStartedAt: 0, hatchesAt: 1_000_001 });   // one ms out
    expect(ids()).not.toContain('eggs-ready');
  });

  it('reports an egg that was never put in the incubator, and offers Incubate', () => {
    egg();   // incubationStartedAt stays null
    const row = hubView(ctx, 'u1').find((s) => s.id === 'eggs-idle');
    expect(row, 'no eggs-idle row').toBeTruthy();
    // The owner uid rides in this id because the handler checks it; the egg id is
    // validated as an integer on the other side.
    expect(row!.control!.customId).toBe('hatch:inc:u1:1');
  });

  it('suppresses both egg rows for an egg locked in a pending trade', () => {
    egg();
    egg({ incubationStartedAt: 0, hatchesAt: 0 });
    getOrCreateUser(ctx, 'u2', 'U2');   // toUser is FK-constrained against users.discordId
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { dinoIds: [], eggIds: [1, 2], cash: 0, foods: {} },
      request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
      status: 'pending', createdAt: 999_999,
    } as typeof schema.trades.$inferInsert).run();
    // Both incubateEgg and hatchEgg refuse a locked egg, so offering either control would
    // be offering a button that can only error.
    expect(ids()).not.toContain('eggs-idle');
    expect(ids()).not.toContain('eggs-ready');
  });

  it('reports a returned expedition and offers Claim, but not one still out', () => {
    ctx.db.insert(schema.expeditions).values({
      userId: 'u1', siteId: 'coastal_dig', departedAt: 0, returnsAt: 1_000_000,
    }).run();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'expedition-ready');
    expect(row!.control!.customId).toBe('exp:claim:u1');

    ctx.setNow(999_999);
    expect(ids()).not.toContain('expedition-ready');
  });

  it('reports a finished pairing and offers Claim, carrying the breeding id', () => {
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: 1, parentB: 2, rarity: 'common', startedAt: 0, readyAt: 500_000,
    }).run();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'breeding-ready');
    // breed:claim carries the breeding id, NOT the owner — safe here only because the hub
    // is ephemeral and therefore owner-only. It must never be minted on a public message.
    expect(row!.control!.customId).toBe('breed:claim:1');
  });

  it('writes nothing — hubView is a read', () => {
    egg();
    const before = ctx.db.select().from(schema.eggs).all();
    hubView(ctx, 'u1');
    expect(ctx.db.select().from(schema.eggs).all()).toEqual(before);
  });
});

describe('hubView — the NEEDS YOU section', () => {
  it('reports dinos with no paddock, which nothing else in the product surfaces', () => {
    // accruedIncome skips them outright (`if (!d.paddock) continue;`), so an unassigned
    // dino is pure silent loss: it eats, it can escape, and it earns nothing.
    seedDino({ lotId: null });
    const row = hubView(ctx, 'u1').find((s) => s.id === 'dinos-unassigned');
    expect(row, 'no dinos-unassigned row').toBeTruthy();
    expect(row!.section).toBe('attention');
  });

  it('reports an escaped dino with NO control, because /rescue is slash-only', () => {
    seedDino({ escapedAt: 500_000 });
    const row = hubView(ctx, 'u1').find((s) => s.id === 'dinos-escaped');
    expect(row, 'no dinos-escaped row').toBeTruthy();
    expect(row!.control, 'the escaped row must not take a button seat').toBeUndefined();
    expect(row!.text).toContain('/rescue');
  });

  it('carries the escape INSTANT as the at-risk deadline, not now and not a duration', () => {
    const dino = seedAtRiskDino();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'dinos-at-risk')!;
    // lossAtMs is an absolute instant; rankSignals compares it against other absolute
    // instants. A duration here sorts as though the dino escaped in 1970.
    expect(row.lossAtMs).toBe(expectedEscapeInstantFor(dino));
    expect(row.control!.customId).toBe('hub:feedall:u1');
  });

  it('reports income that has hit its cap, with a deadline already in the past', () => {
    seedIncomeAtCap();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'income-capped')!;
    // Already losing outranks about to lose — see rankSignals. Any past instant does.
    expect(row.lossAtMs).not.toBeNull();
    expect(row.lossAtMs!).toBeLessThanOrEqual(ctx.now());
  });

  it('reports an empty larder and points at the shop, with no Feed control', () => {
    seedHungryDino();
    // Feed all with nothing to feed with is a button that can only fail.
    ctx.db.delete(schema.foodInventory).run();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'food-empty');
    expect(row, 'no food-empty row').toBeTruthy();
    expect(row!.control).toBeUndefined();
    expect(hubView(ctx, 'u1').find((s) => s.id === 'dinos-at-risk')?.control).toBeUndefined();
  });

  it('agrees with needsAttentionCount rather than keeping its own definition', () => {
    // The union of at-risk and wrong-habitat, counted as DISTINCT dinos: a dino can trip
    // both, and summing the two rows would double-count it. This test is what stops the
    // hub growing a third inlined copy of the predicate.
    seedAtRiskDino();
    seedWrongHabitatDino();
    const { clockDinos } = toClockDinos(ctx, 'u1');
    const row = hubView(ctx, 'u1').find((s) => s.id === 'needs-attention')!;
    expect(row.text).toContain(String(needsAttentionCount(clockDinos, ctx.now())));
  });
});

describe('hubView — the incoming trade offer', () => {
  // TradeSide requires `foods` (src/core/db/schema.ts:165, not src/data/trade.ts as the task
  // brief first claimed), and fromUser/toUser are FKs to users.discordId — mirrors the
  // corrected fixture already used above (the "suppresses both egg rows" trade insert).
  beforeEach(() => { getOrCreateUser(ctx, 'u2', 'U2'); });

  const offerTo = (toUser: string, createdAt: number) => {
    getOrCreateUser(ctx, toUser, toUser);
    ctx.db.insert(schema.trades).values({
      fromUser: 'u2', toUser,
      offer: { dinoIds: [], eggIds: [], cash: 100, foods: {} },
      request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
      status: 'pending', createdAt,
    } as typeof schema.trades.$inferInsert).run();
  };

  it('reports an offer addressed to you, with its expiry as the deadline', () => {
    offerTo('u1', 1_000_000);
    const row = hubView(ctx, 'u1').find((s) => s.id === 'trade-incoming')!;
    expect(row.section).toBe('attention');
    expect(row.lossAtMs).toBe(1_000_000 + TRADE_EXPIRY_MS);
    expect(row.control, 'the trade row ships without a control by design').toBeUndefined();
    expect(row.text).toContain('/trade');
  });

  it('ignores an offer YOU sent — escrow already covers that side', () => {
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { dinoIds: [], eggIds: [], cash: 1, foods: {} },
      request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
      status: 'pending', createdAt: 1_000_000,
    } as typeof schema.trades.$inferInsert).run();
    expect(hubView(ctx, 'u1').map((s) => s.id)).not.toContain('trade-incoming');
  });

  it('ignores an offer past its deadline WITHOUT expiring it', () => {
    // Still status 'pending' in the table: nothing has run expireStale. The hub must read
    // past it, not close it — closing is a write, and a read screen that mutates trades is
    // how a hub render would resolve someone else's offer.
    offerTo('u1', 1_000_000 - TRADE_EXPIRY_MS);   // exactly on the cutoff
    expect(hubView(ctx, 'u1').map((s) => s.id)).not.toContain('trade-incoming');
    const rows = ctx.db.select().from(schema.trades).all();
    expect(rows[0].status, 'the hub expired a trade — it must never write here').toBe('pending');
    expect(rows[0].resolvedAt).toBeNull();
  });

  it('uses the recipient index rather than scanning every pending trade', () => {
    // A behavioural proxy for "the query is scoped": seed offers between other players and
    // assert none of them reaches this player's hub. It does not prove the index is USED —
    // tests/db.test.ts (Task 1) proves the index exists; this proves the predicate is right.
    for (let n = 0; n < 20; n++) offerTo(`other${n}`, 1_000_000);
    expect(hubView(ctx, 'u1').map((s) => s.id)).not.toContain('trade-incoming');
  });
});

describe('hubView — the CLAIM section', () => {
  // Mirrors tests/daily-claim.test.ts's seedQuest idiom: baseline snapshotted from the
  // user's current stat total so a `track` call of exactly `target` completes it, rather
  // than hand-inserting a row whose progress invariant questProgress alone maintains.
  const seedQuest = (dayKey: string, slot: number, questId: string, target: number) => {
    const def = QUESTS.find((q) => q.id === questId)!;
    const baseline = readStat(ctx, 'u1', def.stat);
    ctx.db.insert(schema.dailyQuests).values({ userId: 'u1', dayKey, slot, questId, baseline, target }).run();
    return def;
  };

  it('a completed, unclaimed quest yields daily-claimable with a null lossAtMs', () => {
    const dayKey = dayKeyUTC(ctx.now());
    const def = seedQuest(dayKey, 0, 'feed_3', 3);
    track(ctx, 'u1', def.stat, 3);
    const row = hubView(ctx, 'u1').find((s) => s.id === 'daily-claimable');
    expect(row, 'no daily-claimable row').toBeTruthy();
    expect(row!.control!.customId).toBe('daily:claim:u1');
    expect(row!.lossAtMs, 'a claimable quest waits forever, like a ready egg').toBeNull();
  });

  it('does NOT re-offer a completed quest that was already claimed — filtering on complete alone would', () => {
    const dayKey = dayKeyUTC(ctx.now());
    const def = seedQuest(dayKey, 0, 'feed_3', 3);
    track(ctx, 'u1', def.stat, 3);
    claimQuests(ctx, 'u1');   // the real claim path — stamps claimedAt for real, not faked
    expect(ids()).not.toContain('daily-claimable');
  });

  it('an achievement track with a non-empty claimable array yields achievements-claimable', () => {
    track(ctx, 'u1', 'eggs_hatched', 60);   // crosses tiers 0 and 1 on one track
    const row = hubView(ctx, 'u1').find((s) => s.id === 'achievements-claimable');
    expect(row, 'no achievements-claimable row').toBeTruthy();
    expect(row!.control!.customId).toBe('ach:claimall:u1');
  });

  it("an unlocked, unclaimed season rung yields season-claimable, keyed by the VIEW's own index", () => {
    // The suite's default clock (nowMs: 1_000_000, set in the top-level beforeEach) sits at
    // season index 0 — vacuous for the "id carries the real index" assertion below, since a
    // hardcoded literal 0 would also pass. Move the clock to season 1 (matches tests/season.test.ts's
    // own S1 anchor) before seeding, so this test can actually distinguish the view's index
    // from a literal.
    const S1 = 690 * SEASON_DAYS * DAY_MS;
    ctx.setNow(S1);
    rollSeason(ctx, 'u1');
    track(ctx, 'u1', 'expeditions_claimed', 10);   // expeditions: 5 pts each, per 1 -> 50 pts, rung 0 at 50
    const view = seasonView(ctx, 'u1')!;
    expect(view.index, 'fixture sanity: must not sit on the vacuous season 0').not.toBe(0);
    const row = hubView(ctx, 'u1').find((s) => s.id === 'season-claimable');
    expect(row, 'no season-claimable row').toBeTruthy();
    expect(row!.control!.customId).toBe(`season:claim:u1:${view.index}`);
    expect(row!.lossAtMs, 'the season row is the one deadline in this section').not.toBeNull();
  });

  it('a crossed, unclaimed attendance milestone yields guests-claimable', () => {
    const lot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
    // 9 distinct species -> attendance 225 (1000 * 9/40, rounded), clearing the 200
    // "Opening Day" threshold without also crossing the 400 "Word of Mouth" one.
    const species = [
      'triceratops', 'stegosaurus', 'parasaurolophus', 'iguanodon',
      'ankylosaurus', 'brachiosaurus', 'gallimimus', 'maiasaura', 'massospondylus',
    ];
    ctx.db.insert(schema.dinos).values(species.map((speciesId) => ({
      userId: 'u1', lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }))).run();
    recomputeRating(ctx, 'u1');   // the real writer of attendanceHighWater
    const first = claimableMilestones(ctx, 'u1')[0];
    expect(first, 'fixture crossed no milestone').toBeTruthy();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'guests-claimable');
    expect(row, 'no guests-claimable row').toBeTruthy();
    expect(row!.control!.customId).toBe(`guests:claim:u1:${first.at}`);
  });

  it('uncollected income yields income-pending, with park:collect carrying no uid', () => {
    const lot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
    const before = toClockDinos(ctx, 'u1');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lotId: lot.id,
      hunger: 100, lastFedAt: before.user.lastCollectAt, hatchedAt: 0,
    }).run();
    ctx.setNow(before.user.lastCollectAt + 3_600_000);   // 1h — well under the 8h fallback cap
    const row = hubView(ctx, 'u1').find((s) => s.id === 'income-pending');
    expect(row, 'no income-pending row').toBeTruthy();
    // Exactly 'park:collect' — no uid segment appended. A clicker collects their OWN
    // income, which is correct on an owner-only ephemeral and is why this needs no proxy.
    expect(row!.control!.customId).toBe('park:collect');
  });

  it('writes nothing to daily_quests, season_progress or achievement_claims — a local rehearsal of the no-write gate', () => {
    const beforeQuests = ctx.db.select().from(schema.dailyQuests).all();
    const beforeSeason = ctx.db.select().from(schema.seasonProgress).all();
    const beforeClaims = ctx.db.select().from(schema.achievementClaims).all();
    hubView(ctx, 'u1');
    expect(ctx.db.select().from(schema.dailyQuests).all()).toEqual(beforeQuests);
    expect(ctx.db.select().from(schema.seasonProgress).all()).toEqual(beforeSeason);
    expect(ctx.db.select().from(schema.achievementClaims).all()).toEqual(beforeClaims);
  });
});

describe('hubView — WAITING and WORKING TOWARD', () => {
  it('an incubating egg, a dig still out and a pairing still cooking are WAITING rows with no control, and flip to READY the instant their clock crosses', () => {
    const soon = ctx.now() + 1;
    egg({ incubationStartedAt: 0, hatchesAt: soon });
    ctx.db.insert(schema.expeditions).values({
      userId: 'u1', siteId: 'coastal_dig', departedAt: 0, returnsAt: soon,
    }).run();
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: 1, parentB: 2, rarity: 'common', startedAt: 0, readyAt: soon,
    }).run();

    // Before the boundary: WAITING claims all three, and none of their READY twins fire.
    const before = hubView(ctx, 'u1');
    for (const id of ['waiting-eggs', 'waiting-dig', 'waiting-breeding']) {
      const row = before.find((s) => s.id === id);
      expect(row, `no ${id} row before the boundary`).toBeTruthy();
      expect(row!.section).toBe('waiting');
      expect(row!.text).toMatch(/<t:\d+:R>/);
      expect(row!.control, `${id} must not carry a control`).toBeUndefined();
      expect(row!.lossAtMs, 'a wait is not a deadline').toBeNull();
    }
    const beforeIds = before.map((s) => s.id);
    for (const id of ['eggs-ready', 'expedition-ready', 'breeding-ready']) {
      expect(beforeIds, `${id} claimed early — an item cannot be both waiting and ready`).not.toContain(id);
    }

    // Cross the boundary: the same three become READY, and WAITING must release them — the
    // overlap this test exists to catch is either section still claiming the same item.
    ctx.setNow(soon);
    const after = hubView(ctx, 'u1');
    const afterIds = after.map((s) => s.id);
    for (const id of ['eggs-ready', 'expedition-ready', 'breeding-ready']) {
      expect(afterIds, `${id} missing after the boundary`).toContain(id);
    }
    for (const id of ['waiting-eggs', 'waiting-dig', 'waiting-breeding']) {
      expect(afterIds, `${id} still claimed after the boundary — overlap with READY`).not.toContain(id);
    }
  });

  it('a completely idle park still produces a goals section — the empty-state contract', () => {
    expect(hubView(ctx, 'u1').some((s) => s.section === 'goals')).toBe(true);
  });

  it('quotes the rating gate threshold in star form and names every label at it', () => {
    const user = getOrCreateUser(ctx, 'u1', 'U1');
    const gate = nextRatingGate(user.ratingHighWater);
    expect(gate, 'fixture sanity: a fresh user must not already be past every gate').not.toBeNull();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'goal-rating')!;
    expect(row, 'no goal-rating row').toBeTruthy();
    expect(row.section).toBe('goals');
    expect(row.text).toContain(`★${(gate!.threshold / 100).toFixed(1)}`);
    // Every label at the threshold, joined exactly as the ladder computed them — not a
    // hardcoded count, since more than one rung can collide on the same threshold.
    expect(row.text).toContain(gate!.labels.join(', '));
  });

  it("the energy row equals energyLine's exact wording for the settled pair — never a second rendering of it", () => {
    const user = getOrCreateUser(ctx, 'u1', 'U1');
    const settled = settleEnergy(user.energy, user.energyUpdatedAt, ctx.now());
    const row = hubView(ctx, 'u1').find((s) => s.id === 'goal-energy')!;
    expect(row, 'no goal-energy row').toBeTruthy();
    expect(row.section).toBe('goals');
    expect(row.text).toBe(energyLine(settled.energy, settled.updatedAtMs));
  });

  it('never renders the raw stored energy — it is only accurate immediately after a fight', () => {
    ctx.db.update(schema.users).set({ energy: 2, energyUpdatedAt: 0 })
      .where(eq(schema.users.discordId, 'u1')).run();
    ctx.setNow(100_000_000);   // long past due for regen to have moved well off the raw value
    const settled = settleEnergy(2, 0, ctx.now());
    expect(settled.energy, 'fixture sanity: regen must actually move the number away from the raw one').not.toBe(2);
    const row = hubView(ctx, 'u1').find((s) => s.id === 'goal-energy')!;
    expect(row.text, 'the raw stored energy leaked into the row').not.toContain('2/10');
    expect(row.text).toBe(energyLine(settled.energy, settled.updatedAtMs));
  });

  it('names the next unclaimed attendance milestone', () => {
    const milestone = nextMilestone(ctx, 'u1');
    expect(milestone, 'fixture sanity: a fresh user must have an unclaimed milestone ahead').not.toBeNull();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'goal-attendance')!;
    expect(row, 'no goal-attendance row').toBeTruthy();
    expect(row.section).toBe('goals');
    expect(row.text).toContain(milestone!.name);
    expect(row.text).toContain(milestone!.at.toLocaleString());
  });

  it('omits the attendance goal once none is left, without losing the empty-state contract', () => {
    // The ladder tops out at 1800 (ATTENDANCE_MILESTONES); pushing the high-water past it
    // AND claiming every rung is the fixture for "nothing left ahead" — leaving any rung
    // unclaimed would light up guests-claimable instead and mask what this test checks.
    ctx.db.update(schema.users).set({ attendanceHighWater: 999_999 })
      .where(eq(schema.users.discordId, 'u1')).run();
    for (const m of ATTENDANCE_MILESTONES) {
      ctx.db.insert(schema.attendanceClaims).values({ userId: 'u1', milestone: m.at, claimedAt: 0 }).run();
    }
    expect(nextMilestone(ctx, 'u1'), 'fixture sanity: must actually exhaust the ladder').toBeNull();
    expect(claimableMilestones(ctx, 'u1'), 'fixture sanity: nothing must be left claimable either').toEqual([]);
    expect(hubView(ctx, 'u1').map((s) => s.id)).not.toContain('goal-attendance');
    expect(hubView(ctx, 'u1').some((s) => s.section === 'goals')).toBe(true);
  });

  it('the goals section renders from the energy row ALONE once both the rating gate and the milestone are exhausted', () => {
    // Every ladder nextRatingGate consults, read from gates.ts's own imports rather than a
    // guessed literal: lot slots, expedition site unlocks, the shop ceiling and the mythic
    // unlock. Every comparison in nextRatingGate is a strict `>`, so sitting exactly ON the
    // highest rung clears all of them at once.
    const highestGateThreshold = Math.max(
      ...LOT_SLOT_THRESHOLDS,
      ...Object.values(EXPEDITION_SITES).map((s) => s.unlockRating),
      ...SHOP_CEILING.map((r) => r.atLeast),
      MYTHIC_UNLOCK_RATING,
    );
    ctx.db.update(schema.users)
      .set({ ratingHighWater: highestGateThreshold, attendanceHighWater: 999_999 })
      .where(eq(schema.users.discordId, 'u1')).run();
    // Same exhaustion fixture as the test above — every rung claimed, not merely crossed,
    // or claimableMilestones would light up guests-claimable and mask this case too.
    for (const m of ATTENDANCE_MILESTONES) {
      ctx.db.insert(schema.attendanceClaims).values({ userId: 'u1', milestone: m.at, claimedAt: 0 }).run();
    }

    // Both preconditions this case depends on, asserted directly against the real
    // functions — not assumed from the setup above.
    expect(nextRatingGate(highestGateThreshold), 'fixture sanity: the rating gate must be exhausted').toBeNull();
    expect(nextMilestone(ctx, 'u1'), 'fixture sanity: the milestone ladder must be exhausted').toBeNull();

    const rows = hubView(ctx, 'u1');
    const ids = rows.map((s) => s.id);
    expect(ids).not.toContain('goal-rating');
    expect(ids).not.toContain('goal-attendance');
    // Not just "a goals row exists" — exactly one, and it is the energy row. That is the
    // difference between this case and the idle-park test: there, goal-rating and
    // goal-attendance both still fire (ratingHighWater/attendanceHighWater sit at 0, below
    // every rung), so goal-energy is never the ONLY thing keeping the section alive.
    const goalsRows = rows.filter((s) => s.section === 'goals');
    expect(goalsRows, 'the goals section must still render on the energy row alone').toHaveLength(1);
    expect(goalsRows[0].id).toBe('goal-energy');
  });
});
