import type { Species } from './types.js';

export interface DecorDef { kind: string; name: string; biomeTags: string[]; cost: number }
export const DECOR: Record<string, DecorDef> = {
  palm_tree:  { kind: 'palm_tree', name: 'Palm Tree', biomeTags: ['forest'], cost: 500 },
  fern:       { kind: 'fern', name: 'Fern Cluster', biomeTags: ['forest', 'swamp'], cost: 500 },
  boulder:    { kind: 'boulder', name: 'Boulder', biomeTags: ['plains'], cost: 500 },
  grass_tuft: { kind: 'grass_tuft', name: 'Grass Tuft', biomeTags: ['plains'], cost: 400 },
  tide_pool:  { kind: 'tide_pool', name: 'Tide Pool', biomeTags: ['coast'], cost: 700 },
  ice_block:  { kind: 'ice_block', name: 'Ice Block', biomeTags: ['tundra'], cost: 700 },
  lava_rock:  { kind: 'lava_rock', name: 'Lava Rock', biomeTags: ['volcanic'], cost: 800 },
  reed_bed:   { kind: 'reed_bed', name: 'Reed Bed', biomeTags: ['swamp'], cost: 600 },
  kelp_bed:          { kind: 'kelp_bed', name: 'Kelp Bed', biomeTags: ['marine'], cost: 900 },
  hydrothermal_vent: { kind: 'hydrothermal_vent', name: 'Hydrothermal Vent', biomeTags: ['marine'], cost: 1_100 },
  containment_fence: { kind: 'containment_fence', name: 'Containment Fence', biomeTags: ['containment'], cost: 1_000 },
  floodlight_rig:    { kind: 'floodlight_rig', name: 'Floodlight Rig', biomeTags: ['containment'], cost: 1_200 },
};

/** Distinct matching kinds at which the enrichment ladder tops out. */
export const ENRICHMENT_CAP_KINDS = 3;

/**
 * Enrichment multiplier by distinct matching decor kinds, indexed by count − 1.
 * Applies ONLY on top of a paddock already at fit 1.0 (correct diet, ≥1 match), so
 * index 0 is deliberately 1.0: three tests pin "one matching tile ⇒ exactly 1.0".
 *
 * Simulated 2026-08-09 against accruedIncome on the 48-slot all-legendary reference
 * park (10 lots, VC L5 + FC L3, capHours 24, facilityBonusPct 32):
 *   1.00 → 4,561,920 cash/day, escapeAt 44.000 h at hungerAtFed 100
 *   1.05 → 4,790,016 (+228,096), escapeAt 44.571 h
 *   1.10 → 5,018,112 (+456,192), escapeAt 45.091 h
 * The ceiling is 1.10 on purpose. The escape channel's total gain is bounded —
 * (25 − 25/fit)/100 × 48 h has supremum +12 h as fit → ∞ — and fit 1.5 is a cliff:
 * escapeAt < hungerZero iff 12/fit < 8, so at fit ≥ 1.5 a dino sits at comfort 0
 * earning nothing while its 8 h grace runs out. Every 0.05 also lands entirely in an
 * endgame cash surplus that is already 94% unspent.
 */
export const ENRICHMENT_STEPS: readonly number[] = [1.0, 1.05, 1.1];

/** Every decor kind that would count toward this species' enrichment. */
export function enrichingKindsFor(species: Species): string[] {
  return Object.values(DECOR)
    .filter((d) => d.biomeTags.some((tag) => species.biomeTags.includes(tag)))
    .map((d) => d.kind);
}

/**
 * Distinct decor kinds on this paddock that match the species' biomes.
 * Set-deduped because decorateLot appends with no dedupe, no cap and no removal
 * path (src/modules/park/dinos.ts), so live parks hold repeated slugs. An unknown
 * or retired slug degrades to no match rather than throwing.
 */
export function matchedKindCount(species: Species, decor: string[]): number {
  let n = 0;
  for (const kind of new Set(decor)) {
    if (DECOR[kind]?.biomeTags.some((tag) => species.biomeTags.includes(tag))) n++;
  }
  return n;
}

export function enrichmentMult(matchedKinds: number): number {
  if (matchedKinds <= 0) return 1.0;
  return ENRICHMENT_STEPS[Math.min(matchedKinds, ENRICHMENT_CAP_KINDS) - 1];
}
