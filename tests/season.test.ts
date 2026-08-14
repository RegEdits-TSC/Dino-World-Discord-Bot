import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track, STATS } from '../src/core/stats.js';
import { rollSeason, headStartFor, seasonPoints, seasonView, claimSeason } from '../src/modules/daily/season.js';
import { SEASON_DAYS } from '../src/core/world.js';
import { SEASON_CAPSTONE } from '../src/data/seasons.js';

const DAY = 86_400_000;
export const S1 = 689 * SEASON_DAYS * DAY;   // season 1, day 1
const S2 = S1 + 30 * DAY;

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(S1); getOrCreateUser(ctx, 'p', 'P'); });

const rows = (userId = 'p') => ctx.db.select().from(schema.seasonProgress)
  .where(eq(schema.seasonProgress.userId, userId)).all();

// battleProgress.stars is capped 0-3 per row by the stars_range CHECK constraint
// (src/core/db/schema.ts) — spread a headline total across synthetic stage rows so
// the head-start tests below can exercise totals above 3 without violating it.
function seedStars(total: number): void {
  let remaining = total;
  let n = 0;
  while (remaining > 0) {
    const stars = Math.min(3, remaining);
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: `veteran-${n++}`, stars }).run();
    remaining -= stars;
  }
}

describe('rollSeason', () => {
  it('freezes a row for the current season on first touch', () => {
    rollSeason(ctx, 'p');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].seasonIndex).toBe(689);
    expect(rows()[0].createdAt).toBe(S1);
    expect(rows()[0].badgeAt).toBeNull();
  });

  it('is idempotent — a second call writes nothing new', () => {
    rollSeason(ctx, 'p');
    const before = rows()[0].createdAt;
    ctx.setNow(S1 + 5 * DAY);
    rollSeason(ctx, 'p');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].createdAt).toBe(before);
  });

  it('no-ops for a user with no users row', () => {
    rollSeason(ctx, 'ghost');
    expect(rows('ghost')).toHaveLength(0);
  });

  // The trap this guards: freezing only the ladder's current stats means a source added
  // in a later season finds no key, reads baseline 0, and credits a lifetime counter.
  it('freezes EVERY StatId, not only the ones the ladder reads', () => {
    track(ctx, 'p', 'dinos_fed', 7);
    track(ctx, 'p', 'lots_built', 3);
    rollSeason(ctx, 'p');
    const b = rows()[0].baselines;
    for (const stat of Object.keys(STATS)) {
      expect(b[stat], `missing baseline for ${stat}`).toBeDefined();
    }
    expect(b.dinos_fed).toBe(7);
    expect(b.lots_built).toBe(3);
    expect(b.eggs_hatched).toBe(0);
  });

  // Retention, not sweeping — the opposite of rollDailyQuests. badgeAt on a past row is
  // the permanent record of that season's capstone.
  it('RETAINS the previous season’s row when a new season rolls', () => {
    rollSeason(ctx, 'p');
    ctx.db.update(schema.seasonProgress).set({ badgeAt: S1 + DAY })
      .where(eq(schema.seasonProgress.userId, 'p')).run();
    ctx.setNow(S2);
    track(ctx, 'p', 'dinos_fed', 100);
    rollSeason(ctx, 'p');
    expect(rows()).toHaveLength(2);
    const old = rows().find((r) => r.seasonIndex === 689)!;
    const fresh = rows().find((r) => r.seasonIndex === 690)!;
    expect(old.badgeAt).toBe(S1 + DAY);
    // The new season starts from the counter as it stands now, not from zero.
    expect(fresh.baselines.dinos_fed).toBe(100);
  });
});

