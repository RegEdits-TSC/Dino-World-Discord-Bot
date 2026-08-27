# Operator Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tx_log` readable to the operator and add a precise, idempotent reversal on top of it, so a wrong charge can be undone exactly rather than guessed at with `/admin give`.

**Architecture:** A reversal is a compensating ledger row, never an edit — `tx_log` stays append-only and "already reversed?" is derived by looking for a row whose `reverses_id` points at the target. The primitive lives in `EconomyService` beside `apply`, because it needs the same transaction and the same balance guards; the admin module holds only presentation and orchestration.

**Tech Stack:** TypeScript ESM (NodeNext), drizzle + better-sqlite3 (synchronous), vitest, discord.js.

**Spec:** `docs/superpowers/specs/2026-08-27-operator-refunds-design.md`

## Global Constraints

- **Relative imports carry a `.js` extension.** ESM NodeNext, no exceptions.
- **Time is `ctx.now()`, randomness is `ctx.rng()`.** Never `Date.now()` / `Math.random()`.
- **DB access is synchronous** drizzle/better-sqlite3 (`.get()` / `.all()` / `.run()`), never awaited.
- **`npm run typecheck` is the gate**, not `npm run build` or `npm test`. `build` only covers `src`; `test` transpiles without typechecking.
- **Authorship:** commits authored by RegEdits. No AI/tool attribution anywhere — no `Co-Authored-By`, no "Generated with" footer, no mention of Claude/AI/assistant/LLM in any commit message, comment, or document.
- **Never weaken a test to make it pass.** Every assertion names a specific value.
- **Reversals are terminal.** Reversing a reversal is refused. The derived "already reversed?" flag depends on this; if it is ever relaxed, the flag silently starts lying.
- **Adding a subcommand changes the builder**, so `npm run deploy-commands` is required after merge. `tests/contract.test.ts` counts 29 top-level commands — that number does NOT change, because these are subcommands of the existing `/admin`.
- **No new option uses `.setAutocomplete(true)`**, so `tests/contract.test.ts`'s bidirectional `AUTOCOMPLETE_OPTIONS` manifest needs no entry.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/db/schema.ts` (modify) | `tx_log.reverses_id`, `tx_log.note`, and the partial index |
| `drizzle/0019_operator_refunds.sql` (create, generated) | pure additive DDL |
| `src/core/economy.ts` (modify) | `reverse()`, `ReversalError`, and a shared private post helper |
| `src/data/tx-reasons.ts` (create) | reason-prefix → side-effect note, failing closed on unknown |
| `src/modules/admin/ledger.ts` (create) | the ledger embed and its page row |
| `src/modules/admin/service.ts` (modify) | `adminReverse` orchestration — ownership, pre-reset refusal, notify |
| `src/modules/admin/index.ts` (modify) | the two subcommand builders, dispatch, and the paging component |

Tests live beside their subject: `tests/migration.test.ts`, `tests/economy.test.ts`, `tests/tx-reasons.test.ts`, `tests/admin.test.ts`.

---

## Task 1: The columns and the migration

**Files:**
- Modify: `src/core/db/schema.ts`
- Create: `drizzle/0019_operator_refunds.sql` (via `npx drizzle-kit generate`)
- Modify: `tests/migration.test.ts`

**Interfaces:**
- Produces: `schema.txLog.reversesId` (`number | null`) and `schema.txLog.note` (`string | null`).

**Design note — no database-level foreign key.** The spec describes `reverses_id` as referencing `tx_log.id`. Implement it as a plain nullable integer with a comment saying so, NOT a drizzle `.references()` self-reference: a self-referencing FK complicates drizzle's type inference for no benefit here, since nothing in `src/` ever deletes a `tx_log` row.

- [ ] **Step 1: Add the columns and the partial index**

In `src/core/db/schema.ts`, replace the `txLog` table definition with:

```ts
export const txLog = sqliteTable('tx_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  cashDelta: integer('cash_delta').notNull().default(0),
  foodDelta: integer('food_delta').notNull().default(0),
  foodId: text('food_id'),
  shardsDelta: integer('shards_delta').notNull().default(0),
  reason: text('reason').notNull(),
  createdAt: integer('created_at_ms').notNull(),
  // The tx_log.id this row reverses. Deliberately not a DB-level foreign key: nothing in
  // src/ ever deletes a ledger row, and a self-reference costs drizzle type inference for
  // nothing. A reversal is a compensating ENTRY — the target row is never edited.
  reversesId: integer('reverses_id'),
  // Operator's free-text reason for a reversal. Kept out of `reason`, which is structured
  // (build:<kind>, landmark:<tier>) and is what the side-effect table keys on.
  note: text('note'),
  // PARTIAL: only reversal rows carry a reverses_id, so an ordinary charge — on what will
  // become the largest table in the schema — pays essentially nothing, while the
  // double-reversal guard stays logarithmic. Same shape as timers_due.
}, (t) => [index('tx_log_reverses').on(t.reversesId).where(sql`${t.reversesId} is not null`)]);
```

