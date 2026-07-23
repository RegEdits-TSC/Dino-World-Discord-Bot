# Emoji & Currency Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unicode placeholder glyphs with 21 bot-owned custom Discord application emojis (SVG-authored), add 5 painterly embed banners, and swap the park-map HUD 💰 glyph for a PNG icon.

**Architecture:** SVG sources in `assets/emojis/svg/` are rasterized to committed 128×128 PNGs by a build script (`@napi-rs/canvas`, existing dep). A deploy script syncs PNGs to Discord application emojis by name using a committed sha256 manifest. At runtime, `core/emojis.ts` fetches the app-emoji map on client ready and `emojiTag(name)` returns the custom tag or a unicode fallback — missing emoji is never an error (same null-degrade philosophy as `assetImage`). Banners extend `assetImage` with a `'banners'` kind.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js 14, @napi-rs/canvas, vitest, tsx scripts.

Spec: `docs/superpowers/specs/2026-07-23-emoji-currency-assets-design.md`

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()`/`Math.random()` in module code (scripts like `deploy-commands.ts` may use console/process directly).
- DB access is synchronous drizzle (`.get()`/`.all()`/`.run()`), never awaited.
- **Autocomplete labels must not change.** They are asserted verbatim in tests, and Discord cannot render custom emojis in autocomplete — labels keep their current unicode. Any function feeding autocomplete (e.g. trading `summarize`) must keep producing unicode on that path.
- **Never call `emojiTag()` in a module-level constant.** The emoji map loads after client ready; a module-init call freezes the unicode fallback forever. Compute labels inside functions.
- Emoji names use the `dw_` prefix, exactly as listed in the spec (21 names).
- All new SVGs: `viewBox="0 0 64 64"`, `xmlns="http://www.w3.org/2000/svg"`, glossy style (vertical gradient fill, dark outline stroke-width 3, white sheen ellipse opacity ~0.35).
- Commits: plain imperative messages, no attribution trailers of any kind.
- Test suite must stay green after every task (`npm test`), typecheck too (`npm run typecheck`).
- Registering no new modules/commands — the 5-site module checklist and `deploy-commands` are untouched.

---

### Task 1: `core/emojis.ts` runtime helper + startup wiring

**Files:**
- Create: `src/core/emojis.ts`
- Modify: `src/index.ts` (ClientReady handler, ~line 45)
- Test: `tests/emojis.test.ts`

**Interfaces:**
- Consumes: `logger` from `src/core/logger.js`; discord.js `Client` (type only).
- Produces (later tasks rely on these exact exports):
  - `EMOJI_FALLBACK: Record<string, string>` — all 21 names → unicode fallback ('' for the 6 rarity gems)
  - `emojiTag(name: string): string` — custom tag `<:name:id>` if loaded, else `EMOJI_FALLBACK[name] ?? ''`
  - `rarityEmoji(rarity: string): string` — `emojiTag('dw_rarity_'+rarity)` plus a trailing space when non-empty, else `''` (so call sites can write `` `${rarityEmoji(r)}${r} egg` `` and tests without a map see unchanged strings)
  - `setEmojiMap(entries: Record<string, string>): void`, `clearEmojiMap(): void` — test/loader injection
  - `loadAppEmojis(client: Client): Promise<void>` — fetch + populate, warn-and-degrade on failure

- [ ] **Step 1: Write the failing test**

Create `tests/emojis.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emojis.test.ts`
Expected: FAIL — `Cannot find module '../src/core/emojis.js'`

- [ ] **Step 3: Write the implementation**

Create `src/core/emojis.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/emojis.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire into startup**

In `src/index.ts`, add to imports:

```ts
import { loadAppEmojis } from './core/emojis.js';
```

Change the ClientReady handler (currently):

```ts
client.once(Events.ClientReady, (c) => {
  logger.info(`Logged in as ${c.user.tag}`);
  scheduler.tick(Date.now()).catch((e) => logger.error({ err: e }, 'scheduler boot scan failed'));
});
```

to:

```ts
client.once(Events.ClientReady, (c) => {
  logger.info(`Logged in as ${c.user.tag}`);
  void loadAppEmojis(client);
  scheduler.tick(Date.now()).catch((e) => logger.error({ err: e }, 'scheduler boot scan failed'));
});
```

(`loadAppEmojis` catches internally; the brief pre-fetch window serves unicode fallbacks — accepted by spec.)

- [ ] **Step 6: Full check and commit**

Run: `npm test && npm run typecheck`
Expected: all green (existing suite + new file)

```bash
git add src/core/emojis.ts src/index.ts tests/emojis.test.ts
git commit -m "Add application emoji runtime with unicode fallback"
```

---

### Task 2: SVG render helper + build script + currency SVGs

**Files:**
- Create: `src/core/render-svg.ts`, `src/build-emojis.ts`
- Create: `assets/emojis/svg/dw_cash.svg`, `assets/emojis/svg/dw_food.svg`, `assets/emojis/svg/dw_shard.svg`
- Modify: `package.json` (scripts)
- Test: `tests/emoji-assets.test.ts`

**Interfaces:**
- Consumes: `@napi-rs/canvas` (`createCanvas`, `Image` — `Image.src = <svg Buffer>` decodes SVG synchronously via built-in resvg).
- Produces:
  - `renderSvg(svg: Buffer, size: number): Buffer` from `src/core/render-svg.js` (PNG buffer, size×size, transparent background)
  - `npm run build-emojis` — renders every `assets/emojis/svg/*.svg` → `assets/emojis/png/<name>.png` at 128×128 (plus, from Task 5 on, the HUD icon)
  - Committed PNGs in `assets/emojis/png/`

- [ ] **Step 1: Write the failing test**

Create `tests/emoji-assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, Image } from '@napi-rs/canvas';
import { renderSvg } from '../src/core/render-svg.js';

const SVG_DIR = resolve(process.cwd(), 'assets/emojis/svg');
const PNG_DIR = resolve(process.cwd(), 'assets/emojis/png');

function decode(png: Buffer): Image { const i = new Image(); i.src = png; return i; }

describe('renderSvg', () => {
  it('renders an SVG buffer to a PNG of the requested size', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="#f00"/></svg>');
    const img = decode(renderSvg(svg, 128));
    expect(img.width).toBe(128);
    expect(img.height).toBe(128);
  });
});

describe('emoji assets', () => {
  const svgs = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg'));
  it('at least the currency trio exists', () => {
    expect(svgs).toEqual(expect.arrayContaining(['dw_cash.svg', 'dw_food.svg', 'dw_shard.svg']));
  });
  it.each(svgs)('%s has a 128×128 PNG sibling with transparent corners', (f) => {
    const png = readFileSync(resolve(PNG_DIR, f.replace('.svg', '.png')));
    const img = decode(png);
    expect(img.width).toBe(128);
    expect(img.height).toBe(128);
    const canvas = createCanvas(128, 128);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    expect(c.getImageData(0, 0, 1, 1).data[3]).toBe(0);       // top-left corner alpha
    expect(c.getImageData(127, 127, 1, 1).data[3]).toBe(0);   // bottom-right corner alpha
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emoji-assets.test.ts`
Expected: FAIL — `Cannot find module '../src/core/render-svg.js'`

- [ ] **Step 3: Write the render helper**

Create `src/core/render-svg.ts`:

```ts
import { createCanvas, Image } from '@napi-rs/canvas';

// SVG → transparent PNG at size×size. @napi-rs/canvas decodes SVG buffers
// synchronously via its bundled resvg.
export function renderSvg(svg: Buffer, size: number): Buffer {
  const img = new Image();
  img.src = svg;
  const canvas = createCanvas(size, size);
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0, size, size);
  return canvas.toBuffer('image/png');
}
```

- [ ] **Step 4: Write the three currency SVGs**

Create `assets/emojis/svg/dw_cash.svg` (gold coin, footprint imprint):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffdf7e"/><stop offset="1" stop-color="#d99b2b"/></linearGradient></defs>
  <circle cx="32" cy="32" r="27" fill="url(#g)" stroke="#7a5a10" stroke-width="3"/>
  <ellipse cx="30" cy="35" rx="6" ry="8" fill="#7a5a10"/>
  <ellipse cx="24" cy="24" rx="3" ry="4" fill="#7a5a10" transform="rotate(-20 24 24)"/>
  <ellipse cx="32" cy="21" rx="3" ry="4" fill="#7a5a10"/>
  <ellipse cx="40" cy="24" rx="3" ry="4" fill="#7a5a10" transform="rotate(20 40 24)"/>
  <ellipse cx="23" cy="17" rx="11" ry="5" fill="#ffffff" opacity="0.35" transform="rotate(-18 23 17)"/>
</svg>
```

Create `assets/emojis/svg/dw_food.svg` (meat-on-bone):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8705c"/><stop offset="1" stop-color="#a83226"/></linearGradient></defs>
  <rect x="36" y="37" width="18" height="6" rx="3" fill="#f5f0e6" stroke="#b8ad98" stroke-width="2" transform="rotate(35 45 40)"/>
  <circle cx="53" cy="39" r="5" fill="#f5f0e6" stroke="#b8ad98" stroke-width="2"/>
  <circle cx="46" cy="52" r="5" fill="#f5f0e6" stroke="#b8ad98" stroke-width="2"/>
  <ellipse cx="27" cy="30" rx="18" ry="14" fill="url(#g)" stroke="#5e1a12" stroke-width="3" transform="rotate(-25 27 30)"/>
  <ellipse cx="23" cy="26" rx="8" ry="5" fill="#f2a08e" opacity="0.7" transform="rotate(-25 23 26)"/>
  <ellipse cx="18" cy="18" rx="8" ry="4" fill="#ffffff" opacity="0.35" transform="rotate(-25 18 18)"/>
</svg>
```

Create `assets/emojis/svg/dw_shard.svg` (cyan DNA-helix crystal):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7de8e0"/><stop offset="1" stop-color="#1f8a99"/></linearGradient></defs>
  <polygon points="32,4 48,18 44,52 20,52 16,18" fill="url(#g)" stroke="#0f5560" stroke-width="3"/>
  <path d="M26 16 Q38 22 26 28 Q38 34 26 40 Q38 46 26 50" fill="none" stroke="#e8fdfc" stroke-width="2.5" opacity="0.9"/>
  <path d="M38 16 Q26 22 38 28 Q26 34 38 40 Q26 46 38 50" fill="none" stroke="#e8fdfc" stroke-width="2.5" opacity="0.6"/>
  <ellipse cx="24" cy="12" rx="7" ry="3.5" fill="#ffffff" opacity="0.4" transform="rotate(-15 24 12)"/>
</svg>
```

- [ ] **Step 5: Write the build script**

Create `src/build-emojis.ts`:

```ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSvg } from './core/render-svg.js';

const SVG_DIR = resolve(process.cwd(), 'assets/emojis/svg');
const PNG_DIR = resolve(process.cwd(), 'assets/emojis/png');
const EMOJI_SIZE = 128;

mkdirSync(PNG_DIR, { recursive: true });
const files = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).sort();
for (const f of files) {
  const png = renderSvg(readFileSync(resolve(SVG_DIR, f)), EMOJI_SIZE);
  writeFileSync(resolve(PNG_DIR, f.replace('.svg', '.png')), png);
}
console.log(`Rendered ${files.length} emoji PNGs to assets/emojis/png/.`);
```

Add to `package.json` `"scripts"` (after `"deploy-commands"`):

```json
"build-emojis": "tsx src/build-emojis.ts",
```

- [ ] **Step 6: Run the build**

Run: `npm run build-emojis`
Expected: `Rendered 3 emoji PNGs to assets/emojis/png/.` and three PNGs on disk.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/emoji-assets.test.ts`
Expected: PASS (render test + trio presence + 3 sibling checks)

- [ ] **Step 8: Visual check + commit**

Open the three PNGs (`start assets\emojis\png\dw_cash.png` etc. or view in editor) — confirm crisp shapes, transparent background, no clipping at edges.

```bash
git add src/core/render-svg.ts src/build-emojis.ts package.json assets/emojis tests/emoji-assets.test.ts
git commit -m "Add SVG emoji build pipeline with currency trio"
```

---

### Task 3: Rarity gem SVGs (6)

**Files:**
- Create: `assets/emojis/svg/dw_rarity_common.svg` … `dw_rarity_mythic.svg` (6 files)
- Test: `tests/emoji-assets.test.ts` (existing `it.each` covers new files automatically)

**Interfaces:**
- Consumes: `npm run build-emojis` from Task 2.
- Produces: 6 gem PNGs whose fills match `RARITY_COLOR` in `src/data/render-icons.ts` (`#9aa0a6 #57b85a #4a90d9 #9b59d0 #e0982a #d14ad9`). Same diamond cut for all; epic+ escalate: sparkles → glow ring → double aura.

- [ ] **Step 1: Write the six SVGs**

All share the diamond `32,6 56,26 32,58 8,26` and facet `32,14 46,26 32,46 18,26`. Per-rarity gradient (light→dark around the base hex) and stroke:

Create `assets/emojis/svg/dw_rarity_common.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ced3"/><stop offset="1" stop-color="#7d838a"/></linearGradient></defs>
  <polygon points="32,6 56,26 32,58 8,26" fill="url(#g)" stroke="#41464c" stroke-width="3"/>
  <polygon points="32,14 46,26 32,46 18,26" fill="#ffffff" opacity="0.25"/>
</svg>
```

Create `assets/emojis/svg/dw_rarity_uncommon.svg` — same two polygons, gradient stops `#8fd992`/`#3d8f40`, stroke `#1e4a20`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd992"/><stop offset="1" stop-color="#3d8f40"/></linearGradient></defs>
  <polygon points="32,6 56,26 32,58 8,26" fill="url(#g)" stroke="#1e4a20" stroke-width="3"/>
  <polygon points="32,14 46,26 32,46 18,26" fill="#ffffff" opacity="0.25"/>
</svg>
```

Create `assets/emojis/svg/dw_rarity_rare.svg` — stops `#8ec4f0`/`#2b6cb0`, stroke `#173a5e`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec4f0"/><stop offset="1" stop-color="#2b6cb0"/></linearGradient></defs>
  <polygon points="32,6 56,26 32,58 8,26" fill="url(#g)" stroke="#173a5e" stroke-width="3"/>
  <polygon points="32,14 46,26 32,46 18,26" fill="#ffffff" opacity="0.25"/>
