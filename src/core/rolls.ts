import type { Rarity, Species } from '../data/types.js';
import { RARITY } from '../data/rarity.js';
import { speciesByRarity } from '../data/species/index.js';

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// Fisher-Yates. Moved here from src/modules/daily/service.ts so the shop can
// use it too — the shop previously used `sort(() => rng() - 0.5)`, a biased
// comparator shuffle. Returns a new array; callers rely on the input surviving.
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// FNV-1a, 32-bit. Turns an id-bearing string into a seed for mulberry32.
//
// Two callers with different reasons to care that this never changes:
// rollDailyQuests hashes `${userId}:${dayKey}` to derive a player's daily board,
// and assetImage hashes `${kind}:${name}:${seed}` to pick an art variant. A
// changed hash silently rerolls every board in flight and reshuffles every
// variant, with nothing failing. tests/rolls.test.ts pins known pairs.
//
// Never use the result modulo anything. FNV-1a's low bits carry less avalanche
// than a PRNG's, which is why every selection in this repo runs the hash through
// mulberry32 first and then Math.floor(rng() * n).
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
