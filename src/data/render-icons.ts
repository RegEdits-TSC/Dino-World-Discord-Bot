import type { Rarity } from './types.js';

export interface TilePalette { fill: string; border: string; text: string }

export const PADDOCK_PALETTE: TilePalette = { fill: '#c8b273', border: '#e8d9a0', text: '#3a2f16' };
export const FACILITY_PALETTE: TilePalette = { fill: '#7fa8c9', border: '#a9cbe6', text: '#12303f' };

export function tilePalette(type: 'paddock' | 'facility'): TilePalette {
  return type === 'facility' ? FACILITY_PALETTE : PADDOCK_PALETTE;
}

const LOT_ICON: Record<string, string> = {
  carnivore_paddock: '🦖',
  herbivore_paddock: '🦕',
  food_court: '🍔',
  hatchery_lab: '🥚',
  visitor_center: '🏛️',
  gene_lab: '🧬',
};

// Known kinds get a specific icon; anything else falls back by lot type.
export function lotIcon(type: 'paddock' | 'facility', kind: string): string {
  return LOT_ICON[kind] ?? (type === 'facility' ? '🏢' : '🌿');
}

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9aa0a6', uncommon: '#57b85a', rare: '#4a90d9',
  epic: '#9b59d0', legendary: '#e0982a', mythic: '#d14ad9',
};

// A bit of visual variety: apex rarities get the T-Rex glyph.
export function dinoGlyph(rarity: Rarity): string {
  return rarity === 'legendary' || rarity === 'mythic' ? '🦖' : '🦕';
}
