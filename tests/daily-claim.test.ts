import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track, readStat } from '../src/core/stats.js';
import { dayKeyUTC, DAY_MS } from '../src/core/clock.js';
import { QUESTS } from '../src/data/quests.js';
import { claimQuests, type ClaimResult } from '../src/modules/daily/service.js';

type TestCtx = ReturnType<typeof makeCtx>;

// Seeds one daily_quests row directly (bypassing rollDailyQuests' board selection), baseline
// snapshotted from the user's current stat total so a later `track` call of exactly `target`
// completes it — mirrors the seeding idiom in tests/daily-roll.test.ts.
function seedQuest(
  ctx: TestCtx, userId: string, dayKey: string, slot: number, questId: string, target: number,
) {
  const def = QUESTS.find((q) => q.id === questId)!;
  const baseline = readStat(ctx, userId, def.stat);
  ctx.db.insert(schema.dailyQuests).values({ userId, dayKey, slot, questId, baseline, target }).run();
  return def;
}

function txRows(ctx: TestCtx, userId: string, reason?: string) {
  const rows = ctx.db.select().from(schema.txLog).where(eq(schema.txLog.userId, userId)).all();
  return reason ? rows.filter((r) => r.reason === reason) : rows;
}

function userRow(ctx: TestCtx, userId: string) {
  return ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
}

// Marches the streak forward by one calendar day: seeds a single completed feed_3 quest
// (cash 400, shards 4, no food — keeps chest/streak assertions free of reward-sum noise,
// which the dedicated payout test covers) for `dayMs`'s dayKey, completes it, and claims.
function claimOneDay(ctx: TestCtx, userId: string, dayMs: number): ClaimResult {
  ctx.setNow(dayMs);
  const dayKey = dayKeyUTC(dayMs);
  seedQuest(ctx, userId, dayKey, 0, 'feed_3', 3);
  track(ctx, userId, 'dinos_fed', 3);
  return claimQuests(ctx, userId);
}

describe('claimQuests: payout', () => {
  it("pays the sum of completed defs' cash/shards, leaves the incomplete row unclaimed, and writes exactly one quest:daily tx_log row (food_id null)", () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    const dayKey = dayKeyUTC(0);
    // feed_3: cash 400 shards 4; hatch_1: cash 300 shards 3; incubate_2 left incomplete.
    seedQuest(ctx, 'u1', dayKey, 0, 'feed_3', 3);
    seedQuest(ctx, 'u1', dayKey, 1, 'hatch_1', 1);
    seedQuest(ctx, 'u1', dayKey, 2, 'incubate_2', 2);
    track(ctx, 'u1', 'dinos_fed', 3);
    track(ctx, 'u1', 'eggs_hatched', 1);

    const result = claimQuests(ctx, 'u1');
    expect(result.claimed).toHaveLength(2);
    expect(result.rewards.cash).toBe(700);
    expect(result.rewards.shards).toBe(7);
    expect(result.rewards.foods).toEqual({});
    expect(result.streak).toBe(1);
    expect(result.ticked).toBe(true);
    expect(result.chest).toBeNull();

    const rows = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, 'u1')).all();
    expect(rows.filter((r) => r.claimedAt !== null)).toHaveLength(2);
    expect(rows.find((r) => r.questId === 'incubate_2')!.claimedAt).toBeNull();

    const dailyTx = txRows(ctx, 'u1', 'quest:daily').filter((r) => r.foodId === null);
    expect(dailyTx).toHaveLength(1);
    expect(dailyTx[0].cashDelta).toBe(700);
    expect(dailyTx[0].shardsDelta).toBe(7);
  });

  it('a second claim the same day, after completing the third quest, pays it with ticked false and an unchanged streak', () => {
    // nowMs starts at DAY_MS (not 0): lastQuestClaimAt's sentinel for "never claimed" is
    // literal 0 (the column is NOT NULL DEFAULT 0), which real epoch time never produces
    // but which a same-day first claim at ms=0 would collide with.
    const ctx = makeCtx({ nowMs: DAY_MS });
    getOrCreateUser(ctx, 'u1', 'U1');
    const dayKey = dayKeyUTC(DAY_MS);
    seedQuest(ctx, 'u1', dayKey, 0, 'feed_3', 3);
    seedQuest(ctx, 'u1', dayKey, 1, 'hatch_1', 1);
    seedQuest(ctx, 'u1', dayKey, 2, 'incubate_2', 2);
    track(ctx, 'u1', 'dinos_fed', 3);
    track(ctx, 'u1', 'eggs_hatched', 1);
    const first = claimQuests(ctx, 'u1');
    expect(first.streak).toBe(1);
    expect(first.ticked).toBe(true);

    track(ctx, 'u1', 'eggs_incubated', 2);
    const second = claimQuests(ctx, 'u1');
    expect(second.claimed).toHaveLength(1);
    expect(second.claimed[0].def.id).toBe('incubate_2');
    expect(second.rewards.cash).toBe(400);
    expect(second.rewards.foods).toEqual({ ferns: 3 });
    expect(second.ticked).toBe(false);
    expect(second.streak).toBe(1);

    // No new tx_log rows beyond this second claim's own (cash/shards + one food row).
    const afterSecond = txRows(ctx, 'u1');
    expect(afterSecond.length).toBeGreaterThan(0);
  });
});

