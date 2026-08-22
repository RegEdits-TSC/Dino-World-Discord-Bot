# Lots Tab Build and Upgrade Menus Implementation Plan (PR 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put working Build and Upgrade select menus on the Lots tab, each behind a confirm click, without ever charging more than the label the player read.

**Architecture:** Two string select menus on the Lots tab. Selecting an option does not spend — it swaps the card into a confirm state whose Yes button carries the exact thing being bought. Every client-supplied value is validated three times: against the message's own option list, against an explicit allowlist or integer parse, and against a fresh database read. Tasks 0a and 0b move the last line of defence **underneath** the handlers first — into the data tables and into `upgradeLot`'s signature — so a forgotten handler check can no longer be the only thing standing between a forged value and the money.

> **Amended 2026-08-21.** Tasks 0a and 0b are new, and every later task changed. Read the amended spec's §3.4, §3.5, §3.6 and §3.7 alongside this plan — an earlier revision of both put all enforcement in the handlers, and this one deliberately does not.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js 14.27.0, vitest, better-sqlite3 + drizzle.

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()`.
- DB access is synchronous drizzle/better-sqlite3, never awaited.
- Prices are **re-derived at execution** by the service layer. A menu option's `value` carries identity plus a staleness anchor and **never a number** — any price in a label is a display copy the handler never reads back.
- Client-supplied values are validated against a real union or an explicit allowlist, never cast, and never looked up through a plain-object key.
- Rejections use `deferUpdate()` or a specific ephemeral message; never a bare `return`.
- No authorship attribution of any kind in commits, code comments, or docs.

**Depends on:** PR 2 (`2026-08-19-park-view-tabs-2-select-routing.md`) merged — this plan uses `SelectDef`, `fakeSelect`, the router's select branch and `submittedValuesAreOnMessage`. PR 1 merged — this plan modifies `lotsPayload`.

## The incident this plan exists to not repeat

`park:landmark:buy` shipped with no tier in its customId. Its label froze at render while `buyLandmark` re-derived `current + 1` on every click, so four clicks of one button labelled "Build Stone Marker" charged 5,000,000 then 10,000,000 then 20,000,000 then 40,000,000 — **32x its own label**, against a feature with no refund path.

The Upgrade menu is a worse version of the same shape. `upgradeCostFor` is a pure function of `(kind, level)` and paddock cost is `buildCost * 2.5 ** level`, so a stale option charges the *next* rung's price. The measured worst case is `hatchery_lab`: a label reading 25,000 against a charge of 2,250,000 — **90x**.

---

### Task 0a: Null-prototype lot tables and an explicit check inside `buildLot`

**Files:**
- Modify: `src/data/paddocks.ts`, `src/data/facilities.ts`, `src/modules/park/service.ts`
- Test: `tests/data.test.ts`, `tests/park.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks; this is the first task in the plan.
- Produces: `PADDOCKS` and `FACILITIES` keep the exact type they have today,
  `Record<string, PaddockDef>` / `Record<string, FacilityDef>`, so no call site changes.
  `buildLot(ctx, userId, kind)` keeps its signature and starts throwing `UnknownKindError`
  for a prototype key instead of failing by database accident.

**Why this is Task 0 and not a handler check.** `/build` cannot reach a prototype key — its
`kind` comes from `addChoices` — but a select menu value can, and this plan adds the first
one. Nine raw index sites exist across `src/`, and `upgradeCostFor` does
`PADDOCKS[kind].buildCost` with no guard at all. Fixing the tables fixes all nine at once.

- [ ] **Step 1: Write the failing tests**

Add to `tests/data.test.ts`, beside the existing `PADDOCKS values match the spec` case:

```ts
  // A select menu value reaches these tables as a raw string. On a plain object literal
  // PADDOCKS['constructor'] resolves up the prototype chain to Object and reads back
  // truthy, which is exactly what buildLot's `!paddock && !facility` check failed to catch.
  it.each(['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'])(
    'reads the prototype key %s back as undefined on both lot tables', (key) => {
      expect(PADDOCKS[key]).toBeUndefined();
      expect(FACILITIES[key]).toBeUndefined();
    });
```

Add to `tests/park.test.ts`, inside the existing `describe('buildLot', ...)` block (if the
file has no such block, put it immediately above `describe('upgradeLot service', ...)`):

```ts
  it('rejects a prototype key outright rather than relying on a NOT NULL accident', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 10_000_000 }).run();
    expect(() => buildLot(ctx, 'u1', 'constructor')).toThrow(UnknownKindError);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/data.test.ts -t "prototype key"`

Expected: FAIL — `PADDOCKS['constructor']` is `Object`, not `undefined`.

Run: `npx vitest run tests/park.test.ts -t "rejects a prototype key"`

Expected: FAIL — `buildLot` throws `SqliteError: NOT NULL constraint failed: users.cash`
(the `NaN` cost binding as `NULL`), not `UnknownKindError`. **That failure message is the
point of this task**: the write is being stopped by the schema, not by validation.

- [ ] **Step 3: Give both tables a null prototype**

`src/data/paddocks.ts` in full:

```ts
import type { PaddockDef } from './types.js';

// Null prototype, not a plain object literal: a client-supplied kind reaches this table
// through the Lots tab's Build select, and on a normal literal PADDOCKS['constructor']
// resolves up the chain to Object and reads back truthy. Nine raw index sites exist across
// src/; this kills the class at every one of them, and turns upgradeCostFor's silent NaN
// (`PADDOCKS[kind].buildCost` on a prototype key) into a loud TypeError at the read.
// The `as` and the `satisfies` are both required: Object.create(null) is `any`, so a bare
// Object.assign(Object.create(null), {...}) returns `any` and the literal silently loses
// its PaddockDef check — a typo in a buildCost would stop being a type error.
export const PADDOCKS: Record<string, PaddockDef> = Object.assign(
  Object.create(null) as Record<string, PaddockDef>,
  {
    herbivore_paddock: { kind: 'herbivore_paddock', name: 'Herbivore Paddock', diet: 'herbivore', buildCost: 2_000 },
    carnivore_paddock: { kind: 'carnivore_paddock', name: 'Carnivore Paddock', diet: 'carnivore', buildCost: 2_000 },
  } satisfies Record<string, PaddockDef>,
);
```

`src/data/facilities.ts` in full — the existing comments inside `hatchery_lab` are kept
verbatim, only the wrapper changes:

```ts
import type { FacilityDef } from './types.js';

// See src/data/paddocks.ts for why this is a null-prototype map and why the `as` and the
// `satisfies` are both load-bearing.
export const FACILITIES: Record<string, FacilityDef> = Object.assign(
  Object.create(null) as Record<string, FacilityDef>,
  {
    visitor_center: {
      kind: 'visitor_center', name: 'Visitor Center', maxLevel: 5,
      incomeBonusPct: [0, 5, 10, 15, 20],
      capHours: [8, 12, 16, 20, 24],
      buildCost: 5_000, upgradeCosts: [12_500, 31_000, 78_000, 500_000],
    },
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
    food_court: {
      kind: 'food_court', name: 'Food Court', maxLevel: 3,
      incomeBonusPct: [4, 8, 12],
      buildCost: 8_000, upgradeCosts: [20_000, 200_000],
    },
    gene_lab: {
      kind: 'gene_lab', name: 'Gene Lab', maxLevel: 3,
      incomeBonusPct: [0, 0, 0],
      breedingSlots: [1, 2, 3],
      buildCost: 20_000, upgradeCosts: [60_000, 250_000],
    },
  } satisfies Record<string, FacilityDef>,
);
```

