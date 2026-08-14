# Season Track (4d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing 30-day season cycle real stakes — a capped, derived point track with eight claimable reward rungs and a permanent collectible badge.

**Architecture:** Season points are a weighted sum of `user_stats` deltas measured against a per-season frozen baseline row, capped per source and computed at read time — the same derived-not-stored philosophy as quest progress and escrow locks. Two new tables (`season_progress`, `season_claims`) and one new command (`/season`) live in the existing `daily` module. The capstone badge is stamped on crossing by the router's `postDispatch` hook rather than claimed, so it can never be forfeited.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js v14, drizzle-orm + better-sqlite3 (synchronous), vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-season-track-4d-design.md`. Read §5, §6 and §7 before Task 3 — the numbers there are load-bearing and this plan restates them, it does not re-derive them.

## Global Constraints

- **ESM NodeNext**: every relative import carries a `.js` extension, including `import type`. No exceptions exist anywhere in `src/`.
- **Time and randomness**: `ctx.now()` and `ctx.rng()` only. Never `Date.now()` or `Math.random()`.
- **DB is synchronous**: drizzle/better-sqlite3 `.get()` / `.all()` / `.run()`. Never `await` a query. `ctx.db.transaction(() => {...})` takes a **sync** callback.
- **`ctx.economy.apply(userId, delta, reason, now)`** — exactly 4 positional args, returns void, throws `InsufficientFundsError` on a negative balance. It opens its own transaction internally; calling it inside an outer transaction is the normal pattern.
- **Batch per user, never per row.** One `readStats` call plus one table query — never a query inside a `.map()` over users. This is the rule `src/core/locks.ts` established and `scored()` widened to per-board.
- **Never write from a read path.** `visitPayload` and `topPlayers` run against *other* players' ids; a write there mutates the row of a user who took no action.
- **No attribution anywhere.** No `Co-Authored-By`, no "Generated with", no mention of Claude/AI/assistant in commits, code comments, docs or PR text. Author is RegEdits.
- **`npm run typecheck`** (`tsc --noEmit -p tsconfig.test.json`) is the only gate that typechecks `tests/`. `npm run build` and `npm test` both pass with a broken test file. Run it before every commit touching `tests/`.
- **Mutation check, every task.** After a test goes green, deliberately break the implementation (flip a comparison, return a constant, delete a line), re-run, confirm the test goes RED, then restore. A test nobody has watched fail is not yet a test. This is the single most common failure across the last three plans in this repo — do not skip it, and do not skip it because the test "obviously" works.
- **Hand-computed numbers are hypotheses.** Where this plan states an arithmetic result (points totals, day counts), the test is what establishes it. If a computed value disagrees with this document, the code is the authority — report the discrepancy rather than editing the test to match the plan.

---

## File Structure

**New files**

| path | responsibility |
|---|---|
| `src/data/seasons.ts` | The content table: `SEASON_SOURCES`, `SEASON_RUNGS`, the capstone constant, and the pure `sourcePoints` helper. No DB access, no `Ctx`. |
| `src/modules/daily/season.ts` | Season service: roll, derive, claim, badge stamp, badge count. All DB access. |
| `src/modules/daily/season-embeds.ts` | `/season` payload builders only. |
| `tests/season-content.test.ts` | Machine gate on the content table (pure, no DB). |
| `tests/season.test.ts` | Service behaviour: roll, derive, claim, badge, rollover. |
| `tests/season-balance.test.ts` | The two profile assertions and the day-1 pool guard. |

**Modified files**

| path | change |
|---|---|
| `src/core/world.ts` | `seasonIndexFor`, `SEASON_EPOCH`, `seasonNumberFor`; rewrite the "seasons are COSMETIC" comment. |
| `src/core/db/schema.ts` | Two new tables. |
| `drizzle/0015_season_track.sql` + `meta/` | Migration. |
| `src/modules/daily/index.ts` | `/season` command + `season` component prefix. |
| `src/modules/daily/hooks.ts` | Badge stamp + rung-unlocked hint. |
| `src/modules/park/embeds.ts` | Badge field on the park card. |
| `src/modules/park/index.ts`, `src/modules/park/visit.ts` | Pass badge opts (own park and visit). |
| `src/modules/leaderboards/service.ts`, `index.ts` | Seventh metric. |
| `src/modules/park/alert-record.ts`, `alert-sweep.ts`, `alert-embeds.ts` | Season-ending alert kind. |
| `src/modules/admin/service.ts` | `adminReset` covers both new tables. |
| `tests/registry-load.test.ts`, `tests/contract.test.ts`, `tests/migration.test.ts`, `tests/leaderboards.test.ts`, `tests/park.test.ts`, `tests/admin.test.ts` | Counts, pins, new cases. |
| `docs/gameplay.md`, `docs/commands.md`, `docs/ops.md`, `CLAUDE.md`, `src/modules/help/index.ts` | Docs. |
| `scripts/test-live.ts` | Gallery case. |

---

## Task 1: Season identity in `world.ts`

**Files:**
- Modify: `src/core/world.ts:58-71`
- Test: `tests/world.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `seasonIndexFor(now: number): number`, `seasonNumberFor(now: number): number`, `SEASON_EPOCH: number` (= 689), plus the existing `seasonFor`, `seasonDay`, `SEASON_DAYS`.

`seasonIndexFor` is the absolute integer already implied by `seasonFor`'s modulo. It is the **storage key** and is never clamped or offset. `seasonNumberFor` is display only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/world.test.ts` (the file already defines `const DAY = 86_400_000;` at the top — reuse it, do not redeclare):

```ts
describe('season identity', () => {
  // Season 1 day 1 — the canonical timestamp for every season-aware test in the suite.
  const S1 = 689 * SEASON_DAYS * DAY;

  it('derives an absolute index that matches seasonFor’s own modulo', () => {
    expect(seasonIndexFor(0)).toBe(0);
    expect(seasonIndexFor(S1)).toBe(689);
    expect(seasonIndexFor(S1 + 29 * DAY)).toBe(689);
    expect(seasonIndexFor(S1 + 30 * DAY)).toBe(690);
  });

  it('numbers the shipped epoch as season 1', () => {
    expect(SEASON_EPOCH).toBe(689);
    expect(seasonNumberFor(S1)).toBe(1);
    expect(seasonNumberFor(S1 + 30 * DAY)).toBe(2);
    expect(seasonDay(S1)).toBe(1);
  });

  // Not a curiosity: makeCtx defaults nowMs to 0, so every test that does NOT pin a
  // timestamp sits here. Season-facing embeds must pin S1 instead.
  it('numbers day 0 non-positively, which is why embed tests pin a real timestamp', () => {
    expect(seasonNumberFor(0)).toBe(-688);
  });
});
```

Add `seasonIndexFor`, `seasonNumberFor`, `SEASON_EPOCH` to the existing import from `'../src/core/world.js'` at the top of the file.

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/world.test.ts -t "season identity"`
Expected: FAIL — `seasonIndexFor is not a function`.

- [ ] **Step 3: Implement**

In `src/core/world.ts`, replace the `seasonFor` comment block and add the new exports:

```ts
export type Season = 'wet' | 'dry' | 'cold';
const SEASONS: Season[] = ['wet', 'dry', 'cold'];
export const SEASON_DAYS = 30;

// Seasons carry NO MODIFIERS — that is what removes every season×event stacking
// question, and it stays true now that the season track (spec 4d) pays rewards:
// a reward is not a modifier. What changed is that the cycle is no longer purely
// cosmetic — season_progress/season_claims key off seasonIndexFor below.
export function seasonFor(now: number): Season {
  return SEASONS[Math.floor(dayIndex(now) / SEASON_DAYS) % SEASONS.length];
}

export function seasonDay(now: number): number {
  return (dayIndex(now) % SEASON_DAYS) + 1;
}

/** The absolute season index — the STORAGE key. Never clamped, never offset. */
export function seasonIndexFor(now: number): number {
  return Math.floor(dayIndex(now) / SEASON_DAYS);
}

// dayIndex counts from the Unix epoch, so the live cycle is already ~season 689.
// This constant is the index live on ship day (2026-08-14, dayIndex 20,679) and is a
// WRITTEN LITERAL: deriving it at runtime, or moving it later, renumbers every badge
// already earned. If this ships after 2026-09-04 (dayIndex 20,700) it must be
// recomputed, not copied.
export const SEASON_EPOCH = 689;

