import type { Rarity, Species } from '../data/types.js';
import { RARITY } from '../data/rarity.js';
import { speciesByRarity } from '../data/species/index.js';

export function rollWeighted<T>(entries: Array<{ value: T; weight: number }>, rng: () => number): T {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of entries) { if (r < e.weight) return e.value; r -= e.weight; }
  return entries[entries.length - 1].value;   // float-safe fallback
}

export function rollRarityFromOdds(odds: Array<{ rarity: Rarity; weight: number }>, rng: () => number): Rarity {
  return rollWeighted(odds.map((o) => ({ value: o.rarity, weight: o.weight })), rng);
}

export function rollIntInclusive(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function rollSellShards(rarity: Rarity, rng: () => number): number {
  const [lo, hi] = RARITY[rarity].sellShards;
  return rollIntInclusive(lo, hi, rng);
}

export function rollSpeciesInRarity(rarity: Rarity, rng: () => number): Species {
  const pool = speciesByRarity(rarity);
  return pool[Math.floor(rng() * pool.length)];
}
