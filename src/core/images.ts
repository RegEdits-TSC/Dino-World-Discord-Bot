import { AttachmentBuilder } from 'discord.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ImageRef { file: AttachmentBuilder; url: string }

// Existence is checked once per path and cached — assets don't change at runtime.
const cache = new Map<string, boolean>();

function present(abs: string): boolean {
  let hit = cache.get(abs);
  if (hit === undefined) { hit = existsSync(abs); cache.set(abs, hit); }
  return hit;
}

// Missing asset = null; callers render the embed without the image. The bot
// must work with zero, some, or all assets present. `name` values come from
// internal enums (rarities, site ids) — never user input.
export function assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles', name: string): ImageRef | null {
  const fileName = `${name}.png`;
  const abs = resolve(process.cwd(), 'assets/images', kind, fileName);
  if (!present(abs)) return null;
  return { file: new AttachmentBuilder(abs, { name: fileName }), url: `attachment://${fileName}` };
}