/** Display number only — never a storage key. Non-positive before the epoch. */
export function seasonNumberFor(now: number): number {
  return seasonIndexFor(now) - SEASON_EPOCH + 1;
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/world.test.ts`
Expected: PASS — the whole file, including the load-bearing days-0-4 calm test.

- [ ] **Step 5: Mutation check**

Change `SEASON_EPOCH` to `690`, re-run: the "numbers the shipped epoch as season 1" test must go RED. Restore. Then change `seasonIndexFor` to use `Math.round` instead of `Math.floor`, re-run: the boundary case must go RED. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/core/world.ts tests/world.test.ts
git commit -m "Add absolute season indexing and display numbering"
```

---

## Task 2: Schema and migration 0015

**Files:**
- Modify: `src/core/db/schema.ts` (append after `alertsSent`)
- Create: `drizzle/0015_season_track.sql`, `drizzle/meta/0015_snapshot.json`, journal entry
- Test: `tests/migration.test.ts`

**Interfaces:**
- Produces: `schema.seasonProgress` with columns `userId, seasonIndex, baselines, headStart, badgeAt, createdAt`; `schema.seasonClaims` with `userId, seasonIndex, rung, claimedAt`.

- [ ] **Step 1: Write the failing migration test**

Append to `tests/migration.test.ts`, copying the newest describe block's shape exactly:

```ts
describe('0015 season track via the real drizzle migrator (production path)', () => {
  it('creates both season tables and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig15-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[0-4]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 14);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0014 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      sqlite.prepare(`INSERT INTO season_progress (user_id, season_index, baselines, head_start, created_at_ms)
                      VALUES ('u1', 689, '{}', 0, 0)`).run();
      sqlite.prepare(`INSERT INTO season_claims (user_id, season_index, rung, claimed_at_ms)
                      VALUES ('u1', 689, 0, 0)`).run();
      // badge_at_ms is nullable: a season in progress has no badge yet.
      expect(sqlite.prepare(`SELECT badge_at_ms FROM season_progress`).all())
        .toEqual([{ badge_at_ms: null }]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/migration.test.ts -t 0015`
Expected: FAIL — `no such table: season_progress`.

- [ ] **Step 3: Add the tables to the schema**

Append to `src/core/db/schema.ts`:

```ts
// The season track (spec 4d). One row per (user, season) the player was active in —
// deliberately NOT swept the way daily_quests sweeps other dayKeys, because badgeAt on a
// PAST row is the permanent record of that season's capstone. Twelve rows per player per
// year.
//
// `baselines` freezes EVERY StatId at roll time, not only the ones the ladder currently
// reads: a source added in a later season would otherwise find no key, read the baseline
// as 0, and credit that player's whole lifetime counter in one tick.
//
// Never derive points for a PAST season — user_stats keeps growing after a season ends,
// so a delta against an old baseline climbs forever. A past row's meaning is badgeAt.
export const seasonProgress = sqliteTable('season_progress', {
  userId: text('user_id').notNull().references(() => users.discordId),
  seasonIndex: integer('season_index').notNull(),
  baselines: text('baselines', { mode: 'json' }).$type<Record<string, number>>().notNull().default({}),
  headStart: integer('head_start').notNull().default(0),
  badgeAt: integer('badge_at_ms'),
  createdAt: integer('created_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.seasonIndex] })]);

// Consumable rungs only. The badge is seasonProgress.badgeAt, not a row here, because it
// is granted on crossing rather than claimed — keeping them apart is what stops an
// unclaimed rung 8 from silently costing a permanent collectible.
export const seasonClaims = sqliteTable('season_claims', {
  userId: text('user_id').notNull().references(() => users.discordId),
  seasonIndex: integer('season_index').notNull(),
  rung: integer('rung').notNull(),
  claimedAt: integer('claimed_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.seasonIndex, t.rung] })]);
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate --name=season_track`

Then **read `drizzle/0015_season_track.sql` by eye**. It must be two `CREATE TABLE` statements separated by `--> statement-breakpoint`, with `FOREIGN KEY (user_id) REFERENCES users(discord_id)` on each and no `__new_users` recreate anywhere. If a recreate of an existing table appears, delete the generated `.sql`, hand-write just the two `CREATE TABLE` statements, and keep the generated snapshot and journal entry.

Confirm `drizzle/meta/_journal.json` gained an entry with `idx: 15` and a `when` value **greater than** 1786600000000 — drizzle applies in `when` order and a smaller value silently never runs.

- [ ] **Step 5: Run and verify it passes**

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS, all blocks.

- [ ] **Step 6: Mutation check**

Delete the `season_claims` CREATE from the generated SQL, re-run: the 0015 test must go RED on the `season_claims` insert. Restore via `git checkout` of the file or by re-running generate.

- [ ] **Step 7: Commit**

```bash
git add src/core/db/schema.ts drizzle/
git commit -m "Add the season_progress and season_claims tables"
```

---

## Task 3: The content table

**Files:**
- Create: `src/data/seasons.ts`
- Test: `tests/season-content.test.ts`

**Interfaces:**
- Consumes: `StatId` from `src/core/stats.js`, `FoodId` from `src/data/foods.js`.
- Produces:
  - `SeasonSource { id, name, stats: ReadonlyArray<{ stat: StatId; points: number; per: number }>, cap: number }`
  - `SEASON_SOURCES: readonly SeasonSource[]` (9 entries)
  - `SeasonRung { points: number; rewards: { cash?: number; shards?: number; food?: { foodId: FoodId; qty: number }; eggRarity?: 'rare' | 'epic' } }`
  - `SEASON_RUNGS: readonly SeasonRung[]` (8 entries)
  - `SEASON_CAPSTONE: number` (800), `HEAD_START_CAP: number` (200)
  - `sourcePoints(src: SeasonSource, deltas: Partial<Record<StatId, number>>): number`

Integer math only: `Math.floor(delta / per) * points`, then clamp to `cap`. No floats anywhere in the point path.

- [ ] **Step 1: Write the failing content gate**

Create `tests/season-content.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  SEASON_SOURCES, SEASON_RUNGS, SEASON_CAPSTONE, HEAD_START_CAP, sourcePoints,
} from '../src/data/seasons.js';
import { STATS } from '../src/core/stats.js';
import { FOODS } from '../src/data/foods.js';

// Counters a veteran can never move again. Crediting one would hand a new account a
// permanent advantage over exactly the players this loop exists to keep.
const FINITE_STATS = ['stages_first_cleared', 'lots_built', 'lots_upgraded'];
// acceptTrade requires a second player, so a source whose ONLY stat is this one is
// unreachable solo.
const NEEDS_PARTNER = ['trades_completed'];

describe('season content gate', () => {
  it('is 9 sources with unique ids referencing real stats', () => {
    expect(SEASON_SOURCES).toHaveLength(9);
    expect(new Set(SEASON_SOURCES.map((s) => s.id)).size).toBe(9);
    for (const src of SEASON_SOURCES) {
      expect(src.stats.length).toBeGreaterThan(0);
      for (const e of src.stats) {
        expect(STATS[e.stat], `${src.id} references unknown stat ${e.stat}`).toBeDefined();
        expect(e.points).toBeGreaterThan(0);
        expect(e.per).toBeGreaterThan(0);
      }
    }
  });

  it('never credits a finite lifetime counter', () => {
    for (const src of SEASON_SOURCES) {
      for (const e of src.stats) {
        expect(FINITE_STATS, `${src.id} credits finite counter ${e.stat}`).not.toContain(e.stat);
      }
    }
  });

  // The assertion that would have caught the dropped-trading design: every source must
  // have at least one stat a solo player can move.
  it('every source is reachable solo', () => {
    for (const src of SEASON_SOURCES) {
      const solo = src.stats.filter((e) => !NEEDS_PARTNER.includes(e.stat));
      expect(solo.length, `${src.id} is only reachable with a second player`).toBeGreaterThan(0);
    }
  });

  it('caps sum above the capstone, and no single source can reach it', () => {
    const available = SEASON_SOURCES.reduce((s, x) => s + x.cap, 0);
    expect(available).toBe(1335);
    expect(available).toBeGreaterThan(SEASON_CAPSTONE);
    for (const src of SEASON_SOURCES) {
      expect(src.cap, `${src.id} alone reaches the capstone`).toBeLessThan(SEASON_CAPSTONE);
    }
    // Breadth is forced: the largest source is under a third of the capstone.
    expect(Math.max(...SEASON_SOURCES.map((s) => s.cap)) / SEASON_CAPSTONE).toBeLessThan(0.32);
  });

  it('is 8 strictly ascending rungs whose last one is the capstone', () => {
    expect(SEASON_RUNGS).toHaveLength(8);
    for (let i = 1; i < SEASON_RUNGS.length; i++) {
      expect(SEASON_RUNGS[i].points).toBeGreaterThan(SEASON_RUNGS[i - 1].points);
    }
    expect(SEASON_RUNGS[SEASON_RUNGS.length - 1].points).toBe(SEASON_CAPSTONE);
    expect(SEASON_RUNGS.map((r) => r.points)).toEqual([50, 125, 225, 350, 475, 600, 700, 800]);
  });

  it('pays real foods, and shards stay well under the quest line', () => {
    const shards = SEASON_RUNGS.reduce((s, r) => s + (r.rewards.shards ?? 0), 0);
    const cash = SEASON_RUNGS.reduce((s, r) => s + (r.rewards.cash ?? 0), 0);
    for (const r of SEASON_RUNGS) {
      if (r.rewards.food) expect(FOODS[r.rewards.food.foodId]).toBeDefined();
    }
    expect(cash).toBe(60_000);
    expect(shards).toBe(110);
    // 30 days of daily quests pays ~450 shards. A season must stay materially below that,
    // because shards buy mythic eggs at 500 and doubling mythic acquisition is a balance
    // change, not a reward tweak.
    expect(shards).toBeLessThan(150);
  });

  it('splicing costs less in shards than the track pays back', () => {
    const splice = SEASON_SOURCES.find((s) => s.id === 'splicing')!;
    const splicesToCap = splice.cap / splice.stats[0].points;   // points are per 1 splice
    const shardCost = splicesToCap * 15;                        // SPLICE_SHARD_COST
    const paidBack = SEASON_RUNGS.reduce((s, r) => s + (r.rewards.shards ?? 0), 0);
    expect(shardCost).toBeLessThan(paidBack);
  });

  it('sourcePoints floors per-unit and clamps at the cap', () => {
    const care = SEASON_SOURCES.find((s) => s.id === 'care')!;   // 1 point per 3 feeds
    expect(sourcePoints(care, { dinos_fed: 0 })).toBe(0);
    expect(sourcePoints(care, { dinos_fed: 2 })).toBe(0);
    expect(sourcePoints(care, { dinos_fed: 3 })).toBe(1);
    expect(sourcePoints(care, { dinos_fed: 5 })).toBe(1);
    expect(sourcePoints(care, { dinos_fed: 99_999 })).toBe(care.cap);
  });

  it('sourcePoints sums a multi-stat source before clamping', () => {
    const commerce = SEASON_SOURCES.find((s) => s.id === 'commerce')!;
    expect(sourcePoints(commerce, { trades_completed: 1 })).toBe(15);
    expect(sourcePoints(commerce, { shop_purchases: 10 })).toBe(10);
    expect(sourcePoints(commerce, { trades_completed: 1, shop_purchases: 10 })).toBe(25);
    expect(sourcePoints(commerce, { trades_completed: 99 })).toBe(commerce.cap);
  });

  it('treats a negative delta as zero rather than subtracting', () => {
    const care = SEASON_SOURCES.find((s) => s.id === 'care')!;
    expect(sourcePoints(care, { dinos_fed: -50 })).toBe(0);
  });

  it('caps the head start below the third rung', () => {
    expect(HEAD_START_CAP).toBe(200);
    // Natural max is 52 species + 105 stars + 40 rating = 197.
    expect(197).toBeLessThan(SEASON_RUNGS[2].points);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/season-content.test.ts`
Expected: FAIL — cannot resolve `../src/data/seasons.js`.

- [ ] **Step 3: Implement the content table**

Create `src/data/seasons.ts`:

```ts
import type { StatId } from '../core/stats.js';
import type { FoodId } from './foods.js';

/**
 * One point source. `points` per `per` units of the stat, floored, summed across the
 * source's stats, then clamped to `cap`.
 *
 * The cap is the whole design: it converts an unbounded grind into early saturation
 * rather than a treadmill, which is what lets a source with no real-time gate
 * (dinos_fed, shop_purchases) sit in the ladder at all.
 */
export interface SeasonSource {
  id: string;
  name: string;
  stats: ReadonlyArray<{ stat: StatId; points: number; per: number }>;
  cap: number;
}

/**
 * Nine sources, 1,335 available against an 800 capstone. No source reaches 31% of the
 * capstone, so breadth is forced without any single source being mandatory.
 *
 * Deliberately excluded: stages_first_cleared / lots_built / lots_upgraded (finite
 * lifetime counters a veteran can never move again — crediting them favours new
 * accounts over exactly the players this loop exists to keep); dinos_rescued (an
 * artifact of neglect, so paying for it rewards letting dinos escape);
 * eggs_incubated (shares one ceiling with eggs_hatched, so crediting both double-pays
 * a single action, the thing CHURN_STATS already prevents on quest boards);
 * breedings_started (claimed <= started always, same double-pay); income_collected
 * (36,036/day mid-game against 4,561,920/day endgame — a 126x spread no single rate
 * calibrates for both ends).
 */
export const SEASON_SOURCES: readonly SeasonSource[] = [
  // Priced against the energy ceiling: ENERGY_CAP 10 + a 10-minute regen = 144 fights/day.
  // battles_fought rather than battles_won so an under-geared squad is never shut out.
  { id: 'campaign', name: 'Campaign', stats: [{ stat: 'battles_fought', points: 1, per: 4 }], cap: 250 },
  // Single expedition slot; sites run 15 min to 48 h. The high per-unit value protects the
  // player running long sites for egg odds from being punished into short-site spam.
  { id: 'expeditions', name: 'Expeditions', stats: [{ stat: 'expeditions_claimed', points: 5, per: 1 }], cap: 250 },
  { id: 'hatchery', name: 'Hatchery', stats: [{ stat: 'eggs_hatched', points: 3, per: 1 }], cap: 225 },
  { id: 'genelab', name: 'Gene Lab', stats: [{ stat: 'breedings_claimed', points: 5, per: 1 }], cap: 180 },
  // The worst rate in the ladder, deliberately: tier-1 food fills to exactly 100 and
  // hungerAt drops below it after any dt > 0, so a dino re-qualifies almost immediately
  // and a 48-dino roster banks this whole cap in ~8 interactions. The cap contains it —
  // the exploit buys days, never points.
  { id: 'care', name: 'Dino care', stats: [{ stat: 'dinos_fed', points: 1, per: 3 }], cap: 120 },
  { id: 'sales', name: 'Sales', stats: [{ stat: 'dinos_sold', points: 3, per: 1 }], cap: 100 },
  // 15 points, not 6. At 6 the cap took 15 splices = 225 shards to earn 90 points against
  // the 110 the whole track pays back — net-negative in the scarce currency for exactly
  // the shard-poor players these 90 points are sized for. At 15 the cap costs 6 splices,
  // 90 shards, under what the track returns.
  { id: 'splicing', name: 'Splicing', stats: [{ stat: 'splices_done', points: 15, per: 1 }], cap: 90 },
  // Two honest routes to one cap: 4 trades or 60 shop transactions. trades_completed
  // cannot stand alone (acceptTrade requires a second player and only the recipient may
  // accept), and dropping it would mean the social loop earns nothing on the track.
  // shop_purchases increments once per TRANSACTION, never per unit.
  { id: 'commerce', name: 'Commerce', stats: [
    { stat: 'trades_completed', points: 15, per: 1 },
    { stat: 'shop_purchases', points: 1, per: 1 },
  ], cap: 60 },
  // A participation floor, not a challenge: collecting requires only amount > 0.
  { id: 'collections', name: 'Park collections', stats: [{ stat: 'income_collections', points: 1, per: 1 }], cap: 60 },
];

export interface SeasonRung {
  points: number;
  rewards: {
    cash?: number; shards?: number;
    food?: { foodId: FoodId; qty: number };
    eggRarity?: 'rare' | 'epic';
  };
}

/**
 * Eight rungs. The moderate profile scores 37.3 points/day, clearing the capstone on day
 * 21.4 with 8.6 days of slack; a 10-day lapsed player reaches 373 and lands on rung 4.
 *
 * Totals: 60,000 cash (1.32x a month of daily quests) and 110 shards (24% of the quest
 * shard line). Cash high, shards low, on purpose.
 *
 * The BADGE IS NOT HERE. Crossing SEASON_CAPSTONE grants it outright — rung 8 pays only
 * its cash and shards and forfeits like any other rung.
 */
export const SEASON_RUNGS: readonly SeasonRung[] = [
  { points: 50, rewards: { cash: 3_000 } },
  { points: 125, rewards: { cash: 6_000, food: { foodId: 'royal_greens', qty: 20 } } },
  { points: 225, rewards: { cash: 8_000, shards: 15 } },          // exactly one splice
  { points: 350, rewards: { cash: 10_000, eggRarity: 'rare' } },  // mirrors chestFor's streak-14
  { points: 475, rewards: { cash: 12_000, shards: 25 } },
  { points: 600, rewards: { cash: 12_000, food: { foodId: 'prime_steak', qty: 40 } } },
  { points: 700, rewards: { shards: 30, eggRarity: 'epic' } },    // matches chestFor's 30-day epic
  { points: 800, rewards: { cash: 9_000, shards: 40 } },
];

export const SEASON_CAPSTONE = SEASON_RUNGS[SEASON_RUNGS.length - 1].points;

/** Belt-and-braces above the natural 197 maximum (52 species + 105 stars + 40 rating). */
export const HEAD_START_CAP = 200;

/** Integer math only — floor per unit, sum across stats, clamp at the cap. */
export function sourcePoints(src: SeasonSource, deltas: Partial<Record<StatId, number>>): number {
  let raw = 0;
  for (const e of src.stats) {
    const d = Math.max(0, deltas[e.stat] ?? 0);
    raw += Math.floor(d / e.per) * e.points;
  }
  return Math.min(src.cap, raw);
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/season-content.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation check**

Remove the `Math.min(src.cap, ...)` clamp: the cap and day-1 tests must go RED. Restore. Change `Math.max(0, ...)` to a bare read: the negative-delta test must go RED. Restore. Drop `trades_completed` from the commerce source: the multi-stat test must go RED. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/data/seasons.ts tests/season-content.test.ts
git commit -m "Add the season point sources and reward rungs"
```

---

## Task 4: Roll a season and freeze its baselines

**Files:**
- Create: `src/modules/daily/season.ts`
- Create: `tests/season.test.ts`

**Interfaces:**
- Consumes: `SEASON_SOURCES`, `HEAD_START_CAP` (Task 3); `seasonIndexFor` (Task 1); `schema.seasonProgress` (Task 2); `readStats`, `STATS` from `src/core/stats.js`; `dexProgress` from `src/modules/dex/service.js`; `schema.battleProgress`.
- Produces: `rollSeason(ctx: Ctx, userId: string): void`, `headStartFor(ctx: Ctx, userId: string): number`, `currentRow(ctx: Ctx, userId: string): typeof schema.seasonProgress.$inferSelect | undefined`.

- [ ] **Step 1: Write the failing tests**

Create `tests/season.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track, STATS } from '../src/core/stats.js';
import { rollSeason, headStartFor } from '../src/modules/daily/season.js';
import { SEASON_DAYS } from '../src/core/world.js';

const DAY = 86_400_000;
export const S1 = 689 * SEASON_DAYS * DAY;   // season 1, day 1
const S2 = S1 + 30 * DAY;

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(S1); getOrCreateUser(ctx, 'p', 'P'); });

const rows = (userId = 'p') => ctx.db.select().from(schema.seasonProgress)
  .where(eq(schema.seasonProgress.userId, userId)).all();

describe('rollSeason', () => {
  it('freezes a row for the current season on first touch', () => {
    rollSeason(ctx, 'p');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].seasonIndex).toBe(689);
    expect(rows()[0].createdAt).toBe(S1);
    expect(rows()[0].badgeAt).toBeNull();
  });

  it('is idempotent — a second call writes nothing new', () => {
    rollSeason(ctx, 'p');
    const before = rows()[0].createdAt;
    ctx.setNow(S1 + 5 * DAY);
    rollSeason(ctx, 'p');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].createdAt).toBe(before);
  });

  it('no-ops for a user with no users row', () => {
    rollSeason(ctx, 'ghost');
    expect(rows('ghost')).toHaveLength(0);
  });

  // The trap this guards: freezing only the ladder's current stats means a source added
  // in a later season finds no key, reads baseline 0, and credits a lifetime counter.
  it('freezes EVERY StatId, not only the ones the ladder reads', () => {
    track(ctx, 'p', 'dinos_fed', 7);
    track(ctx, 'p', 'lots_built', 3);
    rollSeason(ctx, 'p');
    const b = rows()[0].baselines;
    for (const stat of Object.keys(STATS)) {
      expect(b[stat], `missing baseline for ${stat}`).toBeDefined();
    }
    expect(b.dinos_fed).toBe(7);
    expect(b.lots_built).toBe(3);
    expect(b.eggs_hatched).toBe(0);
  });

  // Retention, not sweeping — the opposite of rollDailyQuests. badgeAt on a past row is
  // the permanent record of that season's capstone.
  it('RETAINS the previous season’s row when a new season rolls', () => {
    rollSeason(ctx, 'p');
    ctx.db.update(schema.seasonProgress).set({ badgeAt: S1 + DAY })
      .where(eq(schema.seasonProgress.userId, 'p')).run();
    ctx.setNow(S2);
    track(ctx, 'p', 'dinos_fed', 100);
    rollSeason(ctx, 'p');
    expect(rows()).toHaveLength(2);
    const old = rows().find((r) => r.seasonIndex === 689)!;
    const fresh = rows().find((r) => r.seasonIndex === 690)!;
    expect(old.badgeAt).toBe(S1 + DAY);
    // The new season starts from the counter as it stands now, not from zero.
    expect(fresh.baselines.dinos_fed).toBe(100);
  });
});

describe('headStartFor', () => {
  it('is zero for a brand-new account', () => {
    expect(headStartFor(ctx, 'p')).toBe(0);
  });

  it('sums species seen, battle stars and rating/25', () => {
    for (const id of ['triceratops', 'velociraptor']) {
      ctx.db.insert(schema.speciesSeen).values({ userId: 'p', speciesId: id, firstAt: 0 }).run();
    }
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: 's1', stars: 3 }).run();
    ctx.db.update(schema.users).set({ ratingHighWater: 600 })
      .where(eq(schema.users.discordId, 'p')).run();
    expect(headStartFor(ctx, 'p')).toBe(2 + 3 + 24);
  });

  it('clamps at HEAD_START_CAP', () => {
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: 's1', stars: 9_999 }).run();
    expect(headStartFor(ctx, 'p')).toBe(200);
  });

  // Frozen at roll time: it must not drift as the season's own progress moves.
  it('is stored on the row and never recomputed', () => {
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: 's1', stars: 10 }).run();
    rollSeason(ctx, 'p');
    expect(rows()[0].headStart).toBe(10);
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: 's2', stars: 3 }).run();
    rollSeason(ctx, 'p');
    expect(rows()[0].headStart).toBe(10);
  });

  // The whole point of the three-term choice: a player's FIRST season, whenever it falls.
  it('pays on the first season ever, not only on season 1', () => {
    ctx.setNow(S2);
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: 's1', stars: 12 }).run();
    rollSeason(ctx, 'p');
    expect(rows()[0].seasonIndex).toBe(690);
    expect(rows()[0].headStart).toBe(12);
  });

  it('pays nothing on a SECOND season', () => {
    ctx.db.insert(schema.battleProgress)
      .values({ userId: 'p', stageId: 's1', stars: 12 }).run();
    rollSeason(ctx, 'p');
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    expect(rows().find((r) => r.seasonIndex === 690)!.headStart).toBe(0);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/season.test.ts`
Expected: FAIL — cannot resolve `../src/modules/daily/season.js`.

- [ ] **Step 3: Implement**

Create `src/modules/daily/season.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { seasonIndexFor } from '../../core/world.js';
import { readStats, STATS, type StatId } from '../../core/stats.js';
import { HEAD_START_CAP } from '../../data/seasons.js';
import { dexProgress } from '../dex/service.js';

export function currentRow(ctx: Ctx, userId: string) {
  return ctx.db.select().from(schema.seasonProgress)
    .where(and(
      eq(schema.seasonProgress.userId, userId),
      eq(schema.seasonProgress.seasonIndex, seasonIndexFor(ctx.now())),
    )).get();
}

/**
 * A veteran head start, paid once on a player's FIRST season ever — not on calendar
 * season 1, so a returning player who first appears in season 5 is still credited and a
 * genuinely new account computes to ~0 with no special case.
 *
 * Reads ONLY signals that are complete for every account: species_seen (credited at all
 * three mint/transfer sites and backfilled by scripts/backfill-species-seen.ts), battle
 * stars, and ratingHighWater. Achievement claims are excluded even though they look like
 * the obvious fourth term — 7 of 12 ACHIEVEMENTS tracks sit on user_stats counters
 * migration 0006 never backfilled, so including them would under-credit the oldest
 * accounts, the same inversion legacyPoints was built across three other tables to avoid.
 *
 * Rating is divided by 25, not 10, so its term (max 40) stays the smallest of the three:
 * it is the one signal a veteran can still move DURING the season, and weighting it
 * heavier would drift toward double-counting live progress.
 */
export function headStartFor(ctx: Ctx, userId: string): number {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  if (!user) return 0;
  const stars = ctx.db.select().from(schema.battleProgress)
    .where(eq(schema.battleProgress.userId, userId)).all()
    .reduce((s, r) => s + r.stars, 0);
  const species = dexProgress(ctx, userId).seen;
  return Math.min(HEAD_START_CAP, species + stars + Math.floor(user.ratingHighWater / 25));
}

/**
 * Freeze this season's baselines. Lazy and idempotent, the same shape as
 * rollDailyQuests — but WITHOUT its delete-other-keys sweep: past rows are retained
 * because badgeAt on one is the permanent record of that season's capstone.
 *
 * Freezes EVERY StatId, not only the ones SEASON_SOURCES currently reads. A source added
 * in a later season would otherwise find no baseline key, read it as 0, and credit that
 * player's entire lifetime counter in a single tick.
 */
export function rollSeason(ctx: Ctx, userId: string): void {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  if (!user) return;
  if (currentRow(ctx, userId)) return;
  const now = ctx.now();
  const seasonIndex = seasonIndexFor(now);
  const stats = readStats(ctx, userId);
  const baselines: Record<string, number> = {};
  for (const stat of Object.keys(STATS) as StatId[]) baselines[stat] = stats[stat] ?? 0;
  // First season EVER for this player, not season 1 of the calendar.
  const isFirstEver = ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, userId)).get() === undefined;
  ctx.db.insert(schema.seasonProgress).values({
    userId, seasonIndex, baselines,
    headStart: isFirstEver ? headStartFor(ctx, userId) : 0,
    createdAt: now,
  }).onConflictDoNothing().run();
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/season.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation check**

Add a `ctx.db.delete(schema.seasonProgress).where(ne(...seasonIndex, seasonIndex))` sweep to `rollSeason`: the retention test must go RED. Remove it. Change `isFirstEver` to a constant `true`: the "pays nothing on a SECOND season" test must go RED. Restore. Change the baseline loop to iterate `SEASON_SOURCES` stats instead of `STATS`: the every-StatId test must go RED. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/daily/season.ts tests/season.test.ts
git commit -m "Freeze a per-season baseline with a first-season head start"
```

---

## Task 5: Derive season points

**Files:**
- Modify: `src/modules/daily/season.ts`
- Test: `tests/season.test.ts`

**Interfaces:**
- Consumes: `currentRow`, `rollSeason` (Task 4); `sourcePoints`, `SEASON_SOURCES`, `SEASON_RUNGS`, `SEASON_CAPSTONE` (Task 3).
- Produces:
  - `SeasonBreakdown { source: SeasonSource; points: number }`
  - `SeasonRungView { idx: number; rung: SeasonRung; unlocked: boolean; claimed: boolean }`
  - `SeasonView { index, number, season, dayOfSeason, daysLeft, headStart, points, breakdown, rungs, badgeAt }`
  - `seasonPoints(ctx: Ctx, userId: string): number`
  - `seasonView(ctx: Ctx, userId: string): SeasonView | null`

- [ ] **Step 1: Write the failing tests**

Append to `tests/season.test.ts`:

```ts
import { seasonPoints, seasonView } from '../src/modules/daily/season.js';
import { SEASON_CAPSTONE } from '../src/data/seasons.js';

describe('seasonPoints', () => {
  it('is zero before the season is rolled', () => {
    expect(seasonPoints(ctx, 'p')).toBe(0);
  });

  it('counts only the delta since the baseline', () => {
    track(ctx, 'p', 'expeditions_claimed', 4);   // pre-season history
    rollSeason(ctx, 'p');
    expect(seasonPoints(ctx, 'p')).toBe(0);
    track(ctx, 'p', 'expeditions_claimed', 3);   // 3 x 5 = 15
    expect(seasonPoints(ctx, 'p')).toBe(15);
  });

  it('adds the frozen head start to the live delta', () => {
    ctx.db.insert(schema.battleProgress).values({ userId: 'p', stageId: 's1', stars: 10 }).run();
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 2);   // 10
    expect(seasonPoints(ctx, 'p')).toBe(20);
  });

  it('clamps each source at its cap, so one grind cannot carry a player', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'dinos_fed', 100_000);
    expect(seasonPoints(ctx, 'p')).toBe(120);
  });

  // adminReset deletes user_stats but the baseline row may survive a step behind, which
  // would make current - baseline negative.
  it('clamps a negative delta at zero rather than subtracting', () => {
    track(ctx, 'p', 'dinos_fed', 300);
    rollSeason(ctx, 'p');
    ctx.db.delete(schema.userStats).where(eq(schema.userStats.userId, 'p')).run();
    expect(seasonPoints(ctx, 'p')).toBe(0);
  });

  it('never derives points for a past season', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);
    expect(seasonPoints(ctx, 'p')).toBe(50);
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    // The counter kept its value, but the new season's baseline absorbed it.
    expect(seasonPoints(ctx, 'p')).toBe(0);
  });
});

describe('seasonView', () => {
  it('is null before the season is rolled', () => {
    expect(seasonView(ctx, 'p')).toBeNull();
  });

  it('reports the season’s identity and remaining days', () => {
    rollSeason(ctx, 'p');
    const v = seasonView(ctx, 'p')!;
    expect(v.index).toBe(689);
    expect(v.number).toBe(1);
    expect(v.dayOfSeason).toBe(1);
    expect(v.daysLeft).toBe(30);
    ctx.setNow(S1 + 29 * DAY);
    expect(seasonView(ctx, 'p')!.daysLeft).toBe(1);
  });

  it('breaks points down per source, in ladder order', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'battles_fought', 8);        // 2
    track(ctx, 'p', 'expeditions_claimed', 1);   // 5
    const v = seasonView(ctx, 'p')!;
    expect(v.breakdown.map((b) => b.source.id).slice(0, 2)).toEqual(['campaign', 'expeditions']);
    expect(v.breakdown.find((b) => b.source.id === 'campaign')!.points).toBe(2);
    expect(v.breakdown.find((b) => b.source.id === 'expeditions')!.points).toBe(5);
    expect(v.points).toBe(7);
  });

  it('marks rungs unlocked at or above their threshold', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);  // 50 — exactly rung 1
    const v = seasonView(ctx, 'p')!;
    expect(v.rungs[0].unlocked).toBe(true);
    expect(v.rungs[0].claimed).toBe(false);
    expect(v.rungs[1].unlocked).toBe(false);
    expect(v.rungs.map((r) => r.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/season.test.ts -t seasonPoints`
Expected: FAIL — `seasonPoints is not a function`.

- [ ] **Step 3: Implement**

Append to `src/modules/daily/season.ts` (extend the existing imports with `seasonFor`, `seasonDay`, `SEASON_DAYS`, `type Season` from `world.js`, and `SEASON_SOURCES`, `SEASON_RUNGS`, `sourcePoints`, `type SeasonSource`, `type SeasonRung` from `../../data/seasons.js`):

```ts
export interface SeasonBreakdown { source: SeasonSource; points: number }
export interface SeasonRungView { idx: number; rung: SeasonRung; unlocked: boolean; claimed: boolean }
export interface SeasonView {
  index: number; number: number; season: Season;
  dayOfSeason: number; daysLeft: number;
  headStart: number; points: number;
  breakdown: SeasonBreakdown[]; rungs: SeasonRungView[];
  badgeAt: number | null;
}

/**
 * Deltas since this season's frozen baseline, per stat, clamped at 0.
 *
 * The clamp is not defensive noise: adminReset deletes user_stats rows, so a baseline row
 * surviving a step behind its counters yields current - baseline < 0.
 */
function deltas(ctx: Ctx, userId: string, baselines: Record<string, number>): Partial<Record<StatId, number>> {
  const stats = readStats(ctx, userId);
  const out: Partial<Record<StatId, number>> = {};
  for (const stat of Object.keys(STATS) as StatId[]) {
    out[stat] = Math.max(0, (stats[stat] ?? 0) - (baselines[stat] ?? 0));
  }
  return out;
}

/** Batches with ONE readStats call — never a query per source. */
export function seasonPoints(ctx: Ctx, userId: string): number {
  const row = currentRow(ctx, userId);
  if (!row) return 0;
  const d = deltas(ctx, userId, row.baselines);
  return row.headStart + SEASON_SOURCES.reduce((s, src) => s + sourcePoints(src, d), 0);
}

export function seasonView(ctx: Ctx, userId: string): SeasonView | null {
  const row = currentRow(ctx, userId);
  if (!row) return null;
  const now = ctx.now();
  const d = deltas(ctx, userId, row.baselines);
  const breakdown = SEASON_SOURCES.map((source) => ({ source, points: sourcePoints(source, d) }));
  const points = row.headStart + breakdown.reduce((s, b) => s + b.points, 0);
  const claimed = new Set(ctx.db.select().from(schema.seasonClaims)
    .where(and(
      eq(schema.seasonClaims.userId, userId),
      eq(schema.seasonClaims.seasonIndex, row.seasonIndex),
    )).all().map((c) => c.rung));
  return {
    index: row.seasonIndex,
    number: row.seasonIndex - SEASON_EPOCH + 1,
    season: seasonFor(now),
    dayOfSeason: seasonDay(now),
    daysLeft: SEASON_DAYS - seasonDay(now) + 1,
    headStart: row.headStart,
    points,
    breakdown,
    rungs: SEASON_RUNGS.map((rung, idx) => ({
      idx, rung, unlocked: points >= rung.points, claimed: claimed.has(idx),
    })),
    badgeAt: row.badgeAt,
  };
}
```

Add `SEASON_EPOCH` to the `world.js` import.

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/season.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Remove the `Math.max(0, ...)` in `deltas`: the negative-delta test must go RED. Restore. Drop `row.headStart +` from `seasonPoints`: the head-start test must go RED. Restore. Change `points >= rung.points` to `>`: the "exactly rung 1" test must go RED. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/daily/season.ts tests/season.test.ts
git commit -m "Derive season points from capped per-source stat deltas"
```

---

## Task 6: Claim consumable rungs

**Files:**
- Modify: `src/modules/daily/season.ts`
- Test: `tests/season.test.ts`

**Interfaces:**
- Consumes: `seasonView` (Task 5); `ctx.economy.apply`.
- Produces: `SeasonClaimResult { claimed: SeasonRungView[]; rewards: { cash: number; shards: number; foods: Partial<Record<FoodId, number>> }; eggs: Array<'rare' | 'epic'> }` and `claimSeason(ctx: Ctx, userId: string): SeasonClaimResult`.

Claim pays every unlocked-unclaimed rung at once, in ONE transaction with a single summed `economy.apply` under the reason `'season:rungs'` — the `claimAchievements` shape, so one claim produces one `tx_log` row for the cash/shard pair.

- [ ] **Step 1: Write the failing tests**

Append to `tests/season.test.ts`:

```ts
import { claimSeason } from '../src/modules/daily/season.js';

const cash = (userId = 'p') => ctx.db.select().from(schema.users)
  .where(eq(schema.users.discordId, userId)).get()!.cash;
const claimRows = () => ctx.db.select().from(schema.seasonClaims)
  .where(eq(schema.seasonClaims.userId, 'p')).all();

describe('claimSeason', () => {
  it('pays nothing and writes nothing when no rung is unlocked', () => {
    rollSeason(ctx, 'p');
    const before = cash();
    const res = claimSeason(ctx, 'p');
    expect(res.claimed).toEqual([]);
    expect(res.rewards.cash).toBe(0);
    expect(cash()).toBe(before);
    expect(claimRows()).toHaveLength(0);
    expect(ctx.db.select().from(schema.txLog).all()).toHaveLength(0);
  });

  it('pays every unlocked rung at once and records each', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 45);   // 225 = rungs 1,2,3
    const before = cash();
    const res = claimSeason(ctx, 'p');
    expect(res.claimed.map((c) => c.idx)).toEqual([0, 1, 2]);
    expect(res.rewards.cash).toBe(3_000 + 6_000 + 8_000);
    expect(res.rewards.shards).toBe(15);
    expect(res.rewards.foods.royal_greens).toBe(20);
    expect(cash()).toBe(before + 17_000);
    expect(claimRows().map((r) => r.rung).sort()).toEqual([0, 1, 2]);
  });

  it('is idempotent — a second claim pays nothing', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    claimSeason(ctx, 'p');
    const after = cash();
    const res = claimSeason(ctx, 'p');
    expect(res.claimed).toEqual([]);
    expect(cash()).toBe(after);
    expect(claimRows()).toHaveLength(1);
  });

  it('grants egg rungs as real egg rows', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);   // 250 -> not yet rung 4
    track(ctx, 'p', 'battles_fought', 400);       // +100 = 350 = rung 4
    const res = claimSeason(ctx, 'p');
    expect(res.eggs).toEqual(['rare']);
    const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).all();
    expect(eggs).toHaveLength(1);
    expect(eggs[0].rarity).toBe('rare');
    expect(eggs[0].source).toBe('quest');
  });

  it('writes exactly one tx_log row for the cash and shard pair', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 45);
    claimSeason(ctx, 'p');
    const logs = ctx.db.select().from(schema.txLog).all()
      .filter((r) => r.reason === 'season:rungs' && r.foodId === null);
    expect(logs).toHaveLength(1);
    expect(logs[0].cashDelta).toBe(17_000);
  });

  // Forfeiture: rungs belong to the season they were unlocked in.
  it('cannot claim a previous season’s rungs after rollover', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1, never claimed
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    const before = cash();
    expect(claimSeason(ctx, 'p').claimed).toEqual([]);
    expect(cash()).toBe(before);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/season.test.ts -t claimSeason`
Expected: FAIL — `claimSeason is not a function`.

- [ ] **Step 3: Implement**

Append to `src/modules/daily/season.ts` (add `import type { FoodId } from '../../data/foods.js';`):

```ts
export interface SeasonClaimResult {
  claimed: SeasonRungView[];
  rewards: { cash: number; shards: number; foods: Partial<Record<FoodId, number>> };
  eggs: Array<'rare' | 'epic'>;
}

/**
 * Pays every unlocked-unclaimed rung of the CURRENT season in one transaction with a
 * single summed apply — the claimAchievements shape, so 'season:rungs' produces exactly
 * one tx_log row for the cash/shard pair however many rungs it covers. An empty claim
 * returns before the transaction: no apply, no rows, no tx_log entry.
 *
 * Scoped to the current season only. A rung unlocked last season and never claimed is
 * forfeited by design, exactly as claimQuests forfeits an unclaimed board after midnight.
 * The BADGE is not claimed here — it is stamped on crossing (stampSeasonBadge) precisely
 * so it survives this forfeiture.
 */
export function claimSeason(ctx: Ctx, userId: string): SeasonClaimResult {
  const empty: SeasonClaimResult = { claimed: [], rewards: { cash: 0, shards: 0, foods: {} }, eggs: [] };
  const view = seasonView(ctx, userId);
  if (!view) return empty;
  const claimable = view.rungs.filter((r) => r.unlocked && !r.claimed);
  if (!claimable.length) return empty;

  const now = ctx.now();
  const rewards = { cash: 0, shards: 0, foods: {} as Partial<Record<FoodId, number>> };
  const eggs: Array<'rare' | 'epic'> = [];
  for (const r of claimable) {
    rewards.cash += r.rung.rewards.cash ?? 0;
    rewards.shards += r.rung.rewards.shards ?? 0;
    if (r.rung.rewards.food) {
      const { foodId, qty } = r.rung.rewards.food;
      rewards.foods[foodId] = (rewards.foods[foodId] ?? 0) + qty;
    }
    if (r.rung.rewards.eggRarity) eggs.push(r.rung.rewards.eggRarity);
  }

  ctx.db.transaction(() => {
    ctx.economy.apply(userId, rewards, 'season:rungs', now);
    for (const r of claimable) {
      ctx.db.insert(schema.seasonClaims)
        .values({ userId, seasonIndex: view.index, rung: r.idx, claimedAt: now })
        .onConflictDoNothing().run();
    }
    for (const rarity of eggs) {
      ctx.db.insert(schema.eggs).values({
        userId, rarity, speciesId: null, source: 'quest', obtainedAt: now,
      }).run();
    }
  });
  return { claimed: claimable, rewards, eggs };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/season.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Change the filter to `r.unlocked` alone (dropping `&& !r.claimed`): the idempotency test must go RED. Restore. Move the `economy.apply` inside the per-rung loop: the single-tx_log-row test must go RED. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/daily/season.ts tests/season.test.ts
git commit -m "Pay unlocked season rungs in one claim"
```

---

## Task 7: Stamp the capstone badge on crossing

**Files:**
- Modify: `src/modules/daily/season.ts`, `src/modules/daily/hooks.ts`
- Test: `tests/season.test.ts`

**Interfaces:**
- Consumes: `seasonPoints`, `currentRow` (Tasks 4-5); `SEASON_CAPSTONE` (Task 3).
- Produces: `stampSeasonBadge(ctx: Ctx, userId: string): boolean` (true when it stamped this call), `seasonBadges(ctx: Ctx, userId: string): { count: number; latest: number | null }`.

`stampSeasonBadge` is called from `postDispatch` — a **write** context. It must never be called from `seasonView`, `visitPayload`, or any leaderboard path.

- [ ] **Step 1: Write the failing tests**

Append to `tests/season.test.ts`:

```ts
import { stampSeasonBadge, seasonBadges } from '../src/modules/daily/season.js';

const badgeAt = (index = 689) => ctx.db.select().from(schema.seasonProgress)
  .where(and(eq(schema.seasonProgress.userId, 'p'), eq(schema.seasonProgress.seasonIndex, index)))
  .get()!.badgeAt;

describe('stampSeasonBadge', () => {
  it('does nothing below the capstone', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);   // 250
    expect(stampSeasonBadge(ctx, 'p')).toBe(false);
    expect(badgeAt()).toBeNull();
  });

  it('stamps once on crossing and is idempotent afterwards', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);   // 250
    track(ctx, 'p', 'battles_fought', 1000);      // +250 = 500
    track(ctx, 'p', 'eggs_hatched', 75);          // +225 = 725
    track(ctx, 'p', 'dinos_fed', 360);            // +120 = 845 >= 800
    ctx.setNow(S1 + 3 * DAY);
    expect(stampSeasonBadge(ctx, 'p')).toBe(true);
    expect(badgeAt()).toBe(S1 + 3 * DAY);
    ctx.setNow(S1 + 4 * DAY);
    expect(stampSeasonBadge(ctx, 'p')).toBe(false);
    expect(badgeAt()).toBe(S1 + 3 * DAY);          // never re-stamped
  });

  it('no-ops when the season has not been rolled', () => {
    expect(stampSeasonBadge(ctx, 'p')).toBe(false);
  });

  // THE §9 DECISION'S GATE. Cash forfeits at rollover; the badge does not, because a
  // badge is re-earnable by nothing and a missed button must not put a permanent hole in
  // the collection.
  it('a badge survives an unclaimed rung 8 across the rollover', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);
    track(ctx, 'p', 'battles_fought', 1000);
    track(ctx, 'p', 'eggs_hatched', 75);
    track(ctx, 'p', 'dinos_fed', 360);
    stampSeasonBadge(ctx, 'p');
    const before = cash();
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    expect(claimSeason(ctx, 'p').claimed).toEqual([]);   // consumables forfeited
    expect(cash()).toBe(before);
    expect(badgeAt(689)).not.toBeNull();                 // badge kept
    expect(seasonBadges(ctx, 'p').count).toBe(1);
  });
});