</svg>
```

Create `assets/emojis/svg/dw_rarity_epic.svg` — stops `#c393e8`/`#7238a8`, stroke `#3d1a5e`, gem inset to `32,8 54,26 32,56 10,26` to make room, plus two sparkles:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c393e8"/><stop offset="1" stop-color="#7238a8"/></linearGradient></defs>
  <polygon points="32,8 54,26 32,56 10,26" fill="url(#g)" stroke="#3d1a5e" stroke-width="3"/>
  <polygon points="32,15 45,26 32,44 19,26" fill="#ffffff" opacity="0.25"/>
  <polygon points="52,6 54,12 60,14 54,16 52,22 50,16 44,14 50,12" fill="#ffffff"/>
  <polygon points="10,44 11,48 15,49 11,50 10,54 9,50 5,49 9,48" fill="#ffffff" opacity="0.8"/>
</svg>
```

Create `assets/emojis/svg/dw_rarity_legendary.svg` — stops `#f5c46a`/`#b06f14`, stroke `#6b430a`, glow ring + sparkle:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5c46a"/><stop offset="1" stop-color="#b06f14"/></linearGradient></defs>
  <circle cx="32" cy="32" r="29" fill="none" stroke="#f5c46a" stroke-width="2.5" opacity="0.6"/>
  <polygon points="32,8 54,26 32,56 10,26" fill="url(#g)" stroke="#6b430a" stroke-width="3"/>
  <polygon points="32,15 45,26 32,44 19,26" fill="#ffffff" opacity="0.25"/>
  <polygon points="52,4 54,10 60,12 54,14 52,20 50,14 44,12 50,10" fill="#ffffff"/>
</svg>
```

Create `assets/emojis/svg/dw_rarity_mythic.svg` — stops `#eda2f2`/`#a127a8`, stroke `#5e1462`, double aura + two sparkles, gem inset further to `32,10 52,27 32,54 12,27`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eda2f2"/><stop offset="1" stop-color="#a127a8"/></linearGradient></defs>
  <circle cx="32" cy="32" r="29" fill="none" stroke="#eda2f2" stroke-width="2" opacity="0.7"/>
  <circle cx="32" cy="32" r="24" fill="none" stroke="#eda2f2" stroke-width="1.5" opacity="0.4"/>
  <polygon points="32,10 52,27 32,54 12,27" fill="url(#g)" stroke="#5e1462" stroke-width="3"/>
  <polygon points="32,16 44,27 32,43 20,27" fill="#ffffff" opacity="0.25"/>
  <polygon points="52,4 54,10 60,12 54,14 52,20 50,14 44,12 50,10" fill="#ffffff"/>
  <polygon points="10,42 11,46 15,47 11,48 10,52 9,50 5,47 9,46" fill="#ffffff" opacity="0.8"/>
</svg>
```

- [ ] **Step 2: Build and test**

Run: `npm run build-emojis && npx vitest run tests/emoji-assets.test.ts`
Expected: `Rendered 9 emoji PNGs…`, PASS (9 sibling checks).

- [ ] **Step 3: Visual check + commit**

View the six gem PNGs — verify color progression matches the roster palette and the flair escalation reads at small size (zoom out to ~20%).

```bash
git add assets/emojis
git commit -m "Add rarity gem emoji set"
```

---

### Task 4: Status, site, and lot SVGs (12)

**Files:**
- Create: `assets/emojis/svg/dw_star.svg`, `dw_alert.svg`, `dw_hunger.svg`
- Create: `assets/emojis/svg/dw_site_volcano_core.svg`, `dw_site_coastal_dig.svg`, `dw_site_amber_ridge.svg`, `dw_site_frozen_cliffs.svg`
- Create: `assets/emojis/svg/dw_lot_carnivore.svg`, `dw_lot_herbivore.svg`, `dw_lot_food_court.svg`, `dw_lot_hatchery.svg`, `dw_lot_visitor.svg`
- Test: `tests/emoji-assets.test.ts` (add SVG↔fallback parity test)

**Interfaces:**
- Consumes: `EMOJI_FALLBACK` (Task 1), build script (Task 2).
- Produces: complete 21-file SVG set; lot badges reuse park tile palette (paddock tan `#e8d9a0→#b89a58`, facility blue `#a9cbe6→#5d88ad` — derived from `PADDOCK_PALETTE`/`FACILITY_PALETTE` in `src/data/render-icons.ts`).

- [ ] **Step 1: Add the parity test**

Append to `tests/emoji-assets.test.ts` (add `EMOJI_FALLBACK` to imports from `../src/core/emojis.js`):

```ts
import { EMOJI_FALLBACK } from '../src/core/emojis.js';

describe('svg set parity', () => {
  it('svg files exactly match the 21 fallback-table names', () => {
    const names = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).map((f) => f.replace('.svg', '')).sort();
    expect(names).toEqual(Object.keys(EMOJI_FALLBACK).sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emoji-assets.test.ts`
Expected: FAIL — parity test reports 9 names vs 21.

- [ ] **Step 3: Write the 3 status SVGs**

Create `assets/emojis/svg/dw_star.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe28a"/><stop offset="1" stop-color="#e0982a"/></linearGradient></defs>
  <polygon points="32,4 39,24 60,24 43,37 49,58 32,45 15,58 21,37 4,24 25,24" fill="url(#g)" stroke="#6b430a" stroke-width="3" stroke-linejoin="round"/>
  <ellipse cx="26" cy="20" rx="8" ry="4" fill="#ffffff" opacity="0.4" transform="rotate(-15 26 20)"/>
</svg>
```

Create `assets/emojis/svg/dw_alert.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f26d5e"/><stop offset="1" stop-color="#c0271a"/></linearGradient></defs>
  <path d="M28.5 8 Q32 3 35.5 8 L59 50 Q61.5 55 56 55 L8 55 Q2.5 55 5 50 Z" fill="url(#g)" stroke="#6e130b" stroke-width="3" stroke-linejoin="round"/>
  <rect x="29" y="20" width="6" height="18" rx="3" fill="#ffffff"/>
  <circle cx="32" cy="46" r="4" fill="#ffffff"/>
</svg>
```

Create `assets/emojis/svg/dw_hunger.svg` (desaturated meat + red alert badge):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8a89e"/><stop offset="1" stop-color="#7d6a5e"/></linearGradient></defs>
  <rect x="34" y="39" width="16" height="6" rx="3" fill="#d9d2c6" stroke="#a39a88" stroke-width="2" transform="rotate(35 42 42)"/>
  <circle cx="50" cy="41" r="5" fill="#d9d2c6" stroke="#a39a88" stroke-width="2"/>
  <circle cx="43" cy="53" r="5" fill="#d9d2c6" stroke="#a39a88" stroke-width="2"/>
  <ellipse cx="26" cy="33" rx="17" ry="13" fill="url(#g)" stroke="#4a3c34" stroke-width="3" transform="rotate(-25 26 33)"/>
  <circle cx="48" cy="16" r="12" fill="#d8352a" stroke="#6e130b" stroke-width="2.5"/>
  <rect x="46" y="9" width="4" height="9" rx="2" fill="#ffffff"/>
  <circle cx="48" cy="21.5" r="2.2" fill="#ffffff"/>
