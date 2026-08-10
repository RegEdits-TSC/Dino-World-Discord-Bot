export type LandmarkBand = 'a' | 'b' | 'c';

export interface LandmarkDef { tier: number; name: string; cost: number; band: LandmarkBand }

/**
 * The endgame cash sink. Six rungs totalling 315,000,000 — roughly 47 days of the
 * reference park's unspent surplus (4,297,440/day) and 73 days at the income-maximal
 * build, against a game whose entire other purchasable content totals 1,674,000.
 * A single 5,000,000 item would be 1.16 days of surplus and would drain nothing.
 *
 * Purely cosmetic, and structurally so: the tier lives on users.landmark_tier, which
 * nothing in rating.ts, clock.ts, lotSlots or matchedKindCount reads. It deliberately
 * does NOT ship as DECOR kinds — recomputeRating sums `l.level + l.decor.length` as a
 * flat length, so a decor-shaped cosmetic would be worth +8.75 rating per tile to a
 * park below saturation and exactly 0 to a maxed one: power for the mid-game, nothing
 * for the endgame, precisely inverted.
 *
 * `band` selects the art (assets/images/park/landmark-<band>.webp) — three bands rather
 * than six rasters, so the monument visibly grows twice.
 */
export const LANDMARKS: readonly LandmarkDef[] = [
  { tier: 1, name: 'Stone Marker',    cost:   5_000_000, band: 'a' },
  { tier: 2, name: 'Fossil Plinth',   cost:  10_000_000, band: 'a' },
  { tier: 3, name: 'Bronze Sentinel', cost:  20_000_000, band: 'b' },
  { tier: 4, name: 'Amber Obelisk',   cost:  40_000_000, band: 'b' },
  { tier: 5, name: 'Grand Rotunda',   cost:  80_000_000, band: 'c' },
  { tier: 6, name: 'Titan Monument',  cost: 160_000_000, band: 'c' },
];

export const MAX_LANDMARK_TIER = LANDMARKS.length;

/** The rung at `tier`, or null for 0 (nothing built), a non-integer, or past the top. */
export function landmarkFor(tier: number): LandmarkDef | null {
  if (!Number.isInteger(tier) || tier < 1 || tier > MAX_LANDMARK_TIER) return null;
  return LANDMARKS[tier - 1];
}

export function landmarkCostFor(tier: number): number | null {
  return landmarkFor(tier)?.cost ?? null;
}

export function landmarkBandFor(tier: number): LandmarkBand | null {
  return landmarkFor(tier)?.band ?? null;
}
