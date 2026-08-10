# Prestige, Legacy Ranks, and the Hatchery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the endgame a cash sink worth 315,000,000, an earned rank that recognises breadth rather than wealth, and the Hatchery's last two levels — without adding any mechanical power to the sink.

**Architecture:** Three independent additions sharing only the park dashboard. The sink is a monotone six-rung ladder on a new `users.landmark_tier` column, so power-freedom is structural: nothing in `rating.ts`, `clock.ts`, `lotSlots` or `matchedKindCount` reads that column. The rank is a pure read over three existing tables and stores nothing. Hatchery L4–L5 is real slot power, and lands only after bounds guards for the three level-indexed facility arrays, because bumping `maxLevel` alone would silently allow unlimited incubation.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js v14, drizzle-orm + better-sqlite3 (synchronous), `@napi-rs/canvas` for the park PNG, vitest.

**Spec:** `docs/superpowers/specs/2026-08-10-prestige-ranks-hatchery-design.md`

**Branch:** `prestige-ranks-hatchery`, already created off `main` at `3412026` — **not** `ec9b03f`, or the first merge replays four dependency bumps. Baseline: 94 test files, 1327 tests, typecheck clean.

## Global Constraints

- **ESM NodeNext**: every relative import carries a `.js` extension, including in tests.
- **Time and randomness**: `ctx.now()` and `ctx.rng()` only — never `Date.now()` or `Math.random()`. `renderParkPng` must stay **synchronous and clock-free**; anything time-dependent is derived in `buildParkSnapshot`.
- **DB is synchronous**: drizzle/better-sqlite3 `.get()` / `.all()` / `.run()`, never awaited.
- **`npm run typecheck` before every commit.** It is the only gate covering `tests/` and `scripts/`, and it will **not** catch an out-of-bounds facility array index (`noUncheckedIndexedAccess` is off).
- **No attribution anywhere.** No `Co-Authored-By`, no "generated with", no mention of AI, Claude, Anthropic, assistants or tooling in commits, docs, comments or code. Every artifact is authored by RegEdits.
- **The landmark tier must never reach `parkRaw`, `paddockFit`, `lotSlots` or any income path.** That is what makes the sink power-free.
- **`PARK_TARGET` does not move.** A raise is a retroactive rating cut that revokes `/trade` through the droppable stored `parkRating`, checked at both trade creation and accept.
- **Never add a second top-level await to `worker.ts`.** A rejected worker boot terminates and nulls the worker, so every later `/park view` loses its image permanently until restart. New art loads inside `loadParkArt`'s existing single `Promise.all`.
- **Every `drawImage` site needs its own non-null guard.** `drawImage(null)` and `drawImage(undefined)` both throw, and the worker protocol swallows the throw into a text-only embed with no log.
- **Never call `emojiTag` in a module-level constant**, and never put a custom emoji tag in an autocomplete label or in text drawn through `iconValue` (that path renders entirely in SANS — an emoji there is a tofu box).
- **Create the owner row before seeding anything that references it.** `lots.user_id`, `dinos.user_id` and every other user-scoped table are foreign keys to `users.discord_id`, and `createDb` sets `foreign_keys = ON` outside migrations — so `getOrCreateUser(ctx, 'u1', 'Reg')` (or a `beforeEach` that does) must precede any direct insert. A missing owner row throws an FK error that masks whatever the test was actually checking.
- **Mutation-test every assertion.** 2a's execution found twelve test specifications across two plans that could not fail. For each assertion: break the thing it targets, watch it go red, revert, and report what you observed.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/data/landmarks.ts` | The six-rung ladder: names, costs, art bands, and the pure lookups. No DB, no Discord. |
| `src/modules/park/landmarks.ts` | `buyLandmark` — the charge-and-increment transaction. |
| `src/modules/park/ranks.ts` | `legacyPoints` / `legacyRank` — derived, stores nothing. |
| `drizzle/0011_landmark_tier.sql` | `ALTER TABLE users ADD landmark_tier` (generated, then verified by eye). |
| `assets/images/park/landmark-a.webp`, `-b.webp`, `-c.webp` | The three monument bands. |
| `tests/landmarks.test.ts` | The ladder data, `buyLandmark`, and the `/park landmark` surface. |
| `tests/ranks.test.ts` | `legacyPoints`, `legacyRank`, and the derived ceiling. |

**Modified:**

| File | Change |
| --- | --- |
| `src/modules/park/service.ts` | `levelValue` bounds helper; `capHours` / `breedingSlots` use it; `upgradeCostFor` exported; `upgradeLot` uses it. |
| `src/modules/hatchery/service.ts` | `incubatorSlots` uses `levelValue`. |
| `src/data/facilities.ts` | `hatchery_lab` to `maxLevel: 5`. |
| `src/core/db/schema.ts` | `users.landmarkTier`. |
| `src/modules/park/index.ts` | `/park` becomes a real switch; `landmark` subcommand; the `park` component gains the buy action; `/upgrade` quotes its price. |
| `src/modules/park/embeds.ts` | `dashboardPayload` opts gain `legacyRank`; `landmarkPayload`. |
| `src/modules/park/snapshot.ts` | optional `ParkSnapshot.landmarkTier`. |
| `src/core/render/art.ts` | `ParkArt.landmarks`, loaded in the existing `Promise.all`. |
| `src/core/render/draw.ts` | the landmark grid cell. |
| `src/modules/admin/service.ts` | `adminReset` zeroes `landmarkTier`; `adminFastForward` comment. |
| `src/modules/dex/embeds.ts` | the list footer shows the rank. |
| `docs/gameplay.md`, `docs/commands.md`, `docs/assets/prompts.md`, `CLAUDE.md` | documentation. |
| `scripts/test-live.ts` | gallery cases. |
| `tests/data.test.ts`, `tests/park.test.ts`, `tests/autocomplete-park.test.ts`, `tests/hatchery.test.ts`, `tests/migration.test.ts`, `tests/render-draw.test.ts`, `tests/docs-assets.test.ts`, `tests/dex.test.ts`, `tests/admin.test.ts` | coverage and moved pins. |

---

## Task 1: Bounds-guard the three level-indexed facility arrays

**Files:**
- Modify: `src/modules/park/service.ts` (add `levelValue`; `capHours`, `breedingSlots`), `src/modules/hatchery/service.ts` (`incubatorSlots`)
- Test: `tests/park.test.ts`, `tests/data.test.ts`

**Interfaces:**
- Produces: `levelValue(table: number[] | undefined, level: number, fallback: number): number`, exported from `src/modules/park/service.ts`. Task 2 and Task 3 both rely on it.

**Why this ships before the level bump:** `FACILITIES.hatchery_lab.incubatorSlots![level - 1]` is an unguarded index. `incubatingCount >= undefined` evaluates to **`false`**, so raising `maxLevel` to 5 while leaving the array at `[1,2,3]` yields **unlimited simultaneous incubation, silently**. `capHours` and `breedingSlots` have the identical hole; `capHours` degrades to `Math.min(to, from + NaN)`, which poisons `accruedIncome` and renders a literal **"Collect NaN"** button.

- [ ] **Step 1: Write the failing tests**

Append to `tests/park.test.ts`. `seedLot` already exists at the top of that file — read it and reuse it; it inserts directly, which is what lets a level above `maxLevel` exist at all:

Each of these needs its owner row to exist first — `lots.user_id` is a foreign key to
`users.discord_id`, enforced outside migrations — so call `getOrCreateUser(ctx, 'u1', 'Reg')`
before `seedLot` in every case below.

```ts
describe('facility level arrays are bounds-guarded', () => {
  // A level above maxLevel is not reachable through upgradeLot, but it IS reachable on a
  // live database: nothing constrains lots.level, and a future maxLevel bump that forgets
  // to extend an array produces the same read. Every one of these resolves to the TOP
  // defined entry — the safe direction — rather than undefined.
  it('capHours clamps instead of returning NaN', () => {
    seedLot({ kind: 'visitor_center', name: 'Visitor Center', level: 9 });
    const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all();
    expect(capHours(lots)).toBe(24);
  });
  it('breedingSlots clamps instead of returning undefined', () => {
    seedLot({ kind: 'gene_lab', name: 'Gene Lab', level: 9 });
    const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all();
    expect(breedingSlots(lots)).toBe(3);
  });
  it('incubatorSlots clamps instead of returning undefined', () => {
    seedLot({ kind: 'hatchery_lab', name: 'Hatchery Lab', level: 9 });
    const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all();
    expect(incubatorSlots(lots)).toBe(3);
  });
  it('an absent facility still returns its documented fallback', () => {
    expect(capHours([])).toBe(8);
    expect(breedingSlots([])).toBe(0);
    expect(incubatorSlots([])).toBe(1);
  });
});
```

Extend the existing `facility arrays match maxLevel` test in `tests/data.test.ts` — it length-guards `incomeBonusPct` and `upgradeCosts` but not the three optional arrays, which is why a stale array ships green:

```ts
  it('facility arrays match maxLevel', () => {
    for (const f of Object.values(FACILITIES)) {
      expect(f.incomeBonusPct, f.kind).toHaveLength(f.maxLevel);
      expect(f.upgradeCosts, f.kind).toHaveLength(f.maxLevel - 1);
      // The optional per-level arrays are indexed by level exactly like incomeBonusPct.
      // Without these three, a maxLevel bump that leaves one stale reads undefined at the
      // new top level — and `count >= undefined` is false, so the cap silently vanishes.
      if (f.capHours) expect(f.capHours, f.kind).toHaveLength(f.maxLevel);
      if (f.incubatorSlots) expect(f.incubatorSlots, f.kind).toHaveLength(f.maxLevel);
      if (f.breedingSlots) expect(f.breedingSlots, f.kind).toHaveLength(f.maxLevel);
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/park.test.ts -t 'bounds-guarded'`
Expected: FAIL — all three return `undefined` at the call boundary. Note that `capHours`' `NaN` appears one level up, inside `accruedIncome`'s arithmetic on that `undefined`, not at `capHours` itself. Record the three actual values in your report; they are the defect.

