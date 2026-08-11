import { describe, it, expect } from 'vitest';
import { expectedScore, eloDelta } from '../src/data/battle/elo.js';
import { DUEL_K, DUEL_START_RATING } from '../src/data/battle/constants.js';

describe('elo', () => {
  it('gives equal ratings an even expectation', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
  });

  it('is symmetric: the two expectations always sum to 1', () => {
    for (const [a, b] of [[1000, 1000], [1200, 800], [1000, 1400], [1, 3000]]) {
      expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 12);
    }
  });

  it('pays a favourite almost nothing for beating a much weaker opponent', () => {
    expect(eloDelta(1400, 1000, 1)).toBeLessThanOrEqual(3);
    expect(eloDelta(1400, 1000, 1)).toBeGreaterThan(0);
  });

  it('costs a favourite heavily for losing to a much weaker opponent', () => {
    expect(eloDelta(1400, 1000, 0)).toBeLessThan(-DUEL_K / 2);
  });

  it('moves nobody on a draw between equals', () => {
    expect(eloDelta(1000, 1000, 0.5)).toBe(0);
  });

  it('pays the underdog for a draw and charges the favourite the same', () => {
    const under = eloDelta(1000, 1400, 0.5);
    expect(under).toBeGreaterThan(0);
    expect(eloDelta(1400, 1000, 0.5)).toBe(-under);
  });

  // The zero-sum invariant. Rounding each side independently does NOT conserve
  // points: Math.round(2.5) is 3 but Math.round(-2.5) is -2. Callers must compute
  // one delta and apply its negation, and this test is what proves the helper is
  // safe to use that way — every pairing here returns exactly opposite values.
  it('conserves points across every pairing, including half-point cases', () => {
    for (let a = 600; a <= 1600; a += 37) {
      for (let b = 600; b <= 1600; b += 53) {
        expect(eloDelta(a, b, 1)).toBe(-eloDelta(b, a, 0));
        expect(eloDelta(a, b, 0.5)).toBe(-eloDelta(b, a, 0.5));
      }
    }
  });

  it('never returns a fractional rating change', () => {
    expect(Number.isInteger(eloDelta(1000, 1017, 1))).toBe(true);
    expect(Number.isInteger(eloDelta(DUEL_START_RATING, 993, 0))).toBe(true);
  });

  it('asymptotes rather than flooring: a 400-point underdog loses very little', () => {
    expect(eloDelta(600, 1000, 0)).toBeGreaterThanOrEqual(-4);
  });
});
