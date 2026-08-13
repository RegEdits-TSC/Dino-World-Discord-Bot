import { describe, it, expect } from 'vitest';
import { CAMPAIGN, rosterFor, type StageDef } from '../src/data/battle/chapters/index.js';
import { statsFor } from '../src/data/battle/stats.js';
import { LEVEL_CAP } from '../src/data/battle/constants.js';
import { resolveBattle, starsFor, type Combatant } from '../src/data/battle/resolve.js';
import { getSpecies } from '../src/data/species/index.js';
import { mulberry32 } from '../src/core/rolls.js';
import { NEUTRAL_MODS, WORLD_EVENTS, type EventMods } from '../src/data/world-events.js';

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

function npcsOf(stage: StageDef, mods: EventMods = NEUTRAL_MODS): Combatant[] {
  return rosterFor(stage, 3).map((e, i) => {
    const sp = getSpecies(e.speciesId);
    const s = statsFor(e.speciesId, stage.npcLevel + (e.boss?.levelBonus ?? 0));
    // Same order and rounding as src/modules/battles/service.ts:109.
    const hp = Math.round(s.hp * (e.boss?.hpMult ?? 1) * mods.enemyHp);
    return {
      key: `n${i}`, name: `N${i}`, speciesId: e.speciesId, archetype: sp.archetype,
      maxHp: hp, hp, atk: Math.round(s.atk * (e.boss?.atkMult ?? 1)),
      def: s.def, spd: s.spd, side: 1 as const,
    };
  });
}

function winRate(stage: StageDef, traits: string[], runs = 400, mods: EventMods = NEUTRAL_MODS): number {
  let won = 0;
  for (let seed = 0; seed < runs; seed++) {
    if (resolveBattle(squadOf('tyrannosaurus', traits), npcsOf(stage, mods), mulberry32(seed)).won) won++;
  }
  return won / runs;
}

const BOSS_STAGES = CAMPAIGN.map((c) => ({ chapter: c.name, stage: c.stages[4] }));

// The finale is CAMPAIGN's last chapter, derived rather than hardcoded by id — so the
// guard below is a TWO-SIDED CHANGE DETECTOR, not a one-sided pin, and "automatically
// follows the new finale" is a hazard here, not a benefit. When a seventh chapter ships,
// this test retargets to it automatically and re-measures the untraited rate against IT:
// any real content change — a HARDER new finale or an EASIER one — moves that rate outside
// the recorded constant's band and fails the detector. That failure is not a defect in the
// new content — it means the recorded constant needs deliberate re-measurement and
// re-approval by whoever adds the chapter, not silent acceptance of the failure or a
// silent widen of the band to make it pass.
const FINALE = CAMPAIGN[CAMPAIGN.length - 1];