describe('seasonBadges', () => {
  it('counts badged seasons and names the latest', () => {
    expect(seasonBadges(ctx, 'p')).toEqual({ count: 0, latest: null });
    rollSeason(ctx, 'p');
    ctx.db.update(schema.seasonProgress).set({ badgeAt: S1 })
      .where(and(eq(schema.seasonProgress.userId, 'p'),
                 eq(schema.seasonProgress.seasonIndex, 689))).run();
    ctx.setNow(S2);
    rollSeason(ctx, 'p');
    expect(seasonBadges(ctx, 'p')).toEqual({ count: 1, latest: 689 });
    ctx.db.update(schema.seasonProgress).set({ badgeAt: S2 })
      .where(and(eq(schema.seasonProgress.userId, 'p'),
                 eq(schema.seasonProgress.seasonIndex, 690))).run();
    expect(seasonBadges(ctx, 'p')).toEqual({ count: 2, latest: 690 });
  });

  it('is a pure read — it never stamps', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 50);
    track(ctx, 'p', 'battles_fought', 1000);
    track(ctx, 'p', 'eggs_hatched', 75);
    track(ctx, 'p', 'dinos_fed', 360);
    expect(seasonBadges(ctx, 'p').count).toBe(0);
    expect(badgeAt()).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/season.test.ts -t stampSeasonBadge`
Expected: FAIL — `stampSeasonBadge is not a function`.

- [ ] **Step 3: Implement the service half**

Append to `src/modules/daily/season.ts` (add `isNotNull` to the drizzle import and `SEASON_CAPSTONE` to the seasons import):

```ts
/**
 * Grant the capstone badge on CROSSING. Returns true only on the call that stamps it.
 *
 * Called from dailyRouterHooks.postDispatch — a WRITE context. It must never be reached
 * from seasonView, visitPayload or any leaderboard path: those run against other players'
 * ids, and the repo rule (src/modules/park/ranks.ts's legacyRank/bumpLegacyBest split) is
 * that a read path must never mutate a row belonging to a user who took no action.
 *
 * Guarded on badgeAt IS NULL so it is idempotent and the stamped instant never moves.
 */
export function stampSeasonBadge(ctx: Ctx, userId: string): boolean {
  const row = currentRow(ctx, userId);
  if (!row || row.badgeAt !== null) return false;
  if (seasonPoints(ctx, userId) < SEASON_CAPSTONE) return false;
  ctx.db.update(schema.seasonProgress).set({ badgeAt: ctx.now() })
    .where(and(
      eq(schema.seasonProgress.userId, userId),
      eq(schema.seasonProgress.seasonIndex, row.seasonIndex),
    )).run();
  return true;
}

/** Pure read. Safe for another player's id — see stampSeasonBadge's note. */
export function seasonBadges(ctx: Ctx, userId: string): { count: number; latest: number | null } {
  const rows = ctx.db.select().from(schema.seasonProgress)
    .where(and(
      eq(schema.seasonProgress.userId, userId),
      isNotNull(schema.seasonProgress.badgeAt),
    )).all();
  if (!rows.length) return { count: 0, latest: null };
  return { count: rows.length, latest: Math.max(...rows.map((r) => r.seasonIndex)) };
}
```

- [ ] **Step 4: Wire the hook**

In `src/modules/daily/hooks.ts`, import `rollSeason` and `stampSeasonBadge` from `./season.js`, and add to `postDispatch` immediately after the existing `rollDailyQuests(ctx, i.user.id);` line:

```ts
    rollSeason(ctx, i.user.id);
    // The badge stamp runs BEFORE the exemption returns below. Those exemptions suppress
    // the hint TEXT only — crossing the capstone while looking at /season itself must
    // still record it.
    stampSeasonBadge(ctx, i.user.id);
```

Also add `rollSeason(ctx, userId)` to `preDispatch`, so the season's first action counts toward its own track:

```ts
  preDispatch: (ctx, userId) => { rollDailyQuests(ctx, userId); rollSeason(ctx, userId); },
```

- [ ] **Step 5: Run and verify it passes**

Run: `npx vitest run tests/season.test.ts && npx vitest run tests/daily-hooks.test.ts`
Expected: PASS. (If `tests/daily-hooks.test.ts` does not exist, run `npx vitest run tests/` and confirm no regression.)

- [ ] **Step 6: Mutation check**

Remove the `row.badgeAt !== null` guard: the idempotency assertion (`badgeAt` never re-stamped) must go RED. Restore. Move the `stampSeasonBadge` call in `hooks.ts` to *after* the `EXEMPT_COMMANDS` return: no existing test will catch it, which is exactly why the placement carries a comment — put it back and note in the commit that the exemption ordering is deliberate.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/daily/season.ts src/modules/daily/hooks.ts tests/season.test.ts
git commit -m "Grant the season badge on crossing rather than on claim"
```

---

## Task 8: `/season` embeds

**Files:**
- Create: `src/modules/daily/season-embeds.ts`
- Test: `tests/season-embeds.test.ts`

**Interfaces:**
- Consumes: `SeasonView`, `SeasonClaimResult` (Tasks 5-6).
- Produces: `seasonPayload(view: SeasonView, userId: string): Payload`, `seasonClaimPayload(res: SeasonClaimResult): Payload`.

Reuse the `Payload` interface and `bar()` helper already exported from `src/modules/daily/embeds.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/season-embeds.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { rollSeason, seasonView, claimSeason } from '../src/modules/daily/season.js';
import { seasonPayload, seasonClaimPayload } from '../src/modules/daily/season-embeds.js';
import { SEASON_DAYS } from '../src/core/world.js';

const DAY = 86_400_000;
const S1 = 689 * SEASON_DAYS * DAY;

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(S1); getOrCreateUser(ctx, 'p', 'P'); });

describe('seasonPayload', () => {
  it('titles the season by its display number, not its storage index', () => {
    rollSeason(ctx, 'p');
    const json = seasonPayload(seasonView(ctx, 'p')!, 'p').embeds[0].toJSON();
    expect(json.title).toContain('Season 1');
    expect(json.title).not.toContain('689');
  });

  it('carries the season index in the claim button’s customId', () => {
    rollSeason(ctx, 'p');
    const row = seasonPayload(seasonView(ctx, 'p')!, 'p').components![0].toJSON() as {
      components: Array<{ custom_id: string }>;
    };
    expect(row.components[0].custom_id).toBe('season:claim:p:689');
  });

  it('shows the per-source breakdown and the days remaining', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 3);
    const json = seasonPayload(seasonView(ctx, 'p')!, 'p').embeds[0].toJSON();
    const text = JSON.stringify(json);
    expect(text).toContain('Expeditions');
    expect(text).toContain('15');
    expect(text).toContain('30 days left');
  });
});

describe('seasonClaimPayload', () => {
  it('names every reward the claim actually paid', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 45);   // 225 = rungs 1-3
    const text = JSON.stringify(seasonClaimPayload(claimSeason(ctx, 'p')).embeds[0].toJSON());
    expect(text).toContain('17,000');
    expect(text).toContain('15');
    expect(text).toContain('Royal Greens');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/season-embeds.test.ts`
Expected: FAIL — cannot resolve `season-embeds.js`.

- [ ] **Step 3: Implement**

Create `src/modules/daily/season-embeds.ts`:

```ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import { FOODS } from '../../data/foods.js';
import type { Payload } from './embeds.js';
import { bar } from './embeds.js';
import type { SeasonView, SeasonClaimResult } from './season.js';

const SEASON_NAMES: Record<string, string> = { wet: 'Wet Season', dry: 'Dry Season', cold: 'Cold Front' };

export function seasonPayload(view: SeasonView, userId: string): Payload {
  const sources = view.breakdown
    .filter((b) => b.points > 0)
    .map((b) => `${b.source.name} **${b.points}**/${b.source.cap}`)
    .join(' · ') || 'No progress yet — play anything.';
  const rungs = view.rungs.map((r) => {
    const mark = r.claimed ? '✅' : r.unlocked ? '🎁' : '🔒';
    const parts: string[] = [];
    if (r.rung.rewards.cash) parts.push(`${r.rung.rewards.cash.toLocaleString()} cash`);
    if (r.rung.rewards.shards) parts.push(`${r.rung.rewards.shards} shards`);
    if (r.rung.rewards.food) parts.push(`${FOODS[r.rung.rewards.food.foodId].name} ×${r.rung.rewards.food.qty}`);
    if (r.rung.rewards.eggRarity) parts.push(`1 ${r.rung.rewards.eggRarity} egg`);
    return `${mark} **${r.rung.points}** — ${parts.join(', ')}`;
  }).join('\n');
  const capstone = view.rungs[view.rungs.length - 1].rung.points;

  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`🎖️ Season ${view.number} — ${SEASON_NAMES[view.season] ?? view.season}`)
    .setDescription([
      `${bar(Math.min(view.points, capstone), capstone)} **${view.points}**/${capstone} — ${view.daysLeft} days left`,
      view.headStart > 0 ? `*Veteran head start: ${view.headStart}*` : '',
      view.badgeAt !== null ? '**Badge earned — it is yours permanently.**' : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: 'Where your points came from', value: sources },
      { name: 'Rewards', value: rungs },
    );
  const payload: Payload = {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      // The season index is IN the customId. A /season card left open across a rollover
      // would otherwise pay this season's rungs against last season's ladder — the
      // park:landmark:buy stale-button lesson, applied before it can be relearned.
      new ButtonBuilder().setCustomId(`season:claim:${userId}:${view.index}`)
        .setLabel('Claim').setStyle(ButtonStyle.Success),
    )],
  };
  attach(embed, payload, 'image', assetImage('banners', 'daily'));
  return payload;
}

export function seasonClaimPayload(res: SeasonClaimResult): Payload {
  const parts: string[] = [];
  if (res.rewards.cash) parts.push(`**${res.rewards.cash.toLocaleString()}** cash`);
  if (res.rewards.shards) parts.push(`**${res.rewards.shards}** shards`);
  for (const [foodId, qty] of Object.entries(res.rewards.foods)) {
    parts.push(`${FOODS[foodId as keyof typeof FOODS].name} ×${qty}`);
  }
  for (const rarity of res.eggs) parts.push(`1 **${rarity}** egg`);
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`🎖️ Claimed ${res.claimed.length} reward${res.claimed.length === 1 ? '' : 's'}`)
    .setDescription(parts.join('\n') || 'Nothing to claim.');
  return { embeds: [embed] };
}
```

If `bar` is not currently exported from `embeds.ts`, add the `export` keyword to it in that file (it is already declared there).

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/season-embeds.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Change the customId to omit `:${view.index}`: the customId test must go RED. Restore. Change `view.number` to `view.index` in the title: the title test must go RED. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/daily/season-embeds.ts src/modules/daily/embeds.ts tests/season-embeds.test.ts
git commit -m "Render the season hub and its claim receipt"
```

---

## Task 9: The `/season` command and its button

**Files:**
- Modify: `src/modules/daily/index.ts`
- Modify: `tests/registry-load.test.ts`, `tests/contract.test.ts`
- Test: `tests/season-command.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-8.
- Produces: a `/season` command and a `season` component prefix. Command count moves 27 → 28.

- [ ] **Step 1: Write the failing tests**

Create `tests/season-command.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText, testRegistry } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { rollSeason } from '../src/modules/daily/season.js';
import { SEASON_DAYS } from '../src/core/world.js';

const DAY = 86_400_000;
const S1 = 689 * SEASON_DAYS * DAY;

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(S1); getOrCreateUser(ctx, 'p', 'P'); });

const run = async (i: ReturnType<typeof fakeCommand>) =>
  testRegistry.findCommand('season')!.execute(ctx, i.asChatInput());

const click = async (customId: string, user: string) => {
  const i = fakeButton({ customId, user });
  await testRegistry.findComponent(customId)!.execute(ctx, i.asInteraction() as never);
  return i;
};

describe('/season', () => {
  it('rolls the season and replies with the hub', async () => {
    const i = fakeCommand({ name: 'season', user: 'p' });
    await run(i);
    expect(ctx.db.select().from(schema.seasonProgress).all()).toHaveLength(1);
    expect(JSON.stringify(i.replies[0])).toContain('Season 1');
  });
});

describe('season:claim', () => {
  it('refuses a click from someone who is not the owner', async () => {
    rollSeason(ctx, 'p');
    const i = await click('season:claim:p:689', 'intruder');
    expect(replyText(i.replies[0])).toContain('Not your season');
    expect(ctx.db.select().from(schema.seasonClaims).all()).toHaveLength(0);
  });

  // The stale-button guard. An open card from last season must not pay this season.
  it('refuses a stale season index', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);
    const i = await click('season:claim:p:688', 'p');
    expect(replyText(i.replies[0])).toContain('season has ended');
    expect(ctx.db.select().from(schema.seasonClaims).all()).toHaveLength(0);
  });

  it('refuses a non-integer season segment', async () => {
    rollSeason(ctx, 'p');
    for (const bad of ['abc', '689.5', '']) {
      const i = await click(`season:claim:p:${bad}`, 'p');
      expect(replyText(i.replies[0]), bad).toContain('season has ended');
    }
    expect(ctx.db.select().from(schema.seasonClaims).all()).toHaveLength(0);
  });

  it('pays the unlocked rungs on a valid click', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    const before = ctx.db.select().from(schema.users)
      .where(eq(schema.users.discordId, 'p')).get()!.cash;
    await click('season:claim:p:689', 'p');
    expect(ctx.db.select().from(schema.users)
      .where(eq(schema.users.discordId, 'p')).get()!.cash).toBe(before + 3_000);
  });

  it('says so when nothing is claimable', async () => {
    rollSeason(ctx, 'p');
    const i = await click('season:claim:p:689', 'p');
    expect(replyText(i.replies[0])).toContain('Nothing to claim');
  });

  it('absorbs an unknown action rather than erroring', async () => {
    rollSeason(ctx, 'p');
    const i = await click('season:bogus:p:689', 'p');
    expect(i.replies).toHaveLength(0);
  });
});
```

Note on the empty-segment case: `Number('')` is `0`, which is an integer, so it is the **season comparison** that rejects it — not `Number.isInteger`. `'689.5'` is the case only `Number.isInteger` catches. Both clauses are load-bearing; the test covers both.

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/season-command.test.ts`
Expected: FAIL — `findCommand('season')` returns undefined.

- [ ] **Step 3: Implement**

In `src/modules/daily/index.ts`, add to the imports:

```ts
import { rollSeason, seasonView, claimSeason } from './season.js';
import { seasonPayload, seasonClaimPayload } from './season-embeds.js';
import { seasonIndexFor } from '../../core/world.js';
```

Add a third command to `commands`:

```ts
    {
      data: new SlashCommandBuilder().setName('season').setDescription('Your season track, rewards, and badge'),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        rollSeason(ctx, i.user.id);
        await i.reply(seasonPayload(seasonView(ctx, i.user.id)!, i.user.id));
      },
    },
```

Add a third component handler:

```ts
    {
      prefix: 'season',
      async execute(ctx, i) {
        // Same owner-lock discipline as 'daily' and 'ach', plus a season check: the
        // customId carries the season it was minted for, and a card left open across a
        // rollover must not pay this season's rungs against last season's ladder.
        const [, action, uid, indexStr] = i.customId.split(':');
        if (action !== 'claim') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) { await i.reply({ content: 'Not your season track.', flags: MessageFlags.Ephemeral }); return; }
        const offered = Number(indexStr);
        if (!Number.isInteger(offered) || offered !== seasonIndexFor(ctx.now())) {
          await i.reply({ content: 'That season has ended — run **/season** for the current one.', flags: MessageFlags.Ephemeral });
          return;
        }
        rollSeason(ctx, i.user.id);
        const result = claimSeason(ctx, i.user.id);
        if (!result.claimed.length) {
          await i.reply({ content: 'Nothing to claim yet — keep playing.', flags: MessageFlags.Ephemeral });
          return;
        }
        await i.reply({ ...seasonClaimPayload(result), flags: MessageFlags.Ephemeral });
      },
    },
