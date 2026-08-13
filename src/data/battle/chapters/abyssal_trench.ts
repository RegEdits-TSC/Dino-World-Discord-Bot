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
        // hpMult 0.78, down from 1.3, so this boss clears the traited floor under Blood
        // Moon (enemyHp 1.15) as well as under neutral mods — see the event guard in
        // tests/battle-balance.test.ts. Measured at 400 seeds, the count that test uses:
        // Blood Moon traited 0.9225, neutral traited 1.0000, neutral untraited 0.9225.
        // Confirm at 3,000 and 10,000 before changing this number.
        //
        // This is deliberately below 1.0, retiring the "boss multipliers never fall
        // below 1.0" convention these files used to state. atkMult was the obvious way
        // to preserve it and was measured and rejected: at 1.05 it clears the Blood Moon
        // floor but lands neutral untraited at 0.8650 — below Containment Site's 0.8800
        // — inverting the monotone ladder. Cutting attack removes the threat outright;
        // cutting HP keeps the boss hitting just as hard and shortens how long the squad
        // is exposed to it. HP is the exposure knob, attack is the threat knob, and only
        // exposure has usable range here. atkMult stays at 1.25.
        //
        // 0.9225 untraited sits between Volcano Core's 0.9300 and Containment Site's
        // 0.8800, holding the campaign's monotonic ladder. Scale 0.65 also clears the
        // event floor but lands at 0.8550, BELOW Containment Site, which inverts the
        // ladder — the two late bosses must be tuned together, not independently.
        bossId: 'boss-abyssal_trench', title: 'The Trench Sovereign', speciesId: 'mosasaurus',
        levelBonus: 1, hpMult: 0.78, atkMult: 1.25, eggRarity: 'legendary', eggSpeciesId: 'mosasaurus',
      },
    },
  ],
};
