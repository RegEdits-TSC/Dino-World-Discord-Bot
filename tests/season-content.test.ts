import { describe, it, expect } from 'vitest';
import {
  SEASON_SOURCES, SEASON_RUNGS, SEASON_CAPSTONE, HEAD_START_CAP, sourcePoints,
} from '../src/data/seasons.js';
import { STATS } from '../src/core/stats.js';
import { FOODS } from '../src/data/foods.js';

// Counters a veteran can never move again. Crediting one would hand a new account a
// permanent advantage over exactly the players this loop exists to keep.
const FINITE_STATS = ['stages_first_cleared', 'lots_built', 'lots_upgraded'];
// acceptTrade requires a second player, so a source whose ONLY stat is this one is
// unreachable solo.
const NEEDS_PARTNER = ['trades_completed'];

describe('season content gate', () => {
  it('is 9 sources with unique ids referencing real stats', () => {
    expect(SEASON_SOURCES).toHaveLength(9);
    expect(new Set(SEASON_SOURCES.map((s) => s.id)).size).toBe(9);
    for (const src of SEASON_SOURCES) {
      expect(src.stats.length).toBeGreaterThan(0);
      for (const e of src.stats) {
        expect(STATS[e.stat], `${src.id} references unknown stat ${e.stat}`).toBeDefined();
        expect(e.points).toBeGreaterThan(0);
        expect(e.per).toBeGreaterThan(0);
      }
    }
  });

  it('never credits a finite lifetime counter', () => {
    for (const src of SEASON_SOURCES) {
      for (const e of src.stats) {
        expect(FINITE_STATS, `${src.id} credits finite counter ${e.stat}`).not.toContain(e.stat);
      }
    }
  });

  // The assertion that would have caught the dropped-trading design: every source must
  // have at least one stat a solo player can move.
  it('every source is reachable solo', () => {
    for (const src of SEASON_SOURCES) {
      const solo = src.stats.filter((e) => !NEEDS_PARTNER.includes(e.stat));
      expect(solo.length, `${src.id} is only reachable with a second player`).toBeGreaterThan(0);
    }
  });

  it('caps sum above the capstone, and no single source can reach it', () => {
    const available = SEASON_SOURCES.reduce((s, x) => s + x.cap, 0);
    expect(available).toBe(1335);
    expect(available).toBeGreaterThan(SEASON_CAPSTONE);
    for (const src of SEASON_SOURCES) {
      expect(src.cap, `${src.id} alone reaches the capstone`).toBeLessThan(SEASON_CAPSTONE);
    }
    // Breadth is forced: the largest source is under a third of the capstone.
    expect(Math.max(...SEASON_SOURCES.map((s) => s.cap)) / SEASON_CAPSTONE).toBeLessThan(0.32);
  });

  it('is 8 strictly ascending rungs whose last one is the capstone', () => {
    expect(SEASON_RUNGS).toHaveLength(8);
    for (let i = 1; i < SEASON_RUNGS.length; i++) {
      expect(SEASON_RUNGS[i].points).toBeGreaterThan(SEASON_RUNGS[i - 1].points);
    }
    expect(SEASON_RUNGS[SEASON_RUNGS.length - 1].points).toBe(SEASON_CAPSTONE);
    expect(SEASON_RUNGS.map((r) => r.points)).toEqual([50, 125, 225, 350, 475, 600, 700, 800]);
  });

  it('pays real foods, and shards stay well under the quest line', () => {
    const shards = SEASON_RUNGS.reduce((s, r) => s + (r.rewards.shards ?? 0), 0);
    const cash = SEASON_RUNGS.reduce((s, r) => s + (r.rewards.cash ?? 0), 0);
    for (const r of SEASON_RUNGS) {
      if (r.rewards.food) expect(FOODS[r.rewards.food.foodId]).toBeDefined();
    }
    expect(cash).toBe(60_000);
    expect(shards).toBe(110);
    // 30 days of daily quests pays ~450 shards. A season must stay materially below that,
    // because shards buy mythic eggs at 500 and doubling mythic acquisition is a balance
    // change, not a reward tweak.
    expect(shards).toBeLessThan(150);
  });

  it('splicing costs less in shards than the track pays back', () => {
    const splice = SEASON_SOURCES.find((s) => s.id === 'splicing')!;
    const splicesToCap = splice.cap / splice.stats[0].points;   // points are per 1 splice
    const shardCost = splicesToCap * 15;                        // SPLICE_SHARD_COST
    const paidBack = SEASON_RUNGS.reduce((s, r) => s + (r.rewards.shards ?? 0), 0);
    expect(shardCost).toBeLessThan(paidBack);
  });

  it('sourcePoints floors per-unit and clamps at the cap', () => {
    const care = SEASON_SOURCES.find((s) => s.id === 'care')!;   // 1 point per 3 feeds
    expect(sourcePoints(care, { dinos_fed: 0 })).toBe(0);
    expect(sourcePoints(care, { dinos_fed: 2 })).toBe(0);
    expect(sourcePoints(care, { dinos_fed: 3 })).toBe(1);
    expect(sourcePoints(care, { dinos_fed: 5 })).toBe(1);
    expect(sourcePoints(care, { dinos_fed: 99_999 })).toBe(care.cap);
  });

  it('sourcePoints sums a multi-stat source before clamping', () => {
    const commerce = SEASON_SOURCES.find((s) => s.id === 'commerce')!;
    expect(sourcePoints(commerce, { trades_completed: 1 })).toBe(15);
    expect(sourcePoints(commerce, { shop_purchases: 10 })).toBe(10);
    expect(sourcePoints(commerce, { trades_completed: 1, shop_purchases: 10 })).toBe(25);
    expect(sourcePoints(commerce, { trades_completed: 99 })).toBe(commerce.cap);
  });

  it('treats a negative delta as zero rather than subtracting', () => {
    const care = SEASON_SOURCES.find((s) => s.id === 'care')!;
    expect(sourcePoints(care, { dinos_fed: -50 })).toBe(0);
  });

  it('caps the head start below the third rung', () => {
    expect(HEAD_START_CAP).toBe(200);
    // Natural max is 52 species + 105 stars + 40 rating = 197.
    expect(197).toBeLessThan(SEASON_RUNGS[2].points);
  });
});
