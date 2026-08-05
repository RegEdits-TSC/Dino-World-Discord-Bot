import { describe, it, expect } from 'vitest';
import { QUESTS, CHURN_STATS, chestFor, nextChestAt, type QuestDef } from '../src/data/quests.js';
import { ACHIEVEMENTS, TIER_REWARDS } from '../src/data/achievements.js';
import { STATS } from '../src/core/stats.js';
import { FOODS } from '../src/data/foods.js';
import { STAGES } from '../src/data/battle/chapters/index.js';
import { BASE_LOT_SLOTS_FALLBACK, LOT_SLOT_THRESHOLDS } from '../src/data/progression.js';

describe('daily content gate', () => {
  it('pool is exactly 17 defs with unique ids referencing real stats', () => {
    expect(QUESTS).toHaveLength(17);
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(17);
    for (const q of QUESTS) expect(STATS[q.stat]).toBeDefined();
  });
  it('count-shaped quests reference count stats; only collect_cash is roll-computed', () => {
    for (const q of QUESTS) {
      if (typeof q.target === 'number') {
        expect(STATS[q.stat]).toBe('count');
        expect(q.target).toBeGreaterThan(0);
      } else {
        expect(q.target).toBe('half-day-income');
        expect(q.stat).toBe('income_collected');
      }
    }
  });
  it('food rewards reference real foods; sell_2 pays no shards', () => {
    for (const q of QUESTS) {
      if (q.rewards.food) expect(FOODS[q.rewards.food.foodId]).toBeDefined();
      expect(q.rewards.cash).toBeGreaterThan(0);
    }
    expect(QUESTS.find((q) => q.id === 'sell_2')!.rewards.shards).toBeUndefined();
    expect(QUESTS.filter((q) => q.rewards.food)).toHaveLength(2);
  });
  it("roller can always fill 3 slots: >= 3 distinct 'none' stats that are non-churn with a non-food def", () => {
    const safe = new Set(QUESTS
      .filter((q) => q.requirement === 'none' && !CHURN_STATS.includes(q.stat) && !q.rewards.food)
      .map((q) => q.stat));
    expect(safe.size).toBeGreaterThanOrEqual(3);
  });
  it('chests: fixed 3/7/14, escalating every-30 capped at 100 shards, null elsewhere', () => {
    expect(chestFor(3)).toEqual({ cash: 1500, shards: 0 });
    expect(chestFor(7)).toEqual({ cash: 3000, shards: 20 });
    expect(chestFor(14)).toEqual({ cash: 2500, shards: 0, eggRarity: 'rare' });
    expect(chestFor(30)).toEqual({ cash: 0, shards: 40, eggRarity: 'epic' });
    expect(chestFor(60)!.shards).toBe(50);
    expect(chestFor(210)!.shards).toBe(100);
    expect(chestFor(240)!.shards).toBe(100);
    for (const n of [1, 2, 4, 13, 15, 29, 31, 45]) expect(chestFor(n)).toBeNull();
  });
  it('nextChestAt skips milestones at or under the personal best', () => {
    expect(nextChestAt(0, 0)).toBe(3);
    expect(nextChestAt(5, 0)).toBe(7);
    expect(nextChestAt(5, 14)).toBe(30);
    expect(nextChestAt(31, 30)).toBe(60);
    expect(nextChestAt(0, 200)).toBe(210);
  });
  it('achievements: exactly 12 tracks, one per stat, ascending tiers', () => {
    expect(ACHIEVEMENTS).toHaveLength(12);
    expect(new Set(ACHIEVEMENTS.map((t) => t.stat)).size).toBe(12);
    for (const t of ACHIEVEMENTS) {
      expect(STATS[t.stat]).toBeDefined();
      expect(t.tiers[0]).toBeGreaterThan(0);
      for (let i = 1; i < 4; i++) expect(t.tiers[i]).toBeGreaterThan(t.tiers[i - 1]);
    }
  });
  it('reward ceilings: lifetime achievement shards <= 350 and cash <= 150000', () => {
    const totalShards = ACHIEVEMENTS.length * TIER_REWARDS.reduce((s, r) => s + r.shards, 0);
    const totalCash = ACHIEVEMENTS.length * TIER_REWARDS.reduce((s, r) => s + r.cash, 0);
    expect(totalShards).toBeLessThanOrEqual(350);
    expect(totalCash).toBeLessThanOrEqual(150_000);
  });
});

describe('achievement reachability', () => {
  // A tier above the game's own ceiling can never be claimed. lots_built shipped
  // that way — Gold (10) and Platinum (15) against a maximum of 8 lots, worth
  // 7,500 cash and 25 shards nobody could ever collect.
  it('every top tier is actually attainable', () => {
    const ceilings: Record<string, number> = {
      stages_first_cleared: STAGES.size,
      lots_built: BASE_LOT_SLOTS_FALLBACK + LOT_SLOT_THRESHOLDS.length,
    };
    for (const track of ACHIEVEMENTS) {
      const ceiling = ceilings[track.id];
      if (ceiling === undefined) continue;
      expect(track.tiers[3], `${track.id} Platinum (${track.tiers[3]}) exceeds its ceiling ${ceiling}`)
        .toBeLessThanOrEqual(ceiling);
    }
  });
});
