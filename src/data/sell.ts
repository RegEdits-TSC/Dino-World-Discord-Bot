import type { Rarity } from './types.js';
// Raised from 40 alongside the /splice sink: at 40/day a 15-shard splice starves
// the 500-shard Mythic purchase (20 days at one splice/day, 50 at two). At 60, two
// splices/day still banks 30 shards and reaches a Mythic in ~16.7 days; a player can
// instead spend up to 4 splices/day, banking nothing toward a Mythic that day.
export const SHARD_DAILY_CAP = 60;
export const SHARD_WINDOW_MS = 24 * 3_600_000;
export const MYTHIC_SHARD_COST = 500;
export const SELL_CASH: Record<Rarity, number> = {
  common: 50, uncommon: 150, rare: 500, epic: 1_500, legendary: 5_000, mythic: 0,
};
