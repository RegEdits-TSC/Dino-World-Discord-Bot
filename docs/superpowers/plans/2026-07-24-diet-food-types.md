# Diet-Based Food Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single generic `food` counter with six diet-matched food items (3 quality tiers × 2 diets), hard-block wrong-diet feeding, and surface the wrong-diet paddock penalty with a warn-and-confirm flow.

**Architecture:** Data-driven catalog (`src/data/foods.ts`) + normalized `food_inventory` table, following the existing species/paddocks/decor pattern. `EconomyService.apply` grows a `foods` delta; the old `users.food` column is dropped with a cash-refund migration. Feeding sets `hunger = fillTo` (up to 150), so the clock math gains a clamp and a piecewise income integral.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js 14, drizzle-orm + better-sqlite3 (synchronous), vitest, hand-authored SVG → PNG emoji pipeline.

**Spec:** `docs/superpowers/specs/2026-07-24-diet-food-types-design.md`

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()`/`Math.random()`.
- DB access is synchronous drizzle (`.get()`/`.all()`/`.run()`), never awaited.
- Autocomplete providers only `i.respond(...)`, never create user rows, are read-only.
- **Never put a custom emoji tag in an autocomplete label** — use the food's `fallback` unicode there. Embeds/replies use `emojiTag`/`foodEmoji` (custom tag in prod, unicode in tests).
- Never call `emojiTag` in a module-level constant. Never pass a possibly-empty tag to `ButtonBuilder.setEmoji` — this plan uses no `setEmoji` calls at all.
- Tests load no emoji map: asserted strings use the unicode fallbacks.
- Catalog numbers (fixed by spec): herbivore 10/15/20, carnivore 12/18/24 cash/unit (+20%); `fillTo` 100/125/150; refund at 10 cash per old generic unit.
- Feeding still consumes `RARITY[rarity].feedCost` units of the chosen item.
- Commit messages: plain imperative, no attribution trailers of any kind.
- Run all commands from the repo root. Full suite: `npm test`. Typecheck: `npm run typecheck`.

---

### Task 1: Food catalog

**Files:**
- Create: `src/data/foods.ts`
- Test: `tests/data.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `Diet` from `src/data/types.ts`.
- Produces: `type FoodId`, `interface FoodDef { id: FoodId; name: string; diet: Diet; tier: 1|2|3; unitCost: number; fillTo: number; emoji: string; fallback: string }`, `const FOODS: Record<FoodId, FoodDef>`, `foodsForDiet(diet: Diet): FoodDef[]` (tier-ascending), `getFood(id: string): FoodDef` (throws on unknown), `const STARTER_FOOD: Partial<Record<FoodId, number>>`. Every later task uses these exact names.

- [ ] **Step 1: Write the failing test** — append to `tests/data.test.ts`:

```ts
import { FOODS, foodsForDiet, getFood, STARTER_FOOD } from '../src/data/foods.js';

describe('food catalog', () => {
  it('has 3 tiers per diet with monotonically increasing cost and fill', () => {
    for (const diet of ['herbivore', 'carnivore'] as const) {
      const foods = foodsForDiet(diet);
      expect(foods).toHaveLength(3);
      expect(foods.map((f) => f.tier)).toEqual([1, 2, 3]);
      for (let i = 1; i < foods.length; i++) {
        expect(foods[i].unitCost).toBeGreaterThan(foods[i - 1].unitCost);
        expect(foods[i].fillTo).toBeGreaterThan(foods[i - 1].fillTo);
      }
    }
  });
  it('prices carnivore food at exactly +20% over the same herbivore tier', () => {
    const herb = foodsForDiet('herbivore');
    const carn = foodsForDiet('carnivore');
    for (let t = 0; t < 3; t++) {
      expect(carn[t].unitCost).toBe(herb[t].unitCost * 1.2);
      expect(carn[t].fillTo).toBe(herb[t].fillTo);
    }
  });
  it('matches the spec table exactly', () => {
    expect(FOODS.ferns).toMatchObject({ diet: 'herbivore', tier: 1, unitCost: 10, fillTo: 100 });
    expect(FOODS.fruit_basket).toMatchObject({ diet: 'herbivore', tier: 2, unitCost: 15, fillTo: 125 });
    expect(FOODS.royal_greens).toMatchObject({ diet: 'herbivore', tier: 3, unitCost: 20, fillTo: 150 });
    expect(FOODS.fish).toMatchObject({ diet: 'carnivore', tier: 1, unitCost: 12, fillTo: 100 });
    expect(FOODS.goat).toMatchObject({ diet: 'carnivore', tier: 2, unitCost: 18, fillTo: 125 });
    expect(FOODS.prime_steak).toMatchObject({ diet: 'carnivore', tier: 3, unitCost: 24, fillTo: 150 });
  });
  it('getFood throws on unknown id', () => {
    expect(() => getFood('pizza')).toThrow(/Unknown food/);
  });
  it('starter pantry covers both diets with tier-1 food', () => {
    expect(STARTER_FOOD).toEqual({ ferns: 10, fish: 10 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/data.test.ts`
Expected: FAIL — `Cannot find module '../src/data/foods.js'`

- [ ] **Step 3: Create `src/data/foods.ts`**

