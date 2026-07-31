import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { runFight, BattleError } from '../src/modules/battles/service.js';
import { STAGES } from '../src/data/battle/chapters/index.js';
import { ENERGY_CAP, LEVEL_CAP, STAR_REWARD_MULT, STAR_XP_MULT } from '../src/data/battle/constants.js';

const T0 = 1_000_000;                 // nonzero clock so 0-vs-null timestamp bugs can't hide
const XP_MAX = 999_999;               // past the last LEVEL_XP threshold -> battleLevel caps at LEVEL_CAP
const CH1 = ['coastal_dig_1', 'coastal_dig_2', 'coastal_dig_3', 'coastal_dig_4'];

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(T0); getOrCreateUser(ctx, 'p', 'P'); });

function addDino(
  userId: string, speciesId: string, battleXp = 0, escapedAt: number | null = null, traits: string[] = [],
): number {
  return ctx.db.insert(schema.dinos).values({
    userId, speciesId, hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(), battleXp, escapedAt, traits,
  }).returning().get().id;
}
const user = () => ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
const dinoRow = (id: number) => ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;
const progressRow = (stageId: string) => ctx.db.select().from(schema.battleProgress)
  .where(and(eq(schema.battleProgress.userId, 'p'), eq(schema.battleProgress.stageId, stageId))).get();
const foodQty = (foodId: string) => ctx.db.select().from(schema.foodInventory)
  .where(and(eq(schema.foodInventory.userId, 'p'), eq(schema.foodInventory.foodId, foodId))).get()?.qty ?? 0;
function clearThrough(stageIds: string[]): void {
  for (const stageId of stageIds) ctx.db.insert(schema.battleProgress).values({
    userId: 'p', stageId, stars: 3, firstClearedAt: 1, attempts: 1,
  }).run();
}
const heavies = () => [
  addDino('p', 'tyrannosaurus', XP_MAX),
  addDino('p', 'giganotosaurus', XP_MAX),
  addDino('p', 'spinosaurus', XP_MAX),
];