**Do not** convert either table to a `Map`, and do not add a lookup helper. Every existing
read is dot-access or `Object.keys` / `Object.values` / `Object.entries`, all of which ignore
the prototype and all of which keep working unchanged.

- [ ] **Step 4: Give `buildLot` its own explicit check**

In `src/modules/park/service.ts`, replace the opening two lines of `buildLot`:

```ts
export function buildLot(ctx: Ctx, userId: string, kind: string): Lot {
  // Explicit, even though Task 0a's null-prototype tables already make the old
  // `!paddock && !facility` test sound: CLAUDE.md's rule is that boundaries get
  // validation, and a reader arriving here should see why this is safe without first
  // having to know how the table was constructed.
  if (!Object.hasOwn(PADDOCKS, kind) && !Object.hasOwn(FACILITIES, kind)) throw new UnknownKindError(kind);
  const paddock = PADDOCKS[kind]; const facility = FACILITIES[kind];
```

The old `if (!paddock && !facility) throw new UnknownKindError(kind);` line is deleted — the
new check replaces it and runs one line earlier.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/data.test.ts tests/park.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS, no other file affected. Nothing in `src/`, `tests/` or
`scripts/` uses `for…in` over either table, spreads one, or compares a whole table with
`toEqual`/`toStrictEqual`, so the prototype change is invisible to every existing assertion.

Run: `npm run typecheck` — Expected: exit 0. If the literal's fields stop being checked,
the `satisfies` clause was dropped; add it back rather than annotating the inner object.

- [ ] **Step 7: Commit**

```bash
git add src/data/paddocks.ts src/data/facilities.ts src/modules/park/service.ts tests/data.test.ts tests/park.test.ts
git commit -m "Close the prototype-key hole in the lot tables

PADDOCKS['constructor'] resolved up the chain to Object and read back
truthy, so buildLot's !paddock && !facility test did not fire. The write
survived only because the resulting NaN cost bound as NULL against
users.cash NOT NULL — a schema accident, not validation. /build could not
reach it because its kind comes from addChoices; a select menu value can.

Null prototypes fix all nine raw index sites at once and turn
upgradeCostFor's silent NaN into a TypeError at the read. buildLot keeps
an explicit Object.hasOwn check of its own so the guarantee is visible at
the boundary rather than inferred from the table's construction."
```

---

### Task 0b: `upgradeLot` takes the staleness anchor as a required parameter

**Files:**
- Modify: `src/modules/park/service.ts`, `src/modules/park/index.ts`
- Test: `tests/park.test.ts`, `tests/stats-sites.test.ts`

**Interfaces:**
- Consumes: Task 0a (same file, no coupling).
- Produces:
  - `export class StaleLevelError extends Error` with public readonly `expected` and `actual`.
  - `upgradeLot(ctx: Ctx, userId: string, lotId: number, expectedLevel: number): Lot` —
    **four** arguments. Task 2's confirm handler passes the client-supplied anchor to it.

**Why a required parameter and not a handler check.** `park:landmark:buy` shipped with the
rung missing from its customId and a handler that re-derived `current + 1` on every click:
four clicks of one button charged 32x its own label. A handler check is one forgotten line
away from repeating that. A required parameter makes forgetting it a typecheck failure.
This is the same rule that makes `hungerAt(…, drainMs)`, `feedCostFor(now)` and
`energyCostFor(now)` required rather than defaulted.

- [ ] **Step 1: Write the failing test**

Add to `tests/park.test.ts` inside `describe('upgradeLot service', ...)`:

```ts
  it('throws StaleLevelError when the anchor no longer matches the row, and charges nothing', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 10_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    ctx.db.update(schema.lots).set({ level: 2 }).where(eq(schema.lots.id, lot.id)).run();
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    // Anchor 1 against a row now at level 2 — the stale-menu case, and the shape the 90x
    // overcharge took: a label frozen at level 1 against a level-2 price.
    expect(() => upgradeLot(ctx, 'u1', lot.id, 1)).toThrow(StaleLevelError);
    // Cash as well as level: the level assertion alone still passes if the charge went
    // through and only the UPDATE failed.
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(2);
  });

  it('checks not-found before stale, so an unknown id is never reported as stale', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    // -1 is the sentinel /upgrade passes when its own hoisted read found nothing. The
    // guard order is what makes that sentinel safe: it must never reach the stale check.
    expect(() => upgradeLot(ctx, 'u1', 9999, -1)).toThrow(UnknownKindError);
  });
```

Import `StaleLevelError` from `../src/modules/park/service.js` at the top of the file,
alongside the existing `LotLimitError` / `UnknownKindError` imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park.test.ts -t "StaleLevelError"`

Expected: FAIL to compile/import — `StaleLevelError` is not exported.

- [ ] **Step 3: Add the error class and the parameter**

In `src/modules/park/service.ts`, beside the existing error classes (`LotLimitError`,
`UnknownKindError`, `DuplicateFacilityError` at `:14-18`):

```ts
/**
 * Thrown when a caller's `expectedLevel` no longer matches the stored row — a menu option
 * or button minted at one level being redeemed against another. Carries both levels so the
 * handler can name them without a second read.
 */
export class StaleLevelError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`expected level ${expected}, found ${actual}`);
  }
}
```

Then the signature and the new guard:

```ts
/**
 * `expectedLevel` is REQUIRED, never optional — the same rule as hungerAt(…, drainMs),
 * feedCostFor(now) and energyCostFor(now). A default would let a call site silently charge
 * whatever the current level costs against a price the player read at an older one, which
 * is the park:landmark:buy incident. upgradeCostFor is a pure function of (kind, level) and
 * paddock cost is buildCost * 2.5 ** level, so a stale anchor charges the NEXT rung's
 * price: measured worst case is a hatchery_lab label reading 25,000 against a charge of
 * 2,250,000, 90x.
 *
 * Callers must pass the CLIENT-SUPPLIED anchor, never a level they just read from the
 * database — see the note at the /upgrade call site for the one legitimate exception.
 *
 * Guard order is load-bearing: not-found BEFORE stale, so /upgrade's `lotRow?.level ?? -1`
 * sentinel still maps to 'No such lot.' for an unknown id; and stale BEFORE maxLevel, so a
 * stale anchor on a now-maxed lot reports staleness rather than "Already max level", which
 * would name the wrong problem.
 */
export function upgradeLot(ctx: Ctx, userId: string, lotId: number, expectedLevel: number): Lot {
  const lot = ctx.db.select().from(schema.lots)
    .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, userId))).get();
  if (!lot) throw new UnknownKindError(String(lotId));
  if (lot.level !== expectedLevel) throw new StaleLevelError(expectedLevel, lot.level);
  const def = FACILITIES[lot.kind];
  const maxLevel = def ? def.maxLevel : 4;                       // paddock max level 4 (capacity 8)
  if (lot.level >= maxLevel) throw new LotLimitError();
```

The rest of the function is unchanged.

- [ ] **Step 4: Update every existing call site**

There are seven, and each takes a **specific** anchor. Copy these verbatim; do not pass
`lot.level` uniformly, and read the comment on the second one before touching it.

```ts
// src/modules/park/index.ts:262 — /upgrade. The one legitimate place to pass a
// freshly-read level: this command quotes no frozen label, so there is no client anchor to
// carry. The `?? -1` sentinel is only reached when the hoisted read found nothing, in which
// case upgradeLot's own read also finds nothing and UnknownKindError fires first.
          const lot = upgradeLot(ctx, i.user.id, lotId, lotRow?.level ?? -1);

