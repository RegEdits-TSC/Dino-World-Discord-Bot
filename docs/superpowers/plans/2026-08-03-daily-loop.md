# Daily Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily quest board, claim streak with personal-best milestone chests, and lifetime achievements, all reading one new stat-tracking substrate.

**Architecture:** A `user_stats` lifetime-counter table incremented only via `track()` (`src/core/stats.ts`) inside each action's existing transaction. Quest progress and achievement tiers are derived at read (`current − baseline` / `value ≥ threshold`), never stored. A new `daily` module owns `/daily` + `/achievements`; `routeInteraction` gains optional pre/post-dispatch hooks that the daily module supplies and `src/index.ts` wires.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js v14, better-sqlite3 + drizzle (synchronous), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-03-daily-loop-design.md` — the authority on every number and rule in this plan.

## Global Constraints

- Every relative import carries a `.js` extension (ESM NodeNext).
- Time from `ctx.now()`, randomness from `ctx.rng()` or a locally-seeded `mulberry32` — never `Date.now()`/`Math.random()`. `new Date(ms)` with an explicit argument is fine.
- DB access is synchronous drizzle (`.get()`/`.all()`/`.run()`), never awaited.
- Currency only via `ctx.economy.apply` — never raw balance writes.
- Embed art only via `attach(embed, payload, slot, assetImage(...))`; never hand-assign `payload.files`.
- Never call `emojiTag` in a module-level constant; never put custom emoji tags in autocomplete labels; never pass an empty-capable tag to `setEmoji`.
- `npm run typecheck` (not just `npm test`) must pass before every commit that touches `tests/` or `scripts/`.
- **Mutation check per task** (Gene Lab lesson: 7 tests passed against broken code): after the tests pass, revert the key behavior change (comment it out), re-run the new tests, confirm at least one goes RED, restore. The step is written into each task — do not skip it.
- Commit messages: plain sentence-case, no attribution trailers, no AI mentions.
- Run single test files with `npx vitest run tests/<file>.test.ts`.
- `getOrCreateUser(ctx, userId, displayName)` takes THREE arguments — displayName is required. Every test seeding a user passes it (idiom: `getOrCreateUser(ctx, 'u1', 'u1')`).
- Every task's commit step runs `npm run typecheck` first — vitest transpiles without typechecking, so a signature error in a test passes `npm test` and only typecheck catches it.

---

### Task 1: `dayKeyUTC` in core/clock

**Files:**
- Modify: `src/core/clock.ts` (append after `hungerAt`)
- Test: `tests/clock.test.ts` (append a new describe block)

**Interfaces:**
- Produces: `dayKeyUTC(ms: number): string` — `'YYYY-MM-DD'` in UTC; `DAY_MS = 86_400_000` exported constant.

- [ ] **Step 1: Write the failing tests** — append to `tests/clock.test.ts`:

```ts
import { dayKeyUTC, DAY_MS } from '../src/core/clock.js';

describe('dayKeyUTC', () => {
  it('formats an epoch ms as a UTC YYYY-MM-DD key', () => {
    expect(dayKeyUTC(0)).toBe('1970-01-01');
    expect(dayKeyUTC(Date.UTC(2026, 7, 3, 15, 30))).toBe('2026-08-03');
  });
  it('midnight instant belongs to the new day', () => {
    const midnight = Date.UTC(2026, 7, 4);
    expect(dayKeyUTC(midnight - 1)).toBe('2026-08-03');
    expect(dayKeyUTC(midnight)).toBe('2026-08-04');
  });
  it('DAY_MS steps exactly one key', () => {
    expect(dayKeyUTC(Date.UTC(2026, 7, 3, 12) + DAY_MS)).toBe('2026-08-04');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/clock.test.ts` → FAIL (`dayKeyUTC` not exported).

- [ ] **Step 3: Implement** — append to `src/core/clock.ts`:

```ts
export const DAY_MS = 86_400_000;

/** UTC calendar-day key ('YYYY-MM-DD') for an epoch-ms instant. 00:00:00.000 belongs to the new day. */
export function dayKeyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/clock.test.ts` → PASS.

- [ ] **Step 5: Mutation check** — change `slice(0, 10)` to `slice(0, 9)`, confirm RED, restore.

- [ ] **Step 6: Commit** — `git add src/core/clock.ts tests/clock.test.ts && git commit -m "Add dayKeyUTC day-key helper"`

---

### Task 2: Schema + migration 0006 with veteran backfill

**Files:**
- Modify: `src/core/db/schema.ts`
- Create: `drizzle/0006_daily_loop.sql` (generated, then hand-appended), `drizzle/meta/0006_snapshot.json` + journal entry (generated)
- Test: `tests/migration.test.ts` (extend the production-path block)

**Interfaces:**
- Produces: `schema.userStats` (`userId`, `stat`, `value`), `schema.dailyQuests` (`id`, `userId`, `dayKey`, `slot`, `questId`, `baseline`, `target`, `claimedAt`, `notifiedAt`), `schema.achievementClaims` (`userId`, `trackId`, `tier`, `claimedAt`), users columns `questStreak`, `questStreakBest`, `lastQuestClaimAt`; eggs `source` enum includes `'quest'`.

- [ ] **Step 1: Edit `src/core/db/schema.ts`.** Add `uniqueIndex` to the existing `drizzle-orm/sqlite-core` import. In `users`, after `energyUpdatedAt`, add:

```ts
  questStreak: integer('quest_streak').notNull().default(0),
  questStreakBest: integer('quest_streak_best').notNull().default(0),
  lastQuestClaimAt: integer('last_quest_claim_at_ms').notNull().default(0),
```

In `eggs.source`, widen the enum array to `['expedition', 'shop', 'trade', 'admin', 'battle', 'breeding', 'quest']`. Append three tables at the end of the file:

```ts
export const userStats = sqliteTable('user_stats', {
  userId: text('user_id').notNull().references(() => users.discordId),
  stat: text('stat').notNull(),
  value: integer('value').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.userId, t.stat] }),
  check('stat_value_nonneg', sql`${t.value} >= 0`),
]);

export const dailyQuests = sqliteTable('daily_quests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  dayKey: text('day_key').notNull(),
  slot: integer('slot').notNull(),
  questId: text('quest_id').notNull(),
  baseline: integer('baseline').notNull(),
  target: integer('target').notNull(),
  claimedAt: integer('claimed_at_ms'),
  notifiedAt: integer('notified_at_ms'),
}, (t) => [uniqueIndex('daily_quests_user_day_slot').on(t.userId, t.dayKey, t.slot)]);

export const achievementClaims = sqliteTable('achievement_claims', {
  userId: text('user_id').notNull().references(() => users.discordId),
  trackId: text('track_id').notNull(),
  tier: integer('tier').notNull(),
  claimedAt: integer('claimed_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.trackId, t.tier] })]);
```

- [ ] **Step 2: Generate the migration** — `npx drizzle-kit generate --name daily_loop`. Verify it emitted `drizzle/0006_daily_loop.sql` (three CREATE TABLE + one CREATE UNIQUE INDEX for `daily_quests_user_day_slot` + three ALTER TABLE ADD COLUMN, **no** table recreate — additive columns only), `drizzle/meta/0006_snapshot.json`, and a new `_journal.json` entry. Never hand-edit the journal or snapshot.

- [ ] **Step 3: Hand-append the backfill** to the END of `drizzle/0006_daily_loop.sql` (the 0001 precedent — DDL stays exactly as generated):

```sql
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'stages_first_cleared', COUNT(*) FROM battle_progress
WHERE first_cleared_at_ms IS NOT NULL GROUP BY user_id;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'lots_built', COUNT(*) FROM lots GROUP BY user_id;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT u, 'trades_completed', SUM(c) FROM (
  SELECT from_user AS u, COUNT(*) AS c FROM trades WHERE status = 'accepted' GROUP BY from_user
  UNION ALL
  SELECT to_user AS u, COUNT(*) AS c FROM trades WHERE status = 'accepted' GROUP BY to_user
) GROUP BY u;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'breedings_started', COUNT(*) FROM breedings GROUP BY user_id;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'breedings_claimed', COUNT(*) FROM breedings
WHERE claimed_at_ms IS NOT NULL GROUP BY user_id;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'expeditions_claimed', COUNT(*) FROM expeditions
WHERE claimed_at_ms IS NOT NULL GROUP BY user_id;
```