The `tests/data.test.ts` change should PASS at this commit (all three arrays currently match their `maxLevel`). That is correct — it is a guard against Task 3, not a bug report. Say so in your report.

- [ ] **Step 3: Add the helper and use it at all three sites**

In `src/modules/park/service.ts`, beside `facilityLevel`:

```ts
/**
 * Read a per-level facility array safely. `level` is 1-based; 0 means "absent" and takes
 * the fallback. A level ABOVE the array clamps to its top entry rather than reading
 * undefined — the safe direction, because `undefined` does not throw here, it silently
 * disables the thing being read: `count >= undefined` is false (no incubation cap at all),
 * and `from + undefined` is NaN (no income, and a literal "Collect NaN" button). Neither
 * npm test nor npm run typecheck can see that class of bug; tsconfig has strict but not
 * noUncheckedIndexedAccess.
 */
export function levelValue(table: number[] | undefined, level: number, fallback: number): number {
  if (level <= 0 || !table || table.length === 0) return fallback;
  return table[Math.min(level, table.length) - 1] ?? fallback;
}
```

Then rewrite the two readers in that file:

```ts
export function capHours(lots: Lot[]): number {
  return levelValue(FACILITIES.visitor_center.capHours, facilityLevel(lots, 'visitor_center'), 8);
}

// Returns 0 without a Gene Lab, unlike capHours/incubatorSlots: there is no free
// breeding slot the way every park gets a free incubator.
export function breedingSlots(lots: Lot[]): number {
  return levelValue(FACILITIES.gene_lab.breedingSlots, facilityLevel(lots, 'gene_lab'), 0);
}
```

And in `src/modules/hatchery/service.ts`:

```ts
export function incubatorSlots(lots: Lot[]): number {
  return levelValue(FACILITIES.hatchery_lab.incubatorSlots, facilityLevel(lots, 'hatchery_lab'), 1);
}
```

Add `levelValue` to that file's existing import from `../park/service.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/park.test.ts tests/data.test.ts tests/hatchery.test.ts`
Expected: PASS. Then run the full suite (`npx vitest run`) — the guard changes behaviour only for levels that no current fixture uses, so nothing else may move.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/service.ts src/modules/hatchery/service.ts tests/park.test.ts tests/data.test.ts
git commit -m "Bounds-guard the per-level facility arrays"
```

---

## Task 2: Quote the upgrade price

**Files:**
- Modify: `src/modules/park/service.ts` (`upgradeCostFor`, `upgradeLot`), `src/modules/park/index.ts` (`/upgrade` label and error)
- Test: `tests/park.test.ts`, `tests/autocomplete-park.test.ts`

**Interfaces:**
- Consumes: `levelValue` from Task 1.
- Produces: `upgradeCostFor(kind: string, level: number): number` — the cost to go from `level` to `level + 1`, exported from `src/modules/park/service.ts`.

**Why:** `/upgrade` quotes no price anywhere today — the autocomplete label is `🏗️ #N Name (lvl N)`, success is `⬆️ Name is now level N.`, failure is a bare `'Not enough cash.'` — and Task 3 puts a 2,250,000 step behind it. The repo rule is that every price a surface displays and the price it charges come from one helper.

- [ ] **Step 1: Write the failing tests**

```ts
describe('upgradeCostFor', () => {
  it('matches the facility table for every kind and level', () => {
    for (const f of Object.values(FACILITIES)) {
      for (let level = 1; level < f.maxLevel; level++) {
        expect(upgradeCostFor(f.kind, level), `${f.kind} L${level}`).toBe(f.upgradeCosts[level - 1]);
      }
    }
  });
  it('prices a paddock off its build cost', () => {
    expect(upgradeCostFor('herbivore_paddock', 1)).toBe(5_000);
    expect(upgradeCostFor('herbivore_paddock', 3)).toBe(31_250);
  });
  it('charges exactly what it quotes', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');                       // owner row first: lots.user_id is an FK
    const lot = seedLot({ type: 'paddock', kind: 'herbivore_paddock', name: 'Pen', level: 1 });
    const quoted = upgradeCostFor('herbivore_paddock', 1);
    ctx.db.update(schema.users).set({ cash: quoted }).where(eq(schema.users.discordId, 'u1')).run();
    upgradeLot(ctx, 'u1', lot.id);
    // Funded with EXACTLY the quote, so landing on 0 proves the charge equals the quote.
    // (An `expect(before).toBeGreaterThanOrEqual(0)` here would assert nothing — cash is a
    // non-negative column by CHECK constraint.)
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(0);
  });
});
```

In `tests/autocomplete-park.test.ts`, the two existing `/upgrade` label assertions pin the label without a price. Update both to expect the price, and add:

```ts
  it('quotes the next level price in the upgrade label', async () => {
    seedLot({ type: 'paddock', kind: 'herbivore_paddock', name: 'Pen', level: 1 });
    const i = fakeAutocomplete({ name: 'upgrade', user: 'u1', focused: { name: 'lot', value: '' } });
    await parkModule.commands.find((c) => c.data.name === 'upgrade')!.autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string }>;
    expect(rows[0].name).toContain('5,000');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/park.test.ts -t 'upgradeCostFor'`
Expected: FAIL — `upgradeCostFor` is not exported.

- [ ] **Step 3: Implement the helper and wire the two surfaces**

In `src/modules/park/service.ts`:

```ts
/**
 * Cost to take `kind` from `level` to `level + 1`. One helper so the autocomplete label,
 * the failure message and the actual charge cannot disagree — the same rule the shop's
 * price helpers follow. Bounds-guarded through levelValue for the same reason capHours is.
 */
export function upgradeCostFor(kind: string, level: number): number {
  const def = FACILITIES[kind];
  if (def) return levelValue(def.upgradeCosts, level, def.upgradeCosts[def.upgradeCosts.length - 1] ?? 0);
  return Math.round(PADDOCKS[kind].buildCost * 2.5 ** level);
}
```

In `upgradeLot`, replace the inline cost computation with `const cost = upgradeCostFor(lot.kind, lot.level);` and leave everything else — the `maxLevel` check, the transaction, the `track` call — exactly as it is.

In `src/modules/park/index.ts`'s `/upgrade` autocomplete, extend the label and quote the price on failure:

```ts
            const maxLevel = FACILITIES[l.kind]?.maxLevel ?? 4;
            const valid = l.level < maxLevel;
            const price = valid ? ` — ${upgradeCostFor(l.kind, l.level).toLocaleString('en-US')} cash` : '';
            return { value: l.id, valid, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})${valid ? price : ' — MAX LEVEL'}` };
```

```ts
          else if (e instanceof InsufficientFundsError) await i.reply({
            content: `Not enough cash — that upgrade costs ${upgradeCostFor(lot.kind, lot.level).toLocaleString('en-US')}.`,
            flags: MessageFlags.Ephemeral,
          });
```

The `catch` block has no `lot` in scope. Read the surrounding code and hoist what you need — the simplest correct shape is to look the row up before the `try`, or to attach the cost to the thrown error. Choose one, and say which in your report; do not leave the message vague to avoid the problem.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/park.test.ts tests/autocomplete-park.test.ts`
Expected: PASS. Autocomplete labels are not builder data, so this needs no `deploy-commands`.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/service.ts src/modules/park/index.ts tests/park.test.ts tests/autocomplete-park.test.ts
git commit -m "Quote the upgrade price on the surfaces that offer it"
```

---

## Task 3: Hatchery Lab levels 4 and 5

**Files:**
- Modify: `src/data/facilities.ts`
- Test: `tests/data.test.ts`, `tests/hatchery.test.ts`

**Interfaces:**
- Consumes: `levelValue` (Task 1), `upgradeCostFor` (Task 2).
- Produces: no new exports. `FACILITIES.hatchery_lab.maxLevel` becomes 5.

**Why these numbers:** endgame legendary egg supply is about 6.43/day (3.80 shop + 0.63 expedition + 2.00 breeding) against 3 slots/day at L3, so slots are the binding constraint. 375,000 is the ×2.5 interior step; 2,250,000 is a ×6.0 wall, the multiple this facility's own curve already uses. Two steps total 2,625,000 — 13.81 hours of reference income, so it is content, not the sink.

- [ ] **Step 1: Write the failing tests**

Update the `FACILITIES values match the spec` pin in `tests/data.test.ts`:

```ts
    expect(FACILITIES.hatchery_lab.maxLevel).toBe(5);
    expect(FACILITIES.hatchery_lab.incubatorSlots).toEqual([1, 2, 3, 4, 5]);
    expect(FACILITIES.hatchery_lab.incomeBonusPct).toEqual([0, 0, 0, 0, 0]);
    expect(FACILITIES.hatchery_lab.upgradeCosts).toEqual([25_000, 150_000, 375_000, 2_250_000]);