describe('headStartFor', () => {
  it('is zero for a brand-new account', () => {
    expect(headStartFor(ctx, 'p')).toBe(0);
  });

  it('sums species seen, battle stars and rating/25', () => {
    for (const id of ['triceratops', 'velociraptor']) {
      ctx.db.insert(schema.speciesSeen).values({ userId: 'p', speciesId: id, firstAt: 0 }).run();
    }
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: 's1', stars: 3 }).run();
    ctx.db.update(schema.users).set({ ratingHighWater: 600 })
      .where(eq(schema.users.discordId, 'p')).run();
    expect(headStartFor(ctx, 'p')).toBe(2 + 3 + 24);
  });

  it('clamps at HEAD_START_CAP', () => {
    seedStars(210);
    expect(headStartFor(ctx, 'p')).toBe(200);
  });

  // Frozen at roll time: it must not drift as the season's own progress moves.
  it('is stored on the row and never recomputed', () => {
    seedStars(10);
    rollSeason(ctx, 'p');
    expect(rows()[0].headStart).toBe(10);
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: 's2', stars: 3 }).run();
    rollSeason(ctx, 'p');
    expect(rows()[0].headStart).toBe(10);
  });

  // The whole point of the three-term choice: a player's FIRST season, whenever it falls.
  it('pays on the first season ever, not only on season 1', () => {
    ctx.setNow(S2);
    seedStars(12);
    rollSeason(ctx, 'p');
    expect(rows()[0].seasonIndex).toBe(690);
    expect(rows()[0].headStart).toBe(12);
  });

  it('pays nothing on a SECOND season', () => {
    seedStars(12);
    rollSeason(ctx, 'p');
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    expect(rows().find((r) => r.seasonIndex === 690)!.headStart).toBe(0);
  });
});

describe('seasonPoints', () => {
  it('is zero before the season is rolled', () => {
    expect(seasonPoints(ctx, 'p')).toBe(0);
  });

  it('counts only the delta since the baseline', () => {
    track(ctx, 'p', 'expeditions_claimed', 4);   // pre-season history
    rollSeason(ctx, 'p');
    expect(seasonPoints(ctx, 'p')).toBe(0);
    track(ctx, 'p', 'expeditions_claimed', 3);   // 3 x 5 = 15
    expect(seasonPoints(ctx, 'p')).toBe(15);
  });

  it('adds the frozen head start to the live delta', () => {
    // battleProgress.stars is capped 0-3 per row by stars_range — spread the
    // headline total across synthetic stage rows via the shared helper above.
    seedStars(10);
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 2);   // 10
    expect(seasonPoints(ctx, 'p')).toBe(20);
  });

  it('clamps each source at its cap, so one grind cannot carry a player', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'dinos_fed', 100_000);
    expect(seasonPoints(ctx, 'p')).toBe(120);
  });

  // adminReset deletes user_stats but the baseline row may survive a step behind, which
  // would make current - baseline negative.
  it('clamps a negative delta at zero rather than subtracting', () => {
    track(ctx, 'p', 'dinos_fed', 300);
    rollSeason(ctx, 'p');
    ctx.db.delete(schema.userStats).where(eq(schema.userStats.userId, 'p')).run();
    expect(seasonPoints(ctx, 'p')).toBe(0);
  });

  it('never derives points for a past season', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);
    expect(seasonPoints(ctx, 'p')).toBe(50);
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    // The counter kept its value, but the new season's baseline absorbed it.
    expect(seasonPoints(ctx, 'p')).toBe(0);
  });
});