describe('runFight — happy path', () => {
  it('a winning fight commits energy, rewards, progress, and XP atomically', () => {
    const d = addDino('p', 'tyrannosaurus', XP_MAX);   // level-10 bruiser vs stage-1 NPCs: guaranteed win
    const stage = STAGES.get('coastal_dig_1')!;
    const out = runFight(ctx, 'p', 'coastal_dig_1', [d]);
    expect(out.won).toBe(true);
    expect(out.firstClear).toBe(true);
    expect(out.stageId).toBe('coastal_dig_1');
    expect(out.squad).toEqual([expect.objectContaining({ dinoId: d, speciesId: 'tyrannosaurus', level: LEVEL_CAP })]);
    const u = user();
    expect(u.energy).toBe(ENERGY_CAP - stage.energyCost);
    expect(out.energyAfter).toBe(u.energy);
    expect(u.energyUpdatedAt).toBe(T0);   // was at cap -> settle snapped to now before the spend
    expect(out.energyUpdatedAtMs).toBe(T0);   // settled stamp returned for F4's real countdown
    expect(u.cash).toBe(500 + Math.round(stage.rewards.cash * STAR_REWARD_MULT[out.stars]));
    expect(u.shards).toBe(stage.firstClearShards);
    const row = progressRow('coastal_dig_1')!;
    expect(row.stars).toBe(out.stars);
    expect(row.attempts).toBe(1);
    expect(row.firstClearedAt).toBe(T0);
    expect(out.rewards.xpPerDino).toEqual([Math.round(stage.rewards.xp * STAR_XP_MULT[out.stars])]);
    expect(dinoRow(d).battleXp).toBe(XP_MAX + out.rewards.xpPerDino[0]);
  });

  it('squad XP splits floor-even with the remainder to slot 1', () => {
    clearThrough(['coastal_dig_1']);
    const squad = heavies();
    const stage = STAGES.get('coastal_dig_2')!;
    const foodBefore = foodQty(stage.rewards.food!.foodId);
    const out = runFight(ctx, 'p', 'coastal_dig_2', squad);
    expect(out.won).toBe(true);
    const totalXp = Math.round(stage.rewards.xp * STAR_XP_MULT[out.stars]);
    const baseXp = Math.floor(totalXp / 3);
    expect(totalXp % 3).toBe(2);              // 35 xp: every star tier leaves remainder 2 across 3 dinos
    expect(out.rewards.xpPerDino).toEqual([baseXp + 2, baseXp, baseXp]);
    squad.forEach((id, k) => expect(dinoRow(id).battleXp).toBe(XP_MAX + out.rewards.xpPerDino[k]));
    // Food reward channel: star-scaled qty, actually credited via economy.apply's
    // `foods:` key — dropping either the key or the STAR_REWARD_MULT scaling on
    // qty would pass every other assertion in this file.
    const expectedFoodQty = Math.round(stage.rewards.food!.qty * STAR_REWARD_MULT[out.stars]);
    expect(out.rewards.food).toEqual({ foodId: stage.rewards.food!.foodId, qty: expectedFoodQty });
    expect(foodQty(stage.rewards.food!.foodId)).toBe(foodBefore + expectedFoodQty);
  });

  it('the xp trait scales only that dino\'s own share, not the shared pool before the split', () => {
    clearThrough(['coastal_dig_1']);
    const squad = [
      addDino('p', 'tyrannosaurus', XP_MAX),
      addDino('p', 'giganotosaurus', XP_MAX, null, ['prodigy']),   // +20% xp, no combat effect
      addDino('p', 'spinosaurus', XP_MAX),
    ];
    const stage = STAGES.get('coastal_dig_2')!;
    const out = runFight(ctx, 'p', 'coastal_dig_2', squad);
    expect(out.won).toBe(true);
    const totalXp = Math.round(stage.rewards.xp * STAR_XP_MULT[out.stars]);
    const baseXp = Math.floor(totalXp / 3);
    // Slot 0 keeps the even-split remainder, untraited. Slot 1 (prodigy) scales only its
    // own post-split share. Slot 2 is untraited and stays at the plain base share. If the
    // pool were scaled before splitting instead, every slot would move, not just slot 1.
    expect(out.rewards.xpPerDino).toEqual([
      baseXp + (totalXp % 3),
      Math.floor(baseXp * 1.20),
      baseXp,
    ]);
    squad.forEach((id, k) => expect(dinoRow(id).battleXp).toBe(XP_MAX + out.rewards.xpPerDino[k]));
  });
});

describe('runFight — energy gate', () => {
  it('insufficient energy throws BattleError with a countdown and writes nothing', () => {
    ctx.db.update(schema.users).set({ energy: 0, energyUpdatedAt: T0 })
      .where(eq(schema.users.discordId, 'p')).run();
    const d = addDino('p', 'tyrannosaurus', XP_MAX);
    expect(() => runFight(ctx, 'p', 'coastal_dig_1', [d])).toThrow(BattleError);
    expect(() => runFight(ctx, 'p', 'coastal_dig_1', [d])).toThrow(/<t:/);   // relative next-energy timestamp
    const u = user();
    expect(u.cash).toBe(500);
    expect(u.energy).toBe(0);
    expect(u.energyUpdatedAt).toBe(T0);                          // locals-only settle never persisted
    expect(progressRow('coastal_dig_1')).toBeUndefined();
    expect(ctx.db.select().from(schema.txLog).all()).toHaveLength(0);
    expect(dinoRow(d).battleXp).toBe(XP_MAX);
  });
});

