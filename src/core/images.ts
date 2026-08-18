import { AttachmentBuilder, type EmbedBuilder } from 'discord.js';
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
export function assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos', name: string): ImageRef | null {
  const fileName = `${name}.webp`;
  const abs = resolve(process.cwd(), 'assets/images', kind, fileName);
  if (!present(abs)) return null;
  return { file: new AttachmentBuilder(abs, { name: fileName }), url: `attachment://${fileName}` };
}

// Species art is an OPTIONAL override: a committed assets/images/dinos/<speciesId>.webp
// wins, and a species with no file of its own falls back to its archetype×diet art. That
// fallback is what keeps adding a species a data-only change — no SpeciesDef field, no
// species-file edit, no migration. `present()` above caches existsSync per absolute path,
// so the extra lookup costs one Map hit after the first call.
//
// Every dino-art call site goes through this, never a bare assetImage('dinos', …).
// Note for tests: the two assetImage calls below are MODULE-INTERNAL, so mocking
// assetImage cannot intercept them — a test that needs a dino-art miss must mock
// dinoImage itself.
export function dinoImage(speciesId: string, archetype: string, diet: string): ImageRef | null {
  return assetImage('dinos', speciesId) ?? assetImage('dinos', `${archetype}-${diet}`);
}

// Sets an embed slot AND attaches the file, in one statement a caller cannot
// half-do. Round 2 shipped three attachment defects, each one a call site where
// "set the slot" and "attach the file" had drifted apart; behind this they
// cannot drift. A null ref (missing asset) is a total no-op — `files` is not
// even created, so an art-free payload never ships an empty attachment array.
// Appends rather than assigns: a second assignment would drop the first file
// and leave a dangling attachment:// URL in the embed.
export function attach(
  embed: EmbedBuilder,
  payload: { files?: AttachmentBuilder[] },
  slot: 'image' | 'thumbnail',
  ref: ImageRef | null,
): void {
  if (!ref) return;
  if (slot === 'image') embed.setImage(ref.url);
  else embed.setThumbnail(ref.url);
  (payload.files ??= []).push(ref.file);
}
