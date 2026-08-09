import type { Ctx } from '../../core/context.js';
import type { Archetype, Diet, Rarity, Species } from '../../data/types.js';
import { allSpecies, getSpecies } from '../../data/species/index.js';
import { RARITY } from '../../data/rarity.js';
import { enrichingKindsFor } from '../../data/decor.js';
import { seenSpecies, firstSeenAt } from '../../core/species-seen.js';

export interface DexFilters { rarity?: Rarity; diet?: Diet; archetype?: Archetype }
export interface DexRow { species: Species; seen: boolean }

/**
 * The roster with the reader's seen marks. seenSpecies is read ONCE and membership
 * tested in memory — never a query per row (the batch-per-user rule src/core/locks.ts
 * establishes). Order is allSpecies()' hand-authored insertion order, so paging is
 * stable between calls.
 */
export function dexRows(ctx: Ctx, userId: string, filters: DexFilters): DexRow[] {
  const seen = seenSpecies(ctx, userId);
  return allSpecies()
    .filter((s) => (!filters.rarity || s.rarity === filters.rarity)
      && (!filters.diet || s.diet === filters.diet)
      && (!filters.archetype || s.archetype === filters.archetype))
    .map((s) => ({ species: s, seen: seen.has(s.id) }));
}

export interface DexEntry {
  species: Species; seen: boolean; firstAt: number | null;
  incubationMs: number; incomePerHr: number; enrichingKinds: string[];
}

/** One species page. Every number is derived from rarity — Species carries none. */
export function dexEntry(ctx: Ctx, userId: string, speciesId: string): DexEntry {
  const species = getSpecies(speciesId);
  const firstAt = firstSeenAt(ctx, userId, speciesId);
  return {
    species,
    seen: firstAt !== null,
    firstAt,
    incubationMs: RARITY[species.rarity].incubationMs,
    incomePerHr: RARITY[species.rarity].incomePerHr,
    enrichingKinds: enrichingKindsFor(species),
  };
}

/** Intersected with the live roster, so a retired species id cannot inflate the count. */
export function dexProgress(ctx: Ctx, userId: string): { seen: number; total: number } {
  const seen = seenSpecies(ctx, userId);
  const roster = allSpecies();
  return { seen: roster.filter((s) => seen.has(s.id)).length, total: roster.length };
}
