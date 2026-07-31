import { describe, it, expect } from 'vitest';
import { hungerAt, paddockFit, comfortAt, escapeMoment, accruedIncome, HUNGER_DRAIN_MS, GRACE_MS, escapeAt, ESCAPE_WARN_MS, drainMsFor } from '../src/core/clock.js';
import { triceratops } from '../src/data/species/triceratops.js';
import { velociraptor } from '../src/data/species/velociraptor.js';
import { getSpecies } from '../src/data/species/index.js';
import { PADDOCKS } from '../src/data/paddocks.js';

const H = 3_600_000;
const herb = PADDOCKS.herbivore_paddock;
const carn = PADDOCKS.carnivore_paddock;
const fedTrike = (over: Partial<Parameters<typeof comfortAt>[0]> = {}) => ({
  species: triceratops, paddock: herb, decor: ['forest'],
  hungerAtFed: 100, lastFedAt: 0, escapedAt: null as number | null, traits: [] as string[], ...over,
});

describe('hungerAt', () => {
  it('drains linearly to zero over 48h and clamps', () => {
    expect(hungerAt(100, 0, 0, HUNGER_DRAIN_MS)).toBe(100);
    expect(hungerAt(100, 0, HUNGER_DRAIN_MS / 2, HUNGER_DRAIN_MS)).toBeCloseTo(50);
    expect(hungerAt(100, 0, HUNGER_DRAIN_MS * 2, HUNGER_DRAIN_MS)).toBe(0);
  });
});

describe('paddockFit', () => {
  it('1.0 diet+biome, 0.75 diet only, 0.5 wrong diet', () => {
    expect(paddockFit(triceratops, herb, ['forest'])).toBe(1.0);
    expect(paddockFit(triceratops, herb, [])).toBe(0.75);
    expect(paddockFit(triceratops, carn, ['forest'])).toBe(0.5);
  });
});

describe('escapeMoment', () => {
  it('null while comfort stays >= 25%', () => {
    expect(escapeMoment(fedTrike(), 4 * H)).toBeNull();
  });
  it('fires GRACE_MS after comfort crosses 25%', () => {
    // fit 1.0: comfort hits 0.25 at hunger 25 => 36h after feed; escape at 36h + 8h grace = 44h
    expect(escapeMoment(fedTrike(), 60 * H)).toBe(36 * H + GRACE_MS);
  });
});

describe('accruedIncome', () => {
  it('integrates mean comfort over the window', () => {
    // Trike fit 1.0, hunger 100->75 over first 12h => mean comfort 0.875; 60/hr * 0.875 * 12h = 630
    expect(accruedIncome([fedTrike()], 0, 24, 0, 12 * H)).toBe(630);
  });
  it('applies facility bonus and cap_hours', () => {
    // capped at 8h: hunger 100->83.33 at 8h => mean 0.91667; 60*0.91667*8 = 440; +10% => 484
    expect(accruedIncome([fedTrike()], 10, 8, 0, 12 * H)).toBe(484);
  });
  it('pays zero for unassigned or already-escaped dinos', () => {
    const escaped = fedTrike({ escapedAt: 0 });
    const unassigned = fedTrike({ paddock: null });
    expect(accruedIncome([escaped, unassigned], 0, 24, 0, 12 * H)).toBe(0);
  });
  it('truncates a wrong-diet dino at the cap before its escape moment', () => {
    // raptor in herb paddock => fit 0.5; comfort 0.25 at hunger 50 => 24h; escape 24h+8h=32h
    // window 0..cap 24h: hunger 100->50, comfort 0.5->0.25, mean 0.375; 400*0.375*24 = 3600
    const raptor = { ...fedTrike(), species: velociraptor };
    expect(accruedIncome([raptor], 0, 24, 0, 48 * H)).toBe(3600);
  });
  it('does not over-pay after hunger reaches zero mid-window', () => {
    // hungerAtFed 10, fit 1.0 => hunger hits 0 at 4.8h; true income 60 * (0.5*0.10*4.8) = 14.4 -> floor 14
    const starving = fedTrike({ hungerAtFed: 10 });
    expect(accruedIncome([starving], 0, 24, 0, 8 * H)).toBe(14);
  });
});

describe('escapeAt', () => {
  const base = { hungerAtFed: 100, lastFedAt: 0, escapedAt: null, traits: [] };
  it('is null for an unassigned dino', () => {
    expect(escapeAt({ ...base, species: triceratops, paddock: null, decor: [] })).toBeNull();
  });
  it('is crossing + grace for an assigned dino', () => {
    const e = escapeAt({ ...base, species: triceratops, paddock: herb, decor: [] });
    expect(e).not.toBeNull();
    expect(e!).toBeGreaterThan(GRACE_MS); // crossing is strictly positive from full hunger
  });
  it('returns the stamped instant for an already-escaped dino', () => {
    expect(escapeAt({ ...base, escapedAt: 123, species: triceratops, paddock: herb, decor: [] })).toBe(123);
  });
});

