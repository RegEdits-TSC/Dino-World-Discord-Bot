import { describe, it, expect } from 'vitest';
import { resolveBattle, starsFor } from '../src/data/battle/resolve.js';
import type { Combatant, BattleResult } from '../src/data/battle/resolve.js';
import { MAX_ROUNDS } from '../src/data/battle/constants.js';
import { statsFor } from '../src/data/battle/stats.js';
import { getSpecies } from '../src/data/species/index.js';
import { mulberry32 } from './harness.js';

function fighter(key: string, side: 0 | 1, over: Partial<Combatant> = {}): Combatant {
  return {
    key, name: key, speciesId: 'velociraptor', archetype: 'bruiser',
    maxHp: 100, hp: 100, atk: 20, def: 5, spd: 10, side, ...over,
  };
}

function fromSpecies(key: string, speciesId: string, level: number, side: 0 | 1): Combatant {
  const st = statsFor(speciesId, level);
  const sp = getSpecies(speciesId);
  return {
    key, name: sp.name, speciesId, archetype: sp.archetype,
    maxHp: st.hp, hp: st.hp, atk: st.atk, def: st.def, spd: st.spd, side,
  };
}

function scripted(values: number[], fallback = 0.5): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : fallback);
}

function mkResult(over: Partial<BattleResult>): BattleResult {
  return {
    won: true, rounds: 20, squadKos: 0, squadSurvivors: ['a'],
    beats: [{ title: 't', lines: ['x'] }, { title: 't', lines: ['y'] }],
    finalHp: {},
    ...over,
  };
}

const squad3 = () => [
  fromSpecies('d1', 'velociraptor', 5, 0),
  fromSpecies('d2', 'ankylosaurus', 5, 0),
  fromSpecies('d3', 'maiasaura', 4, 0),
];
const npcs3 = () => [
  fromSpecies('n1', 'allosaurus', 4, 1),
  fromSpecies('n2', 'dilophosaurus', 4, 1),
  fromSpecies('n3', 'triceratops', 3, 1),
];

