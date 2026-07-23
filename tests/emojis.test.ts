import { describe, it, expect, afterEach } from 'vitest';
import { emojiTag, rarityEmoji, setEmojiMap, clearEmojiMap, EMOJI_FALLBACK } from '../src/core/emojis.js';

afterEach(() => clearEmojiMap());

describe('emojiTag', () => {
  it('falls back to unicode when no map is loaded', () => {
    expect(emojiTag('dw_cash')).toBe('💰');
    expect(emojiTag('dw_food')).toBe('🍖');
    expect(emojiTag('dw_shard')).toBe('💎');
    expect(emojiTag('dw_star')).toBe('⭐');
    expect(emojiTag('dw_alert')).toBe('🚨');
  });
  it('rarity gems fall back to the empty string', () => {
    expect(emojiTag('dw_rarity_common')).toBe('');
    expect(emojiTag('dw_rarity_mythic')).toBe('');
  });
  it('returns the custom tag once the map is set, unmapped names still fall back', () => {
    setEmojiMap({ dw_cash: '<:dw_cash:123>' });
    expect(emojiTag('dw_cash')).toBe('<:dw_cash:123>');
    expect(emojiTag('dw_food')).toBe('🍖');
  });
  it('unknown names return the empty string', () => {
    expect(emojiTag('dw_no_such')).toBe('');
  });
  it('fallback table covers exactly the 21 spec names', () => {
    expect(Object.keys(EMOJI_FALLBACK).sort()).toEqual([
      'dw_alert', 'dw_cash', 'dw_food', 'dw_hunger',
      'dw_lot_carnivore', 'dw_lot_food_court', 'dw_lot_hatchery', 'dw_lot_herbivore', 'dw_lot_visitor',
      'dw_rarity_common', 'dw_rarity_epic', 'dw_rarity_legendary', 'dw_rarity_mythic', 'dw_rarity_rare', 'dw_rarity_uncommon',
      'dw_shard', 'dw_site_amber_ridge', 'dw_site_coastal_dig', 'dw_site_frozen_cliffs', 'dw_site_volcano_core',
      'dw_star',
    ]);
  });
});

describe('rarityEmoji', () => {
  it('is empty without a map (strings unchanged in tests)', () => {
    expect(rarityEmoji('rare')).toBe('');
  });
  it('adds a trailing space with a map', () => {
    setEmojiMap({ dw_rarity_rare: '<:dw_rarity_rare:9>' });
    expect(rarityEmoji('rare')).toBe('<:dw_rarity_rare:9> ');
  });
});
