import { describe, it, expect } from 'vitest';
import { lotIcon, tilePalette, dinoGlyph, RARITY_COLOR } from '../src/data/render-icons.js';

describe('render-icons', () => {
  it('maps known lot kinds and falls back by type', () => {
    expect(lotIcon('facility', 'hatchery_lab')).toBe('🥚');
    expect(lotIcon('paddock', 'carnivore_paddock')).toBe('🦖');
    expect(lotIcon('facility', 'unknown_kind')).toBe('🏢');   // fallback
    expect(lotIcon('paddock', 'unknown_kind')).toBe('🌿');    // fallback
  });
  it('has a distinct palette per lot type', () => {
    expect(tilePalette('paddock')).not.toEqual(tilePalette('facility'));
  });
  it('has a color for every rarity', () => {
    for (const r of ['common','uncommon','rare','epic','legendary','mythic'] as const)
      expect(RARITY_COLOR[r]).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('uses the apex glyph for legendary/mythic', () => {
    expect(dinoGlyph('mythic')).toBe('🦖');
    expect(dinoGlyph('common')).toBe('🦕');
  });
});
