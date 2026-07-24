import { describe, it, expect } from 'vitest';
import { RARITY } from '../src/data/rarity.js';
import { getSpecies, allSpecies } from '../src/data/species/index.js';
import { FACILITIES } from '../src/data/facilities.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { FOODS, foodsForDiet, getFood, STARTER_FOOD } from '../src/data/foods.js';

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

describe('food catalog', () => {
  it('has 3 tiers per diet with monotonically increasing cost and fill', () => {
    for (const diet of ['herbivore', 'carnivore'] as const) {
      const foods = foodsForDiet(diet);
      expect(foods).toHaveLength(3);
      expect(foods.map((f) => f.tier)).toEqual([1, 2, 3]);
      for (let i = 1; i < foods.length; i++) {
        expect(foods[i].unitCost).toBeGreaterThan(foods[i - 1].unitCost);
        expect(foods[i].fillTo).toBeGreaterThan(foods[i - 1].fillTo);
      }
    }
  });
  it('prices carnivore food at exactly +20% over the same herbivore tier', () => {
    const herb = foodsForDiet('herbivore');
    const carn = foodsForDiet('carnivore');
    for (let t = 0; t < 3; t++) {
      expect(carn[t].unitCost).toBe(herb[t].unitCost * 1.2);
      expect(carn[t].fillTo).toBe(herb[t].fillTo);
    }
  });
  it('matches the spec table exactly', () => {
    expect(FOODS.ferns).toMatchObject({ diet: 'herbivore', tier: 1, unitCost: 10, fillTo: 100 });
    expect(FOODS.fruit_basket).toMatchObject({ diet: 'herbivore', tier: 2, unitCost: 15, fillTo: 125 });
    expect(FOODS.royal_greens).toMatchObject({ diet: 'herbivore', tier: 3, unitCost: 20, fillTo: 150 });
    expect(FOODS.fish).toMatchObject({ diet: 'carnivore', tier: 1, unitCost: 12, fillTo: 100 });
    expect(FOODS.goat).toMatchObject({ diet: 'carnivore', tier: 2, unitCost: 18, fillTo: 125 });
    expect(FOODS.prime_steak).toMatchObject({ diet: 'carnivore', tier: 3, unitCost: 24, fillTo: 150 });
  });
  it('getFood throws on unknown id', () => {
    expect(() => getFood('pizza')).toThrow(/Unknown food/);
  });
  it('starter pantry covers both diets with tier-1 food', () => {
    expect(STARTER_FOOD).toEqual({ ferns: 10, fish: 10 });
  });
});
