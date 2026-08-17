import type { FoodId } from './foods.js';
import type { Rarity } from './types.js';

/** Attendance is quoted on the same 1000-point scale as park rating. */
export const ATTENDANCE_SCALE = 1000;

/**
 * Distinct species on display for a full variety term. FROZEN, and deliberately NOT a
 * live count over allSpecies(): a live target in the numerator means every species that
 * ships raises everyone's attendance and retroactively cheapens every threshold and
 * catalog rung already priced against it. This is COLLECTION_TARGET's rule (190,
 * src/data/progression.ts) applied to the other side of the fraction. The min(1, …)
 * clamp is what makes a new species an ALTERNATE PATH to the same target.
 *
 * 40 against the 52-species roster: reachable by a park deliberately built for variety
 * (a 6-paddock L4 build holds 48), out of reach for one built for cash — all 5 legendary
 * and all 3 mythic species are carnivores, so the income-maximal park holds 5 distinct
 * species and is SUPPOSED to score badly here.
 */
export const ATTENDANCE_SPECIES_TARGET = 40;

/**
 * Total attraction draw for a full attraction term. FROZEN for the same reason as the
 * species target. Equal to the sum of every catalog kind's top-level draw, which
 * tests/attractions-content.test.ts asserts — so a fully built catalog saturates this
 * term exactly, and adding a kind later is a deliberate decision to move the target
 * rather than an accident that inflates everyone.
 */
export const ATTRACTION_DRAW_TARGET = 210;

/** The most a fully saturated attraction catalog can add: +60%. */
export const ATTRACTION_MAX_BONUS = 0.6;

/** Per Visitor Center level. Index 0 is level 1, and level 0 (no VC) takes the fallback. */
export const VC_ATTENDANCE_MULT = [1.0, 1.05, 1.1, 1.15, 1.2];

export interface MilestoneReward { cash?: number; shards?: number; foods?: Partial<Record<FoodId, number>>; egg?: Rarity }
export interface MilestoneDef { at: number; name: string; reward: MilestoneReward }

/**
 * One-time claims as the high-water climbs. Shards total 80, comfortably under the
 * season track's 110-per-season ceiling, so this ladder never becomes the cheapest
 * shard faucet in the game.
 */
export const ATTENDANCE_MILESTONES: readonly MilestoneDef[] = [
  { at:  200, name: 'Opening Day',    reward: { cash: 250_000, foods: { ferns: 20 } } },
  { at:  400, name: 'Word of Mouth',  reward: { cash: 750_000, egg: 'rare' } },
  { at:  700, name: 'Regional Draw',  reward: { cash: 2_000_000, shards: 15 } },
  { at: 1000, name: 'Marquee Park',   reward: { cash: 5_000_000, egg: 'epic' } },
  { at: 1400, name: 'Destination',    reward: { cash: 12_000_000, shards: 25 } },
  { at: 1800, name: 'World Renowned', reward: { cash: 25_000_000, shards: 40, egg: 'legendary' } },
];

/**
 * Attendance from its three already-resolved terms. Pure, and deliberately takes plain
 * numbers rather than a Ctx: everything time-varying (hunger, comfort, world events,
 * the season) is excluded by construction, because attendance is a GATE and a gate that
 * moves every millisecond has no stable threshold.
 */
export function attendanceFrom(distinctSpecies: number, drawTotal: number, vcLevel: number): number {
  const species = Math.min(1, Math.max(0, distinctSpecies) / ATTENDANCE_SPECIES_TARGET);
  const attraction = 1 + Math.min(1, Math.max(0, drawTotal) / ATTRACTION_DRAW_TARGET) * ATTRACTION_MAX_BONUS;
  // Same clamp discipline as levelValue: a level above the array takes its top entry,
  // never undefined. Level 0 (no Visitor Center) takes the neutral 1.
  const vc = vcLevel <= 0 ? 1 : VC_ATTENDANCE_MULT[Math.min(vcLevel, VC_ATTENDANCE_MULT.length) - 1] ?? 1;
  return Math.round(ATTENDANCE_SCALE * species * attraction * vc);
}

export function milestonesUpTo(highWater: number): MilestoneDef[] {
  return ATTENDANCE_MILESTONES.filter((m) => highWater >= m.at);
}