describe('resolveBattle', () => {
  it('is deterministic: same mulberry32(42) stream twice -> deep-equal results (3v3)', () => {
    const a = resolveBattle(squad3(), npcs3(), mulberry32(42));
    const b = resolveBattle(squad3(), npcs3(), mulberry32(42));
    expect(a).toEqual(b);
  });
  it('does not mutate its input combatants', () => {
    const squad = [fighter('a', 0)];
    const npcs = [fighter('x', 1)];
    resolveBattle(squad, npcs, mulberry32(7));
    expect(squad[0].hp).toBe(100);
    expect(npcs[0].hp).toBe(100);
  });
  it('produces well-formed beats and finalHp for 1v1 and 3v3 shapes', () => {
    const one = resolveBattle([fighter('a', 0)], [fighter('x', 1)], mulberry32(3));
    const three = resolveBattle(squad3(), npcs3(), mulberry32(9));
    for (const r of [one, three]) {
      expect(r.beats).toHaveLength(2);
      for (const beat of r.beats) {
        expect(beat.title.length).toBeGreaterThan(0);
        expect(beat.lines.length).toBeGreaterThanOrEqual(1);
        expect(beat.lines.length).toBeLessThanOrEqual(5);
        for (const line of beat.lines) expect(line.length).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(one.finalHp).sort()).toEqual(['a', 'x']);
    expect(Object.keys(three.finalHp).sort()).toEqual(['d1', 'd2', 'd3', 'n1', 'n2', 'n3']);
  });
  it('targets the lowest-hp living enemy, not the first one in initiative order', () => {
    // n1 is full-hp but higher-spd, so it sorts before the pre-damaged n2 in
    // the fixed initiative order -- a mutant that targets enemies[0] instead
    // of the lowest-hp enemy would hit n1 first. All four draws are scripted
    // to variance=1.0 (0.5 -> 0.85+0.30*0.5) with no crit (0.5 >= 0.10):
    // [0]=a's variance, [1]=a's crit, [2]=n1's variance, [3]=n1's crit.
    const a = fighter('a', 0, { atk: 50, def: 0, spd: 30, hp: 100, maxHp: 100 });
    const n1 = fighter('n1', 1, { atk: 150, def: 0, spd: 20, hp: 100, maxHp: 100 });
    const n2 = fighter('n2', 1, { atk: 0, def: 0, spd: 1, hp: 10, maxHp: 50 });
    const r = resolveBattle([a], [n1, n2], scripted([0.5, 0.5, 0.5, 0.5]));
    // a hits the lowest-hp enemy (n2, 10 hp) for round(50*1.0) = 50 -> KO.
    // n1 then counters a for round(150*1.0) = 150 -> KO. n2 is already dead
    // and never gets a turn; n1 is never touched by a's attack.
    expect(r.rounds).toBe(1);
    expect(r.won).toBe(false);
    expect(r.finalHp.a).toBe(0);
    expect(r.finalHp.n1).toBe(100);
    expect(r.finalHp.n2).toBe(0);
  });
  it('support heals the lowest-hp living ally for round(0.25*dmg), capped at maxHp', () => {
    const npc = () => fighter('npc', 1, { hp: 35, maxHp: 35, def: 10, atk: 5, spd: 1 });
    // variance 1.0, no crit: dmg = round(40 - 5) = 35 -> KO; heal = round(8.75) = 9 to self
    const sup = fighter('sup', 0, { archetype: 'support', atk: 40, hp: 50, maxHp: 200, spd: 20 });
    const r = resolveBattle([sup], [npc()], () => 0.5);
    expect(r.won).toBe(true);
    expect(r.rounds).toBe(1);
    expect(r.squadKos).toBe(0);
    expect(r.squadSurvivors).toEqual(['sup']);
    expect(r.finalHp.npc).toBe(0);
    expect(r.finalHp.sup).toBe(59);            // 50 + 9
    expect(r.beats[1].lines.some((l) => l.includes('is down!'))).toBe(true);
    // heal is capped at maxHp
    const nearFull = fighter('sup', 0, { archetype: 'support', atk: 40, hp: 198, maxHp: 200, spd: 20 });
    expect(resolveBattle([nearFull], [npc()], () => 0.5).finalHp.sup).toBe(200);
  });
  it('crit multiplies the rolled damage x1.5, rolled after the variance roll', () => {
    const atk = () => fighter('a', 0, { atk: 40, def: 0, spd: 20 });
    const def = () => fighter('x', 1, { hp: 53, maxHp: 53, def: 10, atk: 5, spd: 1 });
    // scripted [variance 0.5 -> x1.0, crit 0.05 < 0.10]: dmg round(35*1.5) = 53 -> one-shot
    const crit = resolveBattle([atk()], [def()], scripted([0.5, 0.05]));
    expect(crit.rounds).toBe(1);
    expect(crit.finalHp.x).toBe(0);
    expect(crit.finalHp.a).toBe(100);          // defender never acted
    // same variance, no crit: 35 dmg, defender survives at 18 and hits back for 5
    const plain = resolveBattle([atk()], [def()], () => 0.5);
    expect(plain.rounds).toBe(2);
    expect(plain.finalHp.a).toBe(95);
  });
  it('crits land ~10% of the time across seeds', () => {
    let oneShots = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const r = resolveBattle(
        [fighter('a', 0, { atk: 40, def: 0, spd: 20 })],
        [fighter('x', 1, { hp: 44, maxHp: 44, def: 10, atk: 0, spd: 1 })],
        mulberry32(seed),
      );
      // round-1 KO iff the first attack crits (non-crit max 41 < 44 <= crit min 44)
      if (r.rounds === 1) oneShots++;
    }
    expect(oneShots).toBeGreaterThan(50);      // P=0.10, n=1000: mean 100, sd ~9.5
    expect(oneShots).toBeLessThan(160);
  });
  it('keeps the beats invariant when no events are generated (degenerate input)', () => {
    // An empty npcs array means the squad's lone fighter never finds a
    // target and no attack ever happens, so the fight loop produces zero
    // FightEvents. buildBeats must still satisfy "always exactly two
    // beats, each with >=1 non-empty line" -- Task 10 renders `lines`
    // straight into Discord embed fields, which reject an empty value.
    const r = resolveBattle([fighter('a', 0)], [], mulberry32(5));
    expect(r.beats).toHaveLength(2);
    for (const beat of r.beats) {
      expect(beat.title.length).toBeGreaterThan(0);
      expect(beat.lines.length).toBeGreaterThanOrEqual(1);
      for (const line of beat.lines) expect(line.length).toBeGreaterThan(0);
    }
  });
  it('MAX_ROUNDS exhaustion is a loss', () => {
    // atk 1 vs def 50: base dmg = max(1, round(1*var - 25)) = 1, but the crit
    // multiplier still applies on top of that floor (round(1*1.5) = 2), so
    // mulberry32(1) does not chip a clean 1/round for all 30 rounds -- it
    // lands 4 crits for 'a' and 3 for 'x' over the fight, verified by tracing
    // the exact algorithm above against this seed.
    const wall = (key: string, side: 0 | 1) => fighter(key, side, { atk: 1, def: 50 });
    const r = resolveBattle([wall('a', 0)], [wall('x', 1)], mulberry32(1));
    expect(r.rounds).toBe(MAX_ROUNDS);
    expect(r.won).toBe(false);
    expect(r.finalHp.a).toBe(67);
    expect(r.finalHp.x).toBe(66);
    expect(starsFor(r)).toBe(0);
  });
});

describe('starsFor', () => {
  it('covers every boundary of the star formula', () => {
    expect(starsFor(mkResult({ won: false, squadKos: 0, rounds: 5 }))).toBe(0);  // loss trumps all
    expect(starsFor(mkResult({ squadKos: 0, rounds: 30 }))).toBe(3);             // flawless, slow ok
    expect(starsFor(mkResult({ squadKos: 1, rounds: 20 }))).toBe(2);             // squadKos===1 arm
    expect(starsFor(mkResult({ squadKos: 2, rounds: 12 }))).toBe(2);             // rounds<=12 arm
    expect(starsFor(mkResult({ squadKos: 2, rounds: 13 }))).toBe(1);             // neither arm
    expect(starsFor(mkResult({ squadKos: 3, rounds: 30, squadSurvivors: [] })))
      .toBe(1);                                                                  // any other win
  });
});