// Five traits share domain: 'combat' (src/data/traits.ts) — savage, ironhide, fleet,
// glass_cannon, and frail — but a dino carries exactly one, and frail is strictly worse
// than fielding no combat trait at all (-10% HP, no offsetting gain), so it can never be
// part of the strongest loadout: measured the same way as the four below, frail lands at
// 0.5775, far under all of them. COMBAT_TRAITS below is therefore the four
// POSITIVE/mixed combat traits, deliberately excluding frail, and "the strongest squad a
// player can field" means a Math.max over these four loadouts, never one hardcoded
// trait. They are not equally strong: measured against Containment Site's shipped
// hpMult 1.72 at 3,000 seeds, fleet (0.9987) clears savage (0.9827), ironhide (0.9140)
// and glass_cannon (0.8757) by a wide margin. A guard that only ever measured savage was
// blind to that.
const COMBAT_TRAITS = ['savage', 'fleet', 'ironhide', 'glass_cannon'];

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
  //
  // Runs at 3,000 seeds here — not the 400 every other assertion in this file uses —
  // and with an explicit 0.03 tolerance, for a reason discovered the hard way: at 400
  // seeds, Abyssal Trench's PREVIOUS hpMult (0.78) read 0.9225 untraited, correctly
  // below Volcano Core's 0.9300. But that ordering was sampling luck, not a real
  // margin — at 1,000/3,000/10,000 seeds the same pair inverted (Abyssal 0.9310 /
  // 0.9377 / 0.9405 rising PAST Volcano's declining 0.9270 / 0.9173 / 0.9064), the exact
  // defect class this assertion exists to catch, invisible at the seed count the test
  // actually ran at. Abyssal Trench's hpMult moved 0.78 -> 0.82 to fix the inversion for
  // real (see that boss's own comment for the full numbers: 3,000-seed untraited neutral
  // is now 0.9127, correctly between Volcano's 0.9173 and Containment Site's 0.8750).
  // Both changes were needed together: raising the seed count alone would have just
  // turned a passing-by-luck test into a failing-and-honest one without fixing the
  // content, and fixing the content alone would have left the NEXT such inversion
  // sitting undetected behind the same 400-seed blind spot. The 0.03 tolerance absorbs
  // ordinary sampling drift (Volcano alone moves 0.9300 -> 0.9173 between 400 and 3,000
  // seeds, a 0.0127 swing) while still catching the 5.4-point inversion that motivated
  // this guard in the first place.
  //
  // Tolerance tightened 0.03 -> 0.01 with chapter 7. 0.03 would MISS a revert of Abyssal
  // Trench's hpMult 0.82 -> 0.78, a +0.0203 inversion; 0.01 catches it with 2x margin and
  // costs nothing, because the largest positive adjacent delta across shipped content at
  // 3,000 seeds is exactly 0.0000 (measured: 1.0000, 1.0000, 1.0000, 0.9173, 0.9127,
  // 0.8750, 0.8330).
  //
  // The seed count is pinned DOWN, not up, and this is the reason: at 10,000 seeds the
  // Volcano Core -> Abyssal Trench pair INVERTS by +0.0100 on shipped content (Volcano
  // 0.9064, Abyssal 0.9164). 4b's Abyssal fix holds at 3,000 and fails at 10,000. Raising
  // the seed count is therefore a CONTENT decision — it would require re-tuning two live
  // bosses together — not a free rigour upgrade. Do not raise it casually.
  it('untraited win rates are non-increasing across the campaign, at 3,000 seeds', () => {
    const LADDER_SEEDS = 3000;
    const TOLERANCE = 0.01;
    const rates = BOSS_STAGES.map(({ chapter, stage }) => ({ chapter, rate: winRate(stage, [], LADDER_SEEDS) }));
    for (let i = 1; i < rates.length; i++) {
      const prev = rates[i - 1];
      const cur = rates[i];
      expect(
        cur.rate,
        `${cur.chapter} (${cur.rate}) must not be more than ${TOLERANCE} easier than ${prev.chapter} (${prev.rate})`,
      ).toBeLessThanOrEqual(prev.rate + TOLERANCE);
    }
  });

  // Containment Site's own hpMult trade-off reasoning (1.72 buys the Blood Moon floor
  // below at the cost of a fleet squad clearing it outright on a normal day) now belongs
  // with the chapter-6 detector below, not here.
  //
  // CHANGE DETECTOR, not a correctness bound. It fails on any movement in EITHER
  // direction, which is the point: a moved number must be re-measured and re-approved,
  // never merged silently. A one-sided bound could only ever catch half of that, and the
  // >=0.995 lower bound this replaces had the additional problem of reading as a demand
  // that the finale be EASY — a genuinely harder future finale would fail it and the
  // failure would look like the good content was the defect.
  //
  // It measures the UNTRAITED rate rather than the strongest loadout, and that choice is
  // forced. Founder's Park measures 1.0000 on the strongest-of-four axis — the saturated
  // maximum — so RECORDED + BAND is unreachable there by construction and the detector
  // would silently degenerate into the same one-sided bound. The untraited rate is
  // non-degenerate in both directions, and a +/-0.01 band is strictly tighter than the
  // ladder's implied <= 0.8850, so this is not merely a restatement of the assertion
  // above it either.
  //
  // Strongest-loadout figures for the record, measured at 400 seeds and NOT asserted on:
  // savage 1.0000, glass_cannon 0.9975, ironhide 0.9200, fleet 0.8725. Which trait is
  // strongest is chapter-dependent — on Containment Site it was fleet (0.9987) with savage
  // at 0.9827, and it inverts here. That is exactly why a strongest-loadout pin is a weak
  // instrument. frail is excluded from COMBAT_TRAITS throughout because it is strictly
  // worse than fielding no combat trait at all (measured 0.5775 on Containment Site,
  // 0.3950 here).
  const DETECTOR_BAND = 0.01;
  const FINALE_UNTRAITED = 0.8330;      // founders_park_boss, untraited, 3,000 seeds
  const CONTAINMENT_UNTRAITED = 0.8750; // containment_site_boss, untraited, 3,000 seeds

  it(`${FINALE.name} boss (the current finale): untraited rate is pinned within ±${DETECTOR_BAND}`, () => {
    const rate = winRate(FINALE.stages[4], [], 3000);
    const msg = `CHANGE DETECTOR: the finale's untraited rate is ${rate}, recorded as ${FINALE_UNTRAITED}. `
      + 'Re-measure at 3,000 seeds and update the recorded constant deliberately. Do not widen the band.';
    expect(rate, msg).toBeGreaterThanOrEqual(FINALE_UNTRAITED - DETECTOR_BAND);
    expect(rate, msg).toBeLessThanOrEqual(FINALE_UNTRAITED + DETECTOR_BAND);
  });

  // Pinned by id, NOT derived. The test above follows CAMPAIGN's last chapter, so the
  // moment a chapter ships it stops measuring the previous one — chapter 6 would have
  // become entirely unmeasured, with the suite green and the guard silently gone. Every
  // future chapter needs the same treatment for its predecessor.
  it('Containment Site boss (chapter 6) stays measured after the finale moved past it', () => {
    const stage = CAMPAIGN.find((c) => c.id === 'containment_site')!.stages[4];
    const rate = winRate(stage, [], 3000);
    const msg = `CHANGE DETECTOR: chapter 6's untraited rate is ${rate}, recorded as ${CONTAINMENT_UNTRAITED}. `
      + 'Re-measure at 3,000 seeds and update the recorded constant deliberately. Do not widen the band.';
    expect(rate, msg).toBeGreaterThanOrEqual(CONTAINMENT_UNTRAITED - DETECTOR_BAND);
    expect(rate, msg).toBeLessThanOrEqual(CONTAINMENT_UNTRAITED + DETECTOR_BAND);
  });
});

