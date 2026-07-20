import type { PaddockDef } from './types.js';
export const PADDOCKS: Record<string, PaddockDef> = {
  herbivore_paddock: { kind: 'herbivore_paddock', name: 'Herbivore Paddock', diet: 'herbivore', buildCost: 2_000 },
  carnivore_paddock: { kind: 'carnivore_paddock', name: 'Carnivore Paddock', diet: 'carnivore', buildCost: 2_000 },
};