describe('seasonView', () => {
  it('is null before the season is rolled', () => {
    expect(seasonView(ctx, 'p')).toBeNull();
  });

  it('reports the season’s identity and remaining days', () => {
    rollSeason(ctx, 'p');
    const v = seasonView(ctx, 'p')!;
    expect(v.index).toBe(689);
    expect(v.number).toBe(1);
    expect(v.dayOfSeason).toBe(1);
    expect(v.daysLeft).toBe(30);
    ctx.setNow(S1 + 29 * DAY);
    expect(seasonView(ctx, 'p')!.daysLeft).toBe(1);
  });

  it('breaks points down per source, in ladder order', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'battles_fought', 8);        // 2
    track(ctx, 'p', 'expeditions_claimed', 1);   // 5
    const v = seasonView(ctx, 'p')!;
    expect(v.breakdown.map((b) => b.source.id).slice(0, 2)).toEqual(['campaign', 'expeditions']);
    expect(v.breakdown.find((b) => b.source.id === 'campaign')!.points).toBe(2);
    expect(v.breakdown.find((b) => b.source.id === 'expeditions')!.points).toBe(5);
    expect(v.points).toBe(7);
  });

  it('marks rungs unlocked at or above their threshold', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);  // 50 — exactly rung 1
    const v = seasonView(ctx, 'p')!;
    expect(v.rungs[0].unlocked).toBe(true);
    expect(v.rungs[0].claimed).toBe(false);
    expect(v.rungs[1].unlocked).toBe(false);
    expect(v.rungs.map((r) => r.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  // claimed has only ever been asserted false up to this point — nothing wrote a
  // season_claims row yet. This is the first test to exercise the true branch, which is
  // exactly what would catch claimSeason writing a 1-based rung against this 0-based read.
  it('reports a claimed rung as claimed and a later one as still unclaimed', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 20);  // 100 -- rung 1 unlocked, rung 2 not
    claimSeason(ctx, 'p');
    const v = seasonView(ctx, 'p')!;
    expect(v.rungs[0].claimed).toBe(true);
    expect(v.rungs[1].claimed).toBe(false);
  });
});

const cash = (userId = 'p') => ctx.db.select().from(schema.users)
  .where(eq(schema.users.discordId, userId)).get()!.cash;
const claimRows = () => ctx.db.select().from(schema.seasonClaims)
  .where(eq(schema.seasonClaims.userId, 'p')).all();

describe('claimSeason', () => {
  it('pays nothing and writes nothing when no rung is unlocked', () => {
    rollSeason(ctx, 'p');
    const before = cash();
    const res = claimSeason(ctx, 'p');
    expect(res.claimed).toEqual([]);
    expect(res.rewards.cash).toBe(0);
    expect(cash()).toBe(before);
    expect(claimRows()).toHaveLength(0);
    expect(ctx.db.select().from(schema.txLog).all()).toHaveLength(0);
  });

  it('pays every unlocked rung at once and records each', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 45);   // 225 = rungs 1,2,3
    const before = cash();
    const res = claimSeason(ctx, 'p');
    expect(res.claimed.map((c) => c.idx)).toEqual([0, 1, 2]);
    expect(res.rewards.cash).toBe(3_000 + 6_000 + 8_000);
    expect(res.rewards.shards).toBe(15);
    expect(res.rewards.foods.royal_greens).toBe(20);
    expect(cash()).toBe(before + 17_000);
    expect(claimRows().map((r) => r.rung).sort()).toEqual([0, 1, 2]);
  });

  it('is idempotent — a second claim pays nothing', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    claimSeason(ctx, 'p');
    const after = cash();
    const res = claimSeason(ctx, 'p');
    expect(res.claimed).toEqual([]);
    expect(cash()).toBe(after);
    expect(claimRows()).toHaveLength(1);
  });

  it('grants egg rungs as real egg rows', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);   // 250 -> not yet rung 4
    track(ctx, 'p', 'battles_fought', 400);       // +100 = 350 = rung 4
    const res = claimSeason(ctx, 'p');
    expect(res.eggs).toEqual(['rare']);
    const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).all();
    expect(eggs).toHaveLength(1);
    expect(eggs[0].rarity).toBe('rare');
    expect(eggs[0].source).toBe('quest');
  });

  it('writes exactly one tx_log row for the cash and shard pair', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 45);
    claimSeason(ctx, 'p');
    const logs = ctx.db.select().from(schema.txLog).all()
      .filter((r) => r.reason === 'season:rungs' && r.foodId === null);
    expect(logs).toHaveLength(1);
    expect(logs[0].cashDelta).toBe(17_000);
  });

  // Forfeiture: rungs belong to the season they were unlocked in.
  it('cannot claim a previous season’s rungs after rollover', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1, never claimed
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    const before = cash();
    expect(claimSeason(ctx, 'p').claimed).toEqual([]);
    expect(cash()).toBe(before);
  });
});

