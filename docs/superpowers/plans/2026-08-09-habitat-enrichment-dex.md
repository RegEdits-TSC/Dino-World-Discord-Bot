# Habitat Enrichment & The Dex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a paddock's decor composition pay a graded reward above today's ceiling, and give the 42-species roster a permanent per-player compendium.

**Architecture:** `paddockFit` splits in two — `paddockFitBase` returns today's exact three values and feeds park rating, while `paddockFit` adds an enrichment rung (1.05 at two distinct matching decor kinds, 1.10 at three) and feeds income, escape timing and display. Rating therefore stays byte-identical, so monotone `ratingHighWater` cannot grant unearned unlocks. The decor catalog grows to three kinds per biome so every species can reach the cap, `/decorate` converts to autocomplete, and a new `dex` module reads a `species_seen` side-effect record written at the three sites that mint or transfer a dino.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js v14, drizzle-orm + better-sqlite3 (synchronous), vitest.

**Spec:** `docs/superpowers/specs/2026-08-09-habitat-enrichment-dex-design.md`

**Branch:** `habitat-enrichment-dex`, already created off `park-speaks-first`. Baseline on that branch: **1245 tests / 91 files green**.

## Global Constraints

- **ESM NodeNext**: every relative import carries a `.js` extension, including in tests.
- **Time and randomness**: `ctx.now()` and `ctx.rng()` only — never `Date.now()` or `Math.random()`.
- **DB is synchronous**: drizzle/better-sqlite3 `.get()` / `.all()` / `.run()`, never awaited.
- **`npm run typecheck` before every commit.** `npm run build` does not typecheck tests, and `npm test` (vitest) transpiles without typechecking, so a type error in `tests/` or `scripts/` passes both.
- **No attribution anywhere.** No `Co-Authored-By`, no "generated with", no mention of AI, Claude, Anthropic, assistants or tooling in commits, comments, docs or code. Every artifact is authored by RegEdits.
- **`paddockFit` keeps its exact signature** `(species: Species, paddock: PaddockDef, decor: string[]) => number`. A new parameter breaks six test call sites and five `ClockDino` literals under `typecheck` only — invisible to `npm test`.
- **`comfortAt` must stay cheap**: no DB read, no per-id work. It runs once per trapezoid breakpoint per dino inside `accruedIncome`.
- **Balance numbers get their reasoning as a comment at the constant**, never only in a commit message.
- **Autocomplete providers**: `i.respond(...)` only — never `reply`, `defer`, or `getOrCreateUser`; read-only; no custom emoji tags in labels (Discord renders them as literal text).
- **Every builder change requires `npm run deploy-commands`** and exactly one running bot per token. Two builders change here (`/decorate`'s item option, and the new `/dex`), so one deploy covers both.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/core/species-seen.ts` | The `species_seen` write and batch read. Lives in `core` for the same reason `src/core/stats.ts` does: three modules write it, one reads it. |
| `src/modules/dex/index.ts` | The `dex` module manifest — `/dex list`, `/dex view`, the `dex` component prefix, and the species autocomplete provider. |
| `src/modules/dex/service.ts` | Filtering and the view model. No Discord types. |
| `src/modules/dex/embeds.ts` | `dexListPayload`, `dexViewPayload`. |
| `drizzle/0010_species_seen.sql` | `CREATE TABLE species_seen`. Generated, then verified by eye. |
| `scripts/backfill-species-seen.ts` | One-shot operator backfill from live inventory. |
| `tests/enrichment.test.ts` | The decor helpers, the fit rungs, the cap gate. |
| `tests/dex.test.ts` | The dex service, both payloads, paging, the autocomplete provider. |
| `tests/species-seen.test.ts` | The record, the three write sites, the reset, the backfill. |

**Modified:**

| File | Change |
| --- | --- |
| `src/data/decor.ts` | Eleven new kinds; `ENRICHMENT_STEPS`, `ENRICHMENT_CAP_KINDS`, `enrichingKindsFor`, `matchedKindCount`, `enrichmentMult`. |
| `src/core/clock.ts` | `paddockFitBase` / `paddockFit` split, `baseComfortAt`, `enrichmentAt`. |
| `src/modules/park/rating.ts` | Comfort term reads `baseComfortAt`. |
| `src/modules/park/dinos.ts` | `listDinos` returns `enrichment`. |
| `src/modules/park/index.ts` | `/dino list` row clamps comfort and shows enrichment; `/decorate`'s item option becomes autocompleting. |
| `src/modules/park/alert-record.ts` | `ALERT_INSTANT_EPSILON_MS` and the `alreadySent` tolerance. |
| `src/core/db/schema.ts` | `speciesSeen` table. |
| `src/modules/hatchery/service.ts`, `src/modules/admin/service.ts`, `src/modules/trading/service.ts` | The three `species_seen` write sites. |
| `src/modules/admin/service.ts` | `adminReset` deletes `species_seen`; `adminFastForward` gains the comment recording why `first_at_ms` is not shifted. |
| `src/core/module-list.ts`, `modules.json` | Register `dexModule`. |
| `src/modules/daily/service.ts` | Correct the stale `dailyEarningCapacity` ceiling comment. |
| `src/modules/help/index.ts` | The habitat topic gains the rungs. |
| `docs/gameplay.md`, `docs/commands.md`, `CLAUDE.md` | Documentation sweep. |
| `scripts/test-live.ts` | Gallery cases for the dex and an enriched roster row. |
| `tests/data.test.ts`, `tests/roster.test.ts`, `tests/clock.test.ts`, `tests/rating.test.ts`, `tests/dinos.test.ts`, `tests/alert-detect.test.ts`, `tests/alert-sweep.test.ts`, `tests/migration.test.ts`, `tests/contract.test.ts`, `tests/registry-load.test.ts`, `tests/config.test.ts`, `tests/admin.test.ts` | New coverage and the three registration counts. |

---

## Task 1: Enrichment helpers in the decor data

**Files:**
- Modify: `src/data/decor.ts`
- Test: `tests/enrichment.test.ts` (create)

**Interfaces:**
- Consumes: `DECOR` (existing), `Species` from `src/data/types.js`.
- Produces:
  - `ENRICHMENT_CAP_KINDS: number` (= 3)
  - `ENRICHMENT_STEPS: readonly number[]` (= `[1.0, 1.05, 1.1]`, indexed by matched kinds − 1)
  - `enrichingKindsFor(species: Species): string[]`
  - `matchedKindCount(species: Species, decor: string[]): number`
  - `enrichmentMult(matchedKinds: number): number`

- [ ] **Step 1: Write the failing tests**

Create `tests/enrichment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ENRICHMENT_CAP_KINDS, ENRICHMENT_STEPS, enrichingKindsFor, matchedKindCount, enrichmentMult } from '../src/data/decor.js';
import { triceratops } from '../src/data/species/triceratops.js';
import { allSpecies } from '../src/data/species/index.js';

describe('enrichmentMult', () => {
  it('is 1.0 at zero or one matching kind, then steps once per extra kind', () => {
    expect(enrichmentMult(0)).toBe(1.0);
    expect(enrichmentMult(1)).toBe(1.0);
    expect(enrichmentMult(2)).toBe(1.05);
    expect(enrichmentMult(3)).toBe(1.1);
  });
  it('clamps above the cap instead of reading past the table', () => {
    expect(enrichmentMult(ENRICHMENT_CAP_KINDS + 5)).toBe(1.1);
  });
  // Past fit 1.5 escapeAt outruns hungerZero (12/fit < 8) and a dino earns nothing
  // while its 8h grace runs. Nothing else in the codebase guards that cliff.
  it('never reaches the 1.5 escape cliff', () => {
    for (const step of ENRICHMENT_STEPS) expect(step).toBeLessThan(1.5);
  });
  it('has exactly one step per reachable kind count', () => {
    expect(ENRICHMENT_STEPS).toHaveLength(ENRICHMENT_CAP_KINDS);
  });
});

describe('matchedKindCount', () => {
  it('counts two different kinds sharing one biome tag as two', () => {
    // palm_tree and fern both carry 'forest', which triceratops wants.
    expect(matchedKindCount(triceratops, ['palm_tree', 'fern'])).toBe(2);
  });
  it('dedupes repeated slugs — decorateLot appends without dedupe', () => {
    expect(matchedKindCount(triceratops, ['palm_tree', 'palm_tree', 'palm_tree'])).toBe(1);
  });
  it('ignores unknown slugs and non-matching kinds', () => {
    expect(matchedKindCount(triceratops, ['some_retired_decor', 'ice_block', 'palm_tree'])).toBe(1);
  });
  it('is 0 for an empty paddock', () => {
    expect(matchedKindCount(triceratops, [])).toBe(0);
  });
});

describe('enrichingKindsFor', () => {
  it('returns every kind whose biomeTags intersect the species', () => {
    const kinds = enrichingKindsFor(triceratops);
    expect(kinds).toContain('palm_tree');
    expect(kinds).toContain('fern');
    expect(kinds).not.toContain('ice_block');
  });
  it('never returns duplicates, for any species', () => {
    for (const s of allSpecies()) {
      const kinds = enrichingKindsFor(s);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/enrichment.test.ts`
Expected: FAIL — no export named `ENRICHMENT_CAP_KINDS` / `enrichmentMult` from `src/data/decor.js`.

- [ ] **Step 3: Implement the helpers**

Append to `src/data/decor.ts` (keep the existing `DecorDef` interface and `DECOR` map exactly as they are):

```ts
import type { Species } from './types.js';

/** Distinct matching kinds at which the enrichment ladder tops out. */
export const ENRICHMENT_CAP_KINDS = 3;

/**
 * Enrichment multiplier by distinct matching decor kinds, indexed by count − 1.
 * Applies ONLY on top of a paddock already at fit 1.0 (correct diet, ≥1 match), so
 * index 0 is deliberately 1.0: three tests pin "one matching tile ⇒ exactly 1.0".
 *
 * Simulated 2026-08-09 against accruedIncome on the 48-slot all-legendary reference
 * park (10 lots, VC L5 + FC L3, capHours 24, facilityBonusPct 32):
 *   1.00 → 4,561,920 cash/day, escapeAt 44.000 h at hungerAtFed 100
 *   1.05 → 4,790,016 (+228,096), escapeAt 44.571 h
 *   1.10 → 5,018,112 (+456,192), escapeAt 45.091 h
 * The ceiling is 1.10 on purpose. The escape channel's total gain is bounded —
 * (25 − 25/fit)/100 × 48 h has supremum +12 h as fit → ∞ — and fit 1.5 is a cliff:
 * escapeAt < hungerZero iff 12/fit < 8, so at fit ≥ 1.5 a dino sits at comfort 0
 * earning nothing while its 8 h grace runs out. Every 0.05 also lands entirely in an
 * endgame cash surplus that is already 94% unspent.
 */
export const ENRICHMENT_STEPS: readonly number[] = [1.0, 1.05, 1.1];

/** Every decor kind that would count toward this species' enrichment. */
export function enrichingKindsFor(species: Species): string[] {
  return Object.values(DECOR)
    .filter((d) => d.biomeTags.some((tag) => species.biomeTags.includes(tag)))
    .map((d) => d.kind);
}

/**
 * Distinct decor kinds on this paddock that match the species' biomes.
 * Set-deduped because decorateLot appends with no dedupe, no cap and no removal
 * path (src/modules/park/dinos.ts), so live parks hold repeated slugs. An unknown
 * or retired slug degrades to no match rather than throwing.
 */
export function matchedKindCount(species: Species, decor: string[]): number {
  let n = 0;
  for (const kind of new Set(decor)) {
    if (DECOR[kind]?.biomeTags.some((tag) => species.biomeTags.includes(tag))) n++;
  }
  return n;
}

export function enrichmentMult(matchedKinds: number): number {
  if (matchedKinds <= 0) return 1.0;
  return ENRICHMENT_STEPS[Math.min(matchedKinds, ENRICHMENT_CAP_KINDS) - 1];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/enrichment.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/data/decor.ts tests/enrichment.test.ts
git commit -m "Add the enrichment ladder and its decor lookups"
```

---

## Task 2: Split paddockFit into base and enriched

**Files:**
- Modify: `src/core/clock.ts:46-57`
- Test: `tests/enrichment.test.ts`, `tests/clock.test.ts`

**Interfaces:**
- Consumes: `matchedKindCount`, `enrichmentMult` from Task 1.
- Produces:
  - `paddockFitBase(species: Species, paddock: PaddockDef, decor: string[]): number` — today's 0.5 / 0.75 / 1.0 only
  - `paddockFit(...)` — same signature, plus the rung
  - `baseComfortAt(d: ClockDino, at: number): number`
  - `enrichmentAt(d: ClockDino): number` — 1.0 when unassigned or below fit 1.0

- [ ] **Step 1: Write the failing tests**

Append to `tests/enrichment.test.ts`:

```ts
import { paddockFit, paddockFitBase, comfortAt, baseComfortAt, enrichmentAt } from '../src/core/clock.js';
import { PADDOCKS } from '../src/data/paddocks.js';

const herb = PADDOCKS.herbivore_paddock;
const carn = PADDOCKS.carnivore_paddock;
const dino = (decor: string[], over: Record<string, unknown> = {}) => ({
  species: triceratops, paddock: herb, decor,
  hungerAtFed: 100, lastFedAt: 0, escapedAt: null as number | null, traits: [] as string[], ...over,
});

describe('paddockFit with enrichment', () => {
  // THE BOUNDARY. One matching tile must stay exactly 1.0: tests/clock.test.ts,
  // tests/tundra.test.ts and tests/dinos.test.ts all pin that value, and it is the
  // reason no existing income or escape integer moves.
  it('is unchanged at zero and one matching kind', () => {
    expect(paddockFit(triceratops, herb, [])).toBe(0.75);
    expect(paddockFit(triceratops, herb, ['palm_tree'])).toBe(1.0);
    expect(paddockFit(triceratops, herb, ['palm_tree', 'palm_tree'])).toBe(1.0);
  });
  it('steps above 1.0 at two and three matching kinds', () => {
    expect(paddockFit(triceratops, herb, ['palm_tree', 'fern'])).toBe(1.05);
    expect(paddockFit(triceratops, herb, ['palm_tree', 'fern', 'cycad_grove'])).toBe(1.1);
  });
  it('a wrong-diet paddock stays 0.5 however enriched', () => {
    expect(paddockFit(triceratops, carn, ['palm_tree', 'fern', 'cycad_grove'])).toBe(0.5);
  });
});

describe('paddockFitBase', () => {
  it('never exceeds 1.0, whatever the decor', () => {
    expect(paddockFitBase(triceratops, herb, [])).toBe(0.75);
    expect(paddockFitBase(triceratops, herb, ['palm_tree'])).toBe(1.0);
    expect(paddockFitBase(triceratops, herb, ['palm_tree', 'fern', 'cycad_grove'])).toBe(1.0);
    expect(paddockFitBase(triceratops, carn, ['palm_tree'])).toBe(0.5);
  });
});

describe('baseComfortAt', () => {
  it('ignores enrichment while comfortAt applies it', () => {
    const enriched = dino(['palm_tree', 'fern']);
    expect(comfortAt(enriched, 0)).toBeCloseTo(1.05);
    expect(baseComfortAt(enriched, 0)).toBeCloseTo(1.0);
  });
  it('is 0 for an unassigned dino, like comfortAt', () => {
    const loose = dino(['palm_tree', 'fern'], { paddock: null });
    expect(baseComfortAt(loose, 0)).toBe(0);
  });
});

describe('enrichmentAt', () => {
  it('reports the multiplier for display', () => {
    expect(enrichmentAt(dino(['palm_tree']))).toBe(1.0);
    expect(enrichmentAt(dino(['palm_tree', 'fern']))).toBe(1.05);
  });
  it('is 1.0 when the paddock is not even at full fit', () => {
    expect(enrichmentAt(dino([]))).toBe(1.0);
    expect(enrichmentAt(dino(['palm_tree', 'fern'], { paddock: carn }))).toBe(1.0);
    expect(enrichmentAt(dino(['palm_tree', 'fern'], { paddock: null }))).toBe(1.0);
  });
});
```

Note: `cycad_grove` is added in Task 6. Until then exactly ONE assertion fails on the
missing kind — the three-kind line of "steps above 1.0 at two and three matching kinds",
which reads 1.05 instead of 1.1. The `paddockFitBase` three-kind line PASSES throughout,
because the base is a boolean gate: `palm_tree` + `fern` already match, so an unknown
third slug cannot move it off 1.0. Only `paddockFit`'s `enrichmentMult(kinds)` branch is
count-sensitive.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/enrichment.test.ts`
Expected: FAIL — `paddockFitBase`, `baseComfortAt` and `enrichmentAt` are not exported. One `cycad_grove` assertion will still fail after this task and passes in Task 6 (see the note above for why it is one and not two). Run with `-t 'is unchanged at zero and one matching kind'` to confirm the boundary test specifically.

- [ ] **Step 3: Implement the split**

Replace `src/core/clock.ts:46-57` with:

```ts
export function paddockFitBase(species: Species, paddock: PaddockDef, decor: string[]): number {
  if (paddock.diet !== species.diet) return 0.5;
  return matchedKindCount(species, decor) > 0 ? 1.0 : 0.75;
}

/**
 * Habitat fit, enrichment included. Enrichment stacks ONLY above the 1.0 case, so
 * the 0.5 and 0.75 branches are byte-identical to their pre-enrichment behaviour.
 * A step function of stored state, never of elapsed time: comfortCrossing below
 * solves the escape instant algebraically by dividing by a CONSTANT fit, and a
 * time-varying term would force a piecewise segment walk through five call sites.
 */
export function paddockFit(species: Species, paddock: PaddockDef, decor: string[]): number {
  if (paddock.diet !== species.diet) return 0.5;
  const kinds = matchedKindCount(species, decor);
  if (kinds === 0) return 0.75;
  return enrichmentMult(kinds);
}

function comfortWith(d: ClockDino, at: number, fit: number): number {
  // Overfilled dinos (fillTo up to 150) sit at full comfort until hunger drains back under 100.
  return (Math.min(100, hungerAt(d.hungerAtFed, d.lastFedAt, at, drainMsFor(d.traits))) / 100) * fit;
}

export function comfortAt(d: ClockDino, at: number): number {
  if (!d.paddock) return 0;
  return comfortWith(d, at, paddockFit(d.species, d.paddock, d.decor));
}

/**
 * Comfort WITHOUT enrichment. recomputeRating (src/modules/park/rating.ts) is the only
 * caller, and that is the whole point: rating stays byte-identical to its
 * pre-enrichment value, so monotone ratingHighWater cannot hand out lot slots, sites,
 * shop tiers or the mythic unlock nobody earned. A Math.min(1, comfort) clamp is NOT a
 * substitute — it bounds the ceiling but not the sensitivity, so a hunger-80 dino at
 * fit 1.05 would still read 0.84 instead of 0.80.
 */
export function baseComfortAt(d: ClockDino, at: number): number {
  if (!d.paddock) return 0;
  return comfortWith(d, at, paddockFitBase(d.species, d.paddock, d.decor));
}

/** The enrichment multiplier alone, for display. 1.0 unless the paddock reaches full fit. */
export function enrichmentAt(d: ClockDino): number {
  if (!d.paddock) return 1.0;
  if (paddockFitBase(d.species, d.paddock, d.decor) < 1.0) return 1.0;
  return enrichmentMult(matchedKindCount(d.species, d.decor));
}
```

Update the import at the top of `src/core/clock.ts` — it currently imports `DECOR`
only, and `DECOR` is no longer referenced directly in this file:

```ts
import { matchedKindCount, enrichmentMult } from '../data/decor.js';
```

Keep the existing comment block above `paddockFitBase` (the one explaining that
`decor` holds kind slugs, never biome tags) — move it up so it sits above the pair.

- [ ] **Step 4: Run the full offline suite**

Run: `npx vitest run`
Expected: PASS except the single `cycad_grove` assertion from Step 1. **No other test may fail.** If any pinned income, escape, comfort or rating integer moves, stop: the additive-above-1.0 premise has broken somewhere and the plan needs revisiting rather than the test being edited.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/clock.ts tests/enrichment.test.ts
git commit -m "Split paddockFit into a base value and an enriched one"
```

---

## Task 3: Point park rating at the base comfort

**Files:**
- Modify: `src/modules/park/rating.ts:4,18-22`
- Test: `tests/rating.test.ts`

**Interfaces:**
- Consumes: `baseComfortAt` from Task 2.
- Produces: no new exports. `recomputeRating`'s return shape is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/rating.test.ts` (match the file's existing setup idiom for seeding a
user, a paddock lot and an assigned dino — read the top of the file first and reuse it
rather than inventing a second helper):

