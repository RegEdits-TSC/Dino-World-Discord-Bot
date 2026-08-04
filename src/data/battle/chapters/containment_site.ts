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
        // hpMult tuned down from an original 3.0 (tests/battle-balance.test.ts). atkMult
        // stays at its originally authored 1.2, same rationale as the Abyssal Trench
        // boss: atkMult must never drop below 1.0 (a boss hitting softer than an
        // ordinary same-level enemy is incoherent), so hpMult alone carries the retune.
        // This is the campaign's current finale (CAMPAIGN's last chapter), so its
        // traited win rate also has an upper bound — see tests/battle-balance.test.ts.
        bossId: 'boss-containment_site', title: 'Asset 47', speciesId: 'spinoraptor',
        levelBonus: 1, hpMult: 2.0, atkMult: 1.2, eggRarity: 'legendary', eggSpeciesId: 'spinoraptor',
      },
    },
  ],
};
