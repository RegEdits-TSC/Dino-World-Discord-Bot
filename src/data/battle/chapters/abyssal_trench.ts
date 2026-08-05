import type { ChapterDef } from './index.js';

// Chapter 5 — Abyssal Trench (unlockRating 880). Marine reptiles, escalating from
// the rare plesiosaurs on the shelf to the legendary hunters in the dark. The boss
// is legendary-base on purpose: player power is capped at level 10 and one combat
// trait, so a mythic-base boss is unwinnable rather than hard.
export const abyssalTrench: ChapterDef = {
  id: 'abyssal_trench',
  name: 'Abyssal Trench',
  tagline: 'The pressure down here kills faster than the teeth.',
  stages: [
    {
      id: 'abyssal_trench_1', name: 'The Drop-Off', energyCost: 1, npcLevel: 10,
      enemies: [{ speciesId: 'elasmosaurus' }, { speciesId: 'tylosaurus' }, { speciesId: 'kronosaurus' }],
      rewards: { cash: 460, xp: 165 }, firstClearShards: 6,
    },
    {
      id: 'abyssal_trench_2', name: 'Kelp Gloom', energyCost: 1, npcLevel: 10,
      enemies: [{ speciesId: 'tylosaurus' }, { speciesId: 'kronosaurus' }, { speciesId: 'liopleurodon' }],
      rewards: { cash: 520, xp: 180 }, firstClearShards: 6,
    },
    {
      id: 'abyssal_trench_3', name: 'Hydrothermal Vents', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'kronosaurus' }, { speciesId: 'liopleurodon' }, { speciesId: 'mosasaurus' }],
      rewards: { cash: 580, food: { foodId: 'fish', qty: 3 }, xp: 195 }, firstClearShards: 6,
    },
    {
      id: 'abyssal_trench_4', name: 'The Black Smoker', energyCost: 2, npcLevel: 11,
      enemies: [{ speciesId: 'kronosaurus' }, { speciesId: 'mosasaurus' }, { speciesId: 'liopleurodon' }],
      rewards: { cash: 650, xp: 215 }, firstClearShards: 7,
    },
    {
      id: 'abyssal_trench_boss', name: 'Sovereign of the Trench', energyCost: 3, npcLevel: 11,
      enemies: [{ speciesId: 'kronosaurus' }, { speciesId: 'liopleurodon' }, { speciesId: 'mosasaurus' }],
      rewards: { cash: 750, food: { foodId: 'fish', qty: 5 }, xp: 240 }, firstClearShards: 14,
      boss: {
        // hpMult retuned from an original 2.8, then a first-draft floor of 1.2
        // (tests/battle-balance.test.ts) that overcorrected: 1.2 left this boss's
        // resolved HP (806) and untraited win rate (0.60) both weaker than Volcano
        // Core's (1193 / 0.92), inverting the campaign's difficulty ladder against
        // Containment Site. atkMult stays at its originally authored 1.25: boss
        // multipliers never fall below 1.0, though archetype multipliers still apply
        // on top, so this tank boss (1.35x hp, 1.4x def, 0.8x atk before hpMult/atkMult)
        // can still resolve to a lower attack than a bruiser escort standing beside it.
        // A full return to hpMult 2.8 was simulated and reproduced the original
        // squad-wipe failure — traited win rate collapses well under the 0.85 floor,
        // and untraited under the 0.40 floor, long before resolved HP reaches 1193.
        // 1.3 is the measured ceiling that keeps both floors comfortably clear
        // (3,000-seed check: traited 0.96, untraited 0.49) while raising resolved
        // HP from 806 to 874 — real headroom, though short of full parity with
        // Volcano Core's 1193, which this archetype cannot reach without breaking
        // the win-rate floors. tests/battle-balance.test.ts's monotonic-ladder
        // assertion is what actually enforces the escalation now.
        bossId: 'boss-abyssal_trench', title: 'The Trench Sovereign', speciesId: 'mosasaurus',
        levelBonus: 1, hpMult: 1.3, atkMult: 1.25, eggRarity: 'legendary', eggSpeciesId: 'mosasaurus',
      },
    },
  ],
};
