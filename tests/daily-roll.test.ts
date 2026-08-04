import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { dayKeyUTC, DAY_MS } from '../src/core/clock.js';
import { QUESTS, CHURN_STATS } from '../src/data/quests.js';
import { RARITY } from '../src/data/rarity.js';
import { TRADE_MIN_RATING } from '../src/data/trade.js';
import { rollDailyQuests, questProgress, dailyEarningCapacity } from '../src/modules/daily/service.js';

type TestCtx = ReturnType<typeof makeCtx>;
type QuestRow = typeof schema.dailyQuests.$inferSelect;

function rowsFor(ctx: TestCtx, userId: string): QuestRow[] {
  return ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, userId)).all();
}

function defFor(row: QuestRow) {
  return QUESTS.find((q) => q.id === row.questId);
}

function assignDino(
  ctx: TestCtx, userId: string, speciesId: string, over: Partial<typeof schema.dinos.$inferInsert> = {},
) {
  const lot = ctx.db.insert(schema.lots)
    .values({ userId, type: 'paddock', kind: 'carnivore_paddock', name: 'Pen' }).returning().get();
  return ctx.db.insert(schema.dinos)
    .values({ userId, lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over })
    .returning().get();
}

// Board composition is seed-determined (hash(userId + dayKey)). Rather than assume a
// specific def lands, spin up a fresh ctx + fresh userId per try, apply `setup`, roll,
// and keep the first candidate whose board satisfies `matches` — determinism means
// whichever seed is found here stays found forever.
function findRoll(
  setup: (ctx: TestCtx, userId: string) => void,
  matches: (row: QuestRow) => boolean,
  maxTries = 300,
): { ctx: TestCtx; userId: string; rows: QuestRow[]; row: QuestRow } | null {
  for (let i = 0; i < maxTries; i++) {
    const userId = `seek-${i}`;
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, userId, userId);
    setup(ctx, userId);
    rollDailyQuests(ctx, userId);
    const rows = rowsFor(ctx, userId);
    const hit = rows.find(matches);
    if (hit) return { ctx, userId, rows, row: hit };
  }
  return null;
}

describe('rollDailyQuests: determinism', () => {
  it('rolls identical (questId, slot) triples for the same user and day across independent ctx instances', () => {
    const ctxA = makeCtx({ nowMs: 1_000_000 });
    const ctxB = makeCtx({ nowMs: 1_000_000 });
    getOrCreateUser(ctxA, 'u1', 'U1');
    getOrCreateUser(ctxB, 'u1', 'U1');
    rollDailyQuests(ctxA, 'u1');
    rollDailyQuests(ctxB, 'u1');
    const a = rowsFor(ctxA, 'u1').map((r) => [r.questId, r.slot]);
    const b = rowsFor(ctxB, 'u1').map((r) => [r.questId, r.slot]);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });

  it('rolls a different board on a different day for at least one of several users', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const users = ['a', 'b', 'c', 'd', 'e'];
    for (const u of users) getOrCreateUser(ctx, u, u);
    for (const u of users) rollDailyQuests(ctx, u);
    const day1 = new Map(users.map((u) => [u, rowsFor(ctx, u).map((r) => `${r.questId}:${r.slot}`)]));
    ctx.setNow(DAY_MS);
    for (const u of users) rollDailyQuests(ctx, u);
    const day2 = new Map(users.map((u) => [u, rowsFor(ctx, u).map((r) => `${r.questId}:${r.slot}`)]));
    const anyDifferent = users.some((u) => day1.get(u)!.join(',') !== day2.get(u)!.join(','));
    expect(anyDifferent).toBe(true);
  });
});