</svg>
```

- [ ] **Step 4: Write the 4 site SVGs**

Create `assets/emojis/svg/dw_site_volcano_core.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a6a52"/><stop offset="1" stop-color="#4e372a"/></linearGradient></defs>
  <polygon points="32,10 54,54 10,54" fill="url(#g)" stroke="#2e1f16" stroke-width="3" stroke-linejoin="round"/>
  <ellipse cx="32" cy="13" rx="7" ry="3.5" fill="#f2622e" stroke="#2e1f16" stroke-width="2"/>
  <path d="M27 13 Q25 26 20 34" fill="none" stroke="#f2622e" stroke-width="4" stroke-linecap="round"/>
  <path d="M36 14 Q39 24 43 30" fill="none" stroke="#ffb14a" stroke-width="4" stroke-linecap="round"/>
</svg>
```

Create `assets/emojis/svg/dw_site_coastal_dig.svg` (scallop shell):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9c9"/><stop offset="1" stop-color="#d9a45e"/></linearGradient></defs>
  <path d="M32 56 L13 31 A24 22 0 0 1 51 31 Z" fill="url(#g)" stroke="#8a5a22" stroke-width="3" stroke-linejoin="round"/>
  <path d="M32 56 L22 26 M32 56 L32 22 M32 56 L42 26" fill="none" stroke="#8a5a22" stroke-width="2" opacity="0.6"/>
  <ellipse cx="26" cy="22" rx="7" ry="3.5" fill="#ffffff" opacity="0.45" transform="rotate(-15 26 22)"/>
</svg>
```

Create `assets/emojis/svg/dw_site_amber_ridge.svg` (amber drop, inclusion):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc257"/><stop offset="1" stop-color="#cf7014"/></linearGradient></defs>
  <path d="M32 5 C43 20 51 29 51 41 A19 19 0 0 1 13 41 C13 29 21 20 32 5 Z" fill="url(#g)" stroke="#8a4a0a" stroke-width="3"/>
  <circle cx="32" cy="40" r="4" fill="#5e2f06"/>
  <line x1="26" y1="36" x2="38" y2="44" stroke="#5e2f06" stroke-width="1.5"/>
  <line x1="26" y1="44" x2="38" y2="36" stroke="#5e2f06" stroke-width="1.5"/>
  <ellipse cx="25" cy="22" rx="6" ry="9" fill="#ffffff" opacity="0.35" transform="rotate(-12 25 22)"/>
</svg>
```

Create `assets/emojis/svg/dw_site_frozen_cliffs.svg` (twin ice peaks):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f7ff"/><stop offset="1" stop-color="#7db8dd"/></linearGradient></defs>
  <polygon points="8,56 21,16 32,56" fill="url(#g)" stroke="#2a5d7a" stroke-width="3" stroke-linejoin="round"/>
  <polygon points="26,56 42,8 56,56" fill="url(#g)" stroke="#2a5d7a" stroke-width="3" stroke-linejoin="round"/>
  <polyline points="21,16 24,26 19,30" fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.8"/>
  <polyline points="42,8 45,20 39,26" fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.8"/>
</svg>
```

- [ ] **Step 5: Write the 5 lot SVGs**

Lot icons share a rounded-square badge tying into the park tile palette. Paddocks (carnivore, herbivore) get tan; facilities (food court, hatchery, visitor) get blue.

Create `assets/emojis/svg/dw_lot_carnivore.svg` (claw slashes on tan):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8d9a0"/><stop offset="1" stop-color="#b89a58"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#6b5526" stroke-width="3"/>
  <path d="M20 14 Q28 32 21 50" fill="none" stroke="#7a2418" stroke-width="5" stroke-linecap="round"/>
  <path d="M32 12 Q40 32 33 52" fill="none" stroke="#7a2418" stroke-width="5" stroke-linecap="round"/>
  <path d="M44 14 Q52 32 45 50" fill="none" stroke="#7a2418" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="20" cy="12" rx="10" ry="4" fill="#ffffff" opacity="0.3" transform="rotate(-12 20 12)"/>
</svg>
```

Create `assets/emojis/svg/dw_lot_herbivore.svg` (fern frond on tan):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8d9a0"/><stop offset="1" stop-color="#b89a58"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#6b5526" stroke-width="3"/>
  <path d="M32 52 Q30 32 34 13" fill="none" stroke="#2e7d32" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="24" cy="22" rx="9" ry="4" fill="#43a047" transform="rotate(-35 24 22)"/>
  <ellipse cx="42" cy="20" rx="9" ry="4" fill="#43a047" transform="rotate(35 42 20)"/>
  <ellipse cx="22" cy="34" rx="9" ry="4" fill="#2e7d32" transform="rotate(-30 22 34)"/>
  <ellipse cx="43" cy="33" rx="9" ry="4" fill="#2e7d32" transform="rotate(30 43 33)"/>
  <ellipse cx="20" cy="12" rx="10" ry="4" fill="#ffffff" opacity="0.3" transform="rotate(-12 20 12)"/>
</svg>
```

Create `assets/emojis/svg/dw_lot_food_court.svg` (burger on blue):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9cbe6"/><stop offset="1" stop-color="#5d88ad"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#24506b" stroke-width="3"/>
  <path d="M16 30 A16 12 0 0 1 48 30 Z" fill="#f2b25c" stroke="#7a4a1e" stroke-width="2.5"/>
  <path d="M15 33 Q20 39 25 33 Q29 39 34 33 Q39 39 44 33 L49 33" fill="none" stroke="#57b85a" stroke-width="4" stroke-linecap="round"/>
  <rect x="16" y="37" width="32" height="6" rx="3" fill="#7a4a1e" stroke="#4a2c10" stroke-width="2"/>
  <rect x="15" y="45" width="34" height="7" rx="3.5" fill="#f2b25c" stroke="#7a4a1e" stroke-width="2.5"/>
</svg>
```

Create `assets/emojis/svg/dw_lot_hatchery.svg` (speckled egg on blue):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9cbe6"/><stop offset="1" stop-color="#5d88ad"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#24506b" stroke-width="3"/>
  <path d="M32 11 C41 11 47 23 47 34 A15 15 0 0 1 17 34 C17 23 23 11 32 11 Z" fill="#f7f1e1" stroke="#9a8b6a" stroke-width="2.5"/>
  <circle cx="27" cy="26" r="2" fill="#c9b88e"/>
  <circle cx="37" cy="33" r="2.4" fill="#c9b88e"/>
  <circle cx="29" cy="41" r="1.8" fill="#c9b88e"/>
  <ellipse cx="27" cy="18" rx="5" ry="7" fill="#ffffff" opacity="0.5" transform="rotate(-15 27 18)"/>
</svg>
```

Create `assets/emojis/svg/dw_lot_visitor.svg` (columned building on blue):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9cbe6"/><stop offset="1" stop-color="#5d88ad"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#24506b" stroke-width="3"/>
  <polygon points="32,10 53,22 11,22" fill="#f5f0e6" stroke="#6b5526" stroke-width="2.5" stroke-linejoin="round"/>
  <rect x="16" y="25" width="6" height="20" fill="#f5f0e6" stroke="#6b5526" stroke-width="2"/>
  <rect x="29" y="25" width="6" height="20" fill="#f5f0e6" stroke="#6b5526" stroke-width="2"/>
  <rect x="42" y="25" width="6" height="20" fill="#f5f0e6" stroke="#6b5526" stroke-width="2"/>
  <rect x="12" y="47" width="40" height="6" rx="2" fill="#f5f0e6" stroke="#6b5526" stroke-width="2"/>
