import type { Rarity } from './types.js';

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 1, uncommon: 2, rare: 4, epic: 8, legendary: 16, mythic: 32,
};
export const RATING_WEIGHTS = { collection: 0.40, park: 0.35, comfort: 0.25 };
export const PARK_TARGET = 40;
export const BASE_LOT_SLOTS_FALLBACK = 3;
export const LOT_SLOT_THRESHOLDS = [50, 100, 200, 300, 400];   // high-water (stars*100) for slots 4..8
export const SHOP_CEILING: Array<{ atLeast: number; ceiling: Rarity }> = [
  { atLeast: 350, ceiling: 'legendary' },
  { atLeast: 200, ceiling: 'epic' },
  { atLeast: 100, ceiling: 'rare' },
  { atLeast: 0, ceiling: 'uncommon' },
];
export const MYTHIC_UNLOCK_RATING = 400;

export function siteUnlocked(unlockRating: number, highWater: number): boolean { return highWater >= unlockRating; }
export function lotSlots(highWater: number): number {
  return BASE_LOT_SLOTS_FALLBACK + LOT_SLOT_THRESHOLDS.filter((t) => highWater >= t).length;
}
export function shopCeiling(highWater: number): Rarity {
  return (SHOP_CEILING.find((s) => highWater >= s.atLeast) ?? SHOP_CEILING[SHOP_CEILING.length - 1]).ceiling;
}
export function mythicUnlocked(highWater: number): boolean { return highWater >= MYTHIC_UNLOCK_RATING; }
