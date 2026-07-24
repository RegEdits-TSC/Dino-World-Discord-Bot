import type { Diet } from './types.js';

export type FoodId = 'ferns' | 'fruit_basket' | 'royal_greens' | 'fish' | 'goat' | 'prime_steak';

export interface FoodDef {
  id: FoodId; name: string; diet: Diet; tier: 1 | 2 | 3;
  unitCost: number; fillTo: number; emoji: string; fallback: string;
}

export const FOODS: Record<FoodId, FoodDef> = {
  ferns:        { id: 'ferns',        name: 'Ferns',        diet: 'herbivore', tier: 1, unitCost: 10, fillTo: 100, emoji: 'dw_ferns',        fallback: '🌿' },
  fruit_basket: { id: 'fruit_basket', name: 'Fruit Basket', diet: 'herbivore', tier: 2, unitCost: 15, fillTo: 125, emoji: 'dw_fruit_basket', fallback: '🍎' },
  royal_greens: { id: 'royal_greens', name: 'Royal Greens', diet: 'herbivore', tier: 3, unitCost: 20, fillTo: 150, emoji: 'dw_royal_greens', fallback: '🥬' },
  fish:         { id: 'fish',         name: 'Fish',         diet: 'carnivore', tier: 1, unitCost: 12, fillTo: 100, emoji: 'dw_fish',         fallback: '🐟' },
  goat:         { id: 'goat',         name: 'Goat',         diet: 'carnivore', tier: 2, unitCost: 18, fillTo: 125, emoji: 'dw_goat',         fallback: '🍖' },
  prime_steak:  { id: 'prime_steak',  name: 'Prime Steak',  diet: 'carnivore', tier: 3, unitCost: 24, fillTo: 150, emoji: 'dw_prime_steak', fallback: '🥩' },
};

export function foodsForDiet(diet: Diet): FoodDef[] {
  return Object.values(FOODS).filter((f) => f.diet === diet).sort((a, b) => a.tier - b.tier);
}

export function getFood(id: string): FoodDef {
  const f = (FOODS as Record<string, FoodDef | undefined>)[id];
  if (!f) throw new Error(`Unknown food: ${id}`);
  return f;
}

// New-player pantry, seeded by getOrCreateUser and restored by adminReset.
export const STARTER_FOOD: Partial<Record<FoodId, number>> = { ferns: 10, fish: 10 };
