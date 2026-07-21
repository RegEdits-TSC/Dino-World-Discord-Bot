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
  amber_ridge:  { id: 'amber_ridge', name: 'Amber Ridge', unlockRating: 150, durationMs: 1 * H, cost: 1_000,
    eggOdds: [{ rarity: 'common', weight: 45 }, { rarity: 'uncommon', weight: 40 }, { rarity: 'rare', weight: 15 }], bonusCash: [200, 800], bonusFood: [4, 10] },
  frozen_cliffs:{ id: 'frozen_cliffs', name: 'Frozen Cliffs', unlockRating: 250, durationMs: 4 * H, cost: 4_000,
    eggOdds: [{ rarity: 'uncommon', weight: 40 }, { rarity: 'rare', weight: 40 }, { rarity: 'epic', weight: 20 }], bonusCash: [800, 2_500], bonusFood: [8, 20] },
  volcano_core: { id: 'volcano_core', name: 'Volcano Core', unlockRating: 400, durationMs: 8 * H, cost: 15_000,
    eggOdds: [{ rarity: 'rare', weight: 40 }, { rarity: 'epic', weight: 40 }, { rarity: 'legendary', weight: 19.8 }, { rarity: 'mythic', weight: 0.2 }], bonusCash: [3_000, 9_000], bonusFood: [20, 50] },
};
