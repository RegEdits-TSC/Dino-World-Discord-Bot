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
  // Three kinds per biome is the enrichment cap's precondition: on the original
  // twelve-kind table coast, tundra and volcanic offered one kind each, so four
  // species could not reach even the first rung. tests/roster.test.ts gates it.
  cycad_grove:    { kind: 'cycad_grove', name: 'Cycad Grove', biomeTags: ['forest'], cost: 600 },
  termite_mound:  { kind: 'termite_mound', name: 'Termite Mound', biomeTags: ['plains'], cost: 550 },
  mangrove_root:  { kind: 'mangrove_root', name: 'Mangrove Root', biomeTags: ['swamp'], cost: 650 },
  coral_shelf:    { kind: 'coral_shelf', name: 'Coral Shelf', biomeTags: ['marine'], cost: 1_000 },
  warning_klaxon: { kind: 'warning_klaxon', name: 'Warning Klaxon', biomeTags: ['containment'], cost: 1_100 },
  driftwood_pile: { kind: 'driftwood_pile', name: 'Driftwood Pile', biomeTags: ['coast'], cost: 750 },
  dune_grass:     { kind: 'dune_grass', name: 'Dune Grass', biomeTags: ['coast'], cost: 650 },
  snow_drift:     { kind: 'snow_drift', name: 'Snow Drift', biomeTags: ['tundra'], cost: 650 },
  frost_pine:     { kind: 'frost_pine', name: 'Frost Pine', biomeTags: ['tundra'], cost: 800 },
  ash_vent:       { kind: 'ash_vent', name: 'Ash Vent', biomeTags: ['volcanic'], cost: 850 },
  basalt_column:  { kind: 'basalt_column', name: 'Basalt Column', biomeTags: ['volcanic'], cost: 900 },
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
 * (25 − 25/fit)/100 × 48 h has supremum +12 h as fit → ∞ — and past a point fit opens
 * a DEAD WINDOW in which a dino sits at comfort 0, earning nothing, while its 8 h
 * grace runs out. The boundary is NOT a bare fit of 1.5. From src/core/clock.ts,
 *   escapeAt − hungerZero = GRACE_MS − (ESCAPE_COMFORT / fit) · drainMs
 * and drainMs is HUNGER_DRAIN_MS / drainMult, so the window opens iff
 *   fit · drainMult > 1.5,     drainMult = modProduct(traits, 'drain')
 * independent of hungerAtFed but NOT of the dino's traits. Fit 1.5 is only the
 * boundary for an untraited dino. `grazer` (income domain) and `skittish` (care
 * domain) each carry drain 1.20 and sit in DIFFERENT domains, so one dino may legally
 * hold both: drainMult 1.44, drainMs 33.33 h, boundary at fit 1.0417 — which BOTH
 * rungs clear. Measured against the real escapeAt on such a dino: −20 min (no window)
 * at fit 1.00, +3.81 min at 1.05, +25.45 min at 1.10. Pre-enrichment the case was
 * unreachable at every trait combination, because fit topped out at 1.00. It ships
 * because the window is bounded and small and income stays monotone in enrichment;
 * tests/enrichment.test.ts derives the worst legal drain product from TRAITS and fails
 * if a raised cap or a new drain trait makes the window large.
 * Every 0.05 also lands entirely in an endgame cash surplus that is already 94% unspent.
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