```ts
import type { Diet } from './types.js';

export type FoodId = 'ferns' | 'fruit_basket' | 'royal_greens' | 'fish' | 'goat' | 'prime_steak';

export interface FoodDef {
  id: FoodId; name: string; diet: Diet; tier: 1 | 2 | 3;
  unitCost: number; fillTo: number; emoji: string; fallback: string;
}

export const FOODS: Record<FoodId, FoodDef> = {
  ferns:        { id: 'ferns',        name: 'Ferns',        diet: 'herbivore', tier: 1, unitCost: 10, fillTo: 100, emoji: 'dw_ferns',        fallback: '🌿' },
  fruit_basket: { id: 'fruit_basket', name: 'Fruit Basket', diet: 'herbivore', tier: 2, unitCost: 15, fillTo: 125, emoji: 'dw_fruit_basket', fallback: '🍎' },
  royal_greens: { id: 'royal_greens', name: 'Royal Greens', diet: 'herbivore', tier: 3, unitCost: 20, fillTo: 150, emoji: 'dw_royal_greens', fallback: '🥬' },
  fish:         { id: 'fish',         name: 'Fish',         diet: 'carnivore', tier: 1, unitCost: 12, fillTo: 100, emoji: 'dw_fish',         fallback: '🐟' },
  goat:         { id: 'goat',         name: 'Goat',         diet: 'carnivore', tier: 2, unitCost: 18, fillTo: 125, emoji: 'dw_goat',         fallback: '🍖' },
  prime_steak:  { id: 'prime_steak',  name: 'Prime Steak',  diet: 'carnivore', tier: 3, unitCost: 24, fillTo: 150, emoji: 'dw_prime_steak', fallback: '🥩' },
};

export function foodsForDiet(diet: Diet): FoodDef[] {
  return Object.values(FOODS).filter((f) => f.diet === diet).sort((a, b) => a.tier - b.tier);
}

export function getFood(id: string): FoodDef {
  const f = (FOODS as Record<string, FoodDef | undefined>)[id];
  if (!f) throw new Error(`Unknown food: ${id}`);
  return f;
}

// New-player pantry, seeded by getOrCreateUser and restored by adminReset.
export const STARTER_FOOD: Partial<Record<FoodId, number>> = { ferns: 10, fish: 10 };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/data.test.ts`
Expected: PASS (all blocks, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/data/foods.ts tests/data.test.ts
git commit -m "Add diet food catalog with quality tiers"
```

---

### Task 2: Overfill clock math

**Files:**
- Modify: `src/core/clock.ts:26-29` (comfortAt) and `src/core/clock.ts:55-75` (accruedIncome)
- Test: `tests/clock.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `comfortAt` clamps the hunger term at 100 (comfort never exceeds `paddockFit`); `accruedIncome` integrates correctly across the hunger=100 crossing when `hungerAtFed > 100`. Signatures unchanged.

- [ ] **Step 1: Write the failing tests** — append to `tests/clock.test.ts`:

```ts
describe('overfill (hungerAtFed > 100)', () => {
  it('clamps comfort at fit while hunger is above 100', () => {
    // fillTo 150, fit 1.0: comfort must be 1.0 at t=0, not 1.5
    expect(comfortAt(fedTrike({ hungerAtFed: 150 }), 0)).toBe(1.0);
    // hunger drains 150 -> 100 over 24h; still clamped at the crossing
    expect(comfortAt(fedTrike({ hungerAtFed: 150 }), 24 * H)).toBe(1.0);
    // 12h past the crossing: hunger 75 -> comfort 0.75
    expect(comfortAt(fedTrike({ hungerAtFed: 150 }), 36 * H)).toBeCloseTo(0.75);
  });
  it('integrates income piecewise across the hunger-100 crossing', () => {
    // hungerAtFed 150, fit 1.0, window 0..36h. Crossing at 24h (150->100 at 100/48h drain).
    // Segment 1: comfort flat 1.0 for 24h = 24 comfort-hours.
    // Segment 2: comfort 1.0 -> 0.75 over 12h, mean 0.875 = 10.5 comfort-hours.
    // A naive two-point trapezoid over the whole window would give (1.0+0.75)/2*36 = 31.5 — wrong.
    // Correct: 34.5 * 60/hr = 2070.
    expect(accruedIncome([fedTrike({ hungerAtFed: 150 })], 0, 48, 0, 36 * H)).toBe(2070);
  });
  it('delays the escape moment when overfed', () => {
    // fit 1.0: comfort crosses 0.25 at hunger 25. From 150 that is (150-25)/100*48h = 60h; +8h grace.
    expect(escapeAt(fedTrike({ hungerAtFed: 150 }))).toBe(60 * H + GRACE_MS);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/clock.test.ts`
Expected: FAIL — first test gets 1.5 (no clamp yet), second gets 2430 (unclamped two-point trapezoid: mean 1.125 × 36 h × 60/hr). The third already passes on current code — it stays as a regression pin for the escape math.

- [ ] **Step 3: Implement.** In `src/core/clock.ts` replace `comfortAt`:

```ts
export function comfortAt(d: ClockDino, at: number): number {
  if (!d.paddock) return 0;
  // Overfilled dinos (fillTo up to 150) sit at full comfort until hunger drains back under 100.
  return (Math.min(100, hungerAt(d.hungerAtFed, d.lastFedAt, at)) / 100) * paddockFit(d.species, d.paddock, d.decor);
}
```

In `accruedIncome`, replace the two lines

```ts
    const mean = (comfortAt(d, from) + comfortAt(d, dinoEnd)) / 2;
    const hours = (dinoEnd - from) / 3_600_000;
    total += RARITY[d.species.rarity].incomePerHr * mean * hours;
```

with:

```ts
    // Comfort is piecewise linear with a knee where hunger crosses 100 (overfill).
    // A two-point mean is exact on each side of the knee but wrong across it.
    const seg = (a: number, b: number) =>
      ((comfortAt(d, a) + comfortAt(d, b)) / 2) * ((b - a) / 3_600_000);
    const knee = d.lastFedAt + Math.max(0, (d.hungerAtFed - 100) / 100) * HUNGER_DRAIN_MS;
    const comfortHours = knee > from && knee < dinoEnd
      ? seg(from, knee) + seg(knee, dinoEnd)
      : seg(from, dinoEnd);
    total += RARITY[d.species.rarity].incomePerHr * comfortHours;
```

- [ ] **Step 4: Run the full clock suite**

Run: `npx vitest run tests/clock.test.ts`
Expected: PASS — all pre-existing accruedIncome tests unchanged (they all use `hungerAtFed <= 100`, where knee <= from).

- [ ] **Step 5: Run the whole suite** (comfort clamp touches rating/escape paths)

Run: `npm test`
Expected: PASS (no existing test feeds hunger above 100).

- [ ] **Step 6: Commit**

```bash
git add src/core/clock.ts tests/clock.test.ts
git commit -m "Clamp comfort at full and integrate income piecewise for overfill"
```

---

### Task 3: Core cutover — schema, migration, economy, services

This is the atomic cutover: `users.food` disappears, `food_inventory` arrives, and every service that touched generic food switches to typed items. The suite is red mid-task; commit only at the end when it is green again.

**Files:**
- Modify: `src/core/db/schema.ts` (food_inventory table, drop users.food, tx_log.food_id, TradeSide + loot types)
- Create: `drizzle/0001_diet_food_types.sql` (generated, then hand-edited)
- Modify: `src/core/economy.ts` (foods delta, getFoodInventory, error item name)
- Modify: `src/modules/park/service.ts:18-25` (starter pantry seed)
- Modify: `src/modules/care/service.ts` (typed feedDino/feedAll)
- Modify: `src/modules/care/index.ts:49-61` (reply copy + error copy)
- Modify: `src/modules/shop/service.ts:36-39` (buyFood item), `src/modules/shop/index.ts:30-31,64-67` (builder + call)
- Modify: `src/modules/expeditions/service.ts:11,39-59` (typed loot), `src/modules/expeditions/index.ts:70-77` (claim embed)
- Modify: `src/modules/trading/validate.ts`, `src/modules/trading/service.ts:21-42,86-101`, `src/modules/trading/index.ts:23-30,71-76,94-105,129`
- Modify: `src/modules/admin/service.ts:12-34,57-60`, `src/modules/admin/index.ts:29-31,46-48,66-73`
- Test: `tests/db.test.ts`, `tests/economy.test.ts`, new `tests/migration.test.ts`, plus assertion updates in `tests/care.test.ts`, `tests/shop.test.ts`, `tests/trading.test.ts`, `tests/expeditions.test.ts`, `tests/admin.test.ts`, `tests/harness.test.ts` (if it references food), `tests/park.test.ts` (if it references food)

**Interfaces:**
- Consumes: Task 1 catalog (`FOODS`, `FoodId`, `foodsForDiet`, `getFood`, `STARTER_FOOD`).
- Produces (later tasks rely on these exact shapes):
  - `schema.foodInventory` — columns `userId`, `foodId`, `qty`; PK (userId, foodId); CHECK qty >= 0.
  - `WalletDelta { cash?: number; shards?: number; foods?: Partial<Record<FoodId, number>> }` (the old `food?: number` is gone).
  - `EconomyService.getFoodInventory(userId: string): Partial<Record<FoodId, number>>` — positive quantities only.
  - `InsufficientFundsError` gains optional `foodId`; its message names the item (`Insufficient Ferns`).
  - `TradeSide { dinoIds: number[]; eggIds: number[]; cash: number; foods: Record<string, number> }`.
  - `feedDino(ctx, userId, dinoId, foodId?: string): { species: Species; food: FoodDef; cost: number }`.
  - `feedAll(ctx, userId): { fed: number[]; skipped: number[]; spent: Partial<Record<FoodId, number>> }`.
  - `buyFood(ctx, userId, foodId: string, units: number): { food: FoodDef; total: number }`.
  - Expedition `Loot { eggRarity: Rarity; cash: number; food: { foodId: FoodId; qty: number } }`.
  - `GiveArgs.food` becomes `{ foodId: FoodId; qty: number } | undefined`.

- [ ] **Step 1: Schema.** In `src/core/db/schema.ts`:

Remove line 11 (`food: integer('food')...`) and line 19 (`check('food_nonneg', ...)`) from `users`. After the `users` table add:

```ts
export const foodInventory = sqliteTable('food_inventory', {
  userId: text('user_id').notNull().references(() => users.discordId),
  foodId: text('food_id').notNull(),
  qty: integer('qty').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.userId, t.foodId] }),
  check('food_qty_nonneg', sql`${t.qty} >= 0`),
]);
```

Change `TradeSide` (line 70):

```ts
export interface TradeSide { dinoIds: number[]; eggIds: number[]; cash: number; foods: Record<string, number> }
```

Change the expeditions `loot` type (line 66):

```ts
  loot: text('loot', { mode: 'json' })
    .$type<{ eggRarity: string; cash: number; food: { foodId: string; qty: number } } | null>(),
```

Add to `txLog` after `foodDelta` (line 87):

```ts
  foodId: text('food_id'),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate --name diet_food_types`
Expected: creates `drizzle/0001_diet_food_types.sql` + updates `drizzle/meta/`. The generated file creates `food_inventory`, adds `tx_log.food_id`, and recreates `users` without `food` (SQLite table-recreate: `__new_users` + copy + drop + rename).

- [ ] **Step 3: Hand-edit the generated SQL** to add the data migration. Insert these statements **immediately before** the `users` recreate block (`CREATE TABLE \`__new_users\`...`), each separated by `--> statement-breakpoint`:

```sql
INSERT INTO `tx_log` (`user_id`, `cash_delta`, `food_delta`, `reason`, `created_at_ms`)
SELECT `discord_id`, `food` * 10, -`food`, 'food-refund:migration', CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `users` WHERE `food` > 0;
--> statement-breakpoint
UPDATE `users` SET `cash` = `cash` + `food` * 10;
--> statement-breakpoint
UPDATE `trades` SET
  `offer` = json_set(json_remove(`offer`, '$.food'), '$.foods', json('{}'),
    '$.cash', json_extract(`offer`, '$.cash') + (CASE WHEN `status` = 'pending' THEN json_extract(`offer`, '$.food') * 10 ELSE 0 END)),
  `request` = json_set(json_remove(`request`, '$.food'), '$.foods', json('{}'),
    '$.cash', json_extract(`request`, '$.cash') + (CASE WHEN `status` = 'pending' THEN json_extract(`request`, '$.food') * 10 ELSE 0 END));
```

Notes: refund runs while `users.food` still exists; pending trades convert generic food to its cash value on both sides (same refund story — food was never escrowed); resolved trades just get the uniform `foods: {}` shape without falsifying their history. Expedition `loot` needs no migration: loot is written only at claim time together with `claimedAt`, so unclaimed rows always have `loot = NULL` and claimed rows are never re-read. The spec's "unclaimed loot conversion" is vacuous by construction — note this deviation in the PR/commit body.

- [ ] **Step 4: Write the migration test** — create `tests/migration.test.ts`. It replays the raw SQL files against a scratch database (bypassing the drizzle journal) so we can seed pre-migration state:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DRIZZLE = resolve(process.cwd(), 'drizzle');
const sqlFiles = readdirSync(DRIZZLE).filter((f) => f.endsWith('.sql')).sort();

function execFile(db: InstanceType<typeof Database>, file: string): void {
  const sql = readFileSync(resolve(DRIZZLE, file), 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    if (stmt.trim()) db.exec(stmt);
  }
}

describe('0001 diet food types migration', () => {
  it('refunds generic food as cash with a ledger row and drops the column', () => {
    const db = new Database(':memory:');
    execFile(db, sqlFiles[0]);                    // 0000 baseline
    db.prepare(`INSERT INTO users (discord_id, cash, food, last_collect_at_ms, created_at_ms)
                VALUES ('u1', 500, 35, 0, 0)`).run();
    execFile(db, sqlFiles[1]);                    // 0001 under test
    const u = db.prepare(`SELECT cash FROM users WHERE discord_id = 'u1'`).get() as { cash: number };
    expect(u.cash).toBe(500 + 350);
    const cols = db.prepare(`SELECT name FROM pragma_table_info('users')`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).not.toContain('food');
    const log = db.prepare(`SELECT * FROM tx_log WHERE reason = 'food-refund:migration'`).get() as
      { cash_delta: number; food_delta: number };
    expect(log.cash_delta).toBe(350);
    expect(log.food_delta).toBe(-35);
  });
  it('converts pending trade food to cash and reshapes all trade sides', () => {
    const db = new Database(':memory:');
    execFile(db, sqlFiles[0]);
    db.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('a', 0, 0), ('b', 0, 0)`).run();
    const side = (cash: number, food: number) => JSON.stringify({ dinoIds: [], eggIds: [], cash, food });
    db.prepare(`INSERT INTO trades (from_user, to_user, offer, request, status, created_at_ms)
                VALUES ('a', 'b', ?, ?, 'pending', 0)`).run(side(100, 5), side(0, 20));
    db.prepare(`INSERT INTO trades (from_user, to_user, offer, request, status, created_at_ms)
                VALUES ('a', 'b', ?, ?, 'accepted', 0)`).run(side(0, 7), side(0, 0));
    execFile(db, sqlFiles[1]);
    const rows = db.prepare(`SELECT offer, request, status FROM trades ORDER BY id`).all() as
      Array<{ offer: string; request: string; status: string }>;
    expect(JSON.parse(rows[0].offer)).toEqual({ dinoIds: [], eggIds: [], cash: 150, foods: {} });
    expect(JSON.parse(rows[0].request)).toEqual({ dinoIds: [], eggIds: [], cash: 200, foods: {} });
    expect(JSON.parse(rows[1].offer)).toEqual({ dinoIds: [], eggIds: [], cash: 0, foods: {} });  // resolved: no cash bump
  });
  it('creates food_inventory with a non-negative qty check', () => {
    const db = new Database(':memory:');
    execFile(db, sqlFiles[0]); execFile(db, sqlFiles[1]);
    db.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    db.prepare(`INSERT INTO food_inventory (user_id, food_id, qty) VALUES ('u1', 'ferns', 5)`).run();
    expect(() => db.prepare(`UPDATE food_inventory SET qty = -1`).run()).toThrow();
    expect(() => db.prepare(`INSERT INTO food_inventory (user_id, food_id, qty) VALUES ('u1', 'ferns', 1)`).run())
      .toThrow();                                  // PK (user_id, food_id)
  });
});
```

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS (if the generated SQL ordering differs, fix the hand-edit placement until it does — refund statements must precede the `users` recreate).

- [ ] **Step 5: Economy.** Replace `src/core/economy.ts` wholesale:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from './db/index.js';
import { FOODS, type FoodId } from '../data/foods.js';

export interface WalletDelta { cash?: number; shards?: number; foods?: Partial<Record<FoodId, number>> }

export class InsufficientFundsError extends Error {
  constructor(public wallet: 'cash' | 'food' | 'shards', public foodId?: FoodId) {
    super(foodId ? `Insufficient ${FOODS[foodId].name}` : `Insufficient ${wallet}`);
  }
}

export class EconomyService {
  constructor(private db: Db) {}

  apply(userId: string, delta: WalletDelta, reason: string, now: number): void {
    const { cash = 0, shards = 0, foods = {} } = delta;
    const foodEntries = (Object.entries(foods) as Array<[FoodId, number]>).filter(([, q]) => q !== 0);
    this.db.transaction((tx) => {
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
      tx.insert(schema.txLog).values({ userId, cashDelta: cash, shardsDelta: shards, reason, createdAt: now }).run();
      for (const [foodId, qty] of foodEntries) {
        tx.insert(schema.txLog).values({ userId, foodDelta: qty, foodId, reason, createdAt: now }).run();
      }
    });
  }

  getFoodInventory(userId: string): Partial<Record<FoodId, number>> {
    const rows = this.db.select().from(schema.foodInventory)
      .where(eq(schema.foodInventory.userId, userId)).all();
    const out: Partial<Record<FoodId, number>> = {};
    for (const r of rows) if (r.qty > 0) out[r.foodId as FoodId] = r.qty;
    return out;
  }
}
```

- [ ] **Step 6: Economy tests.** In `tests/economy.test.ts`, rewrite the first test and add coverage:

```ts
  it('credits and debits atomically with audit rows per food item', () => {
    eco.apply('u1', { foods: { ferns: 10 } }, 'seed', 0);
    eco.apply('u1', { cash: 100, foods: { ferns: -5 } }, 'test:mixed', 1000);
    expect(bal().cash).toBe(600);
    const inv = eco.getFoodInventory('u1');
    expect(inv.ferns).toBe(5);
    const logs = db.select().from(schema.txLog).all().filter((l) => l.reason === 'test:mixed');
    expect(logs).toHaveLength(2);                                        // base row + one food row
    expect(logs[0]).toMatchObject({ userId: 'u1', cashDelta: 100, foodId: null });
    expect(logs[1]).toMatchObject({ userId: 'u1', foodDelta: -5, foodId: 'ferns' });
  });
  it('rejects a food overdraft with the item name and rolls everything back', () => {
    eco.apply('u1', { foods: { fish: 3 } }, 'seed', 0);
    expect(() => eco.apply('u1', { cash: 100, foods: { fish: -4 } }, 'test:overdraft', 0))
      .toThrow('Insufficient Fish');
    expect(bal().cash).toBe(500);
    expect(eco.getFoodInventory('u1').fish).toBe(3);
  });
  it('getFoodInventory omits zero rows', () => {
    eco.apply('u1', { foods: { goat: 2 } }, 'seed', 0);
    eco.apply('u1', { foods: { goat: -2 } }, 'spend', 0);
    expect(eco.getFoodInventory('u1')).toEqual({});
  });
```

Keep the overdraft/rollback/unknown-user tests; delete only the removed-`food` usages. Also update `tests/db.test.ts`: the comment `// starts cash 500, food 20` is stale wherever it appears — and add:

```ts
  it('enforces non-negative food_inventory qty', () => {
    const db = createDb(':memory:'); migrateDb(db);
    db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    db.insert(schema.foodInventory).values({ userId: 'u1', foodId: 'ferns', qty: 1 }).run();
    expect(() => db.update(schema.foodInventory).set({ qty: -1 }).run()).toThrow();
  });
```

- [ ] **Step 7: Starter pantry.** In `src/modules/park/service.ts` add the import and wrap the insert:

```ts
import { STARTER_FOOD } from '../../data/foods.js';
```

```ts
export function getOrCreateUser(ctx: Ctx, userId: string, displayName: string): User {
  const existing = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  if (existing) return existing;
  return ctx.db.transaction(() => {
    const u = ctx.db.insert(schema.users).values({
      discordId: userId, displayName, lastCollectAt: ctx.now(), createdAt: ctx.now(),
    }).returning().get();
    for (const [foodId, qty] of Object.entries(STARTER_FOOD)) {
      ctx.db.insert(schema.foodInventory).values({ userId, foodId, qty }).run();
    }
    return u;
  });
}
```

- [ ] **Step 8: Care service.** Replace `feedDino`/`feedAll` in `src/modules/care/service.ts` (imports: add `FOODS, foodsForDiet, type FoodDef, type FoodId` from `../../data/foods.js` and `type Diet` from `../../data/types.js`):

```ts
function pickFood(ctx: Ctx, userId: string, diet: Diet, cost: number): FoodDef | null {
  const inv = ctx.economy.getFoodInventory(userId);
  return foodsForDiet(diet).find((f) => (inv[f.id] ?? 0) >= cost) ?? null;
}

export function feedDino(ctx: Ctx, userId: string, dinoId: number, foodId?: string):
    { species: Species; food: FoodDef; cost: number } {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new CareError('You do not own that dino.');
  if (dino.escapedAt !== null) throw new CareError('That dino has escaped — rescue it first.');
  const species = getSpecies(dino.speciesId);
  const cost = RARITY[species.rarity].feedCost;
  let food: FoodDef;
  if (foodId) {
    const chosen = (FOODS as Record<string, FoodDef | undefined>)[foodId];
    if (!chosen) throw new CareError('Unknown food.');
    if (chosen.diet !== species.diet)
      throw new CareError(`${species.name} is a ${species.diet} — it won't eat ${chosen.name}.`);
    food = chosen;
  } else {
    const picked = pickFood(ctx, userId, species.diet, cost);
    if (!picked) throw new CareError(
      `You have no ${species.diet} food — buy ${foodsForDiet(species.diet)[0].name} with /shop food.`);
    food = picked;
  }
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { foods: { [food.id]: -cost } }, `feed:${species.id}`, ctx.now());
    ctx.db.update(schema.dinos).set({ hunger: food.fillTo, lastFedAt: ctx.now() })
      .where(eq(schema.dinos.id, dinoId)).run();
  });
  recomputeRating(ctx, userId);
  return { species, food, cost };
}

