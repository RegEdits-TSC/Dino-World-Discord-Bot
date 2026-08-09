import { RARITY } from '../data/rarity.js';
import { modProduct } from '../data/traits.js';
import { matchedKindCount, enrichmentMult } from '../data/decor.js';
import type { Species, PaddockDef } from '../data/types.js';
import { incomeMultAt, utcMidnightsBetween } from './world.js';

export const HUNGER_DRAIN_MS = 48 * 3_600_000;   // spec §3.4
export const GRACE_MS = 8 * 3_600_000;
export const ESCAPE_COMFORT = 0.25;
/** Show "escapes soon" warnings when the escape instant is within this window. */
export const ESCAPE_WARN_MS = 12 * 3_600_000;

export interface ClockDino {
  species: Species; paddock: PaddockDef | null; decor: string[];
  hungerAtFed: number; lastFedAt: number; escapedAt: number | null;
  traits: string[];
}

/**
 * The drain window for one dino. `drain` is a RATE multiplier, so the window is
 * the base divided by it: Hardy (0.75) drains 25% slower and therefore lasts longer.
 */
export function drainMsFor(traits: string[]): number {
  return HUNGER_DRAIN_MS / modProduct(traits, 'drain');
}

// `drainMs` is deliberately REQUIRED: a default would let a call site silently keep
// the global rate, which is exactly the bug this parameter exists to prevent.
export function hungerAt(hungerAtFed: number, lastFedAt: number, at: number, drainMs: number): number {
  const drained = ((at - lastFedAt) / drainMs) * 100;
  return Math.max(0, hungerAtFed - drained);
}

export const DAY_MS = 86_400_000;

/** UTC calendar-day key ('YYYY-MM-DD') for an epoch-ms instant. 00:00:00.000 belongs to the new day. */
export function dayKeyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// `decor` holds the KIND SLUGS decorateLot actually wrote (e.g. 'grass_tuft'),
// never biome tags directly — each slug's OWN biomeTags (from DECOR) must be
// cross-referenced against the species' before a match counts. An unknown or
// since-removed slug degrades to no match rather than throwing, the same
// tolerance traitDefs gives a retired trait id.
export function paddockFitBase(species: Species, paddock: PaddockDef, decor: string[]): number {
  if (paddock.diet !== species.diet) return 0.5;
  return matchedKindCount(species, decor) > 0 ? 1.0 : 0.75;
}

/**
 * Habitat fit, enrichment included. Enrichment stacks ONLY above the 1.0 case, so
 * the 0.5 and 0.75 branches are byte-identical to their pre-enrichment behaviour.
 * A step function of stored state, never of elapsed time: comfortCrossing below
 * solves the escape instant algebraically by dividing by a CONSTANT fit, and a
 * time-varying term would force a piecewise segment walk through five call sites.
 */
export function paddockFit(species: Species, paddock: PaddockDef, decor: string[]): number {
  if (paddock.diet !== species.diet) return 0.5;
  const kinds = matchedKindCount(species, decor);
  if (kinds === 0) return 0.75;
  return enrichmentMult(kinds);
}

function comfortWith(d: ClockDino, at: number, fit: number): number {
  // Overfilled dinos (fillTo up to 150) sit at full comfort until hunger drains back under 100.
  return (Math.min(100, hungerAt(d.hungerAtFed, d.lastFedAt, at, drainMsFor(d.traits))) / 100) * fit;
}

export function comfortAt(d: ClockDino, at: number): number {
  if (!d.paddock) return 0;
  return comfortWith(d, at, paddockFit(d.species, d.paddock, d.decor));
}

/**
 * Comfort WITHOUT enrichment. recomputeRating (src/modules/park/rating.ts) is the only
 * caller, and that is the whole point: rating stays byte-identical to its
 * pre-enrichment value, so monotone ratingHighWater cannot hand out lot slots, sites,
 * shop tiers or the mythic unlock nobody earned. A Math.min(1, comfort) clamp is NOT a
 * substitute — it bounds the ceiling but not the sensitivity, so a hunger-80 dino at
 * fit 1.05 would still read 0.84 instead of 0.80.
 */
export function baseComfortAt(d: ClockDino, at: number): number {
  if (!d.paddock) return 0;
  return comfortWith(d, at, paddockFitBase(d.species, d.paddock, d.decor));
}