`index` and `sql` are already imported at the top of this file.

- [ ] **Step 2: Generate the migration**

```bash
npx drizzle-kit generate
```

drizzle-kit picks a random name. Rename it and fix the journal tag, exactly as 0018 did:

```bash
mv drizzle/0019_<generated>.sql drizzle/0019_operator_refunds.sql
sed -i 's/0019_<generated>/0019_operator_refunds/' drizzle/meta/_journal.json
```

- [ ] **Step 3: Verify the generated SQL is purely additive**

```bash
cat drizzle/0019_operator_refunds.sql
```

Expected: two `ALTER TABLE tx_log ADD ...` statements and one `CREATE INDEX ... WHERE ...`. **If it contains `DROP TABLE` or recreates `tx_log`, stop and report** — a table recreate is the one migration shape that is hazardous on a populated database here.

Then confirm drizzle agrees the snapshot chain is intact:

```bash
npx drizzle-kit check
```

Expected: `Everything's fine`.

- [ ] **Step 4: Write the migration test**

Append to `tests/migration.test.ts`, following the 0018 case directly above it:

```ts
describe('0019 operator refunds via the real drizzle migrator (production path)', () => {
  it('adds reverses_id and note to a populated DB and indexes only reversal rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig19-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[0-8]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 18);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0018 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO tx_log (user_id, cash_delta, reason, created_at_ms)
                    VALUES ('u1', -500, 'build:paddock_plains', 10)`).run();

    // Before/after, so this case cannot pass vacuously.
    const before = (sqlite.prepare(`SELECT name FROM pragma_table_info('tx_log')`)
      .all() as Array<{ name: string }>).map((r) => r.name);
    expect(before).not.toContain('reverses_id');
    expect(before).not.toContain('note');

    try {
      expect(() => migrateDb(db)).not.toThrow();

      const cols = (sqlite.prepare(`SELECT name FROM pragma_table_info('tx_log')`)
        .all() as Array<{ name: string }>).map((r) => r.name);
      expect(cols).toContain('reverses_id');
      expect(cols).toContain('note');

      // The pre-existing row survives and reads NULL for both new columns.
      expect(sqlite.prepare(`SELECT reverses_id, note FROM tx_log WHERE id = 1`).get())
        .toEqual({ reverses_id: null, note: null });

      // The index is partial, and that is the point: an ordinary charge must not enter it.
      const idxSql = (sqlite.prepare(
        `SELECT sql FROM sqlite_master WHERE name = 'tx_log_reverses'`,
      ).get() as { sql: string }).sql;
      expect(idxSql).toMatch(/where\s+"?tx_log"?\.?"?reverses_id"?\s+is\s+not\s+null/i);

      // And the planner uses it for the double-reversal guard's exact query.
      const plan = (sqlite.prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM tx_log WHERE reverses_id = ?`,
      ).all(1) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
      expect(plan).toContain('tx_log_reverses');

      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run the migration test**

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS, one more test than before.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: both green. Nothing reads the new columns yet, so no other test may move.

- [ ] **Step 7: Commit**

```bash
git add src/core/db/schema.ts drizzle tests/migration.test.ts
git commit -m "Add the reversal columns to the ledger"
```

---

## Task 2: `EconomyService.reverse`

**Files:**
- Modify: `src/core/economy.ts`
- Modify: `tests/economy.test.ts`

**Interfaces:**
- Consumes: `schema.txLog.reversesId`, `schema.txLog.note` from Task 1.
- Produces: `ReversalError` (exported class) and
  `EconomyService.reverse(txId: number, now: number, note?: string): { targetId: number; reversalId: number }`.

**The refactor this task rests on.** `apply` currently inlines the balance guards and the row writes. `reverse` needs exactly the same guards. Do NOT copy them — extract a private method both call, or the review will (correctly) flag verbatim duplication of a logic block.

- [ ] **Step 1: Write the failing tests**

Append to `tests/economy.test.ts`:

```ts
describe('EconomyService.reverse', () => {
  it('posts a compensating row and moves the balance back', () => {
    eco.apply('u1', { cash: -300 }, 'build:paddock_plains', 100);
    expect(bal().cash).toBe(200);

    const charge = db.select().from(schema.txLog).all().at(-1)!;
    const out = eco.reverse(charge.id, 500);

    expect(bal().cash).toBe(500);
    const reversal = db.select().from(schema.txLog)
      .where(eq(schema.txLog.id, out.reversalId)).get()!;
    expect(reversal).toMatchObject({
      userId: 'u1', cashDelta: 300, reason: 'reverse', reversesId: charge.id, note: null,
    });
  });

  it('stores the operator note on the reversal row', () => {
    eco.apply('u1', { cash: -100 }, 'landmark:1', 100);
    const charge = db.select().from(schema.txLog).all().at(-1)!;
    const out = eco.reverse(charge.id, 500, 'stale button double-charge');
    expect(db.select().from(schema.txLog).where(eq(schema.txLog.id, out.reversalId)).get()!.note)
      .toBe('stale button double-charge');
  });

  it('reverses a food row independently of its cash row', () => {
    eco.apply('u1', { cash: -50, foods: { ferns: 3 } }, 'shop-food:ferns:3', 100);
    const rows = db.select().from(schema.txLog).all();
    const foodRow = rows.find((r) => r.foodId === 'ferns')!;
    eco.reverse(foodRow.id, 500);
    expect(eco.getFoodInventory('u1').ferns ?? 0).toBe(0);
    expect(bal().cash).toBe(450);                       // the cash row is untouched
  });

  it('refuses an unknown transaction', () => {
    expect(() => eco.reverse(9999, 500)).toThrow(ReversalError);
  });

  it('refuses to reverse the same charge twice', () => {
    eco.apply('u1', { cash: -100 }, 'build:x', 100);
    const charge = db.select().from(schema.txLog).all().at(-1)!;
    eco.reverse(charge.id, 500);
    expect(() => eco.reverse(charge.id, 600)).toThrow(/already reversed/i);
  });

  it('refuses to reverse a reversal — reversals are terminal', () => {
    eco.apply('u1', { cash: -100 }, 'build:x', 100);
    const charge = db.select().from(schema.txLog).all().at(-1)!;
    const out = eco.reverse(charge.id, 500);
    expect(() => eco.reverse(out.reversalId, 600)).toThrow(/terminal/i);
  });

  it('refuses a credit reversal the player can no longer afford, leaving no partial row', () => {
    eco.apply('u1', { cash: 1000 }, 'admin:give', 100);   // 500 -> 1500
    const grant = db.select().from(schema.txLog).all().at(-1)!;
    eco.apply('u1', { cash: -1400 }, 'build:x', 200);     // 1500 -> 100
    const before = db.select().from(schema.txLog).all().length;

    expect(() => eco.reverse(grant.id, 500)).toThrow(InsufficientFundsError);
    expect(bal().cash).toBe(100);                          // unchanged
    expect(db.select().from(schema.txLog).all()).toHaveLength(before);  // no partial row
  });
});
```

Add `ReversalError` to the existing import from `../src/core/economy.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/economy.test.ts -t "EconomyService.reverse"`
Expected: FAIL — `reverse` is not a function and `ReversalError` is not exported.

- [ ] **Step 3: Extract the shared post helper**

In `src/core/economy.ts`, add the error class beside `InsufficientFundsError`, and a type alias
for the transaction handle:

```ts
export class ReversalError extends Error {}

// The handle drizzle hands a transaction callback. NOT `Db` — a transaction is a narrower
// type, and typing the shared helper's parameter as `Db` will not compile.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
```

Then refactor `apply` so its body moves into a private helper that both callers use. Replace the existing `apply` with:

```ts
  apply(userId: string, delta: WalletDelta, reason: string, now: number): void {
    this.db.transaction((tx) => { this.post(tx, userId, delta, reason, now, null, null); });
  }

  // The single writer for every wallet movement. Called inside an open transaction by both
  // apply() and reverse() so the balance guards and the audit rows can never diverge.
  private post(
    tx: Tx, userId: string, delta: WalletDelta, reason: string, now: number,
    reversesId: number | null, note: string | null,
  ): number {
    const { cash = 0, shards = 0, foods = {} } = delta;
    const foodEntries = (Object.entries(foods) as Array<[FoodId, number]>).filter(([, q]) => q !== 0);
    const u = tx.select().from(schema.users)
      .where(eq(schema.users.discordId, userId)).get();
    if (!u) throw new Error(`Unknown user ${userId}`);
    if (u.cash + cash < 0) throw new InsufficientFundsError('cash');
    if (u.shards + shards < 0) throw new InsufficientFundsError('shards');
    tx.update(schema.users).set({
      cash: sql`${schema.users.cash} + ${cash}`,
      shards: sql`${schema.users.shards} + ${shards}`,
    }).where(eq(schema.users.discordId, userId)).run();
    for (const [foodId, qty] of foodEntries) {
      const row = tx.select().from(schema.foodInventory)
        .where(and(eq(schema.foodInventory.userId, userId), eq(schema.foodInventory.foodId, foodId))).get();
      const next = (row?.qty ?? 0) + qty;
      if (next < 0) throw new InsufficientFundsError('food', foodId);
      if (row) {
        tx.update(schema.foodInventory).set({ qty: next })
          .where(and(eq(schema.foodInventory.userId, userId), eq(schema.foodInventory.foodId, foodId))).run();
      } else {
        tx.insert(schema.foodInventory).values({ userId, foodId, qty: next }).run();
      }
    }
    const base = tx.insert(schema.txLog)
      .values({ userId, cashDelta: cash, shardsDelta: shards, reason, createdAt: now, reversesId, note })
      .returning().get();
    for (const [foodId, qty] of foodEntries) {
      tx.insert(schema.txLog)
        .values({ userId, foodDelta: qty, foodId, reason, createdAt: now, reversesId, note }).run();
    }
    return base.id;
  }
```

The behaviour of `apply` is unchanged — the same guards in the same order, writing the same rows, with the two new columns defaulting to `null`.

- [ ] **Step 4: Implement `reverse`**

Add to `EconomyService`, below `apply`:

```ts
  // Reverses one ledger row by posting its opposite as a NEW row. tx_log is append-only: the
  // target is never edited, and "already reversed?" is derived by looking for a row that
  // points at it. Read, guard and both writes share one transaction, and better-sqlite3 is
  // synchronous with no suspension point between them, so a double reversal is structurally
  // impossible rather than checked by convention.
  reverse(txId: number, now: number, note?: string): { targetId: number; reversalId: number } {
    return this.db.transaction((tx) => {
      const target = tx.select().from(schema.txLog).where(eq(schema.txLog.id, txId)).get();
      if (!target) throw new ReversalError(`No transaction #${txId}.`);
      // Reversals are terminal. Reversing a reversal is coherent double-entry, but it would
      // leave the target still pointed at by a row while the player is, on net, charged —
      // so the derived flag would report "reversed" and be wrong.
      if (target.reversesId !== null) {
        throw new ReversalError(`#${txId} is itself a reversal, and reversals are terminal.`);
      }
      const existing = tx.select().from(schema.txLog)
        .where(eq(schema.txLog.reversesId, txId)).get();
      if (existing) throw new ReversalError(`#${txId} was already reversed by #${existing.id}.`);

      // A row is either a cash/shards row or a food row, never both — apply() writes them
      // separately, so each reverses independently.
      const delta: WalletDelta = target.foodId
        ? { foods: { [target.foodId as FoodId]: -target.foodDelta } }
        : { cash: -target.cashDelta, shards: -target.shardsDelta };

      const reversalId = this.post(tx, target.userId, delta, 'reverse', now, target.id, note ?? null);
      return { targetId: target.id, reversalId };
    });
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/economy.test.ts`
Expected: PASS, including every pre-existing `apply` case — the refactor must move nothing.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add src/core/economy.ts tests/economy.test.ts
git commit -m "Reverse a ledger row by posting its opposite"
```

---

## Task 3: The side-effect table

**Files:**
- Create: `src/data/tx-reasons.ts`
- Create: `tests/tx-reasons.test.ts`

**Interfaces:**
- Produces: `sideEffectFor(reason: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/tx-reasons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sideEffectFor } from '../src/data/tx-reasons.js';

describe('sideEffectFor', () => {
  it('names what a charge left behind', () => {
    expect(sideEffectFor('build:paddock_plains')).toMatch(/lot still stands/i);
    expect(sideEffectFor('landmark:3')).toMatch(/landmarkTier/i);
    expect(sideEffectFor('sell:triceratops')).toMatch(/destroyed/i);
    expect(sideEffectFor('splice:12')).toMatch(/irreversible/i);
  });

  it('reads the prefix, not the whole reason', () => {
    expect(sideEffectFor('upgrade:hatchery_lab:5')).toBe(sideEffectFor('upgrade:paddock_plains:2'));
  });

  it('fails CLOSED on an unrecognised prefix', () => {
    // A blank note and "no side effect" are indistinguishable to a tired operator, and new
    // spend paths will ship without an entry here. The tool must say it does not know.
    expect(sideEffectFor('brand-new-feature:7')).toMatch(/unrecognised — check manually/i);
  });

  it('does not read prototype keys as entries', () => {
    // Repo convention: null-prototype lookup tables. A plain object would read back a
    // truthy value for these and silently claim a side effect that does not exist.
    expect(sideEffectFor('constructor:1')).toMatch(/unrecognised/i);
    expect(sideEffectFor('__proto__:1')).toMatch(/unrecognised/i);
  });

  it('says a reversal row left nothing behind', () => {
    expect(sideEffectFor('reverse')).toBe('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tx-reasons.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/data/tx-reasons.ts`:

```ts
// What a charge leaves behind that reversing it does NOT undo. A reversal moves money and
// nothing else, so the ledger view says so at every row rather than letting the operator
// infer it.
//
// Null-prototype, the same shape as PADDOCKS and FACILITIES: a plain object would read back
// a truthy value for `constructor` or `__proto__` and claim a side effect that is not there.
const SIDE_EFFECTS = Object.assign(Object.create(null) as Record<string, string>, {
  build: 'the lot still stands',
  upgrade: 'the lot keeps its level',
  landmark: 'landmarkTier stays raised',
  attraction: 'the attraction row remains',
  decorate: 'the decor stays on the lot',
  'shop-egg': 'the egg remains',
  mythic: 'the egg remains',
  breed: 'the breeding row remains',
  splice: 'traits were re-rolled — irreversible',
  sell: 'the dino was destroyed; the cash returning does not bring it back',
  rescue: 'the dino is already un-escaped',
  expedition: 'the expedition row remains',
  'shop-food': 'the food is a separate ledger row needing its own reversal',
  feed: 'the dino was already fed',
} satisfies Record<string, string>);

export function sideEffectFor(reason: string): string {
  if (reason === 'reverse') return '—';
  const prefix = reason.split(':')[0] ?? '';
  return Object.hasOwn(SIDE_EFFECTS, prefix)
    ? SIDE_EFFECTS[prefix]!
    : 'unrecognised — check manually';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tx-reasons.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src/data/tx-reasons.ts tests/tx-reasons.test.ts
git commit -m "Name what each charge leaves behind"
```

---

## Task 4: `/admin ledger`

**Files:**
- Create: `src/modules/admin/ledger.ts`
- Modify: `src/modules/admin/index.ts`
- Modify: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `sideEffectFor` from Task 3; `schema.txLog.reversesId` from Task 1.
- Produces: `ledgerPayload(ctx: Ctx, targetId: string, page: number): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }`.

**The customId inversion — read this before writing the handler.** `pageRow` builds `<prefix>:<action>:<userId>:<page>` and its comment says the embedded id "locks paging to the list owner." Here that slot holds the **target** player, not the clicker — the `park:tour:<targetUserId>` precedent. So the component handler checks `i.user.id === ctx.config.ownerId`, **never** a comparison against the segment. Getting this backwards lets the target page their own audit log.

- [ ] **Step 1: Write the failing tests**

Append to `tests/admin.test.ts`:

```ts
describe('/admin ledger', () => {
  it('lists rows newest first with ids, and marks the three row states', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: -300 }, 'build:paddock_plains', 100);
    const charge = ctx.db.select().from(schema.txLog).all().at(-1)!;
    ctx.economy.apply('u1', { cash: -50 }, 'decorate:fern', 200);
    ctx.economy.reverse(charge.id, 300);

    const text = JSON.stringify(ledgerPayload(ctx, 'u1', 1));
    expect(text).toContain(`#${charge.id}`);
    expect(text).toMatch(/reverses/i);          // the reversal row identifies its target
    expect(text).toMatch(/already reversed/i);  // and the charge is marked as made good
    expect(text).toMatch(/lot still stands/i);  // side-effect note from Task 3
  });

  it('marks rows that predate a reset', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    // A charge older than the users row can only be pre-reset: adminReset drops the user
    // row and getOrCreateUser stamps a fresh createdAt.
    ctx.db.insert(schema.txLog).values({
      userId: 'u1', cashDelta: -1, reason: 'build:x', createdAt: -1,
    }).run();
    expect(JSON.stringify(ledgerPayload(ctx, 'u1', 1))).toMatch(/pre-reset/i);
  });

  it('pages, and the page buttons carry the TARGET id', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    for (let n = 0; n < PAGE_SIZE + 3; n++) ctx.economy.apply('u1', { cash: 1 }, 'collect', n);
    const p = ledgerPayload(ctx, 'u1', 1);
    expect(JSON.stringify(p.components)).toContain('admin:ledger:u1:2');
  });
});
```

Import `ledgerPayload` from `../src/modules/admin/ledger.js`, `PAGE_SIZE` from `../src/core/paginate.js`, and `schema` / `getOrCreateUser` alongside the file's existing imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin.test.ts -t "/admin ledger"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the payload**

Create `src/modules/admin/ledger.ts`:

```ts
import { EmbedBuilder, type ActionRowBuilder, type ButtonBuilder } from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { sideEffectFor } from '../../data/tx-reasons.js';
import type { Ctx } from '../../core/context.js';

