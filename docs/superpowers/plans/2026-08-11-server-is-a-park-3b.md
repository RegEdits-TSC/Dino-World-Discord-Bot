# Exhibition Duels (Spec 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship player-versus-player exhibition duels — free, Elo-rated, in two formats (async ghost, live challenge) — on top of the existing fight engine, plus a sixth `/top` metric.

**Architecture:** Two pure data-layer files (`elo.ts`, `duel.ts`) hold all the maths and have no clock, no db and no Discord types. One service (`src/modules/duels/service.ts`) resolves a duel inside a single transaction that writes exactly two things: both players' ratings and one immutable log row. One embed file renders a single result embed — no cinematic, no frame loop. Everything else (win/loss record, per-pair cooldown, double-accept idempotency) is **derived at read time** from the log, the same philosophy as escrow locks and quest progress.

**Tech Stack:** TypeScript ESM (NodeNext — every relative import ends in `.js`), discord.js v14 builders, drizzle-orm over better-sqlite3 (synchronous: `.get()` / `.all()` / `.run()`, never awaited), vitest.

## Global Constraints

These apply to **every** task. They are repo rules, not preferences.

- **ESM NodeNext**: every relative import carries a `.js` extension.
- **Time is `ctx.now()`, randomness is `ctx.rng()`** — never `Date.now()` or `Math.random()`.
- **DB access is synchronous** — `.get()`, `.all()`, `.run()`. Never `await` a query.
- **No attribution anywhere.** Commit messages, code comments and docs never mention Claude, AI, an assistant, or a tool. Commits use the existing git identity; no `Co-Authored-By` trailer, no "Generated with" footer.
- **Duels are free.** No energy, cash, shards, XP or campaign progress is read or written by any code in this plan. If a task seems to need one, stop — it is a design error, not an implementation detail.
- **Elo is a plain integer**, not stored ×100 like `parkRating`. Never divide it for display.
- **Every user-facing reject is a `DuelError`**, answered ephemerally.
- **`statsFor(speciesId, level, traits)` takes traits for BOTH duel sides.** Its `traits` parameter defaults to `[]` for NPCs; omitting it in a duel silently strips every combat trait with no type error and no test failure.
- Run `npm run typecheck` (not just `npm test`) before every commit that touches `tests/` or `scripts/` — `npm run build` excludes tests and vitest does not typecheck.
- Tests never hand-compute a fight outcome. The engine draws exactly two rng values per attack (variance, then crit) and damage floors at 1 *before* the crit multiplier. Assert relationships, or pin a number produced by an executed run.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/data/battle/elo.ts` | Pure Elo: expected score and signed delta. No clock, no db. |
| `src/data/battle/duel.ts` | Pure duel types + `outcomeFor` (BattleResult → win/loss/draw from the challenger's view). |
| `src/modules/duels/service.ts` | Squad resolution, cooldown/idempotency reads, `resolveDuel`'s transaction, the record view, the defender notification. |
| `src/modules/duels/embeds.ts` | The result embed, the challenge card, the record embed, and every customId (one prefix constant). |
| `src/modules/duels/index.ts` | The `/duel` builder, its four subcommands, the autocomplete provider, the `duel` component handler. |
| `drizzle/0013_duels.sql` | Two `users` columns + the `duels` table. Generated, then read by eye. |
| `tests/elo.test.ts` | Pure Elo, including the zero-sum rounding case. |
| `tests/duels.test.ts` | Everything else: resolver, outcomes, transaction, cooldown, guards, buttons, record, notification. |

**Modified:** `src/core/db/schema.ts`, `src/core/module-list.ts`, `modules.json`, `src/data/battle/constants.ts`, `src/modules/leaderboards/{service,index}.ts`, `src/modules/admin/service.ts`, `src/modules/park/index.ts` (alerts copy), `src/modules/help/index.ts`, `scripts/test-live.ts`, `tests/{registry-load,config,contract,leaderboards,admin,migration,help}.test.ts`, `docs/{gameplay,commands,ops}.md`, `README.md`.

---

## Task 1: Pure Elo

**Files:**
- Create: `src/data/battle/elo.ts`
- Modify: `src/data/battle/constants.ts` (append four constants)
- Test: `tests/elo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `expectedScore(mine: number, theirs: number): number`, `eloDelta(mine: number, theirs: number, score: DuelScore): number`, `type DuelScore = 1 | 0.5 | 0`, and the constants `DUEL_K`, `DUEL_START_RATING`, `DUEL_PAIR_COOLDOWN_MS`, `DUEL_CHALLENGE_TTL_MS`.

- [ ] **Step 1: Write the failing test**

Create `tests/elo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { expectedScore, eloDelta } from '../src/data/battle/elo.js';
import { DUEL_K, DUEL_START_RATING } from '../src/data/battle/constants.js';

describe('elo', () => {
  it('gives equal ratings an even expectation', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
  });

  it('is symmetric: the two expectations always sum to 1', () => {
    for (const [a, b] of [[1000, 1000], [1200, 800], [1000, 1400], [1, 3000]]) {
      expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 12);
    }
  });

  it('pays a favourite almost nothing for beating a much weaker opponent', () => {
    expect(eloDelta(1400, 1000, 1)).toBeLessThanOrEqual(3);
    expect(eloDelta(1400, 1000, 1)).toBeGreaterThan(0);
  });

  it('costs a favourite heavily for losing to a much weaker opponent', () => {
    expect(eloDelta(1400, 1000, 0)).toBeLessThan(-DUEL_K / 2);
  });

  it('moves nobody on a draw between equals', () => {
    expect(eloDelta(1000, 1000, 0.5)).toBe(0);
  });

  it('pays the underdog for a draw and charges the favourite the same', () => {
    const under = eloDelta(1000, 1400, 0.5);
    expect(under).toBeGreaterThan(0);
    expect(eloDelta(1400, 1000, 0.5)).toBe(-under);
  });

  // The zero-sum invariant. Rounding each side independently does NOT conserve
  // points: Math.round(2.5) is 3 but Math.round(-2.5) is -2. Callers must compute
  // one delta and apply its negation, and this test is what proves the helper is
  // safe to use that way — every pairing here returns exactly opposite values.
  it('conserves points across every pairing, including half-point cases', () => {
    for (let a = 600; a <= 1600; a += 37) {
      for (let b = 600; b <= 1600; b += 53) {
        expect(eloDelta(a, b, 1)).toBe(-eloDelta(b, a, 0));
        expect(eloDelta(a, b, 0.5)).toBe(-eloDelta(b, a, 0.5));
      }
    }
  });

  it('never returns a fractional rating change', () => {
    expect(Number.isInteger(eloDelta(1000, 1017, 1))).toBe(true);
    expect(Number.isInteger(eloDelta(DUEL_START_RATING, 993, 0))).toBe(true);
  });

  it('asymptotes rather than flooring: a 400-point underdog loses very little', () => {
    expect(eloDelta(600, 1000, 0)).toBeGreaterThanOrEqual(-4);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/elo.test.ts`
Expected: FAIL — `Failed to resolve import "../src/data/battle/elo.js"`.

- [ ] **Step 3: Append the constants**

In `src/data/battle/constants.ts`, after `FIGHT_FRAME_DELAY_MS`:

```ts

// --- Duels (spec 3b). Duels are free: no energy constant belongs here. ---
export const DUEL_K = 32;
export const DUEL_START_RATING = 1000;
// Directional, ghost-path only: you cannot re-ghost the same defender inside this
// window; they can counter-attack you instantly. Derived from the duels log at read
// time — nothing sweeps.
export const DUEL_PAIR_COOLDOWN_MS = 6 * 3_600_000;
// How long a posted /duel challenge stays clickable. The expiry instant is baked
// into the button's customId, so no pending-challenge row is ever stored.
export const DUEL_CHALLENGE_TTL_MS = 15 * 60_000;
```

- [ ] **Step 4: Write `src/data/battle/elo.ts`**

```ts
import { DUEL_K } from './constants.js';

/** 1 = win, 0.5 = draw, 0 = loss — always from the scored player's own side. */
export type DuelScore = 1 | 0.5 | 0;

/** Probability the `mine` rating beats the `theirs` rating, on the standard curve. */
export function expectedScore(mine: number, theirs: number): number {
  return 1 / (1 + 10 ** ((theirs - mine) / 400));
}

/**
 * The signed rating change for the player whose rating is `mine`.
 *
 * ZERO-SUM CONTRACT: a caller must compute ONE delta and apply its negation to the
 * opponent. Rounding both sides independently does not conserve points, because
 * Math.round(2.5) is 3 while Math.round(-2.5) is -2 — a half-point pairing would
 * mint or burn a point per duel and the whole pool would drift.
 *
 * Deliberately unfloored: a floor would break the same conservation, and a
 * non-negative CHECK on the column would turn a losing streak into a crash rather
 * than a low number. The curve self-limits — 400 points behind, a loss costs 3.
 */
export function eloDelta(mine: number, theirs: number, score: DuelScore): number {
  return Math.round(DUEL_K * (score - expectedScore(mine, theirs)));
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/elo.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/data/battle/elo.ts src/data/battle/constants.ts tests/elo.test.ts
git commit -m "feat(duels): add the pure Elo helper and duel constants"
```

---

## Task 2: Schema, migration 0013, and its production-path test

**Files:**
- Modify: `src/core/db/schema.ts` (two `users` columns; new `duels` table at the end of the file)
- Create: `drizzle/0013_duels.sql` + `drizzle/meta/0013_snapshot.json` + a `drizzle/meta/_journal.json` entry (all three generated by drizzle-kit)
- Test: `tests/migration.test.ts` (new describe block appended)

**Interfaces:**
- Consumes: `DUEL_START_RATING` from Task 1 (used only as the documented default value 1000; the SQL literal is written out).
- Produces: `schema.duels` with columns `id, challengerId, defenderId, mode, result, eloDelta, createdAt`; `schema.users.duelRating` (integer, default 1000) and `schema.users.duelSquad` (json `number[]`, default `[]`).

- [ ] **Step 1: Write the failing test**

Append to `tests/migration.test.ts` (end of file). Note the regex and the idx filter widen **together** — 0012's block uses `1[01]` / `<= 11`, so 0013 uses `1[0-2]` / `<= 12`:

```ts
describe('0013 duels via the real drizzle migrator (production path)', () => {
  it('adds duel_rating and duel_squad, creates duels, and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig13-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together. Copy-pasting 0012's
    // /^00(0[0-9]|1[01]).*\.sql$/ here would omit 0012 from the scratch folder while
    // every assertion below still passed — green for the wrong reason, against a
    // 0011 baseline.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[0-2]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 12);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0012 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u2', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      // Existing rows pick up the defaults rather than NULL: every reader in src/
      // treats duel_squad as an array and duel_rating as a number.
      const rows = sqlite.prepare(`SELECT discord_id, duel_rating, duel_squad FROM users ORDER BY discord_id`).all();
      expect(rows).toEqual([
        { discord_id: 'u1', duel_rating: 1000, duel_squad: '[]' },
        { discord_id: 'u2', duel_rating: 1000, duel_squad: '[]' },
      ]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
      // The log is real and two-sided.
      sqlite.prepare(`INSERT INTO duels (challenger_id, defender_id, mode, result, elo_delta, created_at_ms)
                      VALUES ('u1', 'u2', 'ghost', 'win', 16, 0)`).run();
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM duels`).get() as { c: number }).c).toBe(1);
      // Both sides carry a real foreign key to users: a duel naming nobody is not a
      // state the game can reach, unlike featured_dino_id, which deliberately has none.
      expect(() => sqlite.prepare(`INSERT INTO duels (challenger_id, defender_id, mode, result, elo_delta, created_at_ms)
                                   VALUES ('u1', 'nobody', 'ghost', 'win', 16, 0)`).run()).toThrow();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/migration.test.ts -t 0013`
Expected: FAIL — `no such column: duel_rating` (0013 does not exist yet).

- [ ] **Step 3: Edit the schema**

In `src/core/db/schema.ts`, inside `users`, immediately after the `featuredDinoId` block and before `lastCollectAt`:

```ts
  // Elo, the ONE thing spec 3b stores that cannot be derived: it is order-dependent,
  // so replaying the duels log cannot rebuild it. A plain integer, never ×100 like
  // parkRating. Deliberately no CHECK constraint — see src/data/battle/elo.ts.
  duelRating: integer('duel_rating').notNull().default(DUEL_START_RATING),
  // The squad this player fields in duels, or [] to fall back to their top 3 by level.
  // No foreign key, same reasoning as featuredDinoId above: a listed dino can be sold,
  // traded away or reset, and a dangling id must resolve to "not in my squad" rather
  // than error. duelSquad() filters at read time; nothing sweeps this column.
  duelSquad: text('duel_squad', { mode: 'json' }).$type<number[]>().notNull().default([]),