```ts
  // Rating must be IDENTICAL with and without enrichment. ratingHighWater is monotone
  // (rating.ts), so any enrichment-driven gain would permanently unlock lot slots,
  // sites, the shop ceiling and the mythic egg for every existing player the day this
  // ships. Watch this test fail by pointing rating.ts at comfortAt before trusting it.
  it('enrichment does not change park rating, at full or partial hunger', () => {
    const oneKind = makeCtx();
    getOrCreateUser(oneKind, 'u1', 'Reg');
    // Three decor items in BOTH parks, but only one MATCHING kind here: grass_tuft and
    // boulder are plains, which a forest triceratops does not want. Holding decor.length
    // equal is essential — the park term is min(1, sum(level + decor.length)/40), so a
    // 1-vs-3 comparison separates the two parks by ~17 rating points that have nothing
    // to do with enrichment, and the test could never converge.
    const lotA = seedPaddock(oneKind, ['palm_tree', 'grass_tuft', 'boulder']);
    seedAssignedDino(oneKind, lotA, 'triceratops', { hunger: 80, lastFedAt: 0 });
    const before = recomputeRating(oneKind, 'u1');

    const threeKinds = makeCtx();
    getOrCreateUser(threeKinds, 'u1', 'Reg');
    const lotB = seedPaddock(threeKinds, ['palm_tree', 'fern', 'cycad_grove']);
    seedAssignedDino(threeKinds, lotB, 'triceratops', { hunger: 80, lastFedAt: 0 });
    const after = recomputeRating(threeKinds, 'u1');

    expect(after.rating).toBe(before.rating);
    expect(after.highWater).toBe(before.highWater);
    // Watched to fail before the fix: 237 (one matching kind) vs 247 (two), a 10-point
    // enrichment leak through the unclamped comfort mean.
  });

  it('a fully enriched saturated park still reports at most 1000', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const lot = seedPaddock(ctx, ['palm_tree', 'fern', 'cycad_grove']);
    seedAssignedDino(ctx, lot, 'triceratops', { hunger: 100, lastFedAt: 0 });
    const { rating } = recomputeRating(ctx, 'u1');
    expect(rating).toBeLessThanOrEqual(1000);
  });
```

