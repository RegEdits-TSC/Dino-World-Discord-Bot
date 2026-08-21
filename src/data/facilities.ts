import type { FacilityDef } from './types.js';

// See src/data/paddocks.ts for why this is a null-prototype map and why the `as` and the
// `satisfies` are both load-bearing.
export const FACILITIES: Record<string, FacilityDef> = Object.assign(
  Object.create(null) as Record<string, FacilityDef>,
  {
    visitor_center: {
      kind: 'visitor_center', name: 'Visitor Center', maxLevel: 5,
      incomeBonusPct: [0, 5, 10, 15, 20],
      capHours: [8, 12, 16, 20, 24],
      buildCost: 5_000, upgradeCosts: [12_500, 31_000, 78_000, 500_000],
    },
    hatchery_lab: {
      kind: 'hatchery_lab', name: 'Hatchery Lab', maxLevel: 5,
      incomeBonusPct: [0, 0, 0, 0, 0],
      incubatorSlots: [1, 2, 3, 4, 5],
      // 375,000 is the x2.5 interior step this curve uses; 2,250,000 is a x6.0 wall, the
      // multiple this facility's own L2->L3 step already used. Two steps = 2,625,000 =
      // 13.81 h of the 190,080/hr reference park, so these levels are content, not the
      // cash sink — the sink is the landmark ladder in src/data/landmarks.ts.
      // Slots are the binding endgame constraint: legendary egg supply is ~6.43/day
      // (3.80 shop + 0.63 expedition + 2.00 breeding) against 3 slots/day at L3.
      buildCost: 10_000, upgradeCosts: [25_000, 150_000, 375_000, 2_250_000],
    },
    food_court: {
      kind: 'food_court', name: 'Food Court', maxLevel: 3,
      incomeBonusPct: [4, 8, 12],
      buildCost: 8_000, upgradeCosts: [20_000, 200_000],
    },
    gene_lab: {
      kind: 'gene_lab', name: 'Gene Lab', maxLevel: 3,
      incomeBonusPct: [0, 0, 0],
      breedingSlots: [1, 2, 3],
      buildCost: 20_000, upgradeCosts: [60_000, 250_000],
    },
  } satisfies Record<string, FacilityDef>,
);