function amount(r: typeof schema.txLog.$inferSelect): string {
  if (r.foodId) return `${r.foodDelta > 0 ? '+' : ''}${r.foodDelta} ${r.foodId}`;
  const parts: string[] = [];
  if (r.cashDelta) parts.push(`${r.cashDelta > 0 ? '+' : ''}${r.cashDelta} cash`);
  if (r.shardsDelta) parts.push(`${r.shardsDelta > 0 ? '+' : ''}${r.shardsDelta} shards`);
  return parts.join(' ') || '0';
}

// The operator's window onto tx_log. Every row for the player is listed, food rows included —
// this is the ledger, not a curated summary.
export function ledgerPayload(ctx: Ctx, targetId: string, page: number) {
  const rows = ctx.db.select().from(schema.txLog)
    .where(eq(schema.txLog.userId, targetId)).orderBy(desc(schema.txLog.id)).all();
  const reversedBy = new Map<number, number>();
  for (const r of rows) if (r.reversesId !== null) reversedBy.set(r.reversesId, r.id);
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, targetId)).get();
  const resetAt = user?.createdAt ?? 0;

  const { items, page: p, pages } = paginate(rows, page);
  const lines = items.map((r) => {
    if (r.reversesId !== null) {
      return `\`#${r.id}\` ↩ reverses #${r.reversesId} — ${amount(r)}${r.note ? ` · ${r.note}` : ''}`;
    }
    const marks: string[] = [];
    const by = reversedBy.get(r.id);
    if (by !== undefined) marks.push(`already reversed by #${by}`);
    if (r.createdAt < resetAt) marks.push('pre-reset');
    const tail = marks.length ? ` · **${marks.join(' · ')}**` : '';
    return `\`#${r.id}\` \`${r.reason}\` ${amount(r)} — ${sideEffectFor(r.reason)}${tail}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🧾 Ledger — ${targetId}`)
    .setDescription(lines.join('\n') || 'No transactions.')
    .setFooter({ text: `Page ${p}/${pages}` });
  const components: ActionRowBuilder<ButtonBuilder>[] =
    pages > 1 ? [pageRow('admin', 'ledger', targetId, p, pages)] : [];
  return { embeds: [embed], components };
}
```

- [ ] **Step 4: Wire the subcommand and the page button**

In `src/modules/admin/index.ts`, add the builder inside the existing `/admin` command, beside `inspect`:

```ts
        .addSubcommand((s) => s.setName('ledger').setDescription('Read a player’s transaction ledger')
          .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
          .addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1)))
