import type { Rarity } from './types.js';

const H = 3_600_000, M = 60_000;

export const RARITY_LADDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export const BREED_MS: Record<Rarity, number> = {
  common: 30 * M, uncommon: 2 * H, rare: 6 * H, epic: 18 * H, legendary: 36 * H, mythic: 0,
};

// Parents are busy for the breed, then cooling down for the same span again.
export const BREED_COOLDOWN_MS: Record<Rarity, number> = { ...BREED_MS };

// 33-40% of the matching /shop egg price (500 / 2,000 / 8,000 / 30,000 / 120,000).
// Breeding is meant to beat the shop on cash-per-egg — it is throttled by needing
// two matching dinos, a lot slot, and real elapsed time instead.
export const BREED_FEE: Record<Rarity, number> = {
  common: 200, uncommon: 800, rare: 3_000, epic: 10_000, legendary: 40_000, mythic: 0,
};

export const BREED_UPGRADE_CHANCE = 0.10;
export const BREED_MIN_HUNGER = 50;
export const SPLICE_SHARD_COST = 15;

export function breedableRarity(r: Rarity): boolean {
  return r !== 'mythic';
}

// Caps at legendary. Allowing legendary -> mythic would cost ~2.2 hours of endgame
// income against 500 shards — cheaper than ever now that the daily loop's quest,
// chest, and one-time achievement shards (all bypassing the sell cap) sit on top of
// selling: a max-selling active player reaches 500 shards in roughly 6.5 days (about
// 28-30 days from those faucets alone with no selling), so the shortcut would
// destroy the shard sink even faster than the old sell-only ~8.3-day figure implied.
export function upgradeRarity(r: Rarity): Rarity {
  if (r === 'legendary' || r === 'mythic') return 'legendary';
  return RARITY_LADDER[RARITY_LADDER.indexOf(r) + 1];
}
