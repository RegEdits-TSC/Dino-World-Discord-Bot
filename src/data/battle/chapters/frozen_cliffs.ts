import type { ChapterDef } from './index.js';

// Chapter 3 — Frozen Cliffs (unlockRating 250). Rare packs escalating into
// epics; the boss is a legendary-egg Quetzalcoatlus nesting on the cliffs.
export const frozenCliffs: ChapterDef = {
  id: 'frozen_cliffs',
  name: 'Frozen Cliffs',
  tagline: 'The ice remembers what it buried.',
  stages: [
    {
      id: 'frozen_cliffs_1', name: 'Glacier Scouts', energyCost: 1, npcLevel: 5,
      enemies: [{ speciesId: 'maiasaura' }, { speciesId: 'velociraptor' }, { speciesId: 'ankylosaurus' }],
      rewards: { cash: 150, xp: 75 }, firstClearShards: 4,
    },
    {
      id: 'frozen_cliffs_2', name: 'Icefall Pack', energyCost: 1, npcLevel: 6,
      enemies: [{ speciesId: 'dilophosaurus' }, { speciesId: 'velociraptor' }, { speciesId: 'carnotaurus' }],
      rewards: { cash: 180, food: { foodId: 'goat', qty: 2 }, xp: 85 }, firstClearShards: 4,
    },
    {
      id: 'frozen_cliffs_3', name: 'Frozen Shelf', energyCost: 1, npcLevel: 6,
      enemies: [{ speciesId: 'ankylosaurus' }, { speciesId: 'ceratosaurus' }, { speciesId: 'therizinosaurus' }],
      rewards: { cash: 210, xp: 95 }, firstClearShards: 4,
    },
    {
      id: 'frozen_cliffs_4', name: 'Aurora Hunt', energyCost: 2, npcLevel: 7,
      enemies: [{ speciesId: 'velociraptor' }, { speciesId: 'therizinosaurus' }, { speciesId: 'spinosaurus' }],
      rewards: { cash: 250, xp: 105 }, firstClearShards: 5,
    },
    {
      id: 'frozen_cliffs_boss', name: "Stormwing's Eyrie", energyCost: 3, npcLevel: 7,
      enemies: [{ speciesId: 'carnotaurus' }, { speciesId: 'therizinosaurus' }, { speciesId: 'quetzalcoatlus' }],
      rewards: { cash: 330, food: { foodId: 'royal_greens', qty: 3 }, xp: 120 }, firstClearShards: 9,
      boss: {
        bossId: 'boss-frozen_cliffs', title: 'Stormwing', speciesId: 'quetzalcoatlus',
        levelBonus: 2, hpMult: 2.5, atkMult: 1.2, eggRarity: 'legendary', eggSpeciesId: null,
      },
    },
  ],
};
