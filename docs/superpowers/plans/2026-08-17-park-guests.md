# Park Guests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add attendance — a derived, frozen-target measure of how appealing a park is — as a second progression axis, gating a cash-priced catalog of attractions and a ladder of one-time milestone rewards.

**Architecture:** Attendance is computed at read time from three inputs (roster variety, attractions owned, Visitor Center level), each clamped or table-resolved. It is never stored and never integrated over time. A monotone `users.attendanceHighWater` is stamped by `recomputeRating`, which already runs after every mutation that can move those inputs, and that high-water gates attraction slots, catalog rungs and milestones. Attractions cost cash and produce no currency, so the feedback loop's output is never its own input.

**Tech Stack:** TypeScript (ESM NodeNext, `.js` on every relative import), discord.js, drizzle-orm 0.45.2 + better-sqlite3 (synchronous — `.get()`/`.all()`/`.run()`, never awaited), vitest, `@napi-rs/canvas` for the park renderer.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-17-park-guests-design.md`. Read it before Task 1.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()`/`Math.random()`.
- Every relative import carries a `.js` extension.
- **Never index a per-level array raw.** Every one goes through `levelValue(table, level, fallback)` (`src/modules/park/service.ts:48-60`). `tsconfig` has `strict` but not `noUncheckedIndexedAccess`, so an out-of-range read yields `undefined`, which becomes `NaN` silently — invisible to both `npm test` and `npm run typecheck`.
- **`ATTENDANCE_SPECIES_TARGET` and `ATTRACTION_DRAW_TARGET` are frozen literals.** Never a live sum over `allSpecies()` or over the catalog. A live denominator retroactively taxes every existing player. This is the `COLLECTION_TARGET = 190` rule.
- **Attendance must never read `users.landmarkTier`.** `tests/landmarks.test.ts:51-55` is a closed allowlist of files that may mention the identifier and fails in both directions.
- **`track()` sits inside the transaction of the write it measures.** A rolled-back action must never count.
- **`ctx.economy.apply` commits its own transaction**, so any charge-plus-mutation must be wrapped in an outer `ctx.db.transaction(...)` or a failed write after a successful charge leaves the player debited with nothing.
- **Read paths stay pure.** Only write contexts stamp a high-water. This is the `legacyRank` vs `bumpLegacyBest` split (`src/modules/park/ranks.ts`).
- No new dependency, and do not bump `drizzle-kit`/`drizzle-orm` in this branch — a generator bump in the same change that generates migration 0017 against a populated live DB confounds two risks.
- Author every commit as RegEdits. No AI/tool attribution of any kind in commit messages, code comments, or docs.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/data/attendance.ts` | Frozen constants and pure math: `attendanceFrom`, `ATTENDANCE_MILESTONES`, `milestonesUpTo`. No DB, no Ctx. |
| `src/data/attractions.ts` | The catalog: 6 kinds × 3 levels, per-level `draw`, cash costs, unlock thresholds. Frozen data only. |
| `src/modules/park/attendance.ts` | `attendanceOf(ctx, userId)` — a **pure** DB read composing the catalog with the park. Lives in `park/` beside `rating.ts` and `ranks.ts` so `leaderboards` and `park/embeds` can import it without a cycle. |
| `src/modules/guests/service.ts` | `buildAttraction`, `upgradeAttraction`, `claimMilestone`, `claimableMilestones`, error classes. |
| `src/modules/guests/embeds.ts` | `guestsPayload`, `builtPayload`, `milestonePayload`. |
| `src/modules/guests/index.ts` | The `ModuleManifest`: `/guests view|build|claim` plus the `guests` component prefix. |
| `tests/attendance.test.ts` | Pure-math and `attendanceOf` tests. |
| `tests/attractions-content.test.ts` | Machine gate over the catalog. |
| `tests/guests.test.ts` | Service + command + button tests. |

**Modify:** `src/core/db/schema.ts` (one users column, two tables, one enum widening) · `src/modules/park/rating.ts` (stamp the high-water) · `src/modules/admin/service.ts` (reset coverage) · `src/core/stats.ts` (one `StatId`) · `src/modules/park/embeds.ts` + `src/modules/park/index.ts` (dashboard field) · `src/modules/leaderboards/service.ts` + `index.ts` (8th metric) · `src/modules/park/snapshot.ts` + `src/core/render/draw.ts` (attraction cells) · `src/modules/help/index.ts` · `modules.json` · `src/core/module-list.ts` · `tests/registry-load.test.ts` · `tests/config.test.ts` · `tests/contract.test.ts` · `tests/stats.test.ts` · `tests/season-content.test.ts` · `tests/leaderboards.test.ts` · `tests/admin.test.ts` · `tests/journeys.test.ts` · `docs/gameplay.md` · `docs/commands.md` · `docs/ops.md` · `README.md`.

---

## Task 1: Schema, migration 0017, and admin coverage

Admin coverage ships **in this task, not later**, because the repo has shipped the "reset misses the new table" defect four separate times (`breedings`; `user_stats`/`daily_quests`/`achievement_claims`; `season_progress`/`season_claims`; `alerts_sent`/`species_seen`) and there is no every-table assertion anywhere to catch it.

**Files:**
- Modify: `src/core/db/schema.ts`
- Create (generated): `drizzle/0017_park_guests.sql`, `drizzle/meta/0017_snapshot.json`, an entry in `drizzle/meta/_journal.json`
- Modify: `src/modules/admin/service.ts:44-123` (`adminReset`)
- Test: `tests/admin.test.ts`

**Interfaces:**
- Produces: `schema.attractions` (`id`, `userId`, `kind`, `level`, `builtAt`), `schema.attendanceClaims` (`userId`, `milestone`, `claimedAt`), `users.attendanceHighWater: number`, and `'guests'` added to the `eggs.source` enum union.

- [ ] **Step 1: Write the failing test**

Add to `tests/admin.test.ts`:

```ts
it('adminReset clears attractions, milestone claims and the attendance high-water', () => {
  const ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.db.insert(schema.attractions).values({
    userId: 'u1', kind: 'gift_shop', level: 2, builtAt: 0,
  }).run();
  ctx.db.insert(schema.attendanceClaims).values({
    userId: 'u1', milestone: 200, claimedAt: 0,
  }).run();
  ctx.db.update(schema.users).set({ attendanceHighWater: 900 })
    .where(eq(schema.users.discordId, 'u1')).run();

  adminReset(ctx, 'u1');

  expect(ctx.db.select().from(schema.attractions).all()).toHaveLength(0);
  expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(0);
  expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/admin.test.ts -t "adminReset clears attractions"`
Expected: FAIL — `schema.attractions` is undefined.

- [ ] **Step 3: Add the column, the two tables, and the enum value**

In `src/core/db/schema.ts`, inside the `users` table definition, after `landmarkTier`:

```ts
  // Monotone, stamped by recomputeRating alongside ratingHighWater. Gates attraction
  // slots, catalog rungs and milestones. Deliberately NO CHECK constraint: SQLite's
  // ALTER grammar has no ADD CONSTRAINT, so adding one forces a full users table
  // recreate (drizzle/0003_tricky_zuras.sql is the proof — its only delta was a CHECK).
  // users.duelRating is the shipped precedent for declining one. A high-water is never
  // decremented, so there is no underflow to guard.
  attendanceHighWater: integer('attendance_high_water').notNull().default(0),
```

Widen the `eggs.source` enum in the same edit — the emitted SQL is plain `text NOT NULL` with no CHECK, so this is a **TypeScript-only** change that produces no SQL:

```ts
  source: text('source', { enum: ['expedition', 'shop', 'trade', 'admin', 'battle', 'breeding', 'quest', 'guests'] }).notNull(),
```

Append the two tables at the end of the file:

```ts
export const attractions = sqliteTable('attractions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  kind: text('kind').notNull(),
  level: integer('level').notNull().default(1),
  // History, not a due-time: adminFastForward deliberately does NOT shift this, the
  // same decision species_seen.first_at_ms records. If a build cooldown is ever added,
  // THAT column must shift.
  builtAt: integer('built_at_ms').notNull(),
});

// One row per claimed milestone. Composite primary key rather than uniqueIndex, matching
// season_claims and achievement_claims — the shipped claim-ledger shape.
export const attendanceClaims = sqliteTable('attendance_claims', {
  userId: text('user_id').notNull().references(() => users.discordId),
  milestone: integer('milestone').notNull(),
  claimedAt: integer('claimed_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.milestone] })]);
```

No barrel to update: `src/core/db/index.ts` does `import * as schema from './schema.js'`, so `schema.attractions` resolves immediately.

- [ ] **Step 4: Generate the migration**

Run from the repo root: `npx drizzle-kit generate --name=park_guests`

- [ ] **Step 5: Read the emitted SQL by eye — this is a required gate, not a formality**

Open `drizzle/0017_park_guests.sql`. It MUST contain only `CREATE TABLE` statements and one `ALTER TABLE \`users\` ADD \`attendance_high_water\` integer DEFAULT 0 NOT NULL;`.

If it contains `CREATE TABLE __new_users` → copy → `DROP TABLE users` → rename, **stop**: something added a CHECK or dropped a column. Delete the generated `.sql`, hand-write the `ALTER` line in its place, keep the generated snapshot and journal entry. No test can distinguish a well-formed recreate from an `ALTER`, so this eyeball check is the only gate.

Confirm all three artifacts exist and the new `_journal.json` entry is `idx: 17` with a `when` greater than `1786729898533`. Ordering is by `when`, and an entry whose `when` is not greater silently never runs, with no error.

- [ ] **Step 6: Add the reset coverage**

In `src/modules/admin/service.ts`, among the existing `ctx.db.delete(...)` calls in `adminReset`:

```ts
  ctx.db.delete(schema.attractions).where(eq(schema.attractions.userId, targetId)).run();
  ctx.db.delete(schema.attendanceClaims).where(eq(schema.attendanceClaims.userId, targetId)).run();
```

And in the same function's users `.set({ ... })` object:

```ts
    attendanceHighWater: 0,
```

Add nothing to `adminFastForward`: `builtAt` is history and `attendanceHighWater` is a balance. Record that decision as a comment beside the other non-shift decisions already in that function.

- [ ] **Step 7: Run the test and the full suite**

Run: `npx vitest run tests/admin.test.ts -t "adminReset clears attractions"`
Expected: PASS

Run: `npm test`
Expected: all green — nothing else reads the new tables yet.

- [ ] **Step 8: Commit**

```bash
git add src/core/db/schema.ts drizzle/ src/modules/admin/service.ts tests/admin.test.ts
git commit -m "Add the attractions and attendance-claims tables"
```

---

## Task 2: Attendance constants and pure math

**Files:**
- Create: `src/data/attendance.ts`
- Test: `tests/attendance.test.ts`

**Interfaces:**
- Produces: `ATTENDANCE_SCALE: number`, `ATTENDANCE_SPECIES_TARGET: number`, `ATTRACTION_DRAW_TARGET: number`, `ATTRACTION_MAX_BONUS: number`, `VC_ATTENDANCE_MULT: number[]`, `attendanceFrom(distinctSpecies: number, drawTotal: number, vcLevel: number): number`, `ATTENDANCE_MILESTONES: readonly MilestoneDef[]`, `milestonesUpTo(highWater: number): MilestoneDef[]`.

There is deliberately **no slot pool**. Each attraction kind is gated by its own `unlockAt` threshold and duplicates are refused, so a separate slot ladder would be a second table kept in lockstep with the first for no behavioural difference — the two ladders were identical and the slot check was unreachable.

- [ ] **Step 1: Write the failing test**

Create `tests/attendance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  attendanceFrom, ATTENDANCE_SCALE, ATTENDANCE_SPECIES_TARGET,
  ATTRACTION_DRAW_TARGET, ATTRACTION_MAX_BONUS, VC_ATTENDANCE_MULT,
  ATTENDANCE_MILESTONES, milestonesUpTo,
} from '../src/data/attendance.js';

describe('attendanceFrom', () => {
  it('is zero with no species, whatever else is built', () => {
    expect(attendanceFrom(0, ATTRACTION_DRAW_TARGET, 5)).toBe(0);
  });

  it('clamps the species term so extra species past the target add nothing', () => {
    const at = attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, 0);
    expect(attendanceFrom(ATTENDANCE_SPECIES_TARGET + 12, 0, 0)).toBe(at);
    expect(at).toBe(ATTENDANCE_SCALE);
  });

  it('clamps the attraction term at the frozen draw target', () => {
    const capped = attendanceFrom(ATTENDANCE_SPECIES_TARGET, ATTRACTION_DRAW_TARGET, 0);
    expect(attendanceFrom(ATTENDANCE_SPECIES_TARGET, ATTRACTION_DRAW_TARGET * 3, 0)).toBe(capped);
    expect(capped).toBe(Math.round(ATTENDANCE_SCALE * (1 + ATTRACTION_MAX_BONUS)));
  });

  it('clamps a Visitor Center level above the array instead of reading undefined', () => {
    const top = attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, VC_ATTENDANCE_MULT.length);
    expect(attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, 99)).toBe(top);
    expect(Number.isFinite(attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, 99))).toBe(true);
  });

  it('treats a park with no Visitor Center as the neutral multiplier', () => {
    expect(attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, 0)).toBe(ATTENDANCE_SCALE);
  });
});

describe('ATTENDANCE_MILESTONES', () => {
  it('is strictly ascending', () => {
    const at = ATTENDANCE_MILESTONES.map((m) => m.at);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(new Set(at).size).toBe(at.length);
  });

  it('pays shards well under the season track ceiling of 110', () => {
    const shards = ATTENDANCE_MILESTONES.reduce((s, m) => s + (m.reward.shards ?? 0), 0);
    expect(shards).toBeLessThan(110);
  });

  it('milestonesUpTo returns every milestone at or below the high-water', () => {
    expect(milestonesUpTo(0)).toEqual([]);
    expect(milestonesUpTo(ATTENDANCE_MILESTONES[0].at)).toEqual([ATTENDANCE_MILESTONES[0]]);
    expect(milestonesUpTo(999_999)).toHaveLength(ATTENDANCE_MILESTONES.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/attendance.test.ts`
Expected: FAIL — cannot resolve `../src/data/attendance.js`.

- [ ] **Step 3: Write the module**

Create `src/data/attendance.ts`:

```ts
import type { FoodId } from './foods.js';
import type { Rarity } from './types.js';

/** Attendance is quoted on the same 1000-point scale as park rating. */
export const ATTENDANCE_SCALE = 1000;

/**
 * Distinct species on display for a full variety term. FROZEN, and deliberately NOT a
 * live count over allSpecies(): a live target in the numerator means every species that
 * ships raises everyone's attendance and retroactively cheapens every threshold and
 * catalog rung already priced against it. This is COLLECTION_TARGET's rule (190,
 * src/data/progression.ts) applied to the other side of the fraction. The min(1, …)
 * clamp is what makes a new species an ALTERNATE PATH to the same target.
 *
 * 40 against the 52-species roster: reachable by a park deliberately built for variety
 * (a 6-paddock L4 build holds 48), out of reach for one built for cash — all 5 legendary
 * and all 3 mythic species are carnivores, so the income-maximal park holds 5 distinct
 * species and is SUPPOSED to score badly here.
 */
export const ATTENDANCE_SPECIES_TARGET = 40;

/**
 * Total attraction draw for a full attraction term. FROZEN for the same reason as the
 * species target. Equal to the sum of every catalog kind's top-level draw, which
 * tests/attractions-content.test.ts asserts — so a fully built catalog saturates this
 * term exactly, and adding a kind later is a deliberate decision to move the target
 * rather than an accident that inflates everyone.
 */
export const ATTRACTION_DRAW_TARGET = 210;

/** The most a fully saturated attraction catalog can add: +60%. */
export const ATTRACTION_MAX_BONUS = 0.6;

/** Per Visitor Center level. Index 0 is level 1, and level 0 (no VC) takes the fallback. */
export const VC_ATTENDANCE_MULT = [1.0, 1.05, 1.1, 1.15, 1.2];

export interface MilestoneReward { cash?: number; shards?: number; foods?: Partial<Record<FoodId, number>>; egg?: Rarity }
export interface MilestoneDef { at: number; name: string; reward: MilestoneReward }

/**
 * One-time claims as the high-water climbs. Shards total 80, comfortably under the
 * season track's 110-per-season ceiling, so this ladder never becomes the cheapest
 * shard faucet in the game.
 */
export const ATTENDANCE_MILESTONES: readonly MilestoneDef[] = [
  { at:  200, name: 'Opening Day',    reward: { cash: 250_000, foods: { fresh_greens: 20 } } },
  { at:  400, name: 'Word of Mouth',  reward: { cash: 750_000, egg: 'rare' } },
  { at:  700, name: 'Regional Draw',  reward: { cash: 2_000_000, shards: 15 } },
  { at: 1000, name: 'Marquee Park',   reward: { cash: 5_000_000, egg: 'epic' } },
  { at: 1400, name: 'Destination',    reward: { cash: 12_000_000, shards: 25 } },
  { at: 1800, name: 'World Renowned', reward: { cash: 25_000_000, shards: 40, egg: 'legendary' } },
];

/**
 * Attendance from its three already-resolved terms. Pure, and deliberately takes plain
 * numbers rather than a Ctx: everything time-varying (hunger, comfort, world events,
 * the season) is excluded by construction, because attendance is a GATE and a gate that
 * moves every millisecond has no stable threshold.
 */
export function attendanceFrom(distinctSpecies: number, drawTotal: number, vcLevel: number): number {
  const species = Math.min(1, Math.max(0, distinctSpecies) / ATTENDANCE_SPECIES_TARGET);
  const attraction = 1 + Math.min(1, Math.max(0, drawTotal) / ATTRACTION_DRAW_TARGET) * ATTRACTION_MAX_BONUS;
  // Same clamp discipline as levelValue: a level above the array takes its top entry,
  // never undefined. Level 0 (no Visitor Center) takes the neutral 1.
  const vc = vcLevel <= 0 ? 1 : VC_ATTENDANCE_MULT[Math.min(vcLevel, VC_ATTENDANCE_MULT.length) - 1] ?? 1;
  return Math.round(ATTENDANCE_SCALE * species * attraction * vc);
}

export function milestonesUpTo(highWater: number): MilestoneDef[] {
  return ATTENDANCE_MILESTONES.filter((m) => highWater >= m.at);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/attendance.test.ts`
Expected: PASS. If the `fresh_greens` food id does not exist, read `src/data/foods.ts` and substitute a real `FoodId` — the type will have failed under `npm run typecheck`, not `npm test`.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/data/attendance.ts tests/attendance.test.ts
git commit -m "Add attendance constants and its pure arithmetic"
```

---

## Task 3: The attractions catalog

**Files:**
- Create: `src/data/attractions.ts`
- Test: `tests/attractions-content.test.ts`

**Interfaces:**
- Consumes: `ATTRACTION_DRAW_TARGET` from `src/data/attendance.js`.
- Produces: `ATTRACTIONS: Record<string, AttractionDef>`, `AttractionDef { kind, name, maxLevel, draw: number[], buildCost, upgradeCosts: number[], unlockAt }`, `attractionFor(kind: string): AttractionDef | null`, `MAX_ATTRACTION_LEVEL`.

- [ ] **Step 1: Write the failing test**

Create `tests/attractions-content.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ATTRACTIONS, attractionFor, MAX_ATTRACTION_LEVEL } from '../src/data/attractions.js';
import { ATTRACTION_DRAW_TARGET } from '../src/data/attendance.js';

const ALL = Object.values(ATTRACTIONS);

describe('attractions catalog', () => {
  it('keys every entry by its own kind', () => {
    for (const [key, def] of Object.entries(ATTRACTIONS)) expect(def.kind).toBe(key);
  });

  it('gives every kind exactly maxLevel draw values and maxLevel-1 upgrade costs', () => {
    for (const def of ALL) {
      expect(def.draw).toHaveLength(def.maxLevel);
      expect(def.upgradeCosts).toHaveLength(def.maxLevel - 1);
    }
  });

  it('makes draw and cost strictly ascending within every kind', () => {
    for (const def of ALL) {
      for (let i = 1; i < def.draw.length; i++) expect(def.draw[i]).toBeGreaterThan(def.draw[i - 1]);
      for (let i = 1; i < def.upgradeCosts.length; i++) {
        expect(def.upgradeCosts[i]).toBeGreaterThan(def.upgradeCosts[i - 1]);
      }
      expect(def.upgradeCosts[0]).toBeGreaterThan(def.buildCost);
    }
  });

  it('saturates the frozen draw target exactly when fully built', () => {
    const total = ALL.reduce((s, d) => s + d.draw[d.draw.length - 1], 0);
    expect(total).toBe(ATTRACTION_DRAW_TARGET);
  });

  it('unlocks its first kind at zero and every other at a distinct rising threshold', () => {
    const gates = ALL.map((d) => d.unlockAt).sort((a, b) => a - b);
    expect(gates[0]).toBe(0);
    expect(new Set(gates).size).toBe(gates.length);
  });

  it('makes a costlier kind draw more, so the unlock order is also the power order', () => {
    const byGate = [...ALL].sort((a, b) => a.unlockAt - b.unlockAt);
    for (let i = 1; i < byGate.length; i++) {
      const top = (d: typeof byGate[number]) => d.draw[d.draw.length - 1];
      expect(top(byGate[i])).toBeGreaterThan(top(byGate[i - 1]));
    }
  });

  it('costs a full catalog between 10 and 25 days of reference surplus', () => {
    const total = ALL.reduce((s, d) => s + d.buildCost + d.upgradeCosts.reduce((a, b) => a + b, 0), 0);
    const REFERENCE_SURPLUS_PER_DAY = 4_297_440;   // src/data/landmarks.ts
    expect(total / REFERENCE_SURPLUS_PER_DAY).toBeGreaterThan(10);
    expect(total / REFERENCE_SURPLUS_PER_DAY).toBeLessThan(25);
  });

  it('makes each kind dearer than the one unlocking before it', () => {
    const cost = (d: typeof ALL[number]) => d.buildCost + d.upgradeCosts.reduce((a, b) => a + b, 0);
    const byGate = [...ALL].sort((a, b) => a.unlockAt - b.unlockAt);
    for (let i = 1; i < byGate.length; i++) {
      expect(cost(byGate[i])).toBeGreaterThan(cost(byGate[i - 1]));
    }
  });

  it('derives MAX_ATTRACTION_LEVEL from the catalog rather than a retyped literal', () => {
    expect(MAX_ATTRACTION_LEVEL).toBe(Math.max(...ALL.map((d) => d.maxLevel)));
  });

  it('resolves a known kind and refuses an unknown one', () => {
    expect(attractionFor('gift_shop')?.kind).toBe('gift_shop');
    expect(attractionFor('no_such_kind')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/attractions-content.test.ts`
Expected: FAIL — cannot resolve `../src/data/attractions.js`.

- [ ] **Step 3: Write the catalog**

Create `src/data/attractions.ts`:

```ts
export interface AttractionDef {
  kind: string; name: string; maxLevel: number;
  /** Draw per level, index 0 = level 1. Read ONLY through levelValue. */
  draw: number[];
  buildCost: number; upgradeCosts: number[];
  /** Attendance high-water at which this kind becomes buildable. */
  unlockAt: number;
}

/**
 * The guest-facing build catalog. Priced in CASH and paying no currency of its own, which
 * is what bounds the feedback loop structurally: attractions raise attendance, attendance
 * unlocks attractions, and attendance produces no cash — so the loop's output is never its
 * own input, and the ceiling is a closed-form expression rather than a tuned constant.
 *
 * Deliberately its own table rather than a third lots.type. lots.type carries no SQL CHECK,
 * so widening that enum would have needed no migration at all — but recomputeRating sums
 * `l.level + l.decor.length` over ALL lots with no type filter, so attractions-as-lots would
 * silently gain rating power on a backwards curve (worth ~8.75 rating to a mid-game park,
 * exactly 0 to a saturated one). A separate table makes the power-freedom structural rather
 * than a filter someone has to remember, the same argument that kept landmarks off DECOR.
 *
 * Six kinds, each gated by its own unlockAt and buildable at most once — there is no separate
 * slot pool, because a slot ladder keyed on the same high-water would be a second table kept
 * in lockstep with these thresholds for no behavioural difference. The top-level draws sum to
 * ATTRACTION_DRAW_TARGET, so a complete catalog saturates the attraction term exactly, and the
 * unlock order is also the power order. Both facts are machine-gated in
 * tests/attractions-content.test.ts.
 *
 * Per-kind totals rise strictly with the unlock order — 3M / 6M / 12M / 18M / 24M / 30M — so
 * the last attraction is also the dearest. An earlier draft shaved the top rung to hold an
 * arbitrary 20-day ceiling, which inverted that and made the final kind cheaper than the one
 * before it.
 *
 * Total cost 93,000,000 — 21.6 days of the reference park's unspent surplus (4,297,440/day),
 * against the landmark ladder's 315,000,000 / 47-73 days and the entire rest of the game's
 * purchasable content at 4,299,000 / ~1 day.
 *
 * No emojiTag anywhere in this file: the emoji map loads after client ready, so a module-level
 * constant would freeze the unicode fallback permanently.
 */
export const ATTRACTIONS: Record<string, AttractionDef> = {
  picnic_lawn: {
    kind: 'picnic_lawn', name: 'Picnic Lawn', maxLevel: 3,
    draw: [6, 12, 20], buildCost: 250_000, upgradeCosts: [750_000, 2_000_000], unlockAt: 0,
  },
  gift_shop: {
    kind: 'gift_shop', name: 'Gift Shop', maxLevel: 3,
    draw: [8, 16, 26], buildCost: 500_000, upgradeCosts: [1_500_000, 4_000_000], unlockAt: 150,
  },
  viewing_platform: {
    kind: 'viewing_platform', name: 'Viewing Platform', maxLevel: 3,
    draw: [10, 20, 32], buildCost: 1_000_000, upgradeCosts: [3_000_000, 8_000_000], unlockAt: 300,
  },
  amber_carousel: {
    kind: 'amber_carousel', name: 'Amber Carousel', maxLevel: 3,
    draw: [12, 24, 38], buildCost: 1_500_000, upgradeCosts: [4_500_000, 12_000_000], unlockAt: 500,
  },
  sky_gondola: {
    kind: 'sky_gondola', name: 'Sky Gondola', maxLevel: 3,
    draw: [14, 28, 44], buildCost: 2_000_000, upgradeCosts: [6_000_000, 16_000_000], unlockAt: 700,
  },
  grand_atrium: {
    kind: 'grand_atrium', name: 'Grand Atrium', maxLevel: 3,
    draw: [16, 32, 50], buildCost: 2_500_000, upgradeCosts: [7_500_000, 20_000_000], unlockAt: 900,
  },
};

export const MAX_ATTRACTION_LEVEL = 3;

/** The def for a kind, or null for an unknown or retired slug — never a throw. */
export function attractionFor(kind: string): AttractionDef | null {
  return ATTRACTIONS[kind] ?? null;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/attractions-content.test.ts`
Expected: PASS. The draw sum is `20+26+32+38+44+50 = 210`, matching `ATTRACTION_DRAW_TARGET`. The per-kind cost totals are `3,000,000 / 6,000,000 / 12,000,000 / 18,000,000 / 24,000,000 / 30,000,000` — strictly rising with the unlock order — summing to `93,000,000`, which is `21.64` days of reference surplus.

- [ ] **Step 5: Commit**

```bash
git add src/data/attractions.ts tests/attractions-content.test.ts
git commit -m "Add the attractions catalog and its content gate"
```

---

## Task 4: `attendanceOf` and the high-water stamp

**Files:**
- Create: `src/modules/park/attendance.ts`
- Modify: `src/modules/park/rating.ts`
- Test: `tests/attendance.test.ts` (extend)

**Interfaces:**
- Consumes: `toClockDinos` (`src/modules/park/service.js`), `facilityLevel`, `levelValue`, `attendanceFrom`, `ATTRACTIONS`.
- Produces: `attendanceOf(ctx: Ctx, userId: string): { attendance: number; distinctSpecies: number; drawTotal: number; vcLevel: number }` — a **pure read, no writes**. `recomputeRating` now also stamps `users.attendanceHighWater`.

- [ ] **Step 1: Write the failing test**

Append to `tests/attendance.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { recomputeRating } from '../src/modules/park/rating.js';
import { attendanceOf } from '../src/modules/park/attendance.js';

function seedPark(ctx: ReturnType<typeof makeCtx>) {
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 500_000 }, 'test:seed', 0);
  return buildLot(ctx, 'u1', 'herbivore_paddock');
}

describe('attendanceOf', () => {
  it('counts distinct assigned species and ignores unassigned and escaped ones', () => {
    const ctx = makeCtx();
    const lot = seedPark(ctx);
    const add = (speciesId: string, over: Record<string, unknown> = {}) =>
      ctx.db.insert(schema.dinos).values({
        userId: 'u1', lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over,
      }).run();
    add('triceratops');
    add('triceratops');                       // duplicate species — counts once
    add('gallimimus');
    add('stegosaurus', { lotId: null });      // unassigned — never counts
    add('parasaurolophus', { escapedAt: 1 }); // escaped — never counts

    expect(attendanceOf(ctx, 'u1').distinctSpecies).toBe(2);
  });

  it('is a pure read — it writes nothing', () => {
    const ctx = makeCtx();
    seedPark(ctx);
    const before = ctx.db.select().from(schema.users).all()[0];
    attendanceOf(ctx, 'u1');
    expect(ctx.db.select().from(schema.users).all()[0]).toEqual(before);
  });

  it('adds attraction draw resolved through levelValue, clamping an over-range level', () => {
    const ctx = makeCtx();
    const lot = seedPark(ctx);
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const bare = attendanceOf(ctx, 'u1').attendance;
    ctx.db.insert(schema.attractions).values({ userId: 'u1', kind: 'gift_shop', level: 3, builtAt: 0 }).run();
    const built = attendanceOf(ctx, 'u1');
    expect(built.drawTotal).toBe(26);
    expect(built.attendance).toBeGreaterThan(bare);

    ctx.db.update(schema.attractions).set({ level: 99 }).run();
    expect(attendanceOf(ctx, 'u1').drawTotal).toBe(26);   // clamped, never NaN
    expect(Number.isFinite(attendanceOf(ctx, 'u1').attendance)).toBe(true);
  });

  it('ignores a retired or unknown attraction kind rather than throwing', () => {
    const ctx = makeCtx();
    seedPark(ctx);
    ctx.db.insert(schema.attractions).values({ userId: 'u1', kind: 'retired_kind', level: 2, builtAt: 0 }).run();
    expect(attendanceOf(ctx, 'u1').drawTotal).toBe(0);
  });

  it('recomputeRating stamps a monotone attendance high-water', () => {
    const ctx = makeCtx();
    const lot = seedPark(ctx);
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    recomputeRating(ctx, 'u1');
    const high = ctx.db.select().from(schema.users).all()[0].attendanceHighWater;
    expect(high).toBe(attendanceOf(ctx, 'u1').attendance);
    expect(high).toBeGreaterThan(0);

    // Tearing the park down must not lower the high-water.
    ctx.db.delete(schema.dinos).run();
    recomputeRating(ctx, 'u1');
    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(high);
    expect(attendanceOf(ctx, 'u1').attendance).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/attendance.test.ts -t "attendanceOf"`
Expected: FAIL — cannot resolve `../src/modules/park/attendance.js`.

- [ ] **Step 3: Write `attendanceOf`**

Create `src/modules/park/attendance.ts`:

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { toClockDinos, facilityLevel, levelValue } from './service.js';
import { attractionFor } from '../../data/attractions.js';
import { attendanceFrom } from '../../data/attendance.js';

export interface Attendance {
  attendance: number; distinctSpecies: number; drawTotal: number; vcLevel: number;
}

/**
 * Guests per hour, derived at read time and stored never — the same philosophy as escrow
 * locks, quest progress and world events.
 *
 * PURE. It must never write, because it is read for OTHER players' parks (the leaderboard,
 * a visit, another player's park card). The monotone high-water is stamped separately, by
 * recomputeRating, which only ever runs in a write context — the legacyRank / bumpLegacyBest
 * split (./ranks.ts) applied again.
 *
 * The dino predicate is byte-identical to recomputeRating's `assigned` filter (./rating.ts:18)
 * on purpose: it reads the STORED escapedAt column, never the computed escapeAt instant, so
 * every surface that settles escapes first sees a fresh value and no surface has to settle
 * just to render a number.
 *
 * Nothing here reads hunger, comfort, the world event or the season: attendance is a GATE,
 * and a gate that moves with the clock or the calendar has no stable threshold. It also never
 * reads users.landmarkTier — that would convert a deliberately powerless cosmetic ladder into
 * a power ladder, and tests/landmarks.test.ts polices the file list that may mention it.
 */
export function attendanceOf(ctx: Ctx, userId: string): Attendance {
  const { clockDinos, lots } = toClockDinos(ctx, userId);
  const assigned = clockDinos.filter((d) => d.paddock !== null && d.escapedAt === null);
  const distinctSpecies = new Set(assigned.map((d) => d.species.id)).size;

  const rows = ctx.db.select().from(schema.attractions)
    .where(eq(schema.attractions.userId, userId)).all();
  // An unknown or retired kind contributes 0 rather than throwing — the same tolerance
  // matchedKindCount gives a retired decor slug. levelValue clamps a level above the
  // array to its top entry; a raw index would read undefined and poison this with NaN.
  const drawTotal = rows.reduce(
    (sum, r) => sum + levelValue(attractionFor(r.kind)?.draw, r.level, 0), 0);

  const vcLevel = facilityLevel(lots, 'visitor_center');
  return { attendance: attendanceFrom(distinctSpecies, drawTotal, vcLevel), distinctSpecies, drawTotal, vcLevel };
}
```

- [ ] **Step 4: Stamp the high-water in `recomputeRating`**

In `src/modules/park/rating.ts`, add the import and extend the existing `.set()`. The whole point of putting it here is that `recomputeRating` already has 14 call sites, every one a write path (build, upgrade, assign, rename, sell, hatch, feed, rescue, trade both sides, shard purchase, admin give) and none a read — so the stamp can never be forgotten at a new mutation site.

```ts
import { attendanceOf } from './attendance.js';
```

```ts
  const highWater = Math.max(user.ratingHighWater, rating);
  // Attendance rides the same recompute rather than 14 new call sites: its inputs are
  // dinos, lots and attractions, so every mutation that moves rating can move it too.
  // One extra SELECT (attractions) on a per-user table, and one extra column on an
  // UPDATE that was already being issued.
  const attendanceBest = Math.max(user.attendanceHighWater, attendanceOf(ctx, userId).attendance);
  ctx.db.update(schema.users)
    .set({ parkRating: rating, ratingHighWater: highWater, attendanceHighWater: attendanceBest })
    .where(eq(schema.users.discordId, userId)).run();
  return { rating, highWater };
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/attendance.test.ts`
Expected: PASS

Run: `npm test`
Expected: all green. If a park test now fails on a query count, it is asserting `.select()` calls through a Proxy — read the failure and add the one new `attractions` read to its expected number.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/modules/park/attendance.ts src/modules/park/rating.ts tests/attendance.test.ts
git commit -m "Derive park attendance and stamp its high-water"
```

---

## Task 5: The `attractions_built` stat and `buildAttraction`

**Files:**
- Modify: `src/core/stats.ts`, `tests/stats.test.ts`, `tests/season-content.test.ts`
- Create: `src/modules/guests/service.ts`
- Test: `tests/guests.test.ts`

**Interfaces:**
- Produces: `StatId` gains `'attractions_built'`. `buildAttraction(ctx, userId, kind): AttractionDef`, `upgradeAttraction(ctx, userId, kind): { def: AttractionDef; level: number }`, `attractionRows(ctx, userId)`, and error classes `UnknownAttractionError`, `AttractionLockedError`, `DuplicateAttractionError`, `AttractionMaxedError`.

- [ ] **Step 1: Write the failing test**

Create `tests/guests.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { InsufficientFundsError } from '../src/core/economy.js';
import { readStat } from '../src/core/stats.js';
import {
  buildAttraction, upgradeAttraction,
  UnknownAttractionError, AttractionLockedError,
  DuplicateAttractionError, AttractionMaxedError,
} from '../src/modules/guests/service.js';
import { ATTRACTIONS } from '../src/data/attractions.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

function rich(highWater = 0) {
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 200_000_000 }, 'test:seed', 0);
  ctx.db.update(schema.users).set({ attendanceHighWater: highWater })
    .where(eq(schema.users.discordId, 'u1')).run();
}

describe('buildAttraction', () => {
  it('charges cash, inserts the row at level 1 and counts the stat', () => {
    rich();
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const def = buildAttraction(ctx, 'u1', 'picnic_lawn');

    expect(def.kind).toBe('picnic_lawn');
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before - ATTRACTIONS.picnic_lawn.buildCost);
    const rows = ctx.db.select().from(schema.attractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(1);
    expect(readStat(ctx, 'u1', 'attractions_built')).toBe(1);
  });

  it('refuses an unknown kind', () => {
    rich();
    expect(() => buildAttraction(ctx, 'u1', 'no_such_kind')).toThrow(UnknownAttractionError);
  });

  it('refuses a kind whose unlock threshold the high-water has not reached', () => {
    rich(0);
    expect(() => buildAttraction(ctx, 'u1', 'gift_shop')).toThrow(AttractionLockedError);
  });

  it('refuses a second copy of the same kind', () => {
    rich(150);
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    expect(() => buildAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(DuplicateAttractionError);
  });

  it('leaves no row behind when the charge fails', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');           // 500 starting cash, nowhere near enough
    expect(() => buildAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(InsufficientFundsError);
    expect(ctx.db.select().from(schema.attractions).all()).toHaveLength(0);
    expect(readStat(ctx, 'u1', 'attractions_built')).toBe(0);
  });
});

describe('upgradeAttraction', () => {
  it('charges the rung cost and raises the level', () => {
    rich();
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const { level } = upgradeAttraction(ctx, 'u1', 'picnic_lawn');

    expect(level).toBe(2);
    expect(ctx.db.select().from(schema.users).all()[0].cash)
      .toBe(before - ATTRACTIONS.picnic_lawn.upgradeCosts[0]);
  });

  it('refuses to upgrade past the top level', () => {
    rich();
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    upgradeAttraction(ctx, 'u1', 'picnic_lawn');
    upgradeAttraction(ctx, 'u1', 'picnic_lawn');
    expect(() => upgradeAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(AttractionMaxedError);
  });

  it('refuses to upgrade something that was never built', () => {
    rich();
    expect(() => upgradeAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(UnknownAttractionError);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/guests.test.ts`
Expected: FAIL — cannot resolve `../src/modules/guests/service.js`.

- [ ] **Step 3: Add the stat**

In `src/core/stats.ts`, add one entry to the `STATS` map:

```ts
  attractions_built: 'Attractions built',
```

Match the surrounding entries' exact value style — read the existing map first and copy the shape rather than assuming it is a label string.

Then fix the three pins this moves:
- `tests/stats.test.ts:8` — `toHaveLength(18)` becomes `19`, and the test NAME (which quotes the count) must change with it.
- `tests/season-content.test.ts` — `FINITE_STATS` is hand-maintained. `attractions_built` is finite and bounded by the catalog, so add it there.
- `tests/season.test.ts:57-70` iterates `Object.keys(STATS)` dynamically and needs no edit — confirm by running it.

- [ ] **Step 4: Write the service**

Create `src/modules/guests/service.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { track } from '../../core/stats.js';
import { levelValue } from '../park/service.js';
import { recomputeRating } from '../park/rating.js';
import { ATTRACTIONS, attractionFor, type AttractionDef } from '../../data/attractions.js';
export class UnknownAttractionError extends Error {}
/** Carries the attraction's display name so the caller can name it. */
export class AttractionLockedError extends Error {}
export class DuplicateAttractionError extends Error {}
export class AttractionMaxedError extends Error {}

export function attractionRows(ctx: Ctx, userId: string) {
  return ctx.db.select().from(schema.attractions)
    .where(eq(schema.attractions.userId, userId)).all();
}

function highWaterOf(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get()?.attendanceHighWater ?? 0;
}

/**
 * Build one attraction. Charge and insert share an outer transaction because
 * ctx.economy.apply commits its own — without it a failed insert after a successful
 * charge leaves the player debited with nothing. track() sits inside that same
 * transaction so a rolled-back build never counts.
 */
export function buildAttraction(ctx: Ctx, userId: string, kind: string): AttractionDef {
  const def = attractionFor(kind);
  if (!def) throw new UnknownAttractionError(kind);
  const highWater = highWaterOf(ctx, userId);
  if (highWater < def.unlockAt) throw new AttractionLockedError(def.name);
  const rows = attractionRows(ctx, userId);
  // Each kind is buildable once, and its own unlockAt is the only gate — there is no
  // separate slot pool. A slot ladder on the same high-water would have been a second
  // table to keep in lockstep, and its check could never fire.
  if (rows.some((r) => r.kind === kind)) throw new DuplicateAttractionError(def.name);

  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -def.buildCost }, `attraction:${kind}`, ctx.now());
    ctx.db.insert(schema.attractions)
      .values({ userId, kind, level: 1, builtAt: ctx.now() }).run();
    track(ctx, userId, 'attractions_built', 1);
  });
  // Attractions feed attendance, so the high-water must move in the same action.
  recomputeRating(ctx, userId);
  return def;
}

export function upgradeAttraction(ctx: Ctx, userId: string, kind: string): { def: AttractionDef; level: number } {
  const def = attractionFor(kind);
  if (!def) throw new UnknownAttractionError(kind);
  const row = ctx.db.select().from(schema.attractions)
    .where(and(eq(schema.attractions.userId, userId), eq(schema.attractions.kind, kind))).get();
  if (!row) throw new UnknownAttractionError(kind);
  if (row.level >= def.maxLevel) throw new AttractionMaxedError(def.name);
  // levelValue, never a raw index: upgradeCosts is a per-level array like every other.
  const cost = levelValue(def.upgradeCosts, row.level, 0);
  const level = row.level + 1;

  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -cost }, `attraction:${kind}:${level}`, ctx.now());
    ctx.db.update(schema.attractions).set({ level })
      .where(eq(schema.attractions.id, row.id)).run();
  });
  recomputeRating(ctx, userId);
  return { def, level };
}

/** Every kind the player could build right now, for the catalog embed and autocomplete. */
export function buildableKinds(ctx: Ctx, userId: string): AttractionDef[] {
  const highWater = highWaterOf(ctx, userId);
  const owned = new Set(attractionRows(ctx, userId).map((r) => r.kind));
  return Object.values(ATTRACTIONS).filter((d) => highWater >= d.unlockAt && !owned.has(d.kind));
}
```

Note `levelValue(def.upgradeCosts, row.level, 0)`: at level 1 this reads `upgradeCosts[0]`, the level-1→2 price, which is exactly right because `upgradeCosts` has `maxLevel - 1` entries.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/guests.test.ts`
Expected: PASS

Run: `npm test`
Expected: green, including the three stat pins fixed in Step 3.

- [ ] **Step 6: Typecheck and commit**

```bash
git add src/core/stats.ts src/modules/guests/service.ts tests/guests.test.ts tests/stats.test.ts tests/season-content.test.ts
git commit -m "Build and upgrade attractions against the attendance gate"
```

---

## Task 6: Milestone claims

**Files:**
- Modify: `src/modules/guests/service.ts`
- Test: `tests/guests.test.ts` (extend)

**Interfaces:**
- Produces: `claimableMilestones(ctx, userId): MilestoneDef[]`, `claimMilestone(ctx, userId, at: number): MilestoneDef`, `MilestoneUnavailableError`.

- [ ] **Step 1: Write the failing test**

Append to `tests/guests.test.ts`:

```ts
import { claimableMilestones, claimMilestone, MilestoneUnavailableError } from '../src/modules/guests/service.js';
import { ATTENDANCE_MILESTONES } from '../src/data/attendance.js';

describe('milestones', () => {
  const first = ATTENDANCE_MILESTONES[0];

  it('offers nothing below the first threshold', () => {
    rich(0);
    expect(claimableMilestones(ctx, 'u1')).toEqual([]);
  });

  it('offers every crossed milestone and pays its reward', () => {
    rich(first.at);
    expect(claimableMilestones(ctx, 'u1').map((m) => m.at)).toEqual([first.at]);
    const before = ctx.db.select().from(schema.users).all()[0].cash;

    claimMilestone(ctx, 'u1', first.at);

    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before + (first.reward.cash ?? 0));
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(1);
    expect(claimableMilestones(ctx, 'u1')).toEqual([]);
  });

  it('is idempotent — a second claim of the same milestone pays nothing', () => {
    rich(first.at);
    claimMilestone(ctx, 'u1', first.at);
    const after = ctx.db.select().from(schema.users).all()[0].cash;
    expect(() => claimMilestone(ctx, 'u1', first.at)).toThrow(MilestoneUnavailableError);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(after);
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(1);
  });

  it('refuses a milestone the high-water has not reached', () => {
    rich(first.at - 1);
    expect(() => claimMilestone(ctx, 'u1', first.at)).toThrow(MilestoneUnavailableError);
  });

  it('refuses a threshold that is not a milestone at all', () => {
    rich(999_999);
    expect(() => claimMilestone(ctx, 'u1', 12_345)).toThrow(MilestoneUnavailableError);
  });

  it('grants an egg when the milestone carries one', () => {
    const withEgg = ATTENDANCE_MILESTONES.find((m) => m.reward.egg)!;
    rich(withEgg.at);
    claimMilestone(ctx, 'u1', withEgg.at);
    const eggs = ctx.db.select().from(schema.eggs).all();
    expect(eggs).toHaveLength(1);
    expect(eggs[0].rarity).toBe(withEgg.reward.egg);
    expect(eggs[0].source).toBe('guests');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/guests.test.ts -t "milestones"`
Expected: FAIL — `claimableMilestones` is not exported.

- [ ] **Step 3: Implement**

Append to `src/modules/guests/service.ts`:

```ts
import { ATTENDANCE_MILESTONES, milestonesUpTo, type MilestoneDef } from '../../data/attendance.js';

export class MilestoneUnavailableError extends Error {}

function claimedSet(ctx: Ctx, userId: string): Set<number> {
  return new Set(ctx.db.select().from(schema.attendanceClaims)
    .where(eq(schema.attendanceClaims.userId, userId)).all().map((r) => r.milestone));
}

/** Crossed and not yet claimed. Read-only. */
export function claimableMilestones(ctx: Ctx, userId: string): MilestoneDef[] {
  const claimed = claimedSet(ctx, userId);
  return milestonesUpTo(highWaterOf(ctx, userId)).filter((m) => !claimed.has(m.at));
}

/**
 * Claim one milestone. Everything is validated before anything is written, and the whole
 * grant sits in one transaction so a failed egg insert cannot leave the claim row behind
 * (which would silently consume the reward forever). The composite primary key on
 * (userId, milestone) is the backstop against a double-click race.
 */
export function claimMilestone(ctx: Ctx, userId: string, at: number): MilestoneDef {
  const def = ATTENDANCE_MILESTONES.find((m) => m.at === at);
  if (!def) throw new MilestoneUnavailableError('No such milestone.');
  if (highWaterOf(ctx, userId) < def.at) throw new MilestoneUnavailableError(def.name);
  if (claimedSet(ctx, userId).has(def.at)) throw new MilestoneUnavailableError(def.name);

  ctx.db.transaction(() => {
    const { cash, shards, foods, egg } = def.reward;
    ctx.economy.apply(userId, { cash, shards, foods }, `milestone:${def.at}`, ctx.now());
    if (egg) {
      ctx.db.insert(schema.eggs).values({
        userId, rarity: egg, speciesId: null, source: 'guests', obtainedAt: ctx.now(),
      }).run();
    }
    ctx.db.insert(schema.attendanceClaims)
      .values({ userId, milestone: def.at, claimedAt: ctx.now() }).run();
  });
  return def;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/guests.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

```bash
git add src/modules/guests/service.ts tests/guests.test.ts
git commit -m "Pay one-time attendance milestones"
```

---

## Task 7: The `/guests` module and its six registration sites

**Files:**
- Create: `src/modules/guests/embeds.ts`, `src/modules/guests/index.ts`
- Modify: `modules.json`, `src/core/module-list.ts`, `src/modules/help/index.ts`, `tests/registry-load.test.ts`, `tests/config.test.ts`, `tests/contract.test.ts`
- Test: `tests/guests.test.ts` (extend)

**Interfaces:**
- Consumes: everything from Tasks 4–6.
- Produces: `guestsModule: ModuleManifest` with `name: 'guests'`, component prefix `guests`.

`guests` is free — the 16 prefixes in use are `battle, daily, ach, season, dex, exp, breed, splice, hatch, mythic, top, park, alert, sell, trade, duel`. A duplicate command name or prefix throws at boot, not in a test.

- [ ] **Step 1: Write the failing test**

Append to `tests/guests.test.ts`:

```ts
import { MessageFlags } from 'discord.js';
import { fakeCommand, fakeButton, replyText } from './harness.js';
import { guestsModule } from '../src/modules/guests/index.js';

const cmd = () => guestsModule.commands[0];
const comp = () => guestsModule.components[0];

describe('/guests', () => {
  it('view reports attendance and its three terms', async () => {
    rich(0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const i = fakeCommand({ name: 'guests', sub: 'view', user: 'u1' });
    await cmd().execute(ctx, i as never);
    expect(replyText(i)).toMatch(/attendance/i);
  });

  it('build charges and confirms', async () => {
    rich(0);
    const i = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd().execute(ctx, i as never);
    expect(ctx.db.select().from(schema.attractions).all()).toHaveLength(1);
  });

  it('build reports a locked kind ephemerally instead of throwing', async () => {
    rich(0);
    const i = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'grand_atrium' } });
    await cmd().execute(ctx, i as never);
    expect(replyText(i)).toMatch(/not drawing enough guests|locked/i);
  });

  it('upgrades instead of rebuilding when the kind is already owned', async () => {
    rich(0);
    const first = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd().execute(ctx, first as never);
    const second = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd().execute(ctx, second as never);

    const rows = ctx.db.select().from(schema.attractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(2);
  });

  it('reports a maxed attraction ephemerally rather than charging again', async () => {
    rich(0);
    for (let n = 0; n < 3; n++) {
      await cmd().execute(ctx, fakeCommand({
        name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' },
      }) as never);
    }
    const cashAtTop = ctx.db.select().from(schema.users).all()[0].cash;
    const i = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd().execute(ctx, i as never);

    expect(replyText(i)).toMatch(/top level/i);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(cashAtTop);
  });

  it('refuses a claim button belonging to another player', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    const i = fakeButton({ customId: `guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`, user: 'u2' });
    await comp().execute(ctx, i as never);
    expect(replyText(i)).toMatch(/not your/i);
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(0);
  });

  it('refuses a stale claim button whose milestone is already claimed', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    claimMilestone(ctx, 'u1', ATTENDANCE_MILESTONES[0].at);
    const i = fakeButton({ customId: `guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`, user: 'u1' });
    await comp().execute(ctx, i as never);
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/guests.test.ts -t "/guests"`
Expected: FAIL — cannot resolve `../src/modules/guests/index.js`.

- [ ] **Step 3: Write the embeds**

Create `src/modules/guests/embeds.ts` with `guestsPayload(ctx, userId)` returning an `EmbedBuilder`-based payload showing: attendance, the three terms broken out (`distinctSpecies / ATTENDANCE_SPECIES_TARGET`, `drawTotal / ATTRACTION_DRAW_TARGET`, Visitor Center level), the owned attractions with their levels, the next locked kind and the attendance it needs, and a claim button per claimable milestone. Copy the embed idiom from `src/modules/park/embeds.ts`. Do **not** hand-assign `payload.files` — use `attach(embed, payload, slot, assetImage(...))` if any art is wired, and skip art entirely for now.

- [ ] **Step 4: Write the module**

Create `src/modules/guests/index.ts`, modelled on `src/modules/dex/index.ts`:

```ts
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { ATTRACTIONS } from '../../data/attractions.js';
import { guestsPayload, builtPayload, milestonePayload } from './embeds.js';
import {
  buildAttraction, upgradeAttraction, claimMilestone,
  UnknownAttractionError, AttractionLockedError,
  DuplicateAttractionError, AttractionMaxedError, MilestoneUnavailableError,
} from './service.js';

const attractionChoices = Object.values(ATTRACTIONS).map((d) => ({ name: d.name, value: d.kind }));

export const guestsModule: ModuleManifest = {
  name: 'guests',
  commands: [
    {
      data: new SlashCommandBuilder().setName('guests').setDescription('Park attendance and attractions')
        .addSubcommand((s) => s.setName('view').setDescription('Your attendance, attractions and milestones'))
        .addSubcommand((s) => s.setName('build').setDescription('Build or upgrade an attraction')
          .addStringOption((o) => o.setName('attraction').setDescription('Which attraction')
            .setRequired(true).addChoices(...attractionChoices)))
        .addSubcommand((s) => s.setName('claim').setDescription('Claim a reached attendance milestone')),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        // A real switch with a default arm, never a fallthrough to the view: the /park
        // dispatch trap (a new subcommand silently rendering the dashboard and reporting
        // success for a command that did nothing) is what this shape exists to avoid.
        switch (i.options.getSubcommand()) {
          case 'view':
            await i.reply(guestsPayload(ctx, i.user.id));
            return;
          case 'build': {
            const kind = i.options.getString('attraction', true);
            // One subcommand for both: an unowned kind is built, an owned one is upgraded.
            // Two subcommands would have made the player track which state they are in.
            const owned = attractionRows(ctx, i.user.id).some((r) => r.kind === kind);
            try {
              const result = owned
                ? upgradeAttraction(ctx, i.user.id, kind)
                : { def: buildAttraction(ctx, i.user.id, kind), level: 1 };
              await i.reply(builtPayload(ctx, i.user.id, result.def, result.level));
            } catch (e) {
              // Every service error maps to an ephemeral reply; anything unrecognised
              // rethrows so the router's error path reports it rather than swallowing it.
              const msg =
                e instanceof AttractionLockedError ? `Your park is not drawing enough guests for the ${e.message} yet.`
                : e instanceof DuplicateAttractionError ? `You already have a ${e.message}.`
                : e instanceof AttractionMaxedError ? `Your ${e.message} is already at its top level.`
                : e instanceof UnknownAttractionError ? 'No such attraction.'
                : e instanceof InsufficientFundsError ? 'Not enough cash.'
                : null;
              if (msg === null) throw e;
              await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
            }
            return;
          }
          case 'claim':
            await i.reply(milestonePayload(ctx, i.user.id));
            return;
          default:
            await i.reply({ content: 'Unknown /guests subcommand.', flags: MessageFlags.Ephemeral });
        }
      },
    },
  ],
  components: [/* Step 5 */],
};
```

Add `attractionRows` to the import from `./service.js`.

Note there is deliberately **no build BUTTON**. The spec named a `guests:build:<uid>:<kind>:<level>` customId for one, but building runs entirely through the slash subcommand with `addChoices`, so no durable money-spending button exists to go stale. That removes the `park:landmark:buy` hazard by construction rather than by guarding it. If a build button is ever added, it must carry `<kind>:<level>` and re-validate both after the owner check and before any read or write.

- [ ] **Step 5: Write the component**

```ts
  components: [
    {
      prefix: 'guests',
      async execute(ctx, i) {
        // The milestone rides in the customId, validated after the owner check and before
        // any read or write. This is the park:landmark:buy lesson: a Discord message is
        // durable and its label is not re-derived, so one stale button charged 5M/10M/20M/40M
        // against a ladder that re-derived its own rung on every click.
        const [, action, uid, atStr] = i.customId.split(':');
        if (action !== 'claim') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) {
          await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
          return;
        }
        const at = Number(atStr);
        if (!Number.isInteger(at)) {
          await i.reply({ content: 'That reward is no longer available.', flags: MessageFlags.Ephemeral });
          return;
        }
        try {
          claimMilestone(ctx, i.user.id, at);
        } catch (e) {
          if (!(e instanceof MilestoneUnavailableError)) throw e;
          await i.reply({ content: 'That reward is no longer available.', flags: MessageFlags.Ephemeral });
          return;
        }
        // Re-render so the message that was just used advances — a second layer only.
        // The customId check above is what actually protects the claim.
        await i.update({ ...guestsPayload(ctx, i.user.id), attachments: [] });
      },
    },
  ],
```

- [ ] **Step 6: Register at all six sites**

1. `modules.json` — add `"guests": true`. The key must equal `ModuleManifest.name` **exactly**; a mismatch silently disables the module in production and passes the entire test suite.
2. `src/core/module-list.ts` — add `import { guestsModule } from '../modules/guests/index.js';` and append `guestsModule` to `ALL_MODULES`.
3. `tests/registry-load.test.ts` — 16 → 17 modules and 28 → 29 commands.
4. `tests/config.test.ts:22` — add `guests: true` to the exact `toEqual` literal.
5. `tests/contract.test.ts:52` — `toHaveLength(28)` → `29`. No `AUTOCOMPLETE_OPTIONS` entry is needed: `attraction` uses `addChoices`, not `.setAutocomplete(true)`. Six kinds is far under Discord's 25-choice cap, so `addChoices` is safe here — unlike `/dex view`'s 52 species, where it would throw at builder construction, i.e. at boot.
6. `src/modules/help/index.ts` — add a `guests` key to `HELP_TOPICS` with a body covering all three subcommands. Ship **no** `art` descriptor: art would bind `tests/help.test.ts`'s hard-coded topic list, `tests/images.test.ts`'s banner scrape and its 1536×1024 dimension loop.

- [ ] **Step 7: Run everything**

Run: `npm test`
Expected: green.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/modules/guests/ modules.json src/core/module-list.ts src/modules/help/index.ts tests/
git commit -m "Add the /guests command and register the module"
```

---

## Task 8: Attendance on the park dashboard

**Files:**
- Modify: `src/modules/park/embeds.ts`, `src/modules/park/index.ts`
- Test: `tests/park.test.ts`

`dashboardPayload` takes no `Ctx`, so a derived value must be computed by each caller and threaded through `opts` — the established pattern for `earnedTiers`/`legacyRank`/`seasonBadges`. There are exactly two callers, and they already diverge (`visit.ts` passes `pending: 0` and rebuilds `components`), so a value added to one and forgotten in the other renders a park card that disagrees with itself depending on who is looking.

- [ ] **Step 1: Write the failing test**

Drive both surfaces through the real command rather than calling `dashboardPayload` directly — its `opts` shape is about to change, and going through `/park view` means the test never has to be rewritten when it does. Add to `tests/park.test.ts`:

```ts
it('shows attendance on your own park card and on a visited one', async () => {
  for (const id of ['u1', 'u2']) getOrCreateUser(ctx, id, id);
  ctx.economy.apply('u1', { cash: 50_000 }, 'test:seed', 0);
  const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
  }).run();

  const own = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
  await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, own as never);
  expect(JSON.stringify(own.replies)).toMatch(/Attendance/);

  // The visiting surface must agree — it rebuilds components rather than reusing them,
  // so a value threaded into one caller and forgotten in the other renders a card that
  // disagrees with itself depending on who is looking.
  const visit = fakeCommand({ name: 'park', sub: 'view', user: 'u2', options: { user: { id: 'u1' } } });
  await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, visit as never);
  expect(JSON.stringify(visit.replies)).toMatch(/Attendance/);
});
```

If `/park view` has no `user` option, read `src/modules/park/index.ts` for the actual visiting surface (it may be `park:tour` or `top:visit`) and drive that instead — `fakeCommand` validates every fixture option against the real builder JSON, so a wrong option name throws rather than silently returning null.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/park.test.ts -t "shows attendance on the dashboard"`
Expected: FAIL — no `Attendance` field.

- [ ] **Step 3: Thread it through both callers**

Add an `attendance: number` field to `dashboardPayload`'s `opts`, render it as an embed field, and pass `attendanceOf(ctx, userId).attendance` from **both** call sites — `src/modules/park/index.ts` (`/park view`) and `src/modules/park/visit.ts`.

Attendance is deliberately **public** on a visited park, unlike shards, which are hidden to avoid a public wealth display. Record that in a comment beside the field: no test pins the dashboard field count, so this decision is documented rather than enforced.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: green. `tests/discord-limits.test.ts` rejects a 26-field embed; the dashboard reaches ten at most, so a sixth base field is safe.

- [ ] **Step 5: Commit**

```bash
git add src/modules/park/embeds.ts src/modules/park/index.ts src/modules/park/visit.ts tests/park.test.ts
git commit -m "Show attendance on the park card"
```

---

## Task 9: `/top attendance`, the eighth metric

**Files:**
- Modify: `src/modules/leaderboards/service.ts`, `src/modules/leaderboards/index.ts`
- Test: `tests/leaderboards.test.ts`

**Interfaces:**
- Consumes: `attendanceOf` is NOT used here — it is per-user and this must stay batch-per-board.
- Produces: `Metric` gains `'attendance'`; `attendanceScores(ctx, memberIds)`.

- [ ] **Step 1: Write the failing test**

Add `attendance` to the three per-metric query-count assertion tables (global, server-scoped, zero-member) and to the ordered metric equality — the counting Proxy makes each of those an exact integer, so read the existing `collection` row and add three to it (`dinos`, `lots`, `attractions`). Then add:

```ts
it('ranks parks by attendance, most varied first', () => {
  const ctx = makeCtx();
  const seed = (id: string, speciesIds: string[]) => {
    getOrCreateUser(ctx, id, id);
    ctx.economy.apply(id, { cash: 50_000 }, 'test:seed', 0);
    const lot = buildLot(ctx, id, 'herbivore_paddock');
    for (const speciesId of speciesIds) {
      ctx.db.insert(schema.dinos).values({
        userId: id, lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0,
      }).run();
    }
    recomputeRating(ctx, id);
  };
  seed('u1', ['triceratops']);
  seed('u2', ['triceratops', 'gallimimus', 'stegosaurus']);

  const board = topPlayers(ctx, 'attendance', 'global', null);
  expect(board[0].userId).toBe('u2');
  expect(board[0].value).toBeGreaterThan(board[1].value);
});

it('returns an empty attendance board for a guild with no registered members', () => {
  const ctx = makeCtx();
  expect(topPlayers(ctx, 'attendance', 'server', 'g-empty')).toEqual([]);
});
```

Import `topPlayers`, `recomputeRating` and `buildLot` at the top of the file if they are not already there, and match the existing tests' exact call signature for `topPlayers` — read one before writing this.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/leaderboards.test.ts`
Expected: FAIL on the metric union and the pinned counts.

- [ ] **Step 3: Implement the scorer**

Add `'attendance'` to the `Metric` union, a branch in `scored()`, an entry in `metricLabel`, and a choice in the builder's `metric` option — four places that must agree.

Write `attendanceScores` as **one query per source table**, grouped in JS — never one query per candidate. It reads `dinos`, `lots` and `attractions` (three extra selects on top of the candidate scan), and each must be `memberIds`-scoped with the three-branch `undefined` / `.length` / `[]` shape copied from `collectionScores`, or the zero-member guild case fails. Recompute attendance per player from the grouped rows using `attendanceFrom`, so the board and `/guests` can never disagree.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/leaderboards.test.ts`
Expected: PASS, with the pinned counts matching the three extra selects.

- [ ] **Step 5: Commit**

```bash
git add src/modules/leaderboards/ tests/leaderboards.test.ts
git commit -m "Rank parks by attendance on /top"
```

---

## Task 10: Attraction cells on the park PNG

**Files:**
- Modify: `src/modules/park/snapshot.ts`, `src/core/render/draw.ts`
- Test: `tests/render-draw.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('renders byte-identically when the park has no attractions', async () => {
  const a = renderParkPng(sample);
  const b = renderParkPng({ ...sample, attractions: [] });
  expect(Buffer.compare(a, b)).toBe(0);
});

it('adds one cell per attraction, after the landmark cell', async () => {
  const withOne = renderParkPng({ ...sample, attractions: [{ kind: 'gift_shop', level: 2 }] });
  const bare = renderParkPng(sample);
  expect(withOne.length).not.toBe(bare.length);
  // Then assert the six existing pinned pixel samples are unchanged, by re-running
  // the existing assertions against `withOne` — appended cells must not move them.
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/render-draw.test.ts`
Expected: FAIL — `attractions` is not a `ParkSnapshot` field.

- [ ] **Step 3: Implement**

Add an **optional** field to `ParkSnapshot`:

```ts
  // Optional for the same reason season and landmarkTier are: a required field fails only
  // `npm run typecheck`, not build or test, and six `as never` casts in the render tests
  // would not error at all. Omitted entirely when empty, so a park with no attractions
  // renders byte-identical output.
  attractions?: Array<{ kind: string; level: number }>;
```

Stamp it in `buildParkSnapshot` — the only place with a `Ctx` — reading the `attractions` table. Never compute anything attraction-derived inside `renderParkPng`, which is contractually clock-free and pure in its two arguments.

In `draw.ts`, extend the cell count so attraction cells come **after** the landmark cell, with the count driven by data:

```ts
  const attractionCells = snap.attractions?.length ?? 0;
  const cellCount = snap.lots.length + (hasBuild ? 1 : 0) + (band ? 1 : 0) + attractionCells;
```

There must be **no unconditional build slot** for attractions — that changes the shared fixture's row count and breaks `tests/render-draw.test.ts:231`. Draw each cell with the `if (img) { drawImage } else { flat fill }` guard copied from `drawTile`; `drawImage(null)` throws and costs the whole park image, not one tile. Ship no new art family in this task: the flat fill plus a label is the whole cell.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/render-draw.test.ts tests/render-park-art.test.ts`
Expected: PASS, including every pre-existing pinned pixel sample.

- [ ] **Step 5: Commit**

```bash
git add src/modules/park/snapshot.ts src/core/render/draw.ts tests/render-draw.test.ts
git commit -m "Draw attraction cells on the park map"
```

---

## Task 11: Docs, the journey test, and full verification

**Files:**
- Modify: `docs/gameplay.md`, `docs/commands.md`, `docs/ops.md`, `README.md`, `CLAUDE.md`, `tests/journeys.test.ts`

- [ ] **Step 1: Write the journey test**

Add a case to `tests/journeys.test.ts` covering the whole arc: seed a varied roster → assert attendance rises → build an attraction → assert the high-water moved → cross a milestone → claim it → assert the reward landed and a second claim is refused. A fifth progression axis with no end-to-end coverage is exactly the "tests that cannot fail" shape the daily-loop retro flagged.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/journeys.test.ts`
Expected: PASS

- [ ] **Step 3: Update the docs**

- `docs/gameplay.md` — a new **§21 Park guests** appended after §20 Duels (inserting mid-document renumbers every later heading). Also update §2's currency/resource framing if attendance is described there, and §4's cap-window text if it mentions what the Visitor Center governs.
- `docs/commands.md` — a new section for `/guests`, using the `/season` section as the template.
- `docs/ops.md` — the written-out module count (`Sixteen modules ship today:` → `Seventeen`), the module bullet list, the per-module smoke-check list, and the hardcoded `Should report \`28\` commands deployed` → `29`.
- `README.md` — the written-out help-topic count (`twelve topics` → `thirteen`). Do not confuse it with the twelve achievement tracks mentioned elsewhere in the same file.
- `CLAUDE.md` — a bullet recording the attendance design: the two frozen targets and why, the pure-read/stamp split, and that `recomputeRating` now stamps two high-waters.

While in these files, repair two **pre-existing** drifts so a reviewer can tell new drift from old: `README.md:35-36` and `docs/ops.md:232` both omit the `season` metric shipped in PR #34.

- [ ] **Step 4: Full verification**

Run: `npm test` — expect all green, with the new suites included.
Run: `npm run typecheck` — expect clean. This is the only gate that sees type errors in `tests/` and `scripts/`; `npm run build` only compiles `src`.
Run: `npm run build` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md CLAUDE.md tests/journeys.test.ts
git commit -m "Document park guests and cover the arc end to end"
```

---

## Operator steps after merge

These are **not** part of any task and must not be run from a worktree mid-implementation.

1. Back up the live DB before deploying — migration 0017 is additive, but the backup is the standing rule.
2. `npm run build`, then restart the bot. The bot runs compiled `dist/`, and `migrateDb` applies 0017 at boot. Verify the migration count goes 17 → 18.
3. `npm run deploy-commands` — the command count moves 28 → 29 and the `/help` topic choices change. Exactly one bot instance per token, or every command answers 10062.
4. `npm run test:live` — the gallery should report its existing cases plus any new `/guests` case. Note that `scripts/test-live.ts` calls `execute` directly and never routes, so anything hung off a router hook must be called by hand in the case.
5. No `deploy-emojis` step: this feature ships no new emoji. Adding a `dw_ticket`-style emoji later would require an `EMOJI_FALLBACK` entry with a **non-empty** glyph — `setEmoji` throws on `''` rather than degrading, and the six rarity gems legitimately return `''`.

## Follow-up, deliberately excluded

`drizzle-kit` is pinned at `^0.31.10` and `drizzle-orm` at `^0.45.2`. Both should be checked against the current stable releases and bumped, as its own change — before or after this one, never in the same branch that generates a migration against a populated live DB.