describe('runFight — loss', () => {
  it('a loss commits energy and consolation XP only, never the wallet', () => {
    clearThrough(CH1);
    const d = addDino('p', 'compsognathus');           // level-1 common, alone — the boss-roster rule fields Old Riptooth (2.5x HP, 1.2x atk) even against a 1-dino squad
    const stage = STAGES.get('coastal_dig_boss')!;
    const out = runFight(ctx, 'p', 'coastal_dig_boss', [d]);
    expect(out.won).toBe(false);
    expect(out.stars).toBe(0);
    expect(out.bossEgg).toBeNull();
    // Boss-roster rule pinned: a solo squad on a boss stage fights the boss itself,
    // 1v1 — never a plain roster filler.
    expect(Object.keys(out.result.finalHp)).toHaveLength(2);
    expect(JSON.stringify(out.result.beats)).toContain(stage.boss!.title);
    const u = user();
    expect(u.cash).toBe(500);                          // no economy.apply on a loss
    expect(u.shards).toBe(0);
    expect(u.energy).toBe(ENERGY_CAP - stage.energyCost);
    const row = progressRow('coastal_dig_boss')!;
    expect(row.stars).toBe(0);
    expect(row.firstClearedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(dinoRow(d).battleXp).toBe(Math.round(stage.rewards.xp * STAR_XP_MULT[0]));
    expect(ctx.db.select().from(schema.eggs).all()).toHaveLength(0);
  });
});

describe('runFight — repeat clears', () => {
  it('first-clear shards are paid exactly once across two wins', () => {
    const d = addDino('p', 'tyrannosaurus', XP_MAX);
    const stage = STAGES.get('coastal_dig_1')!;
    const first = runFight(ctx, 'p', 'coastal_dig_1', [d]);
    expect(first.firstClear).toBe(true);
    expect(first.rewards.shards).toBe(stage.firstClearShards);
    const again = runFight(ctx, 'p', 'coastal_dig_1', [d]);
    expect(again.won).toBe(true);
    expect(again.firstClear).toBe(false);
    expect(again.rewards.shards).toBe(0);
    expect(user().shards).toBe(stage.firstClearShards);
    const row = progressRow('coastal_dig_1')!;
    expect(row.attempts).toBe(2);
    expect(row.firstClearedAt).toBe(T0);               // first run's stamp survives the second upsert
  });

  it('the stars upsert keeps the best result', () => {
    clearThrough(CH1);
    const best = runFight(ctx, 'p', 'coastal_dig_boss', heavies());
    expect(best.stars).toBe(3);                        // three level-10 heavies take zero KOs
    const worse = runFight(ctx, 'p', 'coastal_dig_boss', [addDino('p', 'compsognathus')]);
    expect(worse.stars).toBeLessThan(3);
    const row = progressRow('coastal_dig_boss')!;
    expect(row.stars).toBe(3);
    expect(row.attempts).toBe(2);
    expect(row.firstClearedAt).toBe(T0);
  });

  it('the boss first clear grants exactly one battle-source egg', () => {
    clearThrough(CH1);
    const squad = heavies();
    const stage = STAGES.get('coastal_dig_boss')!;
    const first = runFight(ctx, 'p', 'coastal_dig_boss', squad);
    expect(first.won).toBe(true);
    expect(first.bossEgg).toEqual({ rarity: stage.boss!.eggRarity });
    const again = runFight(ctx, 'p', 'coastal_dig_boss', squad);
    expect(again.won).toBe(true);
    expect(again.bossEgg).toBeNull();
    const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).all();
    expect(eggs).toHaveLength(1);
    expect(eggs[0].source).toBe('battle');
    expect(eggs[0].rarity).toBe(stage.boss!.eggRarity);
    expect(eggs[0].speciesId).toBe(stage.boss!.eggSpeciesId);
  });
});

