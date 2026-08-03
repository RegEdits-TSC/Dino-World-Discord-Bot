import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { dayKeyUTC } from '../../core/clock.js';
import { readStat, readStats, type StatId } from '../../core/stats.js';
import { QUESTS, CHURN_STATS, type QuestDef } from '../../data/quests.js';
import { mulberry32 } from '../../core/rolls.js';
import { facilityLevel, capHours } from '../park/service.js';
import { RARITY } from '../../data/rarity.js';
import { getSpecies } from '../../data/species/index.js';
import { modProduct } from '../../data/traits.js';
import { TRADE_MIN_RATING } from '../../data/trade.js';

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

// A CAPACITY figure, not an actual-income one: unlike accruedIncome (src/core/clock.ts)
// it ignores comfort and paddock fit entirely, summing each assigned, non-escaped dino's
// flat rarity rate (with its income trait modifier) over the user's cap hours. It exists
// only to size the collect_cash quest target, which needs a ceiling, not a live estimate.
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
