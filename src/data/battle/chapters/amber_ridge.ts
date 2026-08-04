import type { ChapterDef } from './index.js';

// Chapter 2 — Amber Ridge (unlockRating 300). Uncommon herbivore herds give
// way to rare theropods; the boss is an epic-egg Allosaurus pack leader.
export const amberRidge: ChapterDef = {
  id: 'amber_ridge',
  name: 'Amber Ridge',
  tagline: 'Sunset cliffs with teeth in the shadows.',
  stages: [
    {
      id: 'amber_ridge_1', name: 'Ridge Runners', energyCost: 1, npcLevel: 3,
      enemies: [{ speciesId: 'dryosaurus' }, { speciesId: 'pachycephalosaurus' }, { speciesId: 'iguanodon' }],
      rewards: { cash: 90, xp: 50 }, firstClearShards: 3,
    },
    {
      id: 'amber_ridge_2', name: 'Amber Hollow', energyCost: 1, npcLevel: 4,
      enemies: [{ speciesId: 'parasaurolophus' }, { speciesId: 'ouranosaurus' }, { speciesId: 'stegosaurus' }],
      rewards: { cash: 110, xp: 60 }, firstClearShards: 3,
    },
    {
      id: 'amber_ridge_3', name: 'Sandstone Stampede', energyCost: 1, npcLevel: 4,
      enemies: [{ speciesId: 'iguanodon' }, { speciesId: 'stegosaurus' }, { speciesId: 'allosaurus' }],
      rewards: { cash: 130, food: { foodId: 'fruit_basket', qty: 2 }, xp: 70 }, firstClearShards: 3,
    },
    {
      id: 'amber_ridge_4', name: 'Cliffside Ambush', energyCost: 2, npcLevel: 5,
      enemies: [{ speciesId: 'pachycephalosaurus' }, { speciesId: 'ceratosaurus' }, { speciesId: 'allosaurus' }],
      rewards: { cash: 160, xp: 80 }, firstClearShards: 4,
    },
    {
      id: 'amber_ridge_boss', name: "The Alpha's Perch", energyCost: 3, npcLevel: 5,
      enemies: [{ speciesId: 'stegosaurus' }, { speciesId: 'ceratosaurus' }, { speciesId: 'allosaurus' }],
      rewards: { cash: 240, food: { foodId: 'goat', qty: 3 }, xp: 95 }, firstClearShards: 7,
      boss: {
        bossId: 'boss-amber_ridge', title: 'Ridgeback Alpha', speciesId: 'allosaurus',
        levelBonus: 1, hpMult: 2.5, atkMult: 1.2, eggRarity: 'epic', eggSpeciesId: null,
      },
    },
  ],
};