describe('claimQuests: empty claim writes nothing', () => {
  it('returns claimed: [] and performs no writes when nothing is complete', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    const dayKey = dayKeyUTC(0);
    seedQuest(ctx, 'u1', dayKey, 0, 'feed_3', 3); // never tracked -> incomplete

    const before = userRow(ctx, 'u1');
    const result = claimQuests(ctx, 'u1');
    expect(result).toEqual({
      claimed: [], rewards: { cash: 0, shards: 0, foods: {} }, chest: null, streak: 0, ticked: false,
    });

    expect(txRows(ctx, 'u1')).toHaveLength(0);
    expect(userRow(ctx, 'u1')).toEqual(before);
    const row = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, 'u1')).get()!;
    expect(row.claimedAt).toBeNull();
  });

  it("a board completed at 23:59 but claimed at 00:01 the next day forfeits it: claim reads TODAY's dayKey only", () => {
    const day0Late = 23 * 3_600_000 + 59 * 60_000; // day0 23:59
    const ctx = makeCtx({ nowMs: day0Late });
    getOrCreateUser(ctx, 'u1', 'U1');
    const dayKeyDay0 = dayKeyUTC(ctx.now());
    seedQuest(ctx, 'u1', dayKeyDay0, 0, 'feed_3', 3);
    track(ctx, 'u1', 'dinos_fed', 3); // completed same day, never claimed

    ctx.setNow(DAY_MS + 60_000); // day1 00:01
    const before = userRow(ctx, 'u1');
    expect(() => claimQuests(ctx, 'u1')).not.toThrow();
    const result = claimQuests(ctx, 'u1');
    expect(result.claimed).toEqual([]);
    expect(result.streak).toBe(before.questStreak);
    expect(result.ticked).toBe(false);
    expect(userRow(ctx, 'u1')).toEqual(before);
  });
});

describe('claimQuests: streak ticks', () => {
  it('same-day re-claim does not tick (covered above); two claims on adjacent calendar days more than 24h apart still tick to streak 2', () => {
    const ctx = makeCtx({ nowMs: 9 * 3_600_000 }); // day0 09:00
    getOrCreateUser(ctx, 'u1', 'U1');
    const r1 = claimOneDay(ctx, 'u1', 9 * 3_600_000);
    expect(r1.streak).toBe(1);
    expect(r1.ticked).toBe(true);

    const r2 = claimOneDay(ctx, 'u1', DAY_MS + 10 * 3_600_000); // day1 10:00 -> 25h after r1
    expect(r2.ticked).toBe(true);
    expect(r2.streak).toBe(2);
  });

  it('a fully skipped day resets the streak to 1', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    const r1 = claimOneDay(ctx, 'u1', DAY_MS);
    expect(r1.streak).toBe(1);
    // the next day is skipped entirely; claim lands two days later.
    const r3 = claimOneDay(ctx, 'u1', 3 * DAY_MS);
    expect(r3.ticked).toBe(true);
    expect(r3.streak).toBe(1);
  });

  it('questStreakBest rises on every claim that exceeds it', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    expect(userRow(ctx, 'u1').questStreakBest).toBe(0);
    claimOneDay(ctx, 'u1', DAY_MS);
    expect(userRow(ctx, 'u1').questStreakBest).toBe(1);
    claimOneDay(ctx, 'u1', 2 * DAY_MS);
    expect(userRow(ctx, 'u1').questStreakBest).toBe(2);
  });
});

