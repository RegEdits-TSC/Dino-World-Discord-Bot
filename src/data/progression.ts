import type { Rarity } from './types.js';

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 1, uncommon: 2, rare: 4, epic: 8, legendary: 16, mythic: 32,
};
export const RATING_WEIGHTS = { collection: 0.40, park: 0.35, comfort: 0.25 };
export const PARK_TARGET = 40;
// Frozen at the rarity-weight sum of the 30-species roster this shipped with.
// Deliberately NOT a live sum over allSpecies(): a live denominator taxes every
// existing player's rating each time a species ships. New species are alternate
// paths to the same target, which is why the caller clamps at 1.
export const COLLECTION_TARGET = 190;
export const RATING_SCALE = 1000;
export const BASE_LOT_SLOTS_FALLBACK = 3;
export const LOT_SLOT_THRESHOLDS = [100, 200, 400, 600, 800, 880, 950];   // high-water for slots 4..10
export const SHOP_CEILING: Array<{ atLeast: number; ceiling: Rarity }> = [
  { atLeast: 700, ceiling: 'legendary' },
  { atLeast: 400, ceiling: 'epic' },
  { atLeast: 200, ceiling: 'rare' },
  { atLeast: 0, ceiling: 'uncommon' },
];
export const MYTHIC_UNLOCK_RATING = 800;

export function siteUnlocked(unlockRating: number, highWater: number): boolean { return highWater >= unlockRating; }
export function lotSlots(highWater: number): number {
  return BASE_LOT_SLOTS_FALLBACK + LOT_SLOT_THRESHOLDS.filter((t) => highWater >= t).length;
}
/**
 * The next lot slot the player has NOT unlocked, and the high-water rating that unlocks it —
 * or null once every rung of LOT_SLOT_THRESHOLDS is passed.
 *
 * `BASE_LOT_SLOTS_FALLBACK + idx + 1` and not `idx + 1`: LOT_SLOT_THRESHOLDS[0] gates slot 4,
 * not slot 1, which is the same offset lotSlots applies by adding the base to a count of
 * passed rungs. The invariant the caller renders against is
 * `nextLotSlot(hw)!.slot === lotSlots(hw) + 1`.
 *
 * Unlike lotSlots' filter, findIndex relies on LOT_SLOT_THRESHOLDS being ASCENDING; it is,
 * and a rung inserted out of order would silently advertise the wrong slot.
 */
export function nextLotSlot(highWater: number): { slot: number; threshold: number } | null {
  const idx = LOT_SLOT_THRESHOLDS.findIndex((t) => highWater < t);
  if (idx === -1) return null;
  return { slot: BASE_LOT_SLOTS_FALLBACK + idx + 1, threshold: LOT_SLOT_THRESHOLDS[idx] };
}
export function shopCeiling(highWater: number): Rarity {
  return (SHOP_CEILING.find((s) => highWater >= s.atLeast) ?? SHOP_CEILING[SHOP_CEILING.length - 1]).ceiling;
}
export function mythicUnlocked(highWater: number): boolean { return highWater >= MYTHIC_UNLOCK_RATING; }