export function feedAll(ctx: Ctx, userId: string):
    { fed: number[]; skipped: number[]; spent: Partial<Record<FoodId, number>> } {
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  const candidates = dinos
    .map((d, i) => ({ id: d.id, species: clockDinos[i].species, hunger: hungerAt(d.hunger, d.lastFedAt, ctx.now()), escaped: d.escapedAt !== null }))
    .filter((c) => !c.escaped && c.hunger < 100)
    .sort((a, b) => a.hunger - b.hunger);                // hungriest first
  const fed: number[] = []; const skipped: number[] = [];
  const spent: Partial<Record<FoodId, number>> = {};
  for (const c of candidates) {
    const cost = RARITY[c.species.rarity].feedCost;
    const food = pickFood(ctx, userId, c.species.diet, cost);
    if (!food) { skipped.push(c.id); continue; }
    ctx.db.transaction(() => {
      ctx.economy.apply(userId, { foods: { [food.id]: -cost } }, `feed:${c.species.id}`, ctx.now());
      ctx.db.update(schema.dinos).set({ hunger: food.fillTo, lastFedAt: ctx.now() })
        .where(eq(schema.dinos.id, c.id)).run();
    });
    fed.push(c.id);
    spent[food.id] = (spent[food.id] ?? 0) + cost;
  }
  if (fed.length) recomputeRating(ctx, userId);
  return { fed, skipped, spent };
}
```

Note `feedAll` no longer pre-checks `user.food` — `pickFood` against the live inventory replaces it. Feeding a candidate whose hunger is < 100 but overfilled earlier is unchanged logic (`hungerAt` caps at `hungerAtFed`).

- [ ] **Step 9: Care command copy.** In `src/modules/care/index.ts` execute path:

```ts
          if (i.options.getSubcommand() === 'all') {
            const { fed, skipped, spent } = feedAll(ctx, i.user.id);
            const spentText = Object.entries(spent)
              .map(([id, q]) => `−${q} ${FOODS[id as FoodId].name}`).join(', ');
            const msg = fed.length ? `Fed ${fed.length} dino(s) (${spentText}).` : 'Nothing needed feeding.';
            await i.reply(carePayload(ctx, i.user.id, skipped.length
              ? `${msg} Skipped ${skipped.length} (no matching food — /shop food).` : msg));
          } else {
            const { species, food, cost } = feedDino(ctx, i.user.id, i.options.getInteger('dino', true));
            await i.reply(carePayload(ctx, i.user.id, `Fed your ${species.name} (−${cost} ${food.name}).`));
          }
```

and the `InsufficientFundsError` catch message becomes: `'Not enough food — buy some with /shop food.'` → `` `${e.message} — buy more with /shop food.` `` (the error now names the item). Add import `{ FOODS, type FoodId } from '../../data/foods.js'`.

- [ ] **Step 10: Shop service + builder.** `src/modules/shop/service.ts`:

```ts
import { FOODS, type FoodDef } from '../../data/foods.js';

export function buyFood(ctx: Ctx, userId: string, foodId: string, units: number): { food: FoodDef; total: number } {
  if (units <= 0) throw new ShopError('Amount must be positive.');
  const food = (FOODS as Record<string, FoodDef | undefined>)[foodId];
  if (!food) throw new ShopError('Unknown food.');
  const total = units * food.unitCost;
  ctx.economy.apply(userId, { cash: -total, foods: { [food.id]: units } }, `shop-food:${food.id}:${units}`, ctx.now());
  return { food, total };
}
```

Remove `FOOD_UNIT_COST` from `src/data/shop.ts` (keep `FOOD_BUNDLES` for the view hint). In `src/modules/shop/index.ts` change the `food` subcommand builder to:

```ts
        .addSubcommand((s) => s.setName('food').setDescription('Buy food')
          .addStringOption((o) => o.setName('item').setDescription('Food — type to search').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('units').setDescription('How many').setRequired(true).setMinValue(1)))