```

Add the dispatch branch to the existing `if/else` chain, before the final `else`:

```ts
          } else if (sub === 'ledger') {
            const page = i.options.getInteger('page') ?? 1;
            await i.reply({ ...ledgerPayload(ctx, target.id, page), flags: MessageFlags.Ephemeral });
```

Add a `components` array to the manifest (the admin module has none today):

```ts
  components: [
    {
      prefix: 'admin:ledger',
      async execute(ctx, i) {
        // The id segment is the TARGET, not the clicker — the park:tour precedent — so the
        // gate is ownership of the BOT, never a match against the segment.
        if (i.user.id !== ctx.config.ownerId) { await i.deferUpdate(); return; }
        const [, , targetId, pageStr] = i.customId.split(':');
        await i.update(ledgerPayload(ctx, targetId!, Number(pageStr)));
      },
    },
  ],
```

Import `ledgerPayload` from `./ledger.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: green. `tests/contract.test.ts`'s top-level count stays 29 — a subcommand does not change it. If that number moves, stop: it means a command was added rather than a subcommand.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin tests/admin.test.ts
git commit -m "Make the ledger readable to the operator"
```

---

## Task 5: `/admin reverse`

**Files:**
- Modify: `src/modules/admin/service.ts`
- Modify: `src/modules/admin/index.ts`
- Modify: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `EconomyService.reverse` and `ReversalError` from Task 2; `sideEffectFor` from Task 3.
- Produces: `adminReverse(ctx: Ctx, targetId: string, txId: number, note?: string): { sideEffect: string; notified: boolean }`.

Add `adminReverse`, `AdminError`, `schema`, `getOrCreateUser` and `eq` to `tests/admin.test.ts`'s existing imports as needed — the file already imports several of these.

**Ordering constraint — the reason this task has a test of its own.** The notification goes out **after** the transaction commits, never inside it. A failed DM must not roll back a completed reversal.

- [ ] **Step 1: Write the failing tests**

Append to `tests/admin.test.ts`:

```ts
describe('/admin reverse', () => {
  const seed = (ctx: ReturnType<typeof makeCtx>) => {
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: -300 }, 'build:paddock_plains', 100);
    return ctx.db.select().from(schema.txLog).all().at(-1)!;
  };

  it('reverses and reports what the money did not undo', () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    const out = adminReverse(ctx, 'u1', charge.id);
    expect(out.sideEffect).toMatch(/lot still stands/i);
    expect(out.notified).toBe(false);
  });

  it('refuses a row belonging to another player', () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    getOrCreateUser(ctx, 'u2', 'Two');
    expect(() => adminReverse(ctx, 'u2', charge.id)).toThrow(AdminError);
  });

  it('refuses a charge that predates a reset', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    const old = ctx.db.insert(schema.txLog).values({
      userId: 'u1', cashDelta: -1, reason: 'build:x', createdAt: -1,
    }).returning().get();
    expect(() => adminReverse(ctx, 'u1', old.id)).toThrow(/pre-reset|reset/i);
  });

  it('queues a note to the player when one is given', () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    const out = adminReverse(ctx, 'u1', charge.id, 'double-charged by a stale button');
    expect(out.notified).toBe(true);
    expect(ctx.notifications.map((n) => n.message).join(' ')).toMatch(/stale button/);
  });

  it('keeps the reversal committed when the notification throws', () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    ctx.notify = () => Promise.reject(new Error('DMs closed'));
    expect(() => adminReverse(ctx, 'u1', charge.id, 'here you go')).not.toThrow();
    // The money moved even though telling the player failed.
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(u.cash).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin.test.ts -t "/admin reverse"`
Expected: FAIL — `adminReverse` is not exported.

- [ ] **Step 3: Implement the orchestration**

Add to `src/modules/admin/service.ts`:

```ts
const NOTE_MAX = 200;

// Reverses one ledger row for a named player. The user id is required and checked against the
// row on purpose: it is the confirmation step, so a mistyped tx id becomes a refusal rather
// than a refund to the wrong person.
export function adminReverse(
  ctx: Ctx, targetId: string, txId: number, note?: string,
): { sideEffect: string; notified: boolean } {
  const row = ctx.db.select().from(schema.txLog).where(eq(schema.txLog.id, txId)).get();
  if (!row) throw new AdminError(`No transaction #${txId}.`);
  if (row.userId !== targetId) throw new AdminError(`#${txId} belongs to a different player.`);
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, targetId)).get();
  // adminReset clears every per-player table EXCEPT tx_log, and drops the users row, which
  // getOrCreateUser recreates with a fresh createdAt. So a charge older than the row is
  // pre-reset, and reversing it would credit a fresh account for money it never lost.
  if (user && row.createdAt < user.createdAt) {
    throw new AdminError(`#${txId} predates this player’s reset and cannot be reversed.`);
  }
  const trimmed = note?.trim().slice(0, NOTE_MAX) || undefined;

  try {
    ctx.economy.reverse(txId, ctx.now(), trimmed);
  } catch (e) {
    if (e instanceof ReversalError) throw new AdminError(e.message);
    if (e instanceof InsufficientFundsError) {
      throw new AdminError(`Cannot reverse #${txId}: the player has already spent it.`);
    }
    throw e;
  }

  // AFTER the commit, never inside it: an unreachable player must not roll back a completed
  // reversal. A rejected notify is swallowed for the same reason.
  let notified = false;
  if (trimmed) {
    notified = true;
    void ctx.notify(targetId, null, `🧾 A transaction was reversed by an operator: ${trimmed}`)
      .catch(() => {});
  }
  return { sideEffect: sideEffectFor(row.reason), notified };
}
```

Import `ReversalError` and `InsufficientFundsError` from `../../core/economy.js`, and `sideEffectFor` from `../../data/tx-reasons.js`.

- [ ] **Step 4: Wire the subcommand**

In `src/modules/admin/index.ts`, add the builder beside `ledger`:

```ts
        .addSubcommand((s) => s.setName('reverse').setDescription('Reverse one ledger transaction')
          .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
          .addIntegerOption((o) => o.setName('tx').setDescription('Transaction id').setRequired(true).setMinValue(1))
          .addStringOption((o) => o.setName('note').setDescription('Reason — also DMed to the player').setMaxLength(200)))