```

Append to `tests/hatchery.test.ts`, reusing that file's existing egg-seeding and lot-seeding helpers:

```ts
describe('hatchery lab levels 4 and 5', () => {
  it('grants one incubator slot per level', () => {
    for (const [level, slots] of [[3, 3], [4, 4], [5, 5]] as const) {
      const c = makeCtx();
      getOrCreateUser(c, 'u1', 'Reg');
      c.db.insert(schema.lots).values({
        userId: 'u1', type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab', level,
      }).run();
      const lots = c.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all();
      expect(incubatorSlots(lots), `level ${level}`).toBe(slots);
    }
  });

  it('refuses a fourth concurrent incubation at L3 but allows it at L4', () => {
    // Seed four eggs and incubate three; the fourth is the assertion.
    const atLevel = (level: number) => {
      const c = makeCtx();
      getOrCreateUser(c, 'u1', 'Reg');
      c.db.insert(schema.lots).values({
        userId: 'u1', type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab', level,
      }).run();
      const ids = [0, 1, 2, 3].map(() => c.db.insert(schema.eggs).values({
        userId: 'u1', rarity: 'common', source: 'admin', obtainedAt: 0,
      }).returning().get().id);
      for (const id of ids.slice(0, 3)) incubateEgg(c, 'u1', id);
      return () => incubateEgg(c, 'u1', ids[3]);
    };
    expect(atLevel(3)).toThrow();
    expect(atLevel(4)).not.toThrow();
  });
});
```

Check `incubateEgg`'s real error type and match it — read `src/modules/hatchery/service.ts` and assert the specific class rather than a bare `toThrow()` if one exists.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/data.test.ts tests/hatchery.test.ts -t 'levels 4 and 5'`
Expected: FAIL — `maxLevel` is 3 and the arrays are three long. Note that **the length assertions from Task 1 are what would have caught a partial bump**; confirm in your report that they pass after your change, since that is the guard working.

- [ ] **Step 3: Make the data change**

