import { AttachmentBuilder, type EmbedBuilder } from 'discord.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashSeed, mulberry32 } from './rolls.js';

export interface ImageRef { file: AttachmentBuilder; url: string }

// Existence is checked once per path and cached — assets don't change at runtime.
const cache = new Map<string, boolean>();

function present(abs: string): boolean {
  let hit = cache.get(abs);
  if (hit === undefined) { hit = existsSync(abs); cache.set(abs, hit); }
  return hit;
}

// How many `<name>-vN.webp` siblings a base has. Counted from -v2 upward and
// stopped at the first gap, which is exactly the invariant
// tests/asset-variants.test.ts enforces: numbering starts at 2 and never skips.
// Cached per kind/name like present() caches existsSync — assets do not change
// at runtime.
const variantCounts = new Map<string, number>();

function variantCount(kind: string, name: string): number {
  const key = `${kind}/${name}`;
  let n = variantCounts.get(key);
  if (n === undefined) {
    n = 0;
    while (present(resolve(process.cwd(), 'assets/images', kind, `${name}-v${n + 2}.webp`))) n++;
    variantCounts.set(key, n);
  }
  return n;
}

// Picks which face of `name` a seed resolves to. Index 0 is the base file, so a
// base with no variants always returns itself and the seeded path agrees with the
// unseeded one wherever no variant exists.
//
// The hashed string is COMPOSITE — `kind:name:seed` — and that is load-bearing,
// not stylistic. eggs and hatch each ship one variant set per rarity, with equal
// counts, so hashing a bare egg id would select the same index in both: egg #42
// would show common-v2 and then common-crack-v2, collapsing two independent picks
// into one for a consistency nobody can perceive. No count here on purpose: the
// equal-counts fact is what the argument needs, and a number goes stale silently
// the first time a -v5 ships. Same reasoning as WORLD_SALT (src/core/world.ts)
// and DEAL_SALT (src/modules/shop/service.ts), which exist to stop two features
// keying off one input from moving together.
//
// The hash goes through mulberry32 rather than `% (count + 1)`. No code in src/
// takes FNV-1a output modulo anything — its low bits carry less avalanche than a
// PRNG's, and every selection in this repo (pickBoard, rollSpeciesInRarity,
// dailyDeal) runs mulberry32 first.
//
// This is a deliberate carve-out from the ctx.now()/ctx.rng() rule everywhere
// else in the codebase: variant selection is a pure function of (kind, name,
// seed), never a clock or ctx.rng(), so the same triple always renders the same
// face — including for a Discord edit that re-renders an already-sent message.
function pickVariant(kind: string, name: string, seed: string): string {
  const count = variantCount(kind, name);
  if (count === 0) return name;
  const index = Math.floor(mulberry32(hashSeed(`${kind}:${name}:${seed}`))() * (count + 1));
  return index === 0 ? name : `${name}-v${index + 1}`;
}

// Missing asset = null; callers render the embed without the image. The bot
// must work with zero, some, or all assets present. `name` values come from
// internal enums (rarities, site ids) — never user input.
//
// `seed` is any string already in scope at the call site — an egg's row id, a
// viewer's Discord id. OMITTING IT RETURNS THE BASE FILE, and that default is a
// compatibility contract rather than a convenience: every call site that never
// gains a seed relies on it, as does every filename pin in the suite written
// against a base name. Deliberately no count here — a figure written into prose
// is wrong the next time a pin lands, and wrong silently. Derive it if you
// actually need it: `grep -rho '[A-Za-z0-9_-]*\.webp' tests/`.
export function assetImage(
  kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos',
  name: string,
  seed?: string,
): ImageRef | null {
  const fileName = `${seed === undefined ? name : pickVariant(kind, name, seed)}.webp`;
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
