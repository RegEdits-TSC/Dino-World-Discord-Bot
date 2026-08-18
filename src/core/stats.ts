import { eq, and, sql } from 'drizzle-orm';
import { schema } from './db/index.js';
import type { Ctx } from './context.js';

// Lifetime action counters. 'count' stats step by 1 per event; 'sum' stats add a
// quantity. Quest targets phrased as "do X n times" may only reference count stats
// (enforced by tests/daily-content.test.ts).
export const STATS = {
  dinos_fed: 'count', eggs_hatched: 'count', eggs_incubated: 'count',
  income_collected: 'sum', income_collections: 'count',
  expeditions_claimed: 'count', battles_fought: 'count', battles_won: 'count',
  stages_first_cleared: 'count', trades_completed: 'count',
  breedings_started: 'count', breedings_claimed: 'count', splices_done: 'count',
  dinos_sold: 'count', shop_purchases: 'count', lots_built: 'count',
  lots_upgraded: 'count', dinos_rescued: 'count', attractions_built: 'count',
} as const satisfies Record<string, 'count' | 'sum'>;
export type StatId = keyof typeof STATS;

export function track(ctx: Ctx, userId: string, stat: StatId, delta: number): void {
  if (delta <= 0) return;
  ctx.db.insert(schema.userStats).values({ userId, stat, value: delta })
    .onConflictDoUpdate({
      target: [schema.userStats.userId, schema.userStats.stat],
      set: { value: sql`${schema.userStats.value} + ${delta}` },
    }).run();
}

export function readStat(ctx: Ctx, userId: string, stat: StatId): number {
  const row = ctx.db.select().from(schema.userStats)
    .where(and(eq(schema.userStats.userId, userId), eq(schema.userStats.stat, stat))).get();
  return row?.value ?? 0;
}

export function readStats(ctx: Ctx, userId: string): Partial<Record<StatId, number>> {
  const rows = ctx.db.select().from(schema.userStats)
    .where(eq(schema.userStats.userId, userId)).all();
  return Object.fromEntries(rows.map((r) => [r.stat, r.value]));
}