</svg>
```

- [ ] **Step 6: Build and test**

Run: `npm run build-emojis && npx vitest run tests/emoji-assets.test.ts`
Expected: `Rendered 21 emoji PNGs…`, PASS including parity test.

- [ ] **Step 7: Visual check + commit**

View all 21 PNGs at small zoom — silhouettes must read at ~20% scale.

```bash
git add assets/emojis tests/emoji-assets.test.ts
git commit -m "Complete 21-icon application emoji set"
```

---

### Task 5: HUD cash icon — build output + draw.ts

**Files:**
- Modify: `src/build-emojis.ts` (HUD render)
- Modify: `src/core/render/draw.ts` (imports ~line 1, new helpers near `iconValue` ~line 42, HUD block ~line 100)
- Test: `tests/emoji-assets.test.ts` (HUD asset check), `tests/render-draw.test.ts` (existing suite must stay green)

**Interfaces:**
- Consumes: `renderSvg` (Task 2), `dw_cash.svg` (Task 2).
- Produces: `assets/images/hud/cash.png` (64×64, committed). `renderParkPng` draws it in the stats bar, falling back to the 💰 glyph when the file is missing.

- [ ] **Step 1: Add the failing asset test**

Append to `tests/emoji-assets.test.ts`:

```ts
describe('hud assets', () => {
  it('hud cash icon is a 64×64 png', () => {
    const img = decode(readFileSync(resolve(process.cwd(), 'assets/images/hud/cash.png')));
    expect(img.width).toBe(64);
    expect(img.height).toBe(64);
  });
});
```

Run: `npx vitest run tests/emoji-assets.test.ts` — Expected: FAIL (ENOENT).

- [ ] **Step 2: Extend the build script**

In `src/build-emojis.ts`, after the emoji loop add:

```ts
const HUD_DIR = resolve(process.cwd(), 'assets/images/hud');
mkdirSync(HUD_DIR, { recursive: true });
writeFileSync(resolve(HUD_DIR, 'cash.png'), renderSvg(readFileSync(resolve(SVG_DIR, 'dw_cash.svg')), 64));
console.log('Rendered HUD cash icon to assets/images/hud/cash.png.');
```

Run: `npm run build-emojis && npx vitest run tests/emoji-assets.test.ts`
Expected: PASS.

- [ ] **Step 3: Draw it in the HUD**

In `src/core/render/draw.ts`:

Change the canvas import to include `Image` and add `readFileSync`:

```ts
import { createCanvas, GlobalFonts, Image, type SKRSContext2D } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
```

Add below `ensureFonts` (icon cached like fonts; missing file degrades to the glyph):

```ts
let hudCash: Image | null | undefined;
function hudCashIcon(): Image | null {
  if (hudCash !== undefined) return hudCash;
  try {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/hud/cash.png'));
    hudCash = img;
  } catch { hudCash = null; }
  return hudCash;
}

// Like iconValue, but with a raster icon instead of an emoji glyph.
function iconImageValue(c: SKRSContext2D, x: number, y: number, img: Image, value: string, size: number): number {
  c.drawImage(img, x, y - size + 3, size, size);
  c.font = `${size}px "${SANS}"`; c.fillText(value, x + size + 6, y);
  return x + size + 6 + c.measureText(value).width;
}
```

In the HUD block, replace:

```ts
  sx = iconValue(c, sx, 40, '💰', snap.cash.toLocaleString(), 22) + 18;
```

with:

```ts
  const cashIcon = hudCashIcon();
  sx = (cashIcon
    ? iconImageValue(c, sx, 40, cashIcon, snap.cash.toLocaleString(), 22)
    : iconValue(c, sx, 40, '💰', snap.cash.toLocaleString(), 22)) + 18;
```

- [ ] **Step 4: Run render tests**

Run: `npx vitest run tests/render-draw.test.ts tests/park-view-image.test.ts tests/render-client.test.ts`
Expected: PASS (renderer contract unchanged — output buffer, dimensions).

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run typecheck`
Expected: all green.

```bash
git add src/build-emojis.ts src/core/render/draw.ts assets/images/hud tests/emoji-assets.test.ts
git commit -m "Draw HUD cash icon in park renderer with glyph fallback"
```

---

### Task 6: `deploy-emojis` sync script + docs

**Files:**
- Create: `src/deploy-emojis.ts`
- Modify: `package.json` (scripts), `CLAUDE.md` (conventions)
- Test: none against the live API (same stance as `deploy-commands.ts`); `npm run typecheck` gates it.

**Interfaces:**
- Consumes: `loadConfig` from `src/core/config.js`; committed PNGs (Tasks 2–4); discord.js `REST`/`Routes` (`Routes.applicationEmojis(appId)`, `Routes.applicationEmoji(appId, id)`).
- Produces: `npm run deploy-emojis`; `assets/emojis/manifest.json` (committed name→sha256 of last-deployed PNGs, drives change detection).

- [ ] **Step 1: Write the script**

Create `src/deploy-emojis.ts`:

```ts
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './core/config.js';

const config = loadConfig();
const rest = new REST().setToken(config.token);
const PNG_DIR = resolve(process.cwd(), 'assets/emojis/png');
const MANIFEST = resolve(process.cwd(), 'assets/emojis/manifest.json');

const local = new Map<string, Buffer>();
for (const f of readdirSync(PNG_DIR).filter((n) => n.endsWith('.png')).sort()) {
  local.set(f.replace('.png', ''), readFileSync(resolve(PNG_DIR, f)));
}
const manifest: Record<string, string> = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const res = await rest.get(Routes.applicationEmojis(config.clientId)) as
  { items: Array<{ id: string; name: string }> };
const remote = new Map(res.items.map((e) => [e.name, e.id]));

let created = 0, replaced = 0, unchanged = 0;
for (const [name, png] of local) {
  const digest = sha(png);
  const existingId = remote.get(name);
  if (existingId && manifest[name] === digest) { unchanged++; continue; }
  if (existingId) {          // changed → delete + recreate (new ID; runtime refetches on next boot)
    await rest.delete(Routes.applicationEmoji(config.clientId, existingId));
    replaced++;
  } else { created++; }
  await rest.post(Routes.applicationEmojis(config.clientId), {
    body: { name, image: `data:image/png;base64,${png.toString('base64')}` },
  });
  manifest[name] = digest;
}
for (const name of remote.keys()) {
  if (!local.has(name)) console.log(`Orphan on Discord (no local PNG, left in place): ${name}`);
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Emojis synced: ${created} created, ${replaced} replaced, ${unchanged} unchanged (${local.size} local).`);
```

Add to `package.json` `"scripts"`:

```json
"deploy-emojis": "tsx src/deploy-emojis.ts",
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (Do NOT run `deploy-emojis` in this task — it hits the live API; the operator runs it once at rollout, see Task 12.)

- [ ] **Step 3: Document the convention**

Append to the repo `CLAUDE.md` bullet list:

```markdown
- Custom app emojis: SVG sources in `assets/emojis/svg/`, rendered via
  `npm run build-emojis` (PNGs committed), synced with `npm run deploy-emojis`
  (manifest.json tracks deployed hashes). Runtime lookup is `emojiTag` /
  `rarityEmoji` (`src/core/emojis.ts`) — unicode fallback when unset, so a
  missing emoji is never an error. Never call `emojiTag` in a module-level
  constant (map loads after client ready), and never put custom emoji tags
  in autocomplete labels (Discord renders them as literal text there).
```

