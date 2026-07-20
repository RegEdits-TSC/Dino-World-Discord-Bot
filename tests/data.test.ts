import { describe, it, expect } from 'vitest';
import { RARITY } from '../src/data/rarity.js';
import { getSpecies, allSpecies } from '../src/data/species/index.js';
import { FACILITIES } from '../src/data/facilities.js';
import { PADDOCKS } from '../src/data/paddocks.js';

describe('game data', () => {
  it('every species has a valid rarity entry', () => {
    for (const s of allSpecies()) expect(RARITY[s.rarity]).toBeDefined();
  });
  it('getSpecies throws on unknown id', () => {
    expect(() => getSpecies('barney')).toThrow(/Unknown species/);
  });
  it('facility arrays match maxLevel', () => {
    for (const f of Object.values(FACILITIES)) {
      expect(f.incomeBonusPct).toHaveLength(f.maxLevel);
      expect(f.upgradeCosts).toHaveLength(f.maxLevel - 1);
    }
  });
  it('RARITY values match the spec economy table', () => {
    const H = 3_600_000, M = 60_000;
    expect(RARITY).toEqual({
      common:    { incomePerHr: 60,   sellShards: [1, 3],   incubationMs: 15 * M, feedCost: 5 },
      uncommon:  { incomePerHr: 150,  sellShards: [3, 6],   incubationMs: 1 * H,  feedCost: 10 },
      rare:      { incomePerHr: 400,  sellShards: [8, 15],  incubationMs: 4 * H,  feedCost: 20 },
      epic:      { incomePerHr: 1100, sellShards: [20, 35], incubationMs: 12 * H, feedCost: 40 },
      legendary: { incomePerHr: 3000, sellShards: [50, 80], incubationMs: 24 * H, feedCost: 80 },
      mythic:    { incomePerHr: 9000, sellShards: [0, 0],   incubationMs: 48 * H, feedCost: 160 },
    });
  });
  it('FACILITIES values match the spec', () => {
    expect(FACILITIES.visitor_center.capHours).toEqual([8, 12, 16, 20, 24]);
    expect(FACILITIES.visitor_center.incomeBonusPct).toEqual([0, 5, 10, 15, 20]);
    expect(FACILITIES.visitor_center.buildCost).toBe(5000);
    expect(FACILITIES.visitor_center.upgradeCosts).toEqual([12_500, 31_000, 78_000, 500_000]);
    expect(FACILITIES.hatchery_lab.incubatorSlots).toEqual([1, 2, 3]);
    expect(FACILITIES.food_court.incomeBonusPct).toEqual([4, 8, 12]);
  });
  it('PADDOCKS values match the spec', () => {
    expect(PADDOCKS.herbivore_paddock).toBeDefined();
    expect(PADDOCKS.herbivore_paddock.diet).toBe('herbivore');
    expect(PADDOCKS.herbivore_paddock.buildCost).toBe(2000);
    expect(PADDOCKS.carnivore_paddock).toBeDefined();
    expect(PADDOCKS.carnivore_paddock.diet).toBe('carnivore');
    expect(PADDOCKS.carnivore_paddock.buildCost).toBe(2000);
  });
});
