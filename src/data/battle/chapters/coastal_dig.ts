import type { ChapterDef } from './index.js';

// Chapter 1 — Coastal Dig (unlockRating 0). Commons with a late rare splash;
// the boss is a rare Baryonyx haunting the cove. Rosters are authored
// weakest-first: squad-scaling fights the first N of the 3 enemies.
export const coastalDig: ChapterDef = {
  id: 'coastal_dig',
  name: 'Coastal Dig',
  tagline: 'Sun, sand, and something hunting in the surf.',
  stages: [
    {
      id: 'coastal_dig_1', name: 'Tidepool Scrappers', energyCost: 1, npcLevel: 1,
      enemies: [{ speciesId: 'compsognathus' }, { speciesId: 'struthiomimus' }, { speciesId: 'gallimimus' }],
      rewards: { cash: 40, xp: 30 }, firstClearShards: 2,
    },
    {
      id: 'coastal_dig_2', name: 'Dune Grazers', energyCost: 1, npcLevel: 2,
      enemies: [{ speciesId: 'othnielia' }, { speciesId: 'dryosaurus' }, { speciesId: 'triceratops' }],
      rewards: { cash: 55, food: { foodId: 'ferns', qty: 2 }, xp: 35 }, firstClearShards: 2,
    },
    {
      id: 'coastal_dig_3', name: 'Shorebreak Patrol', energyCost: 1, npcLevel: 2,
      enemies: [{ speciesId: 'microceratus' }, { speciesId: 'nasutoceratops' }, { speciesId: 'dilophosaurus' }],
      rewards: { cash: 70, xp: 40 }, firstClearShards: 2,
    },
    {
      id: 'coastal_dig_4', name: 'Riptide Hunters', energyCost: 2, npcLevel: 3,
      enemies: [{ speciesId: 'gallimimus' }, { speciesId: 'dilophosaurus' }, { speciesId: 'baryonyx' }],
      rewards: { cash: 90, food: { foodId: 'fish', qty: 2 }, xp: 50 }, firstClearShards: 3,
    },
    {
      id: 'coastal_dig_boss', name: "Old Riptooth's Cove", energyCost: 3, npcLevel: 3,
      enemies: [{ speciesId: 'nasutoceratops' }, { speciesId: 'dilophosaurus' }, { speciesId: 'baryonyx' }],
      rewards: { cash: 150, food: { foodId: 'fish', qty: 3 }, xp: 70 }, firstClearShards: 5,
      boss: {
        bossId: 'boss-coastal_dig', title: 'Old Riptooth', speciesId: 'baryonyx',
        levelBonus: 1, hpMult: 2.5, atkMult: 1.2, eggRarity: 'rare', eggSpeciesId: null,
      },
    },
  ],
};
