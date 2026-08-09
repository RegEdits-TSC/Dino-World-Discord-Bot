import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { dayKeyUTC, DAY_MS } from '../../core/clock.js';
import { readStat, readStats, type StatId } from '../../core/stats.js';
import { QUESTS, CHURN_STATS, chestFor, type QuestDef, type ChestDef } from '../../data/quests.js';
import { ACHIEVEMENTS, TIER_REWARDS, type AchievementTrack } from '../../data/achievements.js';
import { mulberry32, shuffle } from '../../core/rolls.js';
import { facilityLevel, capHours } from '../park/service.js';
import { RARITY } from '../../data/rarity.js';
import { getSpecies } from '../../data/species/index.js';
import { modProduct } from '../../data/traits.js';
import { TRADE_MIN_RATING } from '../../data/trade.js';
import type { FoodId } from '../../data/foods.js';

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Each arm reads exactly one thing, per spec §4. 'income' matches the spec verbatim —
// any dino with lotId set, escaped or not: the escaped exclusion is a
// dailyEarningCapacity concern (actual earning), not an eligibility one (system in play).
function eligible(ctx: Ctx, userId: string, q: QuestDef): boolean {
  switch (q.requirement) {
    case 'none':
      return true;
    case 'income':
      return ctx.db.select().from(schema.dinos)
        .where(and(eq(schema.dinos.userId, userId), isNotNull(schema.dinos.lotId))).get() !== undefined;
    case 'battles':
      return ctx.db.select().from(schema.battleProgress)
        .where(eq(schema.battleProgress.userId, userId)).get() !== undefined;
    case 'trading': {
      const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
      return (user?.ratingHighWater ?? 0) >= TRADE_MIN_RATING;
    }
    case 'genelab': {
      const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, userId)).all();
      return facilityLevel(lots, 'gene_lab') > 0;
    }
  }
}

function pickBoard(pool: QuestDef[], rng: () => number): QuestDef[] {
  const byStat = new Map<StatId, QuestDef[]>();
  for (const q of pool) byStat.set(q.stat, [...(byStat.get(q.stat) ?? []), q]);
  const board: QuestDef[] = []; let churn = 0, food = 0;
  for (const stat of shuffle([...byStat.keys()], rng)) {
    if (board.length === 3) break;
    if (CHURN_STATS.includes(stat) && churn >= 1) continue;
    let defs = byStat.get(stat)!;
    if (food >= 1) defs = defs.filter((d) => !d.rewards.food);
    if (!defs.length) continue;
    const def = defs[Math.floor(rng() * defs.length)];
    board.push(def);
    if (CHURN_STATS.includes(stat)) churn++;
    if (def.rewards.food) food++;
  }
  return board;
}

// A rough SIZING INPUT, not a live estimate or a ceiling: unlike accruedIncome
// (src/core/clock.ts) it deliberately ignores comfort, paddock fit (enrichment
// included), facility income bonuses, and the day's event multiplier, summing only
// each assigned, non-escaped dino's flat rarity rate (with its income trait modifier)
// over the user's cap hours. Real accrued income routinely runs well above this
// figure, not below it: facilityBonusPct alone reaches +32% and Heat Wave's
// incomeMultAt reaches 1.20, a combined 1.584x this number even before enrichment's
// own income bonus stacks on top. The looseness is harmless because rollDailyQuests
// only feeds this into a clamp — the half-day-income quest target is
// max(500, min(50_000, capacity / 2)) — so it only needs to land somewhere sane
// inside that range, never to bound the real number from above.
export function dailyEarningCapacity(ctx: Ctx, userId: string): number {
  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, userId)).all();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
  const hourly = dinos.reduce((sum, d) => {
    if (d.lotId == null || d.escapedAt !== null) return sum;
    return sum + RARITY[getSpecies(d.speciesId).rarity].incomePerHr * modProduct(d.traits, 'income');
  }, 0);
  return hourly * capHours(lots);
}

