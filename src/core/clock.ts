import { RARITY } from '../data/rarity.js';
import type { Species, PaddockDef } from '../data/types.js';

export const HUNGER_DRAIN_MS = 48 * 3_600_000;   // spec §3.4
export const GRACE_MS = 8 * 3_600_000;
export const ESCAPE_COMFORT = 0.25;

export interface ClockDino {
  species: Species; paddock: PaddockDef | null; decor: string[];
  hungerAtFed: number; lastFedAt: number; escapedAt: number | null;
}

export function hungerAt(hungerAtFed: number, lastFedAt: number, at: number): number {
  const drained = ((at - lastFedAt) / HUNGER_DRAIN_MS) * 100;
  return Math.max(0, hungerAtFed - drained);
}

export function paddockFit(species: Species, paddock: PaddockDef, decor: string[]): number {
  if (paddock.diet !== species.diet) return 0.5;
  const biomeMatch = decor.some((d) => species.biomeTags.includes(d));
  return biomeMatch ? 1.0 : 0.75;
}

export function comfortAt(d: ClockDino, at: number): number {
  if (!d.paddock) return 0;
  return (hungerAt(d.hungerAtFed, d.lastFedAt, at) / 100) * paddockFit(d.species, d.paddock, d.decor);
}

/** Time at which comfort first crosses below ESCAPE_COMFORT, or null if it never does while assigned. */
function comfortCrossing(d: ClockDino): number | null {
  if (!d.paddock) return null;
  const fit = paddockFit(d.species, d.paddock, d.decor);
  const hungerThreshold = (ESCAPE_COMFORT / fit) * 100;   // hunger% where comfort == threshold
  if (hungerThreshold >= d.hungerAtFed) return d.lastFedAt; // already at/below threshold when fed
  const msUntil = ((d.hungerAtFed - hungerThreshold) / 100) * HUNGER_DRAIN_MS;
  return d.lastFedAt + msUntil;
}

/** Raw escape instant (crossing + grace), independent of any observation time. */
function rawEscape(d: ClockDino): number | null {
  if (d.escapedAt !== null) return d.escapedAt;
  const crossing = comfortCrossing(d);
  return crossing === null ? null : crossing + GRACE_MS;
}

/** The escape instant if the dino has escaped as of `from`, else null. */
export function escapeMoment(d: ClockDino, from: number): number | null {
  if (d.escapedAt !== null) return d.escapedAt;
  const esc = rawEscape(d);
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
    let dinoEnd = end;
    const esc = rawEscape(d);
    if (esc !== null) dinoEnd = Math.min(dinoEnd, Math.max(from, esc));
    if (dinoEnd <= from) continue;
    const mean = (comfortAt(d, from) + comfortAt(d, dinoEnd)) / 2;
    const hours = (dinoEnd - from) / 3_600_000;
    total += RARITY[d.species.rarity].incomePerHr * mean * hours;
  }
  return Math.floor(total * (1 + facilityBonusPct / 100));
}