```

and the execute branch to:

```ts
          } else {
            const { food, total } = buyFood(ctx, i.user.id, i.options.getString('item', true), i.options.getInteger('units', true));
            await i.reply({ content: `${emojiTag(food.emoji)} Bought ${i.options.getInteger('units', true)}× ${food.name} for ${total.toLocaleString()} cash.` });
          }
```

For this task, the `view` food line just needs to compile — replace the `foodLine` (line 39) with a placeholder that Task 6 rewrites properly:

```ts
            const foodLine = 'See /shop food';
```

(Adjust imports: drop `FOOD_UNIT_COST`; `FOOD_BUNDLES` becomes temporarily unused — remove its import too and re-add in Task 6.)

- [ ] **Step 11: Expeditions.** `src/modules/expeditions/service.ts`:

```ts
import { foodsForDiet, type FoodId } from '../../data/foods.js';

export interface Loot { eggRarity: Rarity; cash: number; food: { foodId: FoodId; qty: number } }
```

In `claimExpedition`:

```ts
  const eggRarity = rollRarityFromOdds(site.eggOdds, ctx.rng);
  const lootDiet = ctx.rng() < 0.5 ? 'herbivore' : 'carnivore';
  const loot: Loot = {
    eggRarity,
    cash: rollIntInclusive(site.bonusCash[0], site.bonusCash[1], ctx.rng),
    food: { foodId: foodsForDiet(lootDiet)[0].id, qty: rollIntInclusive(site.bonusFood[0], site.bonusFood[1], ctx.rng) },
  };
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: loot.cash, foods: { [loot.food.foodId]: loot.food.qty } }, `expedition-loot:${exp.siteId}`, ctx.now());
    ...
```

In `src/modules/expeditions/index.ts` claim embed, replace the Food field:

```ts
              .addFields(
                { name: `${emojiTag('dw_cash')} Cash`, value: `+${loot.cash}`, inline: true },
                { name: `${emojiTag(FOODS[loot.food.foodId].emoji)} ${FOODS[loot.food.foodId].name}`, value: `+${loot.food.qty}`, inline: true });
```

Add import `{ FOODS } from '../../data/foods.js'`.

- [ ] **Step 12: Trading.** `src/modules/trading/validate.ts`:

```ts
export function sideItemCount(side: TradeSide): number {
  return side.dinoIds.length + side.eggIds.length + Object.keys(side.foods).length;
}
```

`src/modules/trading/service.ts` `verifySide` — replace the cash/food checks (lines 23-27):

```ts
  if (side.cash < 0) throw new TradeError('Amounts cannot be negative.');
  for (const [foodId, qty] of Object.entries(side.foods)) {
    if (!(foodId in FOODS)) throw new TradeError('Unknown food in trade.');
    if (!Number.isInteger(qty) || qty <= 0) throw new TradeError('Food amounts must be positive integers.');
  }
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) throw new TradeError('Unknown user.');
  if (user.cash < side.cash) throw new TradeError('Not enough cash for the trade.');
  const inv = ctx.economy.getFoodInventory(userId);
  for (const [foodId, qty] of Object.entries(side.foods)) {
    if ((inv[foodId as FoodId] ?? 0) < qty)
      throw new TradeError(`Not enough ${FOODS[foodId as FoodId].name} for the trade.`);
  }
```

`acceptTrade` — replace the two `economy.apply` lines (93-94):

```ts
    const foodNet = (get: TradeSide, give: TradeSide): Partial<Record<FoodId, number>> => {
      const out: Record<string, number> = {};
      for (const [id, q] of Object.entries(get.foods)) out[id] = (out[id] ?? 0) + q;
      for (const [id, q] of Object.entries(give.foods)) out[id] = (out[id] ?? 0) - q;
      for (const id of Object.keys(out)) if (out[id] === 0) delete out[id];
      return out;
    };
    ctx.economy.apply(trade.fromUser, { cash: trade.request.cash - trade.offer.cash, foods: foodNet(trade.request, trade.offer) }, `trade:${trade.id}`, ctx.now());
    ctx.economy.apply(trade.toUser, { cash: trade.offer.cash - trade.request.cash, foods: foodNet(trade.offer, trade.request) }, `trade:${trade.id}`, ctx.now());
```

Add imports `{ FOODS, type FoodId } from '../../data/foods.js'`.

`src/modules/trading/index.ts` — `summarize` (line 28) replace the food part:

```ts
  for (const [id, q] of Object.entries(side.foods)) {
    const f = FOODS[id as FoodId];
    parts.push(`${e(f?.emoji ?? 'dw_food')} ${q} ${f?.name ?? id}`);
  }
```

For this task the `offer` subcommand just needs to compile: change the two `TradeSide` literals to `foods: {}` and drop the `give-food`/`want-food` integer options from the builder (Task 7 adds the typed options and autocomplete). Add imports `{ FOODS, type FoodId } from '../../data/foods.js'`.

- [ ] **Step 13: Admin.** `src/modules/admin/service.ts`:

```ts
import { FOODS, STARTER_FOOD, type FoodId } from '../../data/foods.js';

export interface GiveArgs {
  cash?: number; food?: { foodId: FoodId; qty: number }; shards?: number; eggRarity?: Rarity; dinoSpecies?: string;
}

export function adminGive(ctx: Ctx, targetId: string, displayName: string, args: GiveArgs): void {
  const { cash = 0, food, shards = 0, eggRarity, dinoSpecies } = args;
  if (!cash && !food && !shards && !eggRarity && !dinoSpecies) throw new AdminError('Nothing to give.');
  if (food && !(food.foodId in FOODS)) throw new AdminError(`Unknown food: ${food.foodId}`);
  ...
    if (cash || food || shards) ctx.economy.apply(targetId,
      { cash, shards, foods: food ? { [food.foodId]: food.qty } : {} }, 'admin:give', ctx.now());
  ...
```

`adminReset`: remove `food: 20` from the `users.set`, and inside the same transaction add:

```ts
    ctx.db.delete(schema.foodInventory).where(eq(schema.foodInventory.userId, targetId)).run();
    for (const [foodId, qty] of Object.entries(STARTER_FOOD)) {
      ctx.db.insert(schema.foodInventory).values({ userId: targetId, foodId, qty }).run();
    }
```

`src/modules/admin/index.ts` — builder: replace the `food` integer option with:

```ts
          .addStringOption((o) => o.setName('food-item').setDescription('Food item')
            .addChoices(...Object.values(FOODS).map((f) => ({ name: f.name, value: f.id }))))
          .addIntegerOption((o) => o.setName('food-qty').setDescription('Food quantity').setMinValue(1))
```

execute:

```ts
            const foodItem = i.options.getString('food-item') as FoodId | null;
            const foodQty = i.options.getInteger('food-qty');
            if ((foodItem === null) !== (foodQty === null))
              { await i.reply({ content: 'Set both food-item and food-qty, or neither.', flags: MessageFlags.Ephemeral }); return; }
            adminGive(ctx, target.id, target.displayName, {
              cash: i.options.getInteger('cash') ?? 0,
              food: foodItem && foodQty ? { foodId: foodItem, qty: foodQty } : undefined,
              ...
```

`inspectEmbed` — replace the wallet line value:

```ts
    { name: `${emojiTag('dw_cash')} / ${emojiTag('dw_food')} / ${emojiTag('dw_shard')}`,
      value: `${u.cash} / ${Object.entries(ctx.economy.getFoodInventory(targetId)).map(([id, q]) => `${id}:${q}`).join(' ') || '0'} / ${u.shards}`, inline: true },
```

Add import `{ FOODS, type FoodId } from '../../data/foods.js'`.

- [ ] **Step 14: Typecheck, then sweep the tests**

Run: `npm run typecheck`
Expected: remaining errors are all in `tests/`. Fix each:

- `tests/care.test.ts`: seed becomes `ctx.economy.apply('u1', { foods: { ferns: 200, fish: 200 } }, 'seed', 0);` (line 13); `food()` helper becomes `const food = () => ctx.economy.getFoodInventory('u1').ferns ?? 0;` — triceratops is a herbivore, so feeds draw Ferns. Feed-cost assertions: `expect(res.cost).toBe(5)` unchanged; `expect(res.food.id).toBe('ferns')` added. feedAll affordability test: set inventory via `ctx.db.update` → instead seed exactly `{ ferns: 7 }` (two commons need 5 each → one fed, one skipped, 2 left). Copy assertions: `'Fed 1 dino(s) (−5 Ferns).'` and `'Fed your Triceratops (−5 Ferns).'`.
- `tests/harness.test.ts`, `tests/shards.test.ts`, `tests/rating.test.ts`, `tests/park.test.ts`, `tests/escapes.test.ts`, etc.: mechanical — anywhere a test writes `{ food: n }` in an `economy.apply` seed or asserts `users.food`, switch to `foods: { ferns: n }` / `getFoodInventory`. Anywhere a test inserts `schema.users` rows directly nothing changes (the column is simply gone from the type).
- `tests/shop.test.ts`: `buyFood(ctx, 'u1', 50)` → `buyFood(ctx, 'u1', 'fish', 50)`; assertion: inventory fish +50, cash −600 (50 × 12). Add: `expect(() => buyFood(ctx, 'u1', 'pizza', 1)).toThrow(ShopError)`.
- `tests/trading.test.ts`: `const empty = { dinoIds: [], eggIds: [], cash: 0, foods: {} as Record<string, number> };` and every inline `food: 0` literal → `foods: {}`. Add two tests:

```ts
  it('moves typed food both ways and nets to zero', () => {
    ctx.economy.apply('a', { foods: { fish: 10 } }, 'seed', 0);
    ctx.economy.apply('b', { foods: { ferns: 4 } }, 'seed', 0);
    const t = createTrade(ctx, 'a', 'b', { ...empty, foods: { fish: 10 } }, { ...empty, foods: { ferns: 4 } });
    acceptTrade(ctx, 'b', t.id);
    expect(ctx.economy.getFoodInventory('a')).toEqual({ ferns: 4 });
    expect(ctx.economy.getFoodInventory('b')).toEqual({ fish: 10 });
  });
  it('rejects offering food you do not hold and counts food stacks toward the item cap', () => {
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, foods: { fish: 1 } }, empty)).toThrow(TradeError);
    const ids = [1, 2, 3, 4, 5];
    expect(() => createTrade(ctx, 'a', 'b', { ...empty, dinoIds: ids, foods: { fish: 1 } }, empty)).toThrow(TradeError);
  });
