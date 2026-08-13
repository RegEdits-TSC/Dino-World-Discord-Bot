# Founder's Park (spec 4c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship battle chapter 7 and expedition site 7 (both keyed `founders_park`), a new `starGate` chapter-gate kind, the campaign's first mythic boss egg, and tightened balance guards.

**Architecture:** `ChapterDef` gains an optional `starGate`; `chapterUnlocked` branches on it instead of the park-rating co-gate, leaving all six shipped chapters byte-identical. Everything else is authored data — a new chapter file, a new site entry, three art files and one emoji — plus the pinned-count updates those force.

**Tech Stack:** TypeScript ESM (NodeNext), vitest, drizzle/better-sqlite3, discord.js, `@napi-rs/canvas`.

## Global Constraints

- **ESM NodeNext**: every relative import carries a `.js` extension.
- **No `Date.now()` / `Math.random()`** in `src/` — time is `ctx.now()`, randomness is `ctx.rng()`.
- **`NPC_LEVEL_SANITY_CAP` is 12 and frozen.** Never raise it. `npcLevel + levelBonus <= 12`.
- **`PARK_TARGET` (40), `COLLECTION_TARGET` (190), `LOT_SLOT_THRESHOLDS`, `LEGACY_TIERS`, and the Explorer achievement tiers `[5,10,20,30]` do not change.**
- **Never author a fixture inside `assets/images/`** — vitest runs files in parallel forks.
- **`npm run build` does not typecheck tests.** The gate is `npm run typecheck`.
- **Authorship**: no AI/Claude/tool attribution in any commit message, code comment, or doc.
- Measured balance values in this plan were produced against the real engine at the stated seed counts. Do not "clean up" a decimal.

---

### Task 1: The `dw_site_founders_park` emoji

