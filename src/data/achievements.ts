import type { StatId } from '../core/stats.js';

// Each track is a lifetime stat with 4 ascending tiers. Track `id` equals the
// stat name — one track per stat, no duplicates (enforced by
// tests/daily-content.test.ts).
export interface AchievementTrack {
  id: string;
  stat: StatId;
  name: string;
  tiers: [number, number, number, number];
}

export const ACHIEVEMENTS: AchievementTrack[] = [
  { id: 'eggs_hatched', stat: 'eggs_hatched', name: 'Hatchling Handler', tiers: [10, 50, 200, 500] },
  { id: 'dinos_fed', stat: 'dinos_fed', name: 'Feeding Time', tiers: [25, 150, 500, 1500] },
  { id: 'income_collected', stat: 'income_collected', name: 'Park Tycoon', tiers: [10_000, 100_000, 1_000_000, 10_000_000] },
  { id: 'expeditions_claimed', stat: 'expeditions_claimed', name: 'Expedition Leader', tiers: [5, 25, 100, 300] },
  { id: 'battles_fought', stat: 'battles_fought', name: 'Battle Tested', tiers: [10, 50, 200, 500] },
  { id: 'battles_won', stat: 'battles_won', name: 'Champion', tiers: [5, 25, 100, 250] },
  { id: 'stages_first_cleared', stat: 'stages_first_cleared', name: 'Explorer', tiers: [5, 10, 15, 20] },
  { id: 'trades_completed', stat: 'trades_completed', name: 'Trader', tiers: [1, 5, 25, 100] },
  { id: 'breedings_claimed', stat: 'breedings_claimed', name: 'Breeder', tiers: [1, 5, 25, 100] },
  { id: 'splices_done', stat: 'splices_done', name: 'Gene Splicer', tiers: [1, 10, 50, 200] },
  { id: 'dinos_sold', stat: 'dinos_sold', name: 'Dealmaker', tiers: [5, 25, 100, 300] },
  { id: 'lots_built', stat: 'lots_built', name: 'Park Architect', tiers: [3, 6, 10, 15] },
];

export const TIER_REWARDS: Array<{ cash: number; shards: number }> = [
  { cash: 500, shards: 0 },
  { cash: 1250, shards: 0 },
  { cash: 2500, shards: 5 },
  { cash: 5000, shards: 20 },
];

export const TIER_NAMES: string[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];