```

Add the import at the top of the file (after the existing two import lines):

```ts
import { DUEL_START_RATING } from '../../data/battle/constants.js';
```

At the **end** of `src/core/db/schema.ts`, after `speciesSeen`:

```ts
// One row per resolved duel, inserted once and never updated. Everything else the
// duel feature needs is derived from it at read time: the win/loss/draw record
// (count rows on either side), the per-pair cooldown (max created_at_ms for an
// ordered pair), and the double-accept guard for a live challenge. There is no
// status column and nothing sweeps this table.
//   result:   ALWAYS from the challenger's side, so no reader has to flip it.
//   eloDelta: the challenger's signed change; the defender's is its exact negation.
export const duels = sqliteTable('duels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  challengerId: text('challenger_id').notNull().references(() => users.discordId),
  defenderId: text('defender_id').notNull().references(() => users.discordId),
  mode: text('mode', { enum: ['ghost', 'live'] }).notNull(),
  result: text('result', { enum: ['win', 'loss', 'draw'] }).notNull(),
  eloDelta: integer('elo_delta').notNull(),
  createdAt: integer('created_at_ms').notNull(),
});
```

- [ ] **Step 4: Generate the migration, then READ IT**

```bash
npx drizzle-kit generate --name=duels
```

This must produce three artifacts: `drizzle/0013_duels.sql`, `drizzle/meta/0013_snapshot.json`, and a new `_journal.json` entry with `"idx": 13`, `"tag": "0013_duels"`, and a `when` greater than 0012's `1786409357482` — drizzle applies in journal `when` order, and a smaller value silently never runs on a database that already applied 0012. Never hand-write the snapshot or the journal; the snapshot is the diff base for 0014.

Open `drizzle/0013_duels.sql` and confirm it contains only `CREATE TABLE ... duels` plus two `ALTER TABLE \`users\` ADD` statements, separated by `--> statement-breakpoint`. Expected shape:

```sql
CREATE TABLE `duels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challenger_id` text NOT NULL,
	`defender_id` text NOT NULL,
	`mode` text NOT NULL,
	`result` text NOT NULL,
	`elo_delta` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`challenger_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`defender_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `users` ADD `duel_rating` integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `duel_squad` text DEFAULT '[]' NOT NULL;
```

**If instead it emits a `__new_users` table-recreate** (`CREATE TABLE __new_users` / `INSERT INTO __new_users SELECT` / `DROP TABLE users`): delete the generated `.sql`, hand-write the two `ALTER TABLE ... ADD` lines plus the `CREATE TABLE duels` above, and **keep** the generated snapshot and journal entry. A well-formed recreate passes the entire test suite because `migrateDb`'s FK bracket saves it, so reading this file is the only gate.

The file ends at the final `;` with **no trailing newline**, matching 0011 and 0012.

- [ ] **Step 5: Run the migration test and the full suite**

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS, including the new 0013 block.

Run: `npm test`
Expected: PASS. (`makeCtx` runs `migrateDb` on an in-memory DB, so every existing test exercises 0013 too.)

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/core/db/schema.ts drizzle/0013_duels.sql drizzle/meta tests/migration.test.ts
git commit -m "feat(duels): add the duels log table and the two duel columns on users"
```

---

## Task 3: Squad resolution

**Files:**
- Create: `src/modules/duels/service.ts`
- Test: `tests/duels.test.ts`

**Interfaces:**
- Consumes: `schema.users.duelSquad` (Task 2), `toClockDinos` (`src/modules/park/service.ts`), `escapeMoment` (`src/core/clock.ts`), `battleLevel` (`src/data/battle/stats.ts`), `getSpecies`.
- Produces:
  - `class DuelError extends Error {}`
  - `interface DuelSquadMember { dinoId: number; name: string; speciesId: string; archetype: string; diet: string; level: number; traits: string[] }`
  - `function duelSquad(ctx: Ctx, userId: string): DuelSquadMember[]` — throws `DuelError`, never returns `[]`.
  - `function setDuelSquad(ctx: Ctx, userId: string, dinoIds: number[]): DuelSquadMember[]` — `[]` clears back to auto and returns the auto squad.

- [ ] **Step 1: Write the failing test**

Create `tests/duels.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { duelSquad, setDuelSquad, DuelError } from '../src/modules/duels/service.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

/** Insert a dino for `user` and return its row id. `.returning().get()` is the repo idiom. */
function addDino(user: string, speciesId: string, battleXp = 0): number {
  return ctx.db.insert(schema.dinos)
    .values({ userId: user, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, battleXp })
    .returning().get().id;
}

describe('duelSquad', () => {
  it('auto-picks the top three by battle level, highest first', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const weak = addDino('a', 'triceratops', 0);
    const mid = addDino('a', 'triceratops', 700);
    const strong = addDino('a', 'triceratops', 3200);
    const fourth = addDino('a', 'triceratops', 100);
    const squad = duelSquad(ctx, 'a');
    expect(squad.map((m) => m.dinoId)).toEqual([strong, mid, fourth]);
    expect(squad.some((m) => m.dinoId === weak)).toBe(false);
  });

  it('breaks equal-XP ties by id ascending, with no rng', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const first = addDino('a', 'triceratops', 500);
    const second = addDino('a', 'triceratops', 500);
    const third = addDino('a', 'triceratops', 500);
    addDino('a', 'triceratops', 500);
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([first, second, third]);
  });

  it('prefers an explicitly set squad over the auto pick', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const weak = addDino('a', 'triceratops', 0);
    addDino('a', 'triceratops', 3200);
    setDuelSquad(ctx, 'a', [weak]);
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([weak]);
  });

  it('drops a stale id from a set squad and keeps the rest', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const kept = addDino('a', 'triceratops', 0);
    const sold = addDino('a', 'triceratops', 0);
    setDuelSquad(ctx, 'a', [kept, sold]);
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.id, sold)).run();
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([kept]);
  });

  it('falls back to auto when every id in the set squad is gone', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const gone = addDino('a', 'triceratops', 0);
    setDuelSquad(ctx, 'a', [gone]);
    const live = addDino('a', 'triceratops', 3200);
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.id, gone)).run();
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([live]);
  });

  it('excludes an escaped dino', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const fit = addDino('a', 'triceratops', 0);
    const escaped = addDino('a', 'triceratops', 3200);
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, escaped)).run();
    expect(duelSquad(ctx, 'a').map((m) => m.dinoId)).toEqual([fit]);
  });

  it('throws for a player with no eligible dinos', () => {
    getOrCreateUser(ctx, 'a', 'A');
    expect(() => duelSquad(ctx, 'a')).toThrow(DuelError);
  });

  it('throws for a player with no park row at all', () => {
    expect(() => duelSquad(ctx, 'ghost-user')).toThrow(DuelError);
  });

  it('carries the archetype and diet the art is keyed on', () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', 'triceratops', 0);
    const [lead] = duelSquad(ctx, 'a');
    expect(lead.archetype).toBeTruthy();
    expect(lead.diet).toBeTruthy();
    expect(lead.level).toBe(1);
  });
});

describe('setDuelSquad', () => {
  it('rejects a dino the caller does not own', () => {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
    addDino('a', 'triceratops', 0);
    const theirs = addDino('b', 'triceratops', 0);
    expect(() => setDuelSquad(ctx, 'a', [theirs])).toThrow(DuelError);
  });

  it('rejects the same dino listed twice', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const one = addDino('a', 'triceratops', 0);
    expect(() => setDuelSquad(ctx, 'a', [one, one])).toThrow(/once per squad/);
  });

  it('rejects an escaped dino at set time', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const escaped = addDino('a', 'triceratops', 0);
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, escaped)).run();
    expect(() => setDuelSquad(ctx, 'a', [escaped])).toThrow(DuelError);
  });

  it('rejects more than three', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const ids = [0, 0, 0, 0].map(() => addDino('a', 'triceratops', 0));
    expect(() => setDuelSquad(ctx, 'a', ids)).toThrow(/at most 3/);
  });

  it('clears back to auto when passed an empty list', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const weak = addDino('a', 'triceratops', 0);
    const strong = addDino('a', 'triceratops', 3200);
    setDuelSquad(ctx, 'a', [weak]);
    const cleared = setDuelSquad(ctx, 'a', []);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!.duelSquad).toEqual([]);
    expect(cleared.map((m) => m.dinoId)).toEqual([strong, weak]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts`
Expected: FAIL — `Failed to resolve import "../src/modules/duels/service.js"`.

- [ ] **Step 3: Write `src/modules/duels/service.ts`**

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import { battleLevel } from '../../data/battle/stats.js';
import { escapeMoment } from '../../core/clock.js';
import { toClockDinos } from '../park/service.js';

export class DuelError extends Error {}

export const MAX_DUEL_SQUAD = 3;

/** One combatant as the duel surfaces see it. `archetype`/`diet` are the art key. */
export interface DuelSquadMember {
  dinoId: number; name: string; speciesId: string;
  archetype: string; diet: string; level: number; traits: string[];
}

type DinoRow = typeof schema.dinos.$inferSelect;

function toMember(d: DinoRow): DuelSquadMember {
  const sp = getSpecies(d.speciesId);
  return {
    dinoId: d.id, name: d.nickname ?? sp.name, speciesId: d.speciesId,
    archetype: sp.archetype, diet: sp.diet, level: battleLevel(d.battleXp), traits: d.traits,
  };
}

/**
 * Every dino this player could field right now, escaped ones removed.
 *
 * Escape is evaluated READ-ONLY, via escapeMoment. settleEscapes writes, and a duel
 * resolves the DEFENDER's squad from a command they never ran — stamping their rows
 * there would break the documented rule that escapes settle only when a command
 * touches your park (the same rule the alert sweep refuses to break). A challenger's
 * own path calls settleEscapes in the command layer before reaching here.
 */
function eligibleDinos(ctx: Ctx, userId: string): DinoRow[] {
  // toClockDinos asserts the users row exists (.get()!), so guard it first.
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) throw new DuelError('That player has no park yet.');
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  const now = ctx.now();
  return dinos.filter((_, k) => escapeMoment(clockDinos[k], now) === null);
}

/**
 * The squad a player fields: their explicitly set one if any of it survives, else
 * their top 3 by battle XP (ties by id ascending — deterministic, no rng).
 *
 * Stale ids self-heal here rather than being swept, the same tolerance featuredFor
 * gives a sold featured dino: this is a read path and must stay one.
 */
export function duelSquad(ctx: Ctx, userId: string): DuelSquadMember[] {
  const eligible = eligibleDinos(ctx, userId);
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  const byId = new Map(eligible.map((d) => [d.id, d]));
  const chosen = user.duelSquad
    .map((id) => byId.get(id))
    .filter((d): d is DinoRow => d !== undefined);
  const roster = chosen.length
    ? chosen
    : [...eligible].sort((a, b) => b.battleXp - a.battleXp || a.id - b.id);
  const squad = roster.slice(0, MAX_DUEL_SQUAD).map(toMember);
  if (!squad.length) throw new DuelError('That player has no battle-ready dinos.');
  return squad;
}

/**
 * Store a squad, or clear it with an empty list. Validated at the boundary AND
 * filtered at read time: set-time validation makes a typo a visible error, and
 * read-time filtering handles a dino sold after it was set, which no amount of
 * set-time checking can prevent.
 */
export function setDuelSquad(ctx: Ctx, userId: string, dinoIds: number[]): DuelSquadMember[] {
  if (dinoIds.length > MAX_DUEL_SQUAD) throw new DuelError(`A duel squad holds at most ${MAX_DUEL_SQUAD} dinos.`);
  if (new Set(dinoIds).size !== dinoIds.length) throw new DuelError('Each dino can only fight once per squad.');
  const eligible = new Map(eligibleDinos(ctx, userId).map((d) => [d.id, d]));
  for (const id of dinoIds) {
    if (!eligible.has(id)) throw new DuelError(`#${id} is not one of your battle-ready dinos.`);
  }
  ctx.db.update(schema.users).set({ duelSquad: dinoIds })
    .where(eq(schema.users.discordId, userId)).run();
  return duelSquad(ctx, userId);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/duels.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/duels/service.ts tests/duels.test.ts
git commit -m "feat(duels): resolve a duel squad from an explicit set or the top three"
```

---

## Task 4: The duel core — outcome mapping and `resolveDuel`

**Files:**
- Create: `src/data/battle/duel.ts`
- Modify: `src/modules/duels/service.ts` (add `resolveDuel`)
- Test: `tests/duels.test.ts` (append two describes)

**Interfaces:**
- Consumes: `duelSquad`, `DuelSquadMember`, `DuelError` (Task 3); `eloDelta` (Task 1); `resolveBattle`, `Combatant`, `BattleResult`, `BeatSummary` (`src/data/battle/resolve.ts`); `statsFor`, `battleLevel`.
- Produces:
  - `type DuelResult = 'win' | 'loss' | 'draw'`, `type DuelMode = 'ghost' | 'live'` (in `src/data/battle/duel.ts`)
  - `function outcomeFor(result: BattleResult, side0IsChallenger: boolean): DuelResult`
  - `interface DuelOutcome` (fields listed in the code below)
  - `function resolveDuel(ctx: Ctx, challengerId: string, defenderId: string, mode: DuelMode, challengeExpiresAtMs?: number): DuelOutcome`

- [ ] **Step 1: Write the failing test**

Append to `tests/duels.test.ts`. Add these imports to the top of the file:

```ts
import { allSpecies } from '../src/data/species/index.js';
import { outcomeFor } from '../src/data/battle/duel.js';
import { resolveDuel } from '../src/modules/duels/service.js';
import type { BattleResult } from '../src/data/battle/resolve.js';
```

Then append:

```ts
describe('outcomeFor', () => {
  const base: BattleResult = {
    won: false, rounds: 30, squadKos: 0, squadSurvivors: [],
    beats: [{ title: 'Opening clash', lines: ['x'] }, { title: 'The climax', lines: ['y'] }],
    finalHp: {},
  };

  it('reads a side-0 win as a challenger win when the challenger is side 0', () => {
    expect(outcomeFor({ ...base, won: true, squadSurvivors: ['d1'] }, true)).toBe('win');
  });

  it('reads a side-0 win as a challenger LOSS when the defender is side 0', () => {
    expect(outcomeFor({ ...base, won: true, squadSurvivors: ['d1'] }, false)).toBe('loss');
  });

  // The only correct draw inference. `rounds === MAX_ROUNDS` is not equivalent — a
  // fight can be decided on the last round — and no squadKos test is equivalent either.
  it('reads survivors on a non-win as a draw, whichever side the challenger is', () => {
    expect(outcomeFor({ ...base, won: false, squadSurvivors: ['d1'] }, true)).toBe('draw');
    expect(outcomeFor({ ...base, won: false, squadSurvivors: ['d1'] }, false)).toBe('draw');
  });

  it('reads a wiped side 0 as a win for the other side', () => {
    expect(outcomeFor({ ...base, won: false, squadSurvivors: [] }, true)).toBe('loss');
    expect(outcomeFor({ ...base, won: false, squadSurvivors: [] }, false)).toBe('win');
  });
});

