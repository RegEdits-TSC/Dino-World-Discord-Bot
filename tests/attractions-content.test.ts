import { describe, it, expect } from 'vitest';
import { ATTRACTIONS, attractionFor, MAX_ATTRACTION_LEVEL } from '../src/data/attractions.js';
import { ATTRACTION_DRAW_TARGET } from '../src/data/attendance.js';

const ALL = Object.values(ATTRACTIONS);

describe('attractions catalog', () => {
  it('keys every entry by its own kind', () => {
    for (const [key, def] of Object.entries(ATTRACTIONS)) expect(def.kind).toBe(key);
  });

  it('gives every kind exactly maxLevel draw values and maxLevel-1 upgrade costs', () => {
    for (const def of ALL) {
      expect(def.draw).toHaveLength(def.maxLevel);
      expect(def.upgradeCosts).toHaveLength(def.maxLevel - 1);
    }
  });

  it('makes draw and cost strictly ascending within every kind', () => {
    for (const def of ALL) {
      for (let i = 1; i < def.draw.length; i++) expect(def.draw[i]).toBeGreaterThan(def.draw[i - 1]);
      for (let i = 1; i < def.upgradeCosts.length; i++) {
        expect(def.upgradeCosts[i]).toBeGreaterThan(def.upgradeCosts[i - 1]);
      }
      expect(def.upgradeCosts[0]).toBeGreaterThan(def.buildCost);
    }
  });

  it('saturates the frozen draw target exactly when fully built', () => {
    const total = ALL.reduce((s, d) => s + d.draw[d.draw.length - 1], 0);
    expect(total).toBe(ATTRACTION_DRAW_TARGET);
  });

  it('unlocks its first kind at zero and every other at a distinct rising threshold', () => {
    const gates = ALL.map((d) => d.unlockAt).sort((a, b) => a - b);
    expect(gates[0]).toBe(0);
    expect(new Set(gates).size).toBe(gates.length);
  });

  it('makes a costlier kind draw more, so the unlock order is also the power order', () => {
    const byGate = [...ALL].sort((a, b) => a.unlockAt - b.unlockAt);
    for (let i = 1; i < byGate.length; i++) {
      const top = (d: typeof byGate[number]) => d.draw[d.draw.length - 1];
      expect(top(byGate[i])).toBeGreaterThan(top(byGate[i - 1]));
    }
  });

  it('costs a full catalog between 10 and 25 days of reference surplus', () => {
    const total = ALL.reduce((s, d) => s + d.buildCost + d.upgradeCosts.reduce((a, b) => a + b, 0), 0);
    const REFERENCE_SURPLUS_PER_DAY = 4_297_440;   // src/data/landmarks.ts
    expect(total / REFERENCE_SURPLUS_PER_DAY).toBeGreaterThan(10);
    expect(total / REFERENCE_SURPLUS_PER_DAY).toBeLessThan(25);
  });

  it('makes total cost strictly ascending across kinds, so unlock order is also cost order', () => {
    const byGate = [...ALL].sort((a, b) => a.unlockAt - b.unlockAt);
    for (let i = 1; i < byGate.length; i++) {
      const totalCost = (d: typeof byGate[number]) => d.buildCost + d.upgradeCosts.reduce((a, b) => a + b, 0);
      expect(totalCost(byGate[i])).toBeGreaterThan(totalCost(byGate[i - 1]));
    }
  });

  it('exports MAX_ATTRACTION_LEVEL matching the catalog', () => {
    const maxLevel = Math.max(...ALL.map((d) => d.maxLevel));
    expect(MAX_ATTRACTION_LEVEL).toBe(maxLevel);
  });

  it('resolves a known kind and refuses an unknown one', () => {
    expect(attractionFor('gift_shop')?.kind).toBe('gift_shop');
    expect(attractionFor('no_such_kind')).toBeNull();
  });
});
