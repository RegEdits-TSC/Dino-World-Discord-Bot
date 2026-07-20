import type { FacilityDef } from './types.js';
export const FACILITIES: Record<string, FacilityDef> = {
  visitor_center: {
    kind: 'visitor_center', name: 'Visitor Center', maxLevel: 5,
    incomeBonusPct: [0, 5, 10, 15, 20],
    capHours: [8, 12, 16, 20, 24],
    buildCost: 5_000, upgradeCosts: [12_500, 31_000, 78_000, 500_000],
  },
  hatchery_lab: {
    kind: 'hatchery_lab', name: 'Hatchery Lab', maxLevel: 3,
    incomeBonusPct: [0, 0, 0],
    incubatorSlots: [1, 2, 3],
    buildCost: 10_000, upgradeCosts: [25_000, 150_000],
  },
  food_court: {
    kind: 'food_court', name: 'Food Court', maxLevel: 3,
    incomeBonusPct: [4, 8, 12],
    buildCost: 8_000, upgradeCosts: [20_000, 200_000],
  },
};