// tests/park.test.ts:660
    const upgraded = upgradeLot(ctx, 'u1', lot.id, lot.level);

// tests/park.test.ts:669 — 4, NOT lot.level. The row was forced to level 4 two lines above
// while `lot` is still the level-1 row buildLot returned, so passing the stale local would
// throw StaleLevelError and this case would stop covering the max-level guard at all.
    expect(() => upgradeLot(ctx, 'u1', lot.id, 4)).toThrow(LotLimitError);

// tests/park.test.ts:670 — any anchor; the not-found check runs first.
    expect(() => upgradeLot(ctx, 'u1', 9999, 1)).toThrow(UnknownKindError);

// tests/park.test.ts:677
    expect(() => upgradeLot(ctx, 'u1', lot.id, lot.level)).toThrow(InsufficientFundsError);

// tests/park.test.ts:702
    upgradeLot(ctx, 'u1', lot.id, 1);

// tests/stats-sites.test.ts:121
    upgradeLot(ctx, 'u1', lot.id, lot.level);
```

- [ ] **Step 5: Map the new error at the `/upgrade` call site**

In `src/modules/park/index.ts`, add an arm to `/upgrade`'s catch chain before the final
`else throw e`:

```ts
          else if (e instanceof StaleLevelError) await i.reply({
            // Unreachable today — the hoisted read and upgradeLot's own read happen in the
            // same tick with no write between them — but `else throw e` on a spend path is
            // not where anyone wants to discover otherwise.
            content: 'That lot changed — run `/upgrade` again for the current price.',
            flags: MessageFlags.Ephemeral,
          });
```

Add `StaleLevelError` to the existing `./service.js` import list at the top of the file.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/park.test.ts tests/stats-sites.test.ts`

Expected: PASS. If `tests/park.test.ts:669` fails with `StaleLevelError` where it expects
`LotLimitError`, the anchor there was set to `lot.level` instead of `4` — see Step 4.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS.

Run: `npm run typecheck` — Expected: exit 0. A remaining three-argument call anywhere is a
compile error, which is the entire point of the parameter being required; fix the call site
rather than defaulting the parameter.

- [ ] **Step 8: Commit**

```bash
git add src/modules/park/service.ts src/modules/park/index.ts tests/park.test.ts tests/stats-sites.test.ts
git commit -m "Require an expected level on every upgradeLot call

upgradeCostFor is a pure function of (kind, level) and paddock cost is
buildCost * 2.5 ** level, so a control minted at one level and redeemed at
another charges the next rung's price. Measured worst case is a
hatchery_lab label reading 25,000 against a charge of 2,250,000 — 90x,
against the park:landmark:buy incident's 32x.

The anchor is a required fourth parameter rather than a check in the one
handler that needs it, so omitting it is a typecheck failure rather than
an overcharge. Guard order is not-found, then stale, then max level:
/upgrade's -1 sentinel still reports 'No such lot.' for an unknown id, and
a stale anchor on a maxed lot reports staleness rather than naming the
wrong problem."
```

---

### Task 1: Build menu and its confirm step

**Files:**
- Modify: `src/modules/park/embeds.ts` (`lotsPayload`, `confirmPayload`), `src/modules/park/index.ts`
- Test: `tests/lot-menus.test.ts` (create), `tests/visit.test.ts` (extend one case)
- Do NOT modify: `tests/park-tabs.test.ts` — see Step 7

**Interfaces:**
- Consumes: `lotsPayload` (PR 1), `submittedValuesAreOnMessage` (PR 2), `SelectDef` (PR 2).
- Produces:
  - `lotsPayload` gains `opts.buildable?: Array<{ kind: string; name: string; cost: number }>` and mints `park:build:<uid>` when it is non-empty.
  - `export function confirmPayload(user: User, question: string, yesId: string, noId: string, yesLabel: string)` in `embeds.ts`.
  - Handlers for the `park` select prefix and for `park:buildyes:<uid>:<kind>` / `park:buildno:<uid>`.

- [ ] **Step 1: Write the failing test**

Create `tests/lot-menus.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeButton, fakeSelect } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { parkModule } from '../src/modules/park/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

const parkComp = () => parkModule.components.find((c) => c.prefix === 'park')!;
const parkSelect = () => parkModule.selects!.find((s) => s.prefix === 'park')!;
const cashOf = (id: string) =>
  ctx.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;

describe('build menu', () => {
  it('asks for confirmation rather than spending on the selection itself', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1',
      values: ['carnivore_paddock'], options: ['carnivore_paddock'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    const json = JSON.stringify(s.replies[0]);
    expect(json).toContain('park:buildyes:u1:carnivore_paddock');
    expect(json).toContain('park:buildno:u1');
    // Without these three the confirm can ship with no tab row, no attachments: [] and
    // no content, and every other assertion in this file still passes. The tab row keeps
    // the player from being one click from losing navigation mid-purchase; attachments: []
    // sheds the Lots tab's banners/lots.webp, which would otherwise strand as an orphan
    // attachment card; content: '' clears any result line left over from a previous action.
    expect(json).toContain('park:tab:u1:park');
    expect((s.replies[0] as { attachments?: unknown[] }).attachments).toEqual([]);
    expect((s.replies[0] as { content?: string }).content).toBe('');
  });

  it('builds only after the confirm click', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBeLessThan(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(1);
  });

  it('rejects a prototype key at the handler, before buildLot is reached', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const b = fakeButton({ customId: 'park:buildyes:u1:constructor', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(0);
    expect(JSON.stringify(b.replies[0])).toContain('no longer valid');
  });

  it('rejects a value the minted menu never offered', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1',
      values: ['gene_lab'], options: ['carnivore_paddock'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(s.deferOpts).toEqual([{ kind: 'update' }]);
    expect(s.replies).toEqual([]);
  });

  it('refuses a stranger driving the menu', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u2', values: ['gene_lab'], options: ['gene_lab'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(JSON.stringify(s.replies[0])).toContain('Not your park');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lot-menus.test.ts -t "build menu"`

Expected: FAIL — `parkModule.selects` is `undefined`.

- [ ] **Step 3: Mint the menu on the Lots tab**

In `src/modules/park/embeds.ts`, extend `lotsPayload`'s options and add the menu. Import `StringSelectMenuBuilder` and `StringSelectMenuOptionBuilder` from `discord.js`.

```ts
export function lotsPayload(
  user: User, lots: Lot[], slots: number,
  opts: { visit?: boolean; buildable?: Array<{ kind: string; name: string; cost: number }> } = {},
) {
```

Replace the `Building` hint field and the components array with:

```ts
  const components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  const buildable = opts.buildable ?? [];
  if (!opts.visit && buildable.length > 0) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`park:build:${user.discordId}`)
        .setPlaceholder('Build…')
        // Discord caps a select at 25 options. Six kinds exist today; the slice is
        // insurance against a future catalog, not a live constraint.
        .addOptions(buildable.slice(0, 25).map((b) => new StringSelectMenuOptionBuilder()
          // The value is the KIND alone — an identity, never a price. Cost is re-derived
          // by buildLot at execution; this label is a display copy nothing reads back.
          .setValue(b.kind)
          .setLabel(`${b.name} — ${b.cost.toLocaleString('en-US')} cash`))),
    ));
  }
  components.push(tabRow(user.discordId, 'lots', opts.visit));
```