```ts
  hatchery_lab: {
    kind: 'hatchery_lab', name: 'Hatchery Lab', maxLevel: 5,
    incomeBonusPct: [0, 0, 0, 0, 0],
    incubatorSlots: [1, 2, 3, 4, 5],
    // 375,000 is the x2.5 interior step this curve uses; 2,250,000 is a x6.0 wall, the
    // multiple this facility's own L2->L3 step already used. Two steps = 2,625,000 =
    // 13.81 h of the 190,080/hr reference park, so these levels are content, not the
    // cash sink — the sink is the landmark ladder in src/data/landmarks.ts.
    // Slots are the binding endgame constraint: legendary egg supply is ~6.43/day
    // (3.80 shop + 0.63 expedition + 2.00 breeding) against 3 slots/day at L3.
    buildCost: 10_000, upgradeCosts: [25_000, 150_000, 375_000, 2_250_000],
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run` (the full suite — this changes a table many things read)
Expected: PASS, zero failures. `facilityBonusPct` is unaffected because the new `incomeBonusPct` entries are 0.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/data/facilities.ts tests/data.test.ts tests/hatchery.test.ts
git commit -m "Add Hatchery Lab levels 4 and 5"
```

---

## Task 4: The `landmark_tier` column and migration 0011

**Files:**
- Modify: `src/core/db/schema.ts` (the `users` table)
- Create: `drizzle/0011_landmark_tier.sql` (generated)
- Test: `tests/migration.test.ts`

**Interfaces:**
- Produces: `schema.users.landmarkTier` — column `landmark_tier`, integer, not null, default 0.

- [ ] **Step 1: Write the failing migration test**

Append to `tests/migration.test.ts`, copying the 0010 block's recipe exactly — scratch dir, journal filtered, `foreign_keys = ON`, a parent `users` row **and** a child `dinos` row, then the real `migrateDb`. That file's own comment says anything less is a false green:

```ts
describe('0011 landmark tier via the real drizzle migrator (production path)', () => {
  it('adds landmark_tier defaulting to 0 and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig11-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|10).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 10);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0010 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      const rows = sqlite.prepare(`SELECT discord_id, landmark_tier FROM users`).all();
      expect(rows).toEqual([{ discord_id: 'u1', landmark_tier: 0 }]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/migration.test.ts -t '0011'`
Expected: FAIL — `no such column: landmark_tier`.

- [ ] **Step 3: Add the column and generate the migration**

In `src/core/db/schema.ts`, inside `users`, after `alertsEnabled`:

```ts
  // Cosmetic prestige ladder (src/data/landmarks.ts). Deliberately read by NOTHING in
  // rating.ts, clock.ts, lotSlots or matchedKindCount: the sink's power-freedom is
  // structural rather than a filter someone has to remember. Monotone — only the next
  // tier is ever purchasable — which is also what removes the refund question.
  landmarkTier: integer('landmark_tier').notNull().default(0),
```

Then `npx drizzle-kit generate`. **Read the emitted SQL.** It must be a single `ALTER TABLE users ADD ...` and nothing else — no `__new_users`, no `DROP TABLE`, no other table touched. A table recreate passes every empty-DB test and fails on populated production, because `PRAGMA foreign_keys` is a no-op inside drizzle's per-migration transaction. If drizzle-kit auto-names the file, rename it and its journal `tag` to `0011_landmark_tier` to match this repo's convention, leaving the SQL untouched. Report the emitted SQL verbatim.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/migration.test.ts && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/db/schema.ts drizzle/0011_landmark_tier.sql drizzle/meta tests/migration.test.ts
git commit -m "Add the landmark tier column and migration 0011"
```

---

## Task 5: The landmark ladder data

**Files:**
- Create: `src/data/landmarks.ts`
- Test: `tests/landmarks.test.ts` (create)

**Interfaces:**
- Produces, all from `src/data/landmarks.ts` (Tasks 6, 8, 12 and 13 import these):
  - `type LandmarkBand = 'a' | 'b' | 'c'`
  - `interface LandmarkDef { tier: number; name: string; cost: number; band: LandmarkBand }`
  - `LANDMARKS: readonly LandmarkDef[]` (six entries, tiers 1–6 in order)
  - `MAX_LANDMARK_TIER: number`
  - `landmarkFor(tier: number): LandmarkDef | null`
  - `landmarkCostFor(tier: number): number | null`
  - `landmarkBandFor(tier: number): LandmarkBand | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/landmarks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LANDMARKS, MAX_LANDMARK_TIER, landmarkFor, landmarkCostFor, landmarkBandFor } from '../src/data/landmarks.js';

describe('landmark ladder', () => {
  it('is six rungs of strictly increasing cost', () => {
    expect(LANDMARKS).toHaveLength(6);
    expect(MAX_LANDMARK_TIER).toBe(6);
    LANDMARKS.forEach((l, i) => expect(l.tier, l.name).toBe(i + 1));
    for (let i = 1; i < LANDMARKS.length; i++) {
      expect(LANDMARKS[i].cost, LANDMARKS[i].name).toBeGreaterThan(LANDMARKS[i - 1].cost);
    }
  });
  it('matches the spec values', () => {
    expect(LANDMARKS.map((l) => l.cost)).toEqual([5_000_000, 10_000_000, 20_000_000, 40_000_000, 80_000_000, 160_000_000]);
    expect(LANDMARKS.map((l) => l.band)).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
    expect(LANDMARKS.map((l) => l.name)).toEqual([
      'Stone Marker', 'Fossil Plinth', 'Bronze Sentinel', 'Amber Obelisk', 'Grand Rotunda', 'Titan Monument',
    ]);
  });
  it('totals 315,000,000 — the sink sizing the spec is built on', () => {
    expect(LANDMARKS.reduce((s, l) => s + l.cost, 0)).toBe(315_000_000);
  });
  it('every band is used, so no art file is orphaned', () => {
    expect(new Set(LANDMARKS.map((l) => l.band))).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('landmark lookups', () => {
  it('resolve a real tier', () => {
    expect(landmarkFor(1)!.name).toBe('Stone Marker');
    expect(landmarkCostFor(3)).toBe(20_000_000);
    expect(landmarkBandFor(5)).toBe('c');
  });
  it('return null outside the ladder rather than throwing or reading past the table', () => {
    for (const t of [0, -1, 7, 99, 1.5, NaN]) {
      expect(landmarkFor(t), `tier ${t}`).toBeNull();
      expect(landmarkCostFor(t), `tier ${t}`).toBeNull();
      expect(landmarkBandFor(t), `tier ${t}`).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/landmarks.test.ts`
Expected: FAIL — cannot resolve `../src/data/landmarks.js`.

- [ ] **Step 3: Implement the data table**

Create `src/data/landmarks.ts`:

```ts
export type LandmarkBand = 'a' | 'b' | 'c';

export interface LandmarkDef { tier: number; name: string; cost: number; band: LandmarkBand }

/**
 * The endgame cash sink. Six rungs totalling 315,000,000 — roughly 47 days of the
 * reference park's unspent surplus (4,297,440/day) and 73 days at the income-maximal
 * build, against a game whose entire other purchasable content totals 1,674,000.
 * A single 5,000,000 item would be 1.16 days of surplus and would drain nothing.
 *
 * Purely cosmetic, and structurally so: the tier lives on users.landmark_tier, which
 * nothing in rating.ts, clock.ts, lotSlots or matchedKindCount reads. It deliberately
 * does NOT ship as DECOR kinds — recomputeRating sums `l.level + l.decor.length` as a
 * flat length, so a decor-shaped cosmetic would be worth +8.75 rating per tile to a
 * park below saturation and exactly 0 to a maxed one: power for the mid-game, nothing
 * for the endgame, precisely inverted.
 *
 * `band` selects the art (assets/images/park/landmark-<band>.webp) — three bands rather
 * than six rasters, so the monument visibly grows twice.
 */
export const LANDMARKS: readonly LandmarkDef[] = [
  { tier: 1, name: 'Stone Marker',    cost:   5_000_000, band: 'a' },
  { tier: 2, name: 'Fossil Plinth',   cost:  10_000_000, band: 'a' },
  { tier: 3, name: 'Bronze Sentinel', cost:  20_000_000, band: 'b' },
  { tier: 4, name: 'Amber Obelisk',   cost:  40_000_000, band: 'b' },
  { tier: 5, name: 'Grand Rotunda',   cost:  80_000_000, band: 'c' },
  { tier: 6, name: 'Titan Monument',  cost: 160_000_000, band: 'c' },
];

export const MAX_LANDMARK_TIER = LANDMARKS.length;

/** The rung at `tier`, or null for 0 (nothing built), a non-integer, or past the top. */
export function landmarkFor(tier: number): LandmarkDef | null {
  if (!Number.isInteger(tier) || tier < 1 || tier > MAX_LANDMARK_TIER) return null;
  return LANDMARKS[tier - 1];
}

export function landmarkCostFor(tier: number): number | null {
  return landmarkFor(tier)?.cost ?? null;
}

export function landmarkBandFor(tier: number): LandmarkBand | null {
  return landmarkFor(tier)?.band ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/landmarks.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/data/landmarks.ts tests/landmarks.test.ts
git commit -m "Add the landmark ladder data"
```

---

## Task 6: Buying a landmark

**Files:**
- Create: `src/modules/park/landmarks.ts`
- Test: `tests/landmarks.test.ts`

**Interfaces:**
- Consumes: `landmarkFor`, `MAX_LANDMARK_TIER` (Task 5); `schema.users.landmarkTier` (Task 4); `ctx.economy.apply(userId, delta, reason, now)`; `InsufficientFundsError` from `src/core/economy.js`.
- Produces:
  - `class LandmarkMaxedError extends Error`
  - `landmarkTierOf(ctx: Ctx, userId: string): number`
  - `nextLandmark(ctx: Ctx, userId: string): LandmarkDef | null`
  - `buyLandmark(ctx: Ctx, userId: string): LandmarkDef`

- [ ] **Step 1: Write the failing tests**

Append to `tests/landmarks.test.ts`:

```ts
describe('buyLandmark', () => {
  const rich = (c: ReturnType<typeof makeCtx>, cash: number) =>
    c.db.update(schema.users).set({ cash }).where(eq(schema.users.discordId, 'u1')).run();

  it('charges the next tier and increments by exactly one', () => {
    rich(ctx, 5_000_000);
    const def = buyLandmark(ctx, 'u1');
    expect(def.tier).toBe(1);
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(1);
    expect(row.cash).toBe(0);
  });

  it('walks the ladder one rung at a time', () => {
    rich(ctx, 15_000_000);
    buyLandmark(ctx, 'u1');
    const second = buyLandmark(ctx, 'u1');
    expect(second.tier).toBe(2);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(0);
  });

  it('refuses past the top rung', () => {
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER, cash: 999_999_999 })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(() => buyLandmark(ctx, 'u1')).toThrow(LandmarkMaxedError);
  });

  it('refuses without the cash and leaves the tier untouched', () => {
    rich(ctx, 4_999_999);
    expect(() => buyLandmark(ctx, 'u1')).toThrow(InsufficientFundsError);
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(0);
    expect(row.cash).toBe(4_999_999);
  });

  it('reports the next rung and stops reporting one at the top', () => {
    expect(nextLandmark(ctx, 'u1')!.tier).toBe(1);
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(nextLandmark(ctx, 'u1')).toBeNull();
  });
});
```

Add a `beforeEach` creating `ctx` and `getOrCreateUser(ctx, 'u1', 'Reg')` at the top of the file if it has none yet — the earlier data tests need no ctx, so it may not exist.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/landmarks.test.ts -t 'buyLandmark'`
Expected: FAIL — cannot resolve `../src/modules/park/landmarks.js`.

- [ ] **Step 3: Implement the service**

Create `src/modules/park/landmarks.ts`:

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { landmarkFor, MAX_LANDMARK_TIER, type LandmarkDef } from '../../data/landmarks.js';

export class LandmarkMaxedError extends Error {
  constructor() { super('Your park already has the Titan Monument — there is nothing further to build.'); }
}

export function landmarkTierOf(ctx: Ctx, userId: string): number {
  return ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()?.landmarkTier ?? 0;
}

/** The only rung a player may buy: the one after their current tier. */
export function nextLandmark(ctx: Ctx, userId: string): LandmarkDef | null {
  return landmarkFor(landmarkTierOf(ctx, userId) + 1);
}

/**
 * Buy the next rung. There is no tier argument on purpose: the only legal purchase is the
 * next one, which is what removes the misclick surface a catalog of 5,000,000-plus objects
 * would have had — and therefore the refund path this feature does not ship.
 *
 * Charge and increment share one transaction, so a rejected charge cannot leave the tier
 * advanced. economy.apply throws InsufficientFundsError, which the caller reports.
 */
export function buyLandmark(ctx: Ctx, userId: string): LandmarkDef {
  const tier = landmarkTierOf(ctx, userId) + 1;
  const def = landmarkFor(tier);
  if (!def) throw new LandmarkMaxedError();
  ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -def.cost }, `landmark:${tier}`, ctx.now());
    ctx.db.update(schema.users).set({ landmarkTier: tier })
      .where(eq(schema.users.discordId, userId)).run();
  });
  return def;
}

export { MAX_LANDMARK_TIER };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/landmarks.test.ts && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/landmarks.ts tests/landmarks.test.ts
git commit -m "Add the landmark purchase transaction"
```

---

## Task 7: Give `/park` a real subcommand switch

**Files:**
- Modify: `src/modules/park/index.ts` (the `/park` execute body)
- Test: `tests/park.test.ts`

**Interfaces:** none new. Behaviour only.

**Why:** `/park` has no dispatch — one `=== 'rename'` check, one `=== 'alerts'` check, then an unguarded fallthrough that *is* the view path. A deployed-but-unimplemented subcommand renders the dashboard and reports success. 2a documented this trap and nothing has ever tested it; Task 8 adds a subcommand and would walk straight into it.

- [ ] **Step 1: Write the failing test**

```ts
describe('/park subcommand dispatch', () => {
  it('rejects an unrecognised subcommand instead of rendering the dashboard', async () => {
    // Synthetic name: the harness skips builder lookup for a subcommand the builder does
    // not define, which is exactly the deployed-but-unimplemented case this guards.
    const i = fakeCommand({ name: 'park', sub: 'sabotage', user: 'u1' });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    const text = JSON.stringify(i.replies[0]);
    expect(text).not.toContain('Cash');            // not the dashboard
    expect(text.toLowerCase()).toContain('unknown');
  });

  it('still renders the dashboard for view', async () => {
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Cash');
  });
});
```

If `fakeCommand` rejects the synthetic subcommand against the real builder, read `tests/harness.ts` and use whatever escape hatch it provides for unknown names; do not weaken the assertion.

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run tests/park.test.ts -t 'subcommand dispatch'`
Expected: FAIL on the first test — the unknown subcommand renders the dashboard and the payload contains `Cash`. That failure IS the trap; record the reply you got.

- [ ] **Step 3: Convert the body to a switch**

Restructure `/park`'s `execute` so the three known subcommands are explicit cases and the view path is one of them, not the default. Keep every existing branch's behaviour byte-for-byte — the same rename update, the same alerts copy and flags, the same view logic including the other-user branch. Shape:

```ts
      async execute(ctx, i) {
        const user = getOrCreateUser(ctx, i.user.id, i.user.displayName);
        // A real switch, not a chain of equality checks with the view path as the
        // fallthrough: /park previously reported success for any subcommand nobody had
        // implemented, because the last branch WAS the dashboard.
        switch (i.options.getSubcommand()) {
          case 'rename': { /* unchanged */ return; }
          case 'alerts': { /* unchanged */ return; }
          case 'view': break;
          default:
            await i.reply({ content: 'Unknown /park subcommand.', flags: MessageFlags.Ephemeral });
            return;
        }
        /* the existing view path, unchanged */
      },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/park.test.ts && npx vitest run`
Expected: PASS. Every pre-existing `/park view` and `/park alerts` test must still pass untouched — if one fails, the view path moved rather than being re-homed.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/index.ts tests/park.test.ts
git commit -m "Dispatch /park subcommands explicitly"
```

---

## Task 8: `/park landmark`

**Files:**
- Modify: `src/modules/park/index.ts` (builder, switch case, `park` component), `src/modules/park/embeds.ts` (`landmarkPayload`)
- Test: `tests/landmarks.test.ts`

**Interfaces:**
- Consumes: `nextLandmark`, `buyLandmark`, `landmarkTierOf`, `LandmarkMaxedError` (Task 6); `landmarkFor` (Task 5).
- Produces: `landmarkPayload(user: User, current: LandmarkDef | null, next: LandmarkDef | null)` from `src/modules/park/embeds.ts`; the `park:landmark:buy:<userId>` component action.

- [ ] **Step 1: Write the failing tests**

```ts
describe('/park landmark', () => {
  const run = async (user = 'u1') => {
    const i = fakeCommand({ name: 'park', sub: 'landmark', user });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('shows the next rung with a grouped price and a buy button', async () => {
    const i = await run();
    const text = JSON.stringify(i.replies[0]);
    expect(text).toContain('Stone Marker');
    expect(text).toContain('5,000,000');       // grouped, never a raw 5000000
    expect(text).toContain('park:landmark:buy:u1');
  });

  it('shows the current rung once one is built', async () => {
    ctx.db.update(schema.users).set({ landmarkTier: 2 }).where(eq(schema.users.discordId, 'u1')).run();
    const text = JSON.stringify((await run()).replies[0]);
    expect(text).toContain('Fossil Plinth');    // current
    expect(text).toContain('Bronze Sentinel');  // next
  });

  it('offers no button at the top of the ladder', async () => {
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER }).where(eq(schema.users.discordId, 'u1')).run();
    const i = await run();
    expect(JSON.stringify(i.replies[0])).toContain('Titan Monument');
    expect((i.replies[0] as { components?: unknown[] }).components ?? []).toHaveLength(0);
  });

  it('buys on click and reports the new rung', async () => {
    ctx.db.update(schema.users).set({ cash: 5_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = fakeButton({ customId: 'park:landmark:buy:u1', user: 'u1' });
    await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, i.asInteraction() as never);
    expect(JSON.stringify(i.replies[0])).toContain('Stone Marker');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.landmarkTier).toBe(1);
  });

  it('rejects a click from another player before charging anyone', async () => {
    ctx.db.update(schema.users).set({ cash: 5_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = fakeButton({ customId: 'park:landmark:buy:u1', user: 'u2' });
    await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, i.asInteraction() as never);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.landmarkTier).toBe(0);
  });

  it('reports insufficient cash with the price', async () => {
    const i = fakeButton({ customId: 'park:landmark:buy:u1', user: 'u1' });
    await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, i.asInteraction() as never);
    expect(JSON.stringify(i.replies[0])).toContain('5,000,000');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/landmarks.test.ts -t '/park landmark'`
Expected: FAIL — the builder has no `landmark` subcommand, so `fakeCommand` throws or the switch's default replies "Unknown".

- [ ] **Step 3: Implement the surface**

Add to the `/park` builder:

```ts
        .addSubcommand((s) => s.setName('landmark').setDescription('Your park landmark — the prestige ladder'))
```

Add a `case 'landmark':` to Task 7's switch that replies with `landmarkPayload(user, landmarkFor(landmarkTierOf(ctx, i.user.id)), nextLandmark(ctx, i.user.id))`.

In `src/modules/park/embeds.ts`:

```ts
export function landmarkPayload(user: User, current: LandmarkDef | null, next: LandmarkDef | null) {
  const embed = new EmbedBuilder()
    .setTitle('🏛️ Park Landmark')
    .setColor(0xc9a227)
    .setDescription(current
      ? `**${user.parkName}** is crowned by the **${current.name}**.`
      : `**${user.parkName}** has no landmark yet. It buys nothing but standing.`)
    .addFields(
      { name: 'Built', value: current ? `Tier ${current.tier} — ${current.name}` : 'Nothing yet', inline: true },
      { name: 'Next', value: next ? `${next.name} — ${next.cost.toLocaleString('en-US')} cash` : 'The ladder is complete', inline: true },
    );
  const payload: { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } = { embeds: [embed], components: [] };
  if (next) {
    payload.components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`park:landmark:buy:${user.discordId}`)
        .setLabel(`Build ${next.name}`).setStyle(ButtonStyle.Primary),
    ));
  }
  return payload;
}
```

Do **not** pass anything to `setEmoji` here: `rarityEmoji` and friends return `''` with no emoji map loaded and `setEmoji` throws rather than degrading. A unicode glyph in the label is fine.

In the existing `park` component handler, add the `landmark` action. Split the customId, check the owner id **before** any read or write, and let an unrecognised action keep whatever the current default is:

```ts
        if (action === 'landmark') {
          const [, , , uid] = i.customId.split(':');
          if (i.user.id !== uid) { await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral }); return; }
          try {
            const def = buyLandmark(ctx, i.user.id);
            await i.reply({ content: `🏛️ Built the **${def.name}**.` });
          } catch (e) {
            if (e instanceof LandmarkMaxedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
            else if (e instanceof InsufficientFundsError) {
              const next = landmarkFor(landmarkTierOf(ctx, i.user.id) + 1);
              await i.reply({
                content: `Not enough cash — the ${next?.name ?? 'next landmark'} costs ${(next?.cost ?? 0).toLocaleString('en-US')}.`,
                flags: MessageFlags.Ephemeral,
              });
            } else throw e;
          }
          return;
        }
```

Read the existing handler first: the customId shape there is `park:<action>` (`park:collect`) and `park:dinos:<uid>:<page>`, so confirm how `action` is parsed and fit the new branch to it rather than assuming.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/landmarks.test.ts tests/park.test.ts && npx vitest run`
Expected: PASS. The builder changed, so note in your report that `npm run deploy-commands` is required after merge; command count stays 26.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/index.ts src/modules/park/embeds.ts tests/landmarks.test.ts
git commit -m "Add /park landmark and its buy button"
```

---

## Task 9: Admin reset clears the landmark tier

**Files:**
- Modify: `src/modules/admin/service.ts`
- Test: `tests/admin.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```ts
  it('reset clears the landmark tier', () => {
    ctx.db.update(schema.users).set({ landmarkTier: 4 }).where(eq(schema.users.discordId, 'u1')).run();
    adminReset(ctx, 'u1');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.landmarkTier).toBe(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/admin.test.ts -t 'landmark tier'`
Expected: FAIL — the tier survives, `4 !== 0`.

- [ ] **Step 3: Add it to the reset**

Add `landmarkTier: 0` to the existing `ctx.db.update(schema.users).set({...})` call inside `adminReset`, beside `parkRating` and `questStreak`. Add a comment recording that this is progress rather than consent, unlike `alertsEnabled` immediately below.

Add to `adminFastForward`'s comment block:

```ts
// users.landmark_tier is deliberately NOT touched: the landmark ladder carries no timer
// semantics, so there is nothing for a clock shift to move.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/admin/service.ts tests/admin.test.ts
git commit -m "Clear the landmark tier on admin reset"
```

---

## Task 10: Carry the landmark tier on the snapshot

**Files:**
- Modify: `src/modules/park/snapshot.ts`
- Test: `tests/park-snapshot.test.ts`

**Interfaces:**
- Produces: `ParkSnapshot.landmarkTier?: number` — **optional**, stamped only in `buildParkSnapshot`.

**Why optional:** the snapshot crosses `postMessage` and is pinned `structuredClone`-able, and there are two hand-built `ParkSnapshot` literals plus two `ParkArt` literals in the render tests. A *required* field breaks them, and only `npm run typecheck` would catch it. `season` is the precedent to follow exactly.

- [ ] **Step 1: Write the failing test**

```ts
  it('stamps the landmark tier, and omits it at zero', () => {
    const snap = buildParkSnapshot(ctx, 'u1');
    expect(snap.landmarkTier).toBeUndefined();
    ctx.db.update(schema.users).set({ landmarkTier: 3 }).where(eq(schema.users.discordId, 'u1')).run();
    expect(buildParkSnapshot(ctx, 'u1').landmarkTier).toBe(3);
  });
  it('stays structured-cloneable with a landmark', () => {
    ctx.db.update(schema.users).set({ landmarkTier: 6 }).where(eq(schema.users.discordId, 'u1')).run();
    const snap = buildParkSnapshot(ctx, 'u1');
    expect(structuredClone(snap)).toEqual(snap);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-snapshot.test.ts -t 'landmark'`
Expected: FAIL — `landmarkTier` is `undefined` after the update, and the property does not exist on the type.

- [ ] **Step 3: Add the field**

In the `ParkSnapshot` interface, after `season`:

```ts
  // Cosmetic landmark tier the map draws a monument for — optional for the same reason
  // season is: two hand-built ParkSnapshot literals in the render tests would otherwise
  // fail to typecheck, and a snapshot built before this feature must still render.
  // Omitted entirely at tier 0, so a park with no landmark produces byte-identical output.
  landmarkTier?: number;
```

In the returned object, beside `season`:

```ts
    ...(user.landmarkTier > 0 ? { landmarkTier: user.landmarkTier } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/park-snapshot.test.ts && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/snapshot.ts tests/park-snapshot.test.ts
git commit -m "Carry the landmark tier on the park snapshot"
```

---

## Task 11: Load the landmark art

**Files:**
- Modify: `src/core/render/art.ts`
- Test: `tests/render-park-art.test.ts`

**Interfaces:**
- Produces: `ParkArt.landmarks: Record<LandmarkBand, Image | null>`, exhaustively null-initialised in `EMPTY_ART`, loaded inside `loadParkArt`'s existing single `Promise.all`.

- [ ] **Step 1: Write the failing test**

```ts
  it('EMPTY_ART initialises every landmark band, so a lookup never reads undefined', () => {
    for (const band of ['a', 'b', 'c'] as const) {
      expect(band in EMPTY_ART.landmarks, band).toBe(true);
      expect(EMPTY_ART.landmarks[band]).toBeNull();
    }
  });
  it('loadParkArt resolves with a landmarks record and never rejects', async () => {
    const art = await loadParkArt();
    expect(Object.keys(art.landmarks).sort()).toEqual(['a', 'b', 'c']);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/render-park-art.test.ts -t 'landmark'`
Expected: FAIL — `EMPTY_ART.landmarks` is undefined.

- [ ] **Step 3: Add the slot**

In `src/core/render/art.ts`:

```ts
import type { LandmarkBand } from '../../data/landmarks.js';
```

```ts
  // One raster per landmark art band (src/data/landmarks.ts). Keyed exhaustively for the
  // same reason dinoChips and groundBySeason are: a lookup by a real band must read back
  // Image | null, never undefined, because drawImage(undefined) throws exactly like
  // drawImage(null) and costs the whole park image.
  landmarks: Record<LandmarkBand, Image | null>;
```

```ts
function nullLandmarks(): Record<LandmarkBand, Image | null> {
  return { a: null, b: null, c: null };
}
```

Add `landmarks: nullLandmarks(),` to `EMPTY_ART`, and extend the **existing** `Promise.all` — do not add a second one, and do not add a top-level await in `worker.ts`:

```ts
  const [ground, platePaddock, plateFacility, groundWet, groundDry, groundCold, markA, markB, markC] = await Promise.all([
    raster('ground.webp'), raster('plate-paddock.webp'), raster('plate-facility.webp'),
    raster('ground-wet.webp'), raster('ground-dry.webp'), raster('ground-cold.webp'),
    raster('landmark-a.webp'), raster('landmark-b.webp'), raster('landmark-c.webp'),
  ]);
```

and return `landmarks: { a: markA, b: markB, c: markC },`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/render-park-art.test.ts tests/render-worker.test.ts && npx vitest run`
Expected: PASS. `tests/render-worker.test.ts` pins by source regex that `worker.ts` has exactly one top-level await — confirm it still passes.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/render/art.ts tests/render-park-art.test.ts
git commit -m "Load the landmark rasters with the rest of the park art"
```

---

## Task 12: Draw the landmark cell

**Files:**
- Modify: `src/core/render/draw.ts`
- Test: `tests/render-draw.test.ts`

**Interfaces:**
- Consumes: `ParkSnapshot.landmarkTier` (Task 10), `ParkArt.landmarks` (Task 11), `landmarkBandFor` / `landmarkFor` (Task 5).
- Produces: no new exports. `renderParkPng` draws one extra grid cell when the snapshot carries a landmark tier.

**Placement:** the cell goes **after** the build slot, at index `lots.length + (hasBuild ? 1 : 0)`, so every existing tile keeps its coordinates. That is why this breaks none of the seven hardcoded pixel samples, which all read `(10, 240)` — six pixels inside the bottom pad of the 1-row 882×254 canvas.

- [ ] **Step 1: Write the failing tests**

```ts
describe('landmark cell', () => {
  it('a snapshot with no landmark renders byte-identically to today', () => {
    const before = renderParkPng(sample, EMPTY_ART);
    expect(renderParkPng({ ...sample }, EMPTY_ART).equals(before)).toBe(true);
    expect(sample.landmarkTier).toBeUndefined();
  });

  it('a landmark adds exactly one cell, growing the grid', () => {
    // sample has 2 lots and lotCap 5, so hasBuild is true: 3 cells, 1 row, 254 tall.
    // A landmark makes 4 cells, 2 rows.
    const plain = gridDims(3), withMark = gridDims(4);
    expect(renderParkPng(sample, EMPTY_ART).length).toBeGreaterThan(0);
    const marked = renderParkPng({ ...sample, landmarkTier: 1 }, EMPTY_ART);
    expect(marked.equals(renderParkPng(sample, EMPTY_ART))).toBe(false);
    expect(withMark.height).toBeGreaterThan(plain.height);
    expect(marked.length).toBeGreaterThan(0);
  });

  it('draws the monument art when the band loaded, and the flat fill when it did not', async () => {
    // Tile index 3 -> col 0, row 1 -> x = 20, y = 84 + 166 = 250. Sample a point inside it.
    const stub = { ...EMPTY_ART, landmarks: { a: solid(0, 255, 255), b: null, c: null } };
    const at = await sampler(renderParkPng({ ...sample, landmarkTier: 1 }, stub));
    expect(at(120, 320)).toEqual([0, 255, 255]);
    const plainAt = await sampler(renderParkPng({ ...sample, landmarkTier: 1 }, EMPTY_ART));
    expect(plainAt(120, 320)).not.toEqual([0, 255, 255]);
  });

  it('renders a tier whose art is missing without throwing', () => {
    expect(() => renderParkPng({ ...sample, landmarkTier: 6 }, EMPTY_ART)).not.toThrow();
  });

  it('the existing ground sample is untouched by a landmark', async () => {
    const at = await sampler(renderParkPng({ ...sample, landmarkTier: 3 }, stubArt));
    expect(at(10, 240)).toEqual([0, 0, 255]);
  });
});
```

Read the top of `tests/render-draw.test.ts` for the real `sampler`, `stubArt` and solid-image helpers and use those names — `solid` above is a placeholder for whatever that file already has. If it has no single-colour image factory, `stubArt` was built somehow; reuse that mechanism.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/render-draw.test.ts -t 'landmark cell'`
Expected: FAIL — the landmark makes no difference, so the byte-inequality assertion and the art sample both fail. The first test (byte-identity without a landmark) should PASS already; that is the regression guard.

- [ ] **Step 3: Draw the cell**

In `src/core/render/draw.ts`, import the lookups and add the draw function:

```ts
import { landmarkBandFor, landmarkFor } from '../../data/landmarks.js';
```

```ts
// The prestige monument. Drawn as one extra grid cell AFTER the build slot so every
// existing tile keeps its coordinates — which is why this breaks none of the pinned pixel
// samples. A null band (art missing, or absent entirely) degrades to a flat plinth plus
// the tier's name; it must never reach drawImage, which throws on null and costs the whole
// park image. The name is drawn in SANS only: iconValue's font never covers emoji, and an
// emoji in this string would render as a tofu box.
function drawLandmark(c: SKRSContext2D, x: number, y: number, img: Image | null, tier: number): void {
  if (img) {
    c.save();
    rrect(c, x, y, TILE_W, TILE_H, 12); c.clip();
    c.drawImage(img, x, y, TILE_W, TILE_H);
    c.restore();
  } else {
    rrect(c, x, y, TILE_W, TILE_H, 12); c.fillStyle = '#4a4133'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#c9a227'; rrect(c, x, y, TILE_W, TILE_H, 12); c.stroke();
  }
  const def = landmarkFor(tier);
  c.fillStyle = '#f5e6b8';
  c.font = `18px "${SANS}"`;
  c.fillText(trunc(c, def ? def.name : 'Landmark', TILE_W - 28), x + 14, y + TILE_H - 16);
}
```

In `renderParkPng`, compute the band and include it in the cell count, then draw it last:

```ts
  const hasBuild = snap.lots.length < snap.lotCap;
  const band = landmarkBandFor(snap.landmarkTier ?? 0);
  const cellCount = snap.lots.length + (hasBuild ? 1 : 0) + (band ? 1 : 0);
```

```ts
  if (band) {
    const idx = snap.lots.length + (hasBuild ? 1 : 0);
    const col = idx % COLS, row = Math.floor(idx / COLS);
    drawLandmark(c, PAD + col * (TILE_W + GAP), HEADER_H + PAD + row * (TILE_H + GAP),
      art.landmarks[band], snap.landmarkTier ?? 0);
  }
```

`landmarkBandFor(0)` returns null, so a park without a landmark takes exactly the old code path and produces byte-identical output.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/render-draw.test.ts tests/render-park-art.test.ts tests/park-view-image.test.ts && npx vitest run`
Expected: PASS, full suite green. If any pre-existing pixel sample moved, the cell was placed before an existing tile rather than after the build slot — fix the placement, never the sample.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/render/draw.ts tests/render-draw.test.ts
git commit -m "Draw the landmark as an extra park grid cell"
```

---

## Task 13: The three landmark rasters

**Files:**
- Create: `assets/images/park/landmark-a.webp`, `landmark-b.webp`, `landmark-c.webp`
- Modify: `docs/assets/prompts.md`, `tests/docs-assets.test.ts`

**Interfaces:** none. Assets and their documentation.

**Format:** these load through `loadParkArt`'s raster path, so WebP — deliberately **not** SVG. An SVG would drag in the whole app-emoji contract: `tests/emoji-assets.test.ts` asserts the SVG directory exactly equals `EMOJI_FALLBACK`'s 52 keys, plus a committed 128×128 PNG, pixel checks, three doc count edits, and an irreversible `npm run deploy-emojis`.

Authored at tile size — `TILE_W × TILE_H` is 270×150 and `drawLandmark` draws 1:1 into a clipped rounded rect, exactly as the plates do. `scripts/fit-art.mjs` has `banner`, `ground` and `cutout` modes, none of which is 270×150; read it and either add no mode (resize the generated image to 270×150 by whatever route the plates used — check `docs/assets/prompts.md` for how `plate-paddock.webp` was produced) or state in your report what you did instead.

- [ ] **Step 1: Add the docs guard first**

`tests/docs-assets.test.ts` checks a **hand-typed** list of six park rasters, so a seventh, eighth and ninth would pass silently with no prompt row. Extend the list:

```ts
    for (const f of [
      'park/ground.webp', 'park/ground-wet.webp', 'park/ground-dry.webp', 'park/ground-cold.webp',
      'park/plate-paddock.webp', 'park/plate-facility.webp',
      'park/landmark-a.webp', 'park/landmark-b.webp', 'park/landmark-c.webp',
    ]) {
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/docs-assets.test.ts`
Expected: FAIL — `prompts.md is missing the regeneration target park/landmark-a.webp`.

- [ ] **Step 3: Generate the art and record the prompts**

Generate three 270×150 WebP monuments matching the existing park art's style — read the park raster rows in `docs/assets/prompts.md` for the established look, palette and framing before writing prompts. The three bands escalate: band `a` a modest stone marker, band `b` a bronze/amber monument, band `c` a grand rotunda. Each must read clearly at 270×150 against the park's ground art.

Add one row per file to `docs/assets/prompts.md` in that file's existing format, including the tool, the prompt and the post-processing step.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/docs-assets.test.ts tests/images.test.ts tests/render-park-art.test.ts`
Expected: PASS. Note that `tests/images.test.ts` asserts everything under `assets/images/` is WebP — confirm the three new files satisfy it. Then check the art actually loads: `loadParkArt()` should return non-null for all three bands.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add assets/images/park/landmark-a.webp assets/images/park/landmark-b.webp assets/images/park/landmark-c.webp docs/assets/prompts.md tests/docs-assets.test.ts
git commit -m "Add the three landmark monument rasters"
```

---

## Task 14: Legacy rank

**Files:**
- Create: `src/modules/park/ranks.ts`
- Test: `tests/ranks.test.ts` (create)

**Interfaces:**
- Consumes: `dexProgress(ctx, userId)` from `src/modules/dex/service.js`; `earnedTierCount(ctx, userId)` from `src/modules/daily/service.js`; `schema.battleProgress`; `allSpecies()`; `ACHIEVEMENTS`; `CAMPAIGN` from `src/data/battle/chapters/index.js`.
- Produces, from `src/modules/park/ranks.ts`:
  - `interface LegacyTier { rank: number; title: string; points: number }`
  - `LEGACY_TIERS: readonly LegacyTier[]` (six, ascending)
  - `legacyMaxPoints(): number` — derived from the three content tables
  - `legacyPoints(ctx: Ctx, userId: string): number`
  - `legacyRank(ctx: Ctx, userId: string): LegacyTier | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/ranks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen } from '../src/core/species-seen.js';
import { allSpecies } from '../src/data/species/index.js';
import { ACHIEVEMENTS } from '../src/data/achievements.js';
import { CAMPAIGN } from '../src/data/battle/chapters/index.js';
import { LEGACY_TIERS, legacyMaxPoints, legacyPoints, legacyRank } from '../src/modules/park/ranks.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

describe('legacy ceiling', () => {
  // Derived, never a literal: new species, achievement tracks or chapters must move it,
  // or the top rank silently becomes unreachable (or trivially reachable).
  it('is the sum of the three content maxima', () => {
    const species = allSpecies().length;
    const tiers = ACHIEVEMENTS.reduce((s, t) => s + t.tiers.length, 0);
    const stars = CAMPAIGN.reduce((s, c) => s + c.stages.length * 3, 0);
    expect(legacyMaxPoints()).toBe(species + tiers + stars);
    expect(legacyMaxPoints()).toBe(180);      // 42 + 48 + 90 on today's content
  });
  it('leaves the top tier reachable', () => {
    expect(LEGACY_TIERS[LEGACY_TIERS.length - 1].points).toBeLessThanOrEqual(legacyMaxPoints());
  });
  it('is six ascending tiers', () => {
    expect(LEGACY_TIERS).toHaveLength(6);
    for (let i = 1; i < LEGACY_TIERS.length; i++) {
      expect(LEGACY_TIERS[i].points).toBeGreaterThan(LEGACY_TIERS[i - 1].points);
      expect(LEGACY_TIERS[i].rank).toBe(LEGACY_TIERS[i - 1].rank + 1);
    }
  });
});

describe('legacyPoints', () => {
  it('is zero for a fresh park', () => {
    expect(legacyPoints(ctx, 'u1')).toBe(0);
  });
  it('counts discovered species', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    recordSpeciesSeen(ctx, 'u1', 'velociraptor');
    expect(legacyPoints(ctx, 'u1')).toBe(2);
  });
  it('counts claimed achievement tiers', () => {
    ctx.db.insert(schema.achievementClaims).values([
      { userId: 'u1', trackId: 'eggs_hatched', tier: 0, claimedAt: 0 },
      { userId: 'u1', trackId: 'eggs_hatched', tier: 1, claimedAt: 0 },
    ]).run();
    expect(legacyPoints(ctx, 'u1')).toBe(2);
  });
  it('counts battle stars, not cleared stages', () => {
    ctx.db.insert(schema.battleProgress).values([
      { userId: 'u1', stageId: 'coastal_dig_1', stars: 3, firstClearedAt: 0 },
      { userId: 'u1', stageId: 'coastal_dig_2', stars: 2, firstClearedAt: 0 },
    ]).run();
    expect(legacyPoints(ctx, 'u1')).toBe(5);
  });
  it('is per user', () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(legacyPoints(ctx, 'u2')).toBe(0);
  });
});

describe('legacyRank', () => {
  const setPoints = (n: number) => {
    // Species are the cheapest lever: one row per point, and dexProgress intersects with
    // the live roster so only real ids count.
    for (const s of allSpecies().slice(0, n)) recordSpeciesSeen(ctx, 'u1', s.id);
  };
  it('is null below the first threshold', () => {
    setPoints(LEGACY_TIERS[0].points - 1);
    expect(legacyRank(ctx, 'u1')).toBeNull();
  });
  it('resolves each threshold exactly, and one point under it', () => {
    for (const tier of LEGACY_TIERS) {
      const c = makeCtx(); getOrCreateUser(c, 'u1', 'Reg');
      for (const s of allSpecies().slice(0, Math.min(tier.points, allSpecies().length))) recordSpeciesSeen(c, 'u1', s.id);
      if (tier.points <= allSpecies().length) {
        expect(legacyRank(c, 'u1')!.rank, `at ${tier.points}`).toBeGreaterThanOrEqual(tier.rank);
      }
    }
  });
  it('returns the HIGHEST tier reached, not the first', () => {
    ctx.db.insert(schema.battleProgress).values(
      CAMPAIGN[0].stages.map((s) => ({ userId: 'u1', stageId: s.id, stars: 3, firstClearedAt: 0 })),
    ).run();
    setPoints(allSpecies().length);
    const rank = legacyRank(ctx, 'u1')!;
    expect(rank.points).toBeLessThanOrEqual(legacyPoints(ctx, 'u1'));
    const next = LEGACY_TIERS.find((t) => t.rank === rank.rank + 1);
    if (next) expect(next.points).toBeGreaterThan(legacyPoints(ctx, 'u1'));
  });
});
```

Both inserts above were checked against `src/core/db/schema.ts` when this plan was written:
`achievement_claims` is `(userId, trackId, tier, claimedAt)` with a composite primary key on
the first three, and `battle_progress` is `(userId, stageId, stars, firstClearedAt, attempts)`
with `stars` carrying a `0 <= stars <= 3` CHECK and `attempts` defaulted. They should apply as
written; if either has moved since, fix the insert rather than the assertion.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ranks.test.ts`
Expected: FAIL — cannot resolve `../src/modules/park/ranks.js`.

- [ ] **Step 3: Implement it**

Create `src/modules/park/ranks.ts`:

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { dexProgress } from '../dex/service.js';
import { earnedTierCount } from '../daily/service.js';
import { allSpecies } from '../../data/species/index.js';
import { ACHIEVEMENTS } from '../../data/achievements.js';
import { CAMPAIGN } from '../../data/battle/chapters/index.js';

export interface LegacyTier { rank: number; title: string; points: number }

/**
 * Earned standing, front-loaded so rank 1 arrives early and Director stays rare.
 * Thresholds are fractions of the 180-point ceiling: 8.3 / 19.4 / 36.1 / 55.6 / 77.8 / 94.4%.
 */
export const LEGACY_TIERS: readonly LegacyTier[] = [
  { rank: 1, title: 'Groundskeeper', points: 15 },
  { rank: 2, title: 'Keeper', points: 35 },
  { rank: 3, title: 'Curator', points: 65 },
  { rank: 4, title: 'Warden', points: 100 },
  { rank: 5, title: 'Conservator', points: 140 },
  { rank: 6, title: 'Director', points: 170 },
];

/**
 * The ceiling, derived from the three content tables rather than written down: 42 species
 * + 48 achievement tiers + 90 battle stars = 180 today. New content must move this, or the
 * top rank silently drifts from "nearly everything" to "a fraction of it".
 */
export function legacyMaxPoints(): number {
  return allSpecies().length
    + ACHIEVEMENTS.reduce((s, t) => s + t.tiers.length, 0)
    + CAMPAIGN.reduce((s, c) => s + c.stages.length * 3, 0);
}

/**
 * Breadth, never wealth. Three batched reads, no per-id work.
 *
 * Deliberately NOT built on user_stats: migration 0006 backfilled only 6 of its 18
 * counters, so the other twelve start at 0 for every pre-0006 account and are
 * unrecoverable — a rank spanning them would under-rank the oldest players, the exact
 * inversion this feature exists to prevent. Also not on income_collected (that ranks cash
 * velocity, and it grows at the rate the landmark ladder is draining), not on
 * ratingHighWater (it already gates slots, sites, chapters, the shop ceiling and the
 * mythic unlock), and not on users.createdAt (zero readers, and the one signal
 * adminFastForward cannot shift, so a high rank would have no QA path).
 */
export function legacyPoints(ctx: Ctx, userId: string): number {
  const stars = ctx.db.select().from(schema.battleProgress)
    .where(eq(schema.battleProgress.userId, userId)).all()
    .reduce((s, r) => s + r.stars, 0);
  return dexProgress(ctx, userId).seen + earnedTierCount(ctx, userId) + stars;
}

/** The highest tier reached, or null below the first threshold. */
export function legacyRank(ctx: Ctx, userId: string): LegacyTier | null {
  const points = legacyPoints(ctx, userId);
  let out: LegacyTier | null = null;
  for (const tier of LEGACY_TIERS) if (points >= tier.points) out = tier;
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ranks.test.ts && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/ranks.ts tests/ranks.test.ts
git commit -m "Derive a legacy rank from collection, achievements and battle stars"
```

---

## Task 15: Show the rank on the park dashboard

**Files:**
- Modify: `src/modules/park/embeds.ts` (`dashboardPayload` opts), `src/modules/park/index.ts` (both `/park view` branches)
- Test: `tests/park.test.ts`

**Interfaces:**
- Consumes: `legacyRank` (Task 14).
- Produces: `dashboardPayload`'s `opts` gains `legacyRank?: LegacyTier | null`.

- [ ] **Step 1: Write the failing tests**

Clone the achievements-badge pattern already in `tests/park.test.ts`:

```ts
describe('dashboard legacy rank', () => {
  it('shows the title when ranked', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 0, 0, 0, { legacyRank: { rank: 3, title: 'Curator', points: 65 } });
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name === '🏛️ Legacy');
    expect(field).toBeTruthy();
    expect(field!.value).toContain('Curator');
  });
  it('omits the field when unranked', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    for (const opts of [{ legacyRank: null }, {}]) {
      const names = dashboardPayload(user, [], 0, 0, 0, opts).embeds[0].toJSON().fields!.map((f) => f.name);
      expect(names).not.toContain('🏛️ Legacy');
    }
  });
});

describe('/park view legacy rank wiring', () => {
  it('shows the TARGET player rank when viewing another park, not the viewer own', async () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    // Give u2 enough points to rank and u1 none.
    for (const s of allSpecies().slice(0, 20)) recordSpeciesSeen(ctx, 'u2', s.id);
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1', options: { user: { id: 'u2' } } });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Keeper');
  });
});
```

Check the real option shape for a user option in `fakeCommand` (`tests/harness.ts` accepts `{ id, bot? }`) and match it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/park.test.ts -t 'legacy'`
Expected: FAIL — no `🏛️ Legacy` field exists.

- [ ] **Step 3: Add the field and wire both branches**

In `dashboardPayload`'s `opts` type add `legacyRank?: LegacyTier | null`, importing the type from `./ranks.js`. After the achievements block:

```ts
  if (opts.legacyRank) {
    embed.addFields({
      name: '🏛️ Legacy',
      value: `${opts.legacyRank.title} (rank ${opts.legacyRank.rank})`,
      inline: true,
    });
  }
```

Keep `opts` optional overall — `tests/park-view-image.test.ts` calls `dashboardPayload` with five positional arguments and no opts at all.

In `src/modules/park/index.ts`, pass it on **both** view branches. The other-user branch must pass the **target's** id, not `i.user.id`:

```ts
          legacyRank: legacyRank(ctx, targetUser.id),
```

and on the own-park branch:

```ts
          legacyRank: legacyRank(ctx, i.user.id),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/park.test.ts tests/park-view-image.test.ts && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/embeds.ts src/modules/park/index.ts tests/park.test.ts
git commit -m "Show the legacy rank on the park dashboard"
```

---

## Task 16: Show the rank in the dex footer

**Files:**
- Modify: `src/modules/dex/embeds.ts` (`dexListPayload`)
- Test: `tests/dex.test.ts`

**Interfaces:**
- Consumes: `legacyRank` (Task 14).

- [ ] **Step 1: Write the failing test**

```ts
  it('shows the legacy rank in the footer once ranked', () => {
    for (const s of allSpecies().slice(0, 20)) recordSpeciesSeen(ctx, 'u1', s.id);
    expect(JSON.stringify(dexListPayload(ctx, 'u1', {}, 1))).toContain('Keeper');
  });
  it('omits it entirely when unranked', () => {
    const text = JSON.stringify(dexListPayload(ctx, 'u1', {}, 1));
    expect(text).toContain('0/42');
    expect(text).not.toContain('rank');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dex.test.ts -t 'legacy'`
Expected: FAIL — the footer has no rank.

- [ ] **Step 3: Extend the footer**

In `dexListPayload`, after computing `progress`:

```ts
  const rank = legacyRank(ctx, userId);
  const rankPart = rank ? ` · ${rank.title}` : '';
```

and use it in the footer text alongside the existing seen count and page numbers. Keep the existing order — `tests/dex.test.ts` asserts on `Page 1/5` and `N/42`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dex.test.ts && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/dex/embeds.ts tests/dex.test.ts
git commit -m "Show the legacy rank in the dex footer"
```

---

## Task 17: Documentation

**Files:**
- Modify: `docs/gameplay.md`, `docs/commands.md`, `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Fix the false decor claim**

`docs/gameplay.md` states "**Every piece of decor you own raises your park rating**". That has never been true past `parkRaw` 40, and it is easier to hit than the doc implies: `buildLot` exempts paddocks from its duplicate rule, so `VC L5 + 9 paddocks L4 = 41` is reachable with zero decor. Rewrite it to say decor raises the park build-out term **until it saturates at 40**, and that lot levels alone can reach that. The "maximum of 40" line stays accurate — `PARK_TARGET` does not move.

- [ ] **Step 2: Add the two new sections**

A **Landmarks** section: six rungs with names and prices, that they are purely cosmetic and buy no advantage, that they appear on the park map, that only the next rung is purchasable, and that there is no refund because there is nothing to mis-buy.

A **Legacy Ranks** section: the six titles and thresholds, that points come from species discovered plus achievement tiers claimed plus battle stars (180 total), that nothing is spent or consumed, and where the rank shows.

Match the file's existing table and voice.

- [ ] **Step 3: Update the command reference**

`docs/commands.md`: add `/park landmark`, and note that `/upgrade` now quotes the price in its suggestions and its failure message.

- [ ] **Step 4: Record the invariants**

`CLAUDE.md` gains, in that file's voice:

- Why the sink is a `users` column and not a `DECOR` kind — `rating.ts` sums `decor.length` flat, so a decor-shaped cosmetic is +8.75 rating to an unsaturated park and 0 to a maxed one.
- That the ladder is monotone and that this is what removes the refund path.
- That Legacy rank is derived and must never read `user_stats`, because 0006 backfilled 6 of 18 counters.
- The three bounds guards and `levelValue`, with the reason `typecheck` cannot catch that class of bug and that `capHours` degrades to a literal "Collect NaN" button.
- That `PARK_TARGET` must not move, with the trade-gate reason.
- **A correction to the 2a entry**: the park term is saturable on lot levels alone (`VC L5 + 9 paddocks L4 = 41`), so the "two decor pieces are mandatory for 10.0★" property never existed.
- That the landmark cell draws after the build slot, which is why it breaks no pinned pixel sample.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run
npm run typecheck
git add docs/gameplay.md docs/commands.md CLAUDE.md
git commit -m "Document landmarks, legacy ranks, and the park-term correction"
```

---

## Task 18: Live gallery cases

**Files:**
- Modify: `scripts/test-live.ts`

**Interfaces:** none.

- [ ] **Step 1: Add three cases**

1. **A landmark on the park map.** Seed a landmark tier on the **P1** fixture — it builds 2 lots, so it renders the 1-row 882×254 canvas the new cell has to fit, and its park PNG case is already registered. Note that P1 is also seeded with exactly one incubator slot and a comment saying the ordering depends on it; do not disturb that.
2. **`/park landmark`** at a mid-ladder tier, so both the built and next rungs render with grouped prices.
3. **A dashboard showing a Legacy rank** — seed enough species discoveries on a fixture player to clear a threshold.

Follow the file's existing case shape, and remember every `Ctx` there must supply `sleep`, and that `ctx.setNow(Date.now())` at the top is deliberate.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. This is the only gate covering `scripts/`.

- [ ] **Step 3: Verify the suite**

Run: `npx vitest run`
Expected: PASS — `scripts/` is not in the suite, but a shared-module change would surface here.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-live.ts
git commit -m "Cover the landmark and the legacy rank in the live gallery"
```

- [ ] **Step 5: Final verification**

```bash
npm run typecheck
npx vitest run
npm run build
```

Then the operator steps, which are **not** part of this branch: `npm run deploy-commands` (the `/park` builder gained the `landmark` subcommand; command count stays 26) → restart, which applies migration 0011 → `npm run test:live`. No `deploy-emojis`: this branch adds no emoji.

---

## Self-Review

**Spec coverage.** §2's decisions map to tasks: the ladder to 5–6, the `users` column to 4, no-refund to 6, breadth-based rank to 14, hatchery slot power to 3, `PARK_TARGET` untouched (no task — a constraint, recorded in Task 17), guards-before-bump to 1 preceding 3. §4 the ladder → 5, 6, 8. §5 PNG → 10, 11, 12, 13. §6 ranks → 14, 15, 16. §7 hatchery → 1, 2, 3. §8 migration → 4. §9 admin → 9. §10 testing is distributed with the migration recipe in 4 and the byte-identity guard in 12. §11 docs → 17. §13 ops → 18 Step 5.

Deliberately unimplemented, per §15: the decor-spam purchase, a daily-loop footprint for the sink, a `/help` topic, six rasters, and a rank on `/top` or the PNG HUD.

**Type consistency.** `levelValue` is defined in Task 1 and used in Tasks 1, 2, 3. `LandmarkDef` / `LandmarkBand` / `landmarkFor` / `landmarkCostFor` / `landmarkBandFor` / `MAX_LANDMARK_TIER` are defined in Task 5 and consumed unchanged in 6, 8, 11, 12. `buyLandmark` / `nextLandmark` / `landmarkTierOf` / `LandmarkMaxedError` are defined in Task 6 and used in 8. `ParkSnapshot.landmarkTier` (Task 10) and `ParkArt.landmarks` (Task 11) are both consumed in 12. `LegacyTier` / `LEGACY_TIERS` / `legacyMaxPoints` / `legacyPoints` / `legacyRank` are defined in Task 14 and used in 15 and 16.

**Values to derive rather than trust.** Three numbers in test assertions come from content tables and will drift: 42 species, 48 achievement tiers, 90 battle stars. Task 14 asserts the ceiling **both** ways — against the derived sum and against 180 — so a content change fails the literal and points at the line to update. The `upgradeCostFor` paddock expectations in Task 2 (5,000 and 31,250) come from `Math.round(2000 × 2.5 ** level)`; re-derive them rather than trusting this plan. Task 12's sampled coordinate (120, 320) assumes the landmark lands at cell index 3 → col 0, row 1 → origin (20, 250); recompute it from `draw.ts`'s own constants before asserting, and if `tests/render-draw.test.ts` has no single-colour image helper, build the stub the way `stubArt` already is.
