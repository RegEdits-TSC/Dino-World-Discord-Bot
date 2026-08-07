import { describe, it, expect } from 'vitest';
import { accruedIncome, type ClockDino } from '../src/core/clock.js';
import { incomeMultAt } from '../src/core/world.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { allSpecies } from '../src/data/species/index.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

// A common herbivore (60 cash/hr) in a correct-diet paddock with NO biome decor
// => paddockFit 0.75, so comfort is 0.75 × min(100, hunger)/100.
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
    // The comfort trapezoid itself (24h flat at ratio 1.0, then 6h ramping
    // 1.0 -> 0.875) is pure hunger math, untouched by the event system — a
    // once-per-request implementation still gets THIS right. Its bug is
    // sampling incomeMultAt a single time and applying that one rate to the
    // whole trapezoid, instead of once per segment. "Start-sampled" uses the
    // rate at collection start (1.2); "end-sampled" uses the rate at collection
    // end/"now" (0.9). These are the actual outputs such an implementation
    // would produce (1599 and 1199) — not the flat-comfort guess this test
    // used before, which happened to also be wrong for an unrelated reason and
    // so never actually ruled out a once-per-request implementation.
    const ratioHours = 24 * 1.0 + 6 * ((1.0 + 0.875) / 2);
    const naiveAtStart = Math.floor(base * ratioHours * incomeMultAt(SEAM));
    const naiveAtEnd = Math.floor(base * ratioHours * incomeMultAt(SEAM + 30 * HOUR));
    expect(correct).not.toBe(naiveAtStart);
    expect(correct).not.toBe(naiveAtEnd);
  });

  it('cannot be farmed by delaying a collection into a better event', () => {
    // A single split point cannot discriminate a request-time-sampled
    // implementation from the correct one unless the split point's OWN day
    // rate differs from BOTH endpoints' day rates. `whole` and `rest` always
    // share the same `to`, so a naive "mult = incomeMultAt(to)" implementation
    // gives `rest` and `whole` the identical single rate, and additivity holds
    // for it trivially regardless of where the split falls (it can only be
    // caught if the split point's rate differs from `to`'s rate). Symmetrically,
    // `whole` and `first` always share the same `from`, so a naive
    // "mult = incomeMultAt(from)" implementation can only be caught if the
    // split point's rate differs from `from`'s rate. One split point that
    // differs from BOTH endpoints therefore catches both naive variants at
    // once — which needs three distinct day-rates in the window, not two.
    // 208 (heat_wave 1.2), 209 (cold_snap 0.9), 210 (clear_skies 1.0) are
    // three pairwise-distinct rates on three consecutive days.
    const d = dino(SEAM, 150);
    const P = SEAM + 36 * HOUR; // interior of day 209 — differs from both 208 and 210
    const whole = accruedIncome([d], 0, 999, SEAM, SEAM + 60 * HOUR);
    const first = accruedIncome([d], 0, 999, SEAM, P);
    const rest = accruedIncome([d], 0, 999, P, SEAM + 60 * HOUR);
    // (+/-1 tolerance: two floors instead of one.) Verified directly (see the
    // task report): a request-time-sampled variant, mutated in temporarily
    // and reverted, fails this exact assertion by 155 (sampled at `to`) or 162
    // (sampled at `from`) — this split genuinely discriminates both.
    expect(Math.abs(whole - (first + rest))).toBeLessThanOrEqual(1);
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

  it('stops at the per-dino end, not the shared window end, across a midnight', () => {
    // Regression coverage for enumerating midnights over the wrong bound.
    // Observing that bug needs BOTH dinoEnd < end AND a UTC midnight strictly
    // inside (dinoEnd, end) — nothing elsewhere in the suite has both.
    //
    // A hunger-zero-truncated dino (e.g. hungerAtFed 10) does NOT work for
    // this: comfortAt clamps to 0 for any t past hungerZero regardless of
    // which bound utcMidnightsBetween is given, so an extra breakpoint past
    // dinoEnd contributes 0 either way — verified directly: temporarily
    // changing utcMidnightsBetween(from, dinoEnd) to
    // utcMidnightsBetween(from, end) in clock.ts left that scenario's result
    // completely unchanged. comfortAt has no knowledge of ESCAPE, though, so
    // an escape-truncated dino stays nonzero past dinoEnd and the bug becomes
    // observable.
    //
    // hungerAtFed 100 (not overfed, no knee) fed 2h into day 208. Comfort
    // crosses ESCAPE_COMFORT (0.25) at hunger 33.33% (threshold =
    // ESCAPE_COMFORT/fit * 100 = 0.25/0.75*100, fit 0.75), which takes 32h;
    // + GRACE_MS (8h) puts escapeAt at lastFedAt+40h = 208D+42h — before
    // hungerZero (lastFedAt+48h = 208D+50h), so escape governs dinoEnd, not
    // starvation. The window's shared `end` runs to 208D+54h, so the 210D
    // midnight (208D+48h) sits strictly inside (dinoEnd=208D+42h, end=208D+54h)
    // — exactly the gap the two bounds disagree on. Only the 209D midnight
    // (208D+24h) is a real breakpoint; 210D must NOT be enumerated.
    //
    // Verified directly against the real functions (escapeAt, comfortAt) and
    // by temporarily swapping the bound in clock.ts and reverting: correct
    // (dinoEnd) gives 1173, the swapped-to-`end` bug gives 1199.
    const lastFedAt = 208 * DAY + 2 * HOUR;
    const d = dino(lastFedAt, 100);
    const got = accruedIncome([d], 0, 999, lastFedAt, 208 * DAY + 54 * HOUR);

    const base = 60 * 0.75;
    const ratioAt = (relHours: number) => (100 - ((relHours - 2) / 48) * 100) / 100; // relHours = hours since 208D
    const r0 = ratioAt(2);   // = 1.0, at `from`
    const r24 = ratioAt(24); // at the 209D midnight
    const r42 = ratioAt(42); // at dinoEnd (lastFedAt + 40h)
    const seg1 = (24 - 2) * ((r0 + r24) / 2) * incomeMultAt(208 * DAY);           // from -> 209D, heat_wave
    const seg2 = (42 - 24) * ((r24 + r42) / 2) * incomeMultAt(208 * DAY + DAY);   // 209D -> dinoEnd, cold_snap
    const expected = Math.floor(base * (seg1 + seg2));
    expect(got).toBe(expected);
  });

  it('prices a knee that coincides with a midnight at the NEW day rate, not the old one', () => {
    // hungerAtFed 150 puts the knee at lastFedAt + 24h ALWAYS (independent of
    // which day it's fed on: knee = lastFedAt + (150-100)/100 * 48h = +24h).
    // Feeding exactly at a UTC midnight therefore makes the knee land exactly
    // on the NEXT UTC midnight too — the same instant enters the breakpoint
    // list once via the knee guard and once via utcMidnightsBetween. Reusing
    // the 208/heat_wave -> 209/cold_snap seam here (rather than a same-rate
    // pair of days) is what actually pins the behaviour: the segment starting
    // exactly at the coincident instant must be priced at cold_snap (0.9), the
    // NEW day's rate, not heat_wave (1.2) carried over from the old one. (Note:
    // a duplicate zero-width breakpoint contributes 0 to the trapezoid on its
    // own regardless of any dedup guard, so this test's real content is the
    // per-segment rate at the coincidence, not "double-counting" per se.)
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