- [ ] **Step 4: Commit**

```bash
git add src/deploy-emojis.ts package.json CLAUDE.md
git commit -m "Add application emoji deploy script with manifest sync"
```

---

### Task 7: `assetImage` banners kind

**Files:**
- Modify: `src/core/images.ts:19`
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `assetImage(kind: 'eggs' | 'sites' | 'banners', name: string): ImageRef | null` — later tasks call `assetImage('banners', 'trading' | 'leaderboards' | 'help' | 'care' | 'care_neglect')`.

- [ ] **Step 1: Write the failing test**

Append to the `describe('assetImage')` block in `tests/images.test.ts`:

```ts
  it('accepts the banners kind and null-degrades when absent', () => {
    expect(assetImage('banners', 'no-such-banner')).toBeNull();
  });
```

Run: `npx vitest run tests/images.test.ts`
Expected: FAIL — TS2345 (type error: `'banners'` not assignable). With vitest running transpiled TS this may surface as a type-check failure via `npm run typecheck`; either failure mode is the expected red.

- [ ] **Step 2: Widen the union**

In `src/core/images.ts` change:

```ts
export function assetImage(kind: 'eggs' | 'sites', name: string): ImageRef | null {
```

to:

```ts
export function assetImage(kind: 'eggs' | 'sites' | 'banners', name: string): ImageRef | null {
```

- [ ] **Step 3: Verify green + commit**

Run: `npx vitest run tests/images.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/core/images.ts tests/images.test.ts
git commit -m "Add banners kind to assetImage"
```

---

### Task 8: Banner art generation (5 images) — INLINE-ONLY TASK

**⚠ This task requires image-generation tooling (Nano Banana Pro via the gemini-imagegen skill). Execute it in the main session, NOT via a code subagent. If running the plan with subagents, skip this task and return it to the operator.**

**Files:**
- Create: `assets/images/banners/trading.png`, `leaderboards.png`, `help.png`, `care.png`, `care_neglect.png` (1536×1024 each)
- Modify: `docs/assets/prompts.md`
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: `assetImage('banners', …)` (Task 7); existing site-banner art style (reference images in `assets/images/sites/`).
- Produces: the 5 committed banner PNGs later tasks attach.

- [ ] **Step 1: Add the failing presence test**

Append to `tests/images.test.ts`:

```ts
  it('ships all five banner images', () => {
    for (const name of ['trading', 'leaderboards', 'help', 'care', 'care_neglect']) {
      const img = assetImage('banners', name);
      expect(img, name).not.toBeNull();
      expect(img!.url).toBe(`attachment://${name}.png`);
    }
  });
```

Run: `npx vitest run tests/images.test.ts` — Expected: FAIL (all five null).

- [ ] **Step 2: Write the five prompts into `docs/assets/prompts.md`**

Add a `## Banners` section. Each prompt follows the established site-banner formula (match the existing painterly style descriptors already recorded in that file for sites — same lighting, palette warmth, no text/watermark, 3:2 → deliver 1536×1024). Scenes:

- `trading.png` — bustling prehistoric market stall between two friendly dinosaurs exchanging goods (crates of meat, gleaming eggs), park pathway setting
- `leaderboards.png` — stone podium with three tiers, golden trophy on top step, cheering small dinosaurs, park flags
- `help.png` — grand wooden park entrance gates opening onto a lush dinosaur park at golden hour, welcoming path
- `care.png` — keeper's feeding area, content herbivore eating from a trough, warm morning light
- `care_neglect.png` — same feeding area but empty trough, drooping hungry herbivore, overcast light (clearly the "needs attention" variant of care.png)

- [ ] **Step 3: Generate, match style, place files**

Generate each with a site banner (e.g. `volcano_core-banner.png`) as the style reference. Resize/crop to exactly 1536×1024. Save into `assets/images/banners/`.

- [ ] **Step 4: Verify test passes + visual check**

Run: `npx vitest run tests/images.test.ts` — Expected: PASS.
View all five; `care_neglect` must read as the gloomy twin of `care`.

- [ ] **Step 5: Commit**

```bash
git add assets/images/banners docs/assets/prompts.md tests/images.test.ts
git commit -m "Add trading, leaderboards, help, and care banner art"
```

---

### Task 9: Integration — park + admin

**Files:**
- Modify: `src/modules/park/embeds.ts`, `src/modules/park/index.ts:228-232`, `src/modules/admin/index.ts:28-35`
- Test: existing `tests/park.test.ts`, `tests/admin.test.ts` (assertions on changed strings updated in-task)

**Interfaces:**
- Consumes: `emojiTag` (Task 1).
- Produces: no new exports. Behavior contract: with no emoji map loaded (all tests), every user-visible string is byte-identical to before EXCEPT the collect button (emoji moves from label into `setEmoji`).
- Note: the spec's integration table lists "notify.ts — escape alerts get dw_alert", but `src/core/notify.ts` contains no 🚨 (its handlers use 🥚/🧭, which stay unicode — not in the set). Escape alerts actually render in the park embed extras and the admin inspect embed; this task's `dw_alert` swaps are the complete fulfillment of that spec row.

- [ ] **Step 1: Park embeds**

In `src/modules/park/embeds.ts` add `import { emojiTag } from '../../core/emojis.js';` and change (current → new):

```ts
  if (escapedCount > 0) extras.push(`${escapedCount} ${emojiTag('dw_alert')} escaped`);
  if (opts.atRiskCount) extras.push(`${emojiTag('dw_hunger')} ${opts.atRiskCount} at risk`);
  ...
      { name: `${emojiTag('dw_cash')} Cash`, value: user.cash.toLocaleString(), inline: true },
      { name: `${emojiTag('dw_star')} Rating`, value: (user.parkRating / 100).toFixed(1), inline: true },
```

(`🏞️` title, `🦕 Dinos`, `🏗️ Lots`, `⛔` stay unicode — not in the set.)

Lot rows: prefix each lot with its lot emoji. Add a local map above the embed builder:

```ts
const LOT_EMOJI: Record<string, string> = {
  carnivore_paddock: 'dw_lot_carnivore', herbivore_paddock: 'dw_lot_herbivore',
  food_court: 'dw_lot_food_court', hatchery_lab: 'dw_lot_hatchery', visitor_center: 'dw_lot_visitor',
};
```

and change the lots line to (the conditional space keeps the row clean when a lot kind has no icon — never post-process with `.replace`, which would also collapse legitimate double spaces):

```ts
      { name: '🏗️ Lots', value: lots.map((l) => {
        const e = emojiTag(LOT_EMOJI[l.kind] ?? '');
        return `#${l.id} ${e ? `${e} ` : ''}${l.name} (lvl ${l.level})`;
      }).join('\n') || 'None — /build', inline: false },
```

**Resolved:** `Lot` (from `./service.js`) already carries `kind` — see `src/modules/park/service.ts:51`. No caller change needed.

Collect button — emoji moves out of the label:

```ts
    new ButtonBuilder().setCustomId('park:collect').setEmoji(emojiTag('dw_cash')).setLabel(`Collect ${pending.toLocaleString()}`).setStyle(ButtonStyle.Success),