and set `{ embeds: [embed], components }` on the payload. Keep the `Building` hint field only when `buildable.length === 0 && !opts.visit`, with the text `'No room for another lot — raise your park rating for more slots.'`

**Widen the payload's declared type in the same edit.** `lotsPayload`'s local currently reads
`components: ActionRowBuilder<ButtonBuilder>[]` (`src/modules/park/embeds.ts:163`), which no
longer describes what this builds:

```ts
  const payload: {
    embeds: EmbedBuilder[];
    components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>;
    files?: AttachmentBuilder[];
  } = { embeds: [embed], components };
```

Do not resolve this with a cast. `renderTab` does `built.components.push(tourRow)` on the
returned object, so a cast here moves the error to a call site that has no way to fix it.

- [ ] **Step 4: Add the confirm payload builder**

In `src/modules/park/embeds.ts`:

```ts
/**
 * A yes/no confirm rendered onto the card the player is already standing on, rather than
 * an ephemeral follow-up: the Lots tab must not be left displaying a state it is about to
 * change, and an ephemeral would accumulate one message per attempt.
 *
 * The thing being bought rides in `yesId`, never in this builder — see the
 * park:landmark:buy incident. This builder only renders what it is handed.
 */
export function confirmPayload(user: User, question: string, yesId: string, noId: string, yesLabel: string) {
  const embed = new EmbedBuilder()
    .setTitle(`🏗️ ${user.parkName} — Confirm`)
    .setColor(0xc9a227)
    .setDescription(question)
    .addFields({ name: `${emojiTag('dw_cash')} Your cash`, value: user.cash.toLocaleString(), inline: true });
  return {
    // content: '' for the same reason every renderTab branch sets it — discord.js drops an
    // OMITTED content key from the request body and Discord then leaves the message's
    // existing content unchanged, so a previous result line ("Built Gene Lab (lot #4).")
    // would sit pinned above a spend that has not happened yet.
    content: '',
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(yesId).setLabel(yesLabel).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(noId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
      // The tab row is RETAINED. A player mid-confirm must never be one click from losing
      // navigation — the same reason routed surfaces reply ephemerally instead of updating
      // the tab card away. Never `visit`: menus are suppressed on a visited card, so this
      // builder is only ever reached by the owner.
      tabRow(user.discordId, 'lots'),
    ],
    // REQUIRED, not redundant: the Lots tab this update replaces attaches
    // banners/lots.webp, and a payload carrying neither `files` nor an explicit
    // `attachments` leaves that upload behind as an orphan attachment card.
    attachments: [],
  };
}
```

- [ ] **Step 5: Add the select handler and the confirm buttons**

In `src/modules/park/index.ts`, pass `buildable` wherever `lotsPayload` is called (in `renderTab`):

```ts
  if (tab === 'lots') {
    const owned = new Set(lots.map((l) => l.kind));
    const full = lots.length >= lotSlots(user.ratingHighWater);
    // Facilities are one per park; paddocks are duplicable — building more of one kind IS
    // the capacity progression. Filtering here keeps the menu honest, but it is NOT the
    // guard: buildLot re-checks both, and a stale menu is rejected there.
    const buildable = full ? [] : [
      ...Object.entries(PADDOCKS).map(([kind, d]) => ({ kind, name: d.name, cost: d.buildCost })),
      ...Object.entries(FACILITIES)
        .filter(([kind]) => !owned.has(kind))
        .map(([kind, d]) => ({ kind, name: d.name, cost: d.buildCost })),
    ];
    // ADDITIVE edit. This branch already exists at src/modules/park/index.ts:784-789 —
    // add the two locals above and thread `buildable` into the existing call. Do NOT
    // paste this block over the live one: `content: content ?? ''` and the tourRow push
    // must both survive verbatim.
    //   content — the build/upgrade result line the confirm handlers pass. An OMITTED key
    //   leaves the message's previous content pinned; see renderTab's own doc comment.
    //   tourRow — re-minted per branch because each tab builder returns a fresh components
    //   array. Dropping it dead-ends a visitor's park tour on this tab.
    const built = lotsPayload(user, lots, lotSlots(user.ratingHighWater), { visit, buildable });
    if (tourRow) built.components.push(tourRow);
    await i.update({ content: content ?? '', ...built, attachments: [] });
    return;
  }
```

Add the `selects` array to `parkModule`, beside `components`:

```ts
  selects: [
    {
      prefix: 'park',
      async execute(ctx, i) {
        const [, action, uid] = i.customId.split(':');
        if (i.user.id !== uid) {
          await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
          return;
        }
        // The router already proved the bot minted THIS MENU on THIS MESSAGE. It proved
        // nothing about the submitted values, which arrive on a separate client-supplied
        // channel — so they are checked against the message's own option list here.
        if (!submittedValuesAreOnMessage(i)) { await i.deferUpdate(); return; }
        const value = i.values[0]!;
        const user = ctx.db.select().from(schema.users)
          .where(eq(schema.users.discordId, i.user.id)).get()!;
        if (action === 'build') {
          // Defence in depth over Task 0a, which is what actually closed this: the tables
          // are null-prototype now and buildLot owns an Object.hasOwn check of its own.
          // This copy earns its place because 90 of 101 fakeButton sites and every case in
          // scripts/test-live.ts call execute directly rather than through routeInteraction,
          // so a handler-level check is what those paths exercise.
          if (!Object.hasOwn(PADDOCKS, value) && !Object.hasOwn(FACILITIES, value)) {
            await i.deferUpdate();
            return;
          }
          const def = PADDOCKS[value] ?? FACILITIES[value]!;
          await i.update(confirmPayload(
            user,
            `Build **${def.name}** for **${def.buildCost.toLocaleString('en-US')}** cash?`,
            `park:buildyes:${i.user.id}:${value}`, `park:buildno:${i.user.id}`,
            `Build ${def.name}`,
          ));
          return;
        }
        await i.deferUpdate();
      },
    },
  ],
```

Add to the component `switch (action)`:

```ts
          case 'buildno':
          case 'upgno': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            await renderTab(ctx, i, i.user.id, 'lots', false);
            return;
          }
          case 'buildyes': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            const kind = parts[3] ?? '';
            // Re-validated here and not merely at the menu: another open message may still
            // hold a stale confirm button, and the customId is client-supplied regardless.
            if (!Object.hasOwn(PADDOCKS, kind) && !Object.hasOwn(FACILITIES, kind)) {
              await i.reply({
                content: 'That build button is no longer valid — open `/park view` again.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            try {
              const lot = buildLot(ctx, i.user.id, kind);
              await renderTab(ctx, i, i.user.id, 'lots', false, `🏗️ Built **${lot.name}** (lot #${lot.id}).`);
            } catch (e) {
              // Mapped for the BUILD menu specifically: LotLimitError means "slot cap" here
              // and "already max level" in upgradeLot, and UnknownKindError is likewise
              // overloaded. Reusing /upgrade's mapping would tell a player "already max
              // level" when they meant "all lots full".
              if (e instanceof DuplicateFacilityError) {
                await i.reply({ content: `You already have a ${e.message} — upgrade it instead.`, flags: MessageFlags.Ephemeral });
              } else if (e instanceof LotLimitError) {
                await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
              } else if (e instanceof InsufficientFundsError) {
                const def = PADDOCKS[kind] ?? FACILITIES[kind]!;
                await i.reply({
                  content: `Not enough cash — ${def.name} costs ${def.buildCost.toLocaleString('en-US')}.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else throw e;
            }
            return;
          }
```

Add imports to `src/modules/park/index.ts`:

```ts
import { submittedValuesAreOnMessage } from '../../core/components.js';
import { confirmPayload } from './embeds.js';
```

`PADDOCKS`, `FACILITIES`, `buildLot`, `DuplicateFacilityError`, `LotLimitError` and `InsufficientFundsError` are already imported. **Task 0b adds `StaleLevelError` to that same `./service.js` import** — Task 2 needs it.

The handler's fresh-read pre-check and `upgradeLot`'s `StaleLevelError` are two layers over the **same** client-supplied value. Passing anything the handler just read from the database instead of that value collapses them into one.

- [ ] **Step 6: Widen the tour-row regression test to cover every tab**

`tests/visit.test.ts:186` is the only test pinning that a park tour survives a tab switch,
and it clicks the **Animals** tab only — so the loss described in Step 5 is currently
invisible. Replace that case with a loop:

```ts
  it('keeps the Next park button after switching tabs, not just on the initial park:tour render', async () => {
    player('a', 300); player('b', 200);
    // Every tab, not just Animals: each of the four builders returns a fresh components
    // array, so the tourRow push is per-branch and any one branch can lose it on its own.
    for (const tab of ['park', 'animals', 'lots', 'prestige'] as const) {
      const i = await click(`park:vtab:a:${tab}`);
      expect(JSON.stringify(i.replies[0]), tab).toContain('park:tour:b');
    }
  });
```

Run: `npx vitest run tests/visit.test.ts -t "Next park"`

Expected: PASS both before and after Step 5, **provided** Step 5 was applied additively. If
it fails on the `lots` iteration, the branch lost its tourRow push.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/lot-menus.test.ts -t "build menu"`

Expected: PASS, five cases.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS.

**`tests/park-tabs.test.ts:331-350` (`'clears the feed-all result line on the next tab switch'`) must NOT be edited.** It loops all four tabs asserting `content` is `''`. If it fails on the `lots` iteration, the Step 5 branch was pasted over the live one and lost `content: content ?? ''` — fix the branch, not the test. The same applies to that file's visited-lots cases: if one fails, check the branch before touching the assertion.

Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/modules/park/embeds.ts src/modules/park/index.ts tests/lot-menus.test.ts tests/visit.test.ts
git commit -m "Add the Lots tab build menu behind a confirm

The option value is the kind alone — an identity, never a price — and cost is
re-derived by buildLot at execution. The handler keeps its own Object.hasOwn
allowlist as defence in depth over the null-prototype tables, because 90 of
101 fakeButton sites and every test-live case call execute directly rather
than through routeInteraction.

The confirm renders onto the card in place, retaining the tab row so a player
mid-purchase is never one click from losing navigation, and carrying an
explicit attachments: [] to shed the Lots banner it no longer references.

The tour-row regression test now loops all four tabs instead of naming
Animals alone — the tourRow push is per-branch, so any one branch can lose it
without the old single-tab test noticing."
```

---

### Task 2: Upgrade menu with a staleness anchor

**Files:**
- Modify: `src/modules/park/embeds.ts`, `src/modules/park/index.ts`
- Test: `tests/lot-menus.test.ts`

**Depends on Task 0b.** `upgradeLot` takes four arguments by the time this task runs.

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `lotsPayload` gains `opts.upgradable?: Array<{ lotId: number; name: string; level: number; cost: number }>`, minting `park:upgrade:<uid>` whose option values are `<lotId>:<expectedLevel>`. Handlers for `park:upgyes:<uid>:<lotId>:<expectedLevel>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('upgrade menu', () => {
  const seedLot = (level: number) => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 100_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    return ctx.db.insert(schema.lots).values({
      userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level,
    }).returning().get();
  };

  it('carries the level it was minted for in the option value', async () => {
    const lot = seedLot(1);
    const s = fakeSelect({
      customId: 'park:upgrade:u1', user: 'u1',
      values: [`${lot.id}:1`], options: [`${lot.id}:1`],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(JSON.stringify(s.replies[0])).toContain(`park:upgyes:u1:${lot.id}:1`);
  });

  it('upgrades once when the level still matches', async () => {
    const lot = seedLot(1);
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const after = ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!;
    expect(after.level).toBe(2);
  });

  // The park:landmark:buy incident, in its new home. Worst measured case is 90x.
  it('refuses a stale button and charges nothing', async () => {
    const lot = seedLot(1);
    const first = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, first.asInteraction() as never);
    const afterFirst = cashOf('u1');
    // The same button clicked again: its label still says level 1 to 2, but the lot is
    // level 2 now and upgradeCostFor would charge the level-2 price.
    const second = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, second.asInteraction() as never);
    expect(cashOf('u1')).toBe(afterFirst);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(2);
    // Pins the FIGURES, not a loose phrase. 'no longer' appears only on the non-integer
    // branch and in the build handler, so asserting it here goes red against a CORRECT
    // implementation — and the two obvious repairs are both wrong: loosening the
    // assertion is this repo's recurring substring trap, and rewriting the handler to
    // say 'no longer' drops the two levels, which are the only part telling the player
    // what actually changed.
    expect(JSON.stringify(second.replies[0])).toContain('is level 2 now, not 1');
  });

  it('refuses a forged lot id belonging to someone else', async () => {
    seedLot(1);
    getOrCreateUser(ctx, 'u2', 'Other');
    const theirs = ctx.db.insert(schema.lots).values({
      userId: 'u2', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
    }).returning().get();
    const b = fakeButton({ customId: `park:upgyes:u1:${theirs.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, theirs.id)).get()!.level).toBe(1);
    // Positive assertions, without which this case CANNOT FAIL under any implementation:
    // today `park:upgyes:*` falls to index.ts:635's `default: await i.deferUpdate()`,
    // which writes nothing, and afterwards upgradeLot is itself scoped by userId. The
    // state assertion above is satisfied twice over either way.
    expect(JSON.stringify(b.replies[0])).toContain('No such lot');
    expect(b.deferOpts).toEqual([]);
  });

  it('refuses a non-integer level anchor without touching the database', async () => {
    const lot = seedLot(1);
    const before = cashOf('u1');
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:notanumber`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(1);
    // Same reason as the forged-lot case: the state assertions above are already true
    // before this feature exists. This one also fixes which guard is under test — with
    // Number.isInteger removed, `expected` is NaN and `lot.level !== NaN` is always true,
    // so the stale check would cover it and the parse guard would go untested.
    expect(JSON.stringify(b.replies[0])).toContain('no longer valid');
    expect(b.deferOpts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lot-menus.test.ts -t "upgrade menu"`

Expected: FAIL — **all five cases**, each on its own reply assertion rather than merely on
unchanged state. **If any case passes at this point it is inert and must be fixed before
proceeding**: `park:upgyes:*` currently falls to `src/modules/park/index.ts:635`'s
`default: await i.deferUpdate()`, which writes nothing, so every state-only assertion in
this block is already true against unmodified code. A red gate satisfied by three of five
cases teaches nobody that the other two never ran.

- [ ] **Step 3: Mint the upgrade menu**

In `lotsPayload`, add after the build menu:

```ts
  const upgradable = opts.upgradable ?? [];
  if (!opts.visit && upgradable.length > 0) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`park:upgrade:${user.discordId}`)
        .setPlaceholder('Upgrade…')
        .addOptions(upgradable.slice(0, 25).map((u) => new StringSelectMenuOptionBuilder()
          // <lotId>:<expectedLevel> — the level it was minted for is the staleness anchor.
          // upgradeCostFor is a pure function of (kind, level), so without it a stale
          // option silently charges the NEXT rung's price: measured worst case is a
          // hatchery_lab label reading 25,000 against a 2,250,000 charge, 90x.
          .setValue(`${u.lotId}:${u.level}`)
          .setLabel(`#${u.lotId} ${u.name} → lvl ${u.level + 1} — ${u.cost.toLocaleString('en-US')} cash`))),
    ));
  }
