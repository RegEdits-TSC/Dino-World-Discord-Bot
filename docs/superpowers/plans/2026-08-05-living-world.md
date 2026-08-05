# The Living World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Dino World bot's world act on its own clock — one globally-shared, double-edged event per UTC day, derived from a pure function, surfaced everywhere, plus a cosmetic season cycle and three shipped defect fixes.

**Architecture:** `worldEventFor(now)` is a pure function of the UTC day index seeded through `mulberry32`; nothing is stored. A flat `EventMods` record of multipliers is resolved per interaction and applied at existing single-seam call sites. Income is the sole effect integrated over time, and `accruedIncome`'s existing hunger-knee split generalizes into a sorted breakpoint list that also splits at UTC midnights.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js v14, drizzle-orm + better-sqlite3 (synchronous), vitest, `@napi-rs/canvas`.

**Spec:** `docs/superpowers/specs/2026-08-05-living-world-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **ESM NodeNext:** every relative import carries a `.js` extension, including in tests.
- **`vitest` has `globals: false`.** Every test file must explicitly `import { describe, it, expect, beforeEach, vi } from 'vitest';`. There is no setup file and no implicit globals.
- **Time comes from `ctx.now()`, randomness from `ctx.rng()`.** Never `Date.now()` / `Math.random()` in `src/`. The one exception in this plan is the world derivation itself, which takes `now` as a parameter and is called with `ctx.now()` by every caller.
- **DB access is synchronous** drizzle/better-sqlite3 (`.get()` / `.all()` / `.run()`) — never awaited.
- **`npm run build` does NOT typecheck tests.** `tsconfig.json` includes `src` only, and vitest transpiles without typechecking. The test-inclusive gate is `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`). Run it before every commit that touches `tests/` or `scripts/`.
- **Never write `payload.files = [...]`.** Always `attach(embed, payload, slot, assetImage(...))`. Banned by source-grep at `tests/images.test.ts:257-265`.
- **Never call `emojiTag` in a module-level constant.** The emoji map loads after client ready, so module init freezes the unicode fallback permanently. No test catches this.
- **Never stage a test fixture under `assets/images/`.** vitest runs test files in parallel forks. Mock `assetImage` instead.
- **Everything under `assets/images/` is WebP q95**, enforced by `tests/images.test.ts:277-283`.
- **`COLLECTION_TARGET` (`src/data/progression.ts:12`) stays 190** and `NPC_LEVEL_SANITY_CAP` stays 12. Neither is guarded by a test. Do not "sync" either to the roster.
- **There is no shared park/user seeding helper.** Every test file hand-rolls its own. `import { seedPark } from './harness.js'` does not exist and will not compile.

  Where a task below shows a test body as a comment stub, this is the shape to fill it with — copy the *local* helper from the sibling test file the task names (`tests/expeditions.test.ts`, `tests/genelab.test.ts`, `tests/battle-service.test.ts`, `tests/shop.test.ts` each have their own), because the exact columns differ per feature:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { makeCtx } from './harness.js';
  import { schema } from '../src/core/db/index.js';
  import { getOrCreateUser } from '../src/modules/park/service.js';

  const DAY = 86_400_000;

  function seed(ctx: ReturnType<typeof makeCtx>, userId = 'u1', cash = 100_000) {
    getOrCreateUser(ctx, userId);
    ctx.economy.apply(userId, { cash }, 'test-seed', ctx.now());
    return userId;
  }

  const cashOf = (ctx: ReturnType<typeof makeCtx>, userId = 'u1') =>
    ctx.db.select().from(schema.users).all().find((u) => u.discordId === userId)!.cash;
  ```

  **`makeCtx({ nowMs: X })` sets only the INITIAL time** — `setNow` moves it afterwards. Never pass `now: () => t` as an override; that replaces the closure reader and silently disables `setNow`.
- **`npm test` runs the full suite.** A single file: `npx vitest run tests/<file>.test.ts`. A single test: add `-t '<name>'`.

### The day-0 invariant — read this before writing any test

`makeCtx` defaults `nowMs` to `0` (`tests/harness.ts:17`), which is **UTC day 0**. Essentially the entire existing 1023-test suite therefore runs on day 0, and `scripts/test-live.ts:73` does too. Whatever event day 0 resolves to is ambient for all of it.

`WORLD_SALT` is chosen (Task 2) so that **UTC days 0–4 all resolve to Clear Skies**, whose modifiers are all neutral. That is what keeps roughly twelve existing test files untouched by this plan. It is pinned by an explicit test and a comment; it is a deliberate choice about the epoch, which no production player will ever occupy (today is day ~20,600).

Because `worldEventFor` is **pure and deterministic**, a test that needs a specific event does **not** mock anything — it picks a day that rolls that event:

| Event | First day index | Event | First day index |
| --- | --- | --- | --- |
| `clear_skies` | 0 | `blood_moon` | 7 |
| `heat_wave` | 5 | `cold_snap` | 8 |
| `amber_storm` | 10 | `fossil_rush` | 14 |
| `bumper_harvest` | 18 | `migration_season` | 27 |
| `market_panic` | 38 | | |

**Seam fixture:** day **208** is `heat_wave` and day **209** is `cold_snap`. Task 3 uses exactly this pair.

Use `DAY_MS * n` (with `DAY_MS = 86_400_000`) as `nowMs`. Never mock `src/core/world.js`.

---

## File Structure

**Created**

| Path | Responsibility |
| --- | --- |
| `src/data/world-events.ts` | The `WorldEvent` / `EventMods` types, `NEUTRAL_MODS`, and the nine-entry `WORLD_EVENTS` roster with weights and player-facing copy. Data only — no logic. |
| `src/core/world.ts` | The derivation: `dayIndex`, `worldEventFor`, `eventMods`, `incomeMultAt`, `utcMidnightsBetween`, `seasonFor`, `seasonDay`. Pure; no `ctx`, no db. |
| `src/modules/world/index.ts` | The `world` module manifest and the `/world` command. |
| `src/modules/world/embeds.ts` | `worldPayload()` for `/world` and `eventHeaderLine()` for the four other surfaces. |
| `src/modules/world/broadcast.ts` | `worldBroadcastHandler()` and `armWorldBroadcast()`. |
| `drizzle/0008_*.sql` + snapshot + journal entry | `guild_settings.world_broadcast`. |
| `src/data/species/cryolophosaurus.ts`, `src/data/species/nanuqsaurus.ts` | The two `tundra` species. |
| `tests/world.test.ts` | Derivation, salt pin, distribution, stream independence, invariants. |
| `tests/world-income.test.ts` | The income seam. |
| `tests/world-effects.test.ts` | Every point-in-time effect, plus quote-vs-charge parity. |
| `tests/world-module.test.ts` | `/world`, header lines, `/settings world-news`. |
| `tests/world-broadcast.test.ts` | The broadcast handler, re-arm, and the `userId: '0'` sentinel. |

**Modified** — `src/core/rolls.ts`, `src/core/clock.ts`, `src/core/db/schema.ts`, `src/core/module-list.ts`, `src/core/emojis.ts`, `src/core/images.ts`, `src/index.ts`, `modules.json`, `src/modules/{daily,shop,care,expeditions,genelab,battles,hatchery,park,settings}/…`, `src/core/render/{art,draw}.ts`, `src/modules/park/snapshot.ts`, `src/data/species/index.ts`, and the test and docs files each task names.

---

## Task 1: Lift `shuffle` into `src/core/rolls.ts`

The shop's rotation shuffles with `[...base].sort(() => rng() - 0.5)` — a biased comparator shuffle. A correct Fisher-Yates already exists but is module-private in the daily module. Task 10 needs it in the shop; this task moves it and proves it.

**Files:**
- Modify: `src/core/rolls.ts` (append)
- Modify: `src/modules/daily/service.ts:22-28` (delete), `:58` (call site unchanged), imports
- Test: `tests/rolls.test.ts` (create if absent; otherwise append)

**Interfaces:**
- Consumes: `mulberry32` from `src/core/rolls.ts:5`.
- Produces: `export function shuffle<T>(items: T[], rng: () => number): T[]` — returns a **new** array, does not mutate the input.

- [ ] **Step 1: Read the existing implementation before moving it**

Run: `sed -n '18,32p;54,62p' src/modules/daily/service.ts`

Copy the body **verbatim**. Do not retype it — behaviour must be bit-identical for the daily quest roller, and nothing in `tests/daily-roll.test.ts` would catch a difference (no test pins a specific board; determinism is only asserted ctxA-vs-ctxB for the same seed).

- [ ] **Step 2: Write the failing test**

Create `tests/rolls.test.ts` (or append this `describe` to it if it exists):

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, shuffle } from '../src/core/rolls.js';

