import { describe, it, expect } from 'vitest';
import { hungerAt, paddockFit, comfortAt, escapeMoment, accruedIncome, HUNGER_DRAIN_MS, GRACE_MS } from '../src/core/clock.js';
import { triceratops } from '../src/data/species/triceratops.js';
import { velociraptor } from '../src/data/species/velociraptor.js';
import { PADDOCKS } from '../src/data/paddocks.js';

const H = 3_600_000;
const herb = PADDOCKS.herbivore_paddock;
const carn = PADDOCKS.carnivore_paddock;
const fedTrike = (over: Partial<Parameters<typeof comfortAt>[0]> = {}) => ({
  species: triceratops, paddock: herb, decor: ['forest'],
  hungerAtFed: 100, lastFedAt: 0, escapedAt: null as number | null, ...over,
});

describe('hungerAt', () => {
  it('drains linearly to zero over 48h and clamps', () => {
    expect(hungerAt(100, 0, 0)).toBe(100);
    expect(hungerAt(100, 0, HUNGER_DRAIN_MS / 2)).toBeCloseTo(50);
    expect(hungerAt(100, 0, HUNGER_DRAIN_MS * 2)).toBe(0);
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