```

Extend the signature:

```ts
  opts: { visit?: boolean;
          buildable?: Array<{ kind: string; name: string; cost: number }>;
          upgradable?: Array<{ lotId: number; name: string; level: number; cost: number }> } = {},
```

- [ ] **Step 4: Compute `upgradable` in `renderTab`**

In the `lots` branch, beside `buildable`:

```ts
    // `?? 4` matches upgradeLot's own `const maxLevel = def ? def.maxLevel : 4` — a
    // paddock has no FACILITIES entry and caps at level 4. Keep the two in step; a menu
    // that offers a maxed lot is rejected by LotLimitError, but it is a wasted click.
    const upgradable = lots
      .filter((l) => l.level < (FACILITIES[l.kind]?.maxLevel ?? 4))
      .map((l) => ({ lotId: l.id, name: l.name, level: l.level, cost: upgradeCostFor(l.kind, l.level) }));
```

and thread it into the SAME call Task 1 Step 5 edited — this branch stays additive, so
`content: content ?? ''` and the tourRow push are still untouched:

```ts
    const built = lotsPayload(user, lots, lotSlots(user.ratingHighWater), { visit, buildable, upgradable });
    if (tourRow) built.components.push(tourRow);
    await i.update({ content: content ?? '', ...built, attachments: [] });