- [ ] **Step 4: Write the failing test.** In `tests/migration.test.ts`, add a NEW describe — `0006 daily loop via the real drizzle migrator (production path)` — copying the 0005 block's scaffold exactly (scratch folder containing migrations 0000–0005, `_journal.json` entries filtered to `idx <= 5`, raw `migrate()` to apply them, then the real `migrateDb`). Note the scaffold's variable naming: the raw better-sqlite3 handle is `sqlite`, the drizzle wrapper is `db` — raw SQL goes through `sqlite.prepare`. Before running `migrateDb`, seed with raw SQL two users `'vet'` AND `'other'` (both users rows must exist — trades carries FKs to both sides), two `battle_progress` rows for `'vet'` with `first_cleared_at_ms` set and one with NULL, three `lots` rows, one accepted + one pending `trades` row (`'vet'` as `from_user`, `'other'` as `to_user`), two `breedings` rows (one claimed, one pending), and two `expeditions` rows (one with `claimed_at_ms` set, one NULL). After `migrateDb`, assert:

```ts
const stats = sqlite.prepare(
  "SELECT stat, value FROM user_stats WHERE user_id = 'vet' ORDER BY stat").all() as Array<{ stat: string; value: number }>;
expect(stats).toEqual([
  { stat: 'breedings_claimed', value: 1 },
  { stat: 'breedings_started', value: 2 },
  { stat: 'expeditions_claimed', value: 1 },
  { stat: 'lots_built', value: 3 },
  { stat: 'stages_first_cleared', value: 2 },
  { stat: 'trades_completed', value: 1 },
]);
const u = sqlite.prepare("SELECT quest_streak, quest_streak_best, last_quest_claim_at_ms FROM users WHERE discord_id = 'vet'").get() as Record<string, number>;
expect(u).toEqual({ quest_streak: 0, quest_streak_best: 0, last_quest_claim_at_ms: 0 });
```

Also assert `'other'` got `{ stat: 'trades_completed', value: 1 }` (both parties credited).

- [ ] **Step 5: Run** — `npx vitest run tests/migration.test.ts` → the new assertions PASS and every pre-existing test still passes (a broken migration fails the whole suite via `makeCtx`). Run `npm test` once here — migration touches everything.

- [ ] **Step 6: Mutation check** — comment out the `stages_first_cleared` backfill INSERT in the .sql, confirm the new test goes RED, restore.

- [ ] **Step 7: Commit** — `git add src/core/db/schema.ts drizzle/ tests/migration.test.ts && git commit -m "Add the daily-loop tables, users streak columns, and veteran backfill"`

---

### Task 3: `src/core/stats.ts` — the substrate

**Files:**
- Create: `src/core/stats.ts`
- Test: `tests/stats.test.ts`

**Interfaces:**
- Produces:
  - `STATS: Record<StatId, 'count' | 'sum'>` and `type StatId` (18 keys, exactly the spec §3 catalog)
  - `track(ctx: Ctx, userId: string, stat: StatId, delta: number): void` — no-op for `delta <= 0`
  - `readStat(ctx: Ctx, userId: string, stat: StatId): number` — 0 when no row
  - `readStats(ctx: Ctx, userId: string): Partial<Record<StatId, number>>` — one query, batch

- [ ] **Step 1: Write the failing tests** — `tests/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track, readStat, readStats, STATS } from '../src/core/stats.js';

describe('stats substrate', () => {
  it('catalogs exactly the 18 spec stats with count/sum kinds', () => {
    expect(Object.keys(STATS)).toHaveLength(18);
    expect(STATS.income_collected).toBe('sum');
    expect(STATS.income_collections).toBe('count');
    expect(STATS.trades_completed).toBe('count');
  });
  it('missing row reads 0; track upserts and accumulates', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    expect(readStat(ctx, 'u1', 'eggs_hatched')).toBe(0);
    track(ctx, 'u1', 'eggs_hatched', 1);
    track(ctx, 'u1', 'eggs_hatched', 2);
    expect(readStat(ctx, 'u1', 'eggs_hatched')).toBe(3);
    expect(readStats(ctx, 'u1')).toEqual({ eggs_hatched: 3 });
  });
  it('zero or negative delta is a no-op', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    track(ctx, 'u1', 'dinos_fed', 0);
    track(ctx, 'u1', 'dinos_fed', -5);
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(0);
  });
  it('a rolled-back transaction leaves no trace', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    expect(() => ctx.db.transaction(() => {
      track(ctx, 'u1', 'dinos_fed', 1);
      throw new Error('boom');
    })).toThrow('boom');
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/stats.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/core/stats.ts`:

```ts
import { eq, and, sql } from 'drizzle-orm';
import { schema } from './db/index.js';
import type { Ctx } from './context.js';

// Lifetime action counters. 'count' stats step by 1 per event; 'sum' stats add a
// quantity. Quest targets phrased as "do X n times" may only reference count stats
// (enforced by tests/daily-content.test.ts).
export const STATS = {
  dinos_fed: 'count', eggs_hatched: 'count', eggs_incubated: 'count',
  income_collected: 'sum', income_collections: 'count',
  expeditions_claimed: 'count', battles_fought: 'count', battles_won: 'count',
  stages_first_cleared: 'count', trades_completed: 'count',
  breedings_started: 'count', breedings_claimed: 'count', splices_done: 'count',
  dinos_sold: 'count', shop_purchases: 'count', lots_built: 'count',
  lots_upgraded: 'count', dinos_rescued: 'count',
} as const satisfies Record<string, 'count' | 'sum'>;
export type StatId = keyof typeof STATS;

export function track(ctx: Ctx, userId: string, stat: StatId, delta: number): void {
  if (delta <= 0) return;
  ctx.db.insert(schema.userStats).values({ userId, stat, value: delta })
    .onConflictDoUpdate({
      target: [schema.userStats.userId, schema.userStats.stat],
      set: { value: sql`${schema.userStats.value} + ${delta}` },
    }).run();
}

export function readStat(ctx: Ctx, userId: string, stat: StatId): number {
  const row = ctx.db.select().from(schema.userStats)
    .where(and(eq(schema.userStats.userId, userId), eq(schema.userStats.stat, stat))).get();
  return row?.value ?? 0;
}

export function readStats(ctx: Ctx, userId: string): Partial<Record<StatId, number>> {
  const rows = ctx.db.select().from(schema.userStats)
    .where(eq(schema.userStats.userId, userId)).all();
  return Object.fromEntries(rows.map((r) => [r.stat, r.value]));
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/stats.test.ts` → PASS.

- [ ] **Step 5: Mutation check** — make `track` early-return unconditionally; confirm the upsert test goes RED; restore.

- [ ] **Step 6: Commit** — `git add src/core/stats.ts tests/stats.test.ts && git commit -m "Add the lifetime stat-counter substrate"`

---

### Task 4: Quest + achievement data files and the content gate

**Files:**
- Create: `src/data/quests.ts`, `src/data/achievements.ts`
- Test: `tests/daily-content.test.ts`

**Interfaces:**
- Produces (from `src/data/quests.ts`):
  - `type QuestRequirement = 'none' | 'income' | 'battles' | 'trading' | 'genelab'`
  - `interface QuestDef { id: string; stat: StatId; target: number | 'half-day-income'; rewards: { cash: number; shards?: number; food?: { foodId: FoodId; qty: number } }; description: string; requirement: QuestRequirement }`
  - `QUESTS: QuestDef[]` (exactly 17), `CHURN_STATS: StatId[]` = `['eggs_incubated', 'dinos_sold']`
  - `interface ChestDef { cash: number; shards: number; eggRarity?: 'rare' | 'epic' }`
  - `chestFor(streak: number): ChestDef | null` — 3/7/14 fixed, every 30 escalating (`shards = Math.min(100, 40 + 10 * (streak / 30 - 1))`), null otherwise
  - `nextChestAt(streak: number, best: number): number` — smallest milestone (3, 7, 14, then multiples of 30) strictly greater than BOTH `streak` and `best`; feeds the hub's "next chest at N" line (a milestone at-or-under the personal best can never pay, so it is never advertised)
- Produces (from `src/data/achievements.ts`):
  - `interface AchievementTrack { id: string; stat: StatId; name: string; tiers: [number, number, number, number] }`
  - `ACHIEVEMENTS: AchievementTrack[]` (exactly 12), `TIER_REWARDS: Array<{ cash: number; shards: number }>` = `[{cash:500,shards:0},{cash:1250,shards:0},{cash:2500,shards:5},{cash:5000,shards:20}]`, `TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum']`

- [ ] **Step 1: Write `src/data/quests.ts`.** Read `src/data/foods.ts` first and use its two tier-1 `FoodId`s (one per diet) for the two food-paying defs. The 17 defs (id, stat, target, rewards, requirement — descriptions are short player-facing strings):