```

And the dispatch branch, before the final `else`:

```ts
          } else if (sub === 'reverse') {
            const out = adminReverse(ctx, target.id, i.options.getInteger('tx', true),
              i.options.getString('note') ?? undefined);
            await i.reply({
              content: `↩ Reversed for <@${target.id}>. Not undone: ${out.sideEffect}.`
                + (out.notified ? ' Note queued to the player.' : ''),
              flags: MessageFlags.Ephemeral,
            });
```

The reply says **queued**, not sent: delivery depends on the player's routing and mute settings, and claiming otherwise would imply a confirmation the bot does not have.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: green, top-level command count still 29.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin tests/admin.test.ts
git commit -m "Reverse a charge for a named player"
```

---

## Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Amend the `tx_log` line this feature falsifies**

`CLAUDE.md`'s park-tabs passage says `tx_log` "has no filtered read anywhere in `src/` at all and must stay unindexed." That is now false in its first half. Amend it to say the only filtered reads are the operator-only ledger view and the double-reversal guard, that the guard's column carries a **partial** index which ordinary charges never enter, and that the per-user read stays deliberately unindexed because indexing `user_id` would tax every economy transaction to serve a command run a few times a month.

- [ ] **Step 2: Add the reversal bullet**

Place it beside the economy material. It must record:

- a reversal is a **compensating row**, never an edit — `tx_log` is append-only and "already reversed?" is derived from a row whose `reverses_id` points at the target;
- **reversals are terminal**, and why: reversing a reversal is coherent double-entry but leaves the derived flag reporting "reversed" while the player is on net charged;
- **reversal is symmetric** — reversing a credit takes cash back, and that is the only path by which a balance decreases outside normal play;
- a charge that **predates a reset** is refused, because `adminReset` clears every per-player table except `tx_log` while dropping the `users` row;
- the note is **queued, not delivered**, and the notify call sits after the commit so an unreachable player cannot roll back a reversal;
- `sideEffectFor` **fails closed** on an unrecognised prefix, because a blank note and "no side effect" are indistinguishable to an operator.

Write it in the file's own voice: state the failure mode before the rule, and anchor each rule to the defect that motivates it. Do not write a count into the prose — that file's own discipline is that counts go stale silently.

- [ ] **Step 3: Verify nothing moved**

Run: `npm test && npm run typecheck`
Expected: green. A documentation change must move no test.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the reversal invariants"
```

---

## Self-Review Notes

**Spec coverage.** §1's migration is Task 1 and the primitive is Task 2; §2's two surfaces are Tasks 4 and 5, with the side-effect table split into Task 3 because it is independently testable and both surfaces consume it; §3's seven error cases are covered by Task 2 (cases 1, 3, 5 and the overdraw of case 4) and Task 5 (cases 2 and 6, with case 7 unreachable through the command); §4's testing is folded into each task rather than deferred. Deliverables 1–6 map to Tasks 1, 1, 2, 4–5, every task, and 6.

**Ordering constraints.** Task 1 before Task 2 (the columns must exist). Task 3 before Tasks 4 and 5 (both import `sideEffectFor`). Task 2 before Task 5 (`adminReverse` wraps `reverse`). Task 4 before Task 5 only by convention — they touch the same two files, so running them in order avoids a needless conflict.

**Every task ends green.** No task commits a deliberately failing assertion; each RED step is run and observed before its implementation step in the same task.

**Operator steps after merge.** `npm run deploy-commands` — two subcommands were added to `/admin`. Migration 0019 applies on the next boot. No emoji change, so no `deploy-emojis`.
