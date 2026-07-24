import type { Rarity } from './types.js';

export const SHOP_EGG_PRICES: Record<Rarity, number> = {
  common: 500, uncommon: 2_000, rare: 8_000, epic: 30_000, legendary: 120_000, mythic: 0,
};
export const FOOD_BUNDLES = [10, 50, 100];
export const LEGENDARY_DAY_CHANCE = 0.10;
