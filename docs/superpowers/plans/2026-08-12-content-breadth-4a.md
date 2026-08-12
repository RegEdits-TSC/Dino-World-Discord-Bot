# Content Breadth 4a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the roster from 42 to 52 species so every non-containment biome spans common → epic, and the trait table from 14 to 20 so all four domains hold exactly 5.

**Architecture:** Two data tables grow and four new guard tests pin the properties that growth is supposed to buy. No engine code changes. No migration, no command builder change, no art, no emoji. Every other edit in this plan is a count or a string that some test or doc mirrors by hand.

**Tech Stack:** TypeScript (ESM NodeNext), vitest, drizzle + better-sqlite3, discord.js.

**Spec:** `docs/superpowers/specs/2026-08-12-content-breadth-4a-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

- **ESM NodeNext:** every relative import carries a `.js` extension, including in tests.
- **No new biome tag.** Every new species reuses one of the eight live tags: `coast, containment, forest, marine, plains, swamp, tundra, volcanic`. A new tag costs ≥3 decor kinds and pushes `/decorate item` past its silent 25-choice slice.
- **No mythic and no legendary species.** A mythic changes the `/mythic` builder and forces `deploy-commands`; legendary would fill `legendary+support`, which `tests/dex.test.ts` asserts is empty.
- **Append to `ALL`, never insert.** `tests/dex.test.ts:101` requires `'Triceratops'` on page 1, and triceratops is `ALL[0]`.
- **Every new `drain` value ≤ 1.20.** `tests/enrichment.test.ts:181` pins `MAX_DRAIN_MULT` to `1.44` by equality.
- **Never ship a `breedTime` value above 1.** `Math.min` across both parents discards it.
- **No new `TraitMods` key, no new `TraitDomain`, no new `Archetype`.**
- **Blurb text uses an ASCII hyphen** (`-10% income`), matching every existing row in `src/data/traits.ts`. The spec's tables use a Unicode minus for typography; the code must not.
- **`npm run typecheck` is the only gate that sees test files.** `npm run build` compiles `src` alone and `npm test` transpiles without typechecking. The `TraitId` union / `TRAITS` table pair is a typecheck-only gate.
- **A guard nobody has watched fail is not yet a guard.** Every task that adds a test which passes on arrival includes a step that deliberately breaks the data, observes red, and reverts.

---

## File Structure

**Created — 10 files, one per species**, all in `src/data/species/`, each 5 lines:
`henodus.ts`, `thescelosaurus.ts`, `hesperornis.ts`, `lesothosaurus.ts`, `leaellynasaura.ts`, `massospondylus.ts`, `pteranodon.ts`, `deinosuchus.ts`, `sinosaurus.ts`, `pachyrhinosaurus.ts`

**Modified — source (2 files):**
- `src/data/species/index.ts` — 10 imports and 10 `ALL` entries
- `src/data/traits.ts` — the `TraitId` union and the `TRAITS` table

**Modified — tests (7 files):** `roster.test.ts`, `traits.test.ts`, `dex.test.ts`, `ranks.test.ts`, `hatchery.test.ts`, `park.test.ts`, `rating.test.ts`

**Modified — docs and comments (6 files):** `docs/gameplay.md`, `README.md`, `CLAUDE.md`, `scripts/test-live.ts`, `src/modules/dex/index.ts`, `src/core/species-seen.ts`, `src/modules/park/ranks.ts`

---

## Task 1: Roster registration integrity guard (G-2)

A duplicated species `id` is deduped by `REGISTRY` (a `Map`) but **not** by `speciesByRarity`, which filters the raw `ALL` array. `rollSpeciesInRarity` can then return the shadowed object while `hatchEgg` stores only `species.id`, and every later read resolves that id back to the *other* object — a dino whose diet, biome, art and battle stats disagree with the species that was rolled. Nothing in the suite reads `ALL`.

`ALL` is module-private, so the guard compares the sum of the per-tier pools (which read `ALL`) against `allSpecies()` (which reads the Map). That is exactly the split, with no source change.

**Files:**
- Test: `tests/roster.test.ts`

**Interfaces:**
- Consumes: `allSpecies()`, `speciesByRarity(rarity)` from `../src/data/species/index.js` — both already imported by this file.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the guard**

Add to `tests/roster.test.ts`, inside the existing `describe('roster', ...)` block, immediately after the `'has exactly 42 species with unique ids'` test:

```ts
  // REGISTRY is a Map, so a duplicated id is deduped for getSpecies and allSpecies but
  // NOT for speciesByRarity, which filters the raw ALL array. That split ships a dino
  // whose rolled identity and resolved identity are different objects, with no error
  // anywhere. ALL is module-private; summing the tiers reads it, allSpecies reads the Map.
  it('registers every species exactly once — the per-tier pools and the registry agree', () => {
    const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
    const pooled = tiers.reduce((n, r) => n + speciesByRarity(r).length, 0);
    expect(pooled).toBe(allSpecies().length);
  });
```

- [ ] **Step 2: Run it and confirm it passes on today's data**

Run: `npx vitest run tests/roster.test.ts -t 'registers every species exactly once'`
Expected: PASS.

- [ ] **Step 3: Watch it fail**

A guard that has only ever been green proves nothing. Temporarily duplicate an entry in `src/data/species/index.ts` — change the `ALL` array's last line from:

```ts
  cryolophosaurus, nanuqsaurus,