describe('overfill (hungerAtFed > 100)', () => {
  it('clamps comfort at fit while hunger is above 100', () => {
    // fillTo 150, fit 1.0: comfort must be 1.0 at t=0, not 1.5
    expect(comfortAt(fedTrike({ hungerAtFed: 150 }), 0)).toBe(1.0);
    // hunger drains 150 -> 100 over 24h; still clamped at the crossing
    expect(comfortAt(fedTrike({ hungerAtFed: 150 }), 24 * H)).toBe(1.0);
    // 12h past the crossing: hunger 75 -> comfort 0.75
    expect(comfortAt(fedTrike({ hungerAtFed: 150 }), 36 * H)).toBeCloseTo(0.75);
  });
  it('integrates income piecewise across the hunger-100 crossing', () => {
    // hungerAtFed 150, fit 1.0, window 0..36h. Crossing at 24h (150->100 at 100/48h drain).
    // Segment 1: comfort flat 1.0 for 24h = 24 comfort-hours.
    // Segment 2: comfort 1.0 -> 0.75 over 12h, mean 0.875 = 10.5 comfort-hours.
    // A naive two-point trapezoid over the whole window would give (1.0+0.75)/2*36 = 31.5 — wrong.
    // Correct: 34.5 * 60/hr = 2070.
    expect(accruedIncome([fedTrike({ hungerAtFed: 150 })], 0, 48, 0, 36 * H)).toBe(2070);
  });
  it('delays the escape moment when overfed', () => {
    // fit 1.0: comfort crosses 0.25 at hunger 25. From 150 that is (150-25)/100*48h = 60h; +8h grace.
    expect(escapeAt(fedTrike({ hungerAtFed: 150 }))).toBe(60 * H + GRACE_MS);
  });
});

describe('trait-modified drain', () => {
  it('stretches the drain window for Hardy and shortens it for Skittish', () => {
    expect(drainMsFor([])).toBe(HUNGER_DRAIN_MS);
    expect(drainMsFor(['hardy'])).toBeCloseTo(HUNGER_DRAIN_MS / 0.75);
    expect(drainMsFor(['skittish'])).toBeCloseTo(HUNGER_DRAIN_MS / 1.2);
  });

  it('drains hunger more slowly for a Hardy dino', () => {
    const at = 24 * 3_600_000;
    expect(hungerAt(100, 0, at, drainMsFor([]))).toBeCloseTo(50);
    expect(hungerAt(100, 0, at, drainMsFor(['hardy']))).toBeCloseTo(62.5);
  });

  // comfortCrossing derives its instant from the drain rate too — a fourth place the
  // per-dino rate has to reach. The flat GRACE_MS after the crossing does not stretch.
  it('pushes the escape instant out for a Hardy dino', () => {
    // fit 1.0: comfort crosses 0.25 at hunger 25, i.e. 75% of the window. On Hardy's
    // 64h window that is 48h (vs 36h on the global one), then +8h grace either way.
    expect(escapeAt(fedTrike({ traits: ['hardy'] }))).toBe(48 * H + GRACE_MS);
    expect(escapeAt(fedTrike())).toBe(36 * H + GRACE_MS);
  });
});

describe('trait-modified income', () => {
  const base = {
    species: getSpecies('triceratops'),
    paddock: PADDOCKS.herbivore_paddock,
    decor: [] as string[],
    escapedAt: null,
  };

  it('scales income by the Prolific multiplier', () => {
    const plain = accruedIncome([{ ...base, hungerAtFed: 100, lastFedAt: 0, traits: [] }], 0, 8, 0, 3_600_000);
    const prolific = accruedIncome([{ ...base, hungerAtFed: 100, lastFedAt: 0, traits: ['prolific'] }], 0, 8, 0, 3_600_000);
    expect(prolific).toBeGreaterThan(plain);
    expect(prolific / plain).toBeCloseTo(1.15, 1);
  });

  // The knee at hunger 100 is computed from the drain rate. A trait that changes
  // drain moves the knee, and a two-point mean across it is wrong. This case
  // straddles it deliberately.
  it('stays piecewise-correct across the hunger-100 knee with a non-1.0 drain', () => {
    const dino = { ...base, hungerAtFed: 150, lastFedAt: 0, traits: ['hardy'] };
    const drain = drainMsFor(['hardy']);
    const knee = (50 / 100) * drain;              // hunger falls 150 -> 100 here
    const end = knee * 2;

    const whole = accruedIncome([dino], 0, 999, 0, end);
    const firstHalf = accruedIncome([dino], 0, 999, 0, knee);
    const secondHalf = accruedIncome([dino], 0, 999, knee, end);

    // Splitting at the knee must equal the single call (within rounding).
    expect(Math.abs(whole - (firstHalf + secondHalf))).toBeLessThanOrEqual(2);
  });

  it('pays a flat rate before the knee, since comfort is capped at hunger 100', () => {
    const dino = { ...base, hungerAtFed: 150, lastFedAt: 0, traits: [] };
    const hour = 3_600_000;
    const first = accruedIncome([dino], 0, 999, 0, hour);
    const second = accruedIncome([dino], 0, 999, hour, 2 * hour);
    expect(first).toBe(second);
  });

  // accruedIncome's hungerZero cutoff is the third rate-derived expression; a Hardy
  // dino must keep earning past the instant the global rate would have starved it.
  it('pays until the trait-adjusted hunger-zero instant', () => {
    // hungerAtFed 10 zeroes at 4.8h on the 48h window but at 6.4h on Hardy's 64h one.
    // fit 1.0: comfort 0.10 -> 0 over 6.4h = 0.32 comfort-hours * 60/hr = 19.2 -> 19.
    // Truncating at 4.8h instead pays 18.
    expect(accruedIncome([fedTrike({ hungerAtFed: 10, traits: ['hardy'] })], 0, 24, 0, 8 * H)).toBe(19);
  });
});
