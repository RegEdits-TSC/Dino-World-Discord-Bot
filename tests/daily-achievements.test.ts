import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { achievementsView, claimAchievements, earnedTierCount } from '../src/modules/daily/service.js';

type TestCtx = ReturnType<typeof makeCtx>;

function txRows(ctx: TestCtx, userId: string, reason?: string) {
  const rows = ctx.db.select().from(schema.txLog).where(eq(schema.txLog.userId, userId)).all();
  return reason ? rows.filter((r) => r.reason === reason) : rows;
}

function claimRows(ctx: TestCtx, userId: string) {
  return ctx.db.select().from(schema.achievementClaims).where(eq(schema.achievementClaims.userId, userId)).all();
}

describe('achievementsView: derived tier state', () => {
  it('eggs_hatched at 60 makes tiers 0 and 1 claimable, not 2 or 3', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    track(ctx, 'u1', 'eggs_hatched', 60);

    const view = achievementsView(ctx, 'u1').find((v) => v.def.id === 'eggs_hatched')!;
    expect(view.value).toBe(60);
    expect(view.claimable).toEqual([0, 1]);
    expect(view.claimedTiers.size).toBe(0);
  });

  it('a backfilled veteran with lots_built seeded directly can claim bronze immediately', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    // Mirrors migration 0006's backfill: a user_stats row inserted directly, never
    // accrued through track() — achievementsView must not care how the counter got there.
    ctx.db.insert(schema.userStats).values({ userId: 'u1', stat: 'lots_built', value: 3 }).run();

    const view = achievementsView(ctx, 'u1').find((v) => v.def.id === 'lots_built')!;
    expect(view.claimable).toEqual([0]);
  });

  it('returns all 12 tracks in ACHIEVEMENTS order even with no stats at all', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    const views = achievementsView(ctx, 'u1');
    expect(views).toHaveLength(12);
    expect(views.every((v) => v.value === 0 && v.claimable.length === 0)).toBe(true);
  });
});

describe('claimAchievements: claim-all in one transaction', () => {
  it('pays the summed tier rewards, writes one claim row per tier and exactly one tx_log row, then a second claim pays nothing', () => {
    const ctx = makeCtx({ nowMs: 1000 });
    getOrCreateUser(ctx, 'u1', 'U1');
    track(ctx, 'u1', 'eggs_hatched', 60);

    const result = claimAchievements(ctx, 'u1');
    expect(result.claimed).toEqual([
      { trackId: 'eggs_hatched', tier: 0 },
      { trackId: 'eggs_hatched', tier: 1 },
    ]);
    expect(result.cash).toBe(1750); // 500 + 1250
    expect(result.shards).toBe(0);

    expect(claimRows(ctx, 'u1')).toHaveLength(2);
    expect(txRows(ctx, 'u1', 'quest:achievements')).toHaveLength(1);

    const second = claimAchievements(ctx, 'u1');
    expect(second).toEqual({ claimed: [], cash: 0, shards: 0 });
    expect(txRows(ctx, 'u1')).toHaveLength(1); // no new tx_log rows from the second, empty claim
    expect(claimRows(ctx, 'u1')).toHaveLength(2); // no new claim rows either
  });

  it('crossing a higher threshold later pays only the new tier, never re-paying earlier ones', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    track(ctx, 'u1', 'eggs_hatched', 60);
    claimAchievements(ctx, 'u1'); // banks tiers 0 and 1

    track(ctx, 'u1', 'eggs_hatched', 140); // total 200 -> tier 2 (200) newly unlocked
    const result = claimAchievements(ctx, 'u1');
    expect(result.claimed).toEqual([{ trackId: 'eggs_hatched', tier: 2 }]);
    expect(result.cash).toBe(2500);
    expect(result.shards).toBe(5);
    expect(claimRows(ctx, 'u1')).toHaveLength(3);
  });

  it('two tracks with claimable tiers both pay in a single claim-all', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    track(ctx, 'u1', 'eggs_hatched', 10); // tier 0 only
    track(ctx, 'u1', 'dinos_fed', 25); // tier 0 only

    const result = claimAchievements(ctx, 'u1');
    expect(result.claimed).toHaveLength(2);
    expect(result.claimed.map((c) => c.trackId).sort()).toEqual(['dinos_fed', 'eggs_hatched']);
    expect(result.cash).toBe(1000); // 500 + 500
    expect(txRows(ctx, 'u1', 'quest:achievements')).toHaveLength(1);
    expect(claimRows(ctx, 'u1')).toHaveLength(2);
  });

  it('an empty claim writes nothing: no economy.apply, no claim rows, no tx_log entry', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    // Nothing tracked -> nothing claimable anywhere.
    const result = claimAchievements(ctx, 'u1');
    expect(result).toEqual({ claimed: [], cash: 0, shards: 0 });
    expect(txRows(ctx, 'u1')).toHaveLength(0);
    expect(claimRows(ctx, 'u1')).toHaveLength(0);
  });
});

describe('earnedTierCount', () => {
  it('reflects claimed tiers, rising from 0 to 2 to 3 across claims', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    expect(earnedTierCount(ctx, 'u1')).toBe(0);

    track(ctx, 'u1', 'eggs_hatched', 60);
    claimAchievements(ctx, 'u1'); // tiers 0, 1
    expect(earnedTierCount(ctx, 'u1')).toBe(2);

    track(ctx, 'u1', 'eggs_hatched', 140); // total 200 -> tier 2
    claimAchievements(ctx, 'u1');
    expect(earnedTierCount(ctx, 'u1')).toBe(3);
  });
});
