import { describe, it, expect } from 'vitest';
import {
  ENERGY_CAP, ENERGY_REGEN_MS, MAX_ROUNDS, LEVEL_CAP, STAR_REWARD_MULT, STAR_XP_MULT,
} from '../src/data/battle/constants.js';
import {
  BATTLE_BASE, ARCHETYPE_MULT, LEVEL_XP, battleLevel, statsFor,
} from '../src/data/battle/stats.js';
import type { Rarity } from '../src/data/types.js';

const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const STAT_KEYS = ['hp', 'atk', 'def', 'spd'] as const;

describe('battle constants', () => {
  it('pins the balance surface', () => {
    expect(ENERGY_CAP).toBe(10);
    expect(ENERGY_REGEN_MS).toBe(600_000);
    expect(MAX_ROUNDS).toBe(30);
    expect(LEVEL_CAP).toBe(10);
    expect(STAR_REWARD_MULT).toEqual([0, 1, 1.25, 1.5]);
    expect(STAR_XP_MULT).toEqual([0.25, 1, 1.25, 1.5]);
  });
});

describe('battle stat tables', () => {
  it('pins BATTLE_BASE (~x1.45 per tier from common, hand-rounded)', () => {
    expect(BATTLE_BASE).toEqual({
      common:    { hp: 60,  atk: 12, def: 6,  spd: 10 },
      uncommon:  { hp: 87,  atk: 17, def: 9,  spd: 15 },
      rare:      { hp: 126, atk: 25, def: 13, spd: 22 },
      epic:      { hp: 183, atk: 36, def: 19, spd: 32 },
      legendary: { hp: 265, atk: 52, def: 28, spd: 46 },
      mythic:    { hp: 384, atk: 75, def: 41, spd: 67 },
    });
  });
  it('pins ARCHETYPE_MULT', () => {
    expect(ARCHETYPE_MULT).toEqual({
      bruiser: { hp: 1.0,  atk: 1.3,  def: 0.85, spd: 1.0 },
      tank:    { hp: 1.35, atk: 0.8,  def: 1.4,  spd: 0.75 },
      swift:   { hp: 0.85, atk: 1.1,  def: 0.85, spd: 1.45 },
      support: { hp: 1.0,  atk: 0.85, def: 1.0,  spd: 1.1 },
    });
  });
  it('BATTLE_BASE is strictly increasing in every stat across the rarity ladder', () => {
    for (let i = 1; i < RARITY_ORDER.length; i++) {
      const prev = BATTLE_BASE[RARITY_ORDER[i - 1]];
      const cur = BATTLE_BASE[RARITY_ORDER[i]];
      for (const stat of STAT_KEYS) expect(cur[stat]).toBeGreaterThan(prev[stat]);
    }
  });
});

describe('battleLevel', () => {
  it('pins the cumulative XP curve', () => {
    expect(LEVEL_XP).toEqual([0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200]);
    expect(LEVEL_XP.length).toBe(LEVEL_CAP);
  });
  it('is threshold-exact at every boundary', () => {
    for (let i = 1; i < LEVEL_XP.length; i++) {
      expect(battleLevel(LEVEL_XP[i])).toBe(i + 1);      // exactly at threshold -> new level
      expect(battleLevel(LEVEL_XP[i] - 1)).toBe(i);      // one below -> previous level
    }
  });
  it('returns 1 below the first threshold and caps at LEVEL_CAP', () => {
    expect(battleLevel(0)).toBe(1);
    expect(battleLevel(99)).toBe(1);
    expect(battleLevel(3200)).toBe(LEVEL_CAP);
    expect(battleLevel(1_000_000)).toBe(LEVEL_CAP);
  });
});

describe('statsFor', () => {
  it('is strictly increasing in rarity along a same-archetype chain (bruisers, level 3)', () => {
    // iguanodon uncommon, allosaurus rare, giganotosaurus epic, tyrannosaurus legendary, indominus mythic — all bruisers
    const chain = ['iguanodon', 'allosaurus', 'giganotosaurus', 'tyrannosaurus', 'indominus'];
    for (let i = 1; i < chain.length; i++) {
      const prev = statsFor(chain[i - 1], 3);
      const cur = statsFor(chain[i], 3);
      for (const stat of STAT_KEYS) expect(cur[stat]).toBeGreaterThan(prev[stat]);
    }
  });
  it('is monotonic in level (strictly for hp) up to the cap', () => {
    let prev = statsFor('tyrannosaurus', 1);
    for (let level = 2; level <= LEVEL_CAP; level++) {
      const cur = statsFor('tyrannosaurus', level);
      expect(cur.hp).toBeGreaterThan(prev.hp);
      expect(cur.atk).toBeGreaterThanOrEqual(prev.atk);
      expect(cur.def).toBeGreaterThanOrEqual(prev.def);
      expect(cur.spd).toBeGreaterThanOrEqual(prev.spd);
      prev = cur;
    }
  });
  it('applies the archetype multiplier per stat (same-rarity comparison, level 1)', () => {
    expect(statsFor('allosaurus', 1)).toEqual({ hp: 126, atk: 32, def: 11, spd: 22 });   // rare bruiser
    expect(statsFor('ankylosaurus', 1)).toEqual({ hp: 170, atk: 20, def: 18, spd: 16 }); // rare tank
    expect(statsFor('velociraptor', 1)).toEqual({ hp: 107, atk: 27, def: 11, spd: 31 }); // rare swift
    expect(statsFor('maiasaura', 1)).toEqual({ hp: 87,  atk: 14, def: 9,  spd: 16 });    // uncommon support
  });
  it('floors, never rounds', () => {
    expect(statsFor('allosaurus', 1).atk).toBe(32);    // 25 * 1.3 = 32.5 -> floor 32 (round would give 33)
    expect(statsFor('ankylosaurus', 1).spd).toBe(16);  // 22 * 0.75 = 16.5 -> floor 16
  });
  it('throws on unknown species (getSpecies boundary)', () => {
    expect(() => statsFor('barney', 1)).toThrow(/Unknown species/);
  });
});