| id | stat | target | rewards | req |
| --- | --- | --- | --- | --- |
| `feed_3` | `dinos_fed` | 3 | 400 cash + 4 shards | none |
| `feed_8` | `dinos_fed` | 8 | 700 cash + 7 shards | none |
| `collect_twice` | `income_collections` | 2 | 400 cash + 4 shards | income |
| `collect_cash` | `income_collected` | `'half-day-income'` | 600 cash + 6 shards | income |
| `hatch_1` | `eggs_hatched` | 1 | 300 cash + 3 shards | none |
| `hatch_3` | `eggs_hatched` | 3 | 700 cash + 7 shards | none |
| `incubate_2` | `eggs_incubated` | 2 | 400 cash + tier-1 herbivore food ×3 | none |
| `expedition_1` | `expeditions_claimed` | 1 | 350 cash + tier-1 carnivore food ×3 | none |
| `expedition_2` | `expeditions_claimed` | 2 | 650 cash + 7 shards | none |
| `fight_5` | `battles_fought` | 5 | 500 cash + 5 shards | battles |
| `win_1` | `battles_won` | 1 | 400 cash + 4 shards | battles |
| `win_3` | `battles_won` | 3 | 800 cash + 8 shards | battles |
| `trade_1` | `trades_completed` | 1 | 500 cash + 5 shards | trading |
| `breed_start` | `breedings_started` | 1 | 400 cash + 4 shards | genelab |
| `breed_claim` | `breedings_claimed` | 1 | 500 cash + 5 shards | genelab |
| `splice_1` | `splices_done` | 1 | 600 cash + 6 shards | genelab |
| `sell_2` | `dinos_sold` | 2 | 500 cash (cash ONLY) | none |

Plus `STREAK_MILESTONES` logic in `chestFor`:

```ts
export function chestFor(streak: number): ChestDef | null {
  if (streak === 3) return { cash: 1500, shards: 0 };
  if (streak === 7) return { cash: 3000, shards: 20 };
  if (streak === 14) return { cash: 2500, shards: 0, eggRarity: 'rare' };
  if (streak >= 30 && streak % 30 === 0)
    return { cash: 0, shards: Math.min(100, 40 + 10 * (streak / 30 - 1)), eggRarity: 'epic' };
  return null;
}
```

- [ ] **Step 2: Write `src/data/achievements.ts`.** The 12 tracks (names are player-facing titles):

| id / stat | tiers |
| --- | --- |
| `eggs_hatched` | 10 / 50 / 200 / 500 |
| `dinos_fed` | 25 / 150 / 500 / 1500 |
| `income_collected` | 10_000 / 100_000 / 1_000_000 / 10_000_000 |
| `expeditions_claimed` | 5 / 25 / 100 / 300 |
| `battles_fought` | 10 / 50 / 200 / 500 |
| `battles_won` | 5 / 25 / 100 / 250 |
| `stages_first_cleared` | 5 / 10 / 15 / 20 |
| `trades_completed` | 1 / 5 / 25 / 100 |
| `breedings_claimed` | 1 / 5 / 25 / 100 |
| `splices_done` | 1 / 10 / 50 / 200 |
| `dinos_sold` | 5 / 25 / 100 / 300 |
| `lots_built` | 3 / 6 / 10 / 15 |

Track `id` equals the stat name; one track per stat, no duplicates.

- [ ] **Step 3: Write the failing content gate** — `tests/daily-content.test.ts` (the `battle-content.test.ts` pattern — machine gate over pure data):

```ts
import { describe, it, expect } from 'vitest';
import { QUESTS, CHURN_STATS, chestFor, nextChestAt, type QuestDef } from '../src/data/quests.js';
import { ACHIEVEMENTS, TIER_REWARDS } from '../src/data/achievements.js';
import { STATS } from '../src/core/stats.js';
import { FOODS } from '../src/data/foods.js';

describe('daily content gate', () => {
  it('pool is exactly 17 defs with unique ids referencing real stats', () => {
    expect(QUESTS).toHaveLength(17);
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(17);
    for (const q of QUESTS) expect(STATS[q.stat]).toBeDefined();
  });
  it('count-shaped quests reference count stats; only collect_cash is roll-computed', () => {
    for (const q of QUESTS) {
      if (typeof q.target === 'number') {
        expect(STATS[q.stat]).toBe('count');
        expect(q.target).toBeGreaterThan(0);
      } else {
        expect(q.target).toBe('half-day-income');
        expect(q.stat).toBe('income_collected');
      }
    }
  });
  it('food rewards reference real foods; sell_2 pays no shards', () => {
    for (const q of QUESTS) {
      if (q.rewards.food) expect(FOODS[q.rewards.food.foodId]).toBeDefined();
      expect(q.rewards.cash).toBeGreaterThan(0);
    }
    expect(QUESTS.find((q) => q.id === 'sell_2')!.rewards.shards).toBeUndefined();
    expect(QUESTS.filter((q) => q.rewards.food)).toHaveLength(2);
  });
  it("roller can always fill 3 slots: >= 3 distinct 'none' stats that are non-churn with a non-food def", () => {
    const safe = new Set(QUESTS
      .filter((q) => q.requirement === 'none' && !CHURN_STATS.includes(q.stat) && !q.rewards.food)
      .map((q) => q.stat));
    expect(safe.size).toBeGreaterThanOrEqual(3);
  });
  it('chests: fixed 3/7/14, escalating every-30 capped at 100 shards, null elsewhere', () => {
    expect(chestFor(3)).toEqual({ cash: 1500, shards: 0 });
    expect(chestFor(7)).toEqual({ cash: 3000, shards: 20 });
    expect(chestFor(14)).toEqual({ cash: 2500, shards: 0, eggRarity: 'rare' });
    expect(chestFor(30)).toEqual({ cash: 0, shards: 40, eggRarity: 'epic' });
    expect(chestFor(60)!.shards).toBe(50);
    expect(chestFor(210)!.shards).toBe(100);
    expect(chestFor(240)!.shards).toBe(100);
    for (const n of [1, 2, 4, 13, 15, 29, 31, 45]) expect(chestFor(n)).toBeNull();
  });
  it('nextChestAt skips milestones at or under the personal best', () => {
    expect(nextChestAt(0, 0)).toBe(3);
    expect(nextChestAt(5, 0)).toBe(7);
    expect(nextChestAt(5, 14)).toBe(30);
    expect(nextChestAt(31, 30)).toBe(60);
    expect(nextChestAt(0, 200)).toBe(210);
  });
  it('achievements: exactly 12 tracks, one per stat, ascending tiers', () => {
    expect(ACHIEVEMENTS).toHaveLength(12);
    expect(new Set(ACHIEVEMENTS.map((t) => t.stat)).size).toBe(12);
    for (const t of ACHIEVEMENTS) {
      expect(STATS[t.stat]).toBeDefined();
      expect(t.tiers[0]).toBeGreaterThan(0);
      for (let i = 1; i < 4; i++) expect(t.tiers[i]).toBeGreaterThan(t.tiers[i - 1]);
    }
  });
  it('reward ceilings: lifetime achievement shards <= 350 and cash <= 150000', () => {
    const totalShards = ACHIEVEMENTS.length * TIER_REWARDS.reduce((s, r) => s + r.shards, 0);
    const totalCash = ACHIEVEMENTS.length * TIER_REWARDS.reduce((s, r) => s + r.cash, 0);
    expect(totalShards).toBeLessThanOrEqual(350);
    expect(totalCash).toBeLessThanOrEqual(150_000);
  });
});
```

- [ ] **Step 4: Run** — `npx vitest run tests/daily-content.test.ts` → PASS once both files exist (write the test before the data files to see it fail on imports first).

- [ ] **Step 5: Mutation check** — change `sell_2` rewards to include `shards: 5`, confirm RED, restore. Change a tier to descend, confirm RED, restore.

- [ ] **Step 6: Commit** — `git add src/data/quests.ts src/data/achievements.ts tests/daily-content.test.ts && git commit -m "Add the daily quest pool, streak chests, and achievement tracks"`

---

### Task 5: track() sites — care, park, hatchery, expeditions

**Files:**
- Modify: `src/modules/care/service.ts` (`feedDino`, `feedAll`, `rescueDino`), `src/modules/park/service.ts` (`collectIncome`, `buildLot`, `upgradeLot`), `src/modules/hatchery/service.ts` (`hatchEgg`, `incubateEgg`), `src/modules/expeditions/service.ts` (`claimExpedition`)
- Test: `tests/stats-sites.test.ts`

**Interfaces:**
- Consumes: `track`, `readStat` from `src/core/stats.js` (Task 3).
- Produces: nine counters increment per spec §3 — `dinos_fed`, `dinos_rescued`, `income_collected`, `income_collections`, `lots_built`, `lots_upgraded`, `eggs_hatched`, `eggs_incubated`, `expeditions_claimed` (Task 6 covers the remaining nine).

- [ ] **Step 1: Write the failing tests** — `tests/stats-sites.test.ts`. Seed via existing service functions and the harness (`getOrCreateUser`, `adminGive`-style direct inserts are fine — copy the seeding idioms from `tests/care.test.ts` / `tests/park.test.ts`). Cases:

```ts
// feedDino on a hungry dino → dinos_fed 1; feedDino again while still full (hunger
// >= 100 at settled time) → stays 1 (the anti-farm rule).
// feedAll feeding 2 hungry dinos → dinos_fed +2 (its loop already filters hunger < 100).
// rescueDino → dinos_rescued 1.
// collectIncome with pending income → income_collected += amount AND income_collections += 1.
// collectIncome with nothing pending → both stats unchanged.
// buildLot → lots_built 1. upgradeLot → lots_upgraded 1.
// hatchEgg → eggs_hatched 1. incubateEgg → eggs_incubated 1.
// claimExpedition (seed via the tests/expeditions.test.ts idiom: startExpedition,
// advance setNow past returnsAt, claim) → expeditions_claimed 1; claiming an
// un-returned expedition throws and leaves it 0.
// Failure atomicity: a feedDino that throws (no food) leaves dinos_fed at 0.
```

Write each as a real vitest `it` with concrete seeds and `expect(readStat(...)).toBe(n)` assertions.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/stats-sites.test.ts` → FAIL (counters stay 0).

- [ ] **Step 3: Implement.** Each insertion is inside the existing transaction. Exact edits:

`feedDino` — the settled-hunger condition, computed BEFORE the txn (imports `hungerAt`, `drainMsFor` are already present in the file):

```ts
  const wasHungry = hungerAt(dino.hunger, dino.lastFedAt, ctx.now(), drainMsFor(dino.traits)) < 100;
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { foods: { [food.id]: -cost } }, `feed:${species.id}`, ctx.now());
    ctx.db.update(schema.dinos).set({ hunger: food.fillTo, lastFedAt: ctx.now() })
      .where(eq(schema.dinos.id, dinoId)).run();
    if (wasHungry) track(ctx, userId, 'dinos_fed', 1);   // re-feeding a full dino is not care
  });
```

`feedAll` — inside the per-candidate txn (candidates are pre-filtered `hunger < 100`): add `track(ctx, userId, 'dinos_fed', 1);` after the dinos update. `rescueDino` — inside its txn: `track(ctx, userId, 'dinos_rescued', 1);`.

`collectIncome` (`src/modules/park/service.ts`, inside the `if (amount > 0)` transaction):

```ts
    track(ctx, userId, 'income_collected', amount);
    track(ctx, userId, 'income_collections', 1);
```

`buildLot` txn: `track(ctx, userId, 'lots_built', 1);` — `upgradeLot` txn: `track(ctx, userId, 'lots_upgraded', 1);` — `hatchEgg` txn: `track(ctx, userId, 'eggs_hatched', 1);` — `incubateEgg` (no txn exists; `track` after the eggs update): `track(ctx, userId, 'eggs_incubated', 1);` — `claimExpedition` (`src/modules/expeditions/service.ts`, inside its existing txn, next to the `economy.apply`/eggs insert): `track(ctx, userId, 'expeditions_claimed', 1);`.

- [ ] **Step 4: Run** — `npx vitest run tests/stats-sites.test.ts` → PASS; `npm test` → full suite green.

- [ ] **Step 5: Mutation check** — remove the `wasHungry` condition (track unconditionally), confirm the anti-farm test goes RED, restore. Remove the `collectIncome` track lines, confirm RED, restore. Remove the `claimExpedition` track line, confirm RED, restore.

- [ ] **Step 6: Typecheck + commit** — `npm run typecheck`; `git add src/modules/care/service.ts src/modules/park/service.ts src/modules/hatchery/service.ts src/modules/expeditions/service.ts tests/stats-sites.test.ts && git commit -m "Track care, park, hatchery, and expedition actions in the stat substrate"`

---

### Task 6: track() sites — battles, trading, shop, gene lab

**Files:**
- Modify: `src/modules/battles/service.ts` (`runFight`), `src/modules/trading/service.ts` (`acceptTrade`), `src/modules/shop/service.ts` (`buyEgg`, `buyFood`), `src/modules/shop/shards.ts` (`buyMythicEgg`, `sellDino`), `src/modules/genelab/service.ts` (`startBreeding`, `claimBreeding`, `spliceDino`)
- Test: extend `tests/stats-sites.test.ts`

**Interfaces:**
- Consumes: `track`, `readStat` (Task 3); `sideItemCount` from `src/modules/trading/validate.js` for the non-empty check.
- Produces: the remaining nine counters increment per spec §3 — `battles_fought`, `battles_won`, `stages_first_cleared`, `trades_completed`, `shop_purchases`, `dinos_sold`, `breedings_started`, `breedings_claimed`, `splices_done`.

- [ ] **Step 1: Write the failing tests** (append to `tests/stats-sites.test.ts`, copying seeding idioms from `tests/battles*.test.ts`, `tests/trading.test.ts`, `tests/genelab.test.ts`, `tests/shop.test.ts`):

```ts
// runFight loss → battles_fought 1, battles_won 0. Win → both 1; firstClear win →
// stages_first_cleared 1; replaying the same stage → stays 1.
// acceptTrade moving one dino → trades_completed 1 for BOTH fromUser and toUser.
// acceptTrade of an empty-for-empty trade (offer and request both zero items/cash/food,
// inserted directly as a pending trades row) → trades_completed stays 0 for both.
// buyEgg → shop_purchases 1. buyFood with units 5 → shop_purchases 1 (delta 1 per
// transaction, never units). buyMythicEgg → shop_purchases 1.
// sellDino → dinos_sold 1.
// /breed start preview (startBreeding with dryRun: true) → breedings_started stays 0;
// real startBreeding → 1. claimBreeding → breedings_claimed 1. spliceDino → splices_done 1.
```

- [ ] **Step 2: Run to verify failure** → new cases FAIL.

- [ ] **Step 3: Implement.** All inside the existing transactions:

`runFight` (in the commit txn, next to the battleProgress upsert — `won`, `firstClear` are in scope):

```ts
    track(ctx, userId, 'battles_fought', 1);
    if (won) track(ctx, userId, 'battles_won', 1);
    if (firstClear) track(ctx, userId, 'stages_first_cleared', 1);
```

`acceptTrade` (inside the txn; compute the emptiness check before it, using the same helpers `createTrade` validates with):

```ts
  const moves = sideItemCount(trade.offer) + sideItemCount(trade.request)
    + trade.offer.cash + trade.request.cash > 0;
  // …inside the transaction, after the wallet applies:
  if (moves) { track(ctx, trade.fromUser, 'trades_completed', 1); track(ctx, trade.toUser, 'trades_completed', 1); }