describe('rollDailyQuests: roller hard rules', () => {
  it('never breaks a hard rule across 30 seeded boards', () => {
    const ctx = makeCtx({ nowMs: 0 });
    for (let i = 0; i < 30; i++) {
      const userId = `hardrule-${i}`;
      getOrCreateUser(ctx, userId, userId);
      rollDailyQuests(ctx, userId);
      const defs = rowsFor(ctx, userId).map((r) => defFor(r)!);
      expect(defs).toHaveLength(3);
      // (a) no two slots share a stat
      expect(new Set(defs.map((d) => d.stat)).size).toBe(defs.length);
      // (b) at most one churn-stat def
      expect(defs.filter((d) => CHURN_STATS.includes(d.stat)).length).toBeLessThanOrEqual(1);
      // (c) at most one food-paying def
      expect(defs.filter((d) => d.rewards.food).length).toBeLessThanOrEqual(1);
    }
  });
});

describe('rollDailyQuests: eligibility', () => {
  it('never rolls a gated def for a brand-new user (no dinos, battles, gene lab, or rating)', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'newbie', 'Newbie');
    rollDailyQuests(ctx, 'newbie');
    const defs = rowsFor(ctx, 'newbie').map((r) => defFor(r)!);
    expect(defs).toHaveLength(3);
    for (const d of defs) expect(d.requirement).toBe('none');
  });

  it('a battle_progress row unlocks battle-requirement defs (searched across 30 days)', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'battler', 'Battler');
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'battler', stageId: 'coastal_dig_1', stars: 1, attempts: 1 }).run();
    let foundBattleDef = false;
    for (let day = 0; day < 30 && !foundBattleDef; day++) {
      ctx.setNow(day * DAY_MS);
      rollDailyQuests(ctx, 'battler');
      foundBattleDef = rowsFor(ctx, 'battler').some((r) => defFor(r)?.requirement === 'battles');
    }
    expect(foundBattleDef).toBe(true);
  });

  it('a dino assigned to a lot (even escaped) unlocks income-requirement defs', () => {
    const found = findRoll(
      (ctx, userId) => { assignDino(ctx, userId, 'triceratops', { escapedAt: 1 }); },
      (row) => defFor(row)?.requirement === 'income',
    );
    expect(found).not.toBeNull();
  });

  it('ratingHighWater at the trade minimum unlocks the trading-requirement def', () => {
    const found = findRoll(
      (ctx, userId) => {
        ctx.db.update(schema.users).set({ ratingHighWater: TRADE_MIN_RATING })
          .where(eq(schema.users.discordId, userId)).run();
      },
      (row) => row.questId === 'trade_1',
    );
    expect(found).not.toBeNull();
  });

  it('a built Gene Lab unlocks genelab-requirement defs', () => {
    const found = findRoll(
      (ctx, userId) => {
        ctx.db.insert(schema.lots).values({ userId, type: 'facility', kind: 'gene_lab', name: 'Gene Lab' }).run();
      },
      (row) => defFor(row)?.requirement === 'genelab',
    );
    expect(found).not.toBeNull();
  });
});

describe('rollDailyQuests: baseline snapshot', () => {
  it('baseline is the pre-roll counter value for every rolled def, generically', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    track(ctx, 'u1', 'dinos_fed', 5);
    track(ctx, 'u1', 'expeditions_claimed', 2);
    rollDailyQuests(ctx, 'u1');
    const before: Record<string, number> = { dinos_fed: 5, expeditions_claimed: 2 };
    for (const row of rowsFor(ctx, 'u1')) {
      const def = defFor(row)!;
      expect(row.baseline).toBe(before[def.stat] ?? 0);
    }
  });

  it('a rolled dinos_fed def snapshots baseline 5 and reads progress 0 (found by seed search)', () => {
    const found = findRoll(
      (ctx, userId) => track(ctx, userId, 'dinos_fed', 5),
      (row) => defFor(row)?.stat === 'dinos_fed',
    );
    expect(found).not.toBeNull();
    const { ctx, userId, row } = found!;
    expect(row.baseline).toBe(5);
    const view = questProgress(ctx, userId).find((v) => v.row.id === row.id)!;
    expect(view.progress).toBe(0);
    expect(view.complete).toBe(false);
  });

  it('a missing user_stats row reads baseline 0 and progress 0, never NaN', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'freshie', 'Freshie');
    rollDailyQuests(ctx, 'freshie');
    const rows = rowsFor(ctx, 'freshie');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.baseline).toBe(0);
    const views = questProgress(ctx, 'freshie');
    expect(views).toHaveLength(3);
    for (const v of views) {
      expect(v.progress).toBe(0);
      expect(Number.isNaN(v.progress)).toBe(false);
    }
  });
});