describe('runFight — rejects', () => {
  it('an escaped dino cannot fight', () => {
    const d = addDino('p', 'tyrannosaurus', XP_MAX, T0 - 1);
    expect(() => runFight(ctx, 'p', 'coastal_dig_1', [d])).toThrow(BattleError);
    expect(progressRow('coastal_dig_1')).toBeUndefined();
  });

  it('you can only field dinos you own', () => {
    getOrCreateUser(ctx, 'q', 'Q');
    const theirs = addDino('q', 'tyrannosaurus', XP_MAX);
    expect(() => runFight(ctx, 'p', 'coastal_dig_1', [theirs])).toThrow(BattleError);
    expect(progressRow('coastal_dig_1')).toBeUndefined();
  });

  it('chapter 2 is locked until the chapter 1 boss falls', () => {
    // Satisfy the site-rating co-gate so the boss-clear gate is what rejects.
    ctx.db.update(schema.users).set({ ratingHighWater: 400 })
      .where(eq(schema.users.discordId, 'p')).run();
    const d = addDino('p', 'tyrannosaurus', XP_MAX);
    expect(() => runFight(ctx, 'p', 'amber_ridge_1', [d])).toThrow(BattleError);
    expect(progressRow('amber_ridge_1')).toBeUndefined();
  });

  it('a squad larger than 3 is rejected', () => {
    const ids = [
      addDino('p', 'tyrannosaurus', XP_MAX), addDino('p', 'giganotosaurus', XP_MAX),
      addDino('p', 'spinosaurus', XP_MAX), addDino('p', 'compsognathus', XP_MAX),
    ];
    expect(() => runFight(ctx, 'p', 'coastal_dig_1', ids)).toThrow(BattleError);
    expect(progressRow('coastal_dig_1')).toBeUndefined();
  });

  it('a duplicate dino id in the squad is rejected, not last-write-wins XP', () => {
    // The XP write is `d.battleXp + xpPerDino[k]` from a pre-transaction
    // snapshot — an unrejected duplicate would silently drop one slot's XP
    // instead of accumulating it. Rejecting outright, and proving battleXp
    // is untouched, is the correct behavior either way.
    const d = addDino('p', 'tyrannosaurus', XP_MAX);
    expect(() => runFight(ctx, 'p', 'coastal_dig_1', [d, d])).toThrow(BattleError);
    expect(progressRow('coastal_dig_1')).toBeUndefined();
    expect(dinoRow(d).battleXp).toBe(XP_MAX);
  });
});

describe('runFight — transaction atomicity', () => {
  it('a failure after economy.apply rolls back the entire fight: energy, wallet, progress, XP, and food', () => {
    clearThrough(CH1);
    const squad = heavies();                     // guaranteed 3-star boss first clear
    const before = user();
    const beforeXp = squad.map((id) => dinoRow(id).battleXp);
    const stage = STAGES.get('coastal_dig_boss')!;
    const beforeFood = foodQty(stage.rewards.food!.foodId);

    // raw better-sqlite3 handle; drizzle exposes it as db.$client (same pattern
    // as the rollback tests in tests/economy.test.ts / tests/park.test.ts).
    // The eggs insert is the LAST write in runFight's transaction — after the
    // energy spend, economy.apply's cash/shards/food credit, the
    // battle_progress upsert, and every squad dino's battleXp write — so
    // aborting it is the strongest proof available that the whole fight is
    // one atomic unit, not just that the pre-transaction reject gates work
    // (every other "writes nothing" test in this file only exercises those).
    const raw = ctx.db.$client;
    raw.exec(`CREATE TRIGGER block_battle_egg BEFORE INSERT ON eggs
              WHEN NEW.source = 'battle'
              BEGIN SELECT RAISE(ABORT, 'forced'); END;`);
    try {
      expect(() => runFight(ctx, 'p', 'coastal_dig_boss', squad)).toThrow();
    } finally {
      raw.exec('DROP TRIGGER block_battle_egg');   // never leak the trigger into other tests
    }

    const after = user();
    expect(after.cash).toBe(before.cash);
    expect(after.shards).toBe(before.shards);
    expect(after.energy).toBe(before.energy);
    expect(after.energyUpdatedAt).toBe(before.energyUpdatedAt);
    squad.forEach((id, k) => expect(dinoRow(id).battleXp).toBe(beforeXp[k]));
    expect(progressRow('coastal_dig_boss')).toBeUndefined();
    expect(foodQty(stage.rewards.food!.foodId)).toBe(beforeFood);
    expect(ctx.db.select().from(schema.txLog).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).all()).toHaveLength(0);
  });
});