describe('resolveDuel', () => {
  const strong = allSpecies().find((s) => s.rarity === 'legendary')!;
  const weak = allSpecies().find((s) => s.rarity === 'common')!;

  function pair(): void {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
  }

  it('is zero-sum: the defender loses exactly what the challenger gains', () => {
    pair();
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    const out = resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(out.ratingAfter.challenger + out.ratingAfter.defender)
      .toBe(out.ratingBefore.challenger + out.ratingBefore.defender);
    expect(out.ratingAfter.challenger - out.ratingBefore.challenger).toBe(out.eloDelta);
    expect(out.ratingAfter.defender - out.ratingBefore.defender).toBe(-out.eloDelta);
  });

  it('persists both ratings and exactly one log row', () => {
    pair();
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    const out = resolveDuel(ctx, 'a', 'b', 'ghost');
    const rowA = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!;
    const rowB = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'b')).get()!;
    expect(rowA.duelRating).toBe(out.ratingAfter.challenger);
    expect(rowB.duelRating).toBe(out.ratingAfter.defender);
    const log = ctx.db.select().from(schema.duels).all();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      challengerId: 'a', defenderId: 'b', mode: 'ghost',
      result: out.result, eloDelta: out.eloDelta,
    });
  });

  it('a heavily outmatched defender loses', () => {
    pair();
    addDino('a', strong.id, 3200);
    addDino('a', strong.id, 3200);
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    expect(resolveDuel(ctx, 'a', 'b', 'ghost').result).toBe('win');
  });

  it('pays nothing but a record — no cash, shards, energy or XP moves', () => {
    pair();
    const mine = addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    const before = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!;
    resolveDuel(ctx, 'a', 'b', 'ghost');
    const after = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!;
    expect(after.cash).toBe(before.cash);
    expect(after.shards).toBe(before.shards);
    expect(after.energy).toBe(before.energy);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, mine)).get()!.battleXp).toBe(3200);
    expect(ctx.db.select().from(schema.battleProgress).all()).toEqual([]);
  });

  it('reports both squads and both survivor counts', () => {
    pair();
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    const out = resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(out.squads.challenger).toHaveLength(1);
    expect(out.squads.defender).toHaveLength(1);
    expect(out.survivors.challenger).toBeGreaterThanOrEqual(0);
    expect(out.survivors.defender).toBeGreaterThanOrEqual(0);
    expect(out.names).toEqual({ challenger: 'A', defender: 'B' });
    expect(out.beats).toHaveLength(2);
  });

  it('refuses a defender with no park row', () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', strong.id, 0);
    expect(() => resolveDuel(ctx, 'a', 'nobody', 'ghost')).toThrow(/no park yet/);
  });

  it('refuses when the challenger has no battle-ready dinos', () => {
    pair();
    addDino('b', weak.id, 0);
    expect(() => resolveDuel(ctx, 'a', 'b', 'ghost')).toThrow(/battle-ready/);
  });

  // Side 0 gets a free first strike on every speed tie (resolveBattle sorts by
  // spd desc, then side asc), so the coin flip is what stops a mirror match being
  // decided by argument order. Both branches must be reachable from ctx.rng.
  it('flips a coin for side 0 rather than always seating the challenger first', () => {
    const seen = new Set<boolean>();
    for (const first of [true, false]) {
      const c = makeCtx({ rng: () => (first ? 0.1 : 0.9) });
      getOrCreateUser(c, 'a', 'A'); getOrCreateUser(c, 'b', 'B');
      for (const u of ['a', 'b']) {
        c.db.insert(schema.dinos)
          .values({ userId: u, speciesId: weak.id, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
      }
      seen.add(resolveDuel(c, 'a', 'b', 'ghost').challengerWasSideZero);
    }
    expect(seen).toEqual(new Set([true, false]));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts -t resolveDuel`
Expected: FAIL — `Failed to resolve import "../src/data/battle/duel.js"`.

- [ ] **Step 3: Write `src/data/battle/duel.ts`**

```ts
import type { BattleResult } from './resolve.js';

/** Always from the challenger's side, matching the `duels.result` column. */
export type DuelResult = 'win' | 'loss' | 'draw';
export type DuelMode = 'ghost' | 'live';

/**
 * Read a duel outcome off a BattleResult.
 *
 * BattleResult has no `draw` field and `won: false` covers two different endings —
 * side 0 wiped, and both sides still standing when MAX_ROUNDS ran out. The only
 * correct draw inference is "side 0 did not win but still has survivors", because
 * `won` already requires every side-1 combatant to be dead. `rounds === MAX_ROUNDS`
 * is NOT equivalent (a fight can be decided on the final round) and neither is any
 * squadKos comparison.
 *
 * Note also that `won`, `squadKos` and `squadSurvivors` are all side-0 only, which
 * is why this takes which side the challenger held rather than reading it off the
 * result.
 */
export function outcomeFor(result: BattleResult, side0IsChallenger: boolean): DuelResult {
  const side0: DuelResult = result.won ? 'win' : result.squadSurvivors.length > 0 ? 'draw' : 'loss';
  if (side0 === 'draw' || side0IsChallenger) return side0;
  return side0 === 'win' ? 'loss' : 'win';
}
```

- [ ] **Step 4: Add `resolveDuel` to `src/modules/duels/service.ts`**

Extend the import block:

```ts
import { and, eq, or } from 'drizzle-orm';
import { statsFor } from '../../data/battle/stats.js';
import { resolveBattle, type BeatSummary, type Combatant } from '../../data/battle/resolve.js';
import { outcomeFor, type DuelMode, type DuelResult } from '../../data/battle/duel.js';
import { eloDelta } from '../../data/battle/elo.js';
```

(keep the existing `eq` import — merge it into the one `drizzle-orm` line above).

Append:

```ts
/** Everything the surfaces need. `result` and `eloDelta` are the challenger's. */
export interface DuelOutcome {
  challengerId: string; defenderId: string; mode: DuelMode;
  names: { challenger: string; defender: string };
  result: DuelResult;
  eloDelta: number;
  ratingBefore: { challenger: number; defender: number };
  ratingAfter: { challenger: number; defender: number };
  squads: { challenger: DuelSquadMember[]; defender: DuelSquadMember[] };
  survivors: { challenger: number; defender: number };
  beats: [BeatSummary, BeatSummary];
  rounds: number;
  challengerWasSideZero: boolean;
  /** Read from the defender's row here so the caller needs no second query. */
  defenderAlertsEnabled: boolean;
}

// Dino row ids are globally unique and nobody can duel themselves, so one key
// scheme is safe for both sides. finalHp is a flat record with no namespacing by
// side — two combatants sharing a key would silently collapse into one entry.
const keyOf = (m: DuelSquadMember) => `d${m.dinoId}`;

function combatants(squad: DuelSquadMember[], side: 0 | 1): Combatant[] {
  return squad.map((m) => {
    const s = statsFor(m.speciesId, m.level, m.traits);   // traits on BOTH sides, unlike PvE
    return {
      key: keyOf(m), name: m.name, speciesId: m.speciesId,
      archetype: m.archetype as Combatant['archetype'],
      maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, side,
    };
  });
}

/**
 * Resolve one duel and commit it. Writes exactly two things — both ratings and one
 * log row — in a single transaction that closes before any Discord call, so the
 * router's "nothing was charged" error path stays honest (commit-before-present).
 *
 * No world event reaches a duel: eventMods is sampled by hand in runFight and its
 * enemyHp term is meaningless in a symmetric match, where "the enemy" is whichever
 * player the coin flip happened to seat second.
 */
export function resolveDuel(
  ctx: Ctx, challengerId: string, defenderId: string, mode: DuelMode,
): DuelOutcome {
  const challenger = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, challengerId)).get();
  if (!challenger) throw new DuelError('You have no park yet.');
  const defender = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, defenderId)).get();
  if (!defender) throw new DuelError('That player has no park yet.');

  let mySquad: DuelSquadMember[];
  try {
    mySquad = duelSquad(ctx, challengerId);
  } catch {
    throw new DuelError('You have no battle-ready dinos — hatch or rescue one first.');
  }
  const theirSquad = duelSquad(ctx, defenderId);   // already phrased for the other player

  // Side 0 wins every initiative tie (resolveBattle sorts spd desc, then side asc,
  // then array index), and `side` is a field on each combatant rather than a
  // consequence of argument order — so without this flip the challenger would get a
  // free first strike in every mirror match.
  const challengerWasSideZero = ctx.rng() < 0.5;
  const mine = combatants(mySquad, challengerWasSideZero ? 0 : 1);
  const theirs = combatants(theirSquad, challengerWasSideZero ? 1 : 0);
  const battle = challengerWasSideZero
    ? resolveBattle(mine, theirs, ctx.rng)
    : resolveBattle(theirs, mine, ctx.rng);

  const result = outcomeFor(battle, challengerWasSideZero);
  const alive = (squad: DuelSquadMember[]) =>
    squad.filter((m) => (battle.finalHp[keyOf(m)] ?? 0) > 0).length;

  const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  // ONE delta, negated for the defender. Rounding each side independently would not
  // conserve points — see src/data/battle/elo.ts.
  const delta = eloDelta(challenger.duelRating, defender.duelRating, score);
  const ratingBefore = { challenger: challenger.duelRating, defender: defender.duelRating };
  const ratingAfter = {
    challenger: challenger.duelRating + delta,
    defender: defender.duelRating - delta,
  };
  const now = ctx.now();

  ctx.db.transaction(() => {
    ctx.db.update(schema.users).set({ duelRating: ratingAfter.challenger })
      .where(eq(schema.users.discordId, challengerId)).run();
    ctx.db.update(schema.users).set({ duelRating: ratingAfter.defender })
      .where(eq(schema.users.discordId, defenderId)).run();
    ctx.db.insert(schema.duels).values({
      challengerId, defenderId, mode, result, eloDelta: delta, createdAt: now,
    }).run();
  });

  return {
    challengerId, defenderId, mode,
    names: { challenger: challenger.displayName || challengerId, defender: defender.displayName || defenderId },
    result, eloDelta: delta, ratingBefore, ratingAfter,
    squads: { challenger: mySquad, defender: theirSquad },
    survivors: { challenger: alive(mySquad), defender: alive(theirSquad) },
    beats: battle.beats, rounds: battle.rounds,
    challengerWasSideZero,
    defenderAlertsEnabled: defender.alertsEnabled,
  };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/duels.test.ts`
Expected: PASS. If "a heavily outmatched defender loses" fails, do **not** weaken the assertion — widen the gap in the fixture (more dinos, higher XP) and re-run; the engine's rng stream is what it is.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/data/battle/duel.ts src/modules/duels/service.ts tests/duels.test.ts
git commit -m "feat(duels): resolve a duel, zero-sum, in one transaction"
```

---

## Task 5: The pair cooldown and the double-accept guard

**Files:**
- Modify: `src/modules/duels/service.ts`
- Test: `tests/duels.test.ts` (append one describe)

**Interfaces:**
- Consumes: `schema.duels` (Task 2), `resolveDuel` (Task 4), `DUEL_PAIR_COOLDOWN_MS` / `DUEL_CHALLENGE_TTL_MS` (Task 1).
- Produces: `resolveDuel` gains a fifth parameter `challengeExpiresAtMs?: number`; `function cooldownUntil(ctx: Ctx, challengerId: string, defenderId: string): number | null`.

- [ ] **Step 1: Write the failing test**

Append to `tests/duels.test.ts` (add `DUEL_PAIR_COOLDOWN_MS`, `DUEL_CHALLENGE_TTL_MS` to the constants import and `cooldownUntil` to the service import):

```ts
describe('duel pacing', () => {
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  function pairWithDinos(): void {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0);
    addDino('b', weak.id, 0);
  }

  it('refuses a second ghost duel against the same defender inside the window', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(() => resolveDuel(ctx, 'a', 'b', 'ghost')).toThrow(DuelError);
  });

  it('allows the ghost again once the window has passed', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'ghost');
    ctx.setNow(DUEL_PAIR_COOLDOWN_MS + 1);
    expect(() => resolveDuel(ctx, 'a', 'b', 'ghost')).not.toThrow();
  });

  // Directional: being ghosted does not stop you hitting back immediately.
  it('lets the defender counter-attack straight away', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(() => resolveDuel(ctx, 'b', 'a', 'ghost')).not.toThrow();
  });

  it('counts a live duel against the pair cooldown too', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'live', DUEL_CHALLENGE_TTL_MS);
    expect(() => resolveDuel(ctx, 'a', 'b', 'ghost')).toThrow(DuelError);
  });

  it('does not cool down the live path itself — the defender consented by clicking', () => {
    pairWithDinos();
    resolveDuel(ctx, 'a', 'b', 'live', DUEL_CHALLENGE_TTL_MS);
    expect(() => resolveDuel(ctx, 'a', 'b', 'live', 2 * DUEL_CHALLENGE_TTL_MS)).not.toThrow();
  });

  // A double-clicked Accept: i.update removes the buttons, but Discord can deliver
  // two clicks before that lands, and each would move Elo. The customId's expiry
  // stamp is the idempotency key — no stored challenge row anywhere.
  it('refuses a second accept of the SAME challenge', () => {
    pairWithDinos();
    const expiresAt = DUEL_CHALLENGE_TTL_MS;
    resolveDuel(ctx, 'a', 'b', 'live', expiresAt);
    expect(() => resolveDuel(ctx, 'a', 'b', 'live', expiresAt)).toThrow(/already/i);
    expect(ctx.db.select().from(schema.duels).all()).toHaveLength(1);
  });

  it('reports when a cooled-down pair frees up, and null when it is free now', () => {
    pairWithDinos();
    expect(cooldownUntil(ctx, 'a', 'b')).toBeNull();
    resolveDuel(ctx, 'a', 'b', 'ghost');
    expect(cooldownUntil(ctx, 'a', 'b')).toBe(DUEL_PAIR_COOLDOWN_MS);
    expect(cooldownUntil(ctx, 'b', 'a')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts -t "duel pacing"`
Expected: FAIL — `cooldownUntil is not a function`, and the cooldown tests fail because a second duel currently resolves fine.

- [ ] **Step 3: Implement both guards**

Add to the imports in `src/modules/duels/service.ts`:

```ts
import { DUEL_PAIR_COOLDOWN_MS } from '../../data/battle/constants.js';
```

Add above `resolveDuel`:

```ts
/**
 * When this ordered pair frees up, or null if it is free now. Derived: the newest
 * log row for (challenger → defender) plus the window. Two unindexed table filters,
 * filtered in SQL — the locksFor shape. Nothing sweeps, nothing is stored.
 */
export function cooldownUntil(ctx: Ctx, challengerId: string, defenderId: string): number | null {
  const rows = ctx.db.select().from(schema.duels)
    .where(and(eq(schema.duels.challengerId, challengerId), eq(schema.duels.defenderId, defenderId))).all();
  if (!rows.length) return null;
  const until = Math.max(...rows.map((r) => r.createdAt)) + DUEL_PAIR_COOLDOWN_MS;
  return until > ctx.now() ? until : null;
}

/**
 * Has this exact challenge already been accepted? A live challenge stores nothing,
 * so its identity is the expiry instant baked into the button's customId: any live
 * duel for this pair inside that challenge's own lifetime IS this challenge.
 */
function challengeAlreadyResolved(
  ctx: Ctx, challengerId: string, defenderId: string, expiresAtMs: number,
): boolean {
  return ctx.db.select().from(schema.duels)
    .where(and(
      eq(schema.duels.challengerId, challengerId),
      eq(schema.duels.defenderId, defenderId),
      eq(schema.duels.mode, 'live'),
    )).all()
    // Inclusive lower bound: a challenge posted at t has expiresAtMs = t + TTL, so its
    // own duel lands at exactly `expiresAtMs - TTL`. An exclusive `>` would miss the
    // duel it is meant to detect — and at ctx.now() === 0, which is where the tests
    // live, it misses every one of them.
    .some((r) => r.createdAt >= expiresAtMs - DUEL_CHALLENGE_TTL_MS && r.createdAt <= expiresAtMs);
}
```

Add `DUEL_CHALLENGE_TTL_MS` to the same constants import.

Change `resolveDuel`'s signature and insert the guards immediately after the two user-row lookups, before any squad resolution:

```ts
export function resolveDuel(
  ctx: Ctx, challengerId: string, defenderId: string, mode: DuelMode,
  challengeExpiresAtMs?: number,
): DuelOutcome {
```

```ts
  if (mode === 'ghost') {
    const until = cooldownUntil(ctx, challengerId, defenderId);
    if (until !== null) {
      throw new DuelError(
        `You duelled ${defender.displayName || defenderId} recently — you can again <t:${Math.floor(until / 1000)}:R>.`);
    }
  } else if (challengeExpiresAtMs !== undefined
      && challengeAlreadyResolved(ctx, challengerId, defenderId, challengeExpiresAtMs)) {
    throw new DuelError('That challenge has already been accepted.');
  }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/duels.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/duels/service.ts tests/duels.test.ts
git commit -m "feat(duels): derive the pair cooldown and the double-accept guard from the log"
```

---

## Task 6: The result embed, the challenge card, and the customIds

**Files:**
- Create: `src/modules/duels/embeds.ts`
- Test: `tests/duels.test.ts` (append one describe)

**Interfaces:**
- Consumes: `DuelOutcome`, `DuelSquadMember` (Tasks 3-4); `assetImage`, `attach` (`src/core/images.ts`).
- Produces:
  - `const DUEL_PREFIX = 'duel'`
  - `interface DuelPayload { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }`
  - `function duelResultPayload(outcome: DuelOutcome): DuelPayload`
  - `function challengePayload(challengerId: string, defenderId: string, challengerName: string, defenderName: string, expiresAtMs: number): DuelPayload`

- [ ] **Step 1: Write the failing test**

Append to `tests/duels.test.ts` (import `duelResultPayload`, `challengePayload`, `DUEL_PREFIX` from `../src/modules/duels/embeds.js`):

```ts
describe('duel embeds', () => {
  const strong = allSpecies().find((s) => s.rarity === 'legendary')!;
  const weak = allSpecies().find((s) => s.rarity === 'common')!;

  function outcome() {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200);
    addDino('b', weak.id, 0);
    return resolveDuel(ctx, 'a', 'b', 'ghost');
  }

  it('names both players, both ratings and both squads', () => {
    const payload = duelResultPayload(outcome());
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('A');
    expect(embed.description).toContain('B');
    expect(embed.fields!.map((f) => f.name)).toEqual(
      expect.arrayContaining(['Opening clash', 'The climax']));
    expect(JSON.stringify(embed)).toContain('1000');
  });

  // Elo is a plain integer — never divided the way parkRating is.
  it('renders a rating as a whole number, not a star figure', () => {
    const out = outcome();
    const embed = duelResultPayload(out).embeds[0].toJSON();
    expect(JSON.stringify(embed)).not.toContain('10.0');
    expect(JSON.stringify(embed)).toContain(String(out.ratingAfter.challenger));
  });

  // Two art refs could resolve to the SAME basename whenever both leads share an
  // archetype×diet, and attach() appends without deduping — one embed slot would
  // then render the wrong picture. Exactly one ref, always.
  it('never attaches more than one image', () => {
    const payload = duelResultPayload(outcome());
    expect((payload.files ?? []).length).toBeLessThanOrEqual(1);
  });

  it('carries no buttons on a result', () => {
    expect(duelResultPayload(outcome()).components).toEqual([]);
  });

  it('mints Accept and Decline ids carrying the pair and the expiry', () => {
    const payload = challengePayload('111', '222', 'A', 'B', 900_000);
    const ids = payload.components[0].toJSON().components.map((c) => (c as { custom_id: string }).custom_id);
    expect(ids).toEqual([`${DUEL_PREFIX}:accept:111:222:900000`, `${DUEL_PREFIX}:decline:111:222:900000`]);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(100);
  });

  it('shows the challenged player when the challenge expires', () => {
    const embed = challengePayload('111', '222', 'A', 'B', 900_000).embeds[0].toJSON();
    expect(embed.description).toContain('<t:900:R>');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts -t "duel embeds"`
Expected: FAIL — `Failed to resolve import "../src/modules/duels/embeds.js"`.

- [ ] **Step 3: Write `src/modules/duels/embeds.ts`**

```ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import type { DuelOutcome, DuelSquadMember } from './service.js';

// The component prefix AND the first segment of every customId this module mints.
// Component routing is exact equality on that first segment, so both must come from
// this one constant or a button dead-ends with "This interaction failed".
export const DUEL_PREFIX = 'duel';

export interface DuelPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}

const WIN = 0x2ecc71, LOSS = 0xe74c3c, DRAW = 0x95a5a6, CHALLENGE = 0x5865F2;

function squadLine(squad: DuelSquadMember[]): string {
  return squad.map((m) => `Lv.${m.level} ${m.name}`).join(', ');
}

function ratingLine(name: string, before: number, after: number): string {
  const delta = after - before;
  const sign = delta > 0 ? `+${delta}` : String(delta);
  return `${name}: **${after}** (${sign}, was ${before})`;
}

/**
 * One embed, no cinematic. fightFrames cannot be reused at any level: it is bound to
 * a stageId, calls STAGES.get and throws on a miss, and its F1/F4 attachments
 * contract exists only because four sequential edits race a Skip button.
 */
export function duelResultPayload(outcome: DuelOutcome): DuelPayload {
  const { names, result, squads, survivors, ratingBefore, ratingAfter } = outcome;
  const headline = result === 'win' ? `⚔️ ${names.challenger} defeats ${names.defender}`
    : result === 'loss' ? `⚔️ ${names.defender} holds off ${names.challenger}`
    : `⚔️ ${names.challenger} and ${names.defender} fight to a draw`;
  const embed = new EmbedBuilder()
    .setColor(result === 'win' ? WIN : result === 'loss' ? LOSS : DRAW)
    .setTitle(headline)
    .setDescription([
      `${outcome.mode === 'ghost' ? 'Ghost duel' : 'Live duel'} — ${outcome.rounds} rounds.`,
      ratingLine(names.challenger, ratingBefore.challenger, ratingAfter.challenger),
      ratingLine(names.defender, ratingBefore.defender, ratingAfter.defender),
    ].join('\n'))
    .addFields(
      { name: `${names.challenger} — ${survivors.challenger}/${squads.challenger.length} standing`, value: squadLine(squads.challenger) },
      { name: `${names.defender} — ${survivors.defender}/${squads.defender.length} standing`, value: squadLine(squads.defender) },
      { name: outcome.beats[0].title, value: outcome.beats[0].lines.join('\n') },
      { name: outcome.beats[1].title, value: outcome.beats[1].lines.join('\n') },
    );
  // EXACTLY ONE ref. Attachment names are basenames with no kind prefix, so a second
  // ref would collide whenever both leads share an archetype×diet — attach appends
  // without deduping and one slot would render the other's picture.
  const lead = result === 'loss' ? squads.defender[0] : squads.challenger[0];
  const payload: DuelPayload = { embeds: [embed], components: [] };
  attach(embed, payload, 'thumbnail', assetImage('dinos', `${lead.archetype}-${lead.diet}`));
  return payload;
}

/**
 * The public challenge card. Nothing about it is stored: the pair and the expiry
 * instant ride in the customId, so a stale button rejects itself rather than
 * resolving a duel the poster no longer expects — the landmark stale-button lesson.
 */
export function challengePayload(
  challengerId: string, defenderId: string,
  challengerName: string, defenderName: string, expiresAtMs: number,
): DuelPayload {
  const embed = new EmbedBuilder().setColor(CHALLENGE)
    .setTitle('⚔️ Duel challenge')
    .setDescription([
      `**${challengerName}** challenges **${defenderName}** to an exhibition duel.`,
      'Nothing is staked but the record — no energy, no cash, no XP.',
      `Expires <t:${Math.floor(expiresAtMs / 1000)}:R>.`,
    ].join('\n'));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${DUEL_PREFIX}:accept:${challengerId}:${defenderId}:${expiresAtMs}`)
      .setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${DUEL_PREFIX}:decline:${challengerId}:${defenderId}:${expiresAtMs}`)
      .setLabel('Decline').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/duels.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/duels/embeds.ts tests/duels.test.ts
git commit -m "feat(duels): render the duel result embed and the challenge card"
```