export function rollDailyQuests(ctx: Ctx, userId: string): void {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) return;
  const dayKey = dayKeyUTC(ctx.now());
  const existing = ctx.db.select().from(schema.dailyQuests)
    .where(and(eq(schema.dailyQuests.userId, userId), eq(schema.dailyQuests.dayKey, dayKey))).get();
  if (existing) return;
  const rng = mulberry32(hashSeed(`${userId}:${dayKey}`));
  const board = pickBoard(QUESTS.filter((q) => eligible(ctx, userId, q)), rng);
  ctx.db.transaction(() => {
    ctx.db.delete(schema.dailyQuests).where(and(
      eq(schema.dailyQuests.userId, userId), ne(schema.dailyQuests.dayKey, dayKey))).run();
    board.forEach((def, slot) => {
      const target = def.target === 'half-day-income'
        ? Math.max(500, Math.min(50_000, Math.round(dailyEarningCapacity(ctx, userId) / 2)))
        : def.target;
      ctx.db.insert(schema.dailyQuests)
        .values({ userId, dayKey, slot, questId: def.id, baseline: readStat(ctx, userId, def.stat), target })
        .onConflictDoNothing().run();
    });
  });
}

export interface QuestView {
  row: typeof schema.dailyQuests.$inferSelect; def: QuestDef; progress: number; complete: boolean;
}

// Rows whose questId has no live def (a deploy removed it while rolled rows still
// reference it) are OMITTED here — never crash, never pay. Batches with readStats
// (one query for every stat this user has), never a per-quest readStat.
export function questProgress(ctx: Ctx, userId: string): QuestView[] {
  const dayKey = dayKeyUTC(ctx.now());
  const rows = ctx.db.select().from(schema.dailyQuests)
    .where(and(eq(schema.dailyQuests.userId, userId), eq(schema.dailyQuests.dayKey, dayKey))).all();
  const stats = readStats(ctx, userId);
  const out: QuestView[] = [];
  for (const row of rows) {
    const def = QUESTS.find((q) => q.id === row.questId);
    if (!def) continue;
    const current = stats[def.stat] ?? 0;
    const progress = Math.max(0, Math.min(row.target, current - row.baseline));
    out.push({ row, def, progress, complete: progress >= row.target });
  }
  return out;
}

export interface ClaimResult {
  claimed: QuestView[];
  rewards: { cash: number; shards: number; foods: Partial<Record<FoodId, number>> };
  chest: (ChestDef & { streak: number }) | null;
  streak: number;
  ticked: boolean;
}

// Reads TODAY's dayKey only (via questProgress, which already scopes its query to
// dayKeyUTC(ctx.now())) — a board completed after midnight without being claimed is
// simply invisible here, forfeited by design, and this function must not roll a new
// board or touch the streak/user row in that case.
export function claimQuests(ctx: Ctx, userId: string): ClaimResult {
  const now = ctx.now();
  const dayKey = dayKeyUTC(now);
  const claimable = questProgress(ctx, userId)
    .filter((v) => v.row.dayKey === dayKey && v.row.claimedAt === null && v.complete);
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  if (!claimable.length)
    return { claimed: [], rewards: { cash: 0, shards: 0, foods: {} }, chest: null, streak: user.questStreak, ticked: false };

  const rewards = { cash: 0, shards: 0, foods: {} as Partial<Record<FoodId, number>> };
  for (const v of claimable) {
    rewards.cash += v.def.rewards.cash;
    rewards.shards += v.def.rewards.shards ?? 0;
    if (v.def.rewards.food) {
      const { foodId, qty } = v.def.rewards.food;
      rewards.foods[foodId] = (rewards.foods[foodId] ?? 0) + qty;
    }
  }

  // dayKey comparison, never an elapsed-ms window: two claims on adjacent calendar days
  // more than 24h apart (e.g. day1 09:00 -> day2 10:00) must still tick as consecutive.
  const lastKey = user.lastQuestClaimAt > 0 ? dayKeyUTC(user.lastQuestClaimAt) : null;
  const ticked = lastKey !== dayKey;
  const streak = !ticked ? user.questStreak
    : lastKey === dayKeyUTC(now - DAY_MS) ? user.questStreak + 1 : 1;
  // Chests pay on new personal bests only — this single comparison is what makes
  // deliberately breaking a streak strictly worse than keeping it.
  const chestDef = ticked && streak > user.questStreakBest ? chestFor(streak) : null;

  ctx.db.transaction(() => {
    ctx.economy.apply(userId, rewards, 'quest:daily', now);
    for (const v of claimable) {
      ctx.db.update(schema.dailyQuests).set({ claimedAt: now })
        .where(eq(schema.dailyQuests.id, v.row.id)).run();
    }
    if (chestDef) {
      ctx.economy.apply(userId, { cash: chestDef.cash, shards: chestDef.shards }, 'quest:chest', now);
      if (chestDef.eggRarity) {
        ctx.db.insert(schema.eggs).values({
          userId, rarity: chestDef.eggRarity, speciesId: null, source: 'quest', obtainedAt: now,
        }).run();
      }
    }
    ctx.db.update(schema.users).set({
      questStreak: streak,
      questStreakBest: Math.max(user.questStreakBest, streak),
      lastQuestClaimAt: now,
    }).where(eq(schema.users.discordId, userId)).run();
  });
  return { claimed: claimable, rewards, chest: chestDef ? { ...chestDef, streak } : null, streak, ticked };
}

