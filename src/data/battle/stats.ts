import type { Archetype, Rarity } from '../types.js';
import { getSpecies } from '../species/index.js';
import { LEVEL_CAP } from './constants.js';

export interface BattleStats { hp: number; atk: number; def: number; spd: number }

// ~x1.45 per rarity tier from common {60, 12, 6, 10}, hand-rounded per stat.
export const BATTLE_BASE: Record<Rarity, BattleStats> = {
  common:    { hp: 60,  atk: 12, def: 6,  spd: 10 },
  uncommon:  { hp: 87,  atk: 17, def: 9,  spd: 15 },
  rare:      { hp: 126, atk: 25, def: 13, spd: 22 },
  epic:      { hp: 183, atk: 36, def: 19, spd: 32 },
  legendary: { hp: 265, atk: 52, def: 28, spd: 46 },
  mythic:    { hp: 384, atk: 75, def: 41, spd: 67 },
};

export const ARCHETYPE_MULT: Record<Archetype, BattleStats> = {
  bruiser: { hp: 1.0,  atk: 1.3,  def: 0.85, spd: 1.0 },
  tank:    { hp: 1.35, atk: 0.8,  def: 1.4,  spd: 0.75 },
  swift:   { hp: 0.85, atk: 1.1,  def: 0.85, spd: 1.45 },
  support: { hp: 1.0,  atk: 0.85, def: 1.0,  spd: 1.1 },
};

// Cumulative XP thresholds; LEVEL_XP[i] is the XP needed to be level i+1.
// Length === LEVEL_CAP, so the array itself enforces the cap.
export const LEVEL_XP: readonly number[] = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];

export function battleLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_XP.length && i < LEVEL_CAP; i++) {
    if (xp >= LEVEL_XP[i]) level = i + 1;
  }
  return level;
}

export function statsFor(speciesId: string, level: number): BattleStats {
  const s = getSpecies(speciesId);
  const base = BATTLE_BASE[s.rarity];
  const mult = ARCHETYPE_MULT[s.archetype];
  const scale = 1 + 0.08 * (level - 1);
  return {
    hp: Math.floor(base.hp * mult.hp * scale),
    atk: Math.floor(base.atk * mult.atk * scale),
    def: Math.floor(base.def * mult.def * scale),
    spd: Math.floor(base.spd * mult.spd * scale),
  };
}