```

(Check `sideItemCount`'s actual definition in `src/modules/trading/validate.ts` — if it already includes foods, the cash addition above is the only extra term; adjust so the predicate is "at least one item, cash unit, or food unit moves on either side".)

`buyEgg` txn / `buyMythicEgg` txn: `track(ctx, userId, 'shop_purchases', 1);`. `buyFood` (no txn; after its `economy.apply`): `track(ctx, userId, 'shop_purchases', 1);` — delta 1 regardless of `units`. `sellDino` txn: `track(ctx, userId, 'dinos_sold', 1);`.

`startBreeding` — inside the real transaction (BELOW the `dryRun` early-return): `track(ctx, userId, 'breedings_started', 1);`. `claimBreeding` txn: `track(ctx, userId, 'breedings_claimed', 1);`. `spliceDino` txn: `track(ctx, userId, 'splices_done', 1);`.

- [ ] **Step 4: Run** — `npx vitest run tests/stats-sites.test.ts` and `npm test` → PASS.

- [ ] **Step 5: Mutation check** — move the `startBreeding` track call above the dryRun return, confirm the preview test goes RED, restore. Drop the `moves` guard, confirm the empty-trade test goes RED, restore.

- [ ] **Step 6: Commit** — `git add src/modules/battles/service.ts src/modules/trading/service.ts src/modules/shop/ src/modules/genelab/service.ts tests/stats-sites.test.ts && git commit -m "Track battle, trade, shop, and gene-lab actions in the stat substrate"`

---

### Task 7: Daily service — roll + progress

**Files:**
- Create: `src/modules/daily/service.ts`
- Test: `tests/daily-roll.test.ts`

**Interfaces:**
- Consumes: `dayKeyUTC`, `DAY_MS` (Task 1); `STATS`, `readStat`, `readStats` (Task 3); `QUESTS`, `CHURN_STATS` (Task 4); `mulberry32` from `src/core/rolls.js`; `facilityLevel` and the capHours derivation from `src/modules/park/service.js` (read that file and reuse its exported helpers — do not re-derive). Gene Lab eligibility is the resolved fact `facilityLevel(lots, 'gene_lab') > 0` — `facilityLevel` and `breedingSlots` are already exported from `src/modules/park/service.ts` (the same check `startBreeding` performs); no genelab/service.ts edit. Trading eligibility uses the minimum-rating constant exported from `src/data/trade.ts` (read the file for its exact name — the 2★/200 gate `createTrade` enforces).
- Produces:
  - `rollDailyQuests(ctx: Ctx, userId: string): void` — idempotent; no-op when the users row is absent or today's rows exist; deletes prior-day rows; inserts 3 slots with `onConflictDoNothing`.
  - `interface QuestView { row: typeof schema.dailyQuests.$inferSelect; def: QuestDef; progress: number; complete: boolean }`
  - `questProgress(ctx: Ctx, userId: string): QuestView[]` — today's rows only; rows whose `questId` has no def are OMITTED (skipped, never crash).
  - `dailyEarningCapacity(ctx: Ctx, userId: string): number` — assigned, non-escaped dinos' `incomePerHr × modProduct(traits, 'income')`, summed, × the user's capHours.

- [ ] **Step 1: Write the failing tests** — `tests/daily-roll.test.ts`:

```ts
// Determinism: two makeCtx instances, same user + same nowMs → identical (questId, slot)
// triples. Different dayKey (advance setNow by DAY_MS) → a different roll for at least
// one of several users (loop 5 users, expect any difference — avoids a flaky exact-match).
// Hard rules over 30 seeded (user, day) boards: never two slots sharing a stat; never
// two CHURN_STATS defs; never two food-paying defs.
// Eligibility: brand-new user (no battle_progress, no gene lab, rating 0, no assigned
// dino) never rolls battles/genelab/trading/income defs. A user with a battle_progress
// row can roll battle defs (seed 30 days, expect at least one).
// Baseline: track 5 dinos_fed BEFORE the roll → rolled feed def has baseline 5 and
// questProgress shows 0/3. Missing stat row → baseline 0, progress 0, no NaN.
// (Board composition is seed-determined: loop candidate userIds until the wanted def
// rolls — determinism makes the found seed stable forever — or assert generically:
// for EVERY rolled row, baseline === the pre-roll counter value of its def's stat.)
// collect_cash target: same seed-hunting note; when it appears, target === clamp(
// round(0.5 * hourly * capHours), 500, 50000) for a user with one assigned common
// (verify hourly from RARITY.incomePerHr); huge park → capped at 50000; tiny → 500.
// Prior-day cleanup: roll on day 1, advance DAY_MS, roll again → no day-1 rows remain.
// Idempotence: second roll same day inserts nothing new (row ids unchanged).
// No users row → rollDailyQuests is a silent no-op (no throw, no rows).
// questProgress omits rows whose questId is unknown (insert a bogus row directly).
```

Write each as a real `it` with concrete seeds.

- [ ] **Step 2: Run to verify failure** → FAIL (module missing).

- [ ] **Step 3: Implement `src/modules/daily/service.ts`** (roll half):

```ts
import { and, eq, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { dayKeyUTC } from '../../core/clock.js';
import { STATS, readStat, type StatId } from '../../core/stats.js';
import { QUESTS, CHURN_STATS, type QuestDef } from '../../data/quests.js';
import { mulberry32 } from '../../core/rolls.js';
// + the eligibility imports resolved per the Consumes block above

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function eligible(ctx: Ctx, userId: string, q: QuestDef): boolean { /* switch on q.requirement per spec §4 */ }

function pickBoard(pool: QuestDef[], rng: () => number): QuestDef[] {
  const byStat = new Map<StatId, QuestDef[]>();
  for (const q of pool) byStat.set(q.stat, [...(byStat.get(q.stat) ?? []), q]);
  const board: QuestDef[] = []; let churn = 0, food = 0;
  for (const stat of shuffle([...byStat.keys()], rng)) {
    if (board.length === 3) break;
    if (CHURN_STATS.includes(stat) && churn >= 1) continue;
    let defs = byStat.get(stat)!;
    if (food >= 1) defs = defs.filter((d) => !d.rewards.food);
    if (!defs.length) continue;
    const def = defs[Math.floor(rng() * defs.length)];
    board.push(def);
    if (CHURN_STATS.includes(stat)) churn++;
    if (def.rewards.food) food++;
  }
  return board;
}

export function rollDailyQuests(ctx: Ctx, userId: string): void {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) return;
  const dayKey = dayKeyUTC(ctx.now());
  const existing = ctx.db.select().from(schema.dailyQuests)
    .where(and(eq(schema.dailyQuests.userId, userId), eq(schema.dailyQuests.dayKey, dayKey))).get();
  if (existing) return;
  const rng = mulberry32(hashSeed(`${userId}:${dayKey}`));
  const board = pickBoard(QUESTS.filter((q) => eligible(ctx, userId, q)), rng);
  ctx.db.transaction(() => {
    ctx.db.delete(schema.dailyQuests).where(and(
      eq(schema.dailyQuests.userId, userId), ne(schema.dailyQuests.dayKey, dayKey))).run();
    board.forEach((def, slot) => {
      const target = def.target === 'half-day-income'
        ? Math.max(500, Math.min(50_000, Math.round(dailyEarningCapacity(ctx, userId) / 2)))
        : def.target;
      ctx.db.insert(schema.dailyQuests)
        .values({ userId, dayKey, slot, questId: def.id, baseline: readStat(ctx, userId, def.stat), target })
        .onConflictDoNothing().run();
    });
  });
}