describe('rollDailyQuests: collect_cash roll-computed target', () => {
  it('clamps to a 500 floor for a tiny park (found by seed search)', () => {
    const found = findRoll(
      (ctx, userId) => assignDino(ctx, userId, 'triceratops'),
      (row) => row.questId === 'collect_cash',
    );
    expect(found).not.toBeNull();
    const { ctx, userId, row } = found!;
    const hourly = RARITY.common.incomePerHr;
    const capacity = dailyEarningCapacity(ctx, userId);
    expect(capacity).toBe(hourly * 8);   // one assigned common dino, default 8h cap
    const expected = Math.max(500, Math.min(50_000, Math.round(capacity / 2)));
    expect(expected).toBe(500);
    expect(row.target).toBe(500);
  });

  it('clamps to a 50000 ceiling for a huge park (found by seed search)', () => {
    const found = findRoll(
      (ctx, userId) => { assignDino(ctx, userId, 'indominus'); assignDino(ctx, userId, 'indoraptor'); },
      (row) => row.questId === 'collect_cash',
    );
    expect(found).not.toBeNull();
    const { ctx, userId, row } = found!;
    const capacity = dailyEarningCapacity(ctx, userId);
    expect(Math.round(capacity / 2)).toBeGreaterThan(50_000);
    expect(row.target).toBe(50_000);
  });
});

describe('rollDailyQuests: prior-day cleanup and idempotence', () => {
  it('deletes prior-day rows when rolling on a new day', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    rollDailyQuests(ctx, 'u1');
    expect(rowsFor(ctx, 'u1')).toHaveLength(3);
    ctx.setNow(DAY_MS);
    rollDailyQuests(ctx, 'u1');
    const rows = rowsFor(ctx, 'u1');
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.dayKey === dayKeyUTC(0))).toBe(false);
    expect(rows.every((r) => r.dayKey === dayKeyUTC(DAY_MS))).toBe(true);
  });

  it('is idempotent: a second roll the same day inserts nothing new', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    rollDailyQuests(ctx, 'u1');
    const first = rowsFor(ctx, 'u1');
    rollDailyQuests(ctx, 'u1');
    const second = rowsFor(ctx, 'u1');
    expect(second).toEqual(first);
  });

  it('is a silent no-op when the users row does not exist', () => {
    const ctx = makeCtx({ nowMs: 0 });
    expect(() => rollDailyQuests(ctx, 'ghost')).not.toThrow();
    expect(ctx.db.select().from(schema.dailyQuests).all()).toHaveLength(0);
  });
});

describe('questProgress', () => {
  it('omits rows whose questId has no live def', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    ctx.db.insert(schema.dailyQuests)
      .values({ userId: 'u1', dayKey: dayKeyUTC(0), slot: 0, questId: 'retired_quest', baseline: 0, target: 3 })
      .run();
    const views = questProgress(ctx, 'u1');
    expect(views.find((v) => v.row.questId === 'retired_quest')).toBeUndefined();
  });
});

describe('dailyEarningCapacity', () => {
  it('sums assigned non-escaped dinos hourly rate over capHours, excluding escaped and unassigned dinos', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    assignDino(ctx, 'u1', 'triceratops');
    assignDino(ctx, 'u1', 'triceratops', { escapedAt: 1 });
    ctx.db.insert(schema.dinos)
      .values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    expect(dailyEarningCapacity(ctx, 'u1')).toBe(RARITY.common.incomePerHr * 8);
  });

  it('is 0 for a user with no dinos', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'U1');
    expect(dailyEarningCapacity(ctx, 'u1')).toBe(0);
  });
});