// Blood Moon is the only event that touches combat today: enemyHp 1.15, applied to
// every enemy including escorts (src/modules/battles/service.ts:109). It runs roughly
// one day in eight, and before this guard existed nothing in the suite ever measured a
// boss under an event — chapters 5 and 6 sat at 0.50 and 0.40 traited on those days,
// far under the floor every other day asserts.
//
// The worst case is DERIVED from WORLD_EVENTS, never hardcoded to blood_moon's id — a
// future event that also sets enemyHp would otherwise reopen exactly the hole this
// guard closes, silently, the same way a hardcoded `savage` reopened the finale ceiling
// guard above. Deriving from the max across every event's mods means this test follows
// whichever event is worst without anyone having to remember to update it.
//
// Only the TRAITED floor is asserted here. Requiring >=0.40 untraited under the event
// too is unsatisfiable without flattening the late campaign: the configurations that
// reach it push neutral untraited rates out of monotone order. Blood Moon stays a real
// difficulty spike — it also pays +50% battle XP and -1 energy — but a prepared squad
// can always win.
describe('boss difficulty under world events', () => {
  const WORST_ENEMY_HP = Math.max(...WORLD_EVENTS.map((e) => e.mods.enemyHp ?? 1));
  const MODS: EventMods = { ...NEUTRAL_MODS, enemyHp: WORST_ENEMY_HP };

  it.each(BOSS_STAGES)('$chapter boss stays winnable for a traited squad under the worst combat event', ({ stage }) => {
    const rate = winRate(stage, ['savage'], 400, MODS);
    expect(rate, `worst-case event traited win rate ${rate}`).toBeGreaterThanOrEqual(0.85);
  });
});