```

- [ ] **Step 4: Update the three hard-coded counts**

- `tests/registry-load.test.ts`: `expect(r.commands().length).toBe(28);`
- `tests/contract.test.ts:` `expect(body).toHaveLength(28);`
- `docs/ops.md:354`: `27` → `28`

`tests/config.test.ts` needs **no** change (the module list is unchanged — `/season` lives in the existing `daily` module) and neither does `AUTOCOMPLETE_OPTIONS` (`/season` has no options at all).

- [ ] **Step 5: Run and verify it passes**

Run: `npx vitest run tests/season-command.test.ts tests/registry-load.test.ts tests/contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation check**

Delete the `offered !== seasonIndexFor(ctx.now())` clause: the stale-index test must go RED. Restore. Delete the `Number.isInteger` clause: the non-numeric test must go RED (`Number('abc')` is `NaN`, and `NaN !== index` is already true — so confirm which clause actually catches it and keep both, since the integer check is what stops `'689.5'`).

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/daily/index.ts tests/season-command.test.ts tests/registry-load.test.ts tests/contract.test.ts docs/ops.md
git commit -m "Add the /season command and its season-scoped claim button"
```

---

## Task 10: The park-card badge

**Files:**
- Modify: `src/modules/park/embeds.ts`, `src/modules/park/index.ts`, `src/modules/park/visit.ts`
- Test: `tests/park.test.ts`

**Interfaces:**
- Consumes: `seasonBadges` (Task 7).
- Produces: a `seasonBadges?: { count: number; latest: number | null }` entry on `dashboardPayload`'s `opts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/park.test.ts`, following the shown/omitted triad and the own/other wiring pair already used for the achievements badge:

```ts
describe('season badge on the park card', () => {
  it('shows the count and the latest season number', () => {
    const json = dashboardPayload(user, [], 0, 0, 0, {
      seasonBadges: { count: 2, latest: 690 },
    }).embeds[0].toJSON();
    const field = json.fields!.find((f) => f.name === '🎖️ Seasons')!;
    expect(field.value).toContain('2');
    expect(field.value).toContain('Season 2');   // 690 - SEASON_EPOCH + 1
    expect(field.inline).toBe(true);
  });

  it('is omitted at zero badges', () => {
    const json = dashboardPayload(user, [], 0, 0, 0, {
      seasonBadges: { count: 0, latest: null },
    }).embeds[0].toJSON();
    expect(json.fields!.map((f) => f.name)).not.toContain('🎖️ Seasons');
  });

  it('is omitted when the opt is unset', () => {
    const json = dashboardPayload(user, [], 0, 0, 0, {}).embeds[0].toJSON();
    expect(json.fields!.map((f) => f.name)).not.toContain('🎖️ Seasons');
  });
});
```

Then the wiring pair — own park and another player's — modelled on the achievements pair at `tests/park.test.ts:265-291`:

```ts
describe('season badge wiring', () => {
  it('/park view shows the viewer’s own badges', async () => {
    ctx.setNow(689 * 30 * 86_400_000);
    getOrCreateUser(ctx, 'u1', 'U1');
    rollSeason(ctx, 'u1');
    ctx.db.update(schema.seasonProgress).set({ badgeAt: ctx.now() })
      .where(eq(schema.seasonProgress.userId, 'u1')).run();
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await testRegistry.findCommand('park')!.execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('🎖️ Seasons');
  });

  it('a visited park shows the TARGET’s badges, not the viewer’s', async () => {
    ctx.setNow(689 * 30 * 86_400_000);
    getOrCreateUser(ctx, 'u1', 'U1');
    getOrCreateUser(ctx, 'u2', 'U2');
    rollSeason(ctx, 'u2');
    ctx.db.update(schema.seasonProgress).set({ badgeAt: ctx.now() })
      .where(eq(schema.seasonProgress.userId, 'u2')).run();
    const payload = (await visitPayload(ctx, 'u2'))!;
    const json = payload.embeds[0].toJSON();
    expect(json.fields!.map((f) => f.name)).toContain('🎖️ Seasons');
    // And rendering another player's card must not have stamped anything for them.
    expect(ctx.db.select().from(schema.seasonProgress)
      .where(eq(schema.seasonProgress.userId, 'u1')).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/park.test.ts -t "season badge"`
Expected: FAIL — no `🎖️ Seasons` field.

- [ ] **Step 3: Implement**

In `src/modules/park/embeds.ts`, add `seasonBadges?: { count: number; latest: number | null }` to `dashboardPayload`'s `opts` type, import `SEASON_EPOCH` from `'../../core/world.js'`, and insert the field immediately after the Legacy block:

```ts
  // Inline, after Legacy. Achievements + Legacy + Featured were exactly one inline row of
  // three, so this fourth wraps Featured onto its own row — accepted, since the
  // income-capped case already breaks that row with a full-width field.
  if (opts.seasonBadges && opts.seasonBadges.count > 0) {
    const { count, latest } = opts.seasonBadges;
    embed.addFields({
      name: '🎖️ Seasons',
      value: `${count} badge${count === 1 ? '' : 's'}${latest === null ? '' : ` · latest Season ${latest - SEASON_EPOCH + 1}`}`,
      inline: true,
    });
  }
```

In `src/modules/park/index.ts`, at the `/park view` call site that assembles `dashboardPayload`'s opts, add `seasonBadges: seasonBadges(ctx, i.user.id),`.

In `src/modules/park/visit.ts`, add `seasonBadges: seasonBadges(ctx, targetUserId),` to the opts object — importing from `'../daily/season.js'`. This is a pure read, exactly like the neighbouring `earnedTierCount(ctx, targetUserId)`.

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/park.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

In `visit.ts`, change `seasonBadges(ctx, targetUserId)` to `seasonBadges(ctx, i.user.id)`-equivalent (the viewer): the other-player test must go RED. Restore. Drop the `count > 0` guard: the omitted-at-zero test must go RED. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/embeds.ts src/modules/park/index.ts src/modules/park/visit.ts tests/park.test.ts
git commit -m "Show earned season badges on the park card"
```

---

## Task 11: `/top season`

**Files:**
- Modify: `src/modules/leaderboards/service.ts`, `src/modules/leaderboards/index.ts`
- Modify: `tests/leaderboards.test.ts`
- Modify: `src/modules/help/index.ts:70`, `docs/commands.md:123`, `docs/gameplay.md:907`

**Interfaces:**
- Consumes: `SEASON_SOURCES`, `sourcePoints` (Task 3); `seasonIndexFor` (Task 1).
- Produces: `Metric` gains `'season'`; `seasonScores(ctx: Ctx, userIds?: string[]): Map<string, number>`.

Query cost target: **3 global / 4 server / 1 zero-member**.

- [ ] **Step 1: Write the failing tests**

In `tests/leaderboards.test.ts`, widen the three `it.each` tables and the helper unions, and extend the choice test:

```ts
  // Both helpers' metric unions gain 'season' — tsconfig.test.json is the only gate that
  // sees these, so `npm run typecheck` is required after this edit.
  const cost = (size: number, metric: 'cash' | 'collection' | 'legacy' | 'stars' | 'duels' | 'season') => {
    const board = boardOf(size);
    topPlayers(board.ctx, metric, 'global', null);
    return board.queries();
  };

  it.each([
    ['cash', 1],
    ['duels', 1],
    ['stars', 2],
    ['collection', 2],
    ['legacy', 4],
    ['season', 3],        // + season_progress, user_stats
  ] as const)('costs a fixed %s queries whatever the roster size', (metric, expected) => {
    expect(cost(3, metric)).toBe(expected);
    expect(cost(30, metric)).toBe(expected);
  });
```

The `serverCost` helper's union gains `'season'` the same way, its table gains `['season', 4]` (`+ user_guilds`), and the zero-member table gains `['season', 1]` (`user_guilds` only — both season reads must short-circuit on `[]`).

`boardOf` seeds no `season_progress` rows, so a season board scores every player 0 there. That is fine for a *cost* table — `seasonScores` issues its two reads either way — but it is exactly why the correctness test below is not optional.

Update the choice test:

```ts
  it('offers exactly the seven metrics the service knows', () => {
    const json = leaderboardsModule.commands[0].data.toJSON() as {
      options?: Array<{ name: string; choices?: Array<{ value: string }> }>;
    };
    const metric = json.options!.find((o) => o.name === 'metric')!;
    expect(metric.choices!.map((c) => c.value))
      .toEqual(['rating', 'cash', 'collection', 'legacy', 'stars', 'duels', 'season']);
  });
```

And add a correctness test — the cost tables alone would pass against a metric that returns 0 for everyone:

```ts
  it('ranks live season points, agreeing with the /season hub', () => {
    const base = makeCtx();
    base.setNow(689 * 30 * 86_400_000);
    for (const id of ['a', 'b']) getOrCreateUser(base, id, id.toUpperCase());
    rollSeason(base, 'a'); rollSeason(base, 'b');
    track(base, 'a', 'expeditions_claimed', 10);   // 50
    track(base, 'b', 'expeditions_claimed', 4);    // 20
    const rows = topPlayers(base, 'season', 'global', null);
    expect(rows.map((r) => [r.userId, r.value])).toEqual([['a', 50], ['b', 20]]);
    expect(rows[0].value).toBe(seasonPoints(base, 'a'));
  });
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/leaderboards.test.ts`
Expected: FAIL — `'season'` is not assignable to `Metric`; the choice test fails on six values.

- [ ] **Step 3: Implement**

In `src/modules/leaderboards/service.ts`:

```ts
export type Metric = 'rating' | 'cash' | 'collection' | 'legacy' | 'stars' | 'duels' | 'season';
```

Add the batched builder, following the existing triple-branch idiom exactly:

```ts
/**
 * Live season points, the board-wide twin of seasonPoints — deliberately live, never the
 * badge high-water. The board answers "who is ahead right now"; the park card answers
 * "what have you ever earned". Same split legacyScores draws against legacyRankBest.
 *
 * Two reads, both batched: season_progress scoped to the CURRENT season index (rows are
 * retained per season, so an unfiltered read would return a player's whole history and
 * pick an arbitrary baseline), and user_stats once for the whole board — the per-stat
 * filter is a JS predicate, not a second query.
 *
 * A player with no row for this season scores 0 and is NOT rolled here: minting a baseline
 * from a read path would be one write per candidate on every /top render.
 */
export function seasonScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const index = seasonIndexFor(ctx.now());
  const progressRows = userIds === undefined
    ? ctx.db.select().from(schema.seasonProgress)
        .where(eq(schema.seasonProgress.seasonIndex, index)).all()
    : userIds.length
      ? ctx.db.select().from(schema.seasonProgress)
          .where(and(eq(schema.seasonProgress.seasonIndex, index),
                     inArray(schema.seasonProgress.userId, userIds))).all()
      : [];
  const statRows = userIds === undefined
    ? ctx.db.select().from(schema.userStats).all()
    : userIds.length
      ? ctx.db.select().from(schema.userStats).where(inArray(schema.userStats.userId, userIds)).all()
      : [];
  const byUserStats = new Map<string, Record<string, number>>();
  for (const r of statRows) {
    let m = byUserStats.get(r.userId);
    if (!m) { m = {}; byUserStats.set(r.userId, m); }
    m[r.stat] = r.value;
  }
  const out = new Map<string, number>();
  for (const row of progressRows) {
    const stats = byUserStats.get(row.userId) ?? {};
    const deltas: Record<string, number> = {};
    for (const [stat, base] of Object.entries(row.baselines)) {
      deltas[stat] = Math.max(0, (stats[stat] ?? 0) - base);
    }
    const points = row.headStart
      + SEASON_SOURCES.reduce((s, src) => s + sourcePoints(src, deltas), 0);
    out.set(row.userId, points);
  }
  return out;
}
```

Add `and` to the drizzle import, plus imports of `seasonIndexFor` and `SEASON_SOURCES`/`sourcePoints`.

Wire **both** ternary chains in `scored()` — adding to only the second dereferences `byUser!` as null, and neither the compiler nor `npm test` catches it:

```ts
  const byUser = metric === 'collection' ? collectionScores(ctx, memberIds)
    : metric === 'legacy' ? legacyScores(ctx, memberIds)
    : metric === 'stars' ? starScores(ctx, memberIds)
    : metric === 'season' ? seasonScores(ctx, memberIds)
    : null;
```

The `value` chain needs no new arm — `season` falls through to `byUser!.get(...) ?? 0`.

In `src/modules/leaderboards/index.ts`, add `season: '🎖️ Season'` to `metricLabel` and `{ name: 'season', value: 'season' }` as the seventh choice.

- [ ] **Step 4: Update the docs strings**

- `src/modules/help/index.ts:70`: add `|season` to the metric list.
- `docs/commands.md:123`: add "or season points" to the `/top` row.
- `docs/gameplay.md:907`: "six metrics" → "seven metrics", and name `season`.

- [ ] **Step 5: Run and verify it passes**

Run: `npx vitest run tests/leaderboards.test.ts tests/help.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation check**

Change the `season_progress` read to drop the `seasonIndex` filter: the cost test still passes (still one query) but the correctness test must go RED once a second season's row exists — add that case if it does not fail, then restore. Remove the `userIds.length ? … : []` short-circuit from either read: the zero-member test must go RED. Restore.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/leaderboards/ tests/leaderboards.test.ts src/modules/help/index.ts docs/commands.md docs/gameplay.md
git commit -m "Rank live season points as a seventh /top metric"
```

---

## Task 12: The season-ending nudge

**Files:**
- Modify: `src/modules/park/alert-record.ts`, `src/modules/park/alert-sweep.ts`, `src/modules/park/alert-embeds.ts`
- Test: `tests/alert-sweep.test.ts`

**Interfaces:**
- Consumes: `seasonView` (Task 5); `alreadySent` / `recordSent` (existing).
- Produces: `AlertKind` gains `'season_end'`; `seasonEndAlertFor(view: SeasonView | null, now: number): { endsAt: number; unclaimed: number } | null`.

`firedForMs` is the **season's end instant**, so exactly one DM per season however many sweeps run inside the window.

- [ ] **Step 1: Write the failing test**

Append to `tests/alert-sweep.test.ts`, reusing that file's real helpers: `capture()` (returns `{ dms, sender }`), `timer(firesAt)`, and `alertSweepHandler(sender, ctx)`.

Do **not** reuse `seedAtRiskPlayer` here — it deliberately seeds a dino that escapes, so it would fire escape alerts alongside the season one and muddy the count. Seed a lot with no dino instead: the sweep's `if (lots.length === 0) continue;` guard passes, while `escapeAlertsFor` and `incomeCapAlertFor` both come back empty.

```ts
describe('season-ending nudge', () => {
  const DAY = 86_400_000;
  const S1 = 689 * 30 * DAY;

  // A park with a lot and no dinos: clears the sweep's lots guard, trips neither of the
  // two existing detectors, so the only alert that can fire here is the season one.
  function seedQuietPark(ctx: ReturnType<typeof makeCtx>, id = 'u1') {
    ctx.db.insert(schema.users).values({ discordId: id, lastCollectAt: 0, createdAt: 0 }).run();
    ctx.db.insert(schema.lots)
      .values({ userId: id, type: 'paddock', kind: 'herbivore_paddock', name: 'p' }).run();
  }

  const sweep = async (ctx: ReturnType<typeof makeCtx>, sender: Sender) =>
    alertSweepHandler(sender, ctx)(timer(ctx.now()));

  it('fires once in the final window for a player holding unclaimed rungs', async () => {
    const ctx = makeCtx(); ctx.setNow(S1);
    const { dms, sender } = capture();
    seedQuietPark(ctx);
    rollSeason(ctx, 'u1');
    track(ctx, 'u1', 'expeditions_claimed', 10);   // 50 = rung 1, unclaimed
    ctx.setNow(S1 + 28 * DAY);                     // 2 days left
    await sweep(ctx, sender);
    expect(dms).toHaveLength(1);
    expect(JSON.stringify(dms[0].payload)).toContain('Season');
    // A second sweep inside the same window must not re-send: firedForMs is the season's
    // END instant, not `now`.
    await sweep(ctx, sender);
    expect(dms).toHaveLength(1);
  });

  it('does not fire when nothing is claimable', async () => {
    const ctx = makeCtx(); ctx.setNow(S1);
    const { dms, sender } = capture();
    seedQuietPark(ctx);
    rollSeason(ctx, 'u1');
    ctx.setNow(S1 + 28 * DAY);
    await sweep(ctx, sender);
    expect(dms).toHaveLength(0);
  });

  it('does not fire outside the final window', async () => {
    const ctx = makeCtx(); ctx.setNow(S1);
    const { dms, sender } = capture();
    seedQuietPark(ctx);
    rollSeason(ctx, 'u1');
    track(ctx, 'u1', 'expeditions_claimed', 10);
    ctx.setNow(S1 + 10 * DAY);                     // 20 days left
    await sweep(ctx, sender);
    expect(dms).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/alert-sweep.test.ts -t "season-ending"`
Expected: FAIL — no season message is ever sent.

- [ ] **Step 3: Implement**

In `alert-record.ts`, widen the kind and add the window constant:

```ts
export type AlertKind = 'escape' | 'income_cap' | 'season_end';

/** How long before a season ends the nudge may fire. */
export const SEASON_END_WARN_MS = 3 * 86_400_000;
```

Add the detector — put it in `alert-detect.ts` alongside the two existing predicates:

```ts
/** A nudge is owed iff the season ends within SEASON_END_WARN_MS and at least one
 *  unlocked rung is still unclaimed. Cash forfeits at rollover; this is the warning. */
export function seasonEndAlertFor(
  view: SeasonView | null, now: number,
): { endsAt: number; unclaimed: number } | null {
  if (!view) return null;
  const endsAt = now + view.daysLeft * 86_400_000;
  if (endsAt - now > SEASON_END_WARN_MS) return null;
  const unclaimed = view.rungs.filter((r) => r.unlocked && !r.claimed).length;
  return unclaimed > 0 ? { endsAt, unclaimed } : null;
}
```

In `alert-sweep.ts`, inside the per-user `try`, after the income-cap block:

```ts
        const seasonEnd = seasonEndAlertFor(seasonView(ctx, u.discordId), now);
        // firedForMs is the season's END instant, not `now` — so however many sweeps run
        // inside the window, exactly one DM goes out per season.
        const season = seasonEnd && !alreadySent(ctx, u.discordId, 'season_end', 0, '', seasonEnd.endsAt)
          ? seasonEnd : null;
```

Extend the `if (escapes.length === 0 && !income) continue;` guard to `&& !season`, pass `season` into `alertPayload`, and record it after the send:

```ts
        if (season) recordSent(ctx, u.discordId, 'season_end', 0, '', season.endsAt);
```

In `alert-embeds.ts`, add a `season` parameter and render a line when present — e.g. `🎖️ Season ends in ${days}d — ${unclaimed} reward(s) unclaimed. **/season** to claim.` Keep the existing rule: this payload must **not** carry an `attachments` key.

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/alert-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Change `firedForMs` from `seasonEnd.endsAt` to `now`: the fire-once test must go RED (a second sweep re-sends). Restore. Drop the `unclaimed > 0` check: the nothing-claimable test must go RED. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/alert-record.ts src/modules/park/alert-detect.ts src/modules/park/alert-sweep.ts src/modules/park/alert-embeds.ts tests/alert-sweep.test.ts
git commit -m "Warn once before a season ends with rewards unclaimed"
```

---

## Task 13: The rung-unlocked hint

**Files:**
- Modify: `src/modules/daily/hooks.ts`
- Test: `tests/season-hooks.test.ts`

**Interfaces:**
- Consumes: `seasonView`, `stampSeasonBadge` (Tasks 5, 7).

The hint joins the **existing single combined followUp** — never a second one.

- [ ] **Step 1: Write the failing test**

**Harness fact this test depends on:** `fakeCommand`'s fake pushes `followUp` payloads into the SAME `replies` array as `reply`/`editReply` — there is no `followUps` accessor. So "exactly one followUp" is asserted as `replies.length === 2` (the command's own reply, then the hint), and the hint is `replies[1]`.

Create `tests/season-hooks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand, testRegistry } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { rollSeason } from '../src/modules/daily/season.js';
import { dailyRouterHooks } from '../src/modules/daily/hooks.js';
import { SEASON_DAYS } from '../src/core/world.js';

const DAY = 86_400_000;
const S1 = 689 * SEASON_DAYS * DAY;

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(S1); getOrCreateUser(ctx, 'p', 'P'); });

// Run a command through its handler, then the postDispatch hook, exactly as
// routeInteraction does.
async function dispatch(name: string) {
  const i = fakeCommand({ name, user: 'p' });
  await testRegistry.findCommand(name)!.execute(ctx, i.asChatInput());
  await dailyRouterHooks.postDispatch!(ctx, i.asChatInput(), { command: name });
  return i;
}

describe('season rung hint', () => {
  it('hints once when a rung is unlocked and unclaimed', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    const i = await dispatch('world');
    expect(i.replies).toHaveLength(2);
    expect(JSON.stringify(i.replies[1])).toContain('/season');
  });

  it('does not hint about the screen the player is already reading', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);
    const i = await dispatch('season');
    expect(i.replies).toHaveLength(1);
  });

  it('does not hint when nothing is unlocked', async () => {
    rollSeason(ctx, 'p');
    const i = await dispatch('world');
    expect(i.replies).toHaveLength(1);
  });

  it('does not hint again once the rung is claimed', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);
    claimSeason(ctx, 'p');
    const i = await dispatch('world');
    expect(i.replies).toHaveLength(1);
  });

  // The anti-fatigue rule: a quest and a rung completing on one action share ONE followUp.
  it('combines a quest hint and a rung hint into a single followUp', async () => {
    rollSeason(ctx, 'p');
    rollDailyQuests(ctx, 'p');
    // Complete whichever quest the deterministic board rolled, by pushing its stat past
    // baseline + target, and unlock a season rung with the same counter movement.
    const board = questProgress(ctx, 'p');
    for (const v of board) track(ctx, 'p', v.def.stat, v.row.target + 1);
    track(ctx, 'p', 'expeditions_claimed', 10);
    const i = await dispatch('world');
    expect(i.replies).toHaveLength(2);
    const hint = JSON.stringify(i.replies[1]);
    expect(hint).toContain('/daily');
    expect(hint).toContain('/season');
  });
});
```

Add `claimSeason` to the season import and `rollDailyQuests, questProgress` from `../src/modules/daily/service.js`.

Note: `/world` is used as the non-exempt carrier command because it takes no options and creates no state. If it turns out to be exempt or unavailable, any non-exempt command with no required options works.

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/season-hooks.test.ts`
Expected: FAIL — no season text in the followUp.

