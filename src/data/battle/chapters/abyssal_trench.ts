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
        // hpMult 0.82, up from 0.78 (itself down from 1.3). 0.78 cleared every
        // per-chapter assertion at the 400 seeds those assertions use — Blood Moon
        // traited 0.9225, neutral traited 1.0000, neutral untraited 0.9225, correctly
        // below Volcano Core's 400-seed 0.9300 — but that ordering was sampling luck,
        // not margin: at 1,000/3,000/10,000 seeds untraited neutral read 0.9310 / 0.9377
        // / 0.9405, rising PAST Volcano Core's own declining 0.9270 / 0.9173 / 0.9064.
        // Chapter 5 was genuinely easier than chapter 4 once sampled past 400 seeds —
        // the same inversion class this file's monotone-ladder guard exists to catch,
        // invisible at the seed count it ran at.
        //
        // At 0.82, re-measured: neutral untraited is 0.8825 (400 seeds) / 0.9127 (3,000)
        // — the latter correctly BETWEEN Volcano Core's 3,000-seed 0.9173 and
        // Containment Site's 3,000-seed 0.8750, a real margin rather than a tolerated
        // one. Blood Moon traited (savage) stays comfortably above the 0.85 floor: 0.8975
        // at 400 seeds, 0.9203 at 3,000. tests/battle-balance.test.ts's monotone-ladder
        // check now runs at 3,000 seeds specifically (with a 0.03 tolerance) for exactly
        // this reason — confirm any future change to this number at 3,000 seeds, not 400.
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
        // The two late bosses must be tuned together, not independently — a change to
        // either one moves where it lands relative to the other's own number, and both
        // sides of that comparison need to be re-measured at 3,000 seeds before either
        // hpMult moves again.
        bossId: 'boss-abyssal_trench', title: 'The Trench Sovereign', speciesId: 'mosasaurus',
        levelBonus: 1, hpMult: 0.82, atkMult: 1.25, eggRarity: 'legendary', eggSpeciesId: 'mosasaurus',
      },
    },
  ],
};