/** The enrichment multiplier alone, for display. 1.0 unless the paddock reaches full fit. */
export function enrichmentAt(d: ClockDino): number {
  if (!d.paddock) return 1.0;
  if (paddockFitBase(d.species, d.paddock, d.decor) < 1.0) return 1.0;
  return enrichmentMult(matchedKindCount(d.species, d.decor));
}

/** Time at which comfort first crosses below ESCAPE_COMFORT, or null if it never does while assigned. */
function comfortCrossing(d: ClockDino): number | null {
  if (!d.paddock) return null;
  const fit = paddockFit(d.species, d.paddock, d.decor);
  const hungerThreshold = (ESCAPE_COMFORT / fit) * 100;   // hunger% where comfort == threshold
  if (hungerThreshold >= d.hungerAtFed) return d.lastFedAt; // already at/below threshold when fed
  const msUntil = ((d.hungerAtFed - hungerThreshold) / 100) * drainMsFor(d.traits);
  return d.lastFedAt + msUntil;
}

/** Raw escape instant (crossing + grace), independent of any observation time. */
export function escapeAt(d: ClockDino): number | null {
  if (d.escapedAt !== null) return d.escapedAt;
  const crossing = comfortCrossing(d);
  return crossing === null ? null : crossing + GRACE_MS;
}

/** The escape instant if the dino has escaped as of `from`, else null. */
export function escapeMoment(d: ClockDino, from: number): number | null {
  if (d.escapedAt !== null) return d.escapedAt;
  const esc = escapeAt(d);
  return esc !== null && esc <= from ? esc : null;
}

export function accruedIncome(
  dinos: ClockDino[], facilityBonusPct: number, capHours: number, from: number, to: number,
): number {
  const end = Math.min(to, from + capHours * 3_600_000);
  if (end <= from) return 0;
  let total = 0;
  for (const d of dinos) {
    if (!d.paddock) continue;                                // unassigned earns nothing
    if (d.escapedAt !== null && d.escapedAt <= from) continue; // already escaped before window
    // Every time-from-hunger derivation below uses this dino's own rate, not the global
    // constant: a missed one silently over-/under-pays a trait-bearing dino.
    const drainMs = drainMsFor(d.traits);
    let dinoEnd = end;
    const esc = escapeAt(d);
    if (esc !== null) dinoEnd = Math.min(dinoEnd, Math.max(from, esc));
    const hungerZero = d.lastFedAt + (d.hungerAtFed / 100) * drainMs;
    dinoEnd = Math.min(dinoEnd, Math.max(from, hungerZero));
    if (dinoEnd <= from) continue;
    // Comfort is piecewise linear with a knee where hunger crosses 100
    // (overfill), and the world's income multiplier is piecewise constant with
    // a step at every UTC midnight. A two-point mean is exact WITHIN one linear,
    // single-event region and wrong across either kind of boundary, so both
    // kinds become breakpoints in one sorted list.
    const seg = (a: number, b: number) =>
      ((comfortAt(d, a) + comfortAt(d, b)) / 2) * ((b - a) / 3_600_000);
    const knee = d.lastFedAt + Math.max(0, (d.hungerAtFed - 100) / 100) * drainMs;
    // Midnights are enumerated over the PER-DINO window: using the shared `end`
    // would attribute income to a segment this dino never earned in.
    const breaks = [
      from,
      ...(knee > from && knee < dinoEnd ? [knee] : []),   // strict, as before
      ...utcMidnightsBetween(from, dinoEnd),
      dinoEnd,
    ].sort((x, y) => x - y);
    let comfortHours = 0;
    for (let i = 0; i < breaks.length - 1; i++) {
      const a = breaks[i];
      const b = breaks[i + 1];
      if (b <= a) continue;   // a knee landing exactly on a midnight yields one segment, not two
      // Sample the multiplier at the segment's START instant — never at the
      // request time. Reading eventMods(now).income here is the bug this whole
      // structure exists to prevent.
      comfortHours += seg(a, b) * incomeMultAt(a);
    }
    total += RARITY[d.species.rarity].incomePerHr * modProduct(d.traits, 'income') * comfortHours;
  }
  return Math.floor(total * (1 + facilityBonusPct / 100));
}