---

## Task 7: The module, `/duel ghost`, and registration

**Files:**
- Create: `src/modules/duels/index.ts`
- Modify: `modules.json`, `src/core/module-list.ts`, `tests/registry-load.test.ts`, `tests/config.test.ts`, `tests/contract.test.ts`
- Test: `tests/duels.test.ts` (append one describe)

**Interfaces:**
- Consumes: `resolveDuel`, `DuelError` (Tasks 4-5); `duelResultPayload`, `DUEL_PREFIX` (Task 6); `getOrCreateUser`, `settleEscapes`.
- Produces: `export const duelsModule: ModuleManifest` with `name: 'duels'`, one command `/duel` (subcommand `ghost` only for now), and one component with prefix `DUEL_PREFIX`.

- [ ] **Step 1: Write the failing test**

Append to `tests/duels.test.ts` (import `fakeCommand`, `replyText` from `./harness.js` and `duelsModule` from `../src/modules/duels/index.js`):

```ts
describe('/duel ghost', () => {
  const strong = allSpecies().find((s) => s.rarity === 'legendary')!;
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  const run = async (user: string, opponent: string | { id: string; bot?: boolean }) => {
    const i = fakeCommand({ name: 'duel', sub: 'ghost', user, guild: 'g1', options: { opponent } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('posts a public result and writes the log row', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200); addDino('b', weak.id, 0);
    const i = await run('a', 'b');
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }>; flags?: number };
    expect(payload.embeds[0].toJSON().title).toContain('⚔️');
    expect(payload.flags).toBeUndefined();          // public, not ephemeral
    expect(ctx.db.select().from(schema.duels).all()).toHaveLength(1);
  });

  it('refuses duelling yourself', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', weak.id, 0);
    const i = await run('a', 'a');
    expect(replyText(i.replies[0])).toMatch(/yourself/i);
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  });

  it('refuses duelling a bot', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', weak.id, 0);
    const i = await run('a', { id: 'botto', bot: true });
    expect(replyText(i.replies[0])).toMatch(/bot/i);
  });

  // Unlike /trade offer, a duel never mints a park for someone merely mentioned.
  it('refuses a target with no park and creates no row for them', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', weak.id, 0);
    const i = await run('a', 'stranger');
    expect(replyText(i.replies[0])).toMatch(/no park yet/i);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'stranger')).get()).toBeUndefined();
  });

  it('answers the cooldown ephemerally rather than throwing', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0); addDino('b', weak.id, 0);
    await run('a', 'b');
    const i = await run('a', 'b');
    expect(replyText(i.replies[0])).toMatch(/recently/i);
    expect((i.replies[0] as { flags?: number }).flags).toBeDefined();
  });
});

describe('duels module registration', () => {
  it('registers under the name duels with the duel prefix', () => {
    expect(duelsModule.name).toBe('duels');
    expect(duelsModule.components[0].prefix).toBe('duel');
    expect(duelsModule.commands[0].data.name).toBe('duel');
  });
});
```