```

- `tests/expeditions.test.ts`: claim test adds `expect(loot.food.qty).toBeGreaterThanOrEqual(2); expect(['ferns', 'fish']).toContain(loot.food.foodId);` and asserts the credited inventory: `expect(ctx.economy.getFoodInventory('u1')[loot.food.foodId]).toBe((STARTER_FOOD[loot.food.foodId] ?? 0) + loot.food.qty);` (import `STARTER_FOOD`).
- `tests/admin.test.ts`: `expect(u.food).toBe(20)` → `expect(ctx.economy.getFoodInventory('p')).toEqual({ ferns: 10, fish: 10 })`; add an adminGive food test: `adminGive(ctx, 'p', 'P', { food: { foodId: 'goat', qty: 5 } }); expect(ctx.economy.getFoodInventory('p').goat).toBe(5);`.
- New behavior tests to add in `tests/care.test.ts`:

```ts
  it('hard-blocks feeding wrong-diet food even when named explicitly', () => {
    const d = addDino();                                       // triceratops, herbivore
    expect(() => feedDino(ctx, 'u1', d.id, 'fish'))
      .toThrow("Triceratops is a herbivore — it won't eat Fish.");
  });
  it('auto-picks the cheapest owned matching item and overfills with premium', () => {
    ctx.economy.apply('u1', { foods: { royal_greens: 100 } }, 'seed', 0);
    const d = addDino();
    // ferns (tier 1) owned from the task-wide seed — auto-pick prefers them over royal_greens
    const auto = feedDino(ctx, 'u1', d.id);
    expect(auto.food.id).toBe('ferns');
    const premium = feedDino(ctx, 'u1', d.id, 'royal_greens');
    expect(premium.food.fillTo).toBe(150);
    expect(dinoRow(d.id).hunger).toBe(150);
  });
  it('errors with a shop hint when no matching-diet food is held', () => {
    ctx.db.delete(schema.foodInventory).run();
    const d = addDino();
    expect(() => feedDino(ctx, 'u1', d.id)).toThrow('You have no herbivore food — buy Ferns with /shop food.');
  });
  it('feedAll picks per-dino diets and reports spend per item', () => {
    ctx.economy.apply('u1', { foods: { fish: 100 } }, 'seed', 0);
    const herb = addDino({ hunger: 100, lastFedAt: 0 });
    const carn = ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    ctx.setNow(48 * H);
    const { fed, spent } = feedAll(ctx, 'u1');
    expect(fed).toEqual(expect.arrayContaining([herb.id, carn.id]));
    expect(spent.ferns).toBe(5);                               // common herbivore
    expect(spent.fish).toBe(10);                               // uncommon carnivore, feedCost 10
  });
```

(Adjust the task-wide seed so Ferns are plentiful: `ctx.economy.apply('u1', { foods: { ferns: 1_000 } }, 'seed', 0)`.)

- [ ] **Step 15: Run the full suite until green**

Run: `npm test` then `npm run typecheck`
Expected: PASS / clean. Iterate on stragglers — any test still writing `{ food: n }` or reading `users.food` is a leftover from this sweep, not a design problem.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "Cut generic food over to typed food inventory with refund migration"
```

---

### Task 4: /feed food picker

**Files:**
- Modify: `src/modules/care/index.ts:41-74` (builder option, execute, autocomplete)
- Test: `tests/autocomplete-care.test.ts`, `tests/care.test.ts`

**Interfaces:**
- Consumes: `feedDino(ctx, userId, dinoId, foodId?)` from Task 3; `foodsForDiet`, `FOODS`, `RARITY`.
- Produces: `/feed one` gains optional string option `food` (autocomplete). Explicit picks flow through as `foodId`; omitted → service auto-pick.

- [ ] **Step 1: Failing autocomplete tests** — append to `tests/autocomplete-care.test.ts`:

```ts
describe('/feed one food autocomplete', () => {
  it('lists only the target dino\'s diet, affordable first, with unicode labels', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');                          // starter: 10 ferns, 10 fish
    const d = seedDino(ctx, { speciesId: 'triceratops' });     // herbivore, feedCost 5
    const i = fakeAutocomplete({ name: 'feed', sub: 'one', user: 'u1',
      focused: { name: 'food', value: '' }, options: { dino: d.id } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: string }>;
    expect(rows.map((r) => r.value)).toEqual(['ferns', 'fruit_basket', 'royal_greens']);
    expect(rows[0].name).toBe('🌿 Ferns ×10 — fills 100');
    expect(rows[1].name).toBe('🍎 Fruit Basket ×0 — fills 125, not enough');
  });
  it('hints to pick the dino first when the dino option is empty', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const i = fakeAutocomplete({ name: 'feed', sub: 'one', user: 'u1', focused: { name: 'food', value: '' } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'Pick the dino option first', value: '-' }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/autocomplete-care.test.ts`
Expected: FAIL — the provider responds `[]`/dino rows for the `food` focus (no such branch yet).

- [ ] **Step 3: Implement.** In `src/modules/care/index.ts`:

Builder — add after the `dino` option of subcommand `one`:

```ts
          .addStringOption((o) => o.setName('food').setDescription('Food — leave empty to auto-pick the cheapest').setAutocomplete(true))
```

Execute (`else` branch):

```ts
            const { species, food, cost } = feedDino(ctx, i.user.id,
              i.options.getInteger('dino', true), i.options.getString('food') ?? undefined);
```

Autocomplete — the provider currently assumes the focused option is `dino`; branch on it:

```ts
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'one') { await i.respond([]); return; }
        const focused = i.options.getFocused(true);
        if (focused.name === 'food') {
          const dinoId = i.options.get('dino')?.value;
          if (dinoId == null) { await i.respond([{ name: 'Pick the dino option first', value: '-' }]); return; }
          const dino = ctx.db.select().from(schema.dinos)
            .where(and(eq(schema.dinos.id, Number(dinoId)), eq(schema.dinos.userId, i.user.id))).get();
          if (!dino) { await i.respond([{ name: 'Pick the dino option first', value: '-' }]); return; }
          const species = getSpecies(dino.speciesId);
          const cost = RARITY[species.rarity].feedCost;
          const inv = ctx.economy.getFoodInventory(i.user.id);
          const q = String(focused.value);
          await respondRanked(i, foodsForDiet(species.diet)
            .filter((f) => matches(q, f.id, f.name))
            .map((f) => {
              const held = inv[f.id] ?? 0;
              const affordable = held >= cost;
              // Unicode fallback only: custom emoji tags render as literal text in autocomplete.
              return { value: f.id, valid: affordable,
                label: `${f.fallback} ${f.name} ×${held} — fills ${f.fillTo}${affordable ? '' : ', not enough'}` };
            }));
          return;
        }
        // focused.name === 'dino' — existing listing, unchanged
        ...
      }
```

Imports to add: `and` from `drizzle-orm`; `foodsForDiet` from `../../data/foods.js`; `RARITY` from `../../data/rarity.js`.

- [ ] **Step 4: Command-path test** — append to `tests/care.test.ts` module block:

```ts
  it('/feed one food:<id> passes the explicit pick through (wrong diet is an ephemeral error)', async () => {
    const d = addDino();
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: d.id, food: 'fish' } });
    await careModule.commands[0].execute(ctx, i.asChatInput());
    const reply = i.replies[0] as { content?: string; flags?: unknown };
    expect(reply.content).toBe("Triceratops is a herbivore — it won't eat Fish.");
    expect(reply.flags).toBeDefined();
  });
```

- [ ] **Step 5: Run and verify green**

Run: `npx vitest run tests/autocomplete-care.test.ts tests/care.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/care/index.ts tests/autocomplete-care.test.ts tests/care.test.ts
git commit -m "Add diet-filtered food picker to /feed"
```

---

### Task 5: Habitat warn + confirm

**Files:**
- Modify: `src/modules/park/dinos.ts:10-40,54-62` (DietMismatchError, allowMismatch, listDinos mismatch flag)
- Modify: `src/modules/park/index.ts:25-41,151-165,225-243` (warning embed + buttons, list marker, component actions)
- Modify: `src/modules/park/embeds.ts:10-17` (mismatch count in dashboard extras)
- Modify: `src/modules/care/service.ts:63` (rescue call site gains no change — verify only)
- Test: `tests/dinos.test.ts`

**Interfaces:**
- Consumes: `getSpecies`, `PADDOCKS`, existing `park` component prefix routing.
- Produces: `assignDino(ctx, userId, dinoId, lotId, opts?: { allowMismatch?: boolean })`; `class DietMismatchError extends Error { speciesName; dinoDiet; paddockName }` exported from `src/modules/park/dinos.ts`; `listDinos` rows gain `mismatch: boolean`; button ids `park:assignyes:<uid>:<dinoId>:<lotId>` and `park:assignno:<uid>`; `dashboardPayload` opts gain `mismatchCount?: number`.

- [ ] **Step 1: Failing service tests** — append to `tests/dinos.test.ts`:

```ts
import { DietMismatchError } from '../src/modules/park/dinos.js';

describe('diet mismatch confirm', () => {
  it('throws DietMismatchError for a wrong-diet assignment unless allowMismatch', () => {
    const lot = buildLot(ctx, 'u1', 'carnivore_paddock');
    const d = addDino();                                       // triceratops, herbivore
    expect(() => assignDino(ctx, 'u1', d.id, lot.id)).toThrow(DietMismatchError);
    assignDino(ctx, 'u1', d.id, lot.id, { allowMismatch: true });
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBe(lot.id);
  });
  it('matched-diet assignment is unaffected', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    expect(() => assignDino(ctx, 'u1', addDino().id, lot.id)).not.toThrow();
  });
  it('listDinos flags mismatched dinos', () => {
    const lot = buildLot(ctx, 'u1', 'carnivore_paddock');
    const d = addDino();
    assignDino(ctx, 'u1', d.id, lot.id, { allowMismatch: true });
    const row = listDinos(ctx, 'u1').find((x) => x.dino.id === d.id)!;
    expect(row.mismatch).toBe(true);
  });
  it('/dino assign replies with Confirm/Cancel buttons on mismatch, and the yes button assigns', async () => {
    const lot = buildLot(ctx, 'u1', 'carnivore_paddock');
    const d = addDino();
    const dinoCmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'assign', user: 'u1', options: { dino: d.id, lot: lot.id } });
    await dinoCmd.execute(ctx, i.asChatInput());
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBeNull();
    const payload = i.replies[0] as { content: string; components: unknown[] };
    expect(payload.content).toContain('herbivore');
    expect(payload.components).toHaveLength(1);
    const b = fakeButton({ customId: `park:assignyes:u1:${d.id}:${lot.id}`, user: 'u1' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, d.id)).get()!.lotId).toBe(lot.id);
  });
  it('rejects another user\'s confirm click', async () => {
    const b = fakeButton({ customId: 'park:assignyes:u1:1:1', user: 'u2' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    expect((b.replies[0] as { content: string }).content).toContain('Not your');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/dinos.test.ts`
