import { describe, it, expect } from 'vitest';
import { CAMPAIGN, rosterFor, type StageDef } from '../src/data/battle/chapters/index.js';
import { statsFor } from '../src/data/battle/stats.js';
import { LEVEL_CAP } from '../src/data/battle/constants.js';
import { resolveBattle, type Combatant } from '../src/data/battle/resolve.js';
import { getSpecies } from '../src/data/species/index.js';
import { mulberry32 } from '../src/core/rolls.js';

// The strongest squad a player can actually field: three level-capped legendary
// bruisers. Mythics exist but cost 500 shards each against a 60/day sell cap, so
// a boss that only a triple-mythic roster can beat is a paywall, not a fight.
function squadOf(speciesId: string, traits: string[]): Combatant[] {
  const sp = getSpecies(speciesId);
  return [0, 1, 2].map((k) => {
    const s = statsFor(speciesId, LEVEL_CAP, traits);
    return {
      key: `p${k}`, name: `P${k}`, speciesId, archetype: sp.archetype,
      maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, side: 0 as const,
    };
  });
}

function npcsOf(stage: StageDef): Combatant[] {
  return rosterFor(stage, 3).map((e, i) => {
    const sp = getSpecies(e.speciesId);
    const s = statsFor(e.speciesId, stage.npcLevel + (e.boss?.levelBonus ?? 0));
    const hp = Math.round(s.hp * (e.boss?.hpMult ?? 1));
    return {
      key: `n${i}`, name: `N${i}`, speciesId: e.speciesId, archetype: sp.archetype,
      maxHp: hp, hp, atk: Math.round(s.atk * (e.boss?.atkMult ?? 1)),
      def: s.def, spd: s.spd, side: 1 as const,
    };
  });
}

function winRate(stage: StageDef, traits: string[], runs = 400): number {
  let won = 0;
  for (let seed = 0; seed < runs; seed++) {
    if (resolveBattle(squadOf('tyrannosaurus', traits), npcsOf(stage), mulberry32(seed)).won) won++;
  }
  return won / runs;
}

const BOSS_STAGES = CAMPAIGN.map((c) => ({ chapter: c.name, stage: c.stages[4] }));

// The finale is CAMPAIGN's last chapter, derived rather than hardcoded by id: when a
// seventh chapter ships, the upper-bound guard below automatically follows the new
// finale, and today's finale (Containment Site) is freed to become outclassed later,
// the same way the four chapters before it already have.
const FINALE = CAMPAIGN[CAMPAIGN.length - 1];

describe('boss difficulty bands', () => {
  // Lower bounds are the real hole this file closes: no boss, present or future, may
  // ship unwinnable (the Indominus draft that motivated this file measured 0-0.1%).
  // They apply to every boss, including the four chapters that shipped before this
  // branch — all four already clear both floors comfortably (0.93-1.00), untouched.
  it.each(BOSS_STAGES)('$chapter boss is not unwinnable for a traited legendary squad', ({ stage }) => {
    const rate = winRate(stage, ['savage']);
    expect(rate, `traited win rate ${rate}`).toBeGreaterThanOrEqual(0.85);
  });

  it.each(BOSS_STAGES)('$chapter boss still threatens an untraited legendary squad', ({ stage }) => {
    const rate = winRate(stage, []);
    expect(rate, `untraited win rate ${rate}`).toBeGreaterThanOrEqual(0.40);
  });

  // Machine gate for the escalating-difficulty invariant: each boss must be at least as
  // hard for an untraited squad as the one before it. This is what actually caught the
  // Abyssal Trench / Containment Site inversion (0.598 then 0.652 — chapter 6 was
  // EASIER than chapter 5) that motivated this file's monotonic check. A same-rate tie
  // is allowed (>=, not >) since two bosses can legitimately land on the same band edge.
  it('untraited win rates are non-increasing across the campaign', () => {
    const rates = BOSS_STAGES.map(({ chapter, stage }) => ({ chapter, rate: winRate(stage, []) }));
    for (let i = 1; i < rates.length; i++) {
      const prev = rates[i - 1];
      const cur = rates[i];
      expect(
        cur.rate,
        `${cur.chapter} (${cur.rate}) must not be easier than ${prev.chapter} (${prev.rate})`,
      ).toBeLessThanOrEqual(prev.rate);
    }
  });

  // The upper bound applies ONLY to the current finale, not to every boss ever shipped.
  // A maxed squad steamrolling early content it has badly outleveled is correct design —
  // Coastal Dig sits 9 levels below a level-capped squad on purpose — so holding every
  // past boss to a "must still be a real fight" ceiling would punish normal power
  // growth, not catch a defect. This guard exists so the campaign's HARDEST fight,
  // whichever chapter that currently is, still meaningfully threatens the best squad a
  // player can field, rather than also being a guaranteed win.
  it(`${FINALE.name} boss (the current finale) is not a guaranteed win for a traited legendary squad`, () => {
    const rate = winRate(FINALE.stages[4], ['savage']);
    expect(rate, `traited win rate ${rate}`).toBeLessThanOrEqual(0.99);
  });
});
