import { describe, it, expect } from 'vitest';
import { LANDMARKS, MAX_LANDMARK_TIER, landmarkFor, landmarkCostFor, landmarkBandFor } from '../src/data/landmarks.js';

describe('landmark ladder', () => {
  it('is six rungs of strictly increasing cost', () => {
    expect(LANDMARKS).toHaveLength(6);
    expect(MAX_LANDMARK_TIER).toBe(6);
    LANDMARKS.forEach((l, i) => expect(l.tier, l.name).toBe(i + 1));
    for (let i = 1; i < LANDMARKS.length; i++) {
      expect(LANDMARKS[i].cost, LANDMARKS[i].name).toBeGreaterThan(LANDMARKS[i - 1].cost);
    }
  });
  it('matches the spec values', () => {
    expect(LANDMARKS.map((l) => l.cost)).toEqual([5_000_000, 10_000_000, 20_000_000, 40_000_000, 80_000_000, 160_000_000]);
    expect(LANDMARKS.map((l) => l.band)).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
    expect(LANDMARKS.map((l) => l.name)).toEqual([
      'Stone Marker', 'Fossil Plinth', 'Bronze Sentinel', 'Amber Obelisk', 'Grand Rotunda', 'Titan Monument',
    ]);
  });
  it('totals 315,000,000 — the sink sizing the spec is built on', () => {
    expect(LANDMARKS.reduce((s, l) => s + l.cost, 0)).toBe(315_000_000);
  });
  it('every band is used, so no art file is orphaned', () => {
    expect(new Set(LANDMARKS.map((l) => l.band))).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('landmark lookups', () => {
  it('resolve a real tier', () => {
    expect(landmarkFor(1)!.name).toBe('Stone Marker');
    expect(landmarkCostFor(3)).toBe(20_000_000);
    expect(landmarkBandFor(5)).toBe('c');
  });
  it('return null outside the ladder rather than throwing or reading past the table', () => {
    for (const t of [0, -1, 7, 99, 1.5, NaN]) {
      expect(landmarkFor(t), `tier ${t}`).toBeNull();
      expect(landmarkCostFor(t), `tier ${t}`).toBeNull();
      expect(landmarkBandFor(t), `tier ${t}`).toBeNull();
    }
  });
});