Expected: FAIL — no `DietMismatchError` export.

- [ ] **Step 3: Implement service.** In `src/modules/park/dinos.ts` (import `PADDOCKS` from `../../data/paddocks.js`, `type Diet` from `../../data/types.js`):

```ts
export class DietMismatchError extends Error {
  constructor(public speciesName: string, public dinoDiet: Diet, public paddockName: string) {
    super(`${speciesName} is a ${dinoDiet} — ${paddockName} halves its comfort: it earns less and escapes sooner.`);
  }
}
```

In `assignDino`, change the signature to `(ctx: Ctx, userId: string, dinoId: number, lotId: number, opts: { allowMismatch?: boolean } = {})` and insert after `ownedPaddock`:

```ts
  const species = getSpecies(dino.speciesId);
  const paddock = PADDOCKS[lot.kind];
  if (!opts.allowMismatch && paddock.diet !== species.diet)
    throw new DietMismatchError(species.name, species.diet, paddock.name);
```

In `listDinos`, add the flag to each row:

```ts
  return dinos.map((d, i) => ({
    dino: d,
    species: getSpecies(d.speciesId),
    comfort: comfortAt(clockDinos[i], ctx.now()),
    escapeAt: escapeAt(clockDinos[i]),
    mismatch: clockDinos[i].paddock !== null && clockDinos[i].paddock!.diet !== clockDinos[i].species.diet,
  }));
```

- [ ] **Step 4: Implement command + buttons.** In `src/modules/park/index.ts`:

Assign branch:

```ts
          } else if (sub === 'assign') {
            const dinoId = i.options.getInteger('dino', true);
            const lotId = i.options.getInteger('lot', true);
            try {
              assignDino(ctx, i.user.id, dinoId, lotId);
              await i.reply({ content: '🦕 Assigned.' });
            } catch (e) {
              if (!(e instanceof DietMismatchError)) throw e;
              const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`park:assignyes:${i.user.id}:${dinoId}:${lotId}`)
                  .setLabel('Assign anyway').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`park:assignno:${i.user.id}`)
                  .setLabel('Cancel').setStyle(ButtonStyle.Secondary));
              await i.reply({ content: `⚠️ ${e.message}`, components: [row], flags: MessageFlags.Ephemeral });
            }
          }
```

(Import `ActionRowBuilder, ButtonBuilder, ButtonStyle` from discord.js and `DietMismatchError` from `./dinos.js`. No `setEmoji` anywhere — the warning emoji lives in the content string.)

Component handler — replace the existing destructure line (`const [, action, uid, pageStr] = i.customId.split(':');`) with the two lines below (keeping `pageStr` so the `dinos` pagination action still compiles), then add the new block before the `dinos` action:

```ts
        const parts = i.customId.split(':');
        const [, action, uid, pageStr] = parts;
        if (action === 'assignyes' || action === 'assignno') {
          if (i.user.id !== uid) { await i.reply({ content: 'Not your assignment.', flags: MessageFlags.Ephemeral }); return; }
          if (action === 'assignno') { await i.update({ content: 'Assignment cancelled.', components: [] }); return; }
          settleEscapes(ctx, i.user.id);
          try {
            assignDino(ctx, i.user.id, Number(parts[3]), Number(parts[4]), { allowMismatch: true });
            await i.update({ content: '🦕 Assigned — wrong habitat, comfort halved.', components: [] });
          } catch (e) {
            if (e instanceof AssignError) await i.update({ content: e.message, components: [] });
            else throw e;
          }
          return;
        }
```

`dinoListPayload` line builder — append the marker:

```ts
        const habitat = d.mismatch ? ' — ⚠️ wrong habitat' : '';
        return `#${d.dino.id} ${d.species.name} — ${status}${warn}${habitat} — ${loc}`;
```

- [ ] **Step 5: Dashboard mismatch count.** In `src/modules/park/embeds.ts` add to opts `mismatchCount?: number` and to extras:

```ts
  if (opts.mismatchCount) extras.push(`⚠️ ${opts.mismatchCount} wrong habitat`);
```

In `src/modules/park/index.ts` self-view, compute and pass it:

```ts
        const mismatchCount = clockDinos.filter((c) =>
          c.paddock !== null && c.escapedAt === null && c.paddock.diet !== c.species.diet).length;
        const base = dashboardPayload(user, lots, dinos.length, pending, escapedCount, { atRiskCount, capped, mismatchCount });
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/dinos.test.ts tests/park.test.ts tests/escapes.test.ts tests/rating.test.ts`
Expected: PASS. Note: `tests/dinos.test.ts` has existing wrong-diet-free assignments only (herbivore paddock + triceratops), so nothing else trips the new error. `tests/care.test.ts` rescue test builds a matched paddock — unaffected.

- [ ] **Step 7: Full suite + commit**

Run: `npm test`

```bash
git add src/modules/park/dinos.ts src/modules/park/index.ts src/modules/park/embeds.ts tests/dinos.test.ts
git commit -m "Warn and confirm before wrong-habitat assignments, flag mismatches in lists"
```

---

### Task 6: Shop food market UI

**Files:**
- Modify: `src/modules/shop/index.ts:36-51,74-91` (view section + banner, item autocomplete)
- Modify: `src/core/emojis.ts` (foodEmoji helper)
- Test: `tests/shop.test.ts`, `tests/autocomplete-shop.test.ts`, `tests/emojis.test.ts`

**Interfaces:**
- Consumes: `FOODS`, `foodsForDiet`, `buyFood` (Task 3), `FOOD_BUNDLES`.
- Produces: `foodEmoji(id: FoodId): string` in `src/core/emojis.ts` — `'<:dw_ferns:...> '` with the map loaded, `'🌿 '` from fallback, `''` never (all six have fallbacks). Shop autocomplete for `item`.

- [ ] **Step 1: Failing tests.** Append to `tests/emojis.test.ts`:

```ts
import { foodEmoji } from '../src/core/emojis.js';

describe('foodEmoji', () => {
  it('prefixes the unicode fallback with a trailing space when no map is loaded', () => {
    expect(foodEmoji('ferns')).toBe('🌿 ');
    expect(foodEmoji('prime_steak')).toBe('🥩 ');
  });
});
```

Append to `tests/shop.test.ts` visuals block:

```ts
  it('/shop view lists the food market grouped by diet', async () => {
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const foodField = payload.embeds[0].toJSON().fields!.find((f) => f.name.includes('Food'))!;
    expect(foodField.value).toContain('🌿 Ferns — 10/unit, fills 100');
    expect(foodField.value).toContain('🥩 Prime Steak — 24/unit, fills 150');
  });
```

Append to `tests/autocomplete-shop.test.ts` (mirror the file's existing setup конventions):

```ts
describe('/shop food item autocomplete', () => {
  it('lists all six foods with owned quantities in unicode', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');                          // starter: 10 ferns, 10 fish
    const i = fakeAutocomplete({ name: 'shop', sub: 'food', user: 'u1', focused: { name: 'item', value: '' } });
    await shopModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: string }>;
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.value === 'ferns')!.name).toBe('🌿 Ferns — 10 cash/unit, fills 100 (own 10)');
    expect(rows.find((r) => r.value === 'goat')!.name).toBe('🍖 Goat — 18 cash/unit, fills 125 (own 0)');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/emojis.test.ts tests/shop.test.ts tests/autocomplete-shop.test.ts`
Expected: FAIL on all three additions.

- [ ] **Step 3: Implement.** `src/core/emojis.ts`:

```ts
import { FOODS, type FoodId } from '../data/foods.js';

// Emoji prefix for a food item: '<:dw_ferns:id> ' or the '🌿 ' unicode fallback.
export function foodEmoji(id: FoodId): string {
  const t = emojiTag(FOODS[id].emoji);
  return t ? `${t} ` : `${FOODS[id].fallback} `;
}
```

(`emojiTag` returns `''` for the six names until Task 9 adds their `EMOJI_FALLBACK` entries — hence the explicit `FOODS[id].fallback` second leg, which also keeps this task independent of Task 9.)

`src/modules/shop/index.ts` view branch — replace the placeholder `foodLine`:

```ts
            const foodLines = (['herbivore', 'carnivore'] as const).map((diet) =>
              foodsForDiet(diet).map((f) => `${foodEmoji(f.id)}${f.name} — ${f.unitCost}/unit, fills ${f.fillTo}`).join('\n'))
              .join('\n');
            const bundleHint = `Buy any amount — e.g. ${FOOD_BUNDLES.join('/')}.`;
```

and the embed field:

```ts
              { name: `${emojiTag('dw_food')} Food Market (/shop food)`, value: `${foodLines}\n${bundleHint}` },
```

After the egg-thumbnail block, hook the banner (null-degrades until the art ships):

```ts
            const foodBanner = assetImage('banners', 'shop_food_market');
            if (foodBanner) { embed.setImage(foodBanner.url); payload.files = [...(payload.files ?? []), foodBanner.file]; }
```

Autocomplete — the provider's first line currently rejects every subcommand except `egg` (`if (i.options.getSubcommand() !== 'egg') { await i.respond([]); return; }`), which would swallow the new branch. Replace that guard with the food branch first, then fall through to the egg logic guarded by `if (i.options.getSubcommand() !== 'egg')` as before:

```ts
        if (i.options.getSubcommand() === 'food') {
          const inv = ctx.economy.getFoodInventory(i.user.id);
          const q = String(i.options.getFocused());
          await respondRanked(i, Object.values(FOODS)
            .filter((f) => matches(q, f.id, f.name, f.diet))
            .map((f) => ({ value: f.id, valid: true,
              // Unicode fallback only — custom tags render literally in autocomplete.
              label: `${f.fallback} ${f.name} — ${f.unitCost} cash/unit, fills ${f.fillTo} (own ${inv[f.id] ?? 0})` })));
          return;
        }