```

to:

```ts
  cryolophosaurus, nanuqsaurus, nanuqsaurus,
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run tests/roster.test.ts -t 'registers every species exactly once'`
Expected: FAIL — `expected 43 to be 42`.

Confirm also that `'has exactly 42 species with unique ids'` still **passes** with the duplicate in place. That is the whole point: the pre-existing test cannot see this.

- [ ] **Step 5: Revert the duplicate**

Restore `src/data/species/index.ts` to `cryolophosaurus, nanuqsaurus,` and re-run the full file.

Run: `npx vitest run tests/roster.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add tests/roster.test.ts
git commit -m "test: guard against a duplicated species id shadowing the registry"
```

---

## Task 2: The 10 species

Write the span guard first and watch it name the missing cells, then fill them, then update everything that counts the roster by hand.

The suite is red between steps 4 and 15. That is expected and the task is not done until step 16 is green.

**Files:**
- Create: `src/data/species/henodus.ts`, `thescelosaurus.ts`, `hesperornis.ts`, `lesothosaurus.ts`, `leaellynasaura.ts`, `massospondylus.ts`, `pteranodon.ts`, `deinosuchus.ts`, `sinosaurus.ts`, `pachyrhinosaurus.ts`
- Modify: `src/data/species/index.ts`
- Test: `tests/roster.test.ts`, `tests/dex.test.ts`, `tests/ranks.test.ts`, `tests/park.test.ts`, `tests/rating.test.ts`

**Interfaces:**
- Consumes: `Species` from `src/data/types.ts` — `{ id: string; name: string; rarity: Rarity; diet: Diet; archetype: Archetype; biomeTags: string[]; flavor: string }`. `Rarity` is `'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'`; `Diet` is `'herbivore' | 'carnivore'`; `Archetype` is `'bruiser' | 'tank' | 'swift' | 'support'`.
- Produces: ten exported consts named exactly as their ids, imported by `src/data/species/index.ts`. Roster size becomes **52**; per-tier becomes `common 13, uncommon 10, rare 10, epic 11, legendary 5, mythic 3`.

- [ ] **Step 1: Write the failing span guard**

Add to `tests/roster.test.ts`, at the end of the `describe('biome vocabulary', ...)` block:

```ts
  // The spec's thesis, made machine-checked: all 8 commons used to be forest or plains,
  // so six biomes were unreachable from a starter egg and their decor was dead content.
  // Containment is deliberately exempt — it is the chapter-6 lab fiction and is epic-and-up.
  it('every non-containment biome spans common through epic', () => {
    const biomes = new Set(allSpecies().flatMap((s) => s.biomeTags));
    biomes.delete('containment');
    for (const biome of biomes) {
      for (const rarity of ['common', 'uncommon', 'rare', 'epic'] as const) {
        const hits = speciesByRarity(rarity).filter((s) => s.biomeTags.includes(biome));
        expect(hits.length, `biome '${biome}' has no ${rarity} species`).toBeGreaterThan(0);
      }
    }
  });
