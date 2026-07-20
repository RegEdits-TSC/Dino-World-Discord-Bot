export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type Diet = 'herbivore' | 'carnivore';
export interface Species {
  id: string; name: string; rarity: Rarity; diet: Diet;
  biomeTags: string[]; flavor: string; spriteRef: string;
}
export interface RarityStats {
  incomePerHr: number; sellShards: [number, number]; incubationMs: number; feedCost: number;
}
export interface FacilityDef {
  kind: string; name: string; maxLevel: number;
  incomeBonusPct: number[];        // index = level-1
  capHours?: number[];             // Visitor Center only
  incubatorSlots?: number[];       // Hatchery Lab only
  buildCost: number; upgradeCosts: number[];  // cost to reach level 2..maxLevel
}
export interface PaddockDef { kind: string; name: string; diet: Diet; buildCost: number }