```

Imports to add: `FOODS, foodsForDiet` from `../../data/foods.js`; `foodEmoji` from `../../core/emojis.js`; re-add `FOOD_BUNDLES` from `../../data/shop.js`.

- [ ] **Step 4: Run and verify**

Run: `npx vitest run tests/emojis.test.ts tests/shop.test.ts tests/autocomplete-shop.test.ts`
Expected: PASS. If the existing `/shop view` files-length assertion (`toHaveLength(1)`) fails once banner art exists later, it is written against current assets — leave it; the banner file does not exist yet.

- [ ] **Step 5: Commit**

```bash
git add src/core/emojis.ts src/modules/shop/index.ts tests/emojis.test.ts tests/shop.test.ts tests/autocomplete-shop.test.ts
git commit -m "Add food market section and item picker to the shop"
```

---

### Task 7: Trading typed-food UX

**Files:**
- Modify: `src/modules/trading/index.ts:66-110,157-175` (builder options, side parsing, autocomplete)
- Test: `tests/trading.test.ts`, `tests/autocomplete-trading.test.ts`

**Interfaces:**
- Consumes: `TradeSide.foods`, `FOODS`, `getFoodInventory`.
- Produces: `/trade offer` options `give-food` (string, autocomplete) + `give-food-qty` (int, min 1), same for `want-`; one food stack per side (the `foods` map supports more — UI limitation only).

- [ ] **Step 1: Failing tests.** Append to `tests/trading.test.ts` module block:

```ts
  it('/trade offer with give-food and give-food-qty creates a typed-food trade', async () => {
    ctx.economy.apply('a', { foods: { fish: 10 } }, 'seed', 0);
    const i = fakeCommand({ name: 'trade', sub: 'offer', user: 'a',
      options: { user: 'b', 'give-food': 'fish', 'give-food-qty': 10 } });
    await tradingModule.commands[0].execute(ctx, i.asChatInput());
    const t = ctx.db.select().from(schema.trades).where(eq(schema.trades.fromUser, 'a')).get()!;
    expect(t.offer.foods).toEqual({ fish: 10 });
    expect((i.replies[0] as { content: string }).content).toContain('10 Fish');
  });
  it('/trade offer with a food item but no qty is an ephemeral error', async () => {
    const i = fakeCommand({ name: 'trade', sub: 'offer', user: 'a', options: { user: 'b', 'give-food': 'fish' } });
    await tradingModule.commands[0].execute(ctx, i.asChatInput());
    expect((i.replies[0] as { flags?: unknown }).flags).toBeDefined();
  });