```

- [ ] **Step 2: Run it and read the first missing cell**

Run: `npx vitest run tests/roster.test.ts -t 'spans common through epic'`
Expected: FAIL, with a message naming a biome and rarity — the first of the ten missing cells. `expect` stops at the first failure, so this reports one cell, not all ten. The full list the next steps fill is: marine/common, swamp/common, coast/common, coast/rare, coast/epic, volcanic/common, volcanic/uncommon, volcanic/epic, tundra/common, tundra/epic.

- [ ] **Step 3: Create the five common species files**

`src/data/species/henodus.ts`:

```ts
import type { Species } from '../types.js';
export const henodus: Species = {
  id: 'henodus', name: 'Henodus', rarity: 'common', diet: 'herbivore', archetype: 'tank',
  biomeTags: ['marine'], flavor: 'A flat, box-shaped grazer that mows the shallows like a lawn.',
};
```

`src/data/species/thescelosaurus.ts`:

```ts
import type { Species } from '../types.js';
export const thescelosaurus: Species = {
  id: 'thescelosaurus', name: 'Thescelosaurus', rarity: 'common', diet: 'herbivore', archetype: 'tank',
  biomeTags: ['swamp'], flavor: 'Stout, low, and endlessly patient in the reeds.',
};
```

`src/data/species/hesperornis.ts`:

```ts
import type { Species } from '../types.js';
export const hesperornis: Species = {
  id: 'hesperornis', name: 'Hesperornis', rarity: 'common', diet: 'carnivore', archetype: 'swift',
  biomeTags: ['coast'], flavor: 'A toothed diving bird that swims far better than it walks.',
};
```

`src/data/species/lesothosaurus.ts`:

```ts
import type { Species } from '../types.js';
export const lesothosaurus: Species = {
  id: 'lesothosaurus', name: 'Lesothosaurus', rarity: 'common', diet: 'herbivore', archetype: 'swift',
  biomeTags: ['volcanic'], flavor: 'A knee-high grazer that bolts at the first hint of ash.',
};
```

`src/data/species/leaellynasaura.ts`:

```ts
import type { Species } from '../types.js';
export const leaellynasaura: Species = {
  id: 'leaellynasaura', name: 'Leaellynasaura', rarity: 'common', diet: 'herbivore', archetype: 'swift',
  biomeTags: ['tundra'], flavor: 'Enormous eyes, for a world with months of darkness.',
};
```

- [ ] **Step 4: Create the five uncommon, rare and epic species files**

`src/data/species/massospondylus.ts`:

```ts
import type { Species } from '../types.js';
export const massospondylus: Species = {
  id: 'massospondylus', name: 'Massospondylus', rarity: 'uncommon', diet: 'herbivore', archetype: 'support',
  biomeTags: ['volcanic'], flavor: 'Long-necked, mild-tempered, and endlessly photogenic.',
};
```

`src/data/species/pteranodon.ts`:

```ts
import type { Species } from '../types.js';
export const pteranodon: Species = {
  id: 'pteranodon', name: 'Pteranodon', rarity: 'rare', diet: 'carnivore', archetype: 'swift',
  biomeTags: ['coast'], flavor: 'A twenty-foot wingspan and not one tooth to show for it.',
};
```

`src/data/species/deinosuchus.ts`:

```ts
import type { Species } from '../types.js';
export const deinosuchus: Species = {
  id: 'deinosuchus', name: 'Deinosuchus', rarity: 'epic', diet: 'carnivore', archetype: 'bruiser',
  biomeTags: ['coast'], flavor: 'A crocodile the length of a bus, waiting where the river meets the sea.',
};
```

`src/data/species/sinosaurus.ts`:

```ts
import type { Species } from '../types.js';
export const sinosaurus: Species = {
  id: 'sinosaurus', name: 'Sinosaurus', rarity: 'epic', diet: 'carnivore', archetype: 'bruiser',
  biomeTags: ['volcanic'], flavor: 'A crested hunter off the ash flats, built for the heat.',
};
```

`src/data/species/pachyrhinosaurus.ts`:

```ts
import type { Species } from '../types.js';
export const pachyrhinosaurus: Species = {
  id: 'pachyrhinosaurus', name: 'Pachyrhinosaurus', rarity: 'epic', diet: 'herbivore', archetype: 'tank',
  biomeTags: ['tundra'], flavor: 'A boss of solid bone instead of a horn, and a herd that walks through snow.',
};
```

- [ ] **Step 5: Register all ten in the index**

In `src/data/species/index.ts`, add these ten import lines after the existing imports:

```ts
import { henodus } from './henodus.js';
import { thescelosaurus } from './thescelosaurus.js';
import { hesperornis } from './hesperornis.js';
import { lesothosaurus } from './lesothosaurus.js';
import { leaellynasaura } from './leaellynasaura.js';
import { massospondylus } from './massospondylus.js';
import { pteranodon } from './pteranodon.js';
import { deinosuchus } from './deinosuchus.js';
import { sinosaurus } from './sinosaurus.js';
import { pachyrhinosaurus } from './pachyrhinosaurus.js';
```

Then **append** a line to the `ALL` array, after `cryolophosaurus, nanuqsaurus,`:

```ts
  henodus, thescelosaurus, hesperornis, lesothosaurus, leaellynasaura,
  massospondylus, pteranodon, deinosuchus, sinosaurus, pachyrhinosaurus,
