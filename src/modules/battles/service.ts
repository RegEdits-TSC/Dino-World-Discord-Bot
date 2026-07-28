import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import type { FoodId } from '../../data/foods.js';
import { getSpecies } from '../../data/species/index.js';
import { ENERGY_REGEN_MS, STAR_REWARD_MULT, STAR_XP_MULT } from '../../data/battle/constants.js';
import { battleLevel, statsFor } from '../../data/battle/stats.js';
import { settleEnergy } from '../../data/battle/energy.js';
import { resolveBattle, starsFor, type BattleResult, type Combatant } from '../../data/battle/resolve.js';
import { STAGES, chapterUnlocked, stageUnlocked, rosterFor, type ProgressMap } from '../../data/battle/chapters/index.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';

export class BattleError extends Error {}

export interface FightOutcome {
  result: BattleResult; stars: 0 | 1 | 2 | 3; firstClear: boolean; won: boolean;
  rewards: { cash: number; food: { foodId: FoodId; qty: number } | null; shards: number; xpPerDino: number[] };
  bossEgg: { rarity: Rarity } | null; energyAfter: number; energyUpdatedAtMs: number;
  squad: { dinoId: number; name: string; speciesId: string; level: number }[];
  stageId: string;
}

export function loadProgress(ctx: Ctx, userId: string): ProgressMap {
  const rows = ctx.db.select().from(schema.battleProgress)
    .where(eq(schema.battleProgress.userId, userId)).all();
  return new Map(rows.map((r) => [r.stageId, { stars: r.stars, firstClearedAt: r.firstClearedAt }]));
}

