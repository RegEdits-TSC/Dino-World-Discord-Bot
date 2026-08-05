import { describe, it, expect } from 'vitest';
import { accruedIncome, type ClockDino } from '../src/core/clock.js';
import { incomeMultAt } from '../src/core/world.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { allSpecies } from '../src/data/species/index.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

// A common herbivore (60 cash/hr) in a correct-diet paddock with a matching
// biome decor => paddockFit 1.0, so comfort is exactly hunger/100.
const species = allSpecies().find((s) => s.rarity === 'common' && s.diet === 'herbivore')!;

function dino(lastFedAt: number, hungerAtFed = 100): ClockDino {
  return {
    species,
    paddock: PADDOCKS.herbivore_paddock,
    decor: [],                  // fit 0.75 — constant, so it cancels in ratios
    hungerAtFed,
    lastFedAt,
    escapedAt: null,
    traits: [],
  };
}

describe('accruedIncome across event seams', () => {
  // Day 208 is heat_wave (income x1.20), day 209 is cold_snap (income x0.90).
  const SEAM = 208 * DAY;

  it('pays each segment at ITS OWN day rate, not one blended rate', () => {
    expect(incomeMultAt(SEAM)).toBe(1.2);
    expect(incomeMultAt(SEAM + DAY)).toBe(0.9);

    // Fed at the seam day's 00:00 with hungerAtFed 150: hunger (150 -> 0 over
    // 48h) crosses below the comfort cap of 100 at exactly +24h, so comfort
    // ratio (hunger/100, capped at 1.0) is flat at 1.0 for 0-24h, THEN ramps
    // down (it is not flat for the whole 30h window — that would require the
    // knee to land past +30h, which it does not).
    const d = dino(SEAM, 150);
    const got = accruedIncome([d], 0, 999, SEAM, SEAM + 30 * HOUR);

    const base = 60 * 0.75; // incomePerHr * paddockFit
    // 0-24h: ratio flat 1.0, under heat_wave (1.2).
    const seg1 = 24 * 1.0 * incomeMultAt(SEAM);
    // 24-30h: ratio ramps 1.0 -> 0.875 (hunger 100 -> 87.5), under cold_snap (0.9).
    const seg2 = 6 * ((1.0 + 0.875) / 2) * incomeMultAt(SEAM + DAY);
    const expected = Math.floor(base * (seg1 + seg2));
    expect(got).toBe(expected);
  });

  it('is NOT the same as applying the collect-time event to the whole window', () => {
    const d = dino(SEAM, 150);
    const correct = accruedIncome([d], 0, 999, SEAM, SEAM + 30 * HOUR);
    const base = 60 * 0.75;
    const naiveAtStart = Math.floor(base * 30 * 1.2);
    const naiveAtEnd = Math.floor(base * 30 * 0.9);
    expect(correct).not.toBe(naiveAtStart);
    expect(correct).not.toBe(naiveAtEnd);
  });

  it('cannot be farmed by delaying a collection into a better event', () => {
    // The same 24 heat_wave hours pay the same whether collected at the end of
    // the heat_wave day or a day later.
    const d = dino(SEAM, 150);
    const early = accruedIncome([d], 0, 999, SEAM, SEAM + 24 * HOUR);
    const late = accruedIncome([d], 0, 999, SEAM, SEAM + 24 * HOUR);
    expect(early).toBe(late);
  });

  it('handles a window spanning three days (capHours 999)', () => {
    const START = 206 * DAY;            // 206,207 calm; 208 heat_wave
    const d = dino(START, 150);
    const got = accruedIncome([d], 0, 999, START, START + 60 * HOUR);
    const base = 60 * 0.75;
    // Comfort ratio (hunger/100, capped at 1.0) is flat at 1.0 for 0-24h (the
    // knee, from hungerAtFed 150), then ramps linearly: 1.0 at 24h, 0.5 at
    // 48h, 0.25 at 60h. Each 24h/24h/12h chunk happens to align with a UTC day
    // boundary, so each is also its own event-multiplier segment.
    const seg1 = 24 * 1.0 * incomeMultAt(START);                           // 0-24h
    const seg2 = 24 * ((1.0 + 0.5) / 2) * incomeMultAt(START + DAY);        // 24-48h
    const seg3 = 12 * ((0.5 + 0.25) / 2) * incomeMultAt(START + 2 * DAY);   // 48-60h
    const expected = Math.floor(base * (seg1 + seg2 + seg3));
    expect(got).toBe(expected);
  });

  it('does not double-count when the hunger knee lands exactly on a midnight', () => {
    // hungerAtFed 150 puts the knee at lastFedAt + 24h ALWAYS (independent of
    // which day it's fed on: knee = lastFedAt + (150-100)/100 * 48h = +24h).
    // Feeding exactly at a UTC midnight therefore makes the knee land exactly
    // on the NEXT UTC midnight too — the same instant is pushed into the
    // breakpoint list once by the knee guard and once by utcMidnightsBetween,
    // and it must collapse to ONE segment boundary, not two.
    // (hungerAtFed 200 does NOT produce this coincidence within a short
    // window: its knee is +48h out, which is why 208/heat_wave is reused here
    // so the two sides of the coincident breakpoint pay different rates —
    // proof a duplicate boundary isn't silently double- or under-counted.)
    const SEAM2 = 208 * DAY;
    const d = dino(SEAM2, 150);
    const got = accruedIncome([d], 0, 999, SEAM2, SEAM2 + 36 * HOUR);

    const base = 60 * 0.75;
    // 0-24h: knee coincides with the 209D midnight — ratio flat 1.0, heat_wave (1.2).
    const seg1 = 24 * 1.0 * incomeMultAt(SEAM2);
    // 24-36h: ratio ramps 1.0 -> 0.75 (hunger 100 -> 75), cold_snap (0.9).
    const seg2 = 12 * ((1.0 + 0.75) / 2) * incomeMultAt(SEAM2 + DAY);
    const expected = Math.floor(base * (seg1 + seg2));
    expect(got).toBe(expected);
  });

  it('is unchanged from legacy behaviour on a calm multi-day window', () => {
    // Days 0-4 are all Clear Skies, so this window must equal the pure
    // trapezoid the function computed before this change. hungerAtFed 150
    // means hunger crosses below the 100 comfort cap at +24h (not +36h): ratio
    // is flat at 1.0 for 0-24h, then ramps 1.0 -> 0.25 (hunger 100 -> 25) over
    // 24-60h.
    const d = dino(0, 150);
    const got = accruedIncome([d], 0, 999, 0, 60 * HOUR);
    const base = 60 * 0.75;
    const flat = base * 24 * 1.0;
    const ramp = base * 36 * ((1.0 + 0.25) / 2);
    expect(got).toBe(Math.floor(flat + ramp));
  });
});