```

The import alone is a **total no-op** — `REGISTRY` is built from `ALL`, `tsconfig.json` has no `noUnusedLocals`, and no test reads the species directory. Both edits, every time.

- [ ] **Step 6: Run the span guard and confirm it now passes**

Run: `npx vitest run tests/roster.test.ts -t 'spans common through epic'`
Expected: PASS.

- [ ] **Step 7: Update the roster count pins**

In `tests/roster.test.ts`, change the `EXPECTED` map on line 5:

```ts
const EXPECTED = { common: 13, uncommon: 10, rare: 10, epic: 11, legendary: 5, mythic: 3 } as const;
```

and the test on line 8 — **its name too, not only its assertions**; a stale name prints in green:

```ts
  it('has exactly 52 species with unique ids', () => {
    const all = allSpecies();
    expect(all).toHaveLength(52);
    expect(new Set(all.map((s) => s.id)).size).toBe(52);
```

- [ ] **Step 8: Run the roster file**

Run: `npx vitest run tests/roster.test.ts`
Expected: PASS, all tests. The enrichment-cap and biome-vocabulary tests should pass untouched — every new species reuses a live tag, and all eight tags already carry three decor kinds.

- [ ] **Step 9: Update the dex count pins**

In `tests/dex.test.ts`:

- `:19` — `expect(rows).toHaveLength(42)` → `52`
- `:26` — `diet: 'herbivore'` → `24` (was 18; six of the ten new species are herbivores)
- `:27` — `archetype: 'tank'` → `12` (was 9; Henodus, Thescelosaurus and Pachyrhinosaurus)
- `:33` — the rare+carnivore combo → `9` (was 8; Pteranodon)
- `:76` and `:78` — `{ seen: 0, total: 42 }` → `total: 52`, and `{ seen: 1, total: 42 }` → `total: 52`
- `:100` — `expect(text).toContain('1/42')` → `'1/52'`

Also rewrite the comment at `:28-31`, which currently reads "rare has 9 species, of which ankylosaurus is the sole herbivore … this pair has a real herbivore for a broken AND to leak through". Rare now has 10; ankylosaurus is still its sole herbivore, so the reasoning holds and only the count moves:

```ts
    // rare has 10 species, of which ankylosaurus is the sole herbivore — the other 9
```

Leave `:25` (`rarity: 'mythic'` → 3) alone. Mythic is unchanged.

Leave `:44-46` (legendary+support is empty) alone, and leave its comment's list of empty pairs alone: this spec adds no legendary, no common bruiser and no rare support, so all four named pairs stay empty.

- [ ] **Step 10: Update the dex page-count pins**

The roster crosses 51, so unfiltered paging goes 5 → 6 pages at `PAGE_SIZE` 10. The herbivore filter goes 18 → 24, i.e. 2 → 3 pages. In `tests/dex.test.ts`:

- `:89` — `'Page 1/5'` → `'Page 1/6'`
- `:91` — `'Page 5/5'` → `'Page 6/6'`
- `:114` — `'35/42 seen · Page 1/5 · Keeper'` → `'35/52 seen · Page 1/6 · Keeper'`. The rank is still Keeper: 35 species + 0 achievements + 0 stars = 35 points, and Keeper's threshold is 35.
- `:119` — `'0/42 seen · Page 1/5'` → `'0/52 seen · Page 1/6'`
- `:144` — `'Page 1/5'` → `'Page 1/6'`
- `:200-201` — the comment "diet:herbivore is 18 of 42 species — two pages" → "24 of 52 species — three pages"
- `:206` — `'Page 2/2'` → `'Page 2/3'`
- `:219` — `'Page 2/5'` → `'Page 2/6'`

Leave `:93-96` alone — that test filters to mythic, which is still 3 and still fits one page.

Leave `:233-245` alone — the customId length pin depends on the rarity/diet/archetype unions, none of which change.

- [ ] **Step 11: Run the dex file**

Run: `npx vitest run tests/dex.test.ts`
Expected: PASS, all tests.

- [ ] **Step 12: Update the legacy ceiling**

The ceiling is `species + achievement tiers + battle stars` = `52 + 48 + 90` = **190**. `LEGACY_TIERS` does **not** change — see spec §8. In `tests/ranks.test.ts`:

- `:22` — `expect(legacyMaxPoints()).toBe(180);      // 42 + 48 + 90 on today's content` → `toBe(190);      // 52 + 48 + 90 on today's content`

- [ ] **Step 13: Rewrite the ranks comment whose reasoning inverts**

`tests/ranks.test.ts:66-74` currently reasons that species and achievement claims "together only 90, short of Warden (100)". After this task that sum is `52 + 48 = 100` — *exactly* Warden. The number does not slide; the argument reverses. Replace the comment block at `:67-74` with:

```ts
  // Species alone caps at allSpecies().length (52) and achievement claims cap at
  // ACHIEVEMENTS' 48 tiers — together exactly 100, which reaches Warden but neither
  // Conservator (140) nor Director (170). The brief's original threshold test seeded
  // points from species alone and skipped asserting on any threshold above 42 entirely,
  // so three of the six tiers (Warden, Conservator, Director) were NEVER exercised.
  // Seeding across all three point sources (species, achievement claims, battle stars —
  // the same three legacyPoints reads) reaches all 190 possible points, so every
  // threshold is reachable and gets an exact assertion below.
```

- [ ] **Step 14: Run the ranks file**

Run: `npx vitest run tests/ranks.test.ts`
Expected: PASS, all tests. `:124-126` seeds `warden.points + 20` and expects Warden; thresholds are unchanged, so it is unaffected.

- [ ] **Step 15: Update the two stale comments in other test files**

Neither breaks; both state a superseded figure.

- `tests/park.test.ts:314` — "caps at allSpecies().length (42, tests/ranks.test.ts)" → `(52, tests/ranks.test.ts)`
- `tests/rating.test.ts:95` — "302 points of rarity weight now exist against a COLLECTION_TARGET of 190" → **337** points. Derivation: `13·1 + 10·2 + 10·4 + 11·8 + 5·16 + 3·32 = 337`. Leave `:108`'s `toBe(400)` alone — that fixture seeds 192 weight and saturates the 190 target either way.

- [ ] **Step 16: Run the whole suite and typecheck**

Run: `npm test`
Expected: PASS, every file.

Run: `npm run typecheck`
Expected: clean.

If anything else is red, it is a count pin this plan missed — fix it and note it in the commit body rather than adjusting a value until green.

- [ ] **Step 17: Commit**

```bash
git add src/data/species tests/roster.test.ts tests/dex.test.ts tests/ranks.test.ts tests/park.test.ts tests/rating.test.ts
git commit -m "feat: add ten species so every biome spans common through epic"
```

---

## Task 3: Trait polarity guard (G-4)

`polarity` is decorative today — its only functional reader is a sweep asserting both labels appear — so a trait labelled `positive` carrying `drain: 1.5` is mislabeled on every surface with nothing to catch it. This lands **before** the new traits so it polices them on arrival.

The direction map must be exhaustive over `keyof TraitMods`. `TraitMods` has **nine** keys and five of the fourteen shipped traits carry only the four combat ones — written with a five-key map, this guard is red on `main` before any 4a data lands, because `glass_cannon` would have zero classified mods and could not satisfy "mixed needs one of each".

**Files:**
- Test: `tests/traits.test.ts`

**Interfaces:**
- Consumes: `TRAITS`, `TRAIT_IDS` (already imported by this file) and the `TraitMods` type from `../src/data/traits.js`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the type import**

`tests/traits.test.ts` already imports values from `../src/data/traits.js`. Add a type-only import beneath it:

```ts
import type { TraitMods } from '../src/data/traits.js';
```

- [ ] **Step 2: Write the guard**

Add a new `describe` block at the end of `tests/traits.test.ts`:

```ts
describe('polarity', () => {
  // Exhaustive over keyof TraitMods on purpose — a Partial would let a future mod key
  // go unclassified, and every trait carrying only that key would pass vacuously. Five
  // of the fourteen shipped traits carry only combat keys, so a map missing hp/atk/def/
  // spd is red on arrival rather than merely incomplete.
  const DIRECTION: Record<keyof TraitMods, 1 | -1> = {
    income: 1, xp: 1, hp: 1, atk: 1, def: 1, spd: 1,
    drain: -1, feed: -1, breedTime: -1,
  };

  it('agrees with the direction of every mod a trait carries', () => {
    for (const id of TRAIT_IDS) {
      const t = TRAITS[id];
      const signs = (Object.keys(t.mods) as Array<keyof TraitMods>)
        .map((k) => Math.sign((t.mods[k]! - 1) * DIRECTION[k]))
        .filter((s) => s !== 0);
      const good = signs.some((s) => s > 0);
      const bad = signs.some((s) => s < 0);

      if (t.polarity === 'positive') {
        expect(good, `${id} is positive but carries no beneficial mod`).toBe(true);
        expect(bad, `${id} is positive but carries an adverse mod`).toBe(false);
      }
      if (t.polarity === 'negative') {
        expect(bad, `${id} is negative but carries no adverse mod`).toBe(true);
        expect(good, `${id} is negative but carries a beneficial mod`).toBe(false);
      }
      if (t.polarity === 'mixed') {
        expect(good && bad, `${id} is mixed without one beneficial and one adverse mod`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 3: Run it and confirm it passes on today's table**

Run: `npx vitest run tests/traits.test.ts -t 'agrees with the direction'`
Expected: PASS. All fourteen shipped traits are correctly labelled.

- [ ] **Step 4: Watch it fail**

Temporarily mislabel one trait in `src/data/traits.ts` — change `skittish`'s `polarity: 'negative'` to `polarity: 'positive'`.

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx vitest run tests/traits.test.ts -t 'agrees with the direction'`
Expected: FAIL with `skittish is positive but carries an adverse mod`.

- [ ] **Step 6: Revert and re-run**

Restore `skittish`'s `polarity: 'negative'`.

Run: `npx vitest run tests/traits.test.ts`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add tests/traits.test.ts
git commit -m "test: pin trait polarity against the direction of its modifiers"
```

---

## Task 4: The 6 traits

`pickTrait` builds `TRAIT_IDS.filter(...)` and indexes it uniformly, so **domain probability is nothing but domain size**: income 3/14, care 4/14, combat 5/14, meta 2/14. Equal domain sizes make it exactly uniform by construction — the property a two-stage weighted draw would have bought, obtained as data.

Write the parity guard first; it is red on today's 3/4/5/2 table.

**Files:**
- Modify: `src/data/traits.ts`
- Test: `tests/traits.test.ts`, `tests/hatchery.test.ts`

**Interfaces:**
- Consumes: `TraitDef`, `TraitMods`, `TraitDomain`, `TraitId` from `src/data/traits.ts`. `TRAITS` is `Record<TraitId, TraitDef>`, so the union and the table are a matched pair enforced only by `npm run typecheck`.
- Produces: `TRAIT_IDS` length **20**, five per domain. New ids: `crowd_pleaser`, `docile`, `voracious`, `broody`, `matriarch`, `dull`.

- [ ] **Step 1: Write the failing parity guard**

Task 3 added `import type { TraitMods } from '../src/data/traits.js';` to this file. Extend it to carry `TraitDomain` as well:

```ts
import type { TraitMods, TraitDomain } from '../src/data/traits.js';
```

Then add a new `describe` block to `tests/traits.test.ts`, after the `describe('pickTrait', ...)` block:

```ts
describe('domain draw parity', () => {
  const DOMAINS = ['income', 'care', 'combat', 'meta'] as const;
  // 20,000 draws at ±1 percentage point. The bound has to discriminate the failure it
  // exists to catch: one domain going 5/20 -> 4/20 or 6/20 moves that share by 5 points,
  // so ±1 catches it with wide margin while sampling error at this N stays under a third
  // of a point. A loose tolerance on a large N cannot tell 5/20 from 4/20; a tight one on
  // a small N is merely flaky.
  const DRAWS = 20_000;
  const TOLERANCE = 0.01;

  const shares = (exclude: Set<TraitDomain>, seed: number) => {
    const rng = mulberry32(seed);
    const counts = new Map<TraitDomain, number>(DOMAINS.map((d) => [d, 0] as [TraitDomain, number]));
    for (let i = 0; i < DRAWS; i++) {
      const picked = pickTrait(rng, exclude);
      const domain = TRAITS[picked!].domain;
      counts.set(domain, counts.get(domain)! + 1);
    }
    return counts;
  };

  it('holds the same number of traits in every domain', () => {
    const sizes = DOMAINS.map((d) => TRAIT_IDS.filter((id) => TRAITS[id].domain === d).length);
    expect(new Set(sizes).size, `domain sizes are ${sizes.join('/')}`).toBe(1);
  });

  it('draws every domain a quarter of the time with nothing excluded', () => {
    const counts = shares(new Set<TraitDomain>(), 99);
    for (const d of DOMAINS) {
      const share = counts.get(d)! / DRAWS;
      expect(Math.abs(share - 0.25), `${d} drew ${counts.get(d)} of ${DRAWS}`).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('draws every survivor a third of the time with one domain excluded', () => {
    const counts = shares(new Set<TraitDomain>(['combat']), 101);
    expect(counts.get('combat')).toBe(0);
    for (const d of DOMAINS.filter((d) => d !== 'combat')) {
      const share = counts.get(d)! / DRAWS;
      expect(Math.abs(share - 1 / 3), `${d} drew ${counts.get(d)} of ${DRAWS}`).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/traits.test.ts -t 'domain draw parity'`
Expected: all three FAIL. The first reports `domain sizes are 3/4/5/2`. The second reports combat drawing roughly 35.7% and meta roughly 14.3% — both far outside ±1 point of 25%.

- [ ] **Step 3: Extend the TraitId union**

In `src/data/traits.ts`, replace the `TraitId` union with:

```ts
export type TraitId =
  | 'prolific' | 'runt' | 'grazer' | 'crowd_pleaser' | 'docile'
  | 'hardy' | 'thrifty' | 'skittish' | 'gluttonous' | 'voracious'
  | 'savage' | 'ironhide' | 'fleet' | 'glass_cannon' | 'frail'
  | 'prodigy' | 'fertile' | 'broody' | 'matriarch' | 'dull';
```

- [ ] **Step 4: Add the six rows to the TRAITS table**

Order inside the object literal is `TRAIT_IDS` order, so add each new row at the **end of its own domain block**, keeping the blank lines between blocks. Blurbs use an ASCII hyphen to match every existing row.

After `grazer`, in the income block:

```ts
  crowd_pleaser:{ id: 'crowd_pleaser',name: 'Crowd-Pleaser',domain: 'income', polarity: 'positive', blurb: '+25% income',                emoji: 'dw_trait_income', fallback: '💰', mods: { income: 1.25 } },
  docile:      { id: 'docile',      name: 'Docile',      domain: 'income', polarity: 'positive', blurb: '+10% income, -10% hunger drain', emoji: 'dw_trait_income', fallback: '💰', mods: { income: 1.10, drain: 0.90 } },
```

After `gluttonous`, in the care block:

```ts
  voracious:   { id: 'voracious',   name: 'Voracious',   domain: 'care',   polarity: 'mixed',    blurb: '-30% feed cost, +20% hunger drain', emoji: 'dw_trait_care',   fallback: '🌿', mods: { feed: 0.70, drain: 1.20 } },
```

After `fertile`, in the meta block:

```ts
  broody:      { id: 'broody',      name: 'Broody',      domain: 'meta',   polarity: 'positive', blurb: '-40% breeding time',          emoji: 'dw_trait_meta',   fallback: '🧬', mods: { breedTime: 0.60 } },
  matriarch:   { id: 'matriarch',   name: 'Matriarch',   domain: 'meta',   polarity: 'mixed',    blurb: '-30% breeding time, -10% income', emoji: 'dw_trait_meta',   fallback: '🧬', mods: { breedTime: 0.70, income: 0.90 } },
  dull:        { id: 'dull',        name: 'Dull',        domain: 'meta',   polarity: 'negative', blurb: '-15% battle XP',              emoji: 'dw_trait_meta',   fallback: '🧬', mods: { xp: 0.85 } },
```

The combat block gets nothing. All four `emoji` names already exist in `src/core/emojis.ts` — emoji is per-domain, so **no `deploy-emojis`**.

- [ ] **Step 5: Run the parity guard and confirm it passes**

Run: `npx vitest run tests/traits.test.ts -t 'domain draw parity'`
Expected: all three PASS. Domain sizes are now 5/5/5/5.

- [ ] **Step 6: Update the trait count pin, name included**

In `tests/traits.test.ts`, line 9 — the name is stale too and would print green:

```ts
  it('has 20 traits across 4 domains', () => {
    expect(TRAIT_IDS).toHaveLength(20);
```

- [ ] **Step 7: Re-derive the seeded hatch fixture**

`tests/hatchery.test.ts:143` pins `expect(out.traits).toEqual(['fleet', 'prodigy'])` for a wild common egg on `mulberry32(10)`. The trait pool grew 14 → 20, so the picks move. Do **not** paste whatever vitest prints — derive it, then confirm the run agrees.

The derivation, from `hatchEgg`'s rng order (`rollSpeciesInRarity` consumes exactly one call regardless of pool size, then `rollTraits` consumes one for the slot count and one per pick):

| draw | today (14 traits) | after (20 traits) |
| --- | --- | --- |
| 1 — species | 0.501992 → common index 4 of 8 | 0.501992 → common index 6 of 13 |
| 2 — slot count | 2 slots | 2 slots |
| 3 — first pick | `fleet` (combat) | `glass_cannon` (combat) |
| 4 — second pick, combat excluded | `prodigy` (meta) | `broody` (meta) |

Change line 143 to:

```ts
    expect(out.traits).toEqual(['glass_cannon', 'broody']);
```

- [ ] **Step 8: Run the hatchery file and check the derivation held**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS, all tests.

If the assertion fails with a *different* pair, stop and re-derive rather than substituting the observed value — a mismatch means the rng consumption order is not what this table assumes, which is a finding, not a fixture update.

- [ ] **Step 9: Confirm the genelab fixture is untouched**

`tests/genelab.test.ts:468` asserts `inheritTraits(['retired_trait'], [], () => 0.5)` returns `['savage']`. With a constant rng of 0.5 the pick is `TRAIT_IDS[Math.floor(0.5 * 20)] = TRAIT_IDS[10]`, and index 10 is the first combat entry because income and care now hold 5 each. So `savage` is still correct and this fixture needs **no edit**.

Run: `npx vitest run tests/genelab.test.ts`
Expected: PASS, all tests. If `:468` is red, the table's block ordering is wrong — check that each new row went at the end of its own domain block.

- [ ] **Step 10: Confirm the enrichment gate did not move**

`MAX_DRAIN_MULT` is the product of the top two per-domain `drain` maxima. `voracious` at 1.20 ties the care maximum rather than raising it, and `docile` at 0.90 cannot raise the income maximum, so it stays 1.44 — pinned by equality.

Run: `npx vitest run tests/enrichment.test.ts`
Expected: PASS, all tests.

- [ ] **Step 11: Run the whole suite and typecheck**

Run: `npm test`
Expected: PASS, every file.

Run: `npm run typecheck`
Expected: clean. This is the only gate that would catch a `TraitId` union that disagrees with the `TRAITS` table.

- [ ] **Step 12: Commit**

```bash
git add src/data/traits.ts tests/traits.test.ts tests/hatchery.test.ts
git commit -m "feat: add six traits so every domain draws a quarter of the time"
```

---

## Task 5: Docs, comments and case titles

Nothing in `tests/` reads `docs/gameplay.md`, so every figure below is hand-maintained and unguarded. `rg -n '\b42\b'` is the only sweep that finds the roster count everywhere it is mirrored.

**Files:**
- Modify: `docs/gameplay.md`, `README.md`, `CLAUDE.md`, `scripts/test-live.ts`, `src/modules/dex/index.ts`, `src/core/species-seen.ts`, `src/modules/park/ranks.ts`

**Interfaces:**
- Consumes: the final counts from Tasks 2 and 4 — 52 species (13/10/10/11/5/3), 20 traits (5 per domain), legacy ceiling 190.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Update the gameplay guide's species figures**

In `docs/gameplay.md`:

- `:291` — "Dino World has 42 species split across six rarities: 8 Common, 9 Uncommon, 9 …" → "52 species … 13 Common, 10 Uncommon, 10 Rare, 11 Epic, 5 Legendary, 3 Mythic". Read the whole sentence and update every number in it.
- `:301-344` — the roster table. Add one row per new species, in `ALL` order (so the ten go at the end), matching the existing columns exactly.
- `:898` — "species you've discovered (up to 42) … 180 points in total" → `52` and `190`.

- [ ] **Step 2: Update the gameplay guide's four trait sites**

Still in `docs/gameplay.md`, §15 Traits hardcodes the roster in four separate places:

- `:1053` — "The 14 traits are grouped into four domains" → "The 20 traits".
- `:1062-1067` — the `| Domain | Traits |` table. Income gains Crowd-Pleaser and Docile; Care gains Voracious; Meta gains Broody, Matriarch and Dull. **Combat gains none, so exactly three of the four rows change.** This is a second, separately-headed table — left stale it publishes "Meta: Prodigy, Fertile" directly above a 20-row table.
- `:1069` — the heading `### The 14 traits` → `### The 20 traits`.
- `:1071-1086` — the effect table, 14 rows → 20. Add each new trait with its blurb.
- `:1091` — "Eight of the fourteen are purely upside (Prolific, Hardy, …" → **eleven of the twenty**, and extend the parenthetical list with Crowd-Pleaser, Docile and Broody. The full breakdown moves 8/4/2 → 11/5/4 positive/negative/mixed.

- [ ] **Step 3: Record why no trait slows breeding**

`docs/gameplay.md:1173` reads "shorter of the two parents' times — Fertile on just one side is enough." Append a sentence so no future author re-derives the inert trait this spec rejected:

```
Because the shorter time wins, a trait that *lengthened* breeding would do nothing
unless both parents carried it — which is why none exists.
```

- [ ] **Step 4: Update the README**

`README.md:12` and `:21` both say "42 species" → `52 species`. Grep to confirm there is no third: `rg -n '42 species' README.md`.

- [ ] **Step 5: Update the test:live case title and its fixture comment**

In `scripts/test-live.ts`, the P5 legacy-rank case publishes its title to the review channel:

- `:239` — the comment "roster's first 35 (of 42) species" → `(of 52)`
- `:323` — the case title "…Keeper at 35 of 42 species discovered" → `35 of 52`

The fixture itself (`allSpecies().slice(0, 35)`, `:245`) is safe under the append rule and still lands on Keeper. Neither line is guarded: `tsconfig.test.json` includes `scripts`, but typecheck cannot see a string literal, and this is not a vitest file.

- [ ] **Step 6: Update the two source comments and the ranks header**

- `src/modules/dex/index.ts:29` — "42 species exceeds Discord's 25-choice cap" → `52 species`. The claim stays true; only the number is stale.
- `src/core/species-seen.ts:22` — "the dex renders 42 rows" → `52 rows`.
- `src/modules/park/ranks.ts:26-28` — the ceiling comment "42 species + 48 achievement tiers + 90 battle stars = 180 today" → `52 … = 190 today`.
- `src/modules/park/ranks.ts:14` — the threshold percentages. `LEGACY_TIERS` is unchanged, so against the new 190 ceiling they become `7.9 / 18.4 / 34.2 / 52.6 / 73.7 / 89.5%`.

- [ ] **Step 7: Update the repo CLAUDE.md**

- `CLAUDE.md:679` — "42 species is well past it" → `52 species`.
- `CLAUDE.md:777` — "`dexProgress`, max 42" → `max 52`.

- [ ] **Step 8: Sweep for anything missed**

Run: `rg -n '\b42\b' README.md CLAUDE.md docs/ src/ scripts/ tests/`

Read every hit. Some are legitimately unrelated (a cost, a level, an index). Every hit that means "the roster size" must already read 52.

Run: `rg -n '\b(14|fourteen) traits\b' docs/ src/ tests/`
Expected: no hits.

- [ ] **Step 9: Run the full gate**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: clean.

Run: `npm run build`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add docs/gameplay.md README.md CLAUDE.md scripts/test-live.ts src/modules/dex/index.ts src/core/species-seen.ts src/modules/park/ranks.ts
git commit -m "docs: track the 52-species roster and the 20-trait table"
```

---

## Task 6: Verification and ship

No migration. No `deploy-commands` — no builder changes, since no mythic ships and no option's choices are fed by a table this spec touches. No `deploy-emojis` — trait emoji is per-domain and all four exist. No new art.

**Files:** none modified.

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a deployed bot.

- [ ] **Step 1: Confirm the guards actually guard**

Each of the four new tests should have been watched failing in its own task. Confirm all four exist and pass:

Run: `npx vitest run tests/roster.test.ts tests/traits.test.ts -t 'registers every species exactly once'`
Run: `npx vitest run tests/roster.test.ts -t 'spans common through epic'`
Run: `npx vitest run tests/traits.test.ts -t 'domain draw parity'`
Run: `npx vitest run tests/traits.test.ts -t 'agrees with the direction'`

Expected: PASS for all.

- [ ] **Step 2: Run the complete offline gate**

Run: `npm run typecheck`
Expected: clean. Run this **first** — the `TraitId` union / `TRAITS` table pair is invisible to `npm test`.

Run: `npm test`
Expected: PASS, every file. Record the new total; it was 1585 before this work.

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Restart the bot**

The bot runs compiled `dist/`, so a `src/data/` edit is invisible to the live process until it is rebuilt and restarted. Exactly one process per token — two racing instances make every command fail with 10062.

Stop the running instance, then from the repo root:

```bash
npm start
```

- [ ] **Step 4: Run the live gallery**

Run: `npm run test:live`
Expected: every case ok, 0 failed. It is REST-only and safe to run against the dev guild while the bot is live.

Check the P5 case title in the review channel reads "35 of 52", confirming Task 5 step 5 landed.

- [ ] **Step 5: Spot-check the new content in Discord**

- `/dex list` — footer should read `Page 1/6`.
- `/dex list rarity:common` — should now page, where it previously fit on one.
- `/dex view species:pachyrhinosaurus` — renders, and names tundra decor kinds.
- `/help topic:genelab` — the enumerated mod-key list is unchanged and still accurate.

- [ ] **Step 6: Final commit if anything moved**

```bash
git status --short
```

Expected: clean. If `assets/emojis/manifest.json` or any build output moved, that is a signal something in this plan was wrong — investigate before committing.

---

## Notes for the implementer

**What this plan deliberately does not do.** `LEGACY_TIERS` is not retuned, even though `src/modules/park/ranks.ts`'s own comment asks for it. Nothing persists an earned rank, so raising a threshold silently demotes live players and contradicts `docs/gameplay.md`'s written promise that "nothing can ever be lost". Spec §8 carries the full reasoning and the option that would discharge the debt.

**If a count pin fires that this plan does not list**, fix it and say so in the commit body. Do not adjust an expected value until it goes green — every number in this plan is derived, and a disagreement means either the derivation or the code is wrong.

**The two silent hazards worth re-reading before touching `src/data/species/index.ts`:** an import without an `ALL` entry is a total no-op that typechecks clean, and an *insertion* rather than an append moves the dex's paging order, which only `tests/dex.test.ts:101` weakly guards.