```

- [ ] **Step 5: Handle the upgrade selection and its confirm**

In the select handler, before the trailing `deferUpdate`:

```ts
        if (action === 'upgrade') {
          const [lotStr, levelStr] = value.split(':');
          const lotId = Number(lotStr); const expected = Number(levelStr);
          if (!Number.isInteger(lotId) || !Number.isInteger(expected)) { await i.deferUpdate(); return; }
          const lot = ctx.db.select().from(schema.lots)
            .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
          if (!lot || lot.level !== expected) {
            await i.reply({
              content: 'That lot changed — open `/park view` again for current prices.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await i.update(confirmPayload(
            user,
            `Upgrade **${lot.name}** to level ${lot.level + 1} for **${upgradeCostFor(lot.kind, lot.level).toLocaleString('en-US')}** cash?`,
            `park:upgyes:${i.user.id}:${lotId}:${expected}`, `park:upgno:${i.user.id}`,
            `Upgrade to lvl ${lot.level + 1}`,
          ));
          return;
        }
```

In the component `switch (action)`:

```ts
          case 'upgyes': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            // park:upgyes:<uid>:<lotId>:<expectedLevel> — both client-supplied. Parsed as
            // integers first, then checked against a FRESH read, in that order, before any
            // write. This is the guard, not the confirm click: another open message may
            // still hold a stale button for the same lot.
            const lotId = Number(parts[3]); const expected = Number(parts[4]);
            if (!Number.isInteger(lotId) || !Number.isInteger(expected)) {
              await i.reply({ content: 'That upgrade button is no longer valid — open `/park view` again.', flags: MessageFlags.Ephemeral });
              return;
            }
            const lot = ctx.db.select().from(schema.lots)
              .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
            if (!lot || lot.level !== expected) {
              await i.reply({
                content: lot
                  ? `That lot is level ${lot.level} now, not ${expected} — open \`/park view\` again for the current price.`
                  : 'No such lot.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            try {
              // `expected` is the CLIENT-SUPPLIED anchor parsed out of the customId, never
              // `lot.level` from the fresh read above. Passing the fresh read would make
              // upgradeLot compare a value against itself, so its StaleLevelError could
              // never fire — two layers over ONE anchor, not one layer applied twice.
              const upgraded = upgradeLot(ctx, i.user.id, lotId, expected);
              await renderTab(ctx, i, i.user.id, 'lots', false, `⬆️ **${upgraded.name}** is now level ${upgraded.level}.`);
            } catch (e) {
              // Mapped for the UPGRADE menu: LotLimitError means "already max level" here,
              // where the build handler reads the same class as "slot cap".
              if (e instanceof LotLimitError) {
                await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });
              } else if (e instanceof UnknownKindError) {
                await i.reply({ content: 'No such lot.', flags: MessageFlags.Ephemeral });
              } else if (e instanceof StaleLevelError) {
                // Unreachable while the pre-check above stands, and kept anyway: without
                // it, relaxing that pre-check turns a price change into the router's
                // generic error. e.actual/e.expected save a second read.
                await i.reply({
                  content: `That lot is level ${e.actual} now, not ${e.expected} — open \`/park view\` again for the current price.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else if (e instanceof InsufficientFundsError) {
                await i.reply({
                  content: `Not enough cash — that upgrade costs ${upgradeCostFor(lot.kind, lot.level).toLocaleString('en-US')}.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else throw e;
            }
            return;
          }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/lot-menus.test.ts -t "upgrade menu"`

Expected: PASS, five cases.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/park/embeds.ts src/modules/park/index.ts tests/lot-menus.test.ts
git commit -m "Add the Lots tab upgrade menu with a level anchor

The option value carries <lotId>:<expectedLevel> and the handler rejects a
mismatch against a fresh read before any write. upgradeCostFor is a pure
function of (kind, level) and paddock cost is geometric, so without the anchor
a stale option charges the next rung's price — measured worst case is a
hatchery_lab label reading 25,000 against a 2,250,000 charge. Error mapping is
per-menu: LotLimitError means slot cap for build and max level for upgrade."
```

---

### Task 3: Extend the real-payload sweep to select menus

**Files:**
- Modify: `tests/router.test.ts`

**Interfaces:**
- Consumes: the Lots tab's two menus (Tasks 1–2), `fakeSelect` (PR 2).
- Produces: the sweep covers type-3 components, not just type-2.

- [ ] **Step 1: Write the failing test**

The existing sweep walks `custom_id` type-agnostically but replays every harvested id through `fakeButton`, so a select is exercised as a button. Replace `idsOf` with a shape that records the component type, and replay accordingly.

**`idsOf` is deleted, not kept alongside.** It has exactly 14 references — its declaration at `:527` and 13 call sites, every one of them inside `surfaces` — and all 13 convert in this task, so leaving it behind is dead code. `noUnusedLocals` is not set in either tsconfig, so nothing will tell you.

`SelectDef` and `fakeSelect` are already imported in this file (`:7`, `:8`); no import changes are needed.

```ts
  const componentsOf = (rows: ReadonlyArray<{ toJSON(): unknown }> = []) =>
    rows.flatMap((r) => ((r.toJSON() as {
      components?: Array<{ custom_id?: string; type?: number; options?: Array<{ value: string }> }>;
    }).components ?? [])
      .filter((c): c is { custom_id: string; type?: number; options?: Array<{ value: string }> } =>
        typeof c.custom_id === 'string'));
```

**REPLACE the existing Lots-tab entry at `tests/router.test.ts:558`** — do not add a
standalone local beside it. The live entry is:

```ts
      ['/park view Lots tab', idsOf(lotsPayload(user, [], 3).components)],
```

It passes no `buildable`, so under Task 1's `if (!opts.visit && buildable.length > 0)` guard
it mints **no select at all**. The replay loop iterates `surfaces` and nothing else, so a
select-bearing local declared next to it is never dispatched: every component stays type 2,
`routeInteraction`'s `isStringSelectMenu` branch is never entered, neither select guard runs,
and an anti-vacuity assertion written against that local passes while the sweep it guards
stays vacuous. Per `CLAUDE.md` this sweep is the **only** router-level evidence the select
guards work at all — 90 of 101 `fakeButton` sites call `execute` directly and `test:live`
bypasses the router by design — so a vacuous pass here leaves the feature untested end to end.

The replacement, carrying both menus so `park:upgrade:<uid>` is exercised too — the one id in
this PR whose payload runs past the owner segment:

```ts
      ['/park view Lots tab', componentsOf(lotsPayload(user, [], 3, {
        buildable: [{ kind: 'carnivore_paddock', name: 'Carnivore Paddock', cost: 1000 }],
        upgradable: [{ lotId: 1, name: 'Carnivore Paddock', level: 1, cost: 5000 }],
      }).components)],
```

Every **other** entry in `surfaces` converts from `idsOf` to `componentsOf` in the same edit,
and the array's annotation changes with them — the loop now destructures components, not
strings:

```ts
    const surfaces: Array<[string, Array<{ custom_id: string; type?: number; options?: Array<{ value: string }> }>]> = [
```

Then the replay loop. Note the vacuity guard moved INSIDE the loop so it covers every surface
rather than one hand-picked local, and the `deferOpts` assertion at `:567` is **kept** — it is
the only thing distinguishing a real dispatch from "the guard acknowledged it and an earlier
iteration happened to push the same id into the shared `seen` array":

```ts
    for (const [label, comps] of surfaces) {
      expect(comps.length, `${label} minted no components — the case would be vacuous`).toBeGreaterThan(0);
      const ids = comps.map((x) => x.custom_id);
      for (const c of comps) {
        const fake = c.type === 3
          ? fakeSelect({
              customId: c.custom_id, user: 'u1',
              values: [c.options![0]!.value], options: c.options!.map((o) => o.value),
              componentIds: ids,
            })
          : fakeButton({ customId: c.custom_id, user: 'u1', componentIds: ids });
        await routeInteraction(ctx, registry, fake.asInteraction());
        expect(seen, `${label}: ${c.custom_id} was rejected by the guard`).toContain(c.custom_id);
        expect(fake.deferOpts, `${label}: ${c.custom_id} was acknowledged instead of dispatched`).toHaveLength(0);
      }
    }
    // Whole-sweep guard: without a type-3 component somewhere in `surfaces`, everything above
    // proves only that the button half still works.
    expect(surfaces.flatMap(([, comps]) => comps).some((c) => c.type === 3),
      'no surface minted a select — the select half of this sweep would be vacuous').toBe(true);
```

The synthetic registry must now carry `selects` as well as `components`, or every select is dropped for want of a handler:

```ts
      components: PREFIXES.map((prefix): ComponentDef => ({
        prefix, execute: async (_c, i) => { seen.push(i.customId); },
      })),
      selects: PREFIXES.map((prefix): SelectDef => ({
        prefix, execute: async (_c, i) => { seen.push(i.customId); },
      })),
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/router.test.ts -t "every live button surface"`

Expected: FAIL before the registry gains `selects` — the select is harvested, dispatched and dropped, so `seen` never contains its id.

**If it passes here, the surface entry was added rather than replaced** and no select is
reaching the router at all. Confirm by checking that `surfaces` contains exactly one Lots
tab entry and that it passes `buildable`.

- [ ] **Step 3: Apply the changes above and re-run**

Run: `npx vitest run tests/router.test.ts`

Expected: PASS.

- [ ] **Step 4: Rename the sweep so it stops lying**

Its describe block says "every live **button** surface still routes". It now covers selects too. Rename to `router component guard — every live component surface still routes` and update the block comment's counts to say buttons *and* select menus.

- [ ] **Step 5: Commit**

```bash
git add tests/router.test.ts
git commit -m "Cover select menus in the real-payload sweep

The sweep harvested a select's custom_id but replayed it through fakeButton,
so it proved only that the guard compares two strings — the exact vacuous pass
its own header comment says it exists to prevent."
```

---

### Task 4: Drive a select in the live gallery

**Files:**
- Modify: `scripts/test-live.ts`

- [ ] **Step 1: Add the driver**

`scripts/test-live.ts` renders a select with no change to `toPost`, but its `button()` helper cannot produce one. Add beside it at `:317-321`, mirroring its exact shape — module NAME first, resolved through a `selectOf` sibling to the existing `compOf`:

```ts
const selectOf = (m: string, p: string) => mod(m).selects!.find((x) => x.prefix === p)!;
const select = async (m: string, customId: string, user: string, values: string[]) => {
  const s = fakeSelect({ customId, user, values });
  await selectOf(m, customId.split(':')[0]).execute(ctx as Ctx, s.asInteraction() as unknown as StringSelectMenuInteraction);
  return s;
};
```

Two imports come with it: `fakeSelect` from `../tests/harness.js`, beside the existing `fakeButton`; and `StringSelectMenuInteraction` added to the `import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js'` line at `:33`.

- [ ] **Step 2: Add the gallery cases**

`Case` is `interface Case { title: string; run(): Promise<Capture> }` (`:308`). Add three, beside the existing `park:tab:lots` case at `:382` — the Lots tab itself now carries both dropdowns, and each confirm state is worth a look of its own:

```ts
  { title: 'park:build select — picking Gene Lab swaps the card into its confirm state: the tab row survives, the price is re-derived by buildLot at execution, and the option value carries the kind alone', run: () => select('park', `park:build:${P1}`, P1, ['gene_lab']) },
  { title: 'park:upgrade select — the confirm names the exact rung being bought. The option value is <lotId>:<expectedLevel>, so the label and the charge cannot disagree', run: async () => {
    const lot = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, P1)).all()[0]!;
    return select('park', `park:upgrade:${P1}`, P1, [`${lot.id}:${lot.level}`]);
  } },
  { title: 'park:buildno — Cancel returns to a freshly rendered Lots tab with both dropdowns, not to a blank card', run: () => button('park', `park:buildno:${P1}`, P1) },
```

`ctx`, `schema` and `eq` are all already in scope in this file. The `park:tab:lots` case at `:382` needs no change — its title should gain a mention of the two dropdowns, since that is what a reviewer is now looking at.

- [ ] **Step 3: Note what this does and does not prove**

Add above the helper:

```ts
// This drives a select handler DIRECTLY, exactly as button() drives a component handler.
// It never calls routeInteraction, so a green run here is NOT evidence the router routes
// selects or that either guard fired — tests/router.test.ts owns that.
```

- [ ] **Step 4: Run it**

Run: `npm run test:live`

Expected: the gallery posts; the Lots tab card shows both dropdowns with real labels.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-live.ts
git commit -m "Drive select menus in the live gallery"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/commands.md`, `docs/gameplay.md`, `CLAUDE.md`

- [ ] **Step 1: Update the player-facing docs**

In `docs/commands.md` and `docs/gameplay.md`, describe that the Lots tab can build and upgrade directly, behind a confirm, and that `/build` and `/upgrade` still work unchanged.

- [ ] **Step 2: Add the repo conventions**

Append to `CLAUDE.md`:

```markdown
- The Lots tab's Build and Upgrade select menus follow the `park:landmark:buy` lesson,
  which they would otherwise repeat in a worse form. A menu option's `value` is an
  IDENTITY plus a STALENESS ANCHOR and never a price: `park:build` carries `<kind>`,
  `park:upgrade` carries `<lotId>:<expectedLevel>`. Prices are re-derived by `buildLot` /
  `upgradeLot` at execution, and the label is a display copy no handler reads back.
  The level anchor is load-bearing: `upgradeCostFor` is a pure function of `(kind, level)`
  and paddock cost is `buildCost * 2.5 ** level`, so a stale option charges the NEXT rung's
  price. Measured worst case is `hatchery_lab` — a label reading 25,000 against a charge of
  2,250,000, **90x**, against the landmark defect's 32x.
  `PADDOCKS` and `FACILITIES` (`src/data/paddocks.ts`, `src/data/facilities.ts`) are
  NULL-PROTOTYPE maps —
  `Object.assign(Object.create(null) as Record<string, XDef>, { … } satisfies Record<string, XDef>)`.
  The `as` and the `satisfies` are both required: `Object.assign(Object.create(null), {…})`
  returns `any`, which silently discards the literal's type check. Before this, a select
  menu could hand `buildLot` a prototype key — `PADDOCKS['constructor']` read back truthy
  through `Object`, so its `!paddock && !facility` check did not fire, and the write
  survived only because the resulting `NaN` cost bound as `NULL` against
  `users.cash NOT NULL`, a schema accident rather than validation. `/build` could not reach
  it because its `kind` comes from `addChoices`; a select menu value could.
  `buildLot` now owns an explicit
  `if (!Object.hasOwn(PADDOCKS, kind) && !Object.hasOwn(FACILITIES, kind)) throw new UnknownKindError(kind)`.
  The menu handler's identical allowlist is DEFENCE IN DEPTH, never the only guard — it
  earns its place because 90 of 101 `fakeButton` sites and every case in
  `scripts/test-live.ts` call `execute` directly rather than through `routeInteraction`.
  `upgradeLot(ctx, userId, lotId, expectedLevel)` takes the anchor as a REQUIRED fourth
  parameter — never defaulted, the same rule as `hungerAt(…, drainMs)`, `feedCostFor(now)`
  and `energyCostFor(now)` — and throws `StaleLevelError(expected, actual)`. Its guard order
  is not-found, then stale, then maxLevel, so `/upgrade`'s `lotRow?.level ?? -1` sentinel
  still reports 'No such lot.' for an unknown id. **The caller must pass the CLIENT-SUPPLIED
  anchor**: passing a level the caller just read makes the comparison a tautology that can
  never fire, which compiles, typechecks and passes every test. `/upgrade` is the one
  exception and says so at the call site — it quotes no frozen label, so it has no anchor to
  carry.
  `confirmPayload` (`src/modules/park/embeds.ts`) ships `content: ''`, `attachments: []` and
  RETAINS the tab row. The `attachments: []` is load-bearing rather than redundant:
  `lotsPayload` attaches `banners/lots.webp` on every call, and an `i.update` carrying
  neither `files` nor an explicit `attachments` strands that banner as an orphan attachment
  card.
  Error mapping is PER MENU. The service layer overloads two classes: `UnknownKindError`
  means unknown *kind* in `buildLot` and unknown *lot* in `upgradeLot`; `LotLimitError`
  means *slot cap* in one and *already max level* in the other. A shared mapping tells a
  player "All lots full" when they meant "already max level".
  Both spends sit behind a confirm rendered ONTO the card via `i.update`, never an
  ephemeral follow-up — the Lots tab must not be left displaying a state it is about to
  change. The confirm is a second layer only: the anchor check in the handler is the guard,
  because another open message may still hold a stale button.
```

Correct one stale clause while in the file: the existing select-menu bullet says the two
router guards are "never left to individual select handlers, **none of which exist yet**".
One exists after this PR.

- [ ] **Step 3: Commit**

```bash
git add docs/commands.md docs/gameplay.md CLAUDE.md
git commit -m "Document the lot build and upgrade menus"
```

---

## Verification before opening the PR

- [ ] `npm test` — full suite green
- [ ] `npm run typecheck` — exit 0
- [ ] `npm run build` — exit 0
- [ ] `npm run test:live` — Lots tab renders both dropdowns with correct labels and prices
- [ ] Manual check against a scratch database: build a lot from the menu, then click the **same** confirm button again and verify nothing is charged the second time
- [ ] The same for Upgrade, which is the 90x case: upgrade a `hatchery_lab` from the menu, then click the **same** confirm button again — the second click must be refused by name ("is level N now, not N-1") and charge nothing
- [ ] Visit another player's park, click 🏗️ Lots, and confirm **Next park ▶** is still on the card
- [ ] No `deploy-commands` run — no builder changed

## Self-Review

**Spec coverage:** Task 0a implements spec §3.4 — which no longer says "never relies on `buildLot`'s own check"; `buildLot` owns the check and the handler allowlist is defence in depth. Task 0b implements §3.5's required `expectedLevel` and `StaleLevelError`, superseding the handler-only level check an earlier revision specified. Task 1 covers §3.7 (confirm, with the tab row retained, `attachments: []` and `content: ''`) and §3.4's handler-side allowlist. Task 2 covers §3.5's 90x figure and §3.6 (per-menu error mapping, including `StaleLevelError` as the one class that is not overloaded). Task 3 covers the §7 sweep finding deferred from the select-routing PR. Task 4 covers the `test-live` driver; Task 5 covers §9. §11's sequencing is superseded — see the spec's own note.

**Placeholder scan:** Task 4 Step 2 says "add a `Case`" without quoting one, because `scripts/test-live.ts`'s `Case` shape was not read during planning and inventing its fields would be a fabricated type — the implementer must copy the shape of an adjacent case. Every code step that touches `src/` shows complete code.

**Type consistency:** `upgradeLot` is four-argument everywhere after Task 0b — one production call site and six test sites, all listed verbatim in Task 0b Step 4. `StaleLevelError` is exported from `src/modules/park/service.js` in Task 0b and imported by `src/modules/park/index.ts` in Tasks 0b and 2 and by `tests/park.test.ts` in Task 0b. `lotsPayload(user, lots, slots, opts)` gains `buildable` in Task 1 and `upgradable` in Task 2, both optional so existing call sites keep compiling, and its declared `components` type widens to the button/select row union in Task 1 Step 3 — a cast there would only move the error into `renderTab`. `confirmPayload(user, question, yesId, noId, yesLabel)` is used identically in Tasks 1 and 2 and returns four keys, not two. `renderTab(ctx, i, ownerId, tab, visit, content?)` keeps the signature the tabs PR established, and Tasks 1 and 2 edit its `lots` branch **additively**: `content: content ?? ''` and `if (tourRow) built.components.push(tourRow)` survive both edits. The select handler destructures `[, action, uid]` and the confirm handlers read `parts[3]`/`parts[4]`, consistent with `park:buildyes:<uid>:<kind>` and `park:upgyes:<uid>:<lotId>:<expectedLevel>`.