import { stampSeasonBadge, seasonBadges } from '../src/modules/daily/season.js';

const badgeAt = (index = 689) => ctx.db.select().from(schema.seasonProgress)
  .where(and(eq(schema.seasonProgress.userId, 'p'), eq(schema.seasonProgress.seasonIndex, index)))
  .get()!.badgeAt;

describe('stampSeasonBadge', () => {
  it('does nothing below the capstone', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);   // 250
    expect(stampSeasonBadge(ctx, 'p')).toBe(false);
    expect(badgeAt()).toBeNull();
  });

  it('stamps once on crossing and is idempotent afterwards', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);   // 250
    track(ctx, 'p', 'battles_fought', 1000);      // +250 = 500
    track(ctx, 'p', 'eggs_hatched', 75);          // +225 = 725
    track(ctx, 'p', 'dinos_fed', 360);            // +120 = 845 >= 800
    ctx.setNow(S1 + 3 * DAY);
    expect(stampSeasonBadge(ctx, 'p')).toBe(true);
    expect(badgeAt()).toBe(S1 + 3 * DAY);
    ctx.setNow(S1 + 4 * DAY);
    expect(stampSeasonBadge(ctx, 'p')).toBe(false);
    expect(badgeAt()).toBe(S1 + 3 * DAY);          // never re-stamped
  });

  it('no-ops when the season has not been rolled', () => {
    expect(stampSeasonBadge(ctx, 'p')).toBe(false);
  });

  // THE §9 DECISION'S GATE. Cash forfeits at rollover; the badge does not, because a
  // badge is re-earnable by nothing and a missed button must not put a permanent hole in
  // the collection.
  it('a badge survives an unclaimed rung 8 across the rollover', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);
    track(ctx, 'p', 'battles_fought', 1000);
    track(ctx, 'p', 'eggs_hatched', 75);
    track(ctx, 'p', 'dinos_fed', 360);
    stampSeasonBadge(ctx, 'p');
    const before = cash();
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    expect(claimSeason(ctx, 'p').claimed).toEqual([]);   // consumables forfeited
    expect(cash()).toBe(before);
    expect(badgeAt(689)).not.toBeNull();                 // badge kept
    expect(seasonBadges(ctx, 'p').count).toBe(1);
  });
});

describe('seasonBadges', () => {
  it('counts badged seasons and names the latest', () => {
    expect(seasonBadges(ctx, 'p')).toEqual({ count: 0, latest: null });
    rollSeason(ctx, 'p');
    ctx.db.update(schema.seasonProgress).set({ badgeAt: S1 })
      .where(and(eq(schema.seasonProgress.userId, 'p'),
                 eq(schema.seasonProgress.seasonIndex, 689))).run();
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    expect(seasonBadges(ctx, 'p')).toEqual({ count: 1, latest: 689 });
    ctx.db.update(schema.seasonProgress).set({ badgeAt: S2 })
      .where(and(eq(schema.seasonProgress.userId, 'p'),
                 eq(schema.seasonProgress.seasonIndex, 690))).run();
    expect(seasonBadges(ctx, 'p')).toEqual({ count: 2, latest: 690 });
  });

  it('is a pure read — it never stamps', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);
    track(ctx, 'p', 'battles_fought', 1000);
    track(ctx, 'p', 'eggs_hatched', 75);
    track(ctx, 'p', 'dinos_fed', 360);
    expect(seasonBadges(ctx, 'p').count).toBe(0);
    expect(badgeAt()).toBeNull();
  });
});
