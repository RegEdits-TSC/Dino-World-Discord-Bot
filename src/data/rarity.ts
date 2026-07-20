import type { Rarity, RarityStats } from './types.js';
const H = 3_600_000, M = 60_000;
export const RARITY: Record<Rarity, RarityStats> = {
  common:    { incomePerHr: 60,    sellShards: [1, 3],   incubationMs: 15 * M, feedCost: 5 },
  uncommon:  { incomePerHr: 150,   sellShards: [3, 6],   incubationMs: 1 * H,  feedCost: 10 },
  rare:      { incomePerHr: 400,   sellShards: [8, 15],  incubationMs: 4 * H,  feedCost: 20 },
  epic:      { incomePerHr: 1100,  sellShards: [20, 35], incubationMs: 12 * H, feedCost: 40 },
  legendary: { incomePerHr: 3000,  sellShards: [50, 80], incubationMs: 24 * H, feedCost: 80 },
  mythic:    { incomePerHr: 9000,  sellShards: [0, 0],   incubationMs: 48 * H, feedCost: 160 },
};