- [ ] **Step 3: Implement**

In `hooks.ts`, track the season rung state alongside the quest state and build ONE message. Persist "already hinted" in the same style the quest hint uses (`notifiedAt`) — for seasons, hint on the highest unlocked-unclaimed rung only, and suppress it once `season_claims` holds that rung.

```ts
    const crossedQuests = questProgress(ctx, i.user.id)
      .filter((v) => v.complete && v.row.claimedAt === null && v.row.notifiedAt === null);
    const view = seasonView(ctx, i.user.id);
    const rungReady = view ? view.rungs.some((r) => r.unlocked && !r.claimed) : false;
    if (!crossedQuests.length && !rungReady) return;
    const lines: string[] = [];
    if (crossedQuests.length) lines.push('🎯 Quest complete — **/daily** to claim!');
    if (rungReady) lines.push('🎖️ Season reward ready — **/season** to claim!');
    await i.followUp({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
```

Keep the `notifiedAt` stamping loop AFTER the await, exactly as today.

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/season-hooks.test.ts tests/daily*.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Split the two lines into two `followUp` calls: the "never a second" test must go RED. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/daily/hooks.ts tests/season-hooks.test.ts
git commit -m "Fold the season rung hint into the existing dispatch followUp"
```

---

## Task 14: Admin coverage

**Files:**
- Modify: `src/modules/admin/service.ts`
- Test: `tests/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/admin.test.ts`, modelled on the existing daily-loop reset test:

```ts
it('wipes every season row and claim, including past seasons, and leaves other users alone', () => {
  ctx.setNow(689 * 30 * 86_400_000);
  getOrCreateUser(ctx, 'p', 'P');
  getOrCreateUser(ctx, 'other', 'O');
  for (const uid of ['p', 'other']) {
    ctx.db.insert(schema.seasonProgress)
      .values({ userId: uid, seasonIndex: 688, baselines: {}, headStart: 0, badgeAt: 1, createdAt: 0 }).run();
    ctx.db.insert(schema.seasonProgress)
      .values({ userId: uid, seasonIndex: 689, baselines: {}, headStart: 0, createdAt: 0 }).run();
    ctx.db.insert(schema.seasonClaims)
      .values({ userId: uid, seasonIndex: 689, rung: 0, claimedAt: 0 }).run();
  }
  adminReset(ctx, 'p');
  expect(ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, 'p')).all()).toHaveLength(0);
  expect(ctx.db.select().from(schema.seasonClaims)
    .where(eq(schema.seasonClaims.userId, 'p')).all()).toHaveLength(0);
  expect(ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, 'other')).all()).toHaveLength(2);
});

