import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Client } from 'discord.js';
import { emojiTag, rarityEmoji, setEmojiMap, clearEmojiMap, EMOJI_FALLBACK, loadAppEmojis } from '../src/core/emojis.js';
import { logger } from '../src/core/logger.js';
import { foodEmoji } from '../src/core/emojis.js';
import { installTestEmojiMap } from './harness.js';

afterEach(() => {
  clearEmojiMap();
  vi.restoreAllMocks();
});

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
  it('does not resolve through the Object.prototype chain', () => {
    expect(emojiTag('constructor')).toBe('');
    expect(emojiTag('toString')).toBe('');
  });
  it('fallback table covers exactly the 43 spec names', () => {
    expect(Object.keys(EMOJI_FALLBACK).sort()).toEqual([
      'dw_alert', 'dw_cash', 'dw_chest',
      'dw_dino_common', 'dw_dino_epic', 'dw_dino_legendary', 'dw_dino_mythic', 'dw_dino_rare', 'dw_dino_uncommon',
      'dw_ferns', 'dw_fish', 'dw_food', 'dw_fruit_basket', 'dw_goat', 'dw_hunger',
      'dw_lot_carnivore', 'dw_lot_food_court', 'dw_lot_genelab', 'dw_lot_hatchery', 'dw_lot_herbivore', 'dw_lot_visitor',
      'dw_prime_steak', 'dw_quest',
      'dw_rarity_common', 'dw_rarity_epic', 'dw_rarity_legendary', 'dw_rarity_mythic', 'dw_rarity_rare', 'dw_rarity_uncommon',
      'dw_royal_greens', 'dw_shard', 'dw_site_abyssal_trench', 'dw_site_amber_ridge', 'dw_site_coastal_dig',
      'dw_site_containment_site', 'dw_site_frozen_cliffs', 'dw_site_volcano_core',
      'dw_star', 'dw_streak',
      'dw_trait_care', 'dw_trait_combat', 'dw_trait_income', 'dw_trait_meta',
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

// A hand-built fake satisfies the shape loadAppEmojis reads from the client:
// application.emojis.fetch() resolving to something iterable via .values()
// whose entries carry `name` and `toString()`.
function fakeClient(fetch: () => Promise<Map<string, { name: string | null; toString(): string }>>): Client {
  return { application: { emojis: { fetch } } } as unknown as Client;
}

describe('loadAppEmojis', () => {
  it('populates the map from a fetched emoji collection, so emojiTag returns custom tags afterward', async () => {
    const fetched = new Map([
      ['1', { name: 'dw_cash', toString: () => '<:dw_cash:1>' }],
      ['2', { name: 'dw_food', toString: () => '<:dw_food:2>' }],
    ]);
    const client = fakeClient(() => Promise.resolve(fetched));

    await loadAppEmojis(client);

    expect(emojiTag('dw_cash')).toBe('<:dw_cash:1>');
    expect(emojiTag('dw_food')).toBe('<:dw_food:2>');
  });

  it('skips entries with a null name rather than creating a bogus key', async () => {
    const fetched = new Map([
      ['1', { name: 'dw_cash', toString: () => '<:dw_cash:1>' }],
      ['2', { name: null, toString: () => '<:unnamed:2>' }],
    ]);
    const client = fakeClient(() => Promise.resolve(fetched));

    await loadAppEmojis(client);

    expect(emojiTag('dw_cash')).toBe('<:dw_cash:1>');
    // the null-named entry must not have coerced into a "null" key
    expect(emojiTag('null')).toBe('');
  });

  it('resolves (never rejects) and leaves the map untouched when fetch fails, warning instead', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const client = fakeClient(() => Promise.reject(new Error('network down')));

    await expect(loadAppEmojis(client)).resolves.toBeUndefined();

    expect(emojiTag('dw_cash')).toBe('💰');
    expect(emojiTag('dw_food')).toBe('🍖');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('foodEmoji', () => {
  it('prefixes the unicode fallback with a trailing space when no map is loaded', () => {
    expect(foodEmoji('ferns')).toBe('🌿 ');
    expect(foodEmoji('prime_steak')).toBe('🥩 ');
  });
});

describe('custom-tag arm under a loaded map', () => {
  it('foodEmoji uses the custom tag when the map is loaded, fallback otherwise', () => {
    const restore = installTestEmojiMap();
    try {
      expect(foodEmoji('ferns')).toMatch(/^<:dw_ferns:\d+> $/);
    } finally { restore(); }
    expect(foodEmoji('ferns')).toBe('🌿 ');
  });
});