```

Append to `tests/autocomplete-trading.test.ts`:

```ts
describe('/trade offer food autocomplete', () => {
  it('give-food lists own holdings; want-food needs the user option first', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'a', 'A');                            // starter: 10 ferns, 10 fish
    const give = fakeAutocomplete({ name: 'trade', sub: 'offer', user: 'a', focused: { name: 'give-food', value: '' } });
    await tradingModule.commands[0].autocomplete!(ctx, give.asAutocomplete());
    const rows = give.replies[0] as Array<{ name: string; value: string }>;
    expect(rows.find((r) => r.value === 'ferns')!.name).toBe('🌿 Ferns — you hold 10');
    const want = fakeAutocomplete({ name: 'trade', sub: 'offer', user: 'a', focused: { name: 'want-food', value: '' } });
    await tradingModule.commands[0].autocomplete!(ctx, want.asAutocomplete());
    expect(want.replies[0]).toEqual([{ name: 'Pick the user option first', value: '-' }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/trading.test.ts tests/autocomplete-trading.test.ts`
Expected: FAIL — no such options/branches.

- [ ] **Step 3: Implement.** Builder — replace the removed food int options with (both give- and want- blocks):

```ts
          .addStringOption((o) => o.setName('give-food').setDescription('Food item you give').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('give-food-qty').setDescription('How many of the food item').setMinValue(1))
          ...
          .addStringOption((o) => o.setName('want-food').setDescription('Food item you want').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('want-food-qty').setDescription('How many of the food item').setMinValue(1))
```

Side parsing in the offer branch:

```ts
            const sideFoods = (item: string | null, qty: number | null): Record<string, number> => {
              if (!item && !qty) return {};
              if (!item || !qty) throw new TradeError('Set both the food item and its qty, or neither.');
              return { [item]: qty };
            };
            const offer: TradeSide = {
              dinoIds: parseIdList(i.options.getString('give-dinos') ?? ''),
              eggIds: parseIdList(i.options.getString('give-eggs') ?? ''),
              cash: i.options.getInteger('give-cash') ?? 0,
              foods: sideFoods(i.options.getString('give-food'), i.options.getInteger('give-food-qty')),
            };
            const request: TradeSide = {
              dinoIds: parseIdList(i.options.getString('want-dinos') ?? ''),
              eggIds: parseIdList(i.options.getString('want-eggs') ?? ''),
              cash: i.options.getInteger('want-cash') ?? 0,
              foods: sideFoods(i.options.getString('want-food'), i.options.getInteger('want-food-qty')),
            };
```

(`TradeError` is already caught by the surrounding try → ephemeral reply.)

Autocomplete — inside the `sub === 'offer'` branch, before the dinos/eggs handling:

```ts
          if (focused.name === 'give-food' || focused.name === 'want-food') {
            let ownerId = i.user.id;
            if (focused.name === 'want-food') {
              const target = i.options.get('user')?.value;
              if (typeof target !== 'string') { await i.respond([{ name: 'Pick the user option first', value: '-' }]); return; }
              ownerId = target;
            }
            const inv = ctx.economy.getFoodInventory(ownerId);
            const q = String(focused.value);
            const who = focused.name === 'give-food' ? 'you hold' : 'they hold';
            await respondRanked(i, Object.values(FOODS)
              .filter((f) => matches(q, f.id, f.name, f.diet))
              .map((f) => ({ value: f.id, valid: (inv[f.id] ?? 0) > 0,
                label: `${f.fallback} ${f.name} — ${who} ${inv[f.id] ?? 0}` })));
            return;
          }
```

Import `{ FOODS, type FoodId }` (FOODS already imported in Task 3 — verify) and `TradeError` from `./service.js` (already imported).

- [ ] **Step 4: Run and verify**

Run: `npx vitest run tests/trading.test.ts tests/autocomplete-trading.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/index.ts tests/trading.test.ts tests/autocomplete-trading.test.ts
git commit -m "Trade typed food items with quantity options and holdings autocomplete"
```

---

### Task 8: Park dashboard food line

**Files:**
- Modify: `src/modules/park/embeds.ts:10-29` (food field), `src/modules/park/index.ts` (both dashboard call sites)
- Test: `tests/park.test.ts`

**Interfaces:**
- Consumes: `getFoodInventory`, `foodEmoji`, `FOODS`.
- Produces: `dashboardPayload(user, lots, dinoCount, pending, escapedCount, opts)` gains `opts.foodLine?: string`; the embed shows a Food field between Cash and Rating.

- [ ] **Step 1: Failing test** — append to `tests/park.test.ts`:

```ts
describe('dashboard food line', () => {
  it('/park view lists held food items grouped after cash', async () => {
    const parkCmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkCmd.execute(ctx, i.asChatInput());
    const fields = (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> })
      .embeds[0].toJSON().fields!;
    const food = fields.find((f) => f.name.includes('Food'))!;
    expect(food.value).toContain('🌿 Ferns ×10');               // starter pantry
    expect(food.value).toContain('🐟 Fish ×10');
  });
});
```

(Match the surrounding file's ctx/user setup — `getOrCreateUser(ctx, 'u1', ...)` runs in its beforeEach.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/park.test.ts`
Expected: FAIL — no Food field.

- [ ] **Step 3: Implement.** `src/modules/park/embeds.ts` — add `foodLine?: string` to opts and, after the Cash field:

```ts
      { name: `${emojiTag('dw_food')} Food`, value: opts.foodLine ?? 'none — /shop food', inline: true },
```

`src/modules/park/index.ts` — before each `dashboardPayload` call (self view and other-player view):

```ts
        const inv = ctx.economy.getFoodInventory(<the viewed user id>);
        const foodLine = (Object.entries(inv) as Array<[FoodId, number]>)
          .map(([id, q]) => `${foodEmoji(id)}${FOODS[id].name} ×${q}`).join(' · ') || 'none — /shop food';
```

and pass `foodLine` in opts. Imports: `foodEmoji` from `../../core/emojis.js`, `FOODS, type FoodId` from `../../data/foods.js`.

- [ ] **Step 4: Run, then full suite, then commit**

Run: `npx vitest run tests/park.test.ts && npm test`

```bash
git add src/modules/park/embeds.ts src/modules/park/index.ts tests/park.test.ts
git commit -m "Show held food items on the park dashboard"
```

---

### Task 9: Food emoji art

**Files:**
- Modify: `src/core/emojis.ts:6-15` (six EMOJI_FALLBACK entries)
- Create: `assets/emojis/svg/dw_ferns.svg`, `dw_fruit_basket.svg`, `dw_royal_greens.svg`, `dw_fish.svg`, `dw_goat.svg`, `dw_prime_steak.svg`
- Create (generated): six PNG siblings via `npm run build-emojis`
- Test: `tests/emoji-assets.test.ts` (auto-discovers; no edits)

**Interfaces:**
- Consumes: the SVG conventions — 64×64 viewBox, transparent corners, no pure-black (outlines are dark colors), gradients on `circle`/`rect`/`polygon` freely, on `<ellipse>` only with `gradientUnits="userSpaceOnUse"` and `y1 = cy − ry`, `y2 = cy + ry`.
- Produces: deployable `dw_*` emojis whose names match `FOODS[*].emoji`; `emojiTag('dw_ferns')` now falls back to `'🌿'`.

- [ ] **Step 1: EMOJI_FALLBACK entries.** In `src/core/emojis.ts` add to the table:

```ts
  dw_ferns: '🌿', dw_fruit_basket: '🍎', dw_royal_greens: '🥬',
  dw_fish: '🐟', dw_goat: '🍖', dw_prime_steak: '🥩',
```

- [ ] **Step 2: Run the parity test to see it demand the SVGs**

Run: `npx vitest run tests/emoji-assets.test.ts`
Expected: FAIL — `svg set parity` now expects 27 names but finds 21.

- [ ] **Step 3: Author the six SVGs.** Keep art inside roughly x,y ∈ [6, 58] so corners stay transparent. No `#000000` anywhere.

`assets/emojis/svg/dw_ferns.svg` — three arching fern fronds:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 56 C30 40 30 26 34 12" fill="none" stroke="#2d6a1e" stroke-width="4" stroke-linecap="round"/>
  <path d="M33 18 C26 16 20 18 15 24 C22 26 29 24 33 18 Z" fill="#4c9a3c" stroke="#2d6a1e" stroke-width="2"/>
  <path d="M32 28 C24 26 17 29 12 36 C20 38 28 35 32 28 Z" fill="#5fae4a" stroke="#2d6a1e" stroke-width="2"/>
  <path d="M31 38 C24 37 17 40 13 47 C21 49 28 45 31 38 Z" fill="#4c9a3c" stroke="#2d6a1e" stroke-width="2"/>
  <path d="M34 20 C41 17 47 18 52 24 C45 27 38 25 34 20 Z" fill="#5fae4a" stroke="#2d6a1e" stroke-width="2"/>
  <path d="M33 30 C41 28 48 31 53 38 C45 40 37 36 33 30 Z" fill="#4c9a3c" stroke="#2d6a1e" stroke-width="2"/>
  <path d="M32 40 C40 39 47 42 51 49 C43 51 36 46 32 40 Z" fill="#5fae4a" stroke="#2d6a1e" stroke-width="2"/>
</svg>
```

`assets/emojis/svg/dw_fruit_basket.svg` — woven basket with three fruits:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="22" cy="26" r="9" fill="#d84a3a" stroke="#7a2318" stroke-width="2.5"/>
  <circle cx="41" cy="24" r="9" fill="#f0a028" stroke="#8a5410" stroke-width="2.5"/>
  <circle cx="32" cy="20" r="8" fill="#7ab648" stroke="#3d6a1e" stroke-width="2.5"/>
  <path d="M22 20 C22 16 24 14 26 13" fill="none" stroke="#5a3a1a" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M10 30 L54 30 L48 52 L16 52 Z" fill="#c08a4a" stroke="#6a4218" stroke-width="3"/>
  <path d="M12 37 L52 37 M14 44 L50 44" fill="none" stroke="#9a6630" stroke-width="2.5"/>
  <path d="M22 30 L24 52 M32 30 L32 52 M42 30 L40 52" fill="none" stroke="#9a6630" stroke-width="2.5"/>
</svg>
```

`assets/emojis/svg/dw_royal_greens.svg` — lettuce head with a small gold crown:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="36" r="19" fill="#6fbe52" stroke="#2f6a24" stroke-width="3"/>
  <path d="M15 34 C20 26 27 22 32 22 C24 28 21 34 20 42 C17 40 15 37 15 34 Z" fill="#8ed470" stroke="#2f6a24" stroke-width="2"/>
  <path d="M49 34 C44 26 37 22 32 22 C40 28 43 34 44 42 C47 40 49 37 49 34 Z" fill="#8ed470" stroke="#2f6a24" stroke-width="2"/>
  <path d="M32 24 C28 32 27 42 29 52 C33 53 37 52 40 50 C36 42 35 32 32 24 Z" fill="#a8e28c" stroke="#2f6a24" stroke-width="2"/>
  <path d="M22 16 L26 9 L32 14 L38 9 L42 16 Z" fill="#f2c22e" stroke="#9a7410" stroke-width="2.5"/>
</svg>
```

`assets/emojis/svg/dw_fish.svg` — fish with tail and eye (body is a path, so no ellipse-gradient hazard):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M10 32 C18 20 34 16 46 26 L54 18 L52 32 L54 46 L46 38 C34 48 18 44 10 32 Z"
        fill="#4a90c2" stroke="#1e4a6a" stroke-width="3"/>
  <path d="M24 24 C30 22 38 23 43 28" fill="none" stroke="#7ab8dd" stroke-width="3" stroke-linecap="round"/>
  <path d="M26 32 L32 26 M32 38 L38 30" fill="none" stroke="#2e6a94" stroke-width="2"/>
  <circle cx="20" cy="30" r="3" fill="#f5f0e6" stroke="#1e4a6a" stroke-width="1.5"/>
  <circle cx="20" cy="30" r="1.4" fill="#1e2a34"/>
</svg>
```

`assets/emojis/svg/dw_goat.svg` — meaty leg joint, distinct from dw_food's drumstick (darker, whole haunch, exposed bone at top):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="40" y="10" width="6" height="12" rx="3" fill="#f5f0e6" stroke="#b8ad98" stroke-width="2" transform="rotate(30 43 16)"/>
  <circle cx="48" cy="12" r="4.5" fill="#f5f0e6" stroke="#b8ad98" stroke-width="2"/>
  <path d="M14 46 C8 36 12 24 24 19 C34 15 44 19 46 27 C48 35 42 44 32 49 C25 52 18 51 14 46 Z"
        fill="#b23a28" stroke="#5e1a12" stroke-width="3"/>
  <path d="M20 42 C16 36 18 28 26 24" fill="none" stroke="#e08a74" stroke-width="3.5" stroke-linecap="round" opacity="0.8"/>
  <path d="M30 46 C38 42 43 35 42 29" fill="none" stroke="#8a2418" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
</svg>
```

`assets/emojis/svg/dw_prime_steak.svg` — marbled T-bone on a gold star (premium tier):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 6 L36 15 L46 15 L38 21 L41 31 L32 25 L23 31 L26 21 L18 15 L28 15 Z"
        fill="#f2c22e" stroke="#9a7410" stroke-width="2" opacity="0.9"/>
  <path d="M12 40 C10 30 18 24 30 25 C44 26 54 32 53 41 C52 50 40 55 28 53 C18 51 13 47 12 40 Z"
        fill="#c24434" stroke="#5e1a12" stroke-width="3"/>
  <path d="M12 40 C13 34 18 29 26 27 C24 36 26 45 33 52 C23 53 14 48 12 40 Z"
        fill="#f5f0e6" stroke="#c2b49a" stroke-width="2"/>
  <path d="M34 32 C39 33 45 36 47 40 M32 40 C36 42 40 44 43 47" fill="none" stroke="#f0d6c8" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
</svg>
```

- [ ] **Step 4: Render the PNGs**

Run: `npm run build-emojis`
Expected: `Rendered 27 emoji PNGs to assets/emojis/png/.`

- [ ] **Step 5: Run the asset tests**

Run: `npx vitest run tests/emoji-assets.test.ts`
Expected: PASS — parity (27 = 27), corner transparency, opaque center, black-share < 2% for every file. If a new file fails black-share or corners, adjust that SVG's colors/margins; do not touch `MAX_BLACK_SHARE`.

- [ ] **Step 6: Commit**

```bash
git add src/core/emojis.ts assets/emojis/svg assets/emojis/png
git commit -m "Add six food item emojis with unicode fallbacks"
```

---

### Task 10: Docs — help topics, README, CLAUDE.md, prompts

**Files:**
- Modify: `src/modules/help/index.ts:5-55`
- Modify: `README.md` (any `/shop food units:` and generic-food mentions)
- Modify: `CLAUDE.md` (repo — new invariants)
- Modify: `docs/assets/prompts.md` (shop banner prompt)
- Test: `tests/help.test.ts` (only if it pins the changed strings — update to the new text verbatim)

- [ ] **Step 1: Help topics.** In `src/modules/help/index.ts` apply exactly:

- `shop` topic line 3: `` '`/shop food item:<food> units:<n>` — diet-matched food; carnivore food costs ~20% more.', ``
- `care` topic body becomes:

```ts
  care: { title: '🍖 Care', body: [
    '`/feed one dino:<id> [food:<item>]` or `/feed all` — feeding resets hunger; costs food by rarity.',
    'Dinos only eat their diet: herbivores get Ferns/Fruit Basket/Royal Greens, carnivores get Fish/Goat/Prime Steak.',
    'Premium food overfills hunger (up to 150) so dinos stay fed longer.',
    'Hunger drains over 48h. Low comfort long enough → the dino escapes and stops earning.',
    '`/rescue dino:<id>` — recapture an escaped dino for a fee.',
  ].join('\n') },
```

- `trading` topic line 1: `` '`/trade offer user:<u> ...` — offer dinos/eggs/cash/food (item + qty) for theirs.', ``
- `park` topic: append `'Dinos in the wrong-diet paddock earn half comfort — the bot warns before you assign one.',`

- [ ] **Step 2: Run help tests**

Run: `npx vitest run tests/help.test.ts`
Expected: PASS, or update any verbatim-string assertions to the new copy.

- [ ] **Step 3: README.** Search for `shop food`, `food units`, and any description of a single food resource; update to describe the six-item catalog (one short paragraph, mirror the help copy). Keep it factual — no design history.

- [ ] **Step 4: Repo CLAUDE.md.** Append to the conventions list:

```markdown
- Food is typed (`src/data/foods.ts`, 3 tiers × 2 diets) and lives in the
  `food_inventory` table — `users.food` no longer exists. Feeding sets
  `hunger = fillTo` (up to 150): `comfortAt` clamps the hunger term at 100, and
  `accruedIncome` must stay piecewise across the hunger-100 crossing — a plain
  two-point trapezoid over-/under-pays overfed dinos. Autocomplete labels use
  `FoodDef.fallback` unicode, never `emojiTag`/`foodEmoji` (custom tags render
  as literal text in autocomplete).
```

- [ ] **Step 5: Banner prompt.** Append to `docs/assets/prompts.md` under the banners section:

```markdown
### shop_food_market (banners/shop_food_market.png)

Jurassic-park gift-shop food market stall, wooden counter with two clearly split
display sides: left side lush greens — fern bundles, fruit baskets, crowned
premium lettuce; right side butcher/fishmonger — fresh fish on ice, hanging meat
leg, marbled steak. Warm tropical daylight, painted-illustration style matching
the existing site banners, no text, no people, 16:9.
```

- [ ] **Step 6: Full suite + commit**

Run: `npm test`

```bash
git add src/modules/help/index.ts README.md CLAUDE.md docs/assets/prompts.md tests/help.test.ts
git commit -m "Document diet food types across help, README, and asset prompts"
```

---

### Task 11: Ship checklist (manual, ordered)

**Files:** none (operational).

- [ ] **Step 1:** `npm run typecheck && npm test` — both clean.
- [ ] **Step 2:** `npm run deploy-commands` — builders changed in Tasks 3, 4, 6, 7 (feed food option, shop item option, trade food options, admin food-item/qty).
- [ ] **Step 3:** `npm run deploy-emojis` — uploads the six new emojis; manifest updates only the new entries.
- [ ] **Step 4:** Restart the bot — **exactly one instance**; startup `migrateDb` applies `0001_diet_food_types.sql` to the live database (refund + reshape). Take a copy of the database file first; the migration is one-way.
- [ ] **Step 5:** Generate `assets/images/banners/shop_food_market.png` from the prompt (Higgsfield), commit it. Until then the shop embed renders without the banner — by design, never an error.
- [ ] **Step 6:** Smoke-test in the dev guild: `/shop view` (market section), `/shop food item:fish units:10`, `/feed one` (auto + explicit + wrong-diet block), `/dino assign` wrong-diet (confirm buttons), `/trade offer` with food, `/expedition claim` (typed loot line), `/park view` (food line), `/admin give food-item`.
- [ ] **Step 7:** Commit any manifest/banner changes:

```bash
git add assets/emojis/manifest.json assets/images/banners/shop_food_market.png
git commit -m "Deploy food emojis and shop food market banner"
```
