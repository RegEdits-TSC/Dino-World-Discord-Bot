import type { Client } from 'discord.js';
import { logger } from './logger.js';

// Unicode fallbacks for every application emoji. Rarity gems fall back to '',
// since rarity is always also conveyed by text right next to them.
export const EMOJI_FALLBACK: Record<string, string> = {
  dw_cash: '💰', dw_food: '🍖', dw_shard: '💎',
  dw_rarity_common: '', dw_rarity_uncommon: '', dw_rarity_rare: '',
  dw_rarity_epic: '', dw_rarity_legendary: '', dw_rarity_mythic: '',
  dw_star: '⭐', dw_alert: '🚨', dw_hunger: '⚠',
  dw_site_volcano_core: '🌋', dw_site_coastal_dig: '🐚',
  dw_site_amber_ridge: '🟠', dw_site_frozen_cliffs: '❄️',
  dw_lot_carnivore: '🦖', dw_lot_herbivore: '🦕', dw_lot_food_court: '🍔',
  dw_lot_hatchery: '🥚', dw_lot_visitor: '🏛️',
};

let tags = new Map<string, string>();

export function setEmojiMap(entries: Record<string, string>): void { tags = new Map(Object.entries(entries)); }
export function clearEmojiMap(): void { tags = new Map(); }

// Never call at module top level — the map loads after client ready.
export function emojiTag(name: string): string {
  return tags.get(name) ?? EMOJI_FALLBACK[name] ?? '';
}

// Gem prefix for rarity text: '<:dw_rarity_rare:id> ' or '' when absent, so
// call sites can write `${rarityEmoji(r)}${r} egg` and degrade cleanly.
export function rarityEmoji(rarity: string): string {
  const t = emojiTag(`dw_rarity_${rarity}`);
  return t ? `${t} ` : '';
}

export async function loadAppEmojis(client: Client): Promise<void> {
  try {
    const emojis = await client.application!.emojis.fetch();
    const entries: Record<string, string> = {};
    for (const e of emojis.values()) if (e.name) entries[e.name] = e.toString();
    setEmojiMap(entries);
    logger.info(`Loaded ${Object.keys(entries).length} application emojis`);
  } catch (e) {
    logger.warn({ err: e }, 'app emoji fetch failed — using unicode fallbacks');
  }
}
