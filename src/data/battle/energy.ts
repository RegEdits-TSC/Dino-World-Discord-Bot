// src/data/battle/energy.ts
import { ENERGY_CAP, ENERGY_REGEN_MS } from './constants.js';

// Lazy settle (shards-window pattern): whole ticks only, so fractional
// regen progress stays banked in updatedAtMs; at cap, updatedAtMs snaps to
// now so a full pool never accrues hidden overflow.
export function settleEnergy(
  energy: number,
  updatedAtMs: number,
  nowMs: number,
): { energy: number; updatedAtMs: number } {
  const ticks = Math.floor((nowMs - updatedAtMs) / ENERGY_REGEN_MS);
  // Clamped at 0: purely defensive against a backward clock jump (ticks negative) —
  // the spend gate in runFight already rules out any free-energy exploit from this.
  const settled = Math.max(0, Math.min(ENERGY_CAP, energy + ticks));
  const at = settled >= ENERGY_CAP ? nowMs : updatedAtMs + ticks * ENERGY_REGEN_MS;
  return { energy: settled, updatedAtMs: at };
}