// Full fight pipeline. Everything is committed in ONE transaction before any
// presentation happens (commit-before-present): a crash mid-cinematic loses
// frames, never state. Throws BattleError for every user-facing reject.
export function runFight(ctx: Ctx, userId: string, stageId: string, dinoIds: number[]): FightOutcome {
  const user = getOrCreateUser(ctx, userId, userId);
  settleEscapes(ctx, userId);

  const stage = STAGES.get(stageId);
  if (!stage) throw new BattleError('Unknown stage.');
  const progress = loadProgress(ctx, userId);
  if (!chapterUnlocked(stage.chapterId, progress, user.ratingHighWater)) {
    throw new BattleError('That chapter is still locked.');
  }
  if (!stageUnlocked(stageId, progress)) throw new BattleError('Clear the previous stage first.');

  if (dinoIds.length < 1 || dinoIds.length > 3) throw new BattleError('Bring 1–3 dinos.');
  if (new Set(dinoIds).size !== dinoIds.length) throw new BattleError('Each dino can only fight once per squad.');
  const owned = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.userId, userId), inArray(schema.dinos.id, dinoIds))).all();
  const byId = new Map(owned.map((d) => [d.id, d]));
  // Unlike sellDino (src/modules/shop/shards.ts), `locked` dinos are deliberately NOT
  // rejected here: battling neither consumes nor transfers a dino, so it can't violate
  // a pending trade's escrow the way a sale would. Only escaped dinos are unfit to fight.
  const squadRows = dinoIds.map((id) => {
    const d = byId.get(id);
    if (!d) throw new BattleError('You can only field dinos you own.');
    if (d.escapedAt !== null) {
      throw new BattleError(`${d.nickname ?? getSpecies(d.speciesId).name} has escaped and cannot fight.`);
    }
    return d;
  });

  const now = ctx.now();
  const settled = settleEnergy(user.energy, user.energyUpdatedAt, now);
  if (settled.energy < stage.energyCost) {
    const nextAt = Math.floor((settled.updatedAtMs + ENERGY_REGEN_MS) / 1000);
    throw new BattleError(
      `Not enough energy — need ⚡${stage.energyCost}, have ⚡${settled.energy}. Next ⚡ <t:${nextAt}:R>.`);
  }

  const squad: Combatant[] = squadRows.map((d) => {
    const sp = getSpecies(d.speciesId);
    const s = statsFor(d.speciesId, battleLevel(d.battleXp));
    return {
      key: `d${d.id}`, name: d.nickname ?? sp.name, speciesId: d.speciesId, archetype: sp.archetype,
      maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, side: 0,
    };
  });
  // NPC side: single source of truth for roster selection AND boss
  // identification is rosterFor (shared with Task 10's embeds) — neither is
  // reimplemented here, so the embed and the fight always agree on who
  // actually fought and which entry is the boss.
  const n = squadRows.length;
  const roster = rosterFor(stage, n);
  const npcs: Combatant[] = roster.map((e, i) => {
    const sp = getSpecies(e.speciesId);
    const boss = e.boss;
    const s = statsFor(e.speciesId, stage.npcLevel + (boss?.levelBonus ?? 0));
    const hp = Math.round(s.hp * (boss?.hpMult ?? 1));
    return {
      key: `n${i}`, name: boss ? boss.title : sp.name, speciesId: e.speciesId, archetype: sp.archetype,
      maxHp: hp, hp, atk: Math.round(s.atk * (boss?.atkMult ?? 1)), def: s.def, spd: s.spd, side: 1,
    };
  });

  const result = resolveBattle(squad, npcs, ctx.rng);
  const stars = starsFor(result);
  const won = result.won;
  const prev = progress.get(stageId);
  const firstClear = won && (prev?.firstClearedAt ?? null) === null;
  // Spec: total stage XP splits evenly across the squad — floor share each,
  // remainder to slot 1 (the first dino in the squad array).
  const totalXp = Math.round(stage.rewards.xp * STAR_XP_MULT[stars]);
  const baseXp = Math.floor(totalXp / n);
  const xpPerDino = squadRows.map((_, k) => (k === 0 ? baseXp + (totalXp % n) : baseXp));
  const cash = won ? Math.round(stage.rewards.cash * STAR_REWARD_MULT[stars]) : 0;
  const food = won && stage.rewards.food
    ? { foodId: stage.rewards.food.foodId, qty: Math.round(stage.rewards.food.qty * STAR_REWARD_MULT[stars]) }
    : null;
  const shards = firstClear ? stage.firstClearShards : 0;
  const energyAfter = settled.energy - stage.energyCost;

  // economy.apply opens its own transaction; better-sqlite3 nests it as a
  // savepoint inside this one (the sellDino/claimExpedition shape).
  ctx.db.transaction(() => {
    ctx.db.update(schema.users).set({ energy: energyAfter, energyUpdatedAt: settled.updatedAtMs })
      .where(eq(schema.users.discordId, userId)).run();
    if (won) {
      ctx.economy.apply(userId,
        { cash, shards, foods: food ? { [food.foodId]: food.qty } : {} }, `battle:${stageId}`, now);
    }
    const row = ctx.db.select().from(schema.battleProgress)
      .where(and(eq(schema.battleProgress.userId, userId), eq(schema.battleProgress.stageId, stageId))).get();
    if (row) {
      ctx.db.update(schema.battleProgress).set({
        stars: Math.max(row.stars, stars),
        firstClearedAt: row.firstClearedAt ?? (won ? now : null),
        attempts: row.attempts + 1,
      }).where(and(eq(schema.battleProgress.userId, userId), eq(schema.battleProgress.stageId, stageId))).run();
    } else {
      ctx.db.insert(schema.battleProgress).values({
        userId, stageId, stars, firstClearedAt: won ? now : null, attempts: 1,
      }).run();
    }
    squadRows.forEach((d, k) => {
      ctx.db.update(schema.dinos).set({ battleXp: d.battleXp + xpPerDino[k] })
        .where(eq(schema.dinos.id, d.id)).run();
    });
    if (stage.boss && firstClear) {
      ctx.db.insert(schema.eggs).values({
        userId, rarity: stage.boss.eggRarity, speciesId: stage.boss.eggSpeciesId,
        source: 'battle', obtainedAt: now,
      }).run();
    }
  });

  return {
    result, stars, firstClear, won,
    rewards: { cash, food, shards, xpPerDino },
    bossEgg: stage.boss && firstClear ? { rarity: stage.boss.eggRarity } : null,
    energyAfter,
    energyUpdatedAtMs: settled.updatedAtMs,
    squad: squadRows.map((d) => ({
      dinoId: d.id, name: d.nickname ?? getSpecies(d.speciesId).name,
      speciesId: d.speciesId, level: battleLevel(d.battleXp),
    })),
    stageId,
  };
}
