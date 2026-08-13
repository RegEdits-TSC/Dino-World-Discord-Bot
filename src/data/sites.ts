import type { Rarity } from './types.js';

const M = 60_000, H = 3_600_000;

export interface SiteDef {
  id: string; name: string; unlockRating: number; durationMs: number; cost: number;
  eggOdds: Array<{ rarity: Rarity; weight: number }>;
  bonusCash: [number, number]; bonusFood: [number, number];
}

export const EXPEDITION_SITES: Record<string, SiteDef> = {
  coastal_dig:  { id: 'coastal_dig', name: 'Coastal Dig', unlockRating: 0, durationMs: 15 * M, cost: 200,
    eggOdds: [{ rarity: 'common', weight: 70 }, { rarity: 'uncommon', weight: 30 }], bonusCash: [50, 200], bonusFood: [2, 6] },
  amber_ridge:  { id: 'amber_ridge', name: 'Amber Ridge', unlockRating: 300, durationMs: 1 * H, cost: 1_000,
    eggOdds: [{ rarity: 'common', weight: 45 }, { rarity: 'uncommon', weight: 40 }, { rarity: 'rare', weight: 15 }], bonusCash: [200, 800], bonusFood: [4, 10] },
  frozen_cliffs:{ id: 'frozen_cliffs', name: 'Frozen Cliffs', unlockRating: 500, durationMs: 4 * H, cost: 4_000,
    eggOdds: [{ rarity: 'uncommon', weight: 40 }, { rarity: 'rare', weight: 40 }, { rarity: 'epic', weight: 20 }], bonusCash: [800, 2_500], bonusFood: [8, 20] },
  volcano_core: { id: 'volcano_core', name: 'Volcano Core', unlockRating: 800, durationMs: 8 * H, cost: 15_000,
    eggOdds: [{ rarity: 'rare', weight: 40 }, { rarity: 'epic', weight: 40 }, { rarity: 'legendary', weight: 19.8 }, { rarity: 'mythic', weight: 0.2 }], bonusCash: [3_000, 9_000], bonusFood: [20, 50] },
  abyssal_trench: { id: 'abyssal_trench', name: 'Abyssal Trench', unlockRating: 880, durationMs: 12 * H, cost: 40_000,
    eggOdds: [{ rarity: 'rare', weight: 25 }, { rarity: 'epic', weight: 45 }, { rarity: 'legendary', weight: 29 }, { rarity: 'mythic', weight: 1 }], bonusCash: [8_000, 20_000], bonusFood: [40, 90] },
  containment_site: { id: 'containment_site', name: 'Containment Site', unlockRating: 950, durationMs: 24 * H, cost: 100_000,
    eggOdds: [{ rarity: 'epic', weight: 35 }, { rarity: 'legendary', weight: 63 }, { rarity: 'mythic', weight: 2 }], bonusCash: [20_000, 50_000], bonusFood: [80, 180] },
  founders_park: { id: 'founders_park', name: "Founder's Park", unlockRating: 1000, durationMs: 48 * H, cost: 300_000,
    eggOdds: [{ rarity: 'epic', weight: 4 }, { rarity: 'legendary', weight: 90 }, { rarity: 'mythic', weight: 6 }], bonusCash: [50_000, 140_000], bonusFood: [200, 400] },
};