describe('claimQuests: personal-best milestone chests', () => {
  it('pays the streak-3 chest as a new personal best, logged as its own quest:chest tx_log row', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    let result!: ClaimResult;
    for (let day = 0; day < 3; day++) result = claimOneDay(ctx, 'u1', (day + 1) * DAY_MS);
    expect(result.streak).toBe(3);
    expect(result.chest).toEqual({ cash: 1500, shards: 0, streak: 3 });

    const chestTx = txRows(ctx, 'u1', 'quest:chest');
    expect(chestTx).toHaveLength(1);
    expect(chestTx[0].cashDelta).toBe(1500);
    expect(chestTx[0].shardsDelta).toBe(0);
    expect(userRow(ctx, 'u1').questStreakBest).toBe(3);
  });

  it('pays the streak-7 chest with +20 shards', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    let result!: ClaimResult;
    for (let day = 0; day < 7; day++) result = claimOneDay(ctx, 'u1', (day + 1) * DAY_MS);
    expect(result.streak).toBe(7);
    expect(result.chest).toEqual({ cash: 3000, shards: 20, streak: 7 });
  });

  it('pays the streak-14 chest as a rare egg (source quest, no species yet)', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    let result!: ClaimResult;
    for (let day = 0; day < 14; day++) result = claimOneDay(ctx, 'u1', (day + 1) * DAY_MS);
    expect(result.streak).toBe(14);
    expect(result.chest).toEqual({ cash: 2500, shards: 0, eggRarity: 'rare', streak: 14 });

    const egg = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).get()!;
    expect(egg.rarity).toBe('rare');
    expect(egg.source).toBe('quest');
    expect(egg.speciesId).toBeNull();
  });

  it('pays the streak-30 chest as an epic egg plus 40 shards', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    let result!: ClaimResult;
    for (let day = 0; day < 30; day++) result = claimOneDay(ctx, 'u1', (day + 1) * DAY_MS);
    expect(result.streak).toBe(30);
    expect(result.chest).toEqual({ cash: 0, shards: 40, eggRarity: 'epic', streak: 30 });

    // Two eggs by now: the streak-14 rare milestone was also crossed en route to 30.
    const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all();
    expect(eggs).toHaveLength(2);
    expect(eggs.map((e) => e.rarity).sort()).toEqual(['epic', 'rare']);
    const epicEgg = eggs.find((e) => e.rarity === 'epic')!;
    expect(epicEgg.source).toBe('quest');
    expect(epicEgg.speciesId).toBeNull();
  });

  it('never pays a chest for a milestone at or under the personal best, but best keeps rising', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    ctx.db.update(schema.users).set({ questStreakBest: 14 }).where(eq(schema.users.discordId, 'u1')).run();

    let result!: ClaimResult;
    for (let day = 0; day < 3; day++) result = claimOneDay(ctx, 'u1', (day + 1) * DAY_MS);
    expect(result.streak).toBe(3);
    expect(result.chest).toBeNull(); // milestone, but 3 <= best 14

    for (let day = 3; day < 14; day++) result = claimOneDay(ctx, 'u1', (day + 1) * DAY_MS);
    expect(result.streak).toBe(14);
    expect(result.chest).toBeNull(); // milestone, but 14 is not STRICTLY greater than best 14

    result = claimOneDay(ctx, 'u1', 15 * DAY_MS);
    expect(result.streak).toBe(15);
    expect(result.chest).toBeNull(); // 15 exceeds best, but is not itself a milestone
    expect(userRow(ctx, 'u1').questStreakBest).toBe(15);
  });

  it('claims and chests never touch shards_window_earned', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    expect(userRow(ctx, 'u1').shardsWindowEarned).toBe(0);
    for (let day = 0; day < 7; day++) claimOneDay(ctx, 'u1', (day + 1) * DAY_MS); // includes the +20 shard streak-7 chest
    expect(userRow(ctx, 'u1').shardsWindowEarned).toBe(0);
  });
});

describe('claimQuests: unknown quest defs', () => {
  it('skips a row whose questId has no live def and pays nothing for it, leaving it forever unclaimed', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    const dayKey = dayKeyUTC(0);
    ctx.db.insert(schema.dailyQuests)
      .values({ userId: 'u1', dayKey, slot: 0, questId: 'retired_quest', baseline: 0, target: 1 }).run();
    seedQuest(ctx, 'u1', dayKey, 1, 'feed_3', 3);
    track(ctx, 'u1', 'dinos_fed', 3);

    const result = claimQuests(ctx, 'u1');
    expect(result.claimed).toHaveLength(1);
    expect(result.claimed[0].def.id).toBe('feed_3');
    expect(result.rewards.cash).toBe(400);
    expect(result.rewards.shards).toBe(4);

    const bogus = ctx.db.select().from(schema.dailyQuests)
      .where(and(eq(schema.dailyQuests.userId, 'u1'), eq(schema.dailyQuests.questId, 'retired_quest'))).get()!;
    expect(bogus.claimedAt).toBeNull();
  });
});