Add the two seed helpers near the top of the file if the file has no equivalents:

```ts
const seedPaddock = (ctx: ReturnType<typeof makeCtx>, decor: string[]) =>
  ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock',
    level: 1, decor,
  }).returning().get().id;

const seedAssignedDino = (
  ctx: ReturnType<typeof makeCtx>, lotId: number, speciesId: string,
  over: Partial<typeof schema.dinos.$inferInsert> = {},
) => ctx.db.insert(schema.dinos).values({
  userId: 'u1', lotId, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over,
}).returning().get();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/rating.test.ts -t 'enrichment does not change park rating'`
Expected: FAIL — the three-kind park scores higher, because `recomputeRating` still reads `comfortAt`. Record the two numbers from the failure output in the commit message; they are the evidence the test can fail.

- [ ] **Step 3: Switch rating to the base comfort**

In `src/modules/park/rating.ts`, change the import on line 4:

```ts
import { baseComfortAt } from '../../core/clock.js';
```

and the comfort term at lines 19-20:

```ts
  // baseComfortAt, never comfortAt: enrichment must not move rating, because
  // ratingHighWater is monotone and gates lot slots, sites, the shop ceiling and the
  // mythic unlock. See src/core/clock.ts's comment at baseComfortAt.
  const comfort = assigned.length === 0 ? 0
    : assigned.reduce((s, d) => s + baseComfortAt(d, ctx.now()), 0) / assigned.length;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/rating.test.ts`
Expected: PASS, including the pre-existing `202` and `400` pins — both use unassigned dinos, so a leak into the `assigned.length === 0 ? 0` branch would fail them.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/rating.ts tests/rating.test.ts
git commit -m "Keep park rating on the pre-enrichment comfort value"
```

---

## Task 4: Pin the income and escape effects

**Files:**
- Test: `tests/clock.test.ts`, `tests/alert-detect.test.ts`

**Interfaces:**
- Consumes: `paddockFit`, `comfortAt`, `accruedIncome`, `escapeAt` from Task 2; `escapeAlertsFor` (existing).
- Produces: no exports. This task is coverage only — it exists because the whole point of enrichment is the two downstream numbers, and neither is asserted yet.

- [ ] **Step 1: Write the failing tests**

Append to `tests/clock.test.ts`. The two-kind fixture reuses the file's existing
`fedTrike` helper with the decor overridden:

```ts
describe('enrichment downstream', () => {
  const enriched = (over: Partial<Parameters<typeof comfortAt>[0]> = {}) =>
    fedTrike({ decor: ['palm_tree', 'fern'], ...over });

  it('comfort reads the rung at full hunger', () => {
    expect(comfortAt(enriched(), 0)).toBeCloseTo(1.05);
  });

  // 44.5714 h against 44.0 h unenriched: hungerThreshold = (0.25/1.05)*100 = 23.8095,
  // crossing = ((100 − 23.8095)/100) * 48 h = 36.5714 h, + GRACE_MS.
  it('lengthens the escape window by 34 minutes at the first rung', () => {
    expect(escapeAt(enriched())).toBeCloseTo(36.5714 * H + GRACE_MS, -3);
    expect(escapeAt(fedTrike())).toBe(36 * H + GRACE_MS);
  });

  // 462 against 440: an 8h cap window from a fresh feed, comfort falling from 1.05 to
  // 0.875 as hunger drains 100 → 83.33, times the common rate of 60/hr.
  it('raises income over the cap window', () => {
    expect(accruedIncome([enriched()], 0, 8, 0, 12 * H)).toBe(462);
    expect(accruedIncome([fedTrike()], 0, 8, 0, 12 * H)).toBe(440);
  });

  // accruedIncome splits its window at every UTC midnight and samples the world
  // multiplier at each segment's START. Enrichment is a constant factor, so the split
  // must be untouched by it — day 0 is Clear Skies, so the totals are directly
  // comparable at exactly the rung ratio.
  it('scales cleanly across a UTC-midnight crossing', () => {
    const plain = accruedIncome([fedTrike({ hungerAtFed: 150 })], 0, 24, 0, 30 * H);
    const rung = accruedIncome([enriched({ hungerAtFed: 150 })], 0, 24, 0, 30 * H);
    expect(rung).toBeGreaterThan(plain);
    expect(rung / plain).toBeCloseTo(1.05, 2);
  });
});
```

Append to `tests/alert-detect.test.ts` (reuse that file's existing `DinoLike` and
clock-dino fixtures rather than adding new ones):

```ts
  it('an enriched dino enters the heads-up window later than an unenriched one', () => {
    const plain = escapeAlertsFor([clockDino({ decor: ['palm_tree'] })], [row()], PLAIN_WARN_INSTANT);
    const rung = escapeAlertsFor([clockDino({ decor: ['palm_tree', 'fern'] })], [row()], PLAIN_WARN_INSTANT);
    expect(plain).toHaveLength(1);
    expect(plain[0].tier).toBe('heads_up');
    // 34 minutes of extra runway is enough to push it clear of the 12h lead at the
    // instant the unenriched dino qualifies.
    expect(rung).toHaveLength(0);
  });
```

`PLAIN_WARN_INSTANT` is `36 * H + GRACE_MS - ESCAPE_WARN_MS` — the instant an
unenriched, fed-to-100 dino first has exactly 12 h left. Define it as a local const
beside the fixtures.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/clock.test.ts tests/alert-detect.test.ts`
Expected: FAIL on the new tests only — the implementation from Task 2 is already in place, so if these pass immediately, the fixtures are not actually reaching two matching kinds. Check that `fern` and `palm_tree` both carry `forest` and that `triceratops` wants `forest`.

- [ ] **Step 3: No implementation needed**

These tests exercise Task 2's code. If any fails, fix Task 2 rather than the test.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS except the single `cycad_grove` assertion still pending Task 6.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add tests/clock.test.ts tests/alert-detect.test.ts
git commit -m "Pin the income and escape effects of an enriched paddock"
```

---

## Task 5: Show enrichment in the roster

**Files:**
- Modify: `src/modules/park/dinos.ts:8,77-86`, `src/modules/park/index.ts:44-70`
- Test: `tests/dinos.test.ts`

**Interfaces:**
- Consumes: `enrichmentAt` from Task 2.
- Produces: `listDinos` rows gain `enrichment: number`. Consumers: `dinoListPayload` only.

- [ ] **Step 1: Write the failing test**

Append to `tests/dinos.test.ts`:

```ts
  it('reports enrichment alongside comfort', () => {
    // Reuse this file's existing seed helpers for the user, paddock and dino.
    const rows = listDinos(ctx, 'u1');
    expect(rows[0].comfort).toBeCloseTo(1.05);
    expect(rows[0].enrichment).toBe(1.05);
  });

  it('the roster row clamps comfort at 100% and shows the rung separately', async () => {
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'dino')!.execute(ctx, i.asChatInput());
    const text = JSON.stringify(i.replies[0]);
    expect(text).toContain('100% comfort');
    expect(text).toContain('enriched +5%');
    expect(text).not.toContain('105% comfort');
  });
```

The first test needs the paddock seeded with `['palm_tree', 'fern']` and a
`triceratops` assigned to it, fed to 100 at `lastFedAt: 0` with `ctx` at time 0.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dinos.test.ts -t 'enrichment'`
Expected: FAIL — `rows[0].enrichment` is `undefined`, and the payload prints `105% comfort`.

- [ ] **Step 3: Implement both changes**

In `src/modules/park/dinos.ts`, extend the import on line 8 and the mapped row:

```ts
import { comfortAt, escapeAt, enrichmentAt } from '../../core/clock.js';
```

```ts
  return dinos.map((d, i) => ({
    dino: d,
    species: getSpecies(d.speciesId),
    comfort: comfortAt(clockDinos[i], ctx.now()),
    enrichment: enrichmentAt(clockDinos[i]),
    escapeAt: escapeAt(clockDinos[i]),
    mismatch: clockDinos[i].paddock !== null && clockDinos[i].paddock!.diet !== clockDinos[i].species.diet,
  }));
```

In `src/modules/park/index.ts`'s `dinoListPayload`, replace the `status` line:

```ts
        // Comfort is clamped for display only: the raw value drives income and the
        // escape instant, but "is this animal all right" is a 0-100% question, and
        // docs/gameplay.md states in writing that it does not exceed 100%. The rung
        // gets its own mark so the player can see what the decor bought.
        const comfortPct = Math.round(Math.min(1, d.comfort) * 100);
        const rung = d.enrichment > 1 ? ` · enriched +${Math.round((d.enrichment - 1) * 100)}%` : '';
        const status = d.dino.escapedAt !== null
          ? `${emojiTag('dw_alert')} ESCAPED — /rescue`
          : `${comfortPct}% comfort${rung}`;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dinos.test.ts`
Expected: PASS. The pre-existing `grass_tuft → 1.0` / `palm_tree → 0.75` end-to-end assertions must still pass unchanged.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/dinos.ts src/modules/park/index.ts tests/dinos.test.ts
git commit -m "Show the enrichment rung on the dino roster"
```

---

## Task 6: Equalize the decor catalog

**Files:**
- Modify: `src/data/decor.ts`
- Test: `tests/roster.test.ts:40-47`, `tests/data.test.ts`, `tests/enrichment.test.ts`

**Interfaces:**
- Consumes: `ENRICHMENT_CAP_KINDS`, `enrichingKindsFor` from Task 1.
- Produces: eleven new `DECOR` entries. Consumers: `/decorate`'s option (Task 7), the shop listing, `enrichingKindsFor`.

**Why:** on the 12-kind table, coast, tundra and volcanic each offer exactly one kind, so four species (`ceratosaurus`, `quetzalcoatlus`, `cryolophosaurus`, `nanuqsaurus`) cannot reach even the first rung, and thirty-eight cannot reach the cap.

- [ ] **Step 1: Write the failing tests**

Replace the existing test at `tests/roster.test.ts:40-47` with the stronger property,
keeping its comment block:

```ts
  it('every species can reach the enrichment cap', () => {
    for (const s of allSpecies()) {
      expect(
        enrichingKindsFor(s).length,
        `${s.id} (biomes ${s.biomeTags.join(',')}) can only ever match ${enrichingKindsFor(s).length} decor kinds`,
      ).toBeGreaterThanOrEqual(ENRICHMENT_CAP_KINDS);
    }
  });
  it('every biome tag any species wants is offered by at least the cap in distinct kinds', () => {
    const wanted = new Set(allSpecies().flatMap((s) => s.biomeTags));
    for (const tag of wanted) {
      const kinds = Object.values(DECOR).filter((d) => d.biomeTags.includes(tag));
      expect(kinds.length, `biome '${tag}' is offered by only ${kinds.length} kinds`)
        .toBeGreaterThanOrEqual(ENRICHMENT_CAP_KINDS);
    }
  });
