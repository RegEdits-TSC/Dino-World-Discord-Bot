import type { ChapterDef } from './index.js';

// Chapter 4 — Volcano Core (unlockRating 400). Epic and legendary theropods;
// the finale pins a thematic legendary trophy egg (tyrannosaurus) — never
// mythic, which would undercut the 500-shard mythic purchase.
export const volcanoCore: ChapterDef = {
  id: 'volcano_core',
  name: 'Volcano Core',
  tagline: 'Only tyrants walk the caldera.',
  stages: [
    {
      id: 'volcano_core_1', name: 'Ashfield Prowlers', energyCost: 1, npcLevel: 7,
      enemies: [{ speciesId: 'carnotaurus' }, { speciesId: 'allosaurus' }, { speciesId: 'giganotosaurus' }],
      rewards: { cash: 220, xp: 100 }, firstClearShards: 5,
    },
    {
      id: 'volcano_core_2', name: 'Lava Tube Lurkers', energyCost: 1, npcLevel: 8,
      enemies: [{ speciesId: 'ceratosaurus' }, { speciesId: 'spinosaurus' }, { speciesId: 'giganotosaurus' }],
      rewards: { cash: 260, xp: 110 }, firstClearShards: 5,
    },
    {
      id: 'volcano_core_3', name: 'Obsidian Wastes', energyCost: 1, npcLevel: 8,
      enemies: [{ speciesId: 'spinosaurus' }, { speciesId: 'giganotosaurus' }, { speciesId: 'tyrannosaurus' }],
      rewards: { cash: 300, food: { foodId: 'prime_steak', qty: 2 }, xp: 120 }, firstClearShards: 5,
    },
    {
      id: 'volcano_core_4', name: 'Caldera Rim', energyCost: 2, npcLevel: 9,
      enemies: [{ speciesId: 'spinosaurus' }, { speciesId: 'quetzalcoatlus' }, { speciesId: 'tyrannosaurus' }],
      rewards: { cash: 350, xp: 135 }, firstClearShards: 6,
    },
    {
      id: 'volcano_core_boss', name: 'Throne of the Tyrant', energyCost: 3, npcLevel: 9,
      enemies: [{ speciesId: 'carnotaurus' }, { speciesId: 'giganotosaurus' }, { speciesId: 'tyrannosaurus' }],
      rewards: { cash: 400, food: { foodId: 'prime_steak', qty: 4 }, xp: 150 }, firstClearShards: 12,
      boss: {
        bossId: 'boss-volcano_core', title: 'The Tyrant King', speciesId: 'tyrannosaurus',
        levelBonus: 2, hpMult: 2.5, atkMult: 1.2, eggRarity: 'legendary', eggSpeciesId: 'tyrannosaurus',
      },
    },
  ],
};