export interface TrackView {
  def: AchievementTrack; value: number; claimedTiers: Set<number>; claimable: number[];
}

// Tier state is DERIVED, never stored: a tier is claimable iff the stat total has
// crossed its threshold AND no achievement_claims row exists for (userId, trackId,
// tier) yet — same philosophy as quest progress and escrow locks elsewhere in this
// file. Tier indices are 0-based, aligned with `tiers[i]`/`TIER_REWARDS[i]`/
// `TIER_NAMES[i]` everywhere a tier index is consumed. Batches with one readStats
// call and one claims query, never a per-track or per-tier query.
export function achievementsView(ctx: Ctx, userId: string): TrackView[] {
  const stats = readStats(ctx, userId);
  const claims = ctx.db.select().from(schema.achievementClaims)
    .where(eq(schema.achievementClaims.userId, userId)).all();
  const claimedByTrack = new Map<string, Set<number>>();
  for (const c of claims) {
    if (!claimedByTrack.has(c.trackId)) claimedByTrack.set(c.trackId, new Set());
    claimedByTrack.get(c.trackId)!.add(c.tier);
  }
  return ACHIEVEMENTS.map((def) => {
    const value = stats[def.stat] ?? 0;
    const claimedTiers = claimedByTrack.get(def.id) ?? new Set<number>();
    const claimable = def.tiers
      .map((threshold, tier) => ({ threshold, tier }))
      .filter(({ threshold, tier }) => value >= threshold && !claimedTiers.has(tier))
      .map(({ tier }) => tier);
    return { def, value, claimedTiers, claimable };
  });
}

// Pays every claimable tier across every track in ONE transaction with a single
// summed economy.apply — never one apply per tier or per track, so 'quest:achievements'
// tx_log stays exactly one row per claim-all regardless of how many tiers it covers.
// An empty claim writes nothing: no economy.apply, no claim rows, no tx_log entry.
export function claimAchievements(
  ctx: Ctx, userId: string,
): { claimed: Array<{ trackId: string; tier: number }>; cash: number; shards: number } {
  const now = ctx.now();
  const claimed = achievementsView(ctx, userId)
    .flatMap((v) => v.claimable.map((tier) => ({ trackId: v.def.id, tier })));
  if (!claimed.length) return { claimed: [], cash: 0, shards: 0 };

  const cash = claimed.reduce((sum, c) => sum + TIER_REWARDS[c.tier].cash, 0);
  const shards = claimed.reduce((sum, c) => sum + TIER_REWARDS[c.tier].shards, 0);
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash, shards }, 'quest:achievements', now);
    for (const c of claimed) {
      ctx.db.insert(schema.achievementClaims)
        .values({ userId, trackId: c.trackId, tier: c.tier, claimedAt: now }).run();
    }
  });
  return { claimed, cash, shards };
}

// Counts CLAIMED tiers, not claimable ones — the park badge shows progress already
// banked, not what is currently sitting ready to claim.
export function earnedTierCount(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.achievementClaims)
    .where(eq(schema.achievementClaims.userId, userId)).all().length;
}