```

- [ ] **Step 2: Park collect reply**

In `src/modules/park/index.ts` (add the `emojiTag` import with `.js` suffix):

```ts
          await i.reply({ content: amount > 0 ? `${emojiTag('dw_cash')} Collected **${amount.toLocaleString()}** cash.` : 'Nothing to collect yet.', flags: MessageFlags.Ephemeral });
```

- [ ] **Step 3: Admin inspect embed**

In `src/modules/admin/index.ts` (add import):

```ts
    { name: `${emojiTag('dw_cash')} / ${emojiTag('dw_food')} / ${emojiTag('dw_shard')}`, value: `${u.cash} / ${u.food} / ${u.shards}`, inline: true },
    { name: `${emojiTag('dw_star')} Rating`, value: `${(u.parkRating / 100).toFixed(1)} (hw ${(u.ratingHighWater / 100).toFixed(1)})`, inline: true },
    { name: '🦕 Dinos', value: line(dinos.map((d) => `#${d.id} ${d.speciesId}${d.escapedAt !== null ? ` ${emojiTag('dw_alert')}` : ''}${d.lotId ? ` @${d.lotId}` : ''}`).join('\n')), inline: false },
```

(🔧 🥚 🏗️ 🤝 🧭 stay unicode.)

- [ ] **Step 4: Run tests, fix assertions**

Run: `npx vitest run tests/park.test.ts tests/admin.test.ts tests/park-snapshot.test.ts`
Fallbacks make field names identical (`💰 Cash` etc.). Expected breakage: only assertions on the collect button label (was `💰 Collect …`, now `Collect …` + emoji prop). Update those assertions to the new label and, where the harness exposes it, assert the emoji is set. Grep first:

Run: `npx vitest run` then `grep -rn "Collect" tests/`
Fix each. Do NOT weaken assertions — assert the new exact strings.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run typecheck` — Expected: green.

```bash
git add src/modules/park src/modules/admin tests/
git commit -m "Use application emojis in park and admin embeds"
```

---

### Task 10: Integration — expeditions + leaderboards + banner

**Files:**
- Modify: `src/modules/expeditions/index.ts:14-21,66-70`, `src/modules/leaderboards/index.ts:6,27-34`
- Test: `tests/expeditions.test.ts`, `tests/leaderboards.test.ts`

**Interfaces:**
- Consumes: `emojiTag` (Task 1), `assetImage('banners', 'leaderboards')` (Tasks 7–8).
- Produces: no new exports. **Do NOT touch autocomplete labels (lines ~40-47) — asserted verbatim in tests and custom tags don't render there.**

- [ ] **Step 1: Expeditions**

In `src/modules/expeditions/index.ts` (add `emojiTag` import). Add a small helper above `sitePayload` and use it for both titles (conditional space, never `.replace`):

```ts
// '🌋 ' when the site marker resolves, '' when it doesn't — keeps titles clean either way.
function siteMarker(siteId: string): string {
  const t = emojiTag(`dw_site_${siteId}`);
  return t ? `${t} ` : '';
}
```

Site title in `sitePayload`:

```ts
    .setTitle(`🧭 ${siteMarker(siteId)}${EXPEDITION_SITES[siteId].name}`).setDescription(description);
```

(The unicode fallbacks 🌋🐚🟠❄️ are non-empty, so the marker appears in tests — update `tests/expeditions.test.ts` title assertions accordingly.)

Claim embed fields:

```ts
              .addFields({ name: `${emojiTag('dw_cash')} Cash`, value: `+${loot.cash}`, inline: true }, { name: `${emojiTag('dw_food')} Food`, value: `+${loot.food}`, inline: true });
```

Claim title gets the marker too:

```ts
            const embed = new EmbedBuilder().setColor(0xe8590c).setTitle(`🧭 ${siteMarker(site.id)}${site.name} — returned!`)
```

- [ ] **Step 2: Leaderboards — lazy labels + banner**

In `src/modules/leaderboards/index.ts` replace the module-level constant (the emojiTag-at-module-init trap):

```ts
const METRIC_LABEL: Record<Metric, string> = { rating: '⭐ Rating', cash: '💰 Cash', collection: '🦕 Collection' };
```

with a function (🦕 stays unicode — no dino emoji in the set):

```ts
function metricLabel(metric: Metric): string {
  return { rating: `${emojiTag('dw_star')} Rating`, cash: `${emojiTag('dw_cash')} Cash`, collection: '🦕 Collection' }[metric];
}
```

Update the one usage: `.setTitle(\`🏆 Top ${metricLabel(metric)} — ${scope}\`)`. If `METRIC_LABEL` has other usages (grep), convert them identically.

Attach the banner (mirror the expeditions claim pattern — `AttachmentBuilder` import may be needed):

```ts
const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
const banner = assetImage('banners', 'leaderboards');
if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
await i.reply(payload);
```

- [ ] **Step 3: Tests**

Run: `npx vitest run tests/expeditions.test.ts tests/leaderboards.test.ts`
Expected breakage: expedition title assertions (marker fallback 🌋 etc. now present). Update to exact new strings. Leaderboard titles unchanged (fallbacks identical).

- [ ] **Step 4: Full check + commit**

Run: `npm test && npm run typecheck`

```bash
git add src/modules/expeditions src/modules/leaderboards tests/
git commit -m "Use application emojis in expeditions and leaderboards"
```

---

### Task 11: Integration — trading + shop

**Files:**
- Modify: `src/modules/trading/index.ts` (summarize ~16-23, list embed ~47-49, replies ~96-114), `src/modules/shop/index.ts` (~37-65, 100-128)
- Test: `tests/trading.test.ts`, `tests/shop.test.ts`, `tests/autocomplete-trading.test.ts`, `tests/autocomplete-shop.test.ts`

**Interfaces:**
- Consumes: `emojiTag`, `rarityEmoji`, `EMOJI_FALLBACK` (Task 1); `assetImage('banners', 'trading')`.
- Produces: `summarize(side: TradeSide, e?: (name: string) => string): string` — default formatter is the unicode fallback table, so **autocomplete call sites stay unchanged and their verbatim-label tests keep passing**; reply/notify call sites pass `emojiTag`.

- [ ] **Step 1: Trading summarize formatter**

```ts
import { emojiTag, EMOJI_FALLBACK } from '../../core/emojis.js';

function summarize(side: TradeSide, e: (name: string) => string = (n) => EMOJI_FALLBACK[n] ?? ''): string {
  const parts: string[] = [];
  if (side.dinoIds.length) parts.push(`🦕 dinos ${side.dinoIds.join(',')}`);
  if (side.eggIds.length) parts.push(`🥚 eggs ${side.eggIds.join(',')}`);
  if (side.cash) parts.push(`${e('dw_cash')} ${side.cash}`);
  if (side.food) parts.push(`${e('dw_food')} ${side.food}`);
  return parts.join(' + ') || 'nothing';
}
```

Reply/notify call sites (offer reply, notify, accept/decline notifications — lines ~96-99) become `summarize(offer, emojiTag)` / `summarize(request, emojiTag)`. The autocomplete call site (~line 137) stays `summarize(mineGive)` / `summarize(mineGet)` — unicode.

- [ ] **Step 2: Trading list banner**