Update the three count literals in the same commit (they fail the moment the module is in `ALL_MODULES`):

- `tests/registry-load.test.ts:9` → `expect(ALL_MODULES).toHaveLength(16);`
- `tests/registry-load.test.ts:10` → `expect(r.commands().length).toBe(27);`
- `tests/contract.test.ts:51` → `expect(body).toHaveLength(27);`
- `tests/config.test.ts:22` → append `, duels: true` inside the `toEqual({ … })` literal.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts -t "/duel ghost"`
Expected: FAIL — `Failed to resolve import "../src/modules/duels/index.js"`.

- [ ] **Step 3: Write `src/modules/duels/index.ts`**

```ts
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { resolveDuel, DuelError } from './service.js';
import { duelResultPayload, DUEL_PREFIX } from './embeds.js';

export const duelsModule: ModuleManifest = {
  name: 'duels',
  commands: [
    {
      data: new SlashCommandBuilder().setName('duel').setDescription('Exhibition duels — free, and pay nothing but a record')
        .addSubcommand((s) => s.setName('ghost').setDescription("Duel a snapshot of another player's squad")
          .addUserOption((o) => o.setName('opponent').setDescription('Who to duel').setRequired(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        if (sub === 'ghost') {
          const target = i.options.getUser('opponent', true);
          if (target.id === i.user.id) {
            await i.reply({ content: "You can't duel yourself.", flags: MessageFlags.Ephemeral });
            return;
          }
          if (target.bot) {
            await i.reply({ content: 'You cannot duel a bot.', flags: MessageFlags.Ephemeral });
            return;
          }
          // The challenger ran a command, so settling their escapes here is exactly the
          // documented rule. The DEFENDER is never settled — duelSquad evaluates their
          // escapes read-only instead.
          settleEscapes(ctx, i.user.id);
          try {
            const outcome = resolveDuel(ctx, i.user.id, target.id, 'ghost');
            await i.reply(duelResultPayload(outcome));
          } catch (e) {
            if (e instanceof DuelError) {
              await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              return;
            }
            throw e;
          }
          return;
        }
        // Never the /park dispatch trap: an unrecognised subcommand reports failure
        // rather than silently rendering something plausible.
        await i.reply({ content: 'Unknown /duel subcommand.', flags: MessageFlags.Ephemeral });
      },
    },
  ],
  components: [
    {
      prefix: DUEL_PREFIX,
      async execute(ctx, i) {
        // Placeholder until Task 8: absorb unknown actions rather than letting Discord
        // show "This interaction failed" (the dex/ach/top discipline).
        await i.deferUpdate();
      },
    },
  ],
};
```

- [ ] **Step 4: Register the module (all four sites)**

`modules.json` — a single-line object; insert the key inline before the closing brace:

```json
{ "park": true, "hatchery": true, "expeditions": true, "shop": true, "settings": true, "care": true, "trading": true, "leaderboards": true, "admin": true, "help": true, "battles": true, "genelab": true, "daily": true, "world": true, "dex": true, "duels": true }
```

`src/core/module-list.ts` — add the import after the `dexModule` import, and the manifest at the end of the array:

```ts
import { duelsModule } from '../modules/duels/index.js';
```

```ts
  battlesModule, geneLabModule, dailyModule, worldModule, dexModule, duelsModule,
```

Do **not** touch `src/index.ts` or `src/deploy-commands.ts` — both already import `ALL_MODULES`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. If `tests/config.test.ts` fails with an extra/missing `duels` key, the `modules.json` edit and the expected literal disagree — `toEqual` is exact in both directions.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/duels/index.ts src/core/module-list.ts modules.json tests/duels.test.ts tests/registry-load.test.ts tests/config.test.ts tests/contract.test.ts
git commit -m "feat(duels): add the /duel command with the async ghost duel"
```

---

## Task 8: `/duel challenge` and the Accept / Decline buttons

**Files:**
- Modify: `src/modules/duels/index.ts`
- Test: `tests/duels.test.ts` (append one describe)

**Interfaces:**
- Consumes: `challengePayload` (Task 6), `resolveDuel` with `challengeExpiresAtMs` (Task 5).
- Produces: `/duel challenge opponent:<user>`; the `duel:accept:*` and `duel:decline:*` handlers.

- [ ] **Step 1: Write the failing test**

Append to `tests/duels.test.ts` (import `fakeButton` from `./harness.js`, `DUEL_CHALLENGE_TTL_MS` from `../src/data/battle/constants.js`, and `import type { ButtonInteraction } from 'discord.js';`):

```ts
describe('/duel challenge', () => {
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  const challenge = async (user: string, opponent: string) => {
    const i = fakeCommand({ name: 'duel', sub: 'challenge', user, guild: 'g1', options: { opponent } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };
  const click = async (customId: string, user: string) => {
    const b = fakeButton({ customId, user, guild: 'g1' });
    await duelsModule.components[0].execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    return b;
  };
  function pairWithDinos(): void {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0); addDino('b', weak.id, 0);
  }

  it('posts a public card whose buttons carry the pair and the expiry', async () => {
    pairWithDinos();
    const i = await challenge('a', 'b');
    const payload = i.replies[0] as { components: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> };
    const ids = payload.components[0].toJSON().components.map((c) => c.custom_id);
    expect(ids[0]).toBe(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`);   // ctx.now() is 0
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);      // nothing resolved yet
  });

  it('resolves the duel when the challenged player accepts, replacing the card', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    const embed = (b.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> }).embeds[0].toJSON();
    expect(embed.title).toContain('⚔️');
    const log = ctx.db.select().from(schema.duels).all();
    expect(log).toHaveLength(1);
    expect(log[0].mode).toBe('live');
  });

  it('refuses a clicker who is not the challenged player', async () => {
    pairWithDinos();
    getOrCreateUser(ctx, 'c', 'C');
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'c');
    expect(replyText(b.replies[0])).toMatch(/not for you/i);
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  });

  it('refuses the challenger clicking their own Accept', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'a');
    expect(replyText(b.replies[0])).toMatch(/not for you/i);
  });

  it('refuses an expired challenge', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    ctx.setNow(DUEL_CHALLENGE_TTL_MS + 1);
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    expect(replyText(b.replies[0])).toMatch(/expired/i);
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  });

  it('declines without resolving anything', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:decline:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    expect(JSON.stringify(b.replies[0])).toMatch(/declined/i);
    expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  });

  it('absorbs an unknown duel action instead of erroring', async () => {
    const b = await click('duel:nonsense:a:b:1', 'b');
    expect(b.deferOpts).toHaveLength(1);
    expect(b.replies).toEqual([]);
  });

  it('refuses challenging yourself or a bot', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    addDino('a', weak.id, 0);
    const self = await challenge('a', 'a');
    expect(replyText(self.replies[0])).toMatch(/yourself/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts -t "/duel challenge"`
Expected: FAIL — `fakeCommand: /duel has no subcommand 'challenge'`.

- [ ] **Step 3: Extend the builder and the execute switch**

In `src/modules/duels/index.ts`, add the subcommand to the builder:

```ts
        .addSubcommand((s) => s.setName('challenge').setDescription('Challenge another player to a live duel')
          .addUserOption((o) => o.setName('opponent').setDescription('Who to challenge').setRequired(true)))
```

Refactor `execute` so both subcommands share the two target guards:

```ts
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        if (sub === 'ghost' || sub === 'challenge') {
          const target = i.options.getUser('opponent', true);
          if (target.id === i.user.id) {
            await i.reply({ content: "You can't duel yourself.", flags: MessageFlags.Ephemeral });
            return;
          }
          if (target.bot) {
            await i.reply({ content: 'You cannot duel a bot.', flags: MessageFlags.Ephemeral });
            return;
          }
          settleEscapes(ctx, i.user.id);
          try {
            if (sub === 'ghost') {
              await i.reply(duelResultPayload(resolveDuel(ctx, i.user.id, target.id, 'ghost')));
              return;
            }
            // A challenge stores NOTHING: the squads and both ratings resolve when the
            // button is clicked, which is what makes a 15-minute-old card honest — it
            // fights the squad you have when it lands. These reads only verify the
            // pairing is duellable before a card is posted publicly, so a player with
            // no dinos is told now rather than the ACCEPTING player being told later.
            try {
              duelSquad(ctx, i.user.id);
            } catch {
              throw new DuelError('You have no battle-ready dinos — hatch or rescue one first.');
            }
            const defender = requireDuellable(ctx, target.id);
            const expiresAtMs = ctx.now() + DUEL_CHALLENGE_TTL_MS;
            await i.reply(challengePayload(
              i.user.id, target.id, i.user.displayName, defender.displayName || target.id, expiresAtMs));
          } catch (e) {
            if (e instanceof DuelError) {
              await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              return;
            }
            throw e;
          }
          return;
        }
        await i.reply({ content: 'Unknown /duel subcommand.', flags: MessageFlags.Ephemeral });
      },
```

Add to the imports:

```ts
import { resolveDuel, requireDuellable, duelSquad, DuelError } from './service.js';
import { duelResultPayload, challengePayload, DUEL_PREFIX } from './embeds.js';
import { DUEL_CHALLENGE_TTL_MS } from '../../data/battle/constants.js';
```

Add `requireDuellable` to `src/modules/duels/service.ts` (it is the row lookup `resolveDuel` already does, exposed so a challenge can fail *before* posting a public card):

```ts
/** The defender's row, or a DuelError naming why they cannot be duelled. */
export function requireDuellable(ctx: Ctx, defenderId: string): typeof schema.users.$inferSelect {
  const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, defenderId)).get();
  if (!row) throw new DuelError('That player has no park yet.');
  duelSquad(ctx, defenderId);   // throws if they have nothing battle-ready
  return row;
}
```

- [ ] **Step 4: Replace the placeholder component handler**

```ts
  components: [
    {
      prefix: DUEL_PREFIX,
      async execute(ctx, i) {
        const [, action, challengerId, defenderId, expiresRaw] = i.customId.split(':');
        if (action !== 'accept' && action !== 'decline') { await i.deferUpdate(); return; }
        // The id segment names the CHALLENGED player: only they may answer.
        if (i.user.id !== defenderId) {
          await i.reply({ content: "That challenge isn't for you.", flags: MessageFlags.Ephemeral });
          return;
        }
        const expiresAtMs = Number(expiresRaw);
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= ctx.now()) {
          await i.reply({ content: 'That challenge expired — start a new one with `/duel challenge`.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === 'decline') {
          await i.update({ content: `⚔️ Challenge declined by ${i.user.displayName}.`, embeds: [], components: [] });
          return;
        }
        settleEscapes(ctx, i.user.id);   // the accepting player is the one clicking
        try {
          const outcome = resolveDuel(ctx, challengerId, defenderId, 'live', expiresAtMs);
          // i.update replaces the challenge card with its own result, so one challenge
          // never accumulates messages.
          await i.update({ ...duelResultPayload(outcome), attachments: [] });
        } catch (e) {
          if (e instanceof DuelError) {
            await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
            return;
          }
          throw e;
        }
      },
    },
  ],
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/duels.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/duels/index.ts src/modules/duels/service.ts tests/duels.test.ts
git commit -m "feat(duels): add live challenges with stateless Accept and Decline buttons"
```

---

## Task 9: `/duel squad` and its autocomplete

**Files:**
- Modify: `src/modules/duels/index.ts`, `tests/contract.test.ts` (manifest entry)
- Test: `tests/duels.test.ts` (append one describe)

**Interfaces:**
- Consumes: `setDuelSquad`, `duelSquad` (Task 3).
- Produces: `/duel squad [dino1] [dino2] [dino3]`, an `autocomplete()` on the `/duel` command, and the `'duel squad': ['dino1', 'dino2', 'dino3']` manifest entry.

- [ ] **Step 1: Write the failing test**

Append to `tests/duels.test.ts` (import `fakeAutocomplete` from `./harness.js`):

```ts
describe('/duel squad', () => {
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  const setSquad = async (user: string, options: Record<string, number>) => {
    const i = fakeCommand({ name: 'duel', sub: 'squad', user, options });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('stores the chosen dinos and confirms ephemerally', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const one = addDino('a', weak.id, 0);
    const two = addDino('a', weak.id, 3200);
    const i = await setSquad('a', { dino1: one, dino2: two });
    expect((i.replies[0] as { flags?: number }).flags).toBeDefined();
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!.duelSquad)
      .toEqual([one, two]);
  });

  it('clears back to auto when called with no dinos', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const one = addDino('a', weak.id, 0);
    await setSquad('a', { dino1: one });
    const i = await setSquad('a', {});
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'a')).get()!.duelSquad).toEqual([]);
    expect(replyText(i.replies[0])).toMatch(/top three|automatic/i);
  });

  it("refuses another player's dino", async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0);
    const theirs = addDino('b', weak.id, 0);
    const i = await setSquad('a', { dino1: theirs });
    expect(replyText(i.replies[0])).toMatch(/battle-ready/i);
  });

  it('refuses the same dino twice', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const one = addDino('a', weak.id, 0);
    const i = await setSquad('a', { dino1: one, dino2: one });
    expect(replyText(i.replies[0])).toMatch(/once per squad/i);
  });

  it('suggests only battle-ready dinos, and never creates a user row', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const fit = addDino('a', weak.id, 0);
    const escaped = addDino('a', weak.id, 0);
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, escaped)).run();
    const i = fakeAutocomplete({ name: 'duel', sub: 'squad', user: 'a', focused: { name: 'dino1', value: '' } });
    await duelsModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    const values = (i.replies[0] as Array<{ value: number }>).map((c) => c.value);
    expect(values).toContain(fit);
    expect(values).not.toContain(escaped);
  });

  it('responds with an empty list for a player who has no park row', async () => {
    const i = fakeAutocomplete({ name: 'duel', sub: 'squad', user: 'nobody', focused: { name: 'dino1', value: '' } });
    await duelsModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
    expect(ctx.db.select().from(schema.users).all()).toEqual([]);
  });
});
```

Also add to `tests/contract.test.ts`'s `AUTOCOMPLETE_OPTIONS`, in the same commit:

```ts
  'duel squad': ['dino1', 'dino2', 'dino3'],
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts -t "/duel squad"`
Expected: FAIL — `fakeCommand: /duel has no subcommand 'squad'`. `npx vitest run tests/contract.test.ts` additionally fails on the manifest entry with no matching flagged option.

- [ ] **Step 3: Extend the builder, execute, and add the provider**

Builder — three optional integer options, all autocompleting:

```ts
        .addSubcommand((s) => s.setName('squad').setDescription('Set the squad you field in duels — leave blank to clear')
          .addIntegerOption((o) => o.setName('dino1').setDescription('Squad slot 1').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('dino2').setDescription('Squad slot 2').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('dino3').setDescription('Squad slot 3').setAutocomplete(true)))
