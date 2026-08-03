import { RARITY } from '../data/rarity.js';
import { modProduct } from '../data/traits.js';
import { DECOR } from '../data/decor.js';
import type { Species, PaddockDef } from '../data/types.js';

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
export function paddockFit(species: Species, paddock: PaddockDef, decor: string[]): number {
  if (paddock.diet !== species.diet) return 0.5;
  const biomeMatch = decor.some((kind) => DECOR[kind]?.biomeTags.some((tag) => species.biomeTags.includes(tag)));
  return biomeMatch ? 1.0 : 0.75;
}

export function comfortAt(d: ClockDino, at: number): number {
  if (!d.paddock) return 0;
  // Overfilled dinos (fillTo up to 150) sit at full comfort until hunger drains back under 100.
  return (Math.min(100, hungerAt(d.hungerAtFed, d.lastFedAt, at, drainMsFor(d.traits))) / 100)
    * paddockFit(d.species, d.paddock, d.decor);
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
    // Comfort is piecewise linear with a knee where hunger crosses 100 (overfill).
    // A two-point mean is exact on each side of the knee but wrong across it.
    const seg = (a: number, b: number) =>
      ((comfortAt(d, a) + comfortAt(d, b)) / 2) * ((b - a) / 3_600_000);
    const knee = d.lastFedAt + Math.max(0, (d.hungerAtFed - 100) / 100) * drainMs;
    const comfortHours = knee > from && knee < dinoEnd
      ? seg(from, knee) + seg(knee, dinoEnd)
      : seg(from, dinoEnd);
    total += RARITY[d.species.rarity].incomePerHr * modProduct(d.traits, 'income') * comfortHours;
  }
  return Math.floor(total * (1 + facilityBonusPct / 100));
}