it('adminFastForward leaves season rows untouched — it cannot move the UTC calendar', () => {
  ctx.setNow(689 * 30 * 86_400_000);
  getOrCreateUser(ctx, 'p', 'P');
  rollSeason(ctx, 'p');
  const before = ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, 'p')).get()!;
  adminFastForward(ctx, 'p', 48);
  const after = ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, 'p')).get()!;
  expect(after.seasonIndex).toBe(before.seasonIndex);
  expect(after.createdAt).toBe(before.createdAt);
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run tests/admin.test.ts -t season`
Expected: FAIL — the reset test finds surviving rows.

- [ ] **Step 3: Implement**

In `adminReset`, after the `achievementClaims` delete:

```ts
    // Same rule again, and it bites harder here: these tables span EVERY season, not just
    // the current one, so a scoped delete would leave a wiped account holding badges. That
    // destroys the badge collection, which is the correct reading of a reset and is worth
    // stating out loud — badgeAt is otherwise the one value in this feature nothing else
    // can ever clear.
    ctx.db.delete(schema.seasonProgress).where(eq(schema.seasonProgress.userId, targetId)).run();
    ctx.db.delete(schema.seasonClaims).where(eq(schema.seasonClaims.userId, targetId)).run();
```

Add a comment in `adminFastForward` next to the `daily_quests.dayKey` note:

```ts
    // season_progress/season_claims are deliberately NOT touched, for the same reason:
    // seasonIndex derives from the UTC calendar, which fast-forward cannot move. There is
    // no season streak, so there is no claim anchor worth shifting either.
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Scope the `seasonProgress` delete to the current season index only: the past-season assertion must go RED. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/admin/service.ts tests/admin.test.ts
git commit -m "Cover the season tables in admin reset"
```

---

## Task 15: The balance gate

**Files:**
- Create: `tests/season-balance.test.ts`

This is the task that converts the spec's judgement calls into machine gates. It is pure arithmetic over `SEASON_SOURCES`/`SEASON_RUNGS` — no DB, no `Ctx`.

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
import { SEASON_SOURCES, SEASON_RUNGS, SEASON_CAPSTONE, sourcePoints } from '../src/data/seasons.js';
import type { StatId } from '../src/core/stats.js';

// The MODERATE PROFILE: the low end of each source's measured daily band, over 30 days.
// Commerce scores ZERO on purpose — a player who neither trades nor shops must still
// clear the capstone, so the profile that sizes the rungs assumes they do not.
const MODERATE_PER_DAY: Partial<Record<StatId, number>> = {
  battles_fought: 30,
  expeditions_claimed: 1.5,
  eggs_hatched: 2,
  breedings_claimed: 1,
  dinos_fed: 10,
  dinos_sold: 1,
  splices_done: 0.5,
  income_collections: 2,
};

function pointsAfter(days: number, exclude: string[] = []): number {
  const deltas: Partial<Record<StatId, number>> = {};
  for (const [stat, perDay] of Object.entries(MODERATE_PER_DAY)) {
    deltas[stat as StatId] = Math.floor(perDay * days);
  }
  return SEASON_SOURCES
    .filter((s) => !exclude.includes(s.id))
    .reduce((sum, src) => sum + sourcePoints(src, deltas), 0);
}

describe('season balance', () => {
  it('the moderate profile clears the capstone inside 30 days', () => {
    expect(pointsAfter(30)).toBeGreaterThanOrEqual(SEASON_CAPSTONE);
    // …with real slack, not by a single point.
    const day = [...Array(31).keys()].find((d) => pointsAfter(d) >= SEASON_CAPSTONE)!;
    expect(day).toBeLessThanOrEqual(23);
  });

  // The Gene Lab gate, made falsifiable. 270 points sit behind a 20,000-cash lot; a
  // lab-less player must still clear the season, and any retune that pushes them past
  // day 30 fails HERE rather than in a player's inbox.
  it('a lab-less moderate profile still clears inside 30 days', () => {
    const day = [...Array(31).keys()].find((d) => pointsAfter(d, ['genelab', 'splicing']) >= SEASON_CAPSTONE);
    expect(day, 'a Gene-Lab-less player can no longer clear the season').toBeDefined();
    expect(day!).toBeLessThanOrEqual(30);
  });

  // THE GUARD ON THE UNGATED SOURCES. Five sources have no real-time gate at all, so a
  // determined player can bank all of them on day one. That total must stay below the
  // fifth rung — if any of those five caps is ever raised, this is what breaks first.
  it('the day-1 bankable pool stays below the fifth rung', () => {
    const UNGATED = ['care', 'sales', 'splicing', 'commerce', 'collections'];
    const pool = SEASON_SOURCES.filter((s) => UNGATED.includes(s.id))
      .reduce((sum, s) => sum + s.cap, 0);
    expect(pool).toBe(430);
    expect(pool).toBeLessThan(SEASON_RUNGS[4].points);
    expect(pool / SEASON_CAPSTONE).toBeLessThan(0.55);
  });

  it('a 10-day lapsed player lands mid-ladder', () => {
    const p = pointsAfter(10);
    expect(p).toBeGreaterThanOrEqual(SEASON_RUNGS[3].points);
    expect(p).toBeLessThan(SEASON_RUNGS[5].points);
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run tests/season-balance.test.ts`
Expected: PASS. **If any assertion fails, do not edit the test to match** — report the real numbers. The plan's day figures (21.4 / 27.3) are hypotheses; these bounds (≤23, ≤30) carry deliberate slack around them, and a miss outside that slack means the ladder in Task 3 needs re-tuning, not the gate.

