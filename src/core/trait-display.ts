import { traitDefs } from '../data/traits.js';
import { emojiTag } from './emojis.js';

/**
 * Multi-line trait block for an embed field. The emoji is resolved HERE, at
 * render time — never in a module-level constant, since the emoji map loads
 * after client ready and a constant would freeze the unicode fallback forever.
 */
export function traitLines(traits: string[]): string {
  const defs = traitDefs(traits);
  if (!defs.length) return '_No traits_';
  return defs.map((t) => `${emojiTag(t.emoji) || t.fallback} **${t.name}** — ${t.blurb}`).join('\n');
}