```

Add to `tests/data.test.ts` — `RARITY`, `FACILITIES` and `PADDOCKS` each have a value
pin and `DECOR` has none, so a mistyped biome tag or a missing cost currently ships
green:

```ts
  it('DECOR values match the spec', () => {
    expect(Object.keys(DECOR)).toHaveLength(23);
    for (const [key, d] of Object.entries(DECOR)) {
      expect(d.kind).toBe(key);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.biomeTags.length).toBeGreaterThan(0);
      expect(d.cost).toBeGreaterThan(0);
    }
    expect(DECOR.palm_tree).toEqual({ kind: 'palm_tree', name: 'Palm Tree', biomeTags: ['forest'], cost: 500 });
    expect(DECOR.fern).toEqual({ kind: 'fern', name: 'Fern Cluster', biomeTags: ['forest', 'swamp'], cost: 500 });
    expect(DECOR.cycad_grove).toEqual({ kind: 'cycad_grove', name: 'Cycad Grove', biomeTags: ['forest'], cost: 600 });
    expect(DECOR.snow_drift).toEqual({ kind: 'snow_drift', name: 'Snow Drift', biomeTags: ['tundra'], cost: 650 });
    expect(DECOR.basalt_column).toEqual({ kind: 'basalt_column', name: 'Basalt Column', biomeTags: ['volcanic'], cost: 900 });
  });
  // /shop view renders every kind into ONE embed field, capped at 1024 chars by Discord.
  it('the shop decor line fits in an embed field', () => {
    const line = Object.values(DECOR).map((d) => `${d.name} (${d.cost})`).join(' · ');
    expect(line.length).toBeLessThan(1024);
  });
```

Import `DECOR` in `tests/data.test.ts`, and `enrichingKindsFor` / `ENRICHMENT_CAP_KINDS` in `tests/roster.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/roster.test.ts tests/data.test.ts`
Expected: FAIL — the reachability test names `ceratosaurus` (or another of the four) as matching only 1 kind, and `Object.keys(DECOR)` is 12, not 23.

- [ ] **Step 3: Add the eleven kinds**

Append to the `DECOR` map in `src/data/decor.ts`, keeping the existing twelve exactly
as they are. Costs sit in the same band as each biome's existing kinds:

```ts
  // Three kinds per biome is the enrichment cap's precondition: on the original
  // twelve-kind table coast, tundra and volcanic offered one kind each, so four
  // species could not reach even the first rung. tests/roster.test.ts gates it.
  cycad_grove:    { kind: 'cycad_grove', name: 'Cycad Grove', biomeTags: ['forest'], cost: 600 },
  termite_mound:  { kind: 'termite_mound', name: 'Termite Mound', biomeTags: ['plains'], cost: 550 },
  mangrove_root:  { kind: 'mangrove_root', name: 'Mangrove Root', biomeTags: ['swamp'], cost: 650 },
  coral_shelf:    { kind: 'coral_shelf', name: 'Coral Shelf', biomeTags: ['marine'], cost: 1_000 },
  warning_klaxon: { kind: 'warning_klaxon', name: 'Warning Klaxon', biomeTags: ['containment'], cost: 1_100 },
  driftwood_pile: { kind: 'driftwood_pile', name: 'Driftwood Pile', biomeTags: ['coast'], cost: 750 },
  dune_grass:     { kind: 'dune_grass', name: 'Dune Grass', biomeTags: ['coast'], cost: 650 },
  snow_drift:     { kind: 'snow_drift', name: 'Snow Drift', biomeTags: ['tundra'], cost: 650 },
  frost_pine:     { kind: 'frost_pine', name: 'Frost Pine', biomeTags: ['tundra'], cost: 800 },
  ash_vent:       { kind: 'ash_vent', name: 'Ash Vent', biomeTags: ['volcanic'], cost: 850 },
  basalt_column:  { kind: 'basalt_column', name: 'Basalt Column', biomeTags: ['volcanic'], cost: 900 },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/roster.test.ts tests/data.test.ts tests/enrichment.test.ts`
Expected: PASS — including the `cycad_grove` assertion from Task 2, which has been failing until now.

Then run the full suite: `npx vitest run`. Expected: all green. One thing to watch: `/decorate`'s builder now holds 23 static choices against Discord's cap of 25. `addChoices` throws at the 26th during module init, which is a bot-boot crash rather than a degrade, so `tests/contract.test.ts` passing here is load-bearing. Task 7 removes the ceiling.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/data/decor.ts tests/roster.test.ts tests/data.test.ts
git commit -m "Give every biome three decor kinds and pin the table"
```

---

## Task 7: Convert /decorate's item option to autocomplete

**Files:**
- Modify: `src/modules/park/index.ts:279-281` (builder), and the existing `autocomplete` on that command
- Test: `tests/park.test.ts` or `tests/dinos.test.ts` (whichever already exercises `/decorate` — check first), `tests/contract.test.ts:12`

**Interfaces:**
- Consumes: `DECOR` (Task 6), `matches` / `respondRanked` / `emptyRow` from `src/core/autocomplete.js`.
- Produces: no new exports. `/decorate`'s `item` option becomes `setAutocomplete(true)` and the command's single `autocomplete` handler now serves two options, switching on `i.options.getFocused(true).name`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('suggests decor kinds with their biomes and cost', async () => {
    const i = fakeAutocomplete({
      name: 'decorate', user: 'u1',
      focused: { name: 'item', value: 'fern' },
      options: { lot: 1 },
    });
    await parkModule.commands.find((c) => c.data.name === 'decorate')!.autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: string }>;
    expect(rows.some((r) => r.value === 'fern')).toBe(true);
    // The biomes are in the label because a decor purchase is permanent: there is no
    // removal or refund path short of adminReset, so the buying surface is the only
    // place a mistake can be prevented.
    expect(rows.find((r) => r.value === 'fern')!.name).toContain('forest');
    expect(rows.find((r) => r.value === 'fern')!.name).toContain('swamp');
  });

  it('still suggests paddocks on the lot option', async () => {
    const i = fakeAutocomplete({
      name: 'decorate', user: 'u1',
      focused: { name: 'lot', value: '' },
    });
    await parkModule.commands.find((c) => c.data.name === 'decorate')!.autocomplete!(ctx, i.asAutocomplete());
    expect((i.replies[0] as unknown[]).length).toBeGreaterThan(0);
  });

  it('never puts a custom emoji tag in a decor label', async () => {
    const i = fakeAutocomplete({
      name: 'decorate', user: 'u1', focused: { name: 'item', value: '' },
    });
    await parkModule.commands.find((c) => c.data.name === 'decorate')!.autocomplete!(ctx, i.asAutocomplete());
    for (const r of i.replies[0] as Array<{ name: string }>) expect(r.name).not.toMatch(/<a?:\w+:\d+>/);
  });
```

The first two need a seeded user and at least one paddock lot — reuse the file's
existing helpers.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/park.test.ts -t 'decor kinds'`
Expected: FAIL — `fakeAutocomplete` throws `option 'item' does not set autocomplete in the builder`, which is the harness enforcing the builder/handler contract.

- [ ] **Step 3: Convert the builder and extend the provider**

In `src/modules/park/index.ts`, change the `item` option:

```ts
        .addStringOption((o) => o.setName('item').setDescription('Decoration — type to search').setRequired(true).setAutocomplete(true))),
```

and replace the command's `autocomplete` body so it serves both options:

```ts
      async autocomplete(ctx, i) {
        const focused = i.options.getFocused(true);
        if (focused.name === 'item') {
          // Static data only — no DB read, no user row. Biomes and cost are in the
          // label because the purchase is permanent.
          await respondRanked(i, Object.values(DECOR)
            .filter((d) => matches(String(focused.value), d.name, d.kind, ...d.biomeTags))
            .map((d) => ({
              value: d.kind, valid: true,
              label: `${d.name} — ${d.biomeTags.join('/')} — ${d.cost} cash`,
            })));
          return;
        }
        const paddocks = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all()
          .filter((l) => l.type === 'paddock');
        if (!paddocks.length) { await respondRanked(i, [emptyRow('No paddocks — /build one first', 0)]); return; }
        const q = String(focused.value);
        await respondRanked(i, paddocks
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => ({ value: l.id, valid: true, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})` })));
      },
```

Add the `item` entry to `AUTOCOMPLETE_OPTIONS` in `tests/contract.test.ts:12` — the
manifest check at `:58-66` is bidirectional, so a flagged option missing from the map
fails and a mapped option that is not flagged fails too. Match the file's existing key
format for a top-level command's option.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/park.test.ts tests/contract.test.ts`
Expected: PASS. `respondRanked` truncates to 25 rows, so the 23-kind list is served whole and the static-choice cap is gone for good.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/index.ts tests/park.test.ts tests/contract.test.ts
git commit -m "Serve decor kinds through autocomplete instead of static choices"
```

---

## Task 8: Give the alert record an instant tolerance

**Files:**
- Modify: `src/modules/park/alert-record.ts:11-35`
- Test: `tests/alert-sweep.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ALERT_INSTANT_EPSILON_MS: number` (= 2 h). `alreadySent`'s signature is unchanged.

**Why:** a rung moves the escape instant only 34–65 minutes, which leaves the dino
*inside* the 12 h heads-up window — unlike feeding, which pushes it clear. Since
`alreadySent` compares `firedForMs` exactly, every decor purchase would earn a fresh
DM, up to four per hour per user at `SWEEP_MS` 15 minutes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/alert-sweep.test.ts`, reusing the file's existing sweep harness:

```ts
  it('decorating a warned dino does not earn a second heads-up', () => {
    // Seed a dino already inside the 12h window with one matching kind, sweep once,
    // then add a second matching kind and sweep again. The instant moves 34 minutes,
    // which is inside ALERT_INSTANT_EPSILON_MS.
    runSweep(ctx);
    expect(sends(ctx)).toHaveLength(1);
    ctx.db.update(schema.lots).set({ decor: ['palm_tree', 'fern'] })
      .where(eq(schema.lots.id, lotId)).run();
    runSweep(ctx);
    expect(sends(ctx)).toHaveLength(1);
  });

  it('an instant that moves beyond the epsilon still earns exactly one fresh warning', () => {
    runSweep(ctx);
    expect(sends(ctx)).toHaveLength(1);
    // A three-hour move: past the tolerance, so the player is warned about the new
    // instant — the behaviour the firedForMs comparison exists to provide.
    ctx.db.update(schema.dinos).set({ lastFedAt: 3 * 3_600_000 })
      .where(eq(schema.dinos.id, dinoId)).run();
    runSweep(ctx);
    expect(sends(ctx)).toHaveLength(2);
    runSweep(ctx);
    expect(sends(ctx)).toHaveLength(2);
  });
```

Append to `tests/alert-detect.test.ts` or wherever `alreadySent` is unit-tested:

```ts
  it('treats an instant within the epsilon as already warned, in both directions', () => {
    recordSent(ctx, 'u1', 'escape', 1, 'heads_up', 100 * 3_600_000);
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', 100 * 3_600_000)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', 101 * 3_600_000)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', 99 * 3_600_000)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 1, 'heads_up', 103 * 3_600_000)).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/alert-sweep.test.ts -t 'does not earn a second heads-up'`
Expected: FAIL with 2 sends instead of 1 — this is the defect the tolerance fixes, observed rather than assumed.

- [ ] **Step 3: Implement the tolerance**

In `src/modules/park/alert-record.ts`, add the constant beside `ESCAPE_LAST_CALL_MS`:

```ts
/**
 * How far an alert instant may move before it counts as a genuinely new instant.
 *
 * Enrichment moves a dino's escapeAt by only 34-65 minutes (one or two rungs), which
 * leaves it inside the 12h heads-up window — so an exact firedForMs comparison would
 * send a fresh DM on every decor purchase, up to four an hour at SWEEP_MS. Two hours
 * sits above the largest enrichment move and below the smallest move any care action
 * produces: feeding shifts the instant by a day or more and usually clear of the
 * window entirely, and an income-cap capAt only moves when lastCollectAt moves (by at
 * least capHours, 8h) or the Visitor Center is upgraded (by 4h).
 *
 * Row existence alone is NOT an alternative: it would suppress the legitimate case
 * where a fed dino leaves the window and later re-enters it with a genuinely new
 * instant, which is exactly what comparing firedForMs exists to prevent.
 */
export const ALERT_INSTANT_EPSILON_MS = 2 * 3_600_000;
```

and change `alreadySent`'s final line:

```ts
  return row !== undefined && Math.abs(row.firedForMs - firedForMs) <= ALERT_INSTANT_EPSILON_MS;
```

Update that function's doc comment to name the tolerance rather than an exact match.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/alert-sweep.test.ts tests/alert-detect.test.ts`
Expected: PASS. Watch specifically that the pre-existing idempotency tests — "a moved instant earns one fresh warning" and the tier-collapse tests — still pass; if one now fails, its instant moves by less than 2 h and the fixture needs a larger move, not a smaller epsilon.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/alert-record.ts tests/alert-sweep.test.ts tests/alert-detect.test.ts
git commit -m "Tolerate small escape-instant moves in the alert record"
```

---

## Task 9: The species_seen table and migration 0010

**Files:**
- Modify: `src/core/db/schema.ts` (append after `alertsSent`)
- Create: `drizzle/0010_species_seen.sql` (generated)
- Test: `tests/migration.test.ts`

**Interfaces:**
- Produces: `schema.speciesSeen` with columns `userId` (`user_id`), `speciesId` (`species_id`), `firstAt` (`first_at_ms`), composite PK `(userId, speciesId)`, FK `userId → users.discordId`.

- [ ] **Step 1: Write the failing migration test**

Append to `tests/migration.test.ts`, copying the 0009 block's recipe exactly — scratch
dir, journal filtered to `idx <= 9`, `foreign_keys = ON`, a parent `users` row **and** a
child `dinos` row, then the real `migrateDb`. Anything less is a false green, as that
file's own comment says:

```ts
describe('0010 species_seen via the real drizzle migrator (production path)', () => {
  it('creates species_seen, enforces its key, and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig10-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-9].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 9);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0009 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      // The child row the FK bracket exists to protect survived.
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      sqlite.prepare(`INSERT INTO species_seen (user_id, species_id, first_at_ms)
                      VALUES ('u1', 'triceratops', 500)`).run();
      expect(() => sqlite.prepare(`INSERT INTO species_seen (user_id, species_id, first_at_ms)
                      VALUES ('u1', 'triceratops', 900)`).run()).toThrow();
      // The FK is real: an unknown owner is rejected.
      expect(() => sqlite.prepare(`INSERT INTO species_seen (user_id, species_id, first_at_ms)
                      VALUES ('nobody', 'triceratops', 500)`).run()).toThrow();
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/migration.test.ts -t '0010'`
Expected: FAIL — `no such table: species_seen`.

- [ ] **Step 3: Add the table and generate the migration**

Append to `src/core/db/schema.ts`:

```ts
// Which species a player has EVER owned. Like alerts_sent above, this records that a
// side effect happened — it is NOT derived state, and it deliberately cannot be
// re-derived: ownership is destructive (/sell deletes the dino, trading moves it,
// adminReset deletes it) and tx_log carries no species column, so live inventory
// cannot answer "have they ever had one". firstAt is the earliest acquisition, kept
// by INSERT OR IGNORE on the composite key rather than overwritten.
export const speciesSeen = sqliteTable('species_seen', {
  userId: text('user_id').notNull().references(() => users.discordId),
  speciesId: text('species_id').notNull(),
  firstAt: integer('first_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.speciesId] })]);
```

Then generate:

```bash
npx drizzle-kit generate
```

**Verify the emitted SQL by reading it.** It must be a bare `CREATE TABLE` plus its
FK, with no `__new_users`, no `DROP TABLE`, no `INSERT INTO __new_`. A table-recreate
passes every empty-DB test and **fails on a populated production database even with
`migrateDb`'s FK bracket**, because `PRAGMA foreign_keys` is a no-op inside drizzle's
per-migration transaction. If drizzle-kit emits a recreate, delete the generated file,
hand-write `drizzle/0010_species_seen.sql`, and add the matching `meta/_journal.json`
entry with `idx: 10`. The expected content:

```sql
CREATE TABLE `species_seen` (
	`user_id` text NOT NULL,
	`species_id` text NOT NULL,
	`first_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `species_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS, all migration blocks including the new one.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/db/schema.ts drizzle/0010_species_seen.sql drizzle/meta tests/migration.test.ts
git commit -m "Add the species_seen table and migration 0010"
```

---

## Task 10: The species-seen record

**Files:**
- Create: `src/core/species-seen.ts`
- Test: `tests/species-seen.test.ts` (create)

**Interfaces:**
- Consumes: `schema.speciesSeen` from Task 9, `Ctx`.
- Produces:
  - `recordSpeciesSeen(ctx: Ctx, userId: string, speciesId: string): void`
  - `seenSpecies(ctx: Ctx, userId: string): Set<string>`
  - `firstSeenAt(ctx: Ctx, userId: string, speciesId: string): number | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/species-seen.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen, seenSpecies, firstSeenAt } from '../src/core/species-seen.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

describe('species-seen record', () => {
  it('records a species and reads it back', () => {
    ctx.setNow(500);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(seenSpecies(ctx, 'u1')).toEqual(new Set(['triceratops']));
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(500);
  });
  it('keeps the FIRST instant when the same species returns', () => {
    ctx.setNow(500);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    ctx.setNow(9_000);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(500);
  });
  it('is per user', () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(seenSpecies(ctx, 'u2').size).toBe(0);
  });
  it('reads an empty set for a player who has seen nothing', () => {
    expect(seenSpecies(ctx, 'u1')).toEqual(new Set());
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/species-seen.test.ts`
Expected: FAIL — cannot resolve `../src/core/species-seen.js`.

- [ ] **Step 3: Implement the record**

Create `src/core/species-seen.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { schema } from './db/index.js';
import type { Ctx } from './context.js';

/**
 * Credit a player with a species. Idempotent by the composite key, so the first
 * acquisition's instant survives every later one. Lives in core, not in the dex
 * module, for the same reason track() does (src/core/stats.ts): three modules write
 * it and one reads it.
 *
 * Every call site sits inside the transaction that mints or transfers the dino — a
 * rolled-back hatch or trade must not leave a credit behind.
 */
export function recordSpeciesSeen(ctx: Ctx, userId: string, speciesId: string): void {
  ctx.db.insert(schema.speciesSeen)
    .values({ userId, speciesId, firstAt: ctx.now() })
    .onConflictDoNothing().run();
}

/**
 * The player's whole seen set, in ONE query. Batch-per-user, never per-species: the
 * dex renders 42 rows and a per-id lookup would be the N+1 the escrow locks
 * (src/core/locks.ts) exist to forbid.
 */
export function seenSpecies(ctx: Ctx, userId: string): Set<string> {
  return new Set(ctx.db.select().from(schema.speciesSeen)
    .where(eq(schema.speciesSeen.userId, userId)).all()
    .map((r) => r.speciesId));
}

export function firstSeenAt(ctx: Ctx, userId: string, speciesId: string): number | null {
  const row = ctx.db.select().from(schema.speciesSeen)
    .where(and(eq(schema.speciesSeen.userId, userId), eq(schema.speciesSeen.speciesId, speciesId)))
    .get();
  return row?.firstAt ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/species-seen.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/species-seen.ts tests/species-seen.test.ts
git commit -m "Add the species-seen record and its batched read"
```

---

## Task 11: Wire the three write sites

**Files:**
- Modify: `src/modules/hatchery/service.ts` (inside `hatchEgg`'s transaction, beside the existing `track` call), `src/modules/admin/service.ts` (`adminGive`'s dino branch), `src/modules/trading/service.ts` (`moveItems`)
- Test: `tests/species-seen.test.ts`

**Interfaces:**
- Consumes: `recordSpeciesSeen` from Task 10.
- Produces: no new exports.

**Why these three:** `insert(schema.dinos)` appears at exactly two sites in the
codebase — `hatchEgg` and `adminGive` — and `moveItems` is the only path that changes a
dino's owner, so without it a trade recipient is never credited for a species they now
own.

- [ ] **Step 1: Write the failing tests**

Append to `tests/species-seen.test.ts`:

```ts
describe('write sites', () => {
  it('hatching credits the species', () => {
    // Seed an egg whose species is fixed, incubate and hatch it through the real
    // service, then assert the credit. Reuse tests/hatchery.test.ts's seeding idiom.
    const { species } = hatchEgg(ctx, 'u1', eggId);
    expect(seenSpecies(ctx, 'u1').has(species.id)).toBe(true);
  });

  it('admin give credits the species', () => {
    adminGive(ctx, 'u1', 'Reg', { dinoSpecies: 'triceratops' });
    expect(seenSpecies(ctx, 'u1').has('triceratops')).toBe(true);
  });

  it('a trade credits the RECIPIENT for the dino they receive', () => {
    // Build a pending trade offering u1's triceratops to u2, then accept it.
    acceptTrade(ctx, 'u2', tradeId);
    expect(seenSpecies(ctx, 'u2').has('triceratops')).toBe(true);
  });

  it('a rolled-back hatch leaves no credit', () => {
    // ctx.economy.apply throws on insufficient funds inside the same transaction;
    // assert the species is absent afterwards. If hatchEgg has no failure path that
    // aborts after the insert, drive this through a transaction that throws in a test
    // double instead of contriving one in production code.
    expect(seenSpecies(ctx, 'u1').size).toBe(0);
  });
});
```

Fill in the seeding using each module's own test file as the template — `adminGive`'s
exact option-bag shape is in `src/modules/admin/service.ts`, and the trade setup is in
`tests/trading.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/species-seen.test.ts -t 'write sites'`
Expected: FAIL — three of the four assert `true` and get `false`.

- [ ] **Step 3: Add the three calls**

`src/modules/hatchery/service.ts`, inside `hatchEgg`'s `ctx.db.transaction`, directly
after the existing `track(ctx, userId, 'eggs_hatched', 1);`:

```ts
    // Inside the transaction on purpose: a rolled-back hatch must not credit the dex.
    recordSpeciesSeen(ctx, userId, species.id);
```

`src/modules/admin/service.ts`, in `adminGive`'s dino branch:

```ts
    if (dinoSpecies) {
      ctx.db.insert(schema.dinos).values({
        userId: targetId, lotId: null, speciesId: dinoSpecies, hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      }).run();
      recordSpeciesSeen(ctx, targetId, dinoSpecies);
    }
```

`src/modules/trading/service.ts`, in `moveItems` — the dinos being moved must be read
before the update, because after it they belong to the new owner and the id list is the
only handle:

```ts
function moveItems(ctx: Ctx, side: TradeSide, toUser: string): void {
  if (side.dinoIds.length) {
    // Credit the RECIPIENT's dex before the ownership change: a traded dino is a
    // species that player now owns, and nothing else on this path records it.
    const moving = ctx.db.select().from(schema.dinos)
      .where(inArray(schema.dinos.id, side.dinoIds)).all();
    for (const d of moving) recordSpeciesSeen(ctx, toUser, d.speciesId);
    ctx.db.update(schema.dinos)
      .set({ userId: toUser, lotId: null, viaTrade: true })
      .where(inArray(schema.dinos.id, side.dinoIds)).run();
  }
  if (side.eggIds.length) ctx.db.update(schema.eggs)
    .set({ userId: toUser, viaTrade: true })
    .where(inArray(schema.eggs.id, side.eggIds)).run();
}
```

Eggs are deliberately **not** credited: an egg's `speciesId` is nullable — wild eggs
roll their species at hatch — and `hatchEgg` credits the hatcher anyway.

Add the import to each of the three files:

```ts
import { recordSpeciesSeen } from '../../core/species-seen.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/species-seen.test.ts tests/hatchery.test.ts tests/trading.test.ts tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/hatchery/service.ts src/modules/admin/service.ts src/modules/trading/service.ts tests/species-seen.test.ts
git commit -m "Credit the dex when a dino is hatched, granted, or traded in"
```

---

## Task 12: Admin reset and fast-forward

**Files:**
- Modify: `src/modules/admin/service.ts` (`adminReset`'s delete list, `adminFastForward`'s comment block)
- Test: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `schema.speciesSeen`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `tests/admin.test.ts`:

```ts
  it('reset clears the species-seen record', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    adminReset(ctx, 'u1');
    expect(seenSpecies(ctx, 'u1').size).toBe(0);
  });

  it('fast-forward leaves first_at_ms alone', () => {
    ctx.setNow(10 * 3_600_000);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const before = firstSeenAt(ctx, 'u1', 'triceratops');
    adminFastForward(ctx, 'u1', 48);
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(before);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/admin.test.ts -t 'species-seen'`
Expected: FAIL on the reset test (the row survives). The fast-forward test passes already; it is a lock on the deliberate omission, and Step 3 records why in a comment so a future reader does not "fix" it.

- [ ] **Step 3: Add the delete and the comment**

In `adminReset`, after the `alertsSent` delete:

```ts
    // Same rule again: reset must delete from every table the feature reads. A
    // surviving species_seen row would leave a "fresh" account with a partly complete
    // dex. Unlike alertsEnabled below, this is progress, not communication consent.
    ctx.db.delete(schema.speciesSeen).where(eq(schema.speciesSeen.userId, targetId)).run();
```

In `adminFastForward`'s comment block, add:

```ts
// species_seen.first_at_ms is deliberately NOT shifted. It is a historical record with
// no timer semantics — nothing reads it to decide whether something is due — so
// shifting it would only misdate a discovery. Contrast breedings.readyAt, which IS a
// timer and is a genuine omission here.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/admin/service.ts tests/admin.test.ts
git commit -m "Clear the species-seen record on admin reset"
```

---

## Task 13: The backfill script

**Files:**
- Create: `scripts/backfill-species-seen.ts`
- Modify: `package.json` (one script entry)
- Test: `tests/species-seen.test.ts`

**Interfaces:**
- Consumes: `schema.speciesSeen`, `schema.dinos`.
- Produces: `backfillSpeciesSeen(db): number` — exported from the script so it is testable, returning the number of rows credited.

- [ ] **Step 1: Write the failing test**

Append to `tests/species-seen.test.ts`:

```ts
describe('backfill', () => {
  it('credits every species a player currently owns, dated to the hatch', () => {
    ctx.db.insert(schema.dinos).values([
      { userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 700 },
      { userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 200 },
      { userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 900 },
    ]).run();
    const n = backfillSpeciesSeen(ctx.db);
    expect(n).toBe(2);
    expect(seenSpecies(ctx, 'u1')).toEqual(new Set(['triceratops', 'velociraptor']));
    // The EARLIEST hatch wins, not whichever row the scan happened to see first.
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(200);
  });

  it('is safe to run twice and never overwrites a real credit', () => {
    ctx.setNow(50);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 700,
    }).run();
    backfillSpeciesSeen(ctx.db);
    backfillSpeciesSeen(ctx.db);
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/species-seen.test.ts -t 'backfill'`
Expected: FAIL — cannot resolve the script import.

- [ ] **Step 3: Write the script**

Create `scripts/backfill-species-seen.ts`:

```ts
import { sql } from 'drizzle-orm';
import { createDb, migrateDb } from '../src/core/db/index.js';

type Db = ReturnType<typeof createDb>;

/**
 * One-shot backfill: credit every player for the species they currently own.
 *
 * Run once, AFTER migration 0010 and never as migration SQL — a failure here must not
 * block boot, and re-running must be safe. INSERT OR IGNORE plus MIN(hatched_at_ms)
 * means a real credit written by recordSpeciesSeen always wins, and the earliest hatch
 * is used rather than the run time.
 *
 * History is not recoverable: tx_log has no species column, so a species a player sold
 * before this ran reads as never owned. That is the accepted cost of the live-inventory
 * backfill, chosen over shipping empty (a 10-star park reading 0/42) or crediting by
 * rating tier (which would fabricate history).
 */
export function backfillSpeciesSeen(db: Db): number {
  const before = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM species_seen`)!.c;
  db.run(sql`
    INSERT OR IGNORE INTO species_seen (user_id, species_id, first_at_ms)
    SELECT user_id, species_id, MIN(hatched_at_ms) FROM dinos GROUP BY user_id, species_id
  `);
  const after = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM species_seen`)!.c;
  return after - before;
}

if (process.argv[1] && process.argv[1].endsWith('backfill-species-seen.ts')) {
  const db = createDb();
  migrateDb(db);
  const n = backfillSpeciesSeen(db);
  console.log(`species_seen: ${n} rows credited`);
}
```

Check `src/core/db/index.ts` for `createDb`'s actual export name and signature before
writing the entry block, and match how `scripts/test-live.ts` bootstraps. If the db
helper exposes `.get`/`.run` differently, use `db.$client.prepare(...)` instead — the
raw-SQL shape matters less than that the statement is one `INSERT OR IGNORE ... SELECT`.

Add to `package.json`:

```json
    "backfill-species-seen": "tsx scripts/backfill-species-seen.ts",
```

Match the runner the other script entries use (`tsx` vs `node --loader`) rather than
assuming.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/species-seen.test.ts`
Expected: PASS, all groups.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add scripts/backfill-species-seen.ts package.json tests/species-seen.test.ts
git commit -m "Add the one-shot species-seen backfill"
```

---

## Task 14: The dex service

**Files:**
- Create: `src/modules/dex/service.ts`
- Test: `tests/dex.test.ts` (create)

**Interfaces:**
- Consumes: `allSpecies` / `getSpecies` from `src/data/species/index.js`, `RARITY`, `seenSpecies` / `firstSeenAt` from Task 10, `enrichingKindsFor` from Task 1.
- Produces:
  - `export interface DexFilters { rarity?: Rarity; diet?: Diet; archetype?: Archetype }`
  - `export interface DexRow { species: Species; seen: boolean }`
  - `dexRows(ctx: Ctx, userId: string, filters: DexFilters): DexRow[]`
  - `export interface DexEntry { species: Species; seen: boolean; firstAt: number | null; incubationMs: number; incomePerHr: number; enrichingKinds: string[] }`
  - `dexEntry(ctx: Ctx, userId: string, speciesId: string): DexEntry`
  - `dexProgress(ctx: Ctx, userId: string): { seen: number; total: number }`

- [ ] **Step 1: Write the failing tests**

Create `tests/dex.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen } from '../src/core/species-seen.js';
import { dexRows, dexEntry, dexProgress } from '../src/modules/dex/service.js';
import { allSpecies } from '../src/data/species/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

describe('dexRows', () => {
  it('lists the whole roster in a stable order with seen marks', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const rows = dexRows(ctx, 'u1', {});
    expect(rows).toHaveLength(42);
    expect(rows.map((r) => r.species.id)).toEqual(allSpecies().map((s) => s.id));
    expect(rows.find((r) => r.species.id === 'triceratops')!.seen).toBe(true);
    expect(rows.find((r) => r.species.id === 'velociraptor')!.seen).toBe(false);
  });
  it('filters by rarity, diet and archetype, and combines them', () => {
    expect(dexRows(ctx, 'u1', { rarity: 'mythic' })).toHaveLength(3);
    expect(dexRows(ctx, 'u1', { diet: 'herbivore' })).toHaveLength(18);
    expect(dexRows(ctx, 'u1', { archetype: 'tank' })).toHaveLength(9);
    const combo = dexRows(ctx, 'u1', { rarity: 'mythic', diet: 'carnivore' });
    for (const r of combo) {
      expect(r.species.rarity).toBe('mythic');
      expect(r.species.diet).toBe('carnivore');
    }
  });
  // legendary+support is genuinely empty on the current roster (verified by counting
  // src/data/species/*.ts: the empty pairs are common+bruiser, rare+support,
  // legendary+support and mythic+support). If a future species fills it, move this to
  // another empty pair rather than deleting the case.
  it('returns an empty list when a filter combination matches nothing', () => {
    expect(dexRows(ctx, 'u1', { rarity: 'legendary', archetype: 'support' })).toEqual([]);
  });
});

describe('dexEntry', () => {
  it('carries the rarity-derived numbers and the enriching kinds', () => {
    const e = dexEntry(ctx, 'u1', 'triceratops');
    expect(e.species.name).toBe('Triceratops');
    expect(e.seen).toBe(false);
    expect(e.firstAt).toBeNull();
    expect(e.incomePerHr).toBeGreaterThan(0);
    expect(e.incubationMs).toBeGreaterThan(0);
    expect(e.enrichingKinds).toContain('palm_tree');
  });
  it('reports the first-owned instant once seen', () => {
    ctx.setNow(1_234);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const e = dexEntry(ctx, 'u1', 'triceratops');
    expect(e.seen).toBe(true);
    expect(e.firstAt).toBe(1_234);
  });
  it('throws on an unknown species, like getSpecies', () => {
    expect(() => dexEntry(ctx, 'u1', 'barney')).toThrow(/Unknown species/);
  });
});

describe('dexProgress', () => {
  it('counts seen against the full roster', () => {
    expect(dexProgress(ctx, 'u1')).toEqual({ seen: 0, total: 42 });
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(dexProgress(ctx, 'u1')).toEqual({ seen: 1, total: 42 });
  });
  it('ignores a seen species that is no longer in the roster', () => {
    recordSpeciesSeen(ctx, 'u1', 'retired_dino');
    expect(dexProgress(ctx, 'u1').seen).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dex.test.ts`
Expected: FAIL — cannot resolve `../src/modules/dex/service.js`.

- [ ] **Step 3: Implement the service**

Create `src/modules/dex/service.ts`:

```ts
import type { Ctx } from '../../core/context.js';
import type { Archetype, Diet, Rarity, Species } from '../../data/types.js';
import { allSpecies, getSpecies } from '../../data/species/index.js';
import { RARITY } from '../../data/rarity.js';
import { enrichingKindsFor } from '../../data/decor.js';
import { seenSpecies, firstSeenAt } from '../../core/species-seen.js';

export interface DexFilters { rarity?: Rarity; diet?: Diet; archetype?: Archetype }
export interface DexRow { species: Species; seen: boolean }

/**
 * The roster with the reader's seen marks. seenSpecies is read ONCE and membership
 * tested in memory — never a query per row (the batch-per-user rule src/core/locks.ts
 * establishes). Order is allSpecies()' hand-authored insertion order, so paging is
 * stable between calls.
 */
export function dexRows(ctx: Ctx, userId: string, filters: DexFilters): DexRow[] {
  const seen = seenSpecies(ctx, userId);
  return allSpecies()
    .filter((s) => (!filters.rarity || s.rarity === filters.rarity)
      && (!filters.diet || s.diet === filters.diet)
      && (!filters.archetype || s.archetype === filters.archetype))
    .map((s) => ({ species: s, seen: seen.has(s.id) }));
}

export interface DexEntry {
  species: Species; seen: boolean; firstAt: number | null;
  incubationMs: number; incomePerHr: number; enrichingKinds: string[];
}

/** One species page. Every number is derived from rarity — Species carries none. */
export function dexEntry(ctx: Ctx, userId: string, speciesId: string): DexEntry {
  const species = getSpecies(speciesId);
  const firstAt = firstSeenAt(ctx, userId, speciesId);
  return {
    species,
    seen: firstAt !== null,
    firstAt,
    incubationMs: RARITY[species.rarity].incubationMs,
    incomePerHr: RARITY[species.rarity].incomePerHr,
    enrichingKinds: enrichingKindsFor(species),
  };
}

/** Intersected with the live roster, so a retired species id cannot inflate the count. */
export function dexProgress(ctx: Ctx, userId: string): { seen: number; total: number } {
  const seen = seenSpecies(ctx, userId);
  const roster = allSpecies();
  return { seen: roster.filter((s) => seen.has(s.id)).length, total: roster.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dex.test.ts`
Expected: PASS. If the diet or archetype counts differ from 18 / 9, correct the test to the real roster figure — verify with `grep -h "diet:" src/data/species/*.ts | sort | uniq -c` rather than guessing.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/dex/service.ts tests/dex.test.ts
git commit -m "Add the dex read service"
```

---

## Task 15: The dex payloads

**Files:**
- Create: `src/modules/dex/embeds.ts`
- Test: `tests/dex.test.ts`

**Interfaces:**
- Consumes: Task 14's service, `paginate` / `pageRow` from `src/core/paginate.js`, `attach` / `assetImage` from `src/core/images.js`, `rarityEmoji` from `src/core/emojis.js`, `fmtDuration` / `capitalize` from `src/core/autocomplete.js`.
- Produces:
  - `dexListPayload(ctx: Ctx, userId: string, filters: DexFilters, page: number): Payload`
  - `dexViewPayload(ctx: Ctx, userId: string, speciesId: string): Payload`

Model both on `achievementsPayload` (`src/modules/daily/embeds.ts:92`): the payload
builder calls the read service itself, `paginate` clamps the page, and the page row
renders only when there is more than one page.

- [ ] **Step 1: Write the failing tests**

Append to `tests/dex.test.ts`:

```ts
describe('dexListPayload', () => {
  it('pages the roster ten at a time and clamps an out-of-range page', () => {
    const first = dexListPayload(ctx, 'u1', {}, 1);
    expect(JSON.stringify(first)).toContain('Page 1/5');
    const clamped = dexListPayload(ctx, 'u1', {}, 99);
    expect(JSON.stringify(clamped)).toContain('Page 5/5');
  });
  it('drops the page row when a filter fits on one page', () => {
    const payload = dexListPayload(ctx, 'u1', { rarity: 'mythic' }, 1);
    expect(payload.components ?? []).toHaveLength(0);
  });
  it('shows progress and marks a seen species', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const text = JSON.stringify(dexListPayload(ctx, 'u1', {}, 1));
    expect(text).toContain('1/42');
    expect(text).toContain('Triceratops');
  });
  it('renders an empty filter result without throwing', () => {
    // legendary+support is empty on the current roster — see the note in the dexRows
    // tests above for the other three empty pairs.
    const payload = dexListPayload(ctx, 'u1', { rarity: 'legendary', archetype: 'support' }, 1);
    expect(JSON.stringify(payload)).toContain('No species');
  });
});

describe('dexViewPayload', () => {
  it('names the decor kinds that enrich the species', () => {
    const text = JSON.stringify(dexViewPayload(ctx, 'u1', 'triceratops'));
    expect(text).toContain('Palm Tree');
    expect(text).toContain('Cycad Grove');
  });
  it('says so when the reader has never owned it', () => {
    expect(JSON.stringify(dexViewPayload(ctx, 'u1', 'triceratops'))).toContain('Never owned');
  });
  it('ships at most one file and never an empty files array', () => {
    const payload = dexViewPayload(ctx, 'u1', 'triceratops');
    // assetImage returns null for a missing asset and attach is then a total no-op,
    // so files must be undefined rather than [].
    expect(payload.files === undefined || payload.files.length === 1).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dex.test.ts -t 'Payload'`
Expected: FAIL — cannot resolve `../src/modules/dex/embeds.js`.

- [ ] **Step 3: Implement the payloads**

Create `src/modules/dex/embeds.ts`:

```ts
import { EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import type { Ctx } from '../../core/context.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { attach, assetImage } from '../../core/images.js';
import { rarityEmoji } from '../../core/emojis.js';
import { fmtDuration, capitalize } from '../../core/autocomplete.js';
import { DECOR } from '../../data/decor.js';
import { dexRows, dexEntry, dexProgress, type DexFilters } from './service.js';

type Payload = { embeds: EmbedBuilder[]; components?: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] };

function filterLabel(f: DexFilters): string {
  const parts = [f.rarity, f.diet, f.archetype].filter(Boolean).map((p) => capitalize(String(p)));
  return parts.length ? ` — ${parts.join(' · ')}` : '';
}

export function dexListPayload(ctx: Ctx, userId: string, filters: DexFilters, page: number): Payload {
  const all = dexRows(ctx, userId, filters);
  const { items, page: p, pages } = paginate(all, page);
  const progress = dexProgress(ctx, userId);
  const lines = items.length
    ? items.map((r) => `${r.seen ? '✅' : '▫️'} ${rarityEmoji(r.species.rarity)}${r.species.name} — ${capitalize(r.species.diet)} ${r.species.archetype}`).join('\n')
    : 'No species match that filter.';
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`📖 Dex${filterLabel(filters)}`)
    .setDescription(lines)
    .setFooter({ text: `${progress.seen}/${progress.total} owned · Page ${p}/${pages}` });
  const payload: Payload = {
    embeds: [embed],
    components: pages > 1 ? [pageRow('dex', 'page', userId, p, pages)] : [],
  };
  attach(embed, payload, 'image', assetImage('banners', 'dex'));
  return payload;
}

export function dexViewPayload(ctx: Ctx, userId: string, speciesId: string): Payload {
  const e = dexEntry(ctx, userId, speciesId);
  const kinds = e.enrichingKinds.map((k) => DECOR[k].name).join(', ');
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`${rarityEmoji(e.species.rarity)}${e.species.name}`)
    .setDescription(e.species.flavor)
    .addFields(
      { name: 'Rarity', value: capitalize(e.species.rarity), inline: true },
      { name: 'Diet', value: capitalize(e.species.diet), inline: true },
      { name: 'Role', value: capitalize(e.species.archetype), inline: true },
      { name: 'Income', value: `${e.incomePerHr.toLocaleString('en-US')}/hr at full comfort`, inline: true },
      { name: 'Incubation', value: fmtDuration(e.incubationMs), inline: true },
      { name: 'Habitat', value: e.species.biomeTags.join(', '), inline: true },
      // The cross-link that makes the dex worth consulting before a purchase: decor is
      // permanent, and these are the kinds that count toward this species' enrichment.
      { name: 'Enriched by', value: kinds },
      {
        name: 'Your record',
        value: e.firstAt === null ? 'Never owned' : `First owned <t:${Math.floor(e.firstAt / 1000)}:D>`,
      },
    );
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'thumbnail', assetImage('dinos', `${e.species.archetype}-${e.species.diet}`));
  return payload;
}
```

`assetImage('banners', 'dex')` returns `null` until a banner exists, and `attach` is
then a total no-op — that is the intended degrade, not a gap. Do **not** hand-assign
`payload.files`; `tests/images.test.ts` bans the idiom by source grep.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dex.test.ts tests/images.test.ts`
Expected: PASS. `tests/images.test.ts` scrapes banner names out of `src/`, so if it now demands `assets/images/banners/dex.webp`, either add the art or use an existing banner name — check what the scrape actually asserts before choosing.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/dex/embeds.ts tests/dex.test.ts
git commit -m "Add the dex list and species payloads"
```

---

## Task 16: Register the dex module

**Files:**
- Create: `src/modules/dex/index.ts`
- Modify: `modules.json`, `src/core/module-list.ts`, `tests/registry-load.test.ts:9,10`, `tests/config.test.ts:22`, `tests/contract.test.ts:12,49`
- Test: `tests/dex.test.ts`

**Interfaces:**
- Consumes: Tasks 14–15.
- Produces: `dexModule: ModuleManifest` — name `dex`, commands `/dex list` and `/dex view`, one component prefix `dex`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/dex.test.ts`:

```ts
describe('dex module', () => {
  it('/dex list replies with the first page', async () => {
    const i = fakeCommand({ name: 'dex', sub: 'list', user: 'u1' });
    await dexModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Page 1/5');
  });
  it('/dex list accepts filters', async () => {
    const i = fakeCommand({ name: 'dex', sub: 'list', user: 'u1', options: { rarity: 'mythic' } });
    await dexModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Mythic');
  });
  it('/dex view renders a species', async () => {
    const i = fakeCommand({ name: 'dex', sub: 'view', user: 'u1', options: { species: 'triceratops' } });
    await dexModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Triceratops');
  });
  it('/dex view answers an unknown species without throwing', async () => {
    const i = fakeCommand({ name: 'dex', sub: 'view', user: 'u1', options: { species: 'barney' } });
    await dexModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('No such species');
  });
  it('the species provider suggests names and never creates a user row', async () => {
    const i = fakeAutocomplete({
      name: 'dex', sub: 'view', user: 'u_new',
      focused: { name: 'species', value: 'trice' },
    });
    await dexModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: string }>;
    expect(rows.some((r) => r.value === 'triceratops')).toBe(true);
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(1);   // only the beforeEach u1
  });
  it('the page button rejects a click from another player', async () => {
    const i = fakeButton({ customId: 'dex:page:u1:2', user: 'u2' });
    await dexModule.components[0].execute(ctx, i.asInteraction() as never);
    expect(replyText(i.replies[0])).toContain('Not your dex');
  });
});
```

Also update the three registration counts: `tests/registry-load.test.ts:9` 14 → 15,
`:10` 25 → 26; `tests/config.test.ts:22` gains `dex: true`; `tests/contract.test.ts:49`
25 → 26 and its `AUTOCOMPLETE_OPTIONS` gains the `/dex view` species option.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dex.test.ts tests/registry-load.test.ts tests/config.test.ts tests/contract.test.ts`
Expected: FAIL — no `dexModule`, and the three counts disagree.

- [ ] **Step 3: Implement the module and register it**

Create `src/modules/dex/index.ts`:

```ts
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { matches, respondRanked, capitalize } from '../../core/autocomplete.js';
import { allSpecies } from '../../data/species/index.js';
import type { Archetype, Diet, Rarity } from '../../data/types.js';
import { dexListPayload, dexViewPayload } from './embeds.js';

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const DIETS: Diet[] = ['herbivore', 'carnivore'];
const ARCHETYPES: Archetype[] = ['bruiser', 'tank', 'swift', 'support'];

export const dexModule: ModuleManifest = {
  name: 'dex',
  commands: [
    {
      data: new SlashCommandBuilder().setName('dex').setDescription('The species compendium')
        .addSubcommand((s) => s.setName('list').setDescription('Browse every species')
          .addStringOption((o) => o.setName('rarity').setDescription('Filter by rarity')
            .addChoices(...RARITIES.map((r) => ({ name: capitalize(r), value: r }))))
          .addStringOption((o) => o.setName('diet').setDescription('Filter by diet')
            .addChoices(...DIETS.map((d) => ({ name: capitalize(d), value: d }))))
          .addStringOption((o) => o.setName('archetype').setDescription('Filter by combat role')
            .addChoices(...ARCHETYPES.map((a) => ({ name: capitalize(a), value: a }))))
          .addIntegerOption((o) => o.setName('page').setDescription('Page number')))
        .addSubcommand((s) => s.setName('view').setDescription('One species in detail')
          .addStringOption((o) => o.setName('species').setDescription('Species — type to search').setRequired(true).setAutocomplete(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        if (i.options.getSubcommand() === 'view') {
          const id = i.options.getString('species', true);
          // 42 species exceeds Discord's 25-choice cap, so the value is a free-text
          // string even with autocomplete: an unknown id is a normal input, not a bug.
          if (!allSpecies().some((s) => s.id === id)) {
            await i.reply({ content: 'No such species.', flags: MessageFlags.Ephemeral });
            return;
          }
          await i.reply(dexViewPayload(ctx, i.user.id, id));
          return;
        }
        await i.reply(dexListPayload(ctx, i.user.id, {
          rarity: (i.options.getString('rarity') as Rarity | null) ?? undefined,
          diet: (i.options.getString('diet') as Diet | null) ?? undefined,
          archetype: (i.options.getString('archetype') as Archetype | null) ?? undefined,
        }, i.options.getInteger('page') ?? 1));
      },
      // Static data only: no DB read, no user row, no custom emoji in labels.
      async autocomplete(ctx, i) {
        const q = String(i.options.getFocused());
        await respondRanked(i, allSpecies()
          .filter((s) => matches(q, s.name, s.id, s.rarity, s.archetype))
          .map((s) => ({ value: s.id, valid: true, label: `${s.name} — ${capitalize(s.rarity)} ${s.archetype}` })));
      },
    },
  ],
  components: [
    {
      prefix: 'dex',
      async execute(ctx, i) {
        // Same owner-lock discipline as the 'ach' prefix: the customId's uid segment is
        // a client-supplied snowflake string, checked against the clicker before any
        // read, and an unrecognized action degrades to deferUpdate rather than erroring.
        const [, action, uid, pageStr] = i.customId.split(':');
        if (action !== 'page') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) { await i.reply({ content: 'Not your dex.', flags: MessageFlags.Ephemeral }); return; }
        await i.update({ ...dexListPayload(ctx, i.user.id, {}, Number(pageStr)), attachments: [] });
      },
    },
  ],
};
```

The `attachments: []` on `i.update` is required: the payload carries `files` when the
banner exists, and a payload with `files` replaces the message's whole attachment set,
so the previous page's upload must be shed explicitly. That is the opposite of the rule
for `deliverNotification` payloads, which must carry no `attachments` key at all.

Register in `src/core/module-list.ts` (import plus the array entry) and in
`modules.json` (`"dex": true`).

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS — all files, with the three registration counts now at 15 modules and 26 commands.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/dex/index.ts src/core/module-list.ts modules.json tests/dex.test.ts tests/registry-load.test.ts tests/config.test.ts tests/contract.test.ts
git commit -m "Register the dex module and its two commands"
```

---

## Task 17: Documentation sweep

**Files:**
- Modify: `docs/gameplay.md`, `docs/commands.md`, `CLAUDE.md`, `src/modules/help/index.ts:29`, `src/modules/daily/service.ts:64-67`

**Interfaces:** none. Documentation only.

- [ ] **Step 1: Fix the escape-timing table**

`docs/gameplay.md:351-355` labels the fit-0.75 figures "Correct-diet paddock" and has
no row for the decorated case. Replace the table with all four rows:

```markdown
| Paddock | Fed to 100 | Fed to 125 | Fed to 150 |
| --- | --- | --- | --- |
| Correct diet, matching decor (fit 1.00) | 44 h | 56 h | 68 h |
| Correct diet, enriched (fit 1.05) | about 44.6 h | about 56.6 h | about 68.6 h |
| Correct diet, no matching decor (fit 0.75) | 40 h | 52 h | 64 h |
| Wrong-diet paddock (fit 0.50) | 32 h | 44 h | 56 h |
```

- [ ] **Step 2: Document enrichment where fit is described**

`docs/gameplay.md:322-327` describes fit as a three-value boolean and states that decor
beyond the first matching piece "does not push comfort past 100%". Rewrite it: the
first matching kind still reaches 100%, a **second distinct** matching kind adds 5% and
a **third** adds 10%, those percentages apply to income and to how long a dino stays
put, and the comfort figure shown in `/dino list` is capped at 100% with the rung shown
beside it. Apply the same correction at `:769` and `:780`, and to the habitat summary in
`src/modules/help/index.ts:29`.

- [ ] **Step 3: Correct the stale capacity comment**

`src/modules/daily/service.ts:64-67` says `dailyEarningCapacity` "needs a ceiling, not a
live estimate". That is already false by 1.584× before enrichment (`facilityBonusPct`
maxes at 32 and `incomeMultAt` at 1.20 under Heat Wave), and enrichment widens it again.
Rewrite it to say the figure is a rough sizing input that deliberately ignores comfort,
fit and event multipliers, and that the quest target is clamped to
`max(500, min(50_000, capacity / 2))` so the looseness only matters between those bounds.

- [ ] **Step 4: Add the commands and the invariants**

`docs/commands.md`: add `/dex list [rarity] [diet] [archetype] [page]` and
`/dex view <species>`, and note that `/decorate`'s item option is now autocompleting.

`CLAUDE.md`: add a bullet covering the rung boundary and why it starts at two kinds;
the `paddockFitBase`/`paddockFit` split with `recomputeRating` as `baseComfortAt`'s only
caller; the fit-1.5 cliff; the three-kinds-per-biome invariant and its gate; that
`addChoices` throws on the 26th choice during module init and is therefore a boot crash;
`ALERT_INSTANT_EPSILON_MS` and why row existence is not an alternative; the three
`species_seen` write sites and that eggs are deliberately not credited; and the standing
hazard that retiring a decor kind silently drops every paddock relying on it, now
costing a rung as well as the old 1.0 → 0.75 fall.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run
npm run typecheck
git add docs/gameplay.md docs/commands.md CLAUDE.md src/modules/help/index.ts src/modules/daily/service.ts
git commit -m "Document enrichment and correct the escape-timing table"
```

---

## Task 18: Live gallery cases

**Files:**
- Modify: `scripts/test-live.ts`

**Interfaces:** none. `scripts/test-live.ts` is REST-only and posts the payload gallery to `TEST_CHANNEL_ID`; it never opens a second gateway session.

- [ ] **Step 1: Add the three cases**

Add gallery entries following the file's existing case shape:

1. `dexListPayload` at page 1 with no filter, on a fixture player who has seen a handful
   of species — exercises the seen marks, the progress footer and the page row.
2. `dexViewPayload` for a species with three enriching kinds — exercises the
   `Enriched by` field and the archetype×diet thumbnail.
3. A `/dino list` roster where one dino sits in a two-kind paddock — exercises the
   clamped `100% comfort · enriched +5%` row.

Every `Ctx` built in this file must supply `sleep`, and it calls
`ctx.setNow(Date.now())` deliberately, so these render under whatever world event is
live rather than day 0.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. This is the only gate that typechecks `scripts/`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-live.ts
git commit -m "Cover the dex and an enriched roster row in the live gallery"
```

- [ ] **Step 4: Full verification**

```bash
npm run typecheck
npx vitest run
npm run build
```

Expected: typecheck clean, all tests green, build clean.

- [ ] **Step 5: Operator steps (not part of the branch)**

These run against the live bot after merge, in this order:

1. `npm run deploy-commands` — 25 → 26 commands, and `/decorate`'s item option becomes
   autocompleting. Exactly one bot process per token.
2. Restart the bot — migration 0010 applies at boot.
3. `npm run backfill-species-seen` — once, after the migration.
4. `npm run test:live` — confirm the new gallery cases render.

No `deploy-emojis`: this branch adds no emoji and no art.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: §4's mechanic → Tasks 1–2;
§4's alert tolerance → Task 8; §5's catalog and autocomplete conversion → Tasks 6–7;
§6's display and the rating decision → Tasks 3 and 5; §7's `/dex` → Tasks 14–16;
§8's `species_seen`, migration and backfill → Tasks 9–11 and 13; §9's admin work →
Task 12; §10's testing is distributed across every task, with the falsifiable rating
test in Task 3 and the migration recipe in Task 9; §11 → Task 17; §13's ops checklist →
Task 18 Step 5.

Two spec items intentionally carry no task, both because the spec puts them out of
scope: the park-PNG enrichment glyph, and any reward for dex completion.

**Known cross-task dependency.** One assertion in Task 2 fails until Task 6 adds the
`cycad_grove` kind. Called out in both tasks rather than hidden. An earlier draft of this
plan predicted two failures; the `paddockFitBase` three-kind line actually passes
throughout, because the base value is a boolean gate that an unknown third slug cannot
move off 1.0.

**Type consistency.** `matchedKindCount` / `enrichmentMult` / `enrichingKindsFor` /
`ENRICHMENT_STEPS` / `ENRICHMENT_CAP_KINDS` keep the same names from Task 1 through
Tasks 2, 6, 14 and 15. `paddockFitBase`, `baseComfortAt` and `enrichmentAt` are defined
in Task 2 and used with identical signatures in Tasks 3 and 5. `recordSpeciesSeen`,
`seenSpecies` and `firstSeenAt` are defined in Task 10 and used unchanged in Tasks 11,
12, 14. `schema.speciesSeen`'s property names (`userId`, `speciesId`, `firstAt`) match
the column names (`user_id`, `species_id`, `first_at_ms`) consistently in Tasks 9–13.
`dexRows` / `dexEntry` / `dexProgress` / `DexFilters` are defined in Task 14 and
consumed with the same shapes in Tasks 15–16.

**Roster numbers, counted rather than assumed.** Verified against
`src/data/species/*.ts` on 2026-08-09: 42 species, **24 carnivore / 18 herbivore**,
**13 swift / 12 bruiser / 9 tank / 8 support**, rarities 8/9/9/8/5/3. The empty
rarity×archetype pairs are **common+bruiser, rare+support, legendary+support,
mythic+support** — an earlier draft of this plan used common+support as the empty case,
which actually holds two species. Task 14's and Task 15's empty-filter cases both use
legendary+support. If a future species fills that pair, move the case to another empty
pair rather than deleting it.

**One more thing the implementer must not trust.** The `Payload` type in
`src/modules/dex/embeds.ts` is written locally; if the codebase already exports a shared
one (check `src/modules/daily/embeds.ts`), use that instead of declaring a second.