```ts
  const embed = new EmbedBuilder().setTitle('🤝 Pending trades').setDescription(lines).setColor(0x5865F2)
    .setFooter({ text: `Page ${p}/${pages}` });
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: pages > 1 ? [pageRow('trade', 'list', userId, p, pages)] : [] };
  const banner = assetImage('banners', 'trading');
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  return payload;
```

(Adjust the function's return type/callers if they destructure — keep the same shape plus optional `files`. If pagination re-renders via `i.update`, spread `attachments: []` like hatchery does at `src/modules/hatchery/index.ts:77`.)

- [ ] **Step 3: Shop**

In `src/modules/shop/index.ts` (imports: `emojiTag`, `rarityEmoji`):

- Egg lines (~line 37): `` `• ${rarityEmoji(r)}${r} egg — ${SHOP_EGG_PRICES[r].toLocaleString()} cash` ``
- Food field name `🍖 Food (/shop food)` → `` `${emojiTag('dw_food')} Food (/shop food)` ``; 🥚 🌴 🏪 stay unicode.
- Purchase embed title (~57): `` `🥚 Bought a ${rarityEmoji(egg.rarity)}${egg.rarity} egg (#${egg.id})` ``
- Food purchase reply (~65): `` `${emojiTag('dw_food')} Food purchased.` ``
- Sell button (~101): `.setEmoji(emojiTag('dw_cash')).setLabel('Confirm sale')`
- Sale confirmation (~128): `` `${emojiTag('dw_cash')} Sold for **${res.cash.toLocaleString()}** cash and **${res.shards}** shards${cap}.` ``
- **Autocomplete labels (~84-88, 113-116) untouched.**

- [ ] **Step 4: Tests**

Run: `npx vitest run tests/trading.test.ts tests/shop.test.ts tests/autocomplete-trading.test.ts tests/autocomplete-shop.test.ts`
Expected: autocomplete tests green untouched (default formatter = same unicode). Reply strings green (fallback identical). Breakage only on the sell-button label assertion — update it.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run typecheck`

```bash
git add src/modules/trading src/modules/shop tests/
git commit -m "Use application emojis in trading and shop with trade list banner"
```

---

### Task 12: Integration — hatchery gems, help banner, care embed + banners

**Files:**
- Modify: `src/modules/hatchery/embeds.ts` (titles/lines ~17-67), `src/modules/help/index.ts:71-76`, `src/modules/care/index.ts:34-40`
- Test: `tests/hatchery.test.ts`, `tests/help.test.ts`, `tests/care.test.ts`

**Interfaces:**
- Consumes: `rarityEmoji`, `emojiTag` (Task 1); `assetImage('banners', 'help' | 'care' | 'care_neglect')`; `VERY_HUNGRY_MS` from `src/core/autocomplete.js`; `schema` from `src/core/db/index.js`.
- Produces: care replies switch from plain content to an embed payload (banner-carrying). Reply text becomes the embed description — update care tests accordingly.

- [ ] **Step 1: Hatchery gem prefixes**

In `src/modules/hatchery/embeds.ts` (import `rarityEmoji`):

- Pre-hatch title: `` `🥚 A ${rarityEmoji(rarity)}${rarity} egg trembles…` ``
- Reveal title: `` `✨ ${rarityEmoji(species.rarity)}${species.rarity.toUpperCase()} — ${species.name}!` ``
- Egg list line: `` `#${e.id} — ${rarityEmoji(e.rarity)}${e.rarity} egg — ${status}` ``

(No map in tests → `rarityEmoji` returns `''` → strings byte-identical → hatchery tests stay green.)

- [ ] **Step 2: Help overview banner**

In `src/modules/help/index.ts` (imports: `assetImage`, `AttachmentBuilder` type). `HELP_TOPICS` titles stay unicode (module-level constant — emojiTag forbidden there, and topic emojis are out of set). Overview reply:

```ts
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [overview] };
  const banner = assetImage('banners', 'help');
  if (banner) { overview.setImage(banner.url); payload.files = [banner.file]; }
  await i.reply(payload);
```

- [ ] **Step 3: Care embed with neglect-aware banner**

In `src/modules/care/index.ts` (imports: `EmbedBuilder`, `AttachmentBuilder` from discord.js; `emojiTag`; `assetImage`; `VERY_HUNGRY_MS` from `../../core/autocomplete.js`; `schema`, `eq` already or add). Add:

```ts
function carePayload(ctx: Ctx, userId: string, description: string) {
  const embed = new EmbedBuilder().setTitle(`${emojiTag('dw_food')} Care`).setColor(0x3ba55c).setDescription(description);
  const now = ctx.now();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
  const neglected = dinos.some((d) => d.escapedAt === null && now - d.lastFedAt >= VERY_HUNGRY_MS);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  const banner = assetImage('banners', neglected ? 'care_neglect' : 'care');
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  return payload;
}
```

Replace the three feed replies (lines ~34-40):

```ts
            const msg = fed.length ? `Fed ${fed.length} dino(s).` : 'Nothing needed feeding.';
            await i.reply(carePayload(ctx, i.user.id, skipped.length ? `${msg} Skipped ${skipped.length} (not enough food).` : msg));
          } else {
            const { species, cost } = feedDino(ctx, i.user.id, i.options.getInteger('dino', true));
            await i.reply(carePayload(ctx, i.user.id, `Fed your ${species.name} (−${cost} food).`));
```

(The leading 🍖 moves from the content string into the embed title. If `Ctx`/`schema`/`eq` types differ from assumed names, follow the module's existing imports — care's service layer already queries `schema.dinos`.)

- [ ] **Step 4: Tests**

Run: `npx vitest run tests/hatchery.test.ts tests/help.test.ts tests/care.test.ts`
Expected breakage: care tests asserting `content` strings — rework them to assert the embed description and title (`🍖 Care` via fallback) instead. Hatchery/help green.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run typecheck`

```bash
git add src/modules/hatchery src/modules/help src/modules/care tests/
git commit -m "Add rarity gems, help banner, and care embed with neglect banner"
```

---

### Task 13: Final verification + rollout notes

**Files:**
- Modify: none expected (fixes only if verification finds drift)

- [ ] **Step 1: Full suite**

Run: `npm test && npm run typecheck`
Expected: all green (≈290+ tests: prior 278 + new emoji/asset/banner tests).

- [ ] **Step 2: Build determinism**

Run: `npm run build-emojis` then `git status --porcelain assets/`
Expected: empty output — re-render produces byte-identical PNGs. If not, investigate before proceeding (determinism is what makes the deploy manifest meaningful).

- [ ] **Step 3: Docs cross-check**

Verify: repo `CLAUDE.md` has the emoji convention bullet (Task 6); `docs/assets/prompts.md` has the Banners section (Task 8); spec + this plan committed.

- [ ] **Step 4: Rollout (operator, once)**

```bash
npm run deploy-emojis    # uploads 21 app emojis; commit the updated assets/emojis/manifest.json
git add assets/emojis/manifest.json && git commit -m "Record deployed emoji manifest"
```

No `deploy-commands` needed (no builder changes). Restart the single bot instance; on ready it fetches the emoji map and custom emojis go live. Before restart (or if deploy is skipped), everything renders with unicode fallbacks.

- [ ] **Step 5: Final commit if fixes were needed**

```bash
git add -A && git commit -m "Fix verification drift in emoji asset round"
```