- [ ] **Step 3: Mutation check**

Raise `care`'s cap from 120 to 200 in `seasons.ts`: the day-1 pool test must go RED. Restore. Raise the `genelab` cap to 400: the lab-less test must still pass (it excludes that source) but the moderate-profile slack test should tighten — confirm which assertions move and which do not.

- [ ] **Step 4: Commit**

```bash
git add tests/season-balance.test.ts
git commit -m "Pin the season profiles and the ungated-source ceiling"
```

---

## Task 16: Docs, the comment audit, and the live gallery

**Files:**
- Modify: `docs/gameplay.md`, `CLAUDE.md`, `src/modules/help/index.ts`, `scripts/test-live.ts`

- [ ] **Step 1: Write the gameplay docs**

Add a **Seasons** section to `docs/gameplay.md` covering: the 30-day cycle and its numbering; that points are earned from nine capped sources; the per-source cap and why it exists; that unclaimed rungs forfeit at rollover **and the badge does not**; the veteran head start on a player's first season.

- [ ] **Step 2: Add the help topic line**

`HELP_TOPICS` in `src/modules/help/index.ts` — add `/season` to the relevant topic body. Note: adding a new topic **key** changes the `/help` builder and forces `deploy-commands`; adding a line to an existing body does not. Prefer the latter.