```

In `execute`, before the `ghost`/`challenge` branch:

```ts
        if (sub === 'squad') {
          const ids = ['dino1', 'dino2', 'dino3']
            .map((n) => i.options.getInteger(n))
            .filter((v): v is number => v !== null);
          try {
            const squad = setDuelSquad(ctx, i.user.id, ids);
            await i.reply({
              content: ids.length
                ? `⚔️ Duel squad set: ${squad.map((m) => `Lv.${m.level} ${m.name}`).join(', ')}.`
                : `⚔️ Duel squad cleared — duels now field your top three automatic picks: ${squad.map((m) => m.name).join(', ')}.`,
              flags: MessageFlags.Ephemeral,
            });
          } catch (e) {
            if (e instanceof DuelError) {
              await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              return;
            }
            throw e;
          }
          return;
        }
```

Add the provider to the same command definition, after `execute`:

```ts
      // Provider contract: respond() only, no reply/defer, no getOrCreateUser (no row
      // creation on keystrokes), read-only. settleEscapes is NOT called here — it
      // writes, and duelSquad evaluates escape read-only anyway.
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'squad') { await i.respond([]); return; }
        const user = ctx.db.select().from(schema.users)
          .where(eq(schema.users.discordId, i.user.id)).get();
        if (!user) { await i.respond([]); return; }
        const focused = i.options.getFocused(true);
        const q = String(focused.value);
        const others = ['dino1', 'dino2', 'dino3'].filter((n) => n !== focused.name);
        const taken = new Set(others.map((n) => Number(i.options.get(n)?.value)).filter((v) => Number.isFinite(v)));
        let squad: DuelSquadMember[] = [];
        try { squad = eligibleForDuel(ctx, i.user.id); } catch { squad = []; }
        if (!squad.length) { await respondRanked(i, [emptyRow('No battle-ready dinos — hatch or /rescue first', 0)]); return; }
        // Unicode only — a custom emoji tag renders as literal text in autocomplete.
        await respondRanked(i, squad
          .filter((m) => !taken.has(m.dinoId))
          .filter((m) => matches(q, m.dinoId, m.name, m.speciesId))
          .map((m) => ({ value: m.dinoId, valid: true, label: `🦖 #${m.dinoId} Lv.${m.level} ${m.name} (${m.archetype})` })));
      },
```

Imports to add in `index.ts`:

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { matches, respondRanked, emptyRow } from '../../core/autocomplete.js';
import { setDuelSquad, eligibleForDuel, type DuelSquadMember } from './service.js';
```

And export the eligible list from `src/modules/duels/service.ts` (it is `eligibleDinos` mapped to members — the autocomplete needs every eligible dino, not just the fielded three):

```ts
/** Every dino this player could field, newest-strongest first. Read-only. */
export function eligibleForDuel(ctx: Ctx, userId: string): DuelSquadMember[] {
  return [...eligibleDinos(ctx, userId)]
    .sort((a, b) => b.battleXp - a.battleXp || a.id - b.id)
    .map(toMember);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/duels.test.ts tests/contract.test.ts`
