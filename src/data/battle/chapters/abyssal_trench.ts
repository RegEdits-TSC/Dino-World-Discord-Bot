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
        // hpMult tuned down from an original 2.8 (tests/battle-balance.test.ts). atkMult
        // stays at its originally authored 1.25 — a boss must never hit softer than an
        // ordinary same-level enemy (atkMult < 1 is incoherent for the campaign's
        // hardest fights), so hpMult is the only lever here. mosasaurus is a TANK
        // archetype (1.35x hp, 1.4x def before this multiplier), and simulated losses
        // at the original 2.8 were squad wipes around round 12-13 of a 30-round cap —
        // not attrition timeouts — so the fix is a shorter kill race, not a softer hit:
        // less boss HP means the squad finishes the fight before it accumulates lethal
        // damage taken, without the boss ever hitting below its species baseline.
        bossId: 'boss-abyssal_trench', title: 'The Trench Sovereign', speciesId: 'mosasaurus',
        levelBonus: 1, hpMult: 1.2, atkMult: 1.25, eggRarity: 'legendary', eggSpeciesId: 'mosasaurus',
      },
    },
  ],
};