// A starGate is authored data that can be wrong in a way nothing else catches: too high and
// the chapter is content nobody can ever open. The structural bound (3 stars x 5 stages x
// chapters-before-it = 90 for chapter 7) is far too loose to be worth asserting, because the
// campaign's real maximum is 87 at 3,000 seeds — starsFor awards the third star only for
// squadKos === 0, and exactly three bosses (the ch.4/5/6 finales) never produce a flawless
// win against a level-capped legendary squad, so 90 - 3 = 87. Of the rest, exactly three
// further stages 3-star only at sub-1% rates — abyssal_trench stages 3 and 4 at 0.058%
// each, containment_site stage 4 at 0.725% — putting the practical no-grind floor at
// 87 - 3 = 84; nothing else is close to sub-1%, the next-lowest stages sit at 9.4%-15.4%.
//
// This test itself runs bestStars at 400 seeds, not 3,000, and that deliberately
// UNDER-counts relative to the 87 above: abyssal_trench's two 0.058% stages have ~0.93
// expected hits between them across the 1,600 runs (400 seeds x 4 traits) bestStars
// performs per stage — close to a coin flip on whether the sample catches either at all —
// and at 400 seeds it does not, so this test measures achievable as 85, not 87. achievable
// is therefore knife-edge between 85 and 87: deterministic for a given code state (fixed
// mulberry32 seeds), but any unrelated change to RNG consumption order, the seed range, or
// COMBAT_TRAITS' iteration order can shift which stages catch the rare 3-star and move the
// total. Harmless today — 85 still clears starGate 75 with 5 points of slack to spare
// (achievable - MARGIN = 80 >= 75).
// So this SIMULATES the ceiling instead of assuming it, and keeps a margin so that a future
// boss retune costing one deterministic 3-star cannot silently strand the gate.
describe('star gates are reachable', () => {
  const MARGIN = 5;

  // Best stars any legal loadout can take on this stage. Returns early on the first 3, so
  // the deterministic majority of stages cost one seed rather than 1,600.
  function bestStars(stage: StageDef, runs = 400): number {
    let best = 0;
    for (const trait of COMBAT_TRAITS) {
      for (let seed = 0; seed < runs; seed++) {
        const r = resolveBattle(squadOf('tyrannosaurus', [trait]), npcsOf(stage), mulberry32(seed));
        if (r.won) best = Math.max(best, starsFor(r));
        if (best === 3) return 3;
      }
    }
    return best;
  }

  it('every starGate leaves at least MARGIN stars of headroom over what is achievable before it', () => {
    const gated = CAMPAIGN.filter((c) => c.starGate != null);
    expect(gated.length, 'no chapter sets starGate — delete this test or the field').toBeGreaterThan(0);
    for (const chapter of gated) {
      const idx = CAMPAIGN.findIndex((c) => c.id === chapter.id);
      const achievable = CAMPAIGN.slice(0, idx)
        .flatMap((c) => c.stages)
        .reduce((sum, st) => sum + bestStars(st), 0);
      expect(
        chapter.starGate!,
        `${chapter.id}: starGate ${chapter.starGate} against ${achievable} achievable in chapters 1-${idx} `
          + `(need <= ${achievable - MARGIN} to keep ${MARGIN} stars of margin)`,
      ).toBeLessThanOrEqual(achievable - MARGIN);
    }
  });
});