- [ ] **Step 3: Update CLAUDE.md**

Add a bullet recording, at minimum: seasons are no longer cosmetic but still carry no modifiers; `SEASON_EPOCH` is a written literal that must never move; `season_progress` rows are retained rather than swept and why; the badge is stamped from `postDispatch`, never a read path; and the day-1 bankable pool of 430 as the guard on the five ungated sources.

- [ ] **Step 4: Add the gallery case**

In `scripts/test-live.ts`, add a case that seeds a player mid-season with a couple of rungs unlocked and posts `seasonPayload`, plus one with a badge on the park card. The gallery is a hand-curated case list — shipping a feature adds no case automatically. Sweep goes 59 → 61.

- [ ] **Step 5: Full verification**

```bash
npm test
npm run typecheck
npm run build
```
Expected: all green, test count up by roughly 55-65 from 1631.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md src/modules/help/index.ts scripts/test-live.ts
git commit -m "Document the season track and cover it in the live gallery"
```

---

## Operator steps (after merge, in this order)

1. Back up the live DB with better-sqlite3's **online** `db.backup()`, not a file copy — the WAL is live. Verify table count and row counts against the running DB.
2. `npm run build`.
3. Restart the bot — **exactly one instance per token**. Migration 0015 applies on boot. Confirm the startup log.
4. `npm run deploy-commands` — reports **28** commands.
5. `npm run test:live` — expect **61 ok / 0 failed**.

No emoji work: the badge uses a unicode glyph, so `deploy-emojis` is not run and `assets/emojis/manifest.json` must not be touched.

---

## Self-review notes

Spec coverage checked section by section: §2 identity → Task 1; §3 data model → Tasks 2, 4; §4 measured economy → Task 15 (as assertions) and Task 3 (as comments); §5 sources → Task 3; §6 rungs → Task 3, 6; §7 head start → Task 4; §8 surfaces → Tasks 8-12; §9 rollover and badge → Tasks 6, 7; §10 tests → Tasks 3, 15 and each task's own cases; §11 docs → Tasks 11, 16; §12 out-of-scope → nothing implements them; §13 accepted risks → Task 15 pins the two that are checkable; §14 operator steps → above.

Three things checked during review and corrected in place, recorded so they are not re-derived:

- **The harness has no `followUps` accessor.** `fakeCommand`'s fake pushes `followUp` payloads into the same `replies` array as `reply`/`editReply` (`tests/harness.ts:153-157`). Task 13 asserts `replies.length === 2` and reads the hint from `replies[1]`.
- **Task 12 must not reuse `seedAtRiskPlayer`.** That fixture deliberately seeds a dino that escapes, so it fires escape alerts alongside the season one. The task seeds a lot with no dino instead, which clears the sweep's `lots.length === 0` guard while tripping neither existing detector.
- **`Number('')` is `0`, an integer.** In Task 9 the empty-segment case is rejected by the season comparison, not by `Number.isInteger`; `'689.5'` is what `Number.isInteger` alone catches. Both clauses are load-bearing and the test covers both.

One genuine open question, left for the implementer rather than guessed: **Task 13 uses `/world` as its non-exempt carrier command.** It takes no options and creates no state, which is what the test needs, but the exemption list was not re-read at plan time. If `/world` turns out to be exempt, substitute any non-exempt command with no required options.
