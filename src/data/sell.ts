import type { Rarity } from './types.js';
export const SHARD_DAILY_CAP = 40;
export const SHARD_WINDOW_MS = 24 * 3_600_000;
export const MYTHIC_SHARD_COST = 500;
export const SELL_CASH: Record<Rarity, number> = {
  common: 50, uncommon: 150, rare: 500, epic: 1_500, legendary: 5_000, mythic: 0,
};