describe('shuffle', () => {
  it('returns a new array and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, mulberry32(7));
    expect(out).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('is deterministic for a given seed', () => {
    expect(shuffle([1, 2, 3, 4, 5], mulberry32(7)))
      .toEqual(shuffle([1, 2, 3, 4, 5], mulberry32(7)));
  });

  // A comparator shuffle (`sort(() => rng() - 0.5)`) is measurably biased: it
  // leaves elements near their starting index far more often than 1/n. This is
  // the property the shop's old implementation failed, and it is why this test
  // lives here rather than being inferred from the daily-quest suite.
  it('is unbiased — every element reaches every position at roughly 1/n', () => {
    const N = 5;
    const TRIALS = 60_000;
    const counts = Array.from({ length: N }, () => new Array(N).fill(0));
    const rng = mulberry32(12345);
    for (let t = 0; t < TRIALS; t++) {
      const out = shuffle([0, 1, 2, 3, 4], rng);
      out.forEach((value, pos) => { counts[value][pos]++; });
    }
    const expected = TRIALS / N;
    for (let value = 0; value < N; value++) {
      for (let pos = 0; pos < N; pos++) {
        // ±6% tolerance: comfortably inside sampling noise at 60k trials, and
        // comfortably outside the >20% skew a comparator shuffle produces.
        expect(Math.abs(counts[value][pos] - expected) / expected,
          `value ${value} at position ${pos}`).toBeLessThan(0.06);
      }
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/rolls.test.ts`
Expected: FAIL — `shuffle` is not exported from `src/core/rolls.ts`.

- [ ] **Step 4: Move the function**

Append to `src/core/rolls.ts`, pasting the body you copied in Step 1:

```ts
// Fisher-Yates. Moved here from src/modules/daily/service.ts so the shop can
// use it too — the shop previously used `sort(() => rng() - 0.5)`, a biased
// comparator shuffle. Returns a new array; callers rely on the input surviving.
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

Then in `src/modules/daily/service.ts`: delete the private `shuffle` (lines 22-28) and add `shuffle` to the existing import from `../../core/rolls.js`. The sole call site at line 58 is unchanged.

- [ ] **Step 5: Run the new test and the daily suite**

Run: `npx vitest run tests/rolls.test.ts tests/daily-roll.test.ts`
Expected: PASS. The daily suite must be green **without edits** — if it is not, the moved body differs from the original.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/rolls.ts src/modules/daily/service.ts tests/rolls.test.ts
git commit -m "Move the Fisher-Yates shuffle into core/rolls"
```

---

## Task 2: The world event roster and derivation

The heart of the feature. Pure functions only — no integration yet, so nothing else in the game changes.

**Files:**
- Create: `src/data/world-events.ts`, `src/core/world.ts`, `tests/world.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `rollWeighted` from `src/core/rolls.ts:5,15`.
- Produces:
  - `type WorldEventId = 'clear_skies' | 'amber_storm' | 'fossil_rush' | 'heat_wave' | 'cold_snap' | 'bumper_harvest' | 'market_panic' | 'blood_moon' | 'migration_season'`
  - `interface EventMods` (14 fields, below) and `const NEUTRAL_MODS: EventMods`
  - `interface WorldEvent { id; name; emoji; blurb; weight; mods: Partial<EventMods>; effects: string[] }`
  - `const WORLD_EVENTS: WorldEvent[]`
  - `type Season = 'wet' | 'dry' | 'cold'`
  - `dayIndex(now: number): number`
  - `worldEventFor(now: number): WorldEvent`
  - `eventMods(now: number): EventMods`
  - `incomeMultAt(t: number): number`
  - `utcMidnightsBetween(from: number, to: number): number[]`
  - `seasonFor(now: number): Season`, `seasonDay(now: number): number`, `SEASON_DAYS = 30`

- [ ] **Step 1: Write `src/data/world-events.ts`**

```ts
// The world is DERIVED, never stored — same philosophy as escrow locks
// (src/core/locks.ts) and quest progress (src/modules/daily/service.ts).
// This file is data only; the derivation lives in src/core/world.ts.

export type WorldEventId =
  | 'clear_skies' | 'amber_storm' | 'fossil_rush' | 'heat_wave' | 'cold_snap'
  | 'bumper_harvest' | 'market_panic' | 'blood_moon' | 'migration_season';

/**
 * Every modifier an event can apply. All are multipliers except
 * `expeditionOddsShift` (a ladder step) and `energyCostDelta` (an addend).
 *
 * `income` is the ONLY field integrated over time. Never read it off a
 * request-time record to compute a payout — sample it per segment via
 * `incomeMultAt(t)`. It lives here so /world and the header lines can show it.
 */
export interface EventMods {
  income: number;
  feedCost: number;
  expeditionMs: number;
  expeditionFee: number;
  expeditionCash: number;
  expeditionOddsShift: -1 | 0 | 1;
  eggPrice: number;
  foodPrice: number;
  sellCash: number;
  energyCostDelta: number;
  battleXp: number;
  enemyHp: number;
  breedMs: number;
  hatchTraitOdds: [number, number, number] | null;
}

export const NEUTRAL_MODS: EventMods = {
  income: 1, feedCost: 1, expeditionMs: 1, expeditionFee: 1, expeditionCash: 1,
  expeditionOddsShift: 0, eggPrice: 1, foodPrice: 1, sellCash: 1,
  energyCostDelta: 0, battleXp: 1, enemyHp: 1, breedMs: 1, hatchTraitOdds: null,
};

export interface WorldEvent {
  id: WorldEventId;
  name: string;
  /** The custom emoji NAME. Resolved through emojiTag() at RENDER time —
   *  never in a module-level constant, or the unicode fallback freezes. */
  emoji: string;
  blurb: string;
  weight: number;
  mods: Partial<EventMods>;
  /** Player-facing effect lines, plain language, no raw multipliers. */
  effects: string[];
}

// Clear Skies carries weight 4 against eight events at weight 1 (total 12), so
// one day in three is uneventful. An event every day is not an event.
// ORDER IS LOAD-BEARING: rollWeighted walks this array, so reordering it
// changes which event every historical day resolved to. See WORLD_SALT.
export const WORLD_EVENTS: WorldEvent[] = [
  {
    id: 'clear_skies', name: 'Clear Skies', emoji: 'dw_event_clear_skies', weight: 4,
    blurb: 'A calm day across the islands. Nothing unusual on the wind.',
    mods: {},
    effects: [],
  },
  {
    id: 'amber_storm', name: 'Amber Storm', emoji: 'dw_event_amber_storm', weight: 1,
    blurb: 'Resin-laden squalls scour the dig sites. The digging is fast and the hazard pay is worse.',
    mods: { expeditionMs: 0.75, expeditionFee: 2 },
    effects: ['Expeditions finish 25% sooner', 'Expedition fees are doubled'],
  },
  {
    id: 'fossil_rush', name: 'Fossil Rush', emoji: 'dw_event_fossil_rush', weight: 1,
    blurb: 'A collapsed shelf has opened a bone bed. Everyone is digging; nobody is being careful.',
    mods: { expeditionCash: 1.5, expeditionOddsShift: -1 },
    effects: ['Expeditions pay 50% more cash', 'Expedition eggs come back one rarity step worse'],
  },
  {
    id: 'heat_wave', name: 'Heat Wave', emoji: 'dw_event_heat_wave', weight: 1,
    blurb: 'The basin bakes. Visitors crowd the shaded enclosures and your herds eat through the pantry.',
    mods: { income: 1.2, feedCost: 1.3 },
    effects: ['Park income +20%', 'Feeding costs 30% more food'],
  },
  {
    id: 'cold_snap', name: 'Cold Snap', emoji: 'dw_event_cold_snap', weight: 1,
    blurb: 'A hard frost settles in. The animals are sluggish, and so is the turnstile.',
    mods: { income: 0.9, feedCost: 0.75 },
    effects: ['Feeding costs 25% less food', 'Park income −10%'],
  },
  {
    id: 'bumper_harvest', name: 'Bumper Harvest', emoji: 'dw_event_bumper_harvest', weight: 1,
    blurb: 'The mainland greenhouses overproduced. Feed is cheap and everything else is not.',
    mods: { foodPrice: 0.6, eggPrice: 1.25 },
    effects: ['Food costs 40% less', 'Eggs cost 25% more'],
  },
  {
    id: 'market_panic', name: 'Market Panic', emoji: 'dw_event_market_panic', weight: 1,
    blurb: 'A rival park folded overnight. Stock is flooding the market and nobody is buying.',
    mods: { eggPrice: 0.7, sellCash: 0.8 },
    effects: ['Eggs cost 30% less', 'Selling a dino pays 20% less cash'],
  },
  {
    id: 'blood_moon', name: 'Blood Moon', emoji: 'dw_event_blood_moon', weight: 1,
    blurb: 'Something has the carnivores agitated. They are hunting, and they are harder to put down.',
    mods: { energyCostDelta: -1, battleXp: 1.5, enemyHp: 1.15 },
    effects: ['Every stage costs 1 less energy (minimum 1)', 'Battle XP ×1.5', 'Enemies have 15% more HP'],
  },
  {
    id: 'migration_season', name: 'Migration Season', emoji: 'dw_event_migration_season', weight: 1,
    blurb: 'Wild bloodlines are on the move. Fresh hatchlings are strange; the labs are distracted.',
    mods: { hatchTraitOdds: [0.45, 0.40, 0.15], breedMs: 1.25 },
    effects: ['Wild hatches roll far better traits', 'Breeding takes 25% longer'],
  },
];
```

- [ ] **Step 2: Write `src/core/world.ts`**

```ts
import { mulberry32, rollWeighted } from './rolls.js';
import { WORLD_EVENTS, NEUTRAL_MODS, type WorldEvent, type EventMods } from '../data/world-events.js';

// DAY_MS is duplicated from src/core/clock.ts DELIBERATELY. clock.ts imports
// incomeMultAt from THIS module, so importing DAY_MS back would create the
// repo's first core↔core cycle — and under ESM NodeNext a module-level const
// computed from a cyclic import hits the temporal dead zone and throws a
// ReferenceError at import time, depending on which module is entered first.
// One duplicated integer is cheaper than that failure mode.
const DAY_MS = 86_400_000;

// Chosen so UTC days 0-4 all resolve to Clear Skies (all-neutral modifiers).
// This is a TEST-ENVIRONMENT decision with zero production impact: makeCtx
// defaults nowMs to 0 (tests/harness.ts:17), so essentially the whole existing
// suite and scripts/test-live.ts run on day 0, and an eventful epoch would
// silently multiply pinned fixtures across a dozen test files. Real players are
// past day 20,000. Long-run Clear Skies share is 0.3338 over 1,000,000 days
// against the 1/3 design target.
//
// The salt is also what keeps the world stream independent of the shop's:
// dailyEggOffers seeds mulberry32(day) RAW (src/modules/shop/service.ts:19), so
// an unsalted world would permanently correlate "Market Panic day" with a fixed
// shop rotation. Both properties are pinned by tests/world.test.ts — if you
// change this constant or reorder WORLD_EVENTS, re-run that search.
const WORLD_SALT = 0x2c0;

export function dayIndex(now: number): number {
  return Math.floor(now / DAY_MS);
}

export function worldEventFor(now: number): WorldEvent {
  return rollWeighted(
    WORLD_EVENTS.map((e) => ({ value: e, weight: e.weight })),
    mulberry32((dayIndex(now) ^ WORLD_SALT) | 0),
  );
}

export function eventMods(now: number): EventMods {
  return { ...NEUTRAL_MODS, ...worldEventFor(now).mods };
}

/** The income multiplier in force at one INSTANT. Sampled per segment by
 *  accruedIncome — never read once per request. */
export function incomeMultAt(t: number): number {
  return eventMods(t).income;
}

/** Every UTC midnight strictly inside (from, to). A boundary exactly at `from`
 *  or `to` yields nothing, matching accruedIncome's strict knee guard. */
export function utcMidnightsBetween(from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = (Math.floor(from / DAY_MS) + 1) * DAY_MS; m < to; m += DAY_MS) out.push(m);
  return out;
}

export type Season = 'wet' | 'dry' | 'cold';
const SEASONS: Season[] = ['wet', 'dry', 'cold'];
export const SEASON_DAYS = 30;

// Seasons are COSMETIC. They re-tint the park map ground and name a line on
// /world, and carry no modifier at all — which is what removes every
// season×event stacking question. Adding modifiers later is purely additive.
export function seasonFor(now: number): Season {
  return SEASONS[Math.floor(dayIndex(now) / SEASON_DAYS) % SEASONS.length];
}

export function seasonDay(now: number): number {
  return (dayIndex(now) % SEASON_DAYS) + 1;
}
```

- [ ] **Step 3: Write `tests/world.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/core/rolls.js';
import {
  dayIndex, worldEventFor, eventMods, incomeMultAt, utcMidnightsBetween,
  seasonFor, seasonDay, SEASON_DAYS,
} from '../src/core/world.js';
import { WORLD_EVENTS, NEUTRAL_MODS } from '../src/data/world-events.js';

const DAY = 86_400_000;

describe('world event derivation', () => {
  it('is deterministic — the same day always yields the same event', () => {
    for (const d of [0, 5, 208, 20_600]) {
      expect(worldEventFor(d * DAY).id).toBe(worldEventFor(d * DAY + DAY - 1).id);
    }
  });

  it('changes at the UTC midnight boundary, not before', () => {
    expect(worldEventFor(4 * DAY + DAY - 1).id).toBe('clear_skies');
    expect(worldEventFor(5 * DAY).id).toBe('heat_wave');
  });

  // THE LOAD-BEARING TEST. makeCtx defaults nowMs to 0, so the whole existing
  // suite runs on day 0. If this fails, roughly a dozen unrelated test files
  // are about to fail with multiplied fixtures — fix the salt, not them.
  it('keeps UTC days 0-4 calm, because the whole test suite lives there', () => {
    for (const d of [0, 1, 2, 3, 4]) {
      expect(worldEventFor(d * DAY).id, `day ${d}`).toBe('clear_skies');
    }
  });

  it('pins the day fixtures the rest of the suite selects events by', () => {
    const at = (d: number) => worldEventFor(d * DAY).id;
    expect(at(5)).toBe('heat_wave');
    expect(at(7)).toBe('blood_moon');
    expect(at(8)).toBe('cold_snap');
    expect(at(10)).toBe('amber_storm');
    expect(at(14)).toBe('fossil_rush');
    expect(at(18)).toBe('bumper_harvest');
    expect(at(27)).toBe('migration_season');
    expect(at(38)).toBe('market_panic');
    // The income-seam fixture used by tests/world-income.test.ts.
    expect(at(208)).toBe('heat_wave');
    expect(at(209)).toBe('cold_snap');
  });

  it('matches the declared weights over 120,000 days', () => {
    const counts = new Map<string, number>();
    const N = 120_000;
    for (let d = 0; d < N; d++) {
      const id = worldEventFor(d * DAY).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = WORLD_EVENTS.reduce((s, e) => s + e.weight, 0);
    for (const e of WORLD_EVENTS) {
      const share = (counts.get(e.id) ?? 0) / N;
      expect(Math.abs(share - e.weight / total), `${e.id} share ${share}`).toBeLessThan(0.01);
    }
  });

  // The shop seeds mulberry32(day) raw. Without the salt, "Market Panic day"
  // would imply one fixed shop rotation forever.
  it('draws from a stream independent of the shop\'s unsalted mulberry32(day)', () => {
    let agree = 0;
    const N = 10_000;
    for (let d = 0; d < N; d++) {
      const shopFirst = mulberry32(d)() < 1 / 3;
      const worldCalm = worldEventFor(d * DAY).id === 'clear_skies';
      if (shopFirst === worldCalm) agree++;
    }
    // Both indicators are Bernoulli(1/3), so INDEPENDENT streams agree at
    // (1/3)^2 + (2/3)^2 = 5/9 ~= 0.5556. A SHARED stream would agree at 1.0.
    expect(Math.abs(agree / N - 5 / 9)).toBeLessThan(0.03);
  });
});

describe('eventMods', () => {
  it('returns fully-neutral mods on a calm day', () => {
    expect(eventMods(0)).toEqual(NEUTRAL_MODS);
  });

  it('overlays only the fields an event declares', () => {
    const m = eventMods(5 * DAY);            // heat_wave
    expect(m.income).toBe(1.2);
    expect(m.feedCost).toBe(1.3);
    expect(m.sellCash).toBe(1);              // untouched by heat_wave
    expect(m.hatchTraitOdds).toBeNull();
  });

  it('exposes incomeMultAt as the instant sampler', () => {
    expect(incomeMultAt(0)).toBe(1);
    expect(incomeMultAt(5 * DAY)).toBe(1.2);
    expect(incomeMultAt(8 * DAY)).toBe(0.9);
  });

  it('declares no modifier outside the EventMods contract', () => {
    const allowed = new Set(Object.keys(NEUTRAL_MODS));
    for (const e of WORLD_EVENTS) {
      for (const k of Object.keys(e.mods)) {
        expect(allowed.has(k), `${e.id} declares unknown mod '${k}'`).toBe(true);
      }
    }
  });

  it('gives Clear Skies literally nothing to do', () => {
    const calm = WORLD_EVENTS.find((e) => e.id === 'clear_skies')!;
    expect(calm.mods).toEqual({});
    expect(calm.effects).toEqual([]);
  });

  it('gives every other event both an upside and a downside line', () => {
    for (const e of WORLD_EVENTS.filter((x) => x.id !== 'clear_skies')) {
      expect(Object.keys(e.mods).length, `${e.id} mods`).toBeGreaterThanOrEqual(2);
      expect(e.effects.length, `${e.id} effects`).toBeGreaterThanOrEqual(2);
    }
  });

  it('stores an emoji NAME, never a resolved tag', () => {
    for (const e of WORLD_EVENTS) {
      expect(e.emoji, e.id).toMatch(/^dw_event_[a-z_]+$/);
      expect(e.emoji).not.toContain('<');
    }
  });

  it('has unique ids', () => {
    expect(new Set(WORLD_EVENTS.map((e) => e.id)).size).toBe(WORLD_EVENTS.length);
  });
});

describe('utcMidnightsBetween', () => {
  it('is empty inside a single day', () => {
    expect(utcMidnightsBetween(0, DAY - 1)).toEqual([]);
  });
  it('excludes a boundary exactly at either end', () => {
    expect(utcMidnightsBetween(0, DAY)).toEqual([]);
    expect(utcMidnightsBetween(DAY, 2 * DAY)).toEqual([]);
  });
  it('lists every interior midnight for a multi-day window', () => {
    expect(utcMidnightsBetween(0, 3 * DAY + 1)).toEqual([DAY, 2 * DAY, 3 * DAY]);
  });
  it('handles a window that starts mid-day', () => {
    expect(utcMidnightsBetween(DAY / 2, DAY * 2 + DAY / 2)).toEqual([DAY, 2 * DAY]);
  });
});

describe('seasons', () => {
  it('cycles wet -> dry -> cold every 30 days', () => {
    expect(seasonFor(0)).toBe('wet');
    expect(seasonFor(29 * DAY)).toBe('wet');
    expect(seasonFor(30 * DAY)).toBe('dry');
    expect(seasonFor(60 * DAY)).toBe('cold');
    expect(seasonFor(90 * DAY)).toBe('wet');
  });
  it('reports a 1-based day within the season', () => {
    expect(seasonDay(0)).toBe(1);
    expect(seasonDay(29 * DAY)).toBe(SEASON_DAYS);
    expect(seasonDay(30 * DAY)).toBe(1);
  });
  it('exposes dayIndex as plain UTC day arithmetic', () => {
    expect(dayIndex(0)).toBe(0);
    expect(dayIndex(DAY - 1)).toBe(0);
    expect(dayIndex(DAY)).toBe(1);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/world.test.ts`
Expected: PASS, all of it. If the day-0-through-4 test fails, the salt or the roster order is wrong — **do not** relax the assertion.

- [ ] **Step 5: Prove nothing else moved**

Run: `npm test && npm run typecheck`
Expected: PASS. Nothing imports `world.ts` yet, so the rest of the suite must be untouched.

- [ ] **Step 6: Commit**

```bash
git add src/data/world-events.ts src/core/world.ts tests/world.test.ts
git commit -m "Add the world event roster and its pure derivation"
```

---

## Task 3: Piecewise income across UTC midnights

The only integrated effect, and the only place a wrong answer pays players incorrectly without failing anything. Regression-first.

**Files:**
- Modify: `src/core/clock.ts` (the `accruedIncome` body, currently lines 82-111)
- Create: `tests/world-income.test.ts`

**Interfaces:**
- Consumes: `incomeMultAt`, `utcMidnightsBetween` from `src/core/world.ts`.
- Produces: no signature change. `accruedIncome(dinos, facilityBonusPct, capHours, from, to)` keeps its exact shape, so all existing call sites are untouched.

**Facts you need before editing:**
- `accruedIncome` has exactly **one** production caller: `pendingIncome` at `src/modules/park/service.ts:145`.
- `dailyEarningCapacity` (`src/modules/daily/service.ts:76-84`) is a capacity ceiling that ignores comfort. It must **not** gain the multiplier.
- `RECAPTURE_FEE_HOURS * incomePerHr` (`src/modules/care/service.ts:105`) is a fee, not income. Leave it.
- `capHours` is a **parameter**, not a lookup. Production passes at most 24, but `tests/clock.test.ts:163-165,174-175` pass **999**, giving a 64h window that already spans three UTC days. The N-segment loop is mandatory, not defensive.
- The window is capped from `from`: `const end = Math.min(to, from + capHours * 3_600_000)`. Midnights must be enumerated over `[from, dinoEnd]` — the **per-dino** end after escape and hunger-zero truncation — never the shared `end`.
- The knee guard is **strict on both ends** today (`knee > from && knee < dinoEnd`). Reproduce that exactly.

- [ ] **Step 1: Write the failing test**

Create `tests/world-income.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { accruedIncome, type ClockDino } from '../src/core/clock.js';
import { incomeMultAt } from '../src/core/world.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { allSpecies } from '../src/data/species/index.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

// A common herbivore (60 cash/hr) in a correct-diet paddock with NO biome
// decor => paddockFit 0.75, so comfort is 0.75 * min(100, hunger)/100.
// NOTE: hungerAtFed 150 puts the overfill knee at +24h, not +36h --
// hunger falls 100 points per 48h, so 150 -> 100 takes 24 hours.
const species = allSpecies().find((s) => s.rarity === 'common' && s.diet === 'herbivore')!;

function dino(lastFedAt: number, hungerAtFed = 100): ClockDino {
  return {
    species,
    paddock: PADDOCKS.herbivore_paddock,
    decor: [],                  // fit 0.75 — constant, so it cancels in ratios
    hungerAtFed,
    lastFedAt,
    escapedAt: null,
    traits: [],
  };
}

describe('accruedIncome across event seams', () => {
  // Day 208 is heat_wave (income x1.20), day 209 is cold_snap (income x0.90).
  const SEAM = 208 * DAY;

  it('pays each segment at ITS OWN day rate, not one blended rate', () => {
    expect(incomeMultAt(SEAM)).toBe(1.2);
    expect(incomeMultAt(SEAM + DAY)).toBe(0.9);

    // Fed at the seam day's 00:00, collect 30h later: 24h under heat_wave,
    // 6h under cold_snap.
    const d = dino(SEAM, 150);          // overfed, so comfort is flat 100 the whole time
    const got = accruedIncome([d], 0, 999, SEAM, SEAM + 30 * HOUR);

    // Comfort is 0.75 throughout (fit 0.75, hunger >= 100 for 36h at 150).
    const base = 60 * 0.75;
    const expected = Math.floor(base * 24 * 1.2 + base * 6 * 0.9);
    expect(got).toBe(expected);
  });

  it('is NOT the same as applying the collect-time event to the whole window', () => {
    const d = dino(SEAM, 150);
    const correct = accruedIncome([d], 0, 999, SEAM, SEAM + 30 * HOUR);
    const base = 60 * 0.75;
    // These must be the ACTUAL outputs of a once-per-request implementation,
    // not a flat-comfort approximation -- otherwise the test excludes nothing.
    const ratioHours = 24 * 1.0 + 6 * ((1.0 + 0.875) / 2);   // comfort is NOT flat
    const naiveAtStart = Math.floor(base * ratioHours * 1.2);
    const naiveAtEnd = Math.floor(base * ratioHours * 0.9);
    expect(correct).not.toBe(naiveAtStart);
    expect(correct).not.toBe(naiveAtEnd);
  });

  it('cannot be farmed by delaying a collection into a better event', () => {
    // Additivity across a split IS the anti-farming property: if collecting in
    // two pieces paid differently from collecting in one, a player could delay
    // to re-price already-earned hours at a later day's multiplier.
    // (Do NOT write `early === late` with identical arguments -- that is a
    // tautology on a pure function and cannot fail under any implementation.)
    const d = dino(SEAM, 150);
    const whole = accruedIncome([d], 0, 999, SEAM, SEAM + 30 * HOUR);
    const first = accruedIncome([d], 0, 999, SEAM, SEAM + 24 * HOUR);
    const rest = accruedIncome([d], 0, 999, SEAM + 24 * HOUR, SEAM + 30 * HOUR);
    expect(Math.abs(whole - (first + rest))).toBeLessThanOrEqual(1);
  });

  // The dinoEnd-vs-end invariant is otherwise UNCOVERED by the whole suite:
  // observing it needs both dinoEnd < end AND a UTC midnight inside the gap,
  // and no other test has both. Under that bug the loop integrates past
  // starvation -- a silent overpay.
  it('stops at the per-dino end, not the shared window end, across a midnight', () => {
    const d = dino(208 * DAY + 20 * HOUR, 10);   // hunger zeroes at +4.8h
    const got = accruedIncome([d], 0, 999, 208 * DAY + 20 * HOUR, 208 * DAY + 50 * HOUR);
    // Derive the expected value from comfortAt directly. Then verify the test
    // FAILS if utcMidnightsBetween(from, dinoEnd) is changed to (from, end).
    expect(got).toBe(EXPECTED);
  });

  it('handles a window spanning three days (capHours 999)', () => {
    const START = 206 * DAY;            // 206,207 calm; 208 heat_wave
    const d = dino(START, 150);
    const got = accruedIncome([d], 0, 999, START, START + 60 * HOUR);
    const base = 60 * 0.75;
    const expected = Math.floor(
      base * 24 * incomeMultAt(START) +
      base * 24 * incomeMultAt(START + DAY) +
      base * 12 * incomeMultAt(START + 2 * DAY),
    );
    expect(got).toBe(expected);
  });

  it('does not double-count when the hunger knee lands exactly on a midnight', () => {
    // hungerAtFed 200 would put the knee at exactly +24h. Use 150 fed 12h before
    // midnight so the knee is interior but distinct, then the exact-coincidence
    // case: fed at 00:00 with hungerAtFed 200 puts knee at exactly the next
    // midnight, which must contribute ONE breakpoint, not two.
    const START = 210 * DAY;
    const d = dino(START, 200);
    const got = accruedIncome([d], 0, 999, START, START + 36 * HOUR);
    // Sanity: a duplicated breakpoint would produce a zero-length segment,
    // which contributes 0 — so the guard is proven by the value being the same
    // as a hand-computed two-segment sum.
    const base = 60 * 0.75;
    const m0 = incomeMultAt(START);
    const m1 = incomeMultAt(START + DAY);
    // 0-24h: hunger 200 -> 100, comfort pinned at 1.0*fit (min(100,h)).
    // 24-36h: hunger 100 -> 50, comfort ramps 0.75 -> 0.375.
    const expected = Math.floor(base * 24 * m0 + ((0.75 + 0.375) / 2 / 0.75) * base * 12 * m1);
    expect(got).toBe(expected);
  });

  it('is unchanged from legacy behaviour on a calm multi-day window', () => {
    // Days 0-4 are all Clear Skies, so this window must equal the pure
    // trapezoid the function computed before this change.
    const d = dino(0, 150);
    const got = accruedIncome([d], 0, 999, 0, 60 * HOUR);
    const base = 60 * 0.75;
    // 0-36h at comfort 0.75 (hunger 150 -> 100), then 36-60h ramping to 0.
    const flat = base * 36;
    const ramp = ((0.75 + 0.25) / 2 / 0.75) * base * 24;
    expect(got).toBe(Math.floor(flat + ramp));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/world-income.test.ts`
Expected: FAIL on the seam tests — income is currently unmultiplied, so the first test's `expected` (which mixes 1.2 and 0.9) will not match.

If the last test ("unchanged on a calm window") also fails, your hand-computed expectation is wrong, not the code — recompute it before touching `clock.ts`.

- [ ] **Step 3: Make the change**

In `src/core/clock.ts`, add to the imports at the top:

```ts
import { incomeMultAt, utcMidnightsBetween } from './world.js';
```

Then replace the knee block inside `accruedIncome`'s per-dino loop. Currently:

```ts
    const seg = (a: number, b: number) =>
      ((comfortAt(d, a) + comfortAt(d, b)) / 2) * ((b - a) / 3_600_000);
    const knee = d.lastFedAt + Math.max(0, (d.hungerAtFed - 100) / 100) * drainMs;
    const comfortHours = knee > from && knee < dinoEnd
      ? seg(from, knee) + seg(knee, dinoEnd)
      : seg(from, dinoEnd);
```

Becomes:

```ts
    // Comfort is piecewise linear with a knee where hunger crosses 100
    // (overfill), and the world's income multiplier is piecewise constant with
    // a step at every UTC midnight. A two-point mean is exact WITHIN one linear,
    // single-event region and wrong across either kind of boundary, so both
    // kinds become breakpoints in one sorted list.
    const seg = (a: number, b: number) =>
      ((comfortAt(d, a) + comfortAt(d, b)) / 2) * ((b - a) / 3_600_000);
    const knee = d.lastFedAt + Math.max(0, (d.hungerAtFed - 100) / 100) * drainMs;
    // Midnights are enumerated over the PER-DINO window: using the shared `end`
    // would attribute income to a segment this dino never earned in.
    const breaks = [
      from,
      ...(knee > from && knee < dinoEnd ? [knee] : []),   // strict, as before
      ...utcMidnightsBetween(from, dinoEnd),
      dinoEnd,
    ].sort((x, y) => x - y);
    let comfortHours = 0;
    for (let i = 0; i < breaks.length - 1; i++) {
      const a = breaks[i];
      const b = breaks[i + 1];
      if (b <= a) continue;   // a knee landing exactly on a midnight yields one segment, not two
      // Sample the multiplier at the segment's START instant — never at the
      // request time. Reading eventMods(now).income here is the bug this whole
      // structure exists to prevent.
      comfortHours += seg(a, b) * incomeMultAt(a);
    }
```

- [ ] **Step 4: Run the new test**

Run: `npx vitest run tests/world-income.test.ts`
Expected: PASS.

- [ ] **Step 5: Run every test that touches income**

Run: `npx vitest run tests/clock.test.ts tests/park.test.ts tests/stats-sites.test.ts tests/journeys.test.ts`
Expected: PASS, **unedited**. These carry pinned integers (630, 484, 3600, 14, 19, 2070, and 440 twice) computed on days 0–2, which are Clear Skies. If any fails:
- A ±1 difference means float accumulation order changed a value across `Math.floor`. Investigate — do not "fix" the fixture.
- A large difference means midnights are being enumerated over `end` instead of `dinoEnd`, or the knee guard lost its strictness.
- Note `tests/park.test.ts:97` and `tests/stats-sites.test.ts:98-99` reach `accruedIncome` through `collectIncome` and never name it, so grepping for `accruedIncome` will not find them.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, PASS. `npm run typecheck` specifically proves the new `clock.ts → world.ts` import did not create a cycle that breaks compilation.

- [ ] **Step 7: Commit**

```bash
git add src/core/clock.ts tests/world-income.test.ts
git commit -m "Integrate income piecewise across UTC event boundaries"
```

---

## Task 4: Feed cost responds to the world

**Files:**
- Modify: `src/modules/care/service.ts:24-26` (`feedCostFor`), and its callers
- Test: `tests/world-effects.test.ts` (create)

**Interfaces:**
- Produces: `feedCostFor(rarity: Rarity, traits: string[], now: number): number` — **a third required parameter**. Making it required (not defaulted) is deliberate, exactly like `hungerAt`'s `drainMs`: a default would let a call site silently keep the unmodified cost.

- [ ] **Step 1: Find every caller**

Run: `grep -rn "feedCostFor" src/ tests/`

Expected callers in `src/`: `src/modules/care/service.ts` (definition plus `feedDino` / `feedAll`). Note `src/modules/care/index.ts:89` reads `RARITY[species.rarity].feedCost` **raw** for the autocomplete affordability label — it already ignores trait modifiers, so it is out of scope here; leave it and note it in the docs sweep (Task 20).

- [ ] **Step 2: Write the failing test**

Create `tests/world-effects.test.ts` with this first block:

```ts
import { describe, it, expect } from 'vitest';
import { feedCostFor } from '../src/modules/care/service.js';

const DAY = 86_400_000;

describe('feed cost under world events', () => {
  it('is unchanged on a calm day', () => {
    expect(feedCostFor('rare', [], 0)).toBe(20);
    expect(feedCostFor('common', [], 0)).toBe(5);
  });

  it('rises 30% during a Heat Wave', () => {
    expect(feedCostFor('rare', [], 5 * DAY)).toBe(26);      // 20 * 1.3
  });

  it('falls 25% during a Cold Snap', () => {
    expect(feedCostFor('rare', [], 8 * DAY)).toBe(15);      // 20 * 0.75
  });

  it('composes with the Thrifty trait inside the never-free floor', () => {
    // common feedCost 5, thrifty 0.75, cold snap 0.75 => 2.8125 -> round 3
    expect(feedCostFor('common', ['thrifty'], 8 * DAY)).toBe(3);
  });

  it('never returns less than one unit', () => {
    expect(feedCostFor('common', ['thrifty'], 8 * DAY)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run tests/world-effects.test.ts`
Expected: FAIL — `feedCostFor` takes two arguments.

- [ ] **Step 4: Implement**

In `src/modules/care/service.ts`, add the import and widen the function. The multiplier goes **inside** the existing `Math.max(1, Math.round(...))` so the never-free floor stays outermost — a discount applied after the floor can yield fractional units:

```ts
import { eventMods } from '../../core/world.js';

// `now` is REQUIRED, not defaulted, for the same reason hungerAt's drainMs is:
// a default lets a call site silently keep the unmodified cost.
export function feedCostFor(rarity: Rarity, traits: string[], now: number): number {
  return Math.max(1, Math.round(
    RARITY[rarity].feedCost * modProduct(traits, 'feed') * eventMods(now).feedCost,
  ));
}
```

(Keep whatever the existing `modProduct(traits, …)` domain key is — read line 24-26 and preserve it verbatim; only the new factor and the parameter are additions.)

Update the call sites in `feedDino` and `feedAll` to pass `ctx.now()`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/world-effects.test.ts tests/care.test.ts`
Expected: PASS both. `tests/care.test.ts:59-61,69` asserts `feedCostFor('rare', [])` === 20 — those calls need a third argument `0`. That is a required edit, and day 0 being calm is why the expected values do not change.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/modules/care tests/world-effects.test.ts tests/care.test.ts
git commit -m "Scale feed cost with the day's world event"
```

---

## Task 5: Expeditions respond to the world

Four modifiers on one module: duration, fee, cash, and egg-rarity odds.

**Files:**
- Modify: `src/modules/expeditions/service.ts` (`startExpedition` :31,:33; `claimExpedition` :46,:50)
- Modify: `src/modules/expeditions/index.ts:51` (the site autocomplete, which quotes cost and duration off `SiteDef`)
- Test: `tests/world-effects.test.ts` (append)

**Interfaces:**
- Consumes: `eventMods` from `src/core/world.ts`.
- Produces: `shiftOdds(odds: Array<{ rarity: Rarity; weight: number }>, step: -1 | 0 | 1): Array<{ rarity: Rarity; weight: number }>` exported from `src/modules/expeditions/service.ts`.

**Critical facts:**
- `claimExpedition` draws from `ctx.rng` in a **fixed order**: eggRarity (:46) → lootDiet (:47) → bonusCash (:50) → bonusFood (:51). Adding, removing, or reordering a draw shifts every downstream roll and silently changes seeded fixtures such as `tests/expeditions.test.ts:42-47`. **`shiftOdds` must consume zero rng** — it is a pure array transform applied before `rollRarityFromOdds`.
- `site.eggOdds` is a **weight array** (`Array<{ rarity, weight }>`, `src/data/sites.ts:7`), not a ladder. A "shift down one step" maps each entry's rarity down the ladder and merges duplicates.
- There is **no** `src/modules/expeditions/embeds.ts`; the module builds payloads inline.

- [ ] **Step 1: Write the failing test**

Append to `tests/world-effects.test.ts`:

```ts
import { shiftOdds } from '../src/modules/expeditions/service.js';

describe('expedition odds shifting', () => {
  it('is identity at step 0', () => {
    const odds = [{ rarity: 'rare' as const, weight: 40 }, { rarity: 'epic' as const, weight: 60 }];
    expect(shiftOdds(odds, 0)).toEqual(odds);
  });

  it('moves every entry one rarity down and merges collisions', () => {
    // rare+epic shifted down => uncommon+rare, no merge
    expect(shiftOdds([{ rarity: 'rare', weight: 40 }, { rarity: 'epic', weight: 60 }], -1))
      .toEqual([{ rarity: 'uncommon', weight: 40 }, { rarity: 'rare', weight: 60 }]);
  });

  it('floors at common and merges what piles up there', () => {
    expect(shiftOdds([{ rarity: 'common', weight: 70 }, { rarity: 'uncommon', weight: 30 }], -1))
      .toEqual([{ rarity: 'common', weight: 100 }]);
  });

  it('preserves total weight for every site at every step', async () => {
    const { EXPEDITION_SITES } = await import('../src/data/sites.js');
    for (const site of Object.values(EXPEDITION_SITES)) {
      const before = site.eggOdds.reduce((s, o) => s + o.weight, 0);
      for (const step of [-1, 0, 1] as const) {
        const after = shiftOdds(site.eggOdds, step).reduce((s, o) => s + o.weight, 0);
        expect(after, `${site.id} step ${step}`).toBeCloseTo(before, 6);
      }
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/world-effects.test.ts -t 'odds shifting'`
Expected: FAIL — `shiftOdds` is not exported.

- [ ] **Step 3: Implement `shiftOdds`**

In `src/modules/expeditions/service.ts`:

```ts
import { RARITY_LADDER } from '../../data/breeding.js';
import { eventMods } from '../../core/world.js';

/**
 * Move every entry `step` places along the rarity ladder, clamping at both ends
 * and merging entries that collide. Total weight is preserved, so this changes
 * the SHAPE of the distribution without changing how many rng draws follow —
 * claimExpedition's draw ORDER is load-bearing for seeded fixtures.
 */
export function shiftOdds(
  odds: Array<{ rarity: Rarity; weight: number }>,
  step: -1 | 0 | 1,
): Array<{ rarity: Rarity; weight: number }> {
  if (step === 0) return odds;
  const merged = new Map<Rarity, number>();
  for (const o of odds) {
    const idx = RARITY_LADDER.indexOf(o.rarity);
    const moved = RARITY_LADDER[Math.min(RARITY_LADDER.length - 1, Math.max(0, idx + step))];
    merged.set(moved, (merged.get(moved) ?? 0) + o.weight);
  }
  return RARITY_LADDER
    .filter((r) => merged.has(r))
    .map((r) => ({ rarity: r, weight: merged.get(r)! }));
}
```

- [ ] **Step 4: Apply the four modifiers**

In `startExpedition`, resolve the record once:

```ts
  const mods = eventMods(now);
  const returnsAt = now + Math.round(site.durationMs * mods.expeditionMs);
  // ...
  // Math.max(1, Math.round(...)) matches feedCostFor, the only other event-scaled
  // charge in the game. Math.ceil is float-unsafe here: 200 * 1.1 is
  // 220.00000000000003, which ceils to a whole-unit overcharge. The floor keeps
  // a steep discount from ever making an expedition free.
  ctx.economy.apply(userId, { cash: -Math.max(1, Math.round(site.cost * mods.expeditionFee)) }, `expedition:${siteId}`, now);
```

In `claimExpedition`:

```ts
  const mods = eventMods(ctx.now());
  const eggRarity = rollRarityFromOdds(shiftOdds(site.eggOdds, mods.expeditionOddsShift), ctx.rng);
  // ...draw order below is UNCHANGED...
  cash: Math.round(rollIntInclusive(site.bonusCash[0], site.bonusCash[1], ctx.rng) * mods.expeditionCash),
```

**The duration and fee must be captured at start.** `returnsAt` is written to the row and drives the scheduler timer — an event ending mid-flight must not retroactively move a scheduled timer.

- [ ] **Step 5: Fix the autocomplete so the picker cannot lie**

`src/modules/expeditions/index.ts:51` quotes `s.cost` and `fmtDuration(s.durationMs)` straight off `SiteDef`. During an Amber Storm those are both wrong. Apply the same `eventMods(ctx.now())` factors there.

Autocomplete providers are read-only and may only call `i.respond(...)` — `eventMods` is a pure function with no db access, so this is safe.

- [ ] **Step 6: Append the integration tests**

```ts
describe('expeditions under world events', () => {
  it('halves nothing on a calm day', async () => {
    const { makeCtx } = await import('./harness.js');
    const ctx = makeCtx({ nowMs: 0 });
    // ...seed a user with cash, start coastal_dig, assert returnsAt === now + 15min
    // and the cash delta is exactly -200. (Mirrors tests/expeditions.test.ts:30-31.)
  });

  it('shortens the dig and doubles the fee during an Amber Storm', async () => {
    const { makeCtx } = await import('./harness.js');
    const ctx = makeCtx({ nowMs: 10 * DAY });     // amber_storm
    // ...assert returnsAt === now + Math.round(15min * 0.75) and cash delta -400.
  });
});
```

Fill these in against the real seeding pattern in `tests/expeditions.test.ts` — copy its local `seed` helper; there is no shared one.

- [ ] **Step 7: Run everything expedition-shaped**

Run: `npx vitest run tests/world-effects.test.ts tests/expeditions.test.ts tests/autocomplete-expeditions.test.ts tests/stats-sites.test.ts`
Expected: PASS. `tests/expeditions.test.ts:30-31` and `:42-47` run on day 0 and must be unedited.

- [ ] **Step 8: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src/modules/expeditions tests/world-effects.test.ts
git commit -m "Scale expedition time, fee, cash and rarity odds with the world event"
```

---

## Task 6: Breeding time responds to the world

**Files:**
- Modify: `src/modules/genelab/service.ts:116-118`
- Test: `tests/world-effects.test.ts` (append)

**Critical fact:** `readyAt` is computed **before** the `opts.dryRun` early return at `:129`, so a single multiply covers the preview, the committed row, and the scheduler timer at `:147`. `tests/genelab.test.ts:227,233` pins preview === commit, so an implementation that multiplies only on the commit path fails immediately.

- [ ] **Step 1: Write the failing test**

```ts
describe('breeding time under world events', () => {
  it('is the base time on a calm day', async () => {
    // day 0: readyAt === now + BREED_MS.common
  });
  it('runs 25% longer during Migration Season', async () => {
    // day 27: readyAt === now + Math.round(BREED_MS.common * 1.25)
  });
  it('composes with Fertile, which still shortens it', async () => {
    // day 27 with a Fertile parent: Math.round(BREED_MS.common * 0.75 * 1.25)
  });
  it('quotes the same number in the dry-run preview as it commits', async () => {
    // startBreeding(..., { dryRun: true }).readyAt === startBreeding(...).readyAt
  });
});
```

Fill in against `tests/genelab.test.ts`'s local seeding helpers.

- [ ] **Step 2: Run, watch it fail, then implement**

The existing line is:

```ts
  const readyAt = Math.round(now + BREED_MS[sa.rarity] * timeMult);
```

`timeMult` already carries the Fertile multiplier. Compose the event factor into it:

```ts
  // The event factor composes into the SAME term Fertile already uses, so the
  // preview, the committed row and the scheduler timer at :147 can never
  // disagree — readyAt is computed before the dryRun early return below.
  const readyAt = Math.round(now + BREED_MS[sa.rarity] * timeMult * eventMods(now).breedMs);
```

- [ ] **Step 3: Verify the cooldown is untouched**

The post-claim cooldown is the **un-shortened** rarity time and must stay that way — Migration Season lengthens the wait *to* the egg, not the wait *between* pairings. Confirm no event factor reaches the cooldown computation in `claimBreeding`.

- [ ] **Step 4: Run, full suite, commit**

```bash
npx vitest run tests/world-effects.test.ts tests/genelab.test.ts
npm test && npm run typecheck
git add src/modules/genelab tests/world-effects.test.ts
git commit -m "Scale breeding time with the world event"
```

---

## Task 7: Battles respond to the world

Three modifiers, and the one with the most read sites.

**Files:**
- Modify: `src/modules/battles/service.ts` (energy gate :68, error text :71, debit :119; enemy HP :92; XP :108)
- Modify: `src/modules/battles/embeds.ts:153` (chapters screen energy cost)
- Modify: `src/modules/battles/index.ts:189-190` (stage autocomplete energy cost)
- Test: `tests/world-effects.test.ts` (append)

**Critical facts:**
- `stage.energyCost` has **five** readers. Three are inside `runFight`; two never touch it. Derive the adjusted cost **once** as a local in `runFight` and use it in all three; handle the two display sites separately.
- `stage.energyCost` is typed `1 | 2 | 3` (`src/data/battle/chapters/index.ts:26`), so `stage.energyCost + delta` widens to `number`. **Never write the result back onto the `StageDef`.**
- Enemy HP: one local `hp` at `:92` feeds **both** `maxHp: hp, hp,` at `:95`, so a single multiply covers current and max. ATK has its own inline `Math.round(s.atk * (boss?.atkMult ?? 1))` at `:95` — do **not** scale it.
- Battle XP: the multiplier belongs on `totalXp` at `:108`, **before** the floor-split at `:109` and the per-dino trait scaling at `:112`. `tests/battle-service.test.ts:74-75` asserts `totalXp % 3 === 2` and the exact `[baseXp + 2, baseXp, baseXp]` distribution — moving the multiply inside the map changes both the remainder and the rounding.

- [ ] **Step 1: Write the failing tests**

```ts
import { energyCostFor } from '../src/modules/battles/service.js';

describe('battles under world events', () => {
  it('costs the declared energy on a calm day', () => {
    expect(energyCostFor(3, 0)).toBe(3);
    expect(energyCostFor(1, 0)).toBe(1);
  });

  it('costs one less during a Blood Moon, floored at 1', () => {
    expect(energyCostFor(3, 7 * DAY)).toBe(2);     // boss
    expect(energyCostFor(2, 7 * DAY)).toBe(1);     // stage 4
    expect(energyCostFor(1, 7 * DAY)).toBe(1);     // already at the floor
  });

  // Plus, against the real runFight (copy the seeding shape from
  // tests/battle-service.test.ts):
  //  - enemy maxHp and hp are both x1.15 on day 7, while atk is unchanged
  //  - totalXp is x1.5 on day 7 and the floor-split remainder still goes to slot 1
  //  - the chapters embed and the stage autocomplete both quote the adjusted cost
});
```

- [ ] **Step 2: Implement**

Export a tiny pure helper so all five readers agree:

```ts
import { eventMods } from '../../core/world.js';

/** The energy a stage actually costs right now. Floored at 1 — Blood Moon can
 *  never make a stage free. StageDef.energyCost is typed 1|2|3 and must never
 *  be written back to. */
export function energyCostFor(declared: number, now: number): number {
  return Math.max(1, declared + eventMods(now).energyCostDelta);
}
```

In `runFight`, derive it once near the top and use that local at the gate, the error text, and the debit. In `embeds.ts:153` and `index.ts:189-190`, call `energyCostFor(stage.energyCost, ctx.now())`.

For HP at `:92`:

```ts
    const hp = Math.round(s.hp * (boss?.hpMult ?? 1) * mods.enemyHp);
```

For XP at `:108`, scale `totalXp` before the split:

```ts
    const totalXp = Math.round(baseTotalXp * mods.battleXp);
```

(Read `:105-112` first and preserve the existing comment about not scaling after the split.)

- [ ] **Step 3: Run, full suite, commit**

```bash
npx vitest run tests/world-effects.test.ts tests/battle-service.test.ts tests/battles-embeds.test.ts tests/autocomplete-battles.test.ts
npm test && npm run typecheck
git add src/modules/battles tests/world-effects.test.ts
git commit -m "Scale stage energy cost, enemy HP and battle XP with the world event"
```

---

## Task 8: Wild hatch trait odds respond to the world

**Files:**
- Modify: `src/modules/hatchery/service.ts` (the wild-hatch trait roll)
- Test: `tests/world-effects.test.ts` (append)

**Critical facts:**
- `rollTraits` already takes the odds as its second parameter with a `WILD_SLOT_ODDS` default (`src/data/traits.ts:91`) — **no signature change needed**.
- `hatchEgg`'s `egg.source === 'breeding'` branch (`:62`) must keep returning stored traits. A Migration Season odds table must **never** touch bred eggs; the comment at `:56-61` explains why.
- `tests/hatchery.test.ts:143` pins `expect(out.traits).toEqual(['fleet', 'prodigy'])` — a seeded rng replay whose **first** draw is the slot-count roll. It runs on day 0, so a calm day must leave the odds tuple identical or that fixture shifts.

- [ ] **Step 1: Write the failing test**

```ts
describe('wild hatch trait odds under world events', () => {
  it('uses the standard 55/35/10 odds on a calm day', async () => {
    // Statistical: hatch ~4000 wild eggs at day 0 with a seeded rng and assert
    // the 0-trait share is within 0.03 of 0.55.
  });
  it('uses 45/40/15 during Migration Season', async () => {
    // Same at day 27; assert the 0-trait share is within 0.03 of 0.45.
  });
  it('never applies the event odds to a bred egg', async () => {
    // Insert an egg with source 'breeding' and stored traits, hatch it on day 27,
    // and assert the stored traits come back verbatim.
  });
});
```

- [ ] **Step 2: Implement**

```ts
  const odds = eventMods(ctx.now()).hatchTraitOdds ?? undefined;
  const traits = rollTraits(ctx.rng, odds);
```

Passing `undefined` keeps `rollTraits`' own `WILD_SLOT_ODDS` default, so a calm day consumes rng identically to today.

- [ ] **Step 3: Run, full suite, commit**

```bash
npx vitest run tests/world-effects.test.ts tests/hatchery.test.ts
npm test && npm run typecheck
git add src/modules/hatchery tests/world-effects.test.ts
git commit -m "Improve wild hatch trait odds during Migration Season"
```

---

## Task 9: Shop prices and sell cash respond to the world

The highest quote-vs-charge risk in the plan. Every price has **three** read sites.

**Files:**
- Modify: `src/modules/shop/service.ts:29` (`buyEgg`), `:44` (`buyFood`)
- Modify: `src/modules/shop/index.ts:41` (view egg lines), `:43` (view food lines), `:93` (food autocomplete label), `:109` (rarity autocomplete label)
- Modify: `src/modules/shop/shards.ts:31` (`sellDino`), `:55` (`previewSell`)
- Modify: `src/modules/shop/index.ts:147` (sell autocomplete label)
- Test: `tests/world-effects.test.ts` (append)

**Interfaces:**
- Produces, exported from `src/modules/shop/service.ts`:
  - `eggPriceAt(rarity: Rarity, now: number): number`
  - `foodPriceAt(food: FoodDef, now: number): number`
  - and from `src/modules/shop/shards.ts`: `sellCashAt(rarity: Rarity, now: number): number`

Every one of the nine read sites must route through these three helpers. That is the entire point of the task.

- [ ] **Step 1: Write the parity test first — it is the real deliverable**

```ts
describe('quote-vs-charge parity', () => {
  // Market Panic: eggs x0.70, sell cash x0.80. Bumper Harvest: food x0.60.
  it('charges exactly what /shop view quotes for an egg', async () => {
    // day 38 (market_panic): render /shop view, parse the quoted price for a
    // rarity in today's rotation, buy it, assert the cash delta equals the quote.
  });
  it('charges exactly what the rarity autocomplete quotes', async () => {
    // day 38: run the rarity autocomplete, parse the price out of the label,
    // buy, assert the delta matches.
  });
  it('charges exactly what /shop view quotes for food', async () => {
    // day 18 (bumper_harvest), same shape for buyFood.
  });
  it('pays exactly what the /sell confirm preview quotes', async () => {
    // day 38: previewSell().cashValue === the cash delta from sellDino().
  });
  it('pays exactly what the /sell autocomplete quotes', async () => {
    // day 38: parse the label, sell, compare.
  });
  it('is a no-op on a calm day', async () => {
    // day 0: every quote equals the raw constant.
  });
});
```

Parse the numbers out of the real rendered strings — asserting against a recomputed constant would pass even if the display and the charge disagreed, which is exactly the bug being prevented.

- [ ] **Step 2: Run, watch it fail, implement the three helpers**

```ts
// src/modules/shop/service.ts
// Round-with-floor, matching feedCostFor and the expedition fee. Math.ceil is
// float-unsafe on an integer x fractional-multiplier product (200 * 1.1 is
// 220.00000000000003); the floor is what keeps a discount from reaching zero.
export function eggPriceAt(rarity: Rarity, now: number): number {
  return Math.max(1, Math.round(SHOP_EGG_PRICES[rarity] * eventMods(now).eggPrice));
}
export function foodPriceAt(food: FoodDef, now: number): number {
  return Math.max(1, Math.round(food.unitCost * eventMods(now).foodPrice));
}
```

```ts
// src/modules/shop/shards.ts
export function sellCashAt(rarity: Rarity, now: number): number {
  return Math.floor(SELL_CASH[rarity] * eventMods(now).sellCash);
}
```

Then replace all nine read sites. `tests/autocomplete-shop.test.ts:29` asserts an exact price substring in the rarity label and runs on day 0, so it must stay green unedited.

- [ ] **Step 3: Note the transaction asymmetry**

`buyFood` (`service.ts:40-48`) has **no** `ctx.db.transaction` wrapper, unlike `buyEgg` (`:30-37`). Adding a read is fine; if this task ever adds a second **write** there, wrap it first — `track` must sit inside the action's own transaction.

- [ ] **Step 4: Run, full suite, commit**

```bash
npx vitest run tests/world-effects.test.ts tests/shop.test.ts tests/autocomplete-shop.test.ts tests/sell.test.ts
npm test && npm run typecheck
git add src/modules/shop tests/world-effects.test.ts
git commit -m "Scale egg, food and sell prices with the world event"
```

---

## Task 10: Fix the shop rotation and add the daily deal

**Defect 8.2.** `dailyEggOffers` slices 3 offers from a pool of 2–3, so below a 4.0★ best-ever rating the returned set is **identical every day**, contradicting six places that promise otherwise.

**Files:**
- Modify: `src/modules/shop/service.ts:14-25`
- Modify: `src/data/shop.ts` (deal constants)
- Modify: `src/modules/shop/index.ts` (surface the deal)
- Test: `tests/shop.test.ts`, `tests/world-effects.test.ts`

**Interfaces:**
- Produces: `dailyDeal(offers: Rarity[], now: number): { rarity: Rarity; food: FoodId }` from `src/modules/shop/service.ts`.

**Critical facts — three ways to get this wrong:**
1. **Do not draw the deal from `dailyEggOffers`' rng instance.** That generator consumes 1 draw at the uncommon ceiling and 2–7 at higher ceilings — it varies with **both** the player's rarity ceiling and the day, because the comparator sort's comparison count depends on `base.length` and the legendary roll at `:23` is behind a short-circuit. A deal appended to that stream would differ per player, which is the opposite of a global deal. Use a **fresh** `mulberry32(day)` instance.
2. **Draw the deal rarity from today's `offers`, not the whole ladder.** `/shop egg` rejects any rarity not in `offers` at `src/modules/shop/index.ts:61` **before** reaching `buyEgg`, so a deal on an unavailable rarity is unbuyable — and invisible on exactly the two-rarity ceilings the fix exists for.
3. **Every shop test runs on UTC day 0.** Whatever the day-0 deal turns out to be lands on `tests/shop.test.ts:28`, `:35` and `:146`. Compute the day-0 deal and update those three expectations to match. **Do not** special-case the deal off in tests — that is the "test that cannot fail" failure mode this repo has already recorded.

- [ ] **Step 1: Compute the day-0 deal before writing any expectation**

Run this after implementing `dailyDeal` in Step 3, and use the output to fix the three assertions:

```bash
npx tsx -e "import {dailyEggOffers,dailyDeal} from './src/modules/shop/service.js'; const o=dailyEggOffers(0,0); console.log('offers',o,'deal',dailyDeal(o,0));"
```

- [ ] **Step 2: Write the failing tests**

```ts
describe('shop daily rotation', () => {
  it('varies day to day even at the two-rarity ceiling', () => {
    // highWater 0 => ceiling uncommon. Collect (offers, deal) for 30 days and
    // assert the set of distinct DEALS is > 1, since the offer SET cannot vary
    // when the pool has only two entries.
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) {
      const offers = dailyEggOffers(0, d * DAY);
      seen.add(JSON.stringify(dailyDeal(offers, d * DAY)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('always discounts a rarity that is actually in today\'s rotation', () => {
    for (const highWater of [0, 250, 450, 750]) {
      for (let d = 0; d < 60; d++) {
        const offers = dailyEggOffers(highWater, d * DAY);
        expect(offers).toContain(dailyDeal(offers, d * DAY).rarity);
      }
    }
  });

  it('gives every player the same deal on the same day, whatever their ceiling', () => {
    // The deal's own stream must not depend on how many draws dailyEggOffers used.
    for (let d = 0; d < 30; d++) {
      const lowCeil = dailyDeal(dailyEggOffers(0, d * DAY), d * DAY);
      const highCeil = dailyDeal(dailyEggOffers(750, d * DAY), d * DAY);
      expect(lowCeil.food, `day ${d}`).toBe(highCeil.food);
    }
  });

  it('never makes anything free', () => {
    for (let d = 0; d < 100; d++) {
      const offers = dailyEggOffers(750, d * DAY);
      const deal = dailyDeal(offers, d * DAY);
      expect(eggPriceAt(deal.rarity, d * DAY)).toBeGreaterThan(0);
    }
  });

  it('sorts before comparing sets — the ORDER varies even when the set cannot', () => {
    // Guard against a future test asserting deep equality on the array.
    const a = [...dailyEggOffers(0, 0)].sort();
    const b = [...dailyEggOffers(0, 7 * DAY)].sort();
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 3: Implement**

```ts
import { shuffle } from '../../core/rolls.js';

export function dailyEggOffers(highWater: number, now: number): Rarity[] {
  const ceiling = shopCeiling(highWater);
  const ceilIdx = LADDER.indexOf(ceiling);
  const pool = LADDER.slice(0, ceilIdx + 1);
  const day = Math.floor(now / 86_400_000);
  const rng = mulberry32(day);
  const canLegendary = ceiling === 'legendary';
  const base: Rarity[] = pool.filter((r) => r !== 'legendary');
  // Fisher-Yates, not `sort(() => rng() - 0.5)` — a comparator shuffle is
  // measurably biased and its draw COUNT varies with base.length.
  const offers: Rarity[] = shuffle(base, rng).slice(0, 3);
  if (canLegendary && rng() < LEGENDARY_DAY_CHANCE) offers.push('legendary');
  return offers;
}

/**
 * Today's discounted egg rarity and food item.
 *
 * Drawn from a FRESH generator, never from dailyEggOffers' instance: that one
 * consumes between 1 and 7 draws depending on the player's rarity ceiling, so a
 * deal sharing it would differ per player — the opposite of a global deal.
 *
 * The rarity is drawn from `offers` because /shop egg refuses any rarity not in
 * today's rotation (src/modules/shop/index.ts:61), so a deal outside it is
 * unbuyable — and invisible on exactly the two-rarity ceilings this fixes.
 */
export function dailyDeal(offers: Rarity[], now: number): { rarity: Rarity; food: FoodId } {
  const day = Math.floor(now / 86_400_000);
  const rng = mulberry32(day ^ DEAL_SALT);
  const rarity = offers[Math.floor(rng() * offers.length)];
  const foods = Object.values(FOODS);
  const food = foods[Math.floor(rng() * foods.length)].id;
  return { rarity, food };
}
```

Add to `src/data/shop.ts`:

```ts
export const DEAL_EGG_DISCOUNT = 0.8;    // -20%
export const DEAL_FOOD_DISCOUNT = 0.75;  // -25%
```

and a `DEAL_SALT` in `service.ts` alongside the function.

Fold the discount into Task 9's `eggPriceAt` / `foodPriceAt` so it flows through all nine read sites automatically — **the deal must never be display-only.**

- [ ] **Step 4: Surface the deal on `/shop view`**

Add a line naming the discounted rarity and food with their struck-through original prices.

- [ ] **Step 5: Fix the three day-0 assertions**

Using the Step 1 output, update `tests/shop.test.ts:28`, `:35` and `:146` to the real day-0 deal prices.

- [ ] **Step 6: Run, full suite, commit**

```bash
npx vitest run tests/shop.test.ts tests/world-effects.test.ts tests/autocomplete-shop.test.ts
npm test && npm run typecheck
git add src/modules/shop src/data/shop.ts tests/
git commit -m "Make the shop rotation actually rotate and add a daily deal"
```

---

## Task 11: Two tundra species

**Defect 8.3.** `grep -rn "tundra" src/data/species/` returns nothing across all 40 species, so Ice Block (700 cash, `biomeTags: ['tundra']`) can never grant any dino a comfort bonus.

**Files:**
- Create: `src/data/species/cryolophosaurus.ts`, `src/data/species/nanuqsaurus.ts`
- Modify: `src/data/species/index.ts`
- Modify: `tests/roster.test.ts` (**four** literals), `tests/rating.test.ts:78` (a stale comment)
- Modify: `docs/gameplay.md`, `README.md`

**Critical facts:**
- There is **no** biome union type — `biomeTags` is `string[]` (`src/data/types.ts:6`). A typo like `'Tundra'` compiles fine and silently caps the species at 0.75 comfort forever. The only thing that catches it is `tests/roster.test.ts:40-47`'s coverage guard against `DECOR`'s tags.
- Choose **uncommon** and **rare**. Common would change the archetype-spread test's denominator; mythic would change the `/mythic` builder choices and force an extra `deploy-commands`.
- Both reuse shipped `archetype × diet` cutouts, so **zero new art**.
- `tests/rating.test.ts:78`'s comment says "296 points of rarity weight now exist". That is a live sum and goes stale (+2 uncommon, +4 rare = 302). The assertion `expect(rating).toBe(400)` is **unaffected** — do not change it, just fix the comment.
- **`COLLECTION_TARGET` stays 190.** It is guarded only by a comment and `CLAUDE.md`, not by any test.

- [ ] **Step 1: Write the failing test**

Append to `tests/world-effects.test.ts` (or a new `tests/tundra.test.ts`):

```ts
import { paddockFit } from '../src/core/clock.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { allSpecies } from '../src/data/species/index.js';

describe('the tundra biome', () => {
  it('is claimed by at least one species', () => {
    const tundra = allSpecies().filter((s) => s.biomeTags.includes('tundra'));
    expect(tundra.length).toBeGreaterThanOrEqual(2);
  });

  it('lets an Ice Block reach full comfort for a tundra species', () => {
    const s = allSpecies().find((x) => x.biomeTags.includes('tundra'))!;
    const paddock = s.diet === 'herbivore'
      ? PADDOCKS.herbivore_paddock : PADDOCKS.carnivore_paddock;
    // NOTE: pass the decor KIND SLUG, never the biome tag — clock.ts:47 maps
    // kind -> DECOR[kind].biomeTags before comparing.
    expect(paddockFit(s, paddock, ['ice_block'])).toBe(1.0);
    expect(paddockFit(s, paddock, [])).toBe(0.75);
  });
});
```

- [ ] **Step 2: Run, watch it fail, then write the species**

`src/data/species/cryolophosaurus.ts`:

```ts
import type { Species } from '../types.js';
export const cryolophosaurus: Species = {
  id: 'cryolophosaurus', name: 'Cryolophosaurus', rarity: 'uncommon', diet: 'carnivore', archetype: 'swift',
  biomeTags: ['tundra'], flavor: 'The crested hunter of the frozen south.',
};
```

`src/data/species/nanuqsaurus.ts`:

```ts
import type { Species } from '../types.js';
export const nanuqsaurus: Species = {
  id: 'nanuqsaurus', name: 'Nanuqsaurus', rarity: 'rare', diet: 'carnivore', archetype: 'bruiser',
  biomeTags: ['tundra'], flavor: 'A polar tyrant, built small for a long winter.',
};
```

Both use the `: Species` annotation, matching every one of the 40 existing species files. Do not use `satisfies` here — consistency with the sibling files is the convention.

Register both in `src/data/species/index.ts` following the existing import + `ALL` array pattern exactly.

- [ ] **Step 3: Update the four roster literals**

In `tests/roster.test.ts`: line 5's `EXPECTED` record (uncommon 8→9, rare 8→9), line 8's test **name** string, line 10's `toHaveLength(40)` → 42, line 11's `.size).toBe(40)` → 42.

- [ ] **Step 4: Update the docs**

`docs/gameplay.md:245-248` — the total (40→42), the per-rarity breakdown, and the diet split (18 herbivores / 22 carnivores → 18 / 24). Insert the two rows **inside** their rarity blocks (Uncommon ends at `:267`, Rare at `:275`), not appended. `README.md:12` and `:21` each say "40 species".

Add a one-line note that two new species dilute their tier's flat hatch pool (`src/core/rolls.ts:35-38`): each existing uncommon goes from 1/8 to 1/9.

- [ ] **Step 5: Run, full suite, commit**

```bash
npx vitest run tests/roster.test.ts tests/rating.test.ts tests/images.test.ts
npm test && npm run typecheck
git add src/data/species tests/ docs/ README.md
git commit -m "Add two tundra species so Ice Block has something to sit beside"
```

---

## Task 12: Generate the eleven new banners

An asset task. `assetImage` null-degrades, so the code works without these — but Task 13's guard will fail until the two defect banners exist.

**Files:**
- Create: `assets/images/banners/daily.webp`, `assets/images/banners/achievements.webp`
- Create: `assets/images/banners/event-<id>.webp` × 9
- Modify: `docs/assets/prompts.md`

**Critical facts:**
- `docs/assets/prompts.md` **already carries** full prompts for `daily.webp` and `achievements.webp` at lines 599-619, plus **four** pieces of prose asserting they are "not yet generated": the intro at `:12-13`, two `*(not yet generated)*` table markers at `:393-394`, and paragraphs at `:396-399` and `:591-598`. Ship the files without deleting all four and the doc contradicts the repo. **No test catches this.**
- All banners must be exactly **1536×1024** WebP q95.
- `prompts.md` hard-codes "fifteen"/"Fifteen" embed banners at lines 7 and 371 **in words**. Update to twenty-six.

- [ ] **Step 1: Generate the two defect banners**

Use the prompts already at `docs/assets/prompts.md:599-619`. Then:

```bash
node scripts/fit-art.mjs banner <src> assets/images/banners/daily.webp
node scripts/fit-art.mjs banner <src> assets/images/banners/achievements.webp
```

- [ ] **Step 2: Generate the nine event banners**

One per `WORLD_EVENTS` entry, named `event-<id>.webp`. Use each event's `blurb` as the creative brief. Keep them wide establishing shots of the same park, so the nine read as one place under different conditions rather than nine different places.

```bash
node scripts/fit-art.mjs banner <src> assets/images/banners/event-clear_skies.webp
# ...and the other eight
```

- [ ] **Step 3: Add eleven prompt rows and delete the four stale claims**

Add rows in the established `prompts.md` format. Delete or rewrite the four "not yet generated" passages listed above. Update "fifteen" → "twenty-six" at `:7` and `:371`.

- [ ] **Step 4: Verify**

```bash
npx vitest run tests/images.test.ts
```

Expected: PASS, including the "ships every file under assets/images as .webp" walk.

- [ ] **Step 5: Commit**

```bash
git add assets/images/banners docs/assets/prompts.md
git commit -m "Add the daily and achievements banners and nine world event banners"
```

---

## Task 13: Replace the banner guard with a source scrape

**Defect 8.1's real fix.** `tests/images.test.ts:11-13` hand-types the 15 banner names that **do** exist and iterates that list — it is structurally incapable of finding a referenced-but-missing one, which is why `daily` and `achievements` shipped absent.

**Files:**
- Modify: `tests/images.test.ts:11-13` (the `BANNERS` constant), `:108-117` (the dimension loop)

**Critical facts — the spec's literal instruction regresses coverage:**
- A regex matching only `assetImage('banners', '<literal>')` finds **13** distinct names; the hand-typed list covers **15**. The four it drops are ternaries: `src/modules/care/index.ts:26` (`neglected ? 'care_neglect' : 'care'`) and `src/modules/battles/embeds.ts:53` (`outcome.won ? 'battle_victory' : 'battle_defeat'`). Match **every quoted string on a line containing `assetImage('banners'`** instead.
- A second reference form exists that no call-site regex can see: `HELP_TOPICS`' `art: { kind: 'banners', name: '<x>' }` descriptors in `src/modules/help/index.ts`. Scrape those too.
- **Root the scrape at `src/` only.** `tests/images.test.ts` itself contains `assetImage('banners', 'no-such-banner')` at `:101`; scraping `tests/` makes the guard demand that file exist.
- `BANNERS` feeds **two** tests. The 1536×1024 dimension loop at `:111` needs its own source of names — reuse the scraped list.
- `/world` will build its banner name from a **template literal** (`event-${event.id}`), which no scrape can see. That is the same blind spot; cover event banners by looping `WORLD_EVENTS` explicitly, following the existing `CAMPAIGN` precedent at `:285-294`.

- [ ] **Step 1: Write the new guard**

Replace the `BANNERS` constant with:

```ts
// Scraped from source, not hand-typed. The old hand-typed list could not
// detect a banner that source REFERENCES but the repo does not SHIP — which is
// exactly how daily.webp and achievements.webp shipped missing while all 1023
// tests passed (assetImage null-degrades).
//
// Matches every quoted string on a line mentioning assetImage('banners', ...)
// so ternary call sites are covered — a literal-only regex finds 13 of 15.
// Also picks up HELP_TOPICS' `art: { kind: 'banners', name: '…' }` descriptors,
// which no call-site regex can see.
// Rooted at src/ ONLY: this very file contains assetImage('banners','no-such-banner').
function scrapeBannerNames(): string[] {
  const names = new Set<string>();
  for (const file of srcFiles(resolve(process.cwd(), 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.includes("assetImage('banners'")) {
        for (const m of line.matchAll(/'([a-z0-9_-]+)'/g)) {
          if (m[1] !== 'banners') names.add(m[1]);
        }
      }
    }
    for (const m of text.matchAll(/kind:\s*'banners'\s*,\s*name:\s*'([a-z0-9_-]+)'/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

const BANNERS = scrapeBannerNames();
```

Add an existence test:

```ts
describe('banner art', () => {
  it('finds banner references to check', () => {
    expect(BANNERS.length, 'scrape found nothing — did the call form change?')
      .toBeGreaterThanOrEqual(15);
  });

  it('ships every banner the source references', () => {
    const missing = BANNERS.filter((n) => assetImage('banners', n) === null);
    expect(missing, `referenced but not shipped:\n${missing.join('\n')}`).toEqual([]);
  });

  // Event banners are built from a template literal (`event-${event.id}`), which
  // no scrape can see. Same blind spot, so cover them from the roster instead —
  // the precedent is the CAMPAIGN loop below.
  it('ships a banner for every world event', () => {
    for (const e of WORLD_EVENTS) {
      expect(assetImage('banners', `event-${e.id}`), `event-${e.id}`).not.toBeNull();
    }
  });

  it.each(BANNERS)('%s is 1536×1024', async (name) => {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', `${name}.webp`));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });
});
```

Add `import { WORLD_EVENTS } from '../src/data/world-events.js';` at the top.

- [ ] **Step 2: Prove the guard actually catches the defect**

Temporarily rename one banner and confirm the suite goes red:

```bash
mv assets/images/banners/daily.webp /tmp/daily.webp
npx vitest run tests/images.test.ts
# Expected: FAIL — "referenced but not shipped: daily"
mv /tmp/daily.webp assets/images/banners/daily.webp
```

Do this **outside** the test process — never `writeFileSync`/`rmSync` under `assets/images/` inside a test, because vitest runs files in parallel forks.

- [ ] **Step 3: Run, full suite, commit**

```bash
npx vitest run tests/images.test.ts && npm test && npm run typecheck
git add tests/images.test.ts
git commit -m "Guard banners by scraping source instead of hand-typing what exists"
```

---

## Task 14: The `world` module and `/world`

**Files:**
- Create: `src/modules/world/index.ts`, `src/modules/world/embeds.ts`, `tests/world-module.test.ts`
- Modify: `src/core/module-list.ts`, `modules.json`, `tests/registry-load.test.ts:9,10`, `tests/config.test.ts:22`, `tests/contract.test.ts:49`
- Modify: `docs/commands.md`

**Critical facts:**
- **Five registration sites**, and `CONTRIBUTING.md:99-109` documents only four (it omits `tests/contract.test.ts`). Do not use it as the checklist.
- `ModuleRegistry` filters with `flags[m.name] === true`. Forgetting `"world": true` in `modules.json` throws **nothing** — the module is silently disabled. Only `tests/config.test.ts:22` catches it.
- The count assertion is `tests/contract.test.ts:**49**`, not `:46`. Line 46 is the `describe`.
- Command names must match `/^[a-z-]+$/`. `world` passes.
- The command name `world` and the component prefix `world` are both currently free. A duplicate throws at registry construction, which happens at import time in `tests/harness.ts:33` — that failure takes down the **whole** suite, not one test.
- Once `worldModule` joins `ALL_MODULES`, `fakeCommand` switches `/world` fixtures from permissive to **strict**.
- Every payload a fake records is validated against Discord limits. A `/world` embed spelling out nine effect lines can trip description ≤4096 or combined ≤6000.
- `/world` is **not** in `dailyRouterHooks`' `EXEMPT_COMMANDS`, so a quest-complete followUp can land under a `/world` reply. That is the same behaviour every other non-daily command has. Leave it.

- [ ] **Step 1: Write `src/modules/world/embeds.ts`**

```ts
import { EmbedBuilder } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import { emojiTag } from '../../core/emojis.js';
import { worldEventFor, eventMods, seasonFor, seasonDay, SEASON_DAYS, dayIndex } from '../../core/world.js';
import type { EventMods } from '../../data/world-events.js';

const DAY_MS = 86_400_000;
const SEASON_LABEL = { wet: 'Wet', dry: 'Dry', cold: 'Cold' } as const;

/** One line for another module's embed, naming only the effects that screen
 *  cares about. A function, never a constant — emojiTag must resolve at render
 *  time or the unicode fallback freezes at module init. */
export function eventHeaderLine(now: number, keys: Array<keyof EventMods>): string {
  const e = worldEventFor(now);
  const mods = eventMods(now);
  const relevant = keys.some((k) => {
    const v = mods[k];
    return k === 'hatchTraitOdds' ? v !== null : v !== 1 && v !== 0;
  });
  const tag = emojiTag(e.emoji);
  if (!relevant) return `${tag} **${e.name}** — no effect here today`;
  return `${tag} **${e.name}** — ${e.effects.join(' · ')}`;
}

export function worldPayload(now: number): { embeds: EmbedBuilder[]; files?: never[] } {
  const e = worldEventFor(now);
  const season = seasonFor(now);
  const nextMidnight = (dayIndex(now) + 1) * DAY_MS;
  const tomorrow = worldEventFor(nextMidnight);

  const embed = new EmbedBuilder()
    .setTitle(`${emojiTag(e.emoji)} ${e.name}`)
    .setDescription(e.blurb);

  embed.addFields({
    name: 'Today',
    value: e.effects.length ? e.effects.map((l) => `• ${l}`).join('\n') : '• Nothing out of the ordinary',
  });
  embed.addFields(
    { name: 'Season', value: `${SEASON_LABEL[season]} — day ${seasonDay(now)} of ${SEASON_DAYS}`, inline: true },
    { name: 'Turns over', value: `<t:${Math.floor(nextMidnight / 1000)}:R>`, inline: true },
  );
  // Tomorrow's NAME only. It is derivable either way, so hiding it entirely
  // would be a fiction — the name is the hook, the numbers are the reveal.
  embed.setFooter({ text: `Tomorrow: ${tomorrow.name}` });

  const payload: { embeds: EmbedBuilder[] } = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', `event-${e.id}`));
  return payload;
}
```

- [ ] **Step 2: Write `src/modules/world/index.ts`**

```ts
import { SlashCommandBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { worldPayload } from './embeds.js';

export const worldModule: ModuleManifest = {
  name: 'world',
  commands: [
    {
      data: new SlashCommandBuilder().setName('world')
        .setDescription("Today's world event, the season, and what changes"),
      async execute(ctx, i) {
        await i.reply(worldPayload(ctx.now()));
      },
    },
  ],
  components: [],
};
```

- [ ] **Step 3: Register at all five sites**

1. `modules.json` — add `"world": true`
2. `src/core/module-list.ts` — import and append `worldModule` to `ALL_MODULES`
3. `tests/registry-load.test.ts:9` — `toHaveLength(13)` → `14`; `:10` — `toBe(24)` → `25`
4. `tests/config.test.ts:22` — add `world: true` to the `toEqual` object
5. `tests/contract.test.ts:49` — `toHaveLength(24)` → `25`

`AUTOCOMPLETE_OPTIONS` needs **no** entry — `/world` declares no autocompleting option.

- [ ] **Step 4: Write `tests/world-module.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { worldModule } from '../src/modules/world/index.js';
import { eventHeaderLine } from '../src/modules/world/embeds.js';

const DAY = 86_400_000;
const cmd = worldModule.commands[0];

describe('/world', () => {
  it('names the calm day and lists no effects', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const i = fakeCommand({ name: 'world', userId: 'u1' });
    await cmd.execute(ctx, i.interaction);
    const embed = i.replies[0].embeds[0].toJSON();
    expect(embed.title).toContain('Clear Skies');
    expect(embed.fields[0].value).toContain('Nothing out of the ordinary');
  });

  it('spells out every effect of an eventful day in plain language', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });     // heat_wave
    const i = fakeCommand({ name: 'world', userId: 'u1' });
    await cmd.execute(ctx, i.interaction);
    const embed = i.replies[0].embeds[0].toJSON();
    expect(embed.title).toContain('Heat Wave');
    expect(embed.fields[0].value).toContain('Park income +20%');
    expect(embed.fields[0].value).toContain('Feeding costs 30% more food');
    // No raw multipliers ever reach the player.
    expect(embed.fields[0].value).not.toContain('1.3');
  });

  it('names tomorrow but not its numbers', async () => {
    const ctx = makeCtx({ nowMs: 4 * DAY });     // day 5 is heat_wave
    const i = fakeCommand({ name: 'world', userId: 'u1' });
    await cmd.execute(ctx, i.interaction);
    const embed = i.replies[0].embeds[0].toJSON();
    expect(embed.footer!.text).toBe('Tomorrow: Heat Wave');
    expect(embed.footer!.text).not.toContain('%');
  });

  it('reports the season and its day', async () => {
    const ctx = makeCtx({ nowMs: 35 * DAY });
    const i = fakeCommand({ name: 'world', userId: 'u1' });
    await cmd.execute(ctx, i.interaction);
    const embed = i.replies[0].embeds[0].toJSON();
    expect(embed.fields.find((f) => f.name === 'Season')!.value).toBe('Dry — day 6 of 30');
  });

  it('stays inside Discord limits on the busiest event', async () => {
    // Blood Moon has three effect lines; the payload validator in the fake
    // throws on a limit breach, so simply executing is the assertion.
    const ctx = makeCtx({ nowMs: 7 * DAY });
    const i = fakeCommand({ name: 'world', userId: 'u1' });
    await cmd.execute(ctx, i.interaction);
    expect(i.replies).toHaveLength(1);
  });
});

describe('eventHeaderLine', () => {
  it('says so when nothing on this screen is affected', () => {
    expect(eventHeaderLine(5 * DAY, ['eggPrice', 'foodPrice']))
      .toContain('no effect here today');
  });
  it('lists the effects when the screen is affected', () => {
    expect(eventHeaderLine(38 * DAY, ['eggPrice', 'sellCash']))
      .toContain('Eggs cost 30% less');
  });
});
```

- [ ] **Step 5: Run, full suite, commit**

```bash
npx vitest run tests/world-module.test.ts tests/registry-load.test.ts tests/config.test.ts tests/contract.test.ts
npm test && npm run typecheck
git add src/modules/world src/core/module-list.ts modules.json tests/ docs/commands.md
git commit -m "Add the world module and the /world command"
```

---

## Task 15: Header lines on the four surfaces

**Files:**
- Modify: `src/modules/park/embeds.ts` (dashboard), `src/modules/shop/index.ts` (view), `src/modules/expeditions/index.ts` (start), `src/modules/battles/embeds.ts` (chapters)
- Test: `tests/world-module.test.ts` (append)

**Critical facts:**
- `/shop view`'s payload **already carries two attachments in a fixed order** (egg thumbnail, then the `shop_food_market` banner, `index.ts:55-56`) and `tests/shop.test.ts:130` asserts the banner by name. `attach` appends and call order is upload order — the header line is **text only**, so do not add an attachment here and do not reorder.
- `withParkImage` (`src/modules/park/embeds.ts:48-51`) **assigns** `files`, dropping anything `attach` added. The header is text on an existing embed, so this is safe — but do not add art to the `park` help topic without fixing `withParkImage` first.

- [ ] **Step 1: Write the failing tests**

```ts
describe('world header lines', () => {
  it('appears on /park view with only the income effect', async () => { /* day 5 */ });
  it('appears on /shop view with only the price effects', async () => { /* day 18 */ });
  it('appears on /expedition start with the dig effects', async () => { /* day 10 */ });
  it('appears on /battle chapters with the combat effects', async () => { /* day 7 */ });
  it('still renders on a calm day, saying nothing is unusual', async () => { /* day 0 */ });
});
```

- [ ] **Step 2: Implement**

At each site, prepend the line to the embed description with the keys that screen owns:

```ts
// park dashboard
eventHeaderLine(ctx.now(), ['income'])
// shop view
eventHeaderLine(ctx.now(), ['eggPrice', 'foodPrice', 'sellCash'])
// expedition start
eventHeaderLine(ctx.now(), ['expeditionMs', 'expeditionFee', 'expeditionCash', 'expeditionOddsShift'])
// battle chapters
eventHeaderLine(ctx.now(), ['energyCostDelta', 'battleXp', 'enemyHp'])
```

- [ ] **Step 3: Write the hard-invariant test**

Spec §4 requires a machine gate proving no event can move a gate. Every effect is wired by now, so this is the right moment. Append to `tests/world-effects.test.ts`:

```ts
import { recomputeRating } from '../src/modules/park/rating.js';
import { WORLD_EVENTS } from '../src/data/world-events.js';
import { worldEventFor } from '../src/core/world.js';

describe('the hard invariant — events never touch a gate', () => {
  // The day index at which each event first occurs, so the loop below covers
  // all nine without mocking anything.
  const DAY_OF: Record<string, number> = {
    clear_skies: 0, heat_wave: 5, blood_moon: 7, cold_snap: 8, amber_storm: 10,
    fossil_rush: 14, bumper_harvest: 18, migration_season: 27, market_panic: 38,
  };

  it('covers every event in the roster', () => {
    for (const e of WORLD_EVENTS) {
      expect(DAY_OF[e.id], `no fixture day for ${e.id}`).toBeDefined();
      expect(worldEventFor(DAY_OF[e.id] * DAY).id).toBe(e.id);
    }
  });

  it('computes an identical park rating under all nine events', () => {
    const ratings = new Set<number>();
    const highWaters = new Set<number>();
    for (const e of WORLD_EVENTS) {
      const ctx = makeCtx({ nowMs: DAY_OF[e.id] * DAY });
      const userId = seed(ctx);
      // Build an identical park in each ctx: one paddock, one assigned dino,
      // one decor piece. Copy the exact shape from tests/rating.test.ts.
      // ...
      const out = recomputeRating(ctx, userId);
      ratings.add(out.rating);
      highWaters.add(out.highWater);
    }
    expect([...ratings], 'an event moved park rating').toHaveLength(1);
    expect([...highWaters], 'an event moved best-ever rating').toHaveLength(1);
  });

  // Every gate in the game is a pure function of RATING ALONE. The way an event
  // could ever move one is by someone threading eventMods into the progression
  // layer, so assert that structurally — a value-comparison test here would be
  // tautological, since both sides would read the same unmodified constant.
  it('keeps the progression layer free of any dependency on the world', () => {
    const gateFiles = [
      resolve(process.cwd(), 'src/data/progression.ts'),
      resolve(process.cwd(), 'src/modules/park/rating.ts'),
    ];
    for (const file of gateFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} must not depend on the world`).not.toMatch(/core\/world\.js/);
      expect(text, `${file} must not depend on event data`).not.toMatch(/world-events\.js/);
    }
  });
});
```

Add `import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';` to the file. Fill the park-building block from `tests/rating.test.ts`'s local helpers.

- [ ] **Step 4: Run, full suite, commit**

```bash
npx vitest run tests/world-module.test.ts tests/world-effects.test.ts tests/park.test.ts tests/shop.test.ts tests/expeditions.test.ts tests/battles-embeds.test.ts tests/rating.test.ts
npm test && npm run typecheck
git add src/modules tests/world-module.test.ts tests/world-effects.test.ts
git commit -m "Show the day's world event on the four screens it affects"
```

---

## Task 16: Migration 0008 and `/settings world-news`

**Files:**
- Modify: `src/core/db/schema.ts` (`guildSettings`)
- Create: `drizzle/0008_*.sql`, `drizzle/meta/0008_snapshot.json`, `drizzle/meta/_journal.json` entry
- Modify: `src/modules/settings/index.ts`
- Modify: `tests/settings.test.ts:23-25,28-30`, `tests/migration.test.ts`

**Critical facts:**
- **`tests/settings.test.ts:23-25` and `:28-30` assert the whole row** with `toEqual([{ guildId, notifyChannelId }])`. Adding the column makes the select return a third key and **both fail**. This is a guaranteed red test, not optional cleanup.
- **There is no settings service.** The upsert is inline at `src/modules/settings/index.ts:16-17` and its `onConflictDoUpdate` sets **only** `notifyChannelId`. The world-news subcommand needs its **own** upsert setting only `worldBroadcast` — reusing the existing one would blank the other field.
- **Migration ordering is by journal `when`**, not filename and not hash. A 0008 entry whose `when` is ≤ 0007's silently never runs on any DB that already applied 0007 — no error. Always let `drizzle-kit generate` stamp it.
- The `hash` in `__drizzle_migrations` is written but **never compared**. Editing a shipped `.sql` neither errors nor re-runs. Finish the file before it ships.
- Drizzle-generated `.sql` files have **no trailing newline**. Do not let an editor add one.
- There is **no** `npm run db:generate`. The command is `npx drizzle-kit generate --name=world_broadcast`, run **after** the schema edit.
- `fakeCommand` validates against the real builder: once `/settings` has two subcommands, `fakeCommand({ name: 'settings' })` **with no `sub`** throws. Every existing `/settings` fixture must gain `sub: 'channel'`.
- `guild_settings` has no FK and `notify_channel_id` is nullable. `/settings world-news on` before `/settings channel` legitimately inserts a row with a null channel.

- [ ] **Step 1: Add the column to the schema**

```ts
export const guildSettings = sqliteTable('guild_settings', {
  guildId: text('guild_id').primaryKey(),
  notifyChannelId: text('notify_channel_id'),
  // Off by default: a server that set a channel for hatch pings never asked for
  // a daily world bulletin in it.
  worldBroadcast: integer('world_broadcast', { mode: 'boolean' }).notNull().default(false),
});
```

- [ ] **Step 2: Generate the migration**

```bash
npx drizzle-kit generate --name=world_broadcast
```

Verify: a new `drizzle/0008_*.sql` containing a single `ALTER TABLE ... ADD COLUMN`, a `drizzle/meta/0008_snapshot.json`, and a new `_journal.json` entry whose `when` is greater than 0007's. `0008_snapshot.json` should be `0007_snapshot.json` with a fresh uuid `id`, `prevId` set to 0007's exact id, and the one new column object under `tables.guild_settings.columns`.

- [ ] **Step 3: Add the subcommand**

```ts
        .addSubcommand((s) => s.setName('world-news').setDescription('Post the daily world bulletin in the notification channel')
          .addStringOption((o) => o.setName('state').setDescription('On or off').setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
```

and route on `i.options.getSubcommand()`. The world-news branch:

```ts
        const on = i.options.getString('state', true) === 'on';
        // Its OWN upsert: the channel branch's onConflictDoUpdate sets only
        // notifyChannelId, and reusing it here would blank the other field.
        ctx.db.insert(schema.guildSettings).values({ guildId: i.guildId, worldBroadcast: on })
          .onConflictDoUpdate({ target: schema.guildSettings.guildId, set: { worldBroadcast: on } }).run();
```

Use choices, **not** autocomplete — so `AUTOCOMPLETE_OPTIONS` needs no entry.

- [ ] **Step 4: Fix the two guaranteed-red assertions and every `/settings` fixture**

`tests/settings.test.ts:23-25` and `:28-30` gain `worldBroadcast: false`. Every `fakeCommand({ name: 'settings', ... })` in that file gains `sub: 'channel'`.

Note `tests/settings.test.ts:7` does `settingsModule.commands[0]` positionally — adding a **subcommand** is fine; adding a second **command** ahead of it would silently retarget every assertion.

- [ ] **Step 5: Add the migration test**

Follow the "production path" block in `tests/migration.test.ts`: seed a **parent and a child** row and drive the real `migrateDb`. An empty-DB run or a raw `db.exec` replay passes even when the journal entry is missing entirely.

- [ ] **Step 6: Run, full suite, commit**

```bash
npx vitest run tests/settings.test.ts tests/migration.test.ts
npm test && npm run typecheck
git add src/core/db/schema.ts drizzle src/modules/settings tests/
git commit -m "Add an opt-in world-news setting and its migration"
```

---

## Task 17: The daily broadcast

**Files:**
- Create: `src/modules/world/broadcast.ts`, `tests/world-broadcast.test.ts`
- Modify: `src/index.ts`

**Critical facts — four ways this ships as a silent no-op:**
1. **Registration must happen before the first tick.** An unregistered kind is added to the per-instance `attempted` set and is then unreachable for the life of the process (`tests/scheduler.test.ts:52-62`). `scheduler.register('world_broadcast', …)` goes next to `src/index.ts:34-36`, above the `setInterval` at `:38` and the ClientReady tick at `:47`. **Nothing in the test suite forces this edit** and `Scheduler.tick` silently `continue`s past an unhandled kind.
2. **Nothing seeds a timer at boot.** A self-rescheduling broadcast re-armed only by its own handler never starts on a fresh database. `src/index.ts` must seed the first one — and `timers` has **no unique index of any kind**, so seeding unconditionally on every boot accumulates duplicate rows and duplicate broadcasts. Guard on an existing unhandled row of that kind.
3. **A throwing handler never retries and never re-arms** until the process restarts — `tick` writes `handledAt` only after the handler resolves and leaves the row in `attempted`. Every send must be individually try/caught so one unpostable channel cannot abort the fan-out or the re-arm.
4. **Do not route through `deliverNotification`.** Its whole shape is per-user with a DM fallback (`src/core/notify.ts:37`), which is exactly what the spec forbids. Call `sender.channelSend(...)` directly.

Also: `Scheduler.enqueue` requires all five fields. Use `userId: '0'` (Discord snowflakes are numeric strings but never `0`), `refId: 0`, `originGuildId: null`. The sentinel matters because `adminReset` deletes timers **by `userId`** (`src/modules/admin/service.ts:51`) and `adminFastForward` shifts them by `userId` (`:112-113`) — a colliding sentinel would let resetting one player kill the world broadcast for every server.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { worldBroadcastHandler, armWorldBroadcast, WORLD_TIMER } from '../src/modules/world/broadcast.js';

const DAY = 86_400_000;

function fakeSender() {
  const channel: Array<{ channelId: string; payload: unknown }> = [];
  const dm: Array<{ userId: string; payload: unknown }> = [];
  return {
    channel, dm,
    channelSend: async (channelId: string, payload: unknown) => { channel.push({ channelId, payload }); },
    dmSend: async (userId: string, payload: unknown) => { dm.push({ userId, payload }); },
  };
}

describe('the world broadcast', () => {
  it('posts only to guilds that opted in AND have a channel', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    ctx.db.insert(schema.guildSettings).values([
      { guildId: 'g-in',      notifyChannelId: 'c1',  worldBroadcast: true },
      { guildId: 'g-out',     notifyChannelId: 'c2',  worldBroadcast: false },
      { guildId: 'g-nochan',  notifyChannelId: null,  worldBroadcast: true },
    ]).run();
    const s = fakeSender();
    await worldBroadcastHandler(s, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null });
    expect(s.channel.map((c) => c.channelId)).toEqual(['c1']);
  });

  it('never sends a DM', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g', notifyChannelId: 'c', worldBroadcast: true }).run();
    const s = fakeSender();
    await worldBroadcastHandler(s, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null });
    expect(s.dm).toEqual([]);
  });

  it('re-arms itself for the next UTC midnight', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY + 1000 });
    const s = fakeSender();
    await worldBroadcastHandler(s, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null });
    const timers = ctx.db.select().from(schema.timers).all();
    expect(timers.filter((t) => t.kind === WORLD_TIMER).map((t) => t.firesAt)).toEqual([6 * DAY]);
  });

  it('re-arms even when a channel send throws', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    ctx.db.insert(schema.guildSettings).values([
      { guildId: 'g1', notifyChannelId: 'bad', worldBroadcast: true },
      { guildId: 'g2', notifyChannelId: 'ok',  worldBroadcast: true },
    ]).run();
    const s = fakeSender();
    const throwing = { ...s, channelSend: async (id: string, p: unknown) => {
      if (id === 'bad') throw new Error('channel gone');
      return s.channelSend(id, p);
    } };
    await expect(worldBroadcastHandler(throwing, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null })).resolves.toBeUndefined();
    expect(s.channel.map((c) => c.channelId)).toEqual(['ok']);
    expect(ctx.db.select().from(schema.timers).all().filter((t) => t.kind === WORLD_TIMER)).toHaveLength(1);
  });

  it('arms exactly once however many times boot runs', () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    armWorldBroadcast(ctx);
    armWorldBroadcast(ctx);
    armWorldBroadcast(ctx);
    expect(ctx.db.select().from(schema.timers).all().filter((t) => t.kind === WORLD_TIMER)).toHaveLength(1);
  });

  it('survives adminReset of an arbitrary player', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    armWorldBroadcast(ctx);
    const { getOrCreateUser } = await import('../src/modules/park/service.js');
    const { adminReset } = await import('../src/modules/admin/service.js');
    getOrCreateUser(ctx, 'u1');
    adminReset(ctx, 'u1');
    expect(ctx.db.select().from(schema.timers).all().filter((t) => t.kind === WORLD_TIMER)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `src/modules/world/broadcast.ts`**

```ts
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { logger } from '../../core/logger.js';
import type { Sender } from '../../core/notify.js';
import type { Ctx } from '../../core/context.js';
import type { Timer } from '../../core/scheduler.js';
import { dayIndex } from '../../core/world.js';
import { worldPayload } from './embeds.js';

export const WORLD_TIMER = 'world_broadcast';
const DAY_MS = 86_400_000;

// The broadcast is not per-user, but Scheduler.enqueue requires a userId.
// '0' can never collide with a real Discord snowflake — which matters because
// adminReset deletes timers BY userId (admin/service.ts:51) and
// adminFastForward shifts them by userId (:112-113). A colliding sentinel would
// let resetting one player kill the world broadcast for every server.
const SENTINEL_USER = '0';

function nextMidnight(now: number): number {
  return (dayIndex(now) + 1) * DAY_MS;
}

/** Seed the first timer. Idempotent: `timers` has NO unique index, so an
 *  unguarded boot-time enqueue accumulates duplicate rows and, with them,
 *  duplicate broadcasts. */
export function armWorldBroadcast(ctx: Ctx): void {
  const pending = ctx.db.select().from(schema.timers)
    .where(and(eq(schema.timers.kind, WORLD_TIMER), isNull(schema.timers.handledAt))).all();
  if (pending.length > 0) return;
  ctx.scheduler.enqueue({
    kind: WORLD_TIMER, userId: SENTINEL_USER, refId: 0,
    originGuildId: null, firesAt: nextMidnight(ctx.now()),
  });
}

export function worldBroadcastHandler(sender: Sender, ctx: Ctx) {
  return async (_t: Timer): Promise<void> => {
    const now = ctx.now();
    // Opted in AND has somewhere to post: /settings world-news on before
    // /settings channel legitimately leaves notify_channel_id null.
    const targets = ctx.db.select().from(schema.guildSettings)
      .where(and(eq(schema.guildSettings.worldBroadcast, true),
                 isNotNull(schema.guildSettings.notifyChannelId))).all();

    for (const g of targets) {
      // Individually caught: Scheduler.tick writes handledAt only after the
      // handler RESOLVES and parks a thrower in `attempted`, so one unpostable
      // channel would otherwise kill the re-arm below for the whole process.
      try {
        // A FRESH payload per send. discord.js's MessagePayload pushes into
        // options.attachments and create() only shallow-copies it, so one
        // object forwarded to two sends accumulates duplicate attachment ids on
        // whichever resolves second. This is the finalPayload() lesson from
        // fightFrames (src/modules/battles/embeds.ts).
        await sender.channelSend(g.notifyChannelId!, worldPayload(now));
      } catch (err) {
        logger.warn({ err, guildId: g.guildId }, 'world broadcast send failed');
      }
    }

    // Re-arm LAST, and unconditionally.
    ctx.scheduler.enqueue({
      kind: WORLD_TIMER, userId: SENTINEL_USER, refId: 0,
      originGuildId: null, firesAt: nextMidnight(now),
    });
  };
}
```

- [ ] **Step 3: Wire `src/index.ts`**

Next to lines 34-36, above the `setInterval`:

```ts
scheduler.register('world_broadcast', worldBroadcastHandler(sender, ctx));
```

and in the `ClientReady` handler, before the boot tick:

```ts
  armWorldBroadcast(ctx);
```

- [ ] **Step 4: Run, full suite, commit**

```bash
npx vitest run tests/world-broadcast.test.ts tests/scheduler.test.ts tests/admin.test.ts
npm test && npm run typecheck
git add src/modules/world/broadcast.ts src/index.ts tests/world-broadcast.test.ts
git commit -m "Broadcast the daily world bulletin to servers that opt in"
```

---

## Task 18: Nine event emoji

**Files:**
- Create: `assets/emojis/svg/dw_event_<id>.svg` × 9, and their PNGs via `npm run build-emojis`
- Modify: `src/core/emojis.ts` (`EMOJI_FALLBACK`), `tests/emojis.test.ts:37-50`, `docs/ops.md:64`, `docs/assets/prompts.md:1107`

**Critical facts — adding SVGs alone breaks the build in four places:**
1. `tests/emoji-assets.test.ts:100-105` requires a matching `EMOJI_FALLBACK` entry for every SVG.
2. `tests/emojis.test.ts:37-50` is a **hand-written 43-element sorted array**. The nine names must be inserted **in sorted position** (`dw_event_*` sorts after `dw_dino_uncommon`, before `dw_ferns`) and the title bumped 43 → 52.
3. `tests/docs-assets.test.ts:13-18` requires all three quoted counts (`docs/ops.md:64` twice, `docs/assets/prompts.md:1107` once) to become 52.
4. `tests/emoji-assets.test.ts:61` reads a PNG sibling per SVG and fails hard if it is missing.

Authoring constraints:
- `viewBox="0 0 64 64"` with **no** width/height attributes.
- Inset the art: the four corner pixels must be fully transparent at 128×128 (`:70-73`) and opaque pixels must exist inside the central 64×64 (`:78-83`). Convention is `rect x="5" y="5" width="54" height="54" rx="14"` or a circle of r ≤ 27 at 32,32.
- **`MAX_BLACK_SHARE` is 0.02** of opaque pixels at exactly `rgb(0,0,0)`. Blood Moon and Amber Storm are the at-risk designs — use `#1a1512`, `#0b2233` or `#2e1f16`. Raising the threshold is forbidden by `CLAUDE.md`.
- **resvg gradient trap:** `<ellipse fill="url(#…)">` with default `objectBoundingBox` renders **solid black**. Use `gradientUnits="userSpaceOnUse"` with `y1 = cy − ry`, `y2 = cy + ry` — or just use `<circle>`, which is unaffected, as 36 of the 43 existing files do.
- Give every event a **real unicode fallback** (☀️🌩️🦴🔥❄️🌾📉🩸🧬). An empty-string fallback inherits the `setEmoji` throw hazard.
- The `tests/docs-assets.test.ts` regex is `/(\d+)\s+(?:custom |application )?emojis/g` over the whole of both docs. Prose like "ships 9 new emojis" creates a fourth match and fails. Write "nine event emoji" — spelled out, singular.

- [ ] **Step 1: Author the nine SVGs**
- [ ] **Step 2: Add nine `EMOJI_FALLBACK` entries**
- [ ] **Step 3: `npm run build-emojis`, then `git status`**

Expected: exactly **nine** new PNGs and no modifications to the existing 43. `npm run deploy-emojis` is hash-diffing and **irreversible** — any PNG whose bytes changed is deleted and recreated with a new snowflake id, breaking every `<:name:oldid>` already posted. If existing PNGs show as modified, stop and investigate the toolchain before deploying.

- [ ] **Step 4: Update the sorted array and the three doc counts**
- [ ] **Step 5: Run, full suite, commit**

```bash
npx vitest run tests/emoji-assets.test.ts tests/emojis.test.ts tests/docs-assets.test.ts
npm test && npm run typecheck
git add assets/emojis src/core/emojis.ts tests/ docs/
git commit -m "Add nine world event emoji"
```

---

## Task 19: Season grounds in the park renderer

**Files:**
- Create: `assets/images/park/ground-{wet,dry,cold}.webp`
- Modify: `src/core/render/art.ts`, `src/core/render/draw.ts`, `src/modules/park/snapshot.ts`
- Modify: `tests/render-art.test.ts`, `tests/render-draw.test.ts`, `tests/park-snapshot.test.ts`, `tests/docs-assets.test.ts:20-24`, `docs/assets/prompts.md`

**Critical facts:**
- **The season id must reach `drawGround` via `ParkSnapshot`**, not via `Date.now()`. `buildParkSnapshot` has `ctx` and can call `ctx.now()`. Deriving it inside `drawGround` from `Date.now()` violates `CLAUDE.md` **and** makes `renderParkPng` non-deterministic for the byte-identity test at `tests/render-draw.test.ts:162-164`.
- **`tests/render-worker.test.ts:64-68` is a source-scrape** on `worker.ts` requiring `/renderParkPng\(\s*\w+\s*,\s*art\s*\)/`. Season selection must therefore happen **inside `draw.ts`**, so `worker.ts` keeps that literal form.
- `ParkArt` is used as an **object literal** in two places outside `src/`: `stubArt` at `tests/render-draw.test.ts:141-147` and `EMPTY_ART` at `art.ts:31-34`. A non-optional new field breaks `npm run typecheck` on the test literal — which `npm test` alone will **not** catch.
- All three rasters must be `await img.decode()`'d inside `loadParkArt`'s existing `Promise.all` at `art.ts:66-68`. A raster loaded through `loadSvgImage` draws a **blank rectangle with no error**.
- `loadParkArt` must never reject. Each new read keeps its own try/catch — `loadRasterImage` already provides one; do not add a bare `await` outside it.
- `drawImage(null)` throws and costs the user the whole image. Chain `?? art.ground ?? null` and keep `drawGround`'s existing `if (!img)` flat-fill guard (`draw.ts:82`) as the terminal fallback. That fallback colour `'#356b2c'` is an inline literal in `drawGround`, **not** in `render-icons.ts`.
- Two pixel tests sample the ground at exactly (10, 240): `tests/render-draw.test.ts:171` and `tests/render-park-art.test.ts:85`. If the no-season path stops resolving to `art.ground`, both fail.
- **`scripts/fit-art.mjs` has no mode that produces 1200×800.** `banner` is hard-coded 1536×1024 and `cutout` 1024×1024. The existing `ground.webp` is 1200×800 (3:2) and `tests/park-art-assets.test.ts:19-23` asserts width/height > 1. Either add a mode or script the cover-crop inline — **do not** claim `fit-art.mjs` produces them. Match 3:2 or the cover-crop differs visibly between seasons.
- `tests/docs-assets.test.ts:20-24` **hand-lists** the three existing park rasters. The three new ones need both a prompt row and an entry in that array — the test does not auto-discover. (This is the same structural weakness Task 13 fixed for banners; note it, but fixing it here is out of scope.)

- [ ] **Step 1: Generate the three grounds at 1200×800 WebP q95**
- [ ] **Step 2: Widen `ParkSnapshot` with `season: Season`, set from `ctx.now()` in `buildParkSnapshot`**

`structuredClone(snap)` must still not throw (`tests/park-snapshot.test.ts:43`) — a string is fine. **Never** put an `Image` on the snapshot.

- [ ] **Step 3: Widen `ParkArt` with `seasonGrounds: Record<Season, Image | null>` and load all three in `loadParkArt`**

Update `EMPTY_ART` and `tests/render-draw.test.ts`'s `stubArt`.

- [ ] **Step 4: Select inside `drawGround`**

```ts
  const img = art.seasonGrounds?.[snap.season] ?? art.ground ?? null;
```

- [ ] **Step 5: Run, full suite, typecheck, commit**

```bash
npx vitest run tests/render-art.test.ts tests/render-draw.test.ts tests/render-park-art.test.ts tests/render-worker.test.ts tests/park-snapshot.test.ts tests/park-art-assets.test.ts tests/docs-assets.test.ts tests/images.test.ts
npm test && npm run typecheck
git add assets/images/park src/core/render src/modules/park/snapshot.ts tests/ docs/
git commit -m "Re-tint the park map ground with the season"
```

---

## Task 20: Documentation sweep

Nothing in CI reads `docs/gameplay.md` or `docs/commands.md`, so every one of these happens only because this task lists it.

**Files:** `docs/gameplay.md`, `docs/commands.md`, `docs/ops.md`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `src/modules/help/index.ts`

- [ ] **Step 1: Fix the "rotates daily" claim in all six places**

`docs/gameplay.md:611-612` and `:623-628`, `docs/commands.md:71` and `:72`, `docs/ops.md:228` and `:411`, and **`src/modules/help/index.ts:46-47`** — the `/help topic:shop` body, which is user-facing product text, not documentation. Fixing only the two the spec named leaves the bot itself still saying it.

- [ ] **Step 2: Correct the notification count**

`docs/gameplay.md:795` says the bot notifies about **three** things. It is four today (`breeding_ready` is wired at `src/index.ts:36` and enqueued at `src/modules/genelab/service.ts:147`) and five after this plan. `:796` says there are "no hunger or escape notifications of any kind" — still true after Spec 1a; Spec 1b changes it.

- [ ] **Step 3: Add a world section to `docs/gameplay.md` and `/world` to `docs/commands.md`**

Document the nine events with their real numbers, the 1-in-3 calm rate, the season cycle, that events never touch rating or any gate, and that income is paid per segment at each day's own rate.

- [ ] **Step 4: Fix `CONTRIBUTING.md:99-109`**

It documents only **four** registration sites and omits `tests/contract.test.ts`. Anyone following it misses the command count.

- [ ] **Step 5: Update `CLAUDE.md`**

Add a Living World block recording, at minimum:
- the world is derived, never stored, and `WORLD_SALT` is pinned so UTC days 0–4 are calm **because the whole test suite runs on day 0**
- income is the only integrated effect; drain rate and energy regen were deliberately **not** used, and why
- `feedCostFor` and `energyCostFor` take `now` as a **required** parameter for the same reason `hungerAt` takes `drainMs`
- the three-read-site rule for every price (quote and charge must route through one helper)
- the broadcast timer's `userId: '0'` sentinel and why `adminReset` makes it necessary
- `tests/contract.test.ts:**49**` is the command-count line — fix the existing `:46` reference

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md README.md CONTRIBUTING.md src/modules/help/index.ts
git commit -m "Document the living world and correct six stale shop-rotation claims"
```

---

## Final verification

- [ ] `npm run build`
- [ ] `npm run typecheck`
- [ ] `npm test` — expect roughly 1023 + ~70 new tests, all green
- [ ] `git status` — clean

## Ops checklist

In this order. `scripts/test-live.ts:60-64` fails with `manifest emoji '<name>' missing on Discord` for any manifest key not present remotely, so running `test:live` early reports nine spurious failures.

1. `npm run build-emojis` — verify `git status` shows only the nine new PNGs
2. `npm run deploy-emojis` — **irreversible**; changed bytes delete and recreate an emoji with a new id
3. **Restart the bot** — `loadAppEmojis` runs once at `ClientReady`, so a live process serves missing ids for the new emoji until it restarts
4. `npm run deploy-commands` — 24 → 25 top-level commands, with **exactly one bot instance per token** (10062 on every command means duplicate instances racing, not a code bug)
5. `npm run test:live` — cosmetic review of the nine event banners and the three season grounds
6. Migration 0008 applies automatically on next boot via `migrateDb`
