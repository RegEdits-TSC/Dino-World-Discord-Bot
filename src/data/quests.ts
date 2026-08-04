import type { StatId } from '../core/stats.js';
import type { FoodId } from './foods.js';

// Quests gate on the player having engaged with a system at all — a fresh
// account with no dinos can't be handed a 'battles' quest and told to fight.
// 'none' quests are always safe to roll; the others require the matching
// system to already be in play (see the daily-loop design spec).
export type QuestRequirement = 'none' | 'income' | 'battles' | 'trading' | 'genelab';

export interface QuestDef {
  id: string;
  stat: StatId;
  target: number | 'half-day-income';
  rewards: { cash: number; shards?: number; food?: { foodId: FoodId; qty: number } };
  description: string;
  requirement: QuestRequirement;
}

// Quests whose stat is a churn counter (incubate-then-hatch, buy-then-sell):
// rolling two of these on one board would let a single action double-dip.
// The roller must never pick more than one quest whose stat is in this list.
export const CHURN_STATS: StatId[] = ['eggs_incubated', 'dinos_sold'];

export const QUESTS: QuestDef[] = [
  {
    id: 'feed_3', stat: 'dinos_fed', target: 3,
    rewards: { cash: 400, shards: 4 },
    description: 'Feed 3 dinos.', requirement: 'none',
  },
  {
    id: 'feed_8', stat: 'dinos_fed', target: 8,
    rewards: { cash: 700, shards: 7 },
    description: 'Feed 8 dinos.', requirement: 'none',
  },
  {
    id: 'collect_twice', stat: 'income_collections', target: 2,
    rewards: { cash: 400, shards: 4 },
    description: 'Collect park income twice.', requirement: 'income',
  },
  {
    id: 'collect_cash', stat: 'income_collected', target: 'half-day-income',
    rewards: { cash: 600, shards: 6 },
    description: "Collect half a day's worth of income.", requirement: 'income',
  },
  {
    id: 'hatch_1', stat: 'eggs_hatched', target: 1,
    rewards: { cash: 300, shards: 3 },
    description: 'Hatch an egg.', requirement: 'none',
  },
  {
    id: 'hatch_3', stat: 'eggs_hatched', target: 3,
    rewards: { cash: 700, shards: 7 },
    description: 'Hatch 3 eggs.', requirement: 'none',
  },
  {
    id: 'incubate_2', stat: 'eggs_incubated', target: 2,
    rewards: { cash: 400, food: { foodId: 'ferns', qty: 3 } },
    description: 'Incubate 2 eggs.', requirement: 'none',
  },
  {
    id: 'expedition_1', stat: 'expeditions_claimed', target: 1,
    rewards: { cash: 350, food: { foodId: 'fish', qty: 3 } },
    description: 'Claim an expedition reward.', requirement: 'none',
  },
  {
    id: 'expedition_2', stat: 'expeditions_claimed', target: 2,
    rewards: { cash: 650, shards: 7 },
    description: 'Claim 2 expedition rewards.', requirement: 'none',
  },
  {
    id: 'fight_5', stat: 'battles_fought', target: 5,
    rewards: { cash: 500, shards: 5 },
    description: 'Fight 5 battles.', requirement: 'battles',
  },
  {
    id: 'win_1', stat: 'battles_won', target: 1,
    rewards: { cash: 400, shards: 4 },
    description: 'Win a battle.', requirement: 'battles',
  },
  {
    id: 'win_3', stat: 'battles_won', target: 3,
    rewards: { cash: 800, shards: 8 },
    description: 'Win 3 battles.', requirement: 'battles',
  },
  {
    id: 'trade_1', stat: 'trades_completed', target: 1,
    rewards: { cash: 500, shards: 5 },
    description: 'Complete a trade.', requirement: 'trading',
  },
  {
    id: 'breed_start', stat: 'breedings_started', target: 1,
    rewards: { cash: 400, shards: 4 },
    description: 'Start a breeding.', requirement: 'genelab',
  },
  {
    id: 'breed_claim', stat: 'breedings_claimed', target: 1,
    rewards: { cash: 500, shards: 5 },
    description: 'Claim a breeding.', requirement: 'genelab',
  },
  {
    id: 'splice_1', stat: 'splices_done', target: 1,
    rewards: { cash: 600, shards: 6 },
    description: 'Splice a trait.', requirement: 'genelab',
  },
  {
    id: 'sell_2', stat: 'dinos_sold', target: 2,
    rewards: { cash: 500 },
    description: 'Sell 2 dinos.', requirement: 'none',
  },
];

export interface ChestDef { cash: number; shards: number; eggRarity?: 'rare' | 'epic' }

// Streak milestones: 3/7/14 are fixed one-time-shaped rewards, then every 30
// days pays an escalating shard chest capped at 100 so the tail never spirals.
export function chestFor(streak: number): ChestDef | null {
  if (streak === 3) return { cash: 1500, shards: 0 };
  if (streak === 7) return { cash: 3000, shards: 20 };
  if (streak === 14) return { cash: 2500, shards: 0, eggRarity: 'rare' };
  if (streak >= 30 && streak % 30 === 0) {
    return { cash: 0, shards: Math.min(100, 40 + 10 * (streak / 30 - 1)), eggRarity: 'epic' };
  }
  return null;
}

const FIXED_MILESTONES = [3, 7, 14];

// Chests are personal-best-only: a milestone at or under `best` can never pay
// again, so it must never be advertised as the "next chest" either — that
// would tell the player breaking their streak to re-earn it is worthwhile,
// when replaying it strictly wastes days versus never having broken it.
export function nextChestAt(streak: number, best: number): number {
  const floor = Math.max(streak, best);
  for (const m of FIXED_MILESTONES) if (m > floor) return m;
  let n = 30;
  while (n <= floor) n += 30;
  return n;
}