export function questProgress(ctx: Ctx, userId: string): QuestView[] { /* today's rows, join defs by id, omit unknown, progress = clamp(readStat − baseline, 0, target) */ }
```

Fill `eligible` exactly per spec §4 (income → any dino with `lotId` set — the spec's rule verbatim, escaped or not; battles → any `battle_progress` row; trading → `ratingHighWater >=` the trade constant; genelab → `facilityLevel(lots, 'gene_lab') > 0`). `dailyEarningCapacity` DOES exclude escaped dinos (they earn nothing) — the [500, 50000] clamp floors the target when capacity is 0. `questProgress` batches with `readStats` (one query), not per-quest `readStat`.

- [ ] **Step 4: Run** — `npx vitest run tests/daily-roll.test.ts` → PASS; `npm test` green.

- [ ] **Step 5: Mutation check** — remove the churn guard in `pickBoard`, confirm the hard-rule test goes RED, restore. Swap `hashSeed` to return 0 always, confirm the different-day test goes RED, restore.

- [ ] **Step 6: Commit** — `git add src/modules/daily/service.ts tests/daily-roll.test.ts && git commit -m "Add the daily quest roll and derived progress"`

---

### Task 8: Daily service — claim, streak, chests

**Files:**
- Modify: `src/modules/daily/service.ts`
- Test: `tests/daily-claim.test.ts`

**Interfaces:**
- Consumes: Task 7's roll/progress; `chestFor` (Task 4); `dayKeyUTC`, `DAY_MS` (Task 1).
- Produces:
  - `interface ClaimResult { claimed: QuestView[]; rewards: { cash: number; shards: number; foods: Partial<Record<FoodId, number>> }; chest: (ChestDef & { streak: number }) | null; streak: number; ticked: boolean }`
  - `claimQuests(ctx: Ctx, userId: string): ClaimResult` — today's dayKey ONLY; empty claim = `{ claimed: [], … }` with **no writes**.

- [ ] **Step 1: Write the failing tests** — `tests/daily-claim.test.ts`:

```ts
// Claim pays: complete 2 of 3 quests, claim → cash/shards equal the two defs' sums.
// Seed the board by DIRECT daily_quests inserts with known non-food questIds (the
// same technique the unknown-questId case below uses) — economy.apply writes one
// tx_log row per FOOD entry too, so assert "exactly one tx_log row with reason
// 'quest:daily' and food_id IS NULL". Both rows stamped claimedAt; third row
// unclaimed; second claim same day → claimed: [], no new tx_log rows.
// Streak: first-ever claim → streak 1, ticked true. Claim again same day (complete the
// third quest) → rewards paid, ticked false, streak stays 1.
// Consecutive days with a > 24h gap between claims (day1 09:00 → day2 10:00, via
// setNow) → streak 2 (pins dayKey comparison, not a 24h window).
// Gap (claim day1, skip day2, claim day3) → streak resets to 1.
// Complete at 23:59, claim at 00:01 next day → rollDailyQuests (claim path re-rolls
// internally? NO — call claimQuests directly after advancing) → claimed: [], streak
// untouched, no crash. (claimQuests reads today's dayKey only.)
// Chests: reach streak 3 → chest {cash:1500}, tx_log has a 'quest:chest' row; streak 7 →
// +20 shards; streak 14 → rare egg row exists with source 'quest'; streak 30 → epic egg
// + 40 shards. Personal best: set quest_streak_best = 14 directly, run a fresh streak to
// 3 → NO chest; to 15 (> best) — 15 is not a milestone → no chest, best now 15.
// quest_streak_best rises on every claim that exceeds it (assert after streak 2 with
// best 0 → best 2).
// Shard-window bypass: claims never touch shards_window_earned (assert unchanged).
// Unknown questId row (def removed): insert bogus row completed → claim skips it, pays 0.
```

Simulate multi-day play by advancing `setNow` and re-calling `rollDailyQuests` then completing via `track(...)` calls directly — no need to drive real commands here.

- [ ] **Step 2: Run to verify failure** → FAIL (`claimQuests` missing).

- [ ] **Step 3: Implement `claimQuests`:**

```ts
export function claimQuests(ctx: Ctx, userId: string): ClaimResult {
  const now = ctx.now();
  const dayKey = dayKeyUTC(now);
  const claimable = questProgress(ctx, userId)
    .filter((v) => v.row.dayKey === dayKey && v.row.claimedAt === null && v.complete);
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  if (!claimable.length)
    return { claimed: [], rewards: { cash: 0, shards: 0, foods: {} }, chest: null, streak: user.questStreak, ticked: false };

  const rewards = { cash: 0, shards: 0, foods: {} as Partial<Record<FoodId, number>> };
  for (const v of claimable) {
    rewards.cash += v.def.rewards.cash;
    rewards.shards += v.def.rewards.shards ?? 0;
    if (v.def.rewards.food) {
      const { foodId, qty } = v.def.rewards.food;
      rewards.foods[foodId] = (rewards.foods[foodId] ?? 0) + qty;
    }
  }

  const lastKey = user.lastQuestClaimAt > 0 ? dayKeyUTC(user.lastQuestClaimAt) : null;
  const ticked = lastKey !== dayKey;
  const streak = !ticked ? user.questStreak
    : lastKey === dayKeyUTC(now - DAY_MS) ? user.questStreak + 1 : 1;
  const chestDef = ticked && streak > user.questStreakBest ? chestFor(streak) : null;

  ctx.db.transaction(() => {
    ctx.economy.apply(userId, rewards, 'quest:daily', now);
    for (const v of claimable) {
      ctx.db.update(schema.dailyQuests).set({ claimedAt: now })
        .where(eq(schema.dailyQuests.id, v.row.id)).run();
    }
    if (chestDef) {
      ctx.economy.apply(userId, { cash: chestDef.cash, shards: chestDef.shards }, 'quest:chest', now);
      if (chestDef.eggRarity) {
        ctx.db.insert(schema.eggs).values({
          userId, rarity: chestDef.eggRarity, speciesId: null, source: 'quest', obtainedAt: now,
        }).run();
      }
    }
    ctx.db.update(schema.users).set({
      questStreak: streak,
      questStreakBest: Math.max(user.questStreakBest, streak),
      lastQuestClaimAt: now,
    }).where(eq(schema.users.discordId, userId)).run();
  });
  return { claimed: claimable, rewards, chest: chestDef ? { ...chestDef, streak } : null, streak, ticked };
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/daily-claim.test.ts` and `npm test` → PASS.

- [ ] **Step 5: Mutation check** — change the yesterday comparison to `now - DAY_MS * 2`, confirm the gap test goes RED, restore. Drop the `streak > questStreakBest` condition, confirm the personal-best test goes RED, restore.

- [ ] **Step 6: Commit** — `git add src/modules/daily/service.ts tests/daily-claim.test.ts && git commit -m "Add quest claiming with streak ticks and personal-best chests"`

---

### Task 9: Achievements service

**Files:**
- Modify: `src/modules/daily/service.ts` (append)
- Test: `tests/daily-achievements.test.ts`

**Interfaces:**
- Consumes: `ACHIEVEMENTS`, `TIER_REWARDS` (Task 4); `readStats` (Task 3).
- Produces:
  - `interface TrackView { def: AchievementTrack; value: number; claimedTiers: Set<number>; claimable: number[] }`
  - `achievementsView(ctx: Ctx, userId: string): TrackView[]` — all 12, in `ACHIEVEMENTS` order
  - `claimAchievements(ctx: Ctx, userId: string): { claimed: Array<{ trackId: string; tier: number }>; cash: number; shards: number }` — all claimable tiers, one txn, reason `quest:achievements`; empty = no writes
  - `earnedTierCount(ctx: Ctx, userId: string): number` — for the park badge

- [ ] **Step 1: Write the failing tests** — `tests/daily-achievements.test.ts`:

```ts
// View: track eggs_hatched to 60 → tiers 0 and 1 claimable, 2 and 3 not; value 60.
// Claim-all: pays 500 + 1250 cash (tier rewards summed), 0 shards, inserts 2 claim
// rows, ONE tx_log 'quest:achievements' row; second claim-all → claimed: [], no writes.
// Cross a threshold later (track to 200) → tier 2 claimable, claim pays 2500 + 5 shards.
// Each tier pays exactly once ever (re-claim after crossing pays only the NEW tier).
// Multi-track: two tracks with claimable tiers → one claim-all pays both, count matches.
// earnedTierCount reflects claim rows (0 → 2 → 3 across the above).
// Backfilled veteran (insert user_stats rows directly, e.g. lots_built 3) → bronze
// claimable immediately.
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement** — derivation is a filter over `readStats` + existing claim rows; claim inserts `(userId, trackId, tier, claimedAt)` rows and applies one summed `economy.apply(userId, { cash, shards }, 'quest:achievements', now)` inside one transaction.

- [ ] **Step 4: Run** → PASS, `npm test` green.

- [ ] **Step 5: Mutation check** — make `claimable` ignore existing claim rows, confirm the pays-once test goes RED, restore.

- [ ] **Step 6: Commit** — `git add src/modules/daily/service.ts tests/daily-achievements.test.ts && git commit -m "Add derived achievement tiers and claim-all"`

---

### Task 10: The daily module — `/daily`, claim button, registration, help topic

**Files:**
- Create: `src/modules/daily/index.ts`, `src/modules/daily/embeds.ts`
- Modify: `modules.json`, `src/core/module-list.ts`, `src/modules/help/index.ts`, `tests/registry-load.test.ts`, `tests/config.test.ts`, `tests/contract.test.ts`
- Test: `tests/daily-command.test.ts`

**Interfaces:**
- Consumes: Tasks 7–8 service fns; `attach`/`assetImage` (`src/core/images.js`); `emojiTag` (`src/core/emojis.js`); `getOrCreateUser`, `settleEscapes`.
- Produces: `dailyModule: ModuleManifest` (name `'daily'`, commands `/daily` + `/achievements`); component prefixes `daily` and `ach`; `hubPayload(ctx, userId)` and `claimPayload(result)` in embeds.ts. The `/achievements` builder registers NOW (the 22→24 counts land here); its interim handler is exactly:

```ts
// Interim /achievements handler — Task 11 replaces this with the paginated embed.
execute: async (ctx, i) => {
  getOrCreateUser(ctx, i.user.id, i.user.displayName);
  const lines = achievementsView(ctx, i.user.id)
    .map((t) => `${t.def.name}: ${t.value}`).join('\n');
  await i.reply({ content: lines, flags: MessageFlags.Ephemeral });
},
```

with one smoke `it` in Step 1 asserting it replies ephemeral with 12 lines.

- [ ] **Step 1: Write the failing tests** — `tests/daily-command.test.ts` (drive via `fakeCommand`/`fakeButton` + the module's `execute`, the `tests/genelab.test.ts` idiom):

```ts
// /daily rolls (first open of the day) and renders 3 quest lines + streak line; a
// completed quest renders a checkmark; progress bar shows for partials.
// Claim button daily:claim:<uid>: another user clicking → ephemeral "not yours" reply,
// no writes. Owner clicking with nothing complete → ephemeral "Nothing to claim —
// quests reset at UTC midnight", no tx_log rows. Owner with a completed quest →
// itemized ephemeral reply, rewards paid, chest line when a chest dropped.
// Hub reply is public (no ephemeral flag); claim replies ephemeral.
// Payload files: hub embed uses attach — when assetImage returns null the payload
// ships NO files key (assert files undefined, the hatchery test idiom).
```

Also bump the three registration tests (they will fail until Step 3): `tests/registry-load.test.ts` 12→13 and 22→24, `tests/config.test.ts` expected-modules object + `daily: true`, `tests/contract.test.ts` command count 22→24.

- [ ] **Step 2: Run to verify failure** → FAIL (module missing, counts off).

- [ ] **Step 3: Implement.**

`src/modules/daily/embeds.ts` — progress bar + hub + claim payloads:

```ts
export function bar(cur: number, target: number): string {
  const filled = Math.max(0, Math.min(5, Math.floor((cur / target) * 5)));
  return '▰'.repeat(filled) + '▱'.repeat(5 - filled);
}
```

Hub embed: one line per `QuestView` — `✅ ${def.description}` when complete/claimed, else `${emojiTag('dw_quest')} ${def.description} ${bar(progress, target)} ${progress}/${target}`; streak field `${emojiTag('dw_streak')} Streak: N day(s)` plus next-milestone line (`next chest at M` via `nextChestAt(user.questStreak, user.questStreakBest)` from Task 4); Claim button `daily:claim:<userId>` (ButtonStyle.Success, label `Claim`), banner via `attach(embed, payload, 'image', assetImage('banners', 'daily'))`. Claim payload: ephemeral, itemizes each claimed def + rewards + chest line (`🎁 ${streak}-day chest: …` — use `emojiTag('dw_chest')`).

`src/modules/daily/index.ts` — `ModuleManifest` shaped exactly like `src/modules/genelab/index.ts` (read it): `/daily` handler = `getOrCreateUser` → `settleEscapes` → `rollDailyQuests` → reply `hubPayload`. Components: prefix `daily`, action `claim` → parse `daily:claim:<uid>`, malformed id or `i.user.id !== uid` → ephemeral reject; else `claimQuests` → reply `claimPayload` (ephemeral). Unknown action → `i.deferUpdate()`. Register in `modules.json` (`"daily": true`) and `ALL_MODULES` (import + append). Add the `daily` HELP_TOPICS entry (title `Daily quests`, body covering quests/streak/chests/achievements) **WITHOUT an `art` descriptor** — `tests/help.test.ts` requires every topic that declares art to ship the image file, and the daily banner is generated post-merge (the art-less `park` topic is the precedent). Task 14 records the follow-up: add `art: { kind: 'banners', name: 'daily' }` + append `'daily'` to that test's covered list only when the banner WebP is committed.

- [ ] **Step 4: Run** — `npx vitest run tests/daily-command.test.ts tests/registry-load.test.ts tests/config.test.ts tests/contract.test.ts` then `npm test` → PASS.

- [ ] **Step 5: Mutation check** — remove the owner check in the claim handler, confirm the not-yours test goes RED, restore.

- [ ] **Step 6: Typecheck + commit** — `npm run typecheck`; `git add -A && git commit -m "Add the daily module with /daily hub and claim button"`

---

### Task 11: `/achievements` UI + park badge

**Files:**
- Modify: `src/modules/daily/index.ts`, `src/modules/daily/embeds.ts`, `src/modules/park/embeds.ts` (dashboard), `src/modules/park/index.ts` (both `/park view` branches)
- Test: extend `tests/daily-command.test.ts` and `tests/park.test.ts`

**Interfaces:**
- Consumes: Task 9 (`achievementsView`, `claimAchievements`, `earnedTierCount`); `paginate`, `pageRow` from `src/core/paginate.js`.
- Produces: `/achievements` full handler; `ach` component prefix (`ach:page:<uid>:<n>`, `ach:claimall:<uid>`); an achievements line on the park dashboard.

- [ ] **Step 1: Write the failing tests:**

```ts
// /achievements renders one field per track on page 1 (PAGE_SIZE 10 → 12 tracks = 2
// pages), progress bars, tier markers (e.g. '🥉🥈 45/200'); pageRow present with
// ach:page customIds; page 2 via button rebuilds payload (i.update) with attachments: [].
// ach:page owner-lock: wrong user → ephemeral reject. Out-of-range page → clamped.
// ach:claimall owner-only; with claimable tiers → pays and lists them; without →
// ephemeral "Nothing to claim yet."
// Park dashboard: with 3 earned tiers the embed includes an achievements count line;
// with 0 it still renders (line says 0 or is omitted — pick ONE: omit at 0, assert both).
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement.** Achievements embed: paginate `achievementsView` output; per-track field `name: track name`, value `${tierGlyphs} ${bar(value, nextThreshold)} ${value}/${nextThreshold}` (all-platinum → `MAXED`). Buttons row: `pageRow('ach', 'page', userId, page, pages)` + claim-all button `ach:claimall:<userId>`. Banner `assetImage('banners', 'achievements')` via `attach`. Handlers follow the `/dino list` pagination idiom exactly (`i.update({ ...payload, attachments: [] })`). Park dashboard: `dashboardPayload` is a PURE formatter (no ctx) — add an `earnedTiers: number` field to its opts, render the line only when > 0, and pass `earnedTierCount(ctx, targetId)` from BOTH `/park view` branches in `src/modules/park/index.ts` (own park and the read-only other-user view).

- [ ] **Step 4: Run** — targeted files then `npm test` → PASS.

- [ ] **Step 5: Mutation check** — return page 1 payload from the page handler regardless of target, confirm the page-2 test goes RED, restore.

- [ ] **Step 6: Typecheck + commit** — `npm run typecheck`; `git add -A && git commit -m "Add /achievements with pagination and the park badge line"`

---

### Task 12: Router hooks — pre-roll, post-roll, quest hint

**Files:**
- Modify: `src/core/router.ts`, `src/index.ts`
- Create: `src/modules/daily/hooks.ts`
- Test: `tests/daily-hooks.test.ts`

**Interfaces:**
- Consumes: `rollDailyQuests`, `questProgress` (Task 7).
- Produces:
  - In `router.ts`: `export interface RouterHooks { preDispatch?(ctx: Ctx, userId: string): void; postDispatch?(ctx: Ctx, i: ChatInputCommandInteraction | ButtonInteraction, source: { command?: string; prefix?: string }): Promise<void> }` and `routeInteraction(ctx, registry, interaction, hooks?: RouterHooks)`.
  - In `hooks.ts`: `dailyRouterHooks: RouterHooks`.

- [ ] **Step 1: Write the failing tests** — `tests/daily-hooks.test.ts`. Build a stub registry with synthetic commands (the router-test idiom — synthetic names skip builder lookup): a `play` command whose execute calls `track(ctx, i.user.id, 'eggs_hatched', 1)` then replies; a `noreply` command that returns without replying; use the REAL `routeInteraction` with `dailyRouterHooks`:

```ts
// Pre-roll: existing user, first interaction of the day → daily_quests rows exist for
// today after routing any command; the action itself counted (roll happened BEFORE
// dispatch): with hatch_1 rolled (find a user/day seed where a feed/hatch def landed —
// or assert baseline equals the pre-command counter value).
// New-user: no users row; route a synthetic command whose execute calls getOrCreateUser
// then track → post-dispatch roll created today's rows; the first command's action is
// NOT counted (baseline equals the post-action counter).
// Hint: roll, complete a quest via the play command → ONE followUp containing '/daily',
// notifiedAt stamped on the completed row; route play again → no second followUp.
// One action crossing two quests (seed a board with fight_5 + win_3 via direct row
// inserts, then a synthetic command tracking both stats) → exactly one followUp, both
// rows stamped.
// Exemptions: a synthetic command named 'daily' completing a quest → no followUp.
// A button with customId 'ach:page:u1:2' → no followUp.
// Errored path: the noreply command completes a quest → no followUp, no crash, and the
// NEXT command's followUp still fires (notifiedAt was not stamped on the skipped pass —
// stamp only when the followUp actually sends).
// Autocomplete interactions: never roll, never hint (route a fakeAutocomplete).
// Claimed quests never hint.
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement.**

`src/core/router.ts` — add the interface; in `routeInteraction` after `touchPresence`: `try { hooks?.preDispatch?.(ctx, interaction.user.id); } catch (err) { logger.warn({ err }, 'preDispatch hook failed'); }`. After the command/button dispatch (still inside the outer try) — note there is NO `i` variable in scope there (the existing `const i` lives inside the catch block), so cast explicitly, and TS strict won't allow `commandName` on the union:

```ts
    try {
      const source = isCommand
        ? { command: (interaction as ChatInputCommandInteraction).commandName }
        : { prefix: (interaction as ButtonInteraction).customId.split(':')[0] };
      await hooks?.postDispatch?.(
        ctx, interaction as ChatInputCommandInteraction | ButtonInteraction, source);
    } catch (err) {
      logger.warn({ err }, 'postDispatch hook failed');
    }
```

A hook failure must never surface as a command error.

`src/modules/daily/hooks.ts`:

```ts
import { MessageFlags } from 'discord.js';
import type { RouterHooks } from '../../core/router.js';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { rollDailyQuests, questProgress } from './service.js';
import { dayKeyUTC } from '../../core/clock.js';

const EXEMPT_COMMANDS = new Set(['daily', 'achievements']);
const EXEMPT_PREFIXES = new Set(['daily', 'ach']);

export const dailyRouterHooks: RouterHooks = {
  preDispatch: (ctx, userId) => rollDailyQuests(ctx, userId),
  postDispatch: async (ctx, i, source) => {
    rollDailyQuests(ctx, i.user.id);   // covers the row-just-created first command
    if (source.command && EXEMPT_COMMANDS.has(source.command)) return;
    if (source.prefix && EXEMPT_PREFIXES.has(source.prefix)) return;
    if (!i.deferred && !i.replied) return;
    const crossed = questProgress(ctx, i.user.id)
      .filter((v) => v.complete && v.row.claimedAt === null && v.row.notifiedAt === null);
    if (!crossed.length) return;
    await i.followUp({ content: '🎯 Quest complete — **/daily** to claim!', flags: MessageFlags.Ephemeral });
    for (const v of crossed) {
      ctx.db.update(schema.dailyQuests).set({ notifiedAt: ctx.now() })
        .where(eq(schema.dailyQuests.id, v.row.id)).run();
    }
  },
};
```

(Stamp AFTER the followUp succeeds — an errored send must leave the hint owed.) `src/index.ts` — import `dailyRouterHooks` and pass it as the 4th argument at the `routeInteraction` call site.

- [ ] **Step 4: Run** — `npx vitest run tests/daily-hooks.test.ts`, then `npm test` (journey tests route without hooks and must stay green) → PASS.

- [ ] **Step 5: Mutation check** — stamp `notifiedAt` before the followUp and make the followUp throw in a test, confirm the stamp-only-on-send test goes RED, restore. Drop the exemption sets, confirm the exemption test goes RED, restore.

- [ ] **Step 6: Typecheck + commit** — `npm run typecheck`; `git add -A && git commit -m "Wire daily roll and quest-complete hints into the router"`

---

### Task 13: Admin integration

**Files:**
- Modify: `src/modules/admin/service.ts` (`adminReset`, `adminFastForward`)
- Test: extend the admin test file (`tests/admin.test.ts` or wherever `adminReset` is pinned — find it with grep)

**Interfaces:**
- Consumes: schema tables (Task 2).
- Produces: reset covers the three new tables + three users columns; fast-forward shifts `last_quest_claim_at_ms`.

- [ ] **Step 1: Write the failing tests:**

```ts
// adminReset: seed stats, today's quests, achievement claims, streak 5/best 14/claimAt
// set → reset → all three tables empty for the target, the three users columns 0,
// OTHER users' rows untouched.
// adminFastForward 26h: last_quest_claim_at_ms shifts back by 26h (only when > 0 — a
// never-claimed 0 stays 0); the OTHER users columns (lastCollectAt etc.) still shift
// for a never-claimed user; daily_quests rows are NOT touched (dayKey unchanged).
// Streak continuity end-to-end: complete only 1 of 3 quests → claim (streak 1) →
// adminFastForward 24h (same dayKey — NO new roll happens) → complete a SECOND quest
// on the same board → claim → streak 2 (the shifted anchor reads as yesterday).
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement.** In `adminReset`'s transaction, alongside the existing deletes: delete `userStats`, `dailyQuests`, `achievementClaims` rows for the target; extend the users restore-defaults update with `questStreak: 0, questStreakBest: 0, lastQuestClaimAt: 0`. In `adminFastForward`: the existing users shift is ONE unguarded UPDATE (lastCollectAt / shardsWindowStart / energyUpdatedAt) — leave it untouched; `lastQuestClaimAt` needs its own guard so a never-claimed 0 stays 0, which none of the existing users columns need. Add a SEPARATE second statement right after it (import `gt` from drizzle-orm; the WHERE-guard style the eggs/timers shifts already use):

```ts
  // daily_quests.dayKey is deliberately NOT shifted: fast-forward cannot move the UTC
  // calendar, so today's board stays today's. Shifting the claim anchor is what lets a
  // streak gap or continuation be simulated.
  ctx.db.update(schema.users)
    .set({ lastQuestClaimAt: sql`${schema.users.lastQuestClaimAt} - ${ms}` })
    .where(and(eq(schema.users.discordId, targetId), gt(schema.users.lastQuestClaimAt, 0)))
    .run();
```

(Match the surrounding code's actual variable names for the shift amount and target id — read the function before editing.)

- [ ] **Step 4: Run** → PASS, `npm test` green.

- [ ] **Step 5: Mutation check** — remove the `dailyQuests` delete from reset, confirm RED, restore.

- [ ] **Step 6: Commit** — `git add src/modules/admin/service.ts tests/ && git commit -m "Cover the daily-loop tables in admin reset and fast-forward"`

---

### Task 14: Emojis, prompts, data-comment updates, docs, test:live

**Files:**
- Create: `assets/emojis/svg/dw_quest.svg`, `assets/emojis/svg/dw_streak.svg`, `assets/emojis/svg/dw_chest.svg` (+ their PNGs via `npm run build-emojis`)
- Modify: `src/core/emojis.ts` (`EMOJI_FALLBACK`), `tests/emojis.test.ts` (pinned fallback list), `docs/ops.md` (emoji counts), `docs/assets/prompts.md`, `src/data/sell.ts` (comment), `src/data/breeding.ts` (comment), `scripts/test-live.ts`, `docs/commands.md`, `docs/gameplay.md`, `README.md`, `CLAUDE.md`
- Test: `tests/emoji-assets.test.ts` (existing pixel gate — no edits unless the black-share threshold trips) + `tests/emojis.test.ts` (WILL go red until edited: it pins `Object.keys(EMOJI_FALLBACK).sort()` to an exact 38-name array) + `tests/docs-assets.test.ts` (asserts every "N emojis" count in docs/ops.md and docs/assets/prompts.md equals the committed SVG count)

- [ ] **Step 1: Author the three SVGs** — 128×128 viewBox, flat fills or `userSpaceOnUse` gradients only (the resvg `objectBoundingBox` ellipse gotcha), no pure `#000000` beyond the 2% gate. Concepts: `dw_quest` = a target/scroll in the dw gold-brown palette; `dw_streak` = a stylized orange-red flame; `dw_chest` = a wooden chest with gold trim. Match the drawing style of the existing `assets/emojis/svg/dw_*.svg` files (read two before drawing).

- [ ] **Step 2: Build + gate** — `npm run build-emojis`, then `npx vitest run tests/emoji-assets.test.ts` → PASS (transparent 128×128, black-share under 2%).

- [ ] **Step 3: Register fallbacks and fix the count gates** — add to `EMOJI_FALLBACK`: `dw_quest: '🎯'`, `dw_streak: '🔥'`, `dw_chest: '🎁'`. Then: extend `tests/emojis.test.ts`'s pinned key array with the three new names (kept sorted) and update its "38" wording to 41; update every "38 … emojis" phrase in `docs/ops.md` (twice) and `docs/assets/prompts.md` to 41 — `tests/docs-assets.test.ts` enforces both docs against the committed SVG count.

- [ ] **Step 4: Prompts + stale comments.** Add generation-prompt rows to `docs/assets/prompts.md` for `banners/daily.webp` and `banners/achievements.webp` (match the existing banner prompt format; 1536×1024; the banners themselves are generated later — `assetImage` null-degrades until then, and the `daily` help topic stays art-less per Task 10; when the daily banner is eventually committed, add the topic's `art` descriptor and append `'daily'` to `tests/help.test.ts`'s covered list — record that follow-up in the operator-steps section of this plan's commit) and for the three emojis. Update `src/data/sell.ts`'s cap rationale comment and `src/data/breeding.ts`'s Mythic-pace comment to account for the new quest/chest/achievement faucets (spec §4 numbers: ~12 shards/day EV from quests, one-time pools; zero-sell Mythic ≈ 28–30 days).

- [ ] **Step 5: Docs.** `docs/commands.md`: add `/daily` and `/achievements` rows. `docs/gameplay.md`: a Daily Loop section (quests, streak, chests, achievements — player-facing numbers). `README.md`: bump the command/module counts. `CLAUDE.md`: append a short daily-loop convention block (substrate = `track()` in-txn only; quest progress derived from baselines, never stored; roller hard rules; personal-best chests; hint hook exemptions; `adminReset`/fast-forward coverage).

- [ ] **Step 6: test:live cases.** Extend `scripts/test-live.ts` following its existing seeding + case pattern: a `/daily` hub case (seed a user with a rolled board, one quest complete), a claim-reply case, and an `/achievements` page-1 case. REST-only, no gateway login.

- [ ] **Step 7: Full verification** — `npm test`, `npm run typecheck`, `npm run build` → all green.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "Add daily-loop emojis, prompts, docs, and live gallery cases"`

---

## Operator steps after merge (not part of the plan's execution)

1. `npm run deploy-commands` — 22 → 24 (plus the changed `/help` builder). One bot instance per token.
2. `npm run deploy-emojis` — 3 new emojis; commit the updated `assets/emojis/manifest.json` immediately after.
3. `npm run test:live` — visual check of the new gallery cases.
4. Generate the two banners from `docs/assets/prompts.md` when convenient — absent art degrades cleanly. When `banners/daily.webp` lands, also add `art: { kind: 'banners', name: 'daily' }` to the `daily` HELP_TOPICS entry and append `'daily'` to `tests/help.test.ts`'s covered-topics list (deferred from Task 10 because that test requires declared art to ship its file).