**Files:**
- Create: `assets/emojis/svg/dw_site_founders_park.svg`
- Create (generated): `assets/emojis/png/dw_site_founders_park.png`
- Modify: `src/core/emojis.ts` (the `EMOJI_FALLBACK` table)
- Test: `tests/emojis.test.ts`, `tests/emoji-assets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the fallback key `dw_site_founders_park` (unicode `🏛️`), consumed by nothing else in this plan — the site embed looks it up by id at runtime.

- [ ] **Step 1: Update the fallback-name test to expect 53 names**

In `tests/emojis.test.ts`, rename the test and insert the new key into the sorted array. The array is asserted with `.sort()`, so position matters: `dw_site_founders_park` sorts **before** `dw_site_frozen_cliffs` (`fo` < `fr`) and after `dw_site_containment_site`.

```ts
  it('fallback table covers exactly the 53 spec names', () => {
    expect(Object.keys(EMOJI_FALLBACK).sort()).toEqual([
```

and within the array, replace this line:

```ts
      'dw_site_containment_site', 'dw_site_frozen_cliffs', 'dw_site_volcano_core',
```

with:

```ts
      'dw_site_containment_site', 'dw_site_founders_park', 'dw_site_frozen_cliffs', 'dw_site_volcano_core',
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/emojis.test.ts -t "fallback table"`
Expected: FAIL — actual array has 52 entries, missing `dw_site_founders_park`.

- [ ] **Step 3: Add the fallback entry**

In `src/core/emojis.ts`, change:

```ts
  dw_site_abyssal_trench: '🌊', dw_site_containment_site: '🧪',
```

to:

```ts
  dw_site_abyssal_trench: '🌊', dw_site_containment_site: '🧪',
  dw_site_founders_park: '🏛️',
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run tests/emojis.test.ts -t "fallback table"`
Expected: PASS.

- [ ] **Step 5: Author the SVG**

Create `assets/emojis/svg/dw_site_founders_park.svg`. A stone gateway against a sunset, matching the other site markers' flat-shape style.

Three hard constraints, each enforced by `tests/emoji-assets.test.ts`: the image corners must be transparent, at least one pixel in the centre half must be fully opaque, and **no more than 2% of opaque pixels may be pure `#000000`** (`MAX_BLACK_SHARE`). A fourth is a resvg trap, not a test: an `<ellipse>` filled with a gradient using the default `objectBoundingBox` units renders **solid black**. This file uses only `rect` and `polygon`, which are unaffected, and pins `gradientUnits="userSpaceOnUse"` anyway.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="fpStone" x1="0" y1="6" x2="0" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#c4bcac"/>
      <stop offset="1" stop-color="#6f6960"/>
    </linearGradient>
    <linearGradient id="fpSky" x1="0" y1="16" x2="0" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f0b458"/>
      <stop offset="1" stop-color="#8c4a2f"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="32" height="34" fill="url(#fpSky)"/>
  <polygon points="20,50 26,33 31,41 37,29 44,50" fill="#2f3a2c"/>
  <rect x="8" y="12" width="10" height="44" rx="2" fill="url(#fpStone)"/>
  <rect x="46" y="12" width="10" height="44" rx="2" fill="url(#fpStone)"/>
  <rect x="6" y="5" width="52" height="11" rx="2" fill="url(#fpStone)"/>
  <rect x="4" y="54" width="56" height="6" rx="2" fill="#3d4a37"/>
</svg>
```

- [ ] **Step 6: Render the PNG**

Run: `npm run build-emojis`
Expected: writes `assets/emojis/png/dw_site_founders_park.png` at 128×128 with transparency, and leaves every other PNG byte-identical (`git status` should show exactly one new file).

- [ ] **Step 7: Run the emoji asset tests**

Run: `npx vitest run tests/emoji-assets.test.ts`
Expected: PASS. If the black-share guard fails, lighten `#2f3a2c` / `#3d4a37` rather than raising `MAX_BLACK_SHARE`.

- [ ] **Step 8: Commit**

```bash
git add assets/emojis/svg/dw_site_founders_park.svg assets/emojis/png/dw_site_founders_park.png src/core/emojis.ts tests/emojis.test.ts
git commit -m "Add the Founder's Park site emoji"
```

---

### Task 2: Expedition site 7

**Files:**
- Modify: `src/data/sites.ts`
- Modify: `tests/autocomplete-expeditions.test.ts`
- Modify: `tests/expeditions.test.ts:26`
- Modify: `tests/rating.test.ts` (comment only, lines 51-62)

**Interfaces:**
- Consumes: nothing.
- Produces: `EXPEDITION_SITES.founders_park` — required by Task 3, because `battle-content.test.ts` asserts `EXPEDITION_SITES[c.id]` is defined for every chapter and `chaptersPayload` derives the chapter banner from the site key.

- [ ] **Step 1: Write the failing test**

In `tests/autocomplete-expeditions.test.ts`, extend the first test's expectations. Replace:

```ts
    expect(rows.map((r) => r.value)).toEqual(['coastal_dig', 'amber_ridge', 'frozen_cliffs', 'volcano_core',
      'abyssal_trench', 'containment_site']);
```

with:

```ts
    expect(rows.map((r) => r.value)).toEqual(['coastal_dig', 'amber_ridge', 'frozen_cliffs', 'volcano_core',
      'abyssal_trench', 'containment_site', 'founders_park']);
```

and after the `rows[5].name` assertion add:

```ts
    expect(rows[6].name).toBe('🧭 Founder\'s Park — LOCKED, needs ★10.0');
```

In the same file's second test, change:

```ts
    expect(rows.filter((r) => r.name.includes('LOCKED'))).toHaveLength(5);
```

to:

```ts
    expect(rows.filter((r) => r.name.includes('LOCKED'))).toHaveLength(6);
```

In `tests/expeditions.test.ts`, change:

```ts
    expect(listSites(950).length).toBe(6);
```

to:

```ts
    expect(listSites(950).length).toBe(6);
    expect(listSites(1000).map((s) => s.id)).toContain('founders_park');
```

The first line is kept deliberately: it proves the new site is **not** unlocked at 950, which is the gate's whole point. The second is what actually covers it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-expeditions.test.ts tests/expeditions.test.ts`
Expected: FAIL — 6 sites returned, no `founders_park`.

- [ ] **Step 3: Add the site**

In `src/data/sites.ts`, after the `containment_site` entry and before the closing `};`:

```ts
  founders_park: { id: 'founders_park', name: "Founder's Park", unlockRating: 1000, durationMs: 48 * H, cost: 300_000,
    eggOdds: [{ rarity: 'epic', weight: 4 }, { rarity: 'legendary', weight: 90 }, { rarity: 'mythic', weight: 6 }], bonusCash: [50_000, 140_000], bonusFood: [200, 400] },
```

`bonusCash[1]` (140,000) must stay **below** `cost` (300,000) — `docs/gameplay.md` asserts that inequality in prose and nothing tests it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-expeditions.test.ts tests/expeditions.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the stale claim in `tests/rating.test.ts`**

The test at `tests/rating.test.ts:52-62` still passes, but its stated invariant silently stops holding: it pairs the last two `LOT_SLOT_THRESHOLDS` with the two newest sites, and the newest site is now `founders_park` at 1000, which has no lot slot behind it. Do **not** add 1000 to `LOT_SLOT_THRESHOLDS` — that grants an 11th lot slot, an unsimulated balance change. Replace the comment block above the test with:

```ts
  // Abyssal Trench (880) and Containment Site (950) are pinned in two unrelated
  // files with nothing coupling them — progression.ts's gating constants and
  // sites.ts's. The intent is that a gate that deep carries a park-side reward
  // too, so those two lot-slot thresholds must equal those two sites'
  // unlockRating, in campaign order. Both sides read the real exported constants
  // (never a hardcoded 880/950), so this fails the moment either file moves
  // without the other.
  //
  // The pairing deliberately STOPS there. Founder's Park (1000) is the newest
  // site and has no lot-slot threshold behind it, because 1000 is a
  // battle/expedition gate rather than a build gate: LOT_SLOT_THRESHOLDS already
  // tops out at 10 slots, parkRaw already saturates PARK_TARGET at 41 with 10
  // slots, and an 11th slot would be +8 dino capacity and more income at exactly
  // the tier where income is largest. This test therefore names its two sites
  // explicitly and must NOT be generalised to "the newest N sites".
  it('the Abyssal Trench and Containment Site lot-slot thresholds match their sites\' unlockRating', () => {
```

- [ ] **Step 6: Run the rating tests**

Run: `npx vitest run tests/rating.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/sites.ts tests/autocomplete-expeditions.test.ts tests/expeditions.test.ts tests/rating.test.ts
git commit -m "Add the Founder's Park expedition site"
```

---

### Task 3: Chapter art

**Files:**
- Create: `assets/images/sites/founders_park-banner.webp`
- Create: `assets/images/sites/founders_park-thumb.webp`
- Create: `assets/images/battles/boss-founders_park-portrait.webp`
- Modify: `docs/assets/prompts.md`

**Interfaces:**
- Consumes: nothing.
- Produces: three asset files. Task 4 **cannot go green without them** — `tests/images.test.ts` derives its expectations from `CAMPAIGN`, so the moment the chapter is registered these become hard test failures, not runtime degrades.

- [ ] **Step 1: Generate the source images**

Three images are needed. Subject matter, matching the spec's theme (the original park, overrun):

1. **Banner** — a ruined park entrance plaza at golden hour: a cracked stone archway, a toppled welcome sign, vegetation reclaiming the turnstiles, large silhouettes moving beyond the gate. Wide, 3:2.
2. **Thumb** — a tight square crop of the same scene, centred on the archway.
3. **Boss portrait** — Ultimasaurus, "The Last Asset": a heavy armoured apex hybrid, tank build, full body, three-quarter view, on a **transparent background**.

- [ ] **Step 2: Fit the banner**

Run: `node scripts/fit-art.mjs banner <source> assets/images/sites/founders_park-banner.webp`
Expected: 1536×1024 WebP q95.

- [ ] **Step 3: Produce the thumb by hand**

**No `fit-art.mjs` mode produces a site thumb.** Centre-crop the banner source to a square, resize to 1024×1024 with `drawImage` (resize, never squash — do not stretch a 3:2 source into a square), and write WebP q95.

```js
// scratch script, run with: node <file>.mjs
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
const src = await loadImage('<source>');
const side = Math.min(src.width, src.height);
const sx = (src.width - side) / 2, sy = (src.height - side) / 2;
const c = createCanvas(1024, 1024);
c.getContext('2d').drawImage(src, sx, sy, side, side, 0, 0, 1024, 1024);
writeFileSync('assets/images/sites/founders_park-thumb.webp', c.toBuffer('image/webp', 95));
```

- [ ] **Step 4: Produce the boss portrait by hand**

1024×1024, transparent, whole bounding box centred, **24px margin ±1** — i.e. the opaque content spans 976 of 1024 px on its longest axis (`FIT = 976/1024 = 0.953125`), and a single connected alpha region. **Do not use `node scripts/fit-art.mjs cutout`**: it targets a 31px margin and `tests/images.test.ts` will fail the file. Match the existing four boss portraits' pass.

- [ ] **Step 5: Verify the files against the real guards**

Run: `npx vitest run tests/images.test.ts`
Expected: PASS. The new files are not yet referenced by `CAMPAIGN`, so this run proves only that nothing regressed and that every file under `assets/images/` is still WebP. The dimension and margin guards go live in Task 4 — check them now anyway:

```bash
node -e "const {loadImage}=require('@napi-rs/canvas');(async()=>{for(const f of ['assets/images/sites/founders_park-banner.webp','assets/images/sites/founders_park-thumb.webp','assets/images/battles/boss-founders_park-portrait.webp']){const i=await loadImage(f);console.log(f,i.width+'x'+i.height);}})()"
```
Expected: `1536x1024`, `1024x1024`, `1024x1024`.

- [ ] **Step 6: Add the prompt rows**

In `docs/assets/prompts.md`, add a `## Founder's Park (\`founders_park\`)` section alongside the other sites' banner/thumb prompts, and add a `boss-founders_park-portrait.webp` row to the boss-portrait table. Record the portrait's 24px margin explicitly, since it diverges from `fit-art.mjs cutout`'s 31px.

The portrait row is **machine-gated**: `tests/battle-content.test.ts:137-140` asserts every `bossId` appears literally in this file, so the string `boss-founders_park` must be present.

- [ ] **Step 7: Commit**

```bash
git add assets/images/sites/founders_park-banner.webp assets/images/sites/founders_park-thumb.webp assets/images/battles/boss-founders_park-portrait.webp docs/assets/prompts.md
git commit -m "Add Founder's Park banner, thumb, and boss portrait"
```

---

### Task 4: The chapter, the star gate, and every pinned count

This is the atomic flip. Registering the chapter breaks roughly a dozen pinned assertions at once, so they land in one commit; splitting them leaves the suite red between tasks.

**Files:**
- Create: `src/data/battle/chapters/founders_park.ts`
- Modify: `src/data/battle/chapters/index.ts`
- Modify: `tests/battle-content.test.ts`
- Modify: `tests/ranks.test.ts:23` and `tests/battles-autocomplete.test.ts:49` (pinned counts that break the moment the chapter registers)

**Interfaces:**
- Consumes: `EXPEDITION_SITES.founders_park` (Task 2), the three art files (Task 3).
- Produces: `foundersPark: ChapterDef` with `starGate: 75`; `CAMPAIGN` at length 7; `STAGES` at size 35; `ChapterDef.starGate?: number`. Task 5 consumes `starGate` for its reachability simulation, Task 6 for the locked-chapter copy.

- [ ] **Step 1: Write the failing content tests**

In `tests/battle-content.test.ts`, apply all of these:

```ts
    expect(CAMPAIGN.map((c) => c.id)).toEqual(['coastal_dig', 'amber_ridge', 'frozen_cliffs', 'volcano_core', 'abyssal_trench', 'containment_site', 'founders_park']);
```

```ts
    expect(seen.size).toBe(35);
    expect(STAGES.size).toBe(35);
```

```ts
    expect(total).toBe(222);         // pinned — retune deliberately, never by accident
    expect(total).toBeLessThan(500); // margin today: 278
```

Rename the egg test and re-scope its mythic guard. Replace the whole `it('boss eggs ramp …')` body with:

```ts
  it('boss eggs ramp rare -> epic -> legendary onward with pinned bossIds; only the final chapter may pay mythic', () => {
    const bosses = CAMPAIGN.map((c) => c.stages[4].boss!);
    expect(bosses.map((b) => b.eggRarity)).toEqual(['rare', 'epic', 'legendary', 'legendary', 'legendary', 'legendary', 'mythic']);
    expect(bosses.map((b) => b.bossId)).toEqual([
      'boss-coastal_dig', 'boss-amber_ridge', 'boss-frozen_cliffs', 'boss-volcano_core', 'boss-abyssal_trench', 'boss-containment_site', 'boss-founders_park',
    ]);
    expect(bosses.slice(0, 3).map((b) => b.eggSpeciesId)).toEqual([null, null, null]);
    expect(bosses[3].eggSpeciesId).toBe('tyrannosaurus');
    expect(bosses[4].eggSpeciesId).toBe('mosasaurus');
    expect(bosses[5].eggSpeciesId).toBe('spinoraptor');
    expect(bosses[6].eggSpeciesId).toBe('ultimasaurus');
    // Mythic boss eggs are reserved for the campaign's final chapter. This used to be a
    // blanket ban (volcano_core.ts recorded the reasoning: a mythic trophy would undercut
    // the 500-shard purchase). Founder's Park reverses it deliberately — the egg is a
    // one-shot behind a 75-star gate AND a cleared chapter 6, a far higher bar than 500
    // shards, and it is the only reward class left that escalates over chapter 6's pinned
    // legendary. Scoping rather than deleting is what stops chapter 8 quietly shipping a
    // second one and turning the top reward into the default one.
    for (const b of bosses.slice(0, -1)) expect(b.eggRarity).not.toBe('mythic');
  });
```

Add the four gating cases to the `describe('battle gating')` block:

```ts
  // Seeds `total` stars across chapters 1-6 ONLY — never founders_park's own stages, which
  // are unreachable until it unlocks. `bossCleared` controls the other half of the gate.
  const seedStars = (total: number, bossCleared: boolean): ProgressMap => {
    const entries: Record<string, { stars: number; firstClearedAt: number | null }> = {};
    let left = total;
    if (bossCleared) {
      entries.containment_site_boss = { stars: 3, firstClearedAt: 1_000 };
      left -= 3;
    }
    for (const c of CAMPAIGN.slice(0, 6)) {
      for (const s of c.stages) {
        if (s.id === 'containment_site_boss' || left <= 0) continue;
        const give = Math.min(3, left);
        entries[s.id] = { stars: give, firstClearedAt: 1_000 };
        left -= give;
      }
    }
    expect(left, `could not seed ${total} stars across chapters 1-6`).toBe(0);
    return prog(entries);
  };

  it('a star-gated chapter opens on campaign stars, not park rating', () => {
    expect(chapterUnlocked('founders_park', seedStars(74, true), 1_000)).toBe(false);
    expect(chapterUnlocked('founders_park', seedStars(75, true), 1_000)).toBe(true);
    // The whole point of the split: rating is irrelevant to the chapter gate, so a
    // battle-heavy player with a modest park still gets in.
    expect(chapterUnlocked('founders_park', seedStars(75, true), 0)).toBe(true);
  });

  it('a star-gated chapter still requires the previous boss first-clear', () => {
    expect(chapterUnlocked('founders_park', seedStars(75, false), 1_000)).toBe(false);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/battle-content.test.ts`
Expected: FAIL — `CAMPAIGN` has 6 entries, `STAGES.size` is 30, shard total is 177, `founders_park` is an unknown chapter.

- [ ] **Step 3: Add `starGate` to `ChapterDef` and branch `chapterUnlocked`**

In `src/data/battle/chapters/index.ts`, replace the `ChapterDef` interface and its comment:

```ts
// id MUST equal an EXPEDITION_SITES key — this single invariant derives the
// banner asset and the theme, and (for every chapter that does NOT set
// starGate) the unlockRating co-gate as well.
export interface ChapterDef {
  id: string; name: string; tagline: string; stages: StageDef[];
  // Absolute campaign-star total. When set, it REPLACES the site's unlockRating
  // co-gate for this chapter — see chapterUnlocked. Deliberately absolute and
  // never a fraction of the campaign total: a fraction would silently re-tighten
  // on existing players every time a chapter ships.
  starGate?: number;
}
```

and replace `chapterUnlocked`:

```ts
export function chapterUnlocked(chapterId: string, progress: ProgressMap, ratingHighWater: number): boolean {
  const idx = CAMPAIGN.findIndex((c) => c.id === chapterId);
  if (idx < 0) return false;
  if (idx === 0) return true;
  const chapter = CAMPAIGN[idx];
  const prior = CAMPAIGN[idx - 1];
  const priorBoss = prior.stages[prior.stages.length - 1];
  if ((progress.get(priorBoss.id)?.firstClearedAt ?? null) === null) return false;
  // Two gate kinds. A star gate is used where a rating gate would be gameable:
  // recomputeRating's comfort term averages over ASSIGNED dinos only, so
  // unassigning all but one well-kept dino sets that quarter to 1.0 at will.
  // Stars cannot be shuffled — they are earned per stage and monotone.
  // Summing the whole progress map is safe: a chapter's own stages are
  // unreachable until it unlocks, so "all stars" and "stars before this
  // chapter" are the same number at the moment this is evaluated.
  if (chapter.starGate != null) {
    const stars = [...progress.values()].reduce((sum, p) => sum + p.stars, 0);
    return stars >= chapter.starGate;
  }
  return siteUnlocked(EXPEDITION_SITES[chapterId].unlockRating, ratingHighWater);
}
```

- [ ] **Step 4: Create the chapter file**

Create `src/data/battle/chapters/founders_park.ts`:

```ts
import type { ChapterDef } from './index.js';

// Chapter 7 — Founder's Park. The ORIGINAL park, the one everything escaped from,
// now fully overrun: its own headline attractions gone feral, with the lab's last
// asset at the centre. Gated on campaign STARS (75), not park rating — see
// chapterUnlocked. The chapter escalates on theme and reward, not on difficulty.
export const foundersPark: ChapterDef = {
  id: 'founders_park',
  name: "Founder's Park",
  tagline: 'The first park. Everything that ever got out has come home.',
  starGate: 75,
  stages: [
    {
      id: 'founders_park_1', name: 'The Turnstiles', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'therizinosaurus' }, { speciesId: 'pachyrhinosaurus' }, { speciesId: 'spinosaurus' }],
      rewards: { cash: 1_000, xp: 300 }, firstClearShards: 7,
    },
    {
      id: 'founders_park_2', name: 'Collapsed Aviary', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'pachyrhinosaurus' }, { speciesId: 'spinosaurus' }, { speciesId: 'quetzalcoatlus' }],
      rewards: { cash: 1_150, xp: 325 }, firstClearShards: 7,
    },
    {
      id: 'founders_park_3', name: 'The Lagoon Walk', energyCost: 1, npcLevel: 12,
      enemies: [{ speciesId: 'therizinosaurus' }, { speciesId: 'deinosuchus' }, { speciesId: 'spinosaurus' }],
      rewards: { cash: 1_300, food: { foodId: 'prime_steak', qty: 4 }, xp: 350 }, firstClearShards: 7,
    },
    {
      id: 'founders_park_4', name: "Founder's Statue", energyCost: 2, npcLevel: 12,
      enemies: [{ speciesId: 'giganotosaurus' }, { speciesId: 'spinosaurus' }, { speciesId: 'tyrannosaurus' }],
      rewards: { cash: 1_500, xp: 385 }, firstClearShards: 8,
    },
    {
      id: 'founders_park_boss', name: 'The Last Asset', energyCost: 3, npcLevel: 11,
      enemies: [{ speciesId: 'spinosaurus' }, { speciesId: 'giganotosaurus' }, { speciesId: 'ultimasaurus' }],
      rewards: { cash: 1_750, food: { foodId: 'prime_steak', qty: 6 }, xp: 430 }, firstClearShards: 16,
      boss: {
        // Measured with tests/battle-balance.test.ts's own harness (3x level-capped
        // tyrannosaurus; the probe reproduced Abyssal Trench 0.9127 and Containment Site
        // 0.8750 to 4 dp before any of these were taken):
        //   untraited @3,000 seeds  0.8330   (floor 0.40; ladder allows <= 0.8850)
        //   savage    @400          1.0000   (floor 0.85)
        //   Blood Moon savage @400  0.9250   (floor 0.85)
        //   fleet 0.8725 · ironhide 0.9200 · glass_cannon 0.9975 · strongest 1.0000 (savage)
        // Note the strongest trait INVERTS versus Containment Site, where fleet was the
        // ceiling (0.9987) and savage only 0.9827: a 731 HP boss with atkMult 1.10 rewards
        // raw damage, where a 1.72x-HP boss rewarded acting first.
        //
        // THREE THINGS A FUTURE TUNER MUST KNOW ABOUT THIS BOSS.
        //
        // 1. The escorts are epic ON PURPOSE and must stay epic. Legendary escorts make
        //    this stage unwinnable at EVERY multiplier: with tyrannosaurus + spinoraptor,
        //    all 209 cells of hpMult 0.30..1.20 x atkMult 0.80..1.30 fail all three floors
        //    at once (best: 0.0257 untraited against a 0.40 floor). A legendary bruiser at
        //    L11 is 477/121/42/82 — strictly stronger than a level-capped PLAYER dino
        //    (455/116/40/79) on every stat — in front of a 974 HP / 107 DEF mythic tank.
        //    The only cells that satisfy the floors sit at hpMult 0.09-0.13, i.e. a 107 HP
        //    finale boss: an hpMult chosen to defeat a test. Mythic escorts (indominus +
        //    indoraptor) measure 0.0000 on every metric at every grid point.
        //
        // 2. hpMult is NOT monotone in difficulty below 0.33727. resolveBattle focus-fires
        //    the lowest-HP live enemy; boss HP is round(974 * hpMult) and each epic escort
        //    is 329, so below that crossover the BOSS is the lowest-HP enemy, gets focused
        //    from round 1, and the win rate RISES as hpMult falls (measured at atkMult 3.0
        //    to make it visible: 0.3113 at 0.3372, 0.5710 at 0.30, 0.8470 at 0.20). 0.75
        //    sits 2.22x above the crossover and the 0.70-0.80 sweep is strictly monotone at
        //    about -0.017 per +0.01. A future author cutting HP to compensate for a world
        //    event — following the "HP is the exposure knob" rule — could walk under 0.34
        //    and produce a boss that gets EASIER as they make it tankier. Nothing in the
        //    suite would catch it: the whole sub-crossover region reads 1.0000.
        //
        // 3. Escort species affects combat ONLY through (rarity, archetype). spinoraptor +
        //    spinoraptor measured identical to 4 dp against tyrannosaurus + spinoraptor.
        //    Swapping escort species changes the embed text and the enemy art and nothing
        //    else — the combat twin of "art is keyed on archetype x diet, never species".
        //
        // atkMult 1.10 is deliberately ABOVE 1.0: exposure (hpMult) does all the work here,
        // per the exposure-knob/threat-knob rule. npcLevel 11 + levelBonus 1 = 12 is exactly
        // at NPC_LEVEL_SANITY_CAP, with zero headroom — that cap does not move.
        //
        // The campaign's first mythic boss egg, pinned to the boss's own species. It is a
        // ONE-SHOT (service.ts grants it on firstClear only), which is why it is pinned
        // rather than rolled: there is no repeat attempt for a spread to pay off over.
        bossId: 'boss-founders_park', title: 'The Last Asset', speciesId: 'ultimasaurus',
        levelBonus: 1, hpMult: 0.75, atkMult: 1.10, eggRarity: 'mythic', eggSpeciesId: 'ultimasaurus',
      },
    },
  ],
};
```

- [ ] **Step 5: Register the chapter**

In `src/data/battle/chapters/index.ts`, add the import after the `containmentSite` import:

```ts
import { foundersPark } from './founders_park.js';
```

and extend `CAMPAIGN`:

```ts
export const CAMPAIGN: ChapterDef[] = [coastalDig, amberRidge, frozenCliffs, volcanoCore, abyssalTrench, containmentSite, foundersPark];
```

- [ ] **Step 6: Run the content tests**

Run: `npx vitest run tests/battle-content.test.ts`
Expected: PASS, including the untouched guards — `NPC_LEVEL_SANITY_CAP`, monotone rewards per stage position, boss authored as `enemies[2]`, and `boss-founders_park` present in `docs/assets/prompts.md` (Task 3 put it there).

- [ ] **Step 7: Close the two remaining pinned counts so the suite goes green**

Registering the chapter also breaks two counts in unrelated files. Fix them here rather than leaving the suite red between tasks.

In `tests/ranks.test.ts:23`:

```ts
    expect(legacyMaxPoints()).toBe(205);      // 52 + 48 + 105 on today's content
```

In `tests/battles-autocomplete.test.ts:49`, the comment "all 30 entries" → "all 35 entries".

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS, every file — including `tests/images.test.ts`, whose portrait and site-image guards derive from `CAMPAIGN` and are now checking Task 3's three files for real, and `tests/battle-balance.test.ts`, which still passes unchanged at this point (chapter 7's 0.8330 clears the old 0.03 ladder tolerance and its strongest loadout of 1.0000 clears the old ≥0.995 pin — Task 5 tightens both deliberately, not to repair a break).

If any other file fails on a pinned count, fix the number here and note it — the audit did not predict it, and that is worth knowing.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/data/battle/chapters/founders_park.ts src/data/battle/chapters/index.ts tests/battle-content.test.ts tests/ranks.test.ts tests/battles-autocomplete.test.ts
git commit -m "Add battle chapter 7, Founder's Park, gated on campaign stars"
```

---

### Task 5: Balance guards

**Files:**
- Modify: `tests/battle-balance.test.ts`

**Interfaces:**
- Consumes: `CAMPAIGN[6]` and its `starGate` (Task 4).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Tighten the ladder tolerance**

Replace the `TOLERANCE` line and extend the comment block above the ladder test:

```ts
  it('untraited win rates are non-increasing across the campaign, at 3,000 seeds', () => {
    const LADDER_SEEDS = 3000;
    const TOLERANCE = 0.01;
```

Append to that test's comment block:

```ts
  // Tolerance tightened 0.03 -> 0.01 with chapter 7. 0.03 would MISS a revert of Abyssal
  // Trench's hpMult 0.82 -> 0.78, a +0.0203 inversion; 0.01 catches it with 2x margin and
  // costs nothing, because the largest positive adjacent delta across shipped content at
  // 3,000 seeds is exactly 0.0000 (measured: 1.0000, 1.0000, 1.0000, 0.9173, 0.9127,
  // 0.8750, 0.8330).
  //
  // The seed count is pinned DOWN, not up, and this is the reason: at 10,000 seeds the
  // Volcano Core -> Abyssal Trench pair INVERTS by +0.0100 on shipped content (Volcano
  // 0.9064, Abyssal 0.9164). 4b's Abyssal fix holds at 3,000 and fails at 10,000. Raising
  // the seed count is therefore a CONTENT decision — it would require re-tuning two live
  // bosses together — not a free rigour upgrade. Do not raise it casually.
```

- [ ] **Step 2: Replace the finale pin with a two-sided change detector**

Delete the existing `it(`${FINALE.name} boss (the current finale): the strongest traited squad's win rate is pinned`, …)` test and put this in its place:

```ts
  // CHANGE DETECTOR, not a correctness bound. It fails on any movement in EITHER
  // direction, which is the point: a moved number must be re-measured and re-approved,
  // never merged silently. A one-sided bound could only ever catch half of that, and the
  // >=0.995 lower bound this replaces had the additional problem of reading as a demand
  // that the finale be EASY — a genuinely harder future finale would fail it and the
  // failure would look like the good content was the defect.
  //
  // It measures the UNTRAITED rate rather than the strongest loadout, and that choice is
  // forced. Founder's Park measures 1.0000 on the strongest-of-four axis — the saturated
  // maximum — so RECORDED + BAND is unreachable there by construction and the detector
  // would silently degenerate into the same one-sided bound. The untraited rate is
  // non-degenerate in both directions, and a +/-0.01 band is strictly tighter than the
  // ladder's implied <= 0.8850, so this is not merely a restatement of the assertion
  // above it either.
  //
  // Strongest-loadout figures for the record, measured at 400 seeds and NOT asserted on:
  // savage 1.0000, glass_cannon 0.9975, ironhide 0.9200, fleet 0.8725. Which trait is
  // strongest is chapter-dependent — on Containment Site it was fleet (0.9987) with savage
  // at 0.9827, and it inverts here. That is exactly why a strongest-loadout pin is a weak
  // instrument. frail is excluded from COMBAT_TRAITS throughout because it is strictly
  // worse than fielding no combat trait at all (measured 0.5775).
  const DETECTOR_BAND = 0.01;
  const FINALE_UNTRAITED = 0.8330;      // founders_park_boss, untraited, 3,000 seeds
  const CONTAINMENT_UNTRAITED = 0.8750; // containment_site_boss, untraited, 3,000 seeds

  it(`${FINALE.name} boss (the current finale): untraited rate is pinned within ±${DETECTOR_BAND}`, () => {
    const rate = winRate(FINALE.stages[4], [], 3000);
    const msg = `CHANGE DETECTOR: the finale's untraited rate is ${rate}, recorded as ${FINALE_UNTRAITED}. `
      + 'Re-measure at 3,000 seeds and update the recorded constant deliberately. Do not widen the band.';
    expect(rate, msg).toBeGreaterThanOrEqual(FINALE_UNTRAITED - DETECTOR_BAND);
    expect(rate, msg).toBeLessThanOrEqual(FINALE_UNTRAITED + DETECTOR_BAND);
  });

  // Pinned by id, NOT derived. The test above follows CAMPAIGN's last chapter, so the
  // moment a chapter ships it stops measuring the previous one — chapter 6 would have
  // become entirely unmeasured, with the suite green and the guard silently gone. Every
  // future chapter needs the same treatment for its predecessor.
  it('Containment Site boss (chapter 6) stays measured after the finale moved past it', () => {
    const stage = CAMPAIGN.find((c) => c.id === 'containment_site')!.stages[4];
    const rate = winRate(stage, [], 3000);
    const msg = `CHANGE DETECTOR: chapter 6's untraited rate is ${rate}, recorded as ${CONTAINMENT_UNTRAITED}.`;
    expect(rate, msg).toBeGreaterThanOrEqual(CONTAINMENT_UNTRAITED - DETECTOR_BAND);
    expect(rate, msg).toBeLessThanOrEqual(CONTAINMENT_UNTRAITED + DETECTOR_BAND);
  });
```

- [ ] **Step 3: Add the star-gate reachability simulation**

Add `starsFor` to the existing `resolve.js` import at the top of the file:

```ts
import { resolveBattle, starsFor, type Combatant } from '../src/data/battle/resolve.js';
```

and append this `describe` block at the end of the file:

```ts
// A starGate is authored data that can be wrong in a way nothing else catches: too high and
// the chapter is content nobody can ever open. The structural bound (3 stars x 5 stages x
// chapters-before-it = 90 for chapter 7) is far too loose to be worth asserting, because the
// campaign's real maximum is 87 — starsFor awards the third star only for squadKos === 0, and
// three bosses never produce a flawless win against a level-capped legendary squad. Three
// further stages 3-star only at sub-1% rates, putting the practical no-grind floor at 81.
// So this SIMULATES the ceiling instead of assuming it, and keeps a margin so that a future
// boss retune costing one deterministic 3-star cannot silently strand the gate.
describe('star gates are reachable', () => {
  const MARGIN = 5;

  // Best stars any legal loadout can take on this stage. Returns early on the first 3, so
  // the deterministic majority of stages cost one seed rather than 1,600.
  function bestStars(stage: StageDef, runs = 400): number {
    let best = 0;
    for (const trait of COMBAT_TRAITS) {
      for (let seed = 0; seed < runs; seed++) {
        const r = resolveBattle(squadOf('tyrannosaurus', [trait]), npcsOf(stage), mulberry32(seed));
        if (r.won) best = Math.max(best, starsFor(r));
        if (best === 3) return 3;
      }
    }
    return best;
  }

  it('every starGate leaves at least MARGIN stars of headroom over what is achievable before it', () => {
    const gated = CAMPAIGN.filter((c) => c.starGate != null);
    expect(gated.length, 'no chapter sets starGate — delete this test or the field').toBeGreaterThan(0);
    for (const chapter of gated) {
      const idx = CAMPAIGN.findIndex((c) => c.id === chapter.id);
      const achievable = CAMPAIGN.slice(0, idx)
        .flatMap((c) => c.stages)
        .reduce((sum, st) => sum + bestStars(st), 0);
      expect(
        chapter.starGate!,
        `${chapter.id}: starGate ${chapter.starGate} against ${achievable} achievable in chapters 1-${idx} `
          + `(need <= ${achievable - MARGIN} to keep ${MARGIN} stars of margin)`,
      ).toBeLessThanOrEqual(achievable - MARGIN);
    }
  });
});
```

> **Correction (post-implementation):** the code block above and the line below both quote
> 87 as the achievable-stars figure — this plan's own 3,000-seed number. The test as shipped
> computes it at 400 seeds instead and gets **85**, not 87: two sub-1% stages
> (`abyssal_trench_3`/`_4`, 0.058% each) are close enough to a coin flip across that smaller
> sample that it misses both. 75 still clears with margin either way; see
> `tests/battle-balance.test.ts`'s own comment for the full reasoning. Treat 87 in this plan
> as superseded by the shipped 85.

- [ ] **Step 4: Run the balance tests**

Run: `npx vitest run tests/battle-balance.test.ts`
Expected: PASS. Founder's Park should measure 0.8330 untraited, Containment Site 0.8750, and the reachability test should report 87 achievable against a gate of 75.

If the ladder or a detector fails, **re-measure and update the recorded constant deliberately** — do not widen a band or loosen the tolerance to make it pass.

- [ ] **Step 5: Commit**

```bash
git add tests/battle-balance.test.ts
git commit -m "Tighten the boss ladder and make the finale guard a change detector"
```

---

### Task 6: Gate-aware locked-chapter copy

**Files:**
- Modify: `src/modules/battles/embeds.ts` (the `tagline` line in `chaptersPayload`)
- Test: `tests/battles-embeds.test.ts`

**Interfaces:**
- Consumes: `ChapterDef.starGate` (Task 4), `ChaptersView.progress` (already in scope).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

Add to `tests/battles-embeds.test.ts`:

```ts
  it('a locked star-gated chapter names the star requirement and the player\'s own progress', () => {
    const view: ChaptersView = {
      progress: new Map([['coastal_dig_1', { stars: 2, firstClearedAt: 1 }]]),
      ratingHighWater: 1_000, energy: 10, energyUpdatedAtMs: 0, now: 0,
    };
    const idx = CAMPAIGN.findIndex((c) => c.id === 'founders_park');
    const desc = chaptersPayload('u1', idx, view).embeds![0].toJSON().description!;
    expect(desc).toContain('2/75 campaign stars');
    expect(desc).not.toContain('park rating');
  });

  it('a locked rating-gated chapter still names park rating', () => {
    const view: ChaptersView = {
      progress: new Map(), ratingHighWater: 0, energy: 10, energyUpdatedAtMs: 0, now: 0,
    };
    const idx = CAMPAIGN.findIndex((c) => c.id === 'volcano_core');
    const desc = chaptersPayload('u1', idx, view).embeds![0].toJSON().description!;
    expect(desc).toContain('park rating');
    expect(desc).not.toContain('campaign stars');
  });
```

Add whatever imports the file is missing (`CAMPAIGN` from `../src/data/battle/chapters/index.js`, and `ChaptersView` / `chaptersPayload` from `../src/modules/battles/embeds.js` if not already imported).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/battles-embeds.test.ts -t "star-gated"`
Expected: FAIL — the description says "raise your park rating" for both chapters.

- [ ] **Step 3: Make the locked copy gate-aware**

In `src/modules/battles/embeds.ts`, replace:

```ts
  const tagline = unlocked ? ch.tagline
    : `${ch.tagline}\n\n🔒 Locked — beat the previous chapter's boss and raise your park rating.`;
```

with:

```ts
  // Two gate kinds now (see chapterUnlocked), and the copy has to follow the gate rather
  // than assume rating: for a star-gated chapter, "beat the previous boss" is already done
  // — it is a precondition of even reaching this state — and raising park rating does
  // nothing at all, so the one surface that explains the lock would be telling the reader
  // to do the only thing that cannot unlock it. Reads ch.starGate directly; never keep a
  // second copy of the number here.
  const lockLine = ch.starGate != null
    ? `🔒 Locked — earn ${[...view.progress.values()].reduce((sum, p) => sum + p.stars, 0)}/${ch.starGate} campaign stars.`
    : '🔒 Locked — beat the previous chapter\'s boss and raise your park rating.';
  const tagline = unlocked ? ch.tagline : `${ch.tagline}\n\n${lockLine}`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/battles-embeds.test.ts`
Expected: PASS, including the existing F1/F4 frame-contract test, which this does not touch.

- [ ] **Step 5: Commit**

```bash
git add src/modules/battles/embeds.ts tests/battles-embeds.test.ts
git commit -m "Show the star requirement on a locked star-gated chapter"
```

---

### Task 7: Comments and doc numbers that went false

Several comments now assert the opposite of what ships. These are not cosmetic: each one is load-bearing advice that would mislead the next author.

**Files:**
- Modify: `src/data/battle/chapters/volcano_core.ts`, `abyssal_trench.ts`, `containment_site.ts`
- Modify: `src/modules/park/ranks.ts`, `src/modules/battles/index.ts`, `src/modules/help/index.ts`
- Modify: `tests/ranks.test.ts`, `tests/battles-autocomplete.test.ts`
- Modify: `README.md`, `docs/gameplay.md`, `docs/ops.md`, `docs/assets/prompts.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing.

- [ ] **Step 1: Fix the remaining stale comments in the test files**

The numeric assertions were fixed in Task 4; these are the prose around them.

In `tests/ranks.test.ts`, the comment block near line 75: "reaches all 190 possible points" → "reaches all 205 possible points".

In `tests/battle-content.test.ts:102`, the margin comment: "margin today: 323" → "margin today: 278" (if Task 4 did not already carry it).

In `tests/daily-content.test.ts`, above the Explorer tier assertions, record that the top tier deliberately no longer equals the stage count:

```ts
  // Explorer's platinum tier (30) used to equal STAGES.size exactly. At 35 stages it is
  // 86% of the campaign, and that is deliberate: raising it would take a claimable tier
  // away from any player sitting between 30 and 34 first-clears, the same demotion pattern
  // LEGACY_TIERS is frozen to avoid. Explorer is a breadth track, not a completionist one.
```

- [ ] **Step 2: Run those tests**

Run: `npx vitest run tests/ranks.test.ts tests/daily-content.test.ts tests/battle-content.test.ts`
Expected: PASS.

- [ ] **Step 3: Fix the three chapter-file comments that now assert the opposite of what ships**

`src/data/battle/chapters/volcano_core.ts` — the line reading "never mythic, which would undercut the 500-shard mythic purchase" must be replaced, not deleted:

```ts
// Boss eggs stay below mythic through chapter 6, so a trophy egg never undercuts the
// 500-shard mythic purchase. Chapter 7 (founders_park) is the deliberate exception and
// the ONLY one — see its boss comment, and the scoped guard in
// tests/battle-content.test.ts's boss-egg test.
```

`src/data/battle/chapters/abyssal_trench.ts` — the header comment says "a mythic-base boss is unwinnable rather than hard". That was true when written, because the sub-1.0 `hpMult` convention did not exist yet. Re-anchor it:

```ts
// The boss is legendary-base on purpose: at the multipliers available when this chapter
// shipped, a mythic-base boss was unwinnable rather than hard. That is no longer true in
// general — chapter 7 fields a mythic tank at hpMult 0.75 — but it remains true for THIS
// boss's tuning, and the two files should not be read as contradicting each other.
```

In the same file, "The two late bosses must be tuned together" → "The three late bosses (chapters 5, 6 and 7) must be tuned together — the 3,000-seed monotone ladder couples all of them."

`src/data/battle/chapters/containment_site.ts` — "This is the campaign's current finale (CAMPAIGN's last chapter)" → "This is chapter 6. It was the campaign's finale until Founder's Park shipped; tests/battle-balance.test.ts now pins it by id so it stays measured."

- [ ] **Step 4: Fix `ranks.ts`, whose comment invites a live-player demotion**

In `src/modules/park/ranks.ts`, update the ceiling arithmetic ("52 species + 48 achievement tiers + 90 battle stars = 190" → "… + 105 battle stars = 205"), the tier fractions (`7.9 / 18.4 / 34.2 / 52.6 / 73.7 / 89.5%` → `7.3 / 17.1 / 31.7 / 48.8 / 68.3 / 82.9%`), and Director's share (89.5% → 82.9%).

Then replace the sentence "Discharging this needs a monotone `users.legacyRankBest`, not a threshold edit." — 4b **shipped** that column and it does **not** discharge the debt:

```ts
 * legacyRankBest (shipped in 4b) does NOT discharge this. It stores POINTS, and legacyRank
 * resolves tierForPoints(max(stored, computed)), so raising a threshold re-resolves against
 * the new table and demotes a live Director anyway. The column protects against the computed
 * total DROPPING, which is a different failure. The thresholds stay frozen; Director's share
 * of the ceiling is expected to keep sliding as content ships, and that is the correct
 * outcome, not a regression to fix.
```

- [ ] **Step 5: Fix the two `src/modules` comments and the help copy**

`src/modules/battles/index.ts` — the autocomplete comment "the campaign now has 30 stages":

```ts
          // Newest chapter first: respondRanked slices at 25 and the campaign now has 35
          // stages, so emission order decides what a player sees on an empty query. Old
          // cleared chapters are the cheapest to recover by typing; the frontier is not.
          // At 35 stages this now drops the two EARLIEST chapters from a fully-unlocked
          // player's empty query, where it used to drop one. Accepted, and compounding —
          // chapter 8 makes it three.
```

`src/modules/help/index.ts` — three body strings (these are topic bodies, **not** builder strings, so they do **not** force `npm run deploy-commands`):

- the expeditions site chain gains ` → Founder's Park (48h)`
- "6 chapters themed to the expedition sites" → "7 chapters themed to the expedition sites"
- "its expedition site's rating gate applies too" → "the last chapter opens on campaign stars instead; every earlier one also needs its expedition site's rating gate"

- [ ] **Step 6: Sweep the docs**

Run each of these and update every hit:

```bash
grep -rn "six chapters\|all six chapters\|30 stages\|six sites" README.md docs/gameplay.md
grep -rn "\b177\b\|\b190\b\|up to 90\|max 90\|14.7%" docs/gameplay.md CLAUDE.md
grep -rn "No boss ever drops a Mythic egg" docs/gameplay.md
grep -rn "only sites that can ever drop a Legendary or Mythic" docs/gameplay.md
grep -rn "\b52\b" docs/ops.md docs/assets/prompts.md
grep -rn "six boss portraits\|all six\|the two endgame sites" docs/assets/prompts.md
```

Required outcomes: chapters 6→7, sites 6→7, stages 30→35, campaign shards 177→222, campaign stars 90→105, legacy ceiling 190→205, `CLAUDE.md`'s "14.7% of the 190 ceiling" → "13.7% of the 205 ceiling", emoji count 52→53 (two occurrences on one line in `docs/ops.md`). Add the site row, the egg-odds row, the chapter row, and the boss trophy-egg row to `docs/gameplay.md`, and describe the star gate there as a distinct gate kind. State that the mythic trophy egg is **untradeable**, unlike every prior boss egg.

Two `docs/gameplay.md` statements go outright **false** and must be rewritten, not merely extended: "No boss ever drops a Mythic egg", and the claim that Volcano Core / Abyssal Trench / Containment Site are the only sites that can drop a Legendary or Mythic egg.

Also update `CLAUDE.md`'s battles bullet: chapter 7 required an engine change, so the "future chapters ship as data-only PRs with zero engine changes" promise and the "`unlockRating` co-gate" description are both now qualified.

**Do not change**: `COLLECTION_TARGET`'s 190 in `docs/gameplay.md` or `CLAUDE.md` (a different number that coincides), the `LEGACY_TIERS` threshold table, `docs/ops.md`'s command count, or anything under `docs/superpowers/**`.

- [ ] **Step 7: Verify**

Run: `npm test`
Expected: PASS, all files.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Update every count, comment, and doc statement the seventh chapter moved"
```

---

### Task 8: Full verification and ship

**Files:** none modified.

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: a verified branch and the operator handoff.

- [ ] **Step 1: Run the whole gate**

```bash
npm test
npm run typecheck
npm run build
```
Expected: all three clean. `npm run build` compiles `src` only; `npm run typecheck` is the test-inclusive gate and is the one that catches a stale type in `tests/`.

- [ ] **Step 2: Confirm nothing stray is committed**

```bash
git status -sb
ls scripts/
```
Expected: clean tree, and `scripts/` back to its committed files — no `_probe.ts`, `_sim_*.ts`, or scratch fitting script left behind. Anything under `scripts/` is inside `tsconfig.test.json`'s `include` and would break `npm run typecheck` for the next person.

- [ ] **Step 3: Sanity-check the new content end to end**

```bash
node -e "
const {CAMPAIGN,STAGES}=require('./dist/data/battle/chapters/index.js');
const {EXPEDITION_SITES}=require('./dist/data/sites.js');
console.log('chapters',CAMPAIGN.length,'stages',STAGES.size);
console.log('sites',Object.keys(EXPEDITION_SITES).length);
console.log('shards',CAMPAIGN.flatMap(c=>c.stages).reduce((s,x)=>s+x.firstClearShards,0));
console.log('stars',CAMPAIGN.reduce((s,c)=>s+c.stages.length*3,0));
console.log('starGate',CAMPAIGN[6].starGate);
"
```
Expected: `chapters 7 stages 35`, `sites 7`, `shards 222`, `stars 105`, `starGate 75`.

- [ ] **Step 4: Operator steps — run on the live host, in this order**

```bash
# 1. back up the DB first — the path is DB_PATH in .env (default ./data/dino.db)
mkdir -p backups/2026-08-13-pre-4c && cp "$DB_PATH" backups/2026-08-13-pre-4c/

# 2. build BEFORE restart — the bot runs compiled dist/
npm run build

# 3. IRREVERSIBLE. Additive for this change (one new emoji, nothing deleted).
npm run deploy-emojis
git add assets/emojis/manifest.json && git commit -m "Record the deployed emoji manifest"

# 4. restart the bot — exactly one process per token; the emoji map loads at ClientReady

# 5. cosmetic gallery, REST-only, safe to run while live
npm run test:live
```

`npm run deploy-commands` is **not** required: no new module, command, option or subcommand, no new `HELP_TOPICS` key, and both affected surfaces are `.setAutocomplete(true)` runtime providers rather than `addChoices`. The one way to force it accidentally is editing a builder *string* — most plausibly `src/modules/expeditions/index.ts`'s `'Dig site — locked ones show their star requirement'`, where "star" means ★rating and now reads ambiguously against the chapter's battle-star gate. **Leave that string alone.**

The irreversibility in step 3 is not the POST — it is the **manifest**. If `assets/emojis/manifest.json` is lost or left uncommitted, the next run sees every hash as changed and DELETEs + re-POSTs all 53 emojis with fresh snowflake ids, permanently breaking every `<:dw_cash:OLD_ID>` already sitting in chat history, unrecoverable by rerunning. Commit it immediately, and **do not touch any existing SVG in this change**.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin founders-park-4c
gh pr create --title "Founder's Park: a star-gated seventh chapter and its expedition site" --body "$(cat <<'EOF'
Adds battle chapter 7 and expedition site 7, both keyed `founders_park`, closing the
campaign at seven chapters.

- **New gate kind.** `ChapterDef.starGate` — the chapter opens on 75 campaign stars
  rather than park rating, because the rating gate is bypassable: `recomputeRating`'s
  comfort term averages over assigned dinos only. The site keeps a rating gate at 1000,
  so a player who never battles still gets the expedition.
- **First mythic boss egg**, pinned to Ultimasaurus. Reverses a recorded economy
  decision deliberately; the guard is re-scoped rather than deleted, so no later
  chapter can ship a second one by accident.
- **Boss numbers measured, not assumed.** `hpMult 0.75 / atkMult 1.10` against epic
  escorts: untraited 0.8330 at 3,000 seeds, savage 1.0000, Blood Moon savage 0.9250.
  Legendary escorts were tried first and are unshippable at every one of 209 grid cells.
- **Balance guards tightened.** Ladder tolerance 0.03 → 0.01 (seeds deliberately stay at
  3,000 — 10,000 inverts on shipped content); the finale pin becomes a two-sided change
  detector; chapter 6 gains its own id-pinned guard so it stays measured.

No schema change, no migration, no new species, no new command. `deploy-commands` is not
required; `deploy-emojis` is, and it is the only irreversible step.
EOF
)"
```

Note for whoever merges: `gh pr merge` fails its local step when run from a git worktree while still merging on GitHub — verify with `gh pr view` rather than trusting the exit code.