Expected: PASS. The contract suite enforces the manifest in **both** directions, and separately fails any command that defines `autocomplete()` while flagging no option — so the builder flag and the manifest entry must land together.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/duels/index.ts src/modules/duels/service.ts tests/duels.test.ts tests/contract.test.ts
git commit -m "feat(duels): let players set the squad they field, with autocomplete"
```

---

## Task 10: `/duel record`

**Files:**
- Modify: `src/modules/duels/service.ts`, `src/modules/duels/embeds.ts`, `src/modules/duels/index.ts`
- Test: `tests/duels.test.ts` (append one describe)

**Interfaces:**
- Consumes: `schema.duels`, `schema.users`.
- Produces: `interface DuelRecord { rating: number; wins: number; losses: number; draws: number; recent: Array<{ opponentName: string; result: DuelResult; eloDelta: number; at: number; mode: DuelMode }> }`, `function duelRecord(ctx: Ctx, userId: string, limit?: number): DuelRecord`, `function recordPayload(name: string, record: DuelRecord): DuelPayload`.

- [ ] **Step 1: Write the failing test**

Append to `tests/duels.test.ts`:

```ts
describe('/duel record', () => {
  const weak = allSpecies().find((s) => s.rarity === 'common')!;

  function logRow(challengerId: string, defenderId: string, result: 'win' | 'loss' | 'draw', delta: number, at: number) {
    ctx.db.insert(schema.duels)
      .values({ challengerId, defenderId, mode: 'ghost', result, eloDelta: delta, createdAt: at }).run();
  }

  it('counts both sides of the log from the reader\'s perspective', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    logRow('a', 'b', 'win', 16, 1);      // a won
    logRow('b', 'a', 'win', 12, 2);      // a lost
    logRow('b', 'a', 'draw', 0, 3);      // drew
    logRow('b', 'a', 'loss', -9, 4);     // a won (challenger b lost)
    const rec = duelRecord(ctx, 'a');
    expect({ wins: rec.wins, losses: rec.losses, draws: rec.draws }).toEqual({ wins: 2, losses: 1, draws: 1 });
  });

  it('negates the stored delta when the reader was the defender', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    logRow('b', 'a', 'win', 20, 1);
    const rec = duelRecord(ctx, 'a');
    expect(rec.recent[0].eloDelta).toBe(-20);
    expect(rec.recent[0].result).toBe('loss');
    expect(rec.recent[0].opponentName).toBe('B');
  });

  it('returns the newest duels first, capped at the limit', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    for (let n = 1; n <= 8; n++) logRow('a', 'b', 'win', 1, n);
    const rec = duelRecord(ctx, 'a', 5);
    expect(rec.recent).toHaveLength(5);
    expect(rec.recent.map((r) => r.at)).toEqual([8, 7, 6, 5, 4]);
  });

  it('reads a fresh account as 1000 and an empty history', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const rec = duelRecord(ctx, 'a');
    expect(rec).toMatchObject({ rating: 1000, wins: 0, losses: 0, draws: 0 });
    expect(rec.recent).toEqual([]);
  });

  it('renders another player\'s record when asked', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('b', weak.id, 0);
    const i = fakeCommand({ name: 'duel', sub: 'record', user: 'a', options: { player: 'b' } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> }).embeds[0].toJSON();
    expect(embed.title).toContain('B');
  });

  it('refuses a player with no park row', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    const i = fakeCommand({ name: 'duel', sub: 'record', user: 'a', options: { player: 'stranger' } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toMatch(/no park yet/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts -t "/duel record"`
Expected: FAIL — `duelRecord is not a function`.

- [ ] **Step 3: Add `duelRecord` to the service**

```ts
export interface DuelRecordEntry {
  opponentId: string; opponentName: string; result: DuelResult;
  eloDelta: number; at: number; mode: DuelMode;
}
export interface DuelRecord {
  rating: number; wins: number; losses: number; draws: number; recent: DuelRecordEntry[];
}

const FLIP: Record<DuelResult, DuelResult> = { win: 'loss', loss: 'win', draw: 'draw' };

/**
 * Everything but the rating is derived by counting log rows. Two reads total —
 * the log, then one batched lookup of the opponents' display names — never one
 * query per row (the batch-per-board rule from src/modules/leaderboards/service.ts).
 */
export function duelRecord(ctx: Ctx, userId: string, limit = 5): DuelRecord {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) throw new DuelError('That player has no park yet.');
  const rows = ctx.db.select().from(schema.duels)
    .where(or(eq(schema.duels.challengerId, userId), eq(schema.duels.defenderId, userId))).all();
  // Stored result and delta are always the CHALLENGER's, so a row where this reader
  // defended is flipped exactly once, here.
  const mine = rows.map((r) => {
    const asChallenger = r.challengerId === userId;
    return {
      opponentId: asChallenger ? r.defenderId : r.challengerId,
      result: asChallenger ? r.result : FLIP[r.result],
      eloDelta: asChallenger ? r.eloDelta : -r.eloDelta,
      at: r.createdAt, mode: r.mode,
    };
  }).sort((a, b) => b.at - a.at);
  const recentRaw = mine.slice(0, Math.max(0, limit));
  const opponentIds = [...new Set(recentRaw.map((r) => r.opponentId))];
  const names = new Map(opponentIds.length
    ? ctx.db.select().from(schema.users).where(inArray(schema.users.discordId, opponentIds)).all()
        .map((u) => [u.discordId, u.displayName || u.discordId])
    : []);
  return {
    rating: user.duelRating,
    wins: mine.filter((r) => r.result === 'win').length,
    losses: mine.filter((r) => r.result === 'loss').length,
    draws: mine.filter((r) => r.result === 'draw').length,
    recent: recentRaw.map((r) => ({ ...r, opponentName: names.get(r.opponentId) ?? r.opponentId })),
  };
}
```

Add `inArray` to the `drizzle-orm` import in the service.

- [ ] **Step 4: Add `recordPayload` and the subcommand**

In `src/modules/duels/embeds.ts`:

```ts
import type { DuelOutcome, DuelRecord, DuelSquadMember } from './service.js';

export function recordPayload(name: string, record: DuelRecord): DuelPayload {
  const history = record.recent.length
    ? record.recent.map((r) => {
        const mark = r.result === 'win' ? '✅' : r.result === 'loss' ? '❌' : '➖';
        const sign = r.eloDelta > 0 ? `+${r.eloDelta}` : String(r.eloDelta);
        return `${mark} vs ${r.opponentName} — ${sign} (${r.mode})`;
      }).join('\n')
    : 'No duels yet.';
  const embed = new EmbedBuilder().setColor(CHALLENGE)
    .setTitle(`⚔️ ${name} — duel record`)
    // Elo is a plain integer. Never divide it: only parkRating is stored ×100.
    .setDescription(`**${record.rating}** rating\n${record.wins}W / ${record.losses}L / ${record.draws}D`)
    .addFields({ name: 'Recent duels', value: history });
  return { embeds: [embed], components: [] };
}
```

In `src/modules/duels/index.ts`, add the builder subcommand:

```ts
        .addSubcommand((s) => s.setName('record').setDescription('Duel rating, record and recent opponents')
          .addUserOption((o) => o.setName('player').setDescription('Whose record — defaults to yours')))
```

and the branch, before the `ghost`/`challenge` branch:

```ts
        if (sub === 'record') {
          const who = i.options.getUser('player');
          const targetId = who?.id ?? i.user.id;
          try {
            const record = duelRecord(ctx, targetId);
            const name = who ? who.displayName : i.user.displayName;
            await i.reply(recordPayload(name, record));
          } catch (e) {
            if (e instanceof DuelError) {
              await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              return;
            }
            throw e;
          }
          return;
        }
```

Extend the imports: `duelRecord` from `./service.js`, `recordPayload` from `./embeds.js`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/duels.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/duels tests/duels.test.ts
git commit -m "feat(duels): add /duel record with a derived win-loss-draw history"
```

---

## Task 11: The defender's notification, and the consent copy that moves with it

**Files:**
- Modify: `src/modules/duels/service.ts`, `src/modules/duels/index.ts`, `src/core/db/schema.ts` (comment), `src/modules/park/index.ts` (alerts reply copy)
- Test: `tests/duels.test.ts` (append one describe)

**Interfaces:**
- Consumes: `DuelOutcome.defenderAlertsEnabled` (Task 4), `ctx.notify`.
- Produces: `function notifyDefender(ctx: Ctx, outcome: DuelOutcome, originGuildId: string | null): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append to `tests/duels.test.ts`:

```ts
describe('duel notification', () => {
  const strong = allSpecies().find((s) => s.rarity === 'legendary')!;
  const weak = allSpecies().find((s) => s.rarity === 'common')!;
  const ghost = async (user: string, opponent: string, guild: string | undefined = 'g1') => {
    const i = fakeCommand({ name: 'duel', sub: 'ghost', user, guild, options: { opponent } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('tells the absent defender what happened, from the attacker\'s guild', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200); addDino('b', weak.id, 0);
    await ghost('a', 'b');
    expect(ctx.notifications).toHaveLength(1);
    expect(ctx.notifications[0].userId).toBe('b');
    expect(ctx.notifications[0].originGuildId).toBe('g1');
    expect(ctx.notifications[0].message).toContain('A');
    expect(typeof ctx.notifications[0].message).toBe('string');
  });

  it('names the rating move in the message', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200); addDino('b', weak.id, 0);
    await ghost('a', 'b');
    expect(ctx.notifications[0].message).toMatch(/1000/);
  });

  it('respects a defender who muted alerts', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', strong.id, 3200); addDino('b', weak.id, 0);
    ctx.db.update(schema.users).set({ alertsEnabled: false }).where(eq(schema.users.discordId, 'b')).run();
    await ghost('a', 'b');
    expect(ctx.notifications).toEqual([]);
  });

  it('sends nothing for a live duel — the defender was there', async () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    addDino('a', weak.id, 0); addDino('b', weak.id, 0);
    const i = fakeCommand({ name: 'duel', sub: 'challenge', user: 'a', guild: 'g1', options: { opponent: 'b' } });
    await duelsModule.commands[0].execute(ctx, i.asChatInput());
    const b = fakeButton({ customId: `duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, user: 'b', guild: 'g1' });
    await duelsModule.components[0].execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(ctx.notifications).toEqual([]);
  });
});
```

Add to `tests/park.test.ts` — find the existing `/park alerts state:off` test and extend its assertion (search for `unaffected`):

```ts
    expect(replyText(i.replies[0])).toContain('Duel results are muted too');
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/duels.test.ts -t "duel notification"`
Expected: FAIL — `expected [] to have a length of 1`.

- [ ] **Step 3: Add `notifyDefender` and call it on the ghost path**

In `src/modules/duels/service.ts`:

```ts
/**
 * Tell the absent defender their park fought. Ghost duels only — a live duel's
 * defender clicked Accept and is looking at the result.
 *
 * A plain string, deliberately: Ctx.notify's third parameter is typed `message:
 * string`, and widening it to NotifyPayload is a three-site change (the Ctx
 * interface plus two independent spellings in tests/harness.ts) that only
 * `npm run typecheck` catches. One line of text is not worth it.
 *
 * originGuildId is the ATTACKER's guild — channel-first with the ping, DM fallback,
 * the trading precedent. The defender's own guild is never consulted.
 */
export async function notifyDefender(
  ctx: Ctx, outcome: DuelOutcome, originGuildId: string | null,
): Promise<void> {
  if (outcome.mode !== 'ghost' || !outcome.defenderAlertsEnabled) return;
  const verb = outcome.result === 'win' ? 'and won'
    : outcome.result === 'loss' ? 'and your squad held them off'
    : 'and it ended in a draw';
  await ctx.notify(outcome.defenderId, originGuildId,
    `⚔️ ${outcome.names.challenger} duelled your park ${verb}. `
    + `Your duel rating: ${outcome.ratingBefore.defender} → ${outcome.ratingAfter.defender}. `
    + 'See `/duel record`.');
}
```

In `src/modules/duels/index.ts`, on the ghost branch, after the reply:

```ts
            if (sub === 'ghost') {
              const outcome = resolveDuel(ctx, i.user.id, target.id, 'ghost');
              await i.reply(duelResultPayload(outcome));
              // After the reply: the duel is already committed, so a failed
              // notification must not cost the player their result. ctx.notify never
              // throws.
              await notifyDefender(ctx, outcome, i.guildId);
              return;
            }
```

- [ ] **Step 4: Update the consent copy in the same commit**

`src/core/db/schema.ts` — replace the `alertsEnabled` comment:

```ts
  // Gates the two proactive alerts (escape, income cap) AND duel results — the three
  // completion notifications stay unconditional: those were asked for by starting the
  // hatch, the breeding, the expedition. A duel result is unrequested and arrives
  // because someone else acted, which is exactly what this flag is for. adminReset
  // deliberately does not restore this — see the comment in admin/service.ts.
```

`src/modules/park/index.ts` — the `case 'alerts'` reply, both arms:

```ts
              content: on
                ? '🔔 Park alerts are **on** — you will get a DM before a dino escapes, when your park hits its income cap, and when another player duels your park.'
                : '🔕 Park alerts are **off**. Duel results are muted too. Egg, breeding, and expedition notifications are unaffected. Turn them back on with `/park alerts state:on`.',
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/duels.test.ts tests/park.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/duels src/core/db/schema.ts src/modules/park/index.ts tests/duels.test.ts tests/park.test.ts
git commit -m "feat(duels): notify the defender of a ghost duel, and widen the alerts copy to match"
```

---

## Task 12: `/top duels`

**Files:**
- Modify: `src/modules/leaderboards/service.ts`, `src/modules/leaderboards/index.ts`
- Test: `tests/leaderboards.test.ts`

**Interfaces:**
- Consumes: `schema.users.duelRating` (Task 2).
- Produces: `Metric` gains `'duels'`; `/top`'s metric choices gain a sixth value.

- [ ] **Step 1: Write the failing test**

In `tests/leaderboards.test.ts`, update the choices test (title and array both):

```ts
  it('offers exactly the six metrics the service knows', () => {
    const json = leaderboardsModule.commands[0].data.toJSON() as {
      options?: Array<{ name: string; choices?: Array<{ value: string }> }>;
    };
    const metric = json.options!.find((o) => o.name === 'metric')!;
    expect(metric.choices!.map((c) => c.value))
      .toEqual(['rating', 'cash', 'collection', 'legacy', 'stars', 'duels']);
  });
```

Widen both cost-helper unions and add a row to each of the three `it.each` tables:

```ts
  const cost = (size: number, metric: 'cash' | 'collection' | 'legacy' | 'stars' | 'duels') => {
```
```ts
    ['cash', 1],          // the candidate scan alone
    ['duels', 1],         // duel_rating rides on the users row — no extra read
    ['stars', 2],         // + battle_progress
```
```ts
  const serverCost = (size: number, metric: 'cash' | 'collection' | 'legacy' | 'stars' | 'duels') => {
```
```ts
    ['cash', 2],           // user_guilds + the candidate scan
    ['duels', 2],
    ['stars', 3],          // + battle_progress
```
```ts
    ['cash', 1],           // user_guilds only — no candidates, no further reads
    ['duels', 1],
    ['stars', 1],
```

And add a rendering test to the `new metrics` describe:

```ts
  it('/top duels ranks by the stored Elo as a whole number', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    ctx.db.update(schema.users).set({ duelRating: 1180 }).where(eq(schema.users.discordId, 'a')).run();
    const i = fakeCommand({ name: 'top', user: 'a', options: { metric: 'duels', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { title?: string; description?: string } }> }).embeds[0].toJSON();
    expect(embed.title).toContain('Duel');
    // Never '11.8': only rating is stored ×100.
    expect(embed.description).toContain('1,180');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/leaderboards.test.ts`
Expected: FAIL — the choices array mismatch, and `/top duels` renders `Top undefined` because `metricLabel` has no key.

- [ ] **Step 3: Wire the metric**

`src/modules/leaderboards/service.ts` — the union:

```ts
export type Metric = 'rating' | 'cash' | 'collection' | 'legacy' | 'stars' | 'duels';
```

and the value ternary inside `scored()` (NOT the `byUser` chain — `duelRating` is on the candidate row already, so the metric costs no extra query, and adding it to the wrong ternary leaves `byUser` null and throws at runtime):

```ts
    value: metric === 'cash' ? u.cash
      : metric === 'rating' ? u.parkRating
      : metric === 'duels' ? u.duelRating
      : byUser!.get(u.discordId) ?? 0,
```

`src/modules/leaderboards/index.ts` — the label map and the builder choice:

```ts
    stars: '⭐ Battle Stars',
    duels: '⚔️ Duel Rating',
```
```ts
            { name: 'stars', value: 'stars' },
            { name: 'duels', value: 'duels' },
```

`formatValue` needs **no** change: its default branch is `toLocaleString()`, which is correct because Elo is a plain integer. Leave it alone deliberately.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/leaderboards.test.ts`
Expected: PASS. The three `it.each` tables now pin `duels` at 1 global / 2 server / 1 zero-member.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/leaderboards tests/leaderboards.test.ts
git commit -m "feat(duels): rank players by duel rating on /top"
```

---

## Task 13: Admin reset and fast-forward

**Files:**
- Modify: `src/modules/admin/service.ts`
- Test: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `schema.duels`, `schema.users.duelRating`, `schema.users.duelSquad`, `DUEL_START_RATING`.
- Produces: no new exports — `adminReset` and `adminFastForward` cover the new table and columns.

- [ ] **Step 1: Write the failing test**

Append to `tests/admin.test.ts` (import `DUEL_START_RATING`, `DUEL_PAIR_COOLDOWN_MS` from `../src/data/battle/constants.js` and `cooldownUntil` from `../src/modules/duels/service.js`):

```ts
it('reset deletes duel rows on BOTH sides and restores the rating and squad', () => {
  getOrCreateUser(ctx, 'u1', 'U1');
  getOrCreateUser(ctx, 'u2', 'U2');
  ctx.db.insert(schema.duels)
    .values({ challengerId: 'u1', defenderId: 'u2', mode: 'ghost', result: 'win', eloDelta: 16, createdAt: 0 }).run();
  ctx.db.insert(schema.duels)
    .values({ challengerId: 'u2', defenderId: 'u1', mode: 'live', result: 'loss', eloDelta: -9, createdAt: 0 }).run();
  ctx.db.update(schema.users).set({ duelRating: 1300, duelSquad: [7, 8] })
    .where(eq(schema.users.discordId, 'u1')).run();

  adminReset(ctx, 'u1');

  expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
  expect(row.duelRating).toBe(DUEL_START_RATING);
  expect(row.duelSquad).toEqual([]);
});

it('fast-forward shifts the duel log so a pair cooldown can lapse', () => {
  getOrCreateUser(ctx, 'u1', 'U1');
  getOrCreateUser(ctx, 'u2', 'U2');
  ctx.setNow(10 * 3_600_000);
  ctx.db.insert(schema.duels).values({
    challengerId: 'u1', defenderId: 'u2', mode: 'ghost', result: 'win', eloDelta: 16, createdAt: ctx.now(),
  }).run();
  expect(cooldownUntil(ctx, 'u1', 'u2')).not.toBeNull();
  adminFastForward(ctx, 'u1', DUEL_PAIR_COOLDOWN_MS / 3_600_000 + 1);
  expect(cooldownUntil(ctx, 'u1', 'u2')).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/admin.test.ts -t duel`
Expected: FAIL — the log rows survive and `duelRating` stays 1300.

- [ ] **Step 3: Extend `adminReset`**

In `src/modules/admin/service.ts`, inside the transaction, after the `speciesSeen` delete:

```ts
    // Two-sided, like trades: a one-sided delete would leave the opponent's row naming
    // a wiped account and holding a live pair cooldown against a park that no longer
    // exists. The columns below matter as much as the rows: SQLite reuses row ids after
    // a delete, so a surviving duel_squad could silently field dinos this account
    // hatches next — the same argument the featuredDinoId comment makes.
    ctx.db.delete(schema.duels)
      .where(or(eq(schema.duels.challengerId, targetId), eq(schema.duels.defenderId, targetId))).run();
```

and add to the `users` update object:

```ts
      motto: '', featuredDinoId: null,
      duelRating: DUEL_START_RATING, duelSquad: [],
```

Import `DUEL_START_RATING` from `../../data/battle/constants.js` (the file already imports `ENERGY_CAP` from there).

- [ ] **Step 4: Extend `adminFastForward`**

Inside its transaction, after the `timers` update:

```ts
    // The duel log is history AND the only anchor of the pair cooldown, which is what
    // separates it from species_seen.first_at_ms above: leaving it unshifted would make
    // the one time-gated rule in the duel feature untestable by this tool. Shifting it
    // moves the displayed timestamps in /duel record — accepted, exactly as this tool
    // already moves lastFedAt. A duel row is two-sided, so shifting "this player's" rows
    // also lapses the opponent's cooldown against them, which is correct: the cooldown
    // is a property of the pair.
    ctx.db.update(schema.duels).set({ createdAt: sql`${schema.duels.createdAt} - ${shift}` })
      .where(or(eq(schema.duels.challengerId, targetId), eq(schema.duels.defenderId, targetId))).run();
```

`or` is already imported in this file (used by the trades delete).

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/admin/service.ts tests/admin.test.ts
git commit -m "feat(duels): cover the duel log and columns in admin reset and fast-forward"
```

---

## Task 14: Help topic and documentation

**Files:**
- Modify: `src/modules/help/index.ts`, `docs/gameplay.md`, `docs/commands.md`, `docs/ops.md`, `README.md`
- Test: `tests/help.test.ts` (a new assertion)

**Interfaces:**
- Consumes: nothing.
- Produces: `HELP_TOPICS.duel` (no `art` descriptor).

- [ ] **Step 1: Write the failing test**

Append to `tests/help.test.ts`:

```ts
it('carries a duel topic naming every /duel subcommand', () => {
  const body = HELP_TOPICS.duel?.body ?? '';
  for (const sub of ['ghost', 'challenge', 'squad', 'record']) {
    expect(body, `HELP_TOPICS.duel should mention /duel ${sub}`).toContain(`/duel ${sub}`);
  }
  // No art descriptor: an art-bearing topic must also be added to the hard-coded
  // sorted list in the art test above, and 3b ships no new image files.
  expect(HELP_TOPICS.duel?.art).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/help.test.ts`
Expected: FAIL — `expected '' to contain '/duel ghost'`.

- [ ] **Step 3: Add the topic**

In `src/modules/help/index.ts`, add to `HELP_TOPICS` after the `daily` entry:

```ts
  duel: { title: '⚔️ Duels', body: [
    'Duels are free exhibition fights against another player. They cost no energy and pay no cash, shards or XP — the only thing at stake is your duel rating.',
    '`/duel ghost opponent:<player>` — fight a snapshot of their squad right now. They do not need to be online; they are told afterwards.',
    '`/duel challenge opponent:<player>` — post a live challenge they can Accept or Decline. It expires after 15 minutes.',
    '`/duel squad [dino1] [dino2] [dino3]` — pick the dinos you field. Leave blank to go back to your top three by level.',
    '`/duel record [player]` — rating, win-loss-draw record and recent opponents.',
    'Rating starts at 1000 and is zero-sum: the winner takes exactly what the loser gives, so beating a much weaker player is worth almost nothing and losing to one costs a lot.',
    'You cannot ghost the same player twice within 6 hours — they can challenge you back immediately.',
    '`/top metric:duels` ranks everyone by duel rating.',
  ].join('\n') },
```

Adding a **key** changes `/help`'s builder choices, so this is one more reason `npm run deploy-commands` is mandatory before this ships.

- [ ] **Step 4: Update the docs**

`docs/gameplay.md` — append a new section at the **end** of the file (it currently ends at `## 18. The world`; the duel section becomes **§19**, so nothing is renumbered and `docs/ops.md`'s "§4"/"§11" citations stay correct):

```markdown
## 19. Duels

Duels are free exhibition fights between two players. They cost no energy,
and they pay no cash, shards, food or battle XP — the only thing that moves
is your duel rating and your record. That is deliberate: with nothing to
farm, two accounts working together have nothing to gain from each other.

### The two formats

`/duel ghost opponent:<player>` fights a snapshot of their squad
immediately. The other player does not have to be online; they are told
afterwards unless they have turned park alerts off.

`/duel challenge opponent:<player>` posts a card they can **Accept** or
**Decline**. It expires after 15 minutes, and nothing is decided until the
button is clicked — both squads and both ratings are read at that moment,
so an old challenge fights the squad you have now, not the one you had when
it was posted.

### Which dinos fight

By default, your top three by battle level, escaped dinos excluded. Set your
own with `/duel squad dino1: … dino2: … dino3: …`, or clear it back to
automatic by running `/duel squad` with no options. If a dino in your set
squad is sold, traded away or escapes, it is simply skipped; you do not have
to fix anything.

Both sides field their squads by the same rule, so nobody gets to counter-pick.
Traits apply on both sides, exactly as they do in campaign battles.

### Rating

Everyone starts at 1000. A duel is zero-sum: whatever the winner gains, the
loser loses, and a draw moves both toward each other. Beating someone rated
far below you is worth very little; losing to them costs a lot. There is no
floor and no reset.

`/duel record` shows your rating, your win-loss-draw record and your recent
opponents. `/top metric:duels` ranks everyone. Ratings cluster tightly at
1000 until people actually duel, and there is no tiebreak rule for equal
values.

### Pacing

Duels are unlimited, with one rule: you cannot ghost the same player twice
within 6 hours. That limit is directional — someone who ghosted you can be
ghosted back straight away.
```

`docs/commands.md` — add rows to the command table:

```markdown
| `/duel ghost` | Fight a snapshot of another player's squad | Free — no energy, no rewards. Once per opponent every 6 hours |
| `/duel challenge` | Post a live duel challenge with Accept / Decline | Expires after 15 minutes; squads and ratings resolve when it is clicked |
| `/duel squad` | Pick the dinos you field in duels | Up to 3. Run with no options to go back to your top three by level |
| `/duel record` | Duel rating, win-loss-draw record and recent opponents | Add `player:` to read someone else's |
```

and correct two stale lines in the same file:

- the `/top` row — metric list becomes "rating, cash, collection, legacy standing, battle stars, or duel rating".
- the `/help` row — "How to play, across **twelve** topics".

`README.md` — two stale lines:

- the leaderboards bullet: "ranked by rating, cash, collection, legacy, battle stars, or duel rating".
- the `/help` line: "one of its **twelve** topics".

`docs/ops.md` — three stale figures:

- "Fourteen modules ship today" → "Sixteen modules ship today", and add the two missing bullets:
  ```markdown
  - `dex` — the species compendium, with filters and per-species detail.
  - `duels` — free player-versus-player exhibition duels and the duel rating.
  ```
- "Should report `25` commands deployed" → "Should report `27` commands deployed", and append `dex, and duels` to that sentence's module list.
- the `leaderboards` bullet: "rankings by rating, cash, collection, legacy, battle stars, and duel rating".

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/help.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS (the whole suite — a `HELP_TOPICS` key change also moves `/help`'s builder JSON).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/help/index.ts docs README.md tests/help.test.ts
git commit -m "docs: document duels and correct four stale command and module counts"
```

---

## Task 15: The live payload gallery

**Files:**
- Modify: `scripts/test-live.ts`
- Test: none (this script is run by hand against the dev guild; it has no offline test)

**Interfaces:**
- Consumes: the `/duel` command and the `duel` component (Tasks 7-9).
- Produces: two new gallery cases, 52 → 54.

- [ ] **Step 1: Seed a second duellable player**

`scripts/test-live.ts` defines `const P1 = 'live-p1', P2 = 'live-p2';` and creates P2's park with `getOrCreateUser(ctx, P2, 'Counterparty')`, but P2 owns **no dinos** — the only dino that reaches them is inside a *pending* trade offer, which never completes. A duel against P2 would therefore reject with "That player has no battle-ready dinos."

Add one, immediately after P2's `getOrCreateUser` line:

```ts
// P2 owns no dinos otherwise (their only one sits in a pending trade offer), and a
// duel opponent needs at least one battle-ready dino.
ctx.db.insert(schema.dinos)
  .values({ userId: P2, speciesId: 'triceratops', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(), battleXp: 700 }).run();
```

Do not introduce a new player constant — P2 is the established counterparty and is already used by the trading and visiting cases.

- [ ] **Step 2: Add the two cases**

Insert **before** the `/achievements` case near the end of the array — never after the `alert sweep` case, which rewrites `lastFedAt` on every P1 dino and `lastCollectAt` on the shared ctx:

```ts
  // Duels: free, so nothing here disturbs cash/energy/XP for later cases. The ghost
  // case resolves a real fight; the challenge case posts the card without resolving
  // anything, so the two do not trip the 6-hour pair cooldown on each other.
  { title: '/duel ghost — resolved duel result', run: () => slash('duels', 'duel', { name: 'duel', sub: 'ghost', user: P1, options: { opponent: P2 } }) },
  { title: '/duel challenge — challenge card with Accept/Decline', run: () => slash('duels', 'duel', { name: 'duel', sub: 'challenge', user: P1, options: { opponent: P2 } }) },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`tsconfig.test.json` is the only config that includes `scripts/`, so `npm run build` would not catch an error here.)

- [ ] **Step 4: Commit**

```bash
git add scripts/test-live.ts
git commit -m "test: add duel result and challenge card to the live payload gallery"
```

Note: `npm run test:live` itself is an operator step (Task 16) — it deploys builders and posts to the dev guild, so it is not run as part of this task.

---

## Task 16: Full verification and the operator runbook

**Files:**
- Modify: none (verification only), unless a failure is found

**Interfaces:**
- Consumes: everything above.
- Produces: a verified branch and the ordered operator steps.

- [ ] **Step 1: Run the whole offline gate**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all three clean. `npm run build` must pass because the bot runs compiled `dist/`.

- [ ] **Step 2: Confirm the counts the spec pinned**

```bash
npx vitest run tests/registry-load.test.ts tests/contract.test.ts tests/config.test.ts
```

Expected: PASS with 16 modules and 27 commands. If `contract.test.ts` fails on the autocomplete manifest, the builder flag and the `'duel squad'` entry disagree — the check runs in both directions.

- [ ] **Step 3: Confirm the migration applies to a populated database**

```bash
npx vitest run tests/migration.test.ts
```

Expected: PASS, including the 0013 block, which seeds a parent `users` row and a child `dinos` row and asserts `PRAGMA foreign_keys` is 1 afterwards.

- [ ] **Step 4: Commit anything outstanding, then hand over the operator steps**

These are **not** part of the implementation; they are run by the repo owner, in this order:

1. Back up the live database — **all three** files: `dino-world.db`, `dino-world.db-wal`, `dino-world.db-shm`. The WAL can be newer than the main file, so a `.db`-only copy loses committed data.
2. `npm run build`, then restart the single bot instance. Migration 0013 applies on boot. Exactly one process per token.
3. `npm run deploy-commands` — should report **27** commands.
4. `npm run test:live` — **after** the restart. It issues the same `rest.put` deploy that step 3 does, so running it earlier makes the guild advertise new builders against the old process.
5. No `deploy-emojis` and no art step: 3b ships no new emoji and no new image files.

Verify after step 2: the bot logs a clean start, and `sqlite3 dino-world.db "PRAGMA table_info(users)"` lists `duel_rating` and `duel_squad`, with `SELECT COUNT(*) FROM duels` returning 0.

---

## Self-Review

**Spec coverage** — every section of `docs/superpowers/specs/2026-08-11-server-is-a-park-3b-design.md` maps to a task:

| Spec section | Task |
| --- | --- |
| §2.1 squad resolution, read-only defender escapes | 3 |
| §2.2 the fight, traits on both sides, coin flip, no world event | 4 |
| §2.3 three-valued outcome | 4 |
| §2.4 Elo and its two invariants | 1 |
| §2.5 pair cooldown | 5 |
| §3 schema, migration, no rating gate | 2 |
| §4 command surface, buttons, guards, reply visibility, constants | 7, 8, 9, 10 |
| §5 single result embed, one image ref, no new art | 6 |
| §6 notification and consent copy | 11 |
| §7 `/top duels` | 12 |
| §8 admin obligations | 13 |
| §9 registration (six sites) | 7 (sites 1-5), 9 (site 6, the manifest entry) |
| §10 help, docs, stale figures, test:live | 14, 15 |
| §11 errors and the double-accept race | 5, 7, 8 |
| §12 testing | every task (TDD) |
| §13 operator steps | 16 |
| §14 out of scope | not implemented, by design |

**Type consistency** — `DuelSquadMember`, `DuelOutcome`, `DuelRecord`, `DuelResult`, `DuelMode`, `DuelPayload` and `DUEL_PREFIX` are each defined once and referenced by the same name in every later task. `resolveDuel` gains its fifth parameter in Task 5 and every later call site passes it (or omits it on the ghost path, where it is unused).

**Known ordering constraint** — Task 9 must not be split: the builder flag, the autocomplete provider and the `AUTOCOMPLETE_OPTIONS` entry are enforced against each other in both directions, plus a third test that fails any command defining `autocomplete()` with no flagged option. Shipping any one of the three alone leaves the suite red.
