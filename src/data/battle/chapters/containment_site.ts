import type { ChapterDef } from './index.js';

// Chapter 6 — Containment Site (unlockRating 950). The lab's own hybrids, loose.
// Escorts stay epic-tier on the boss stage: simulation showed the escorts dominate
// the outcome far more than the boss's own multipliers do.
export const containmentSite: ChapterDef = {
  id: 'containment_site',
  name: 'Containment Site',
  tagline: 'Everything here was built on purpose. Nothing here stayed put.',
  stages: [
    {
      id: 'containment_site_1', name: 'Quarantine Wing', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'stegoceratops' }, { speciesId: 'ankylodocus' }, { speciesId: 'scorpios_rex' }],
      rewards: { cash: 850, xp: 260 }, firstClearShards: 7,
    },
    {
      id: 'containment_site_2', name: 'Gene Vault', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'ankylodocus' }, { speciesId: 'scorpios_rex' }, { speciesId: 'stegoceratops' }],
      rewards: { cash: 950, xp: 280 }, firstClearShards: 7,
    },
    {
      id: 'containment_site_3', name: 'Paddock Nine', energyCost: 1, npcLevel: 12,
      enemies: [{ speciesId: 'stegoceratops' }, { speciesId: 'scorpios_rex' }, { speciesId: 'spinoraptor' }],
      rewards: { cash: 1_050, food: { foodId: 'prime_steak', qty: 3 }, xp: 300 }, firstClearShards: 7,
    },
    {
      id: 'containment_site_4', name: 'Perimeter Breach', energyCost: 2, npcLevel: 12,
      enemies: [{ speciesId: 'scorpios_rex' }, { speciesId: 'ankylodocus' }, { speciesId: 'spinoraptor' }],
      rewards: { cash: 1_200, xp: 330 }, firstClearShards: 8,
    },
    {
      id: 'containment_site_boss', name: 'Asset 47', energyCost: 3, npcLevel: 11,
      enemies: [{ speciesId: 'scorpios_rex' }, { speciesId: 'stegoceratops' }, { speciesId: 'spinoraptor' }],
      rewards: { cash: 1_400, food: { foodId: 'prime_steak', qty: 5 }, xp: 370 }, firstClearShards: 16,
      boss: {
        // hpMult 1.72, down from 2.15, so this boss clears the traited floor under Blood
        // Moon (enemyHp 1.15) as well as under neutral mods — see the event guard in
        // tests/battle-balance.test.ts. Measured at 400 seeds, the count that test uses:
        // Blood Moon traited 0.8650, neutral traited 0.9725, neutral untraited 0.8800.
        //
        // The previous comment here claimed a "3,000-seed check: traited 0.90, untraited
        // 0.44". That was wrong: 0.44 is the 10,000-seed figure and the true 3,000-seed
        // untraited rate was 0.4310. Quote the seed count a number was actually measured
        // at, or the next author tunes against a figure that does not exist.
        //
        // This is the campaign's current finale (CAMPAIGN's last chapter), so its neutral
        // traited rate also has a <=0.99 upper bound; 0.9725 leaves real margin. atkMult
        // stays at 1.2 — see the Abyssal Trench boss comment for why attack is the wrong
        // lever for event compensation.
        //
        // 0.8800 untraited stays below Abyssal Trench's 0.9225, holding the monotonic
        // ladder. The two late bosses must be tuned together: fixing either alone breaks
        // the monotonicity assertion on the other.
        bossId: 'boss-containment_site', title: 'Asset 47', speciesId: 'spinoraptor',
        levelBonus: 1, hpMult: 1.72, atkMult: 1.2, eggRarity: 'legendary', eggSpeciesId: 'spinoraptor',
      },
    },
  ],
};
