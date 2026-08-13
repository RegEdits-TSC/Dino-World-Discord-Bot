import type { ChapterDef } from './index.js';

// Chapter 7 — Founder's Park. The ORIGINAL park, the one everything escaped from,
// now fully overrun: its own headline attractions gone feral, with the lab's last
// asset at the centre. Gated on campaign STARS (75), not park rating — see
// chapterUnlocked. The chapter escalates on theme and reward, not on difficulty.
export const foundersPark: ChapterDef = {
  id: 'founders_park',
  name: "Founder's Park",
  tagline: 'The first park. Everything that ever got out has come home.',
  starGate: 75,
  stages: [
    {
      id: 'founders_park_1', name: 'The Turnstiles', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'therizinosaurus' }, { speciesId: 'pachyrhinosaurus' }, { speciesId: 'spinosaurus' }],
      rewards: { cash: 1_000, xp: 300 }, firstClearShards: 7,
    },
    {
      id: 'founders_park_2', name: 'Collapsed Aviary', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'pachyrhinosaurus' }, { speciesId: 'spinosaurus' }, { speciesId: 'quetzalcoatlus' }],
      rewards: { cash: 1_150, xp: 325 }, firstClearShards: 7,
    },
    {
      id: 'founders_park_3', name: 'The Lagoon Walk', energyCost: 1, npcLevel: 12,
      enemies: [{ speciesId: 'therizinosaurus' }, { speciesId: 'deinosuchus' }, { speciesId: 'spinosaurus' }],
      rewards: { cash: 1_300, food: { foodId: 'prime_steak', qty: 4 }, xp: 350 }, firstClearShards: 7,
    },
    {
      id: 'founders_park_4', name: "Founder's Statue", energyCost: 2, npcLevel: 12,
      enemies: [{ speciesId: 'giganotosaurus' }, { speciesId: 'spinosaurus' }, { speciesId: 'tyrannosaurus' }],
      rewards: { cash: 1_500, xp: 385 }, firstClearShards: 8,
    },
    {
      id: 'founders_park_boss', name: 'The Last Asset', energyCost: 3, npcLevel: 11,
      enemies: [{ speciesId: 'spinosaurus' }, { speciesId: 'giganotosaurus' }, { speciesId: 'ultimasaurus' }],
      rewards: { cash: 1_750, food: { foodId: 'prime_steak', qty: 6 }, xp: 430 }, firstClearShards: 16,
      boss: {
        // Measured with tests/battle-balance.test.ts's own harness (3x level-capped
        // tyrannosaurus; the probe reproduced Abyssal Trench 0.9127 and Containment Site
        // 0.8750 to 4 dp before any of these were taken):
        //   untraited @3,000 seeds  0.8330   (floor 0.40; ladder allows <= 0.8850)
        //   savage    @400          1.0000   (floor 0.85)
        //   Blood Moon savage @400  0.9250   (floor 0.85)
        //   fleet 0.8725 · ironhide 0.9200 · glass_cannon 0.9975 · strongest 1.0000 (savage)
        // Note the strongest trait INVERTS versus Containment Site, where fleet was the
        // ceiling (0.9987) and savage only 0.9827: a 731 HP boss with atkMult 1.10 rewards
        // raw damage, where a 1.72x-HP boss rewarded acting first.
        //
        // THREE THINGS A FUTURE TUNER MUST KNOW ABOUT THIS BOSS.
        //
        // 1. The escorts are epic ON PURPOSE and must stay epic. Legendary escorts make
        //    this stage unwinnable at EVERY multiplier: with tyrannosaurus + spinoraptor,
        //    all 209 cells of hpMult 0.30..1.20 x atkMult 0.80..1.30 fail all three floors
        //    at once (best: 0.0257 untraited against a 0.40 floor). A legendary bruiser at
        //    L11 is 477/121/42/82 — strictly stronger than a level-capped PLAYER dino
        //    (455/116/40/79) on every stat — in front of a 974 HP / 107 DEF mythic tank.
        //    The only cells that satisfy the floors sit at hpMult 0.09-0.13, i.e. a 107 HP
        //    finale boss: an hpMult chosen to defeat a test. Mythic escorts (indominus +
        //    indoraptor) measure 0.0000 on every metric at every grid point.
        //
        // 2. hpMult is NOT monotone in difficulty below 0.33727. resolveBattle focus-fires
        //    the lowest-HP live enemy; boss HP is round(974 * hpMult) and each epic escort
        //    is 329, so below that crossover the BOSS is the lowest-HP enemy, gets focused
        //    from round 1, and the win rate RISES as hpMult falls (measured at atkMult 3.0
        //    to make it visible: 0.3113 at 0.3372, 0.5710 at 0.30, 0.8470 at 0.20). 0.75
        //    sits 2.22x above the crossover and the 0.70-0.80 sweep is strictly monotone at
        //    about -0.017 per +0.01. A future author cutting HP to compensate for a world
        //    event — following the "HP is the exposure knob" rule — could walk under 0.34
        //    and produce a boss that gets EASIER as they make it tankier. Nothing in the
        //    suite would catch it: the whole sub-crossover region reads 1.0000.
        //
        // 3. Escort species affects combat ONLY through (rarity, archetype). spinoraptor +
        //    spinoraptor measured identical to 4 dp against tyrannosaurus + spinoraptor.
        //    Swapping escort species changes the embed text and the enemy art and nothing
        //    else — the combat twin of "art is keyed on archetype x diet, never species".
        //
        // atkMult 1.10 is deliberately ABOVE 1.0: exposure (hpMult) does all the work here,
        // per the exposure-knob/threat-knob rule. npcLevel 11 + levelBonus 1 = 12 is exactly
        // at NPC_LEVEL_SANITY_CAP, with zero headroom — that cap does not move.
        //
        // The campaign's first mythic boss egg, pinned to the boss's own species. It is a
        // ONE-SHOT (service.ts grants it on firstClear only), which is why it is pinned
        // rather than rolled: there is no repeat attempt for a spread to pay off over.
        bossId: 'boss-founders_park', title: 'The Last Asset', speciesId: 'ultimasaurus',
        levelBonus: 1, hpMult: 0.75, atkMult: 1.10, eggRarity: 'mythic', eggSpeciesId: 'ultimasaurus',
      },
    },
  ],
};
