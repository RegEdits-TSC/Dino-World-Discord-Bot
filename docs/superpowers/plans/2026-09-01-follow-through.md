# Follow-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every terminal action in Dino World offers the next one as a control instead of telling the player to type a command, and every insufficiency error quotes the number it currently withholds.

**Architecture:** Follow-through controls are minted per-module on each module's existing component prefix, never through a central registry — the router dispatches on the prefix alone, so a button minted in one module reaches another module's handler without an import between them. Cash-spending controls go behind a two-step confirm whose confirm button carries the price it was minted for, and whose handler recomputes that price and refuses if it moved. A single contract test enumerates the whole graph and dispatches every minted id through `routeInteraction`.

**Tech Stack:** TypeScript (ESM, `moduleResolution: nodenext`), discord.js, drizzle-orm over better-sqlite3 (synchronous), vitest, Node >= 22.

**Spec:** `docs/superpowers/specs/2026-08-31-follow-through-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **ESM NodeNext.** Every relative import carries a `.js` extension. Without one `tsc` fails the build outright (TS2835).
- **Time and randomness are injected.** `ctx.now()` and `ctx.rng()` — never `Date.now()` or `Math.random()`. Tests inject both via `makeCtx`, so a direct call is behaviour no test can pin.
- **DB access is synchronous.** drizzle/better-sqlite3 `.get()`/`.all()`/`.run()`, never awaited. Several check-then-write guards are sound only because no suspension point can open between the read and the write.
- **A component's `prefix` is the first customId segment and nothing more.** One registry entry per prefix; the handler branches on the action segment internally.
- **Every unrecognised-action arm calls `deferUpdate()`**, never a bare `return`. A bare return paints "This interaction failed" after three seconds, and a stale id from an older deploy lands exactly there.
- **A money button carries the amount it was minted for, and the handler revalidates it.** Re-rendering the message on success is a second layer only, never the guard — any other open message still holds a stale button.
- **Cross-module mints are gated on the handler's module.** `ModuleRegistry` filters to enabled modules (`src/core/modules.ts`) and `modules.json` carries a boolean per module, so an id minted for a disabled module's handler is dead on arrival. Gate with `ctx.config.modules.<name> ? [row] : []`.
- **Every new component needs its own routed test** that dispatches its real minted customId through `routeInteraction`. Calling `comp.execute` directly proves nothing about routing.
- **A guard nobody has watched fail is not yet a guard.** Every guard in this plan has an explicit break-it, watch-that-assertion-fail, restore step. If a break step does not go red, that is a defect in the guard — not an acceptable outcome.
- **Assertions on numbers match the whole rendered string**, never a substring containing the number.
- **`npm run build` does not typecheck tests.** `build` is `tsc` against `tsconfig.json`, which includes only `src`, and `npm test` transpiles without typechecking. `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) is the gate; run it before every commit touching `tests/` or `scripts/`.
- **No builder changes in this plan.** Components and selects are not builder changes and no command gains an option, so `npm run deploy-commands` is not needed. The final task verifies this with a grep rather than assuming it.
- **Commit messages** follow Conventional Commits and are authored by RegEdits. No `Co-Authored-By` trailer, no "Generated with" footer, and no mention of AI, Claude, Anthropic or any tool in any commit message, code comment, or document this plan produces.
- **Never write a derived count into prose** — in the code, the docs, or this plan's own text. State the command that derives it instead.

## Where this plan departs from the spec

The spec is a dated record of the decision as it was made and is **not** amended
(`§specs-are-dated-records`). Three things were settled differently once the code was read.
Each is implemented as described here, not as the spec describes it.

1. **§4.2 said the `park:assign` handler re-checks the lot itself. It does not.** `assignDino`
   already refuses every condition the mint-side filter screens on — unowned dino, escaped
   dino, wrong owner, wrong type, off-diet, and occupancy at `paddockCapacity(level)` excluding
   the dino being moved. A duplicate pre-check in the handler therefore produced the *identical
   sentence one layer earlier*, which meant its break-and-watch step could never go red: the
   guard would have shipped having never been seen firing, which is the exact state §6.2
   forbids. `assignDino` is the sole barrier, its refusals pass through by message, and the
   full-paddock and escaped-dino sentences are exported as constants so the throw site and the
   pass-through set cannot drift.

2. **The §5.1 sweep has three documented exceptions, not one.** `admin/service.ts` is excluded
   by the spec itself. `battles/index.ts` is left untouched so §5.4's "Nothing in battles
   changes" stays literally true — those two arms are unreachable backstops no behavioural test
   can reach. `trading/index.ts` quotes the gap without a "you have" clause, because
   `acceptTrade` applies to the sender first while the reply is read by the recipient, so
   "you have" would be a false statement about the reader's own balance.

3. **§3's table has an eighth surface: `park:buildyes`.** The spec's table named only the
   `/build` slash command, but a paddock is also built through the Lots tab's **Build…**
   dropdown — the path `/park view` actively steers players toward. Minting the assign control
   on only one of the two would have left the commoner path without follow-through.

---

## Tasks, in execution order

1. **Task 1** — Give `InsufficientFundsError` required `needed`/`held`, add `shortfallLine`, and fix the article rule for the whole sweep  `[G1-A]`
2. **Task 2** — Quote the shortfall at every park catch site  `[G1-B]`
3. **Task 3** — Quote the shortfall in shop, expeditions, guests, gene lab and hatchery  `[G1-C]`
4. **Task 4** — Quote the shortfall in care, and rewrite the one unreachable backstop in trading  `[G1-D]`
5. **Task 5** — `nextLotSlot(highWater)` beside `lotSlots`  `[G2-A]`
6. **Task 6** — the slot-cap message names the slot, its threshold and both ratings  `[G2-B]`
7. **Task 7** — the already-max-level message names the cap and the capacity  `[G2-C]`
8. **Task 8** — `claimExpedition` hands back the egg it just inserted  `[G4-A]`
9. **Task 9** — the harness reply-kind field, the one `incubateRow` builder, the one `hatch:inc` handler, and both bare returns  `[G4-B]`
10. **Task 10** — watch every `hatch:inc` guard fail, then restore  `[G4-C]`
11. **Task 11** — `paddockAccepts` and `eligiblePaddocks` — the one assign rule, written once  `[G5-A]`
12. **Task 12** — `assignRow` and `assignSelectRow` — the three mint shapes  `[G5-B]`
13. **Task 13** — the `park:assign` button — owner check, first-home rule, and which refusals pass through  `[G5-C]`
14. **Task 14** — `park:assignpick` and the `park:assignsel` select  `[G5-D]`
15. **Task 15** — `park:goto:lots` — where "Build a paddock" lands  `[G5-E]`
16. **Task 16** — a new paddock offers an assign menu, on both build paths  `[G6-A]`
17. **Task 17** — the `hatch:crack` reveal mints the assign control, and loses its typed-command footer  `[G5-F]`
18. **Task 18** — `/rescue` offers a one-click feed, and care gains its first component  `[G6-B]`
19. **Task 19** — Mint **🧭 Dig again** on both expedition-claim surfaces  `[G7-A]`
20. **Task 20** — the `exp` handler becomes three arms, and `exp:again` opens a priced confirm card  `[G7-B]`
21. **Task 21** — `exp:againyes` charges once, and refuses when the fee moved  `[G7-C]`
22. **Task 22** — `/expedition claim`'s slash reply mints Incubate  `[G4-D]`
23. **Task 23** — Mint **🥚 Buy another** on `/shop egg`'s reply  `[G7-D]`
24. **Task 24** — the `shop` component prefix, the `sell` bare return, and the Buy another card  `[G7-E]`
25. **Task 25** — `shop:againyes` rechecks the rotation and the price, charges once, and hands the egg on  `[G7-F]`
26. **Task 26** — `/shop egg` mints Incubate  `[G4-E]`
27. **Task 27** — `/breed claim` and the `breed:claim` button mint Incubate  `[G4-F]`
28. **Task 28** — `mythic:confirm` mints Incubate, and the slice's full gate  `[G4-G]`
29. **Task 29** — the follow-through contract test — the free half of the graph  `[G8-A]`
30. **Task 30** — the spend half — the two-step confirms and the price recheck  `[G8-B]`
31. **Task 31** — docs — name the buttons in the command reference, and file the convention  `[G8-C]`
32. **Task 32** — gates, and the operator hand-off  `[G8-D]`

---

### Task 1: Give `InsufficientFundsError` required `needed`/`held`, add `shortfallLine`, and fix the article rule for the whole sweep

_Stable id: `G1-A`_

`InsufficientFundsError` (`src/core/economy.ts:7-11`) carries only `wallet` and an optional `foodId` today. That is why every catch branch across `src/modules` can only say "Not enough cash." — every throw site already holds both figures in local scope at the throw and discards them. Enumerate the throw sites with `grep -n "throw new InsufficientFundsError" src/core/economy.ts`; enumerate the catch sites the rest of this slice rewrites with `grep -rn "e instanceof InsufficientFundsError" src/modules/*/*.ts`.

`needed` and `held` are **required**, never optional. An optional param lets a throw site keep constructing the numberless error and nothing anywhere fails — the bug being fixed, reintroduced by its own default. Steps 4 and 6 make you watch that.

**THE ARTICLE RULE — stated once here, obeyed by Task 2 (G1-B), Task 3 (G1-C) and Task 4 (G1-D).** The spec's own worked example is `Not enough cash — the Gene Lab costs 12,000, you have 8,410 (3,590 short).`, i.e. the definite form. So:

| What was being bought | Leading clause | Where |
| --- | --- | --- |
| A named catalogue item — building, landmark, attraction, decoration | `the ${def.name}` | `/build`, `park:buildyes`, `park:landmark:buy`, `/guests build`, `/decorate` |
| An egg | `a ${rarity} egg`, `a Mythic egg` | `/shop egg`, `mythic:confirm` |
| A food order | `${units}× ${food.name}` | `/shop food` |
| A named PLACE (an expedition site is a proper noun, not a catalogue entry) | `${site.name}`, bare | `/expedition start` |
| Something with no name of its own | `that upgrade`, `that recapture`, `this pairing`, `this splice` | `/upgrade`, `park:upgyes`, `/rescue`, `/breed`, `splice:confirm` |
| The food WALLET itself (the shortfall is in units, and the food is the subject) | `Not enough ${FOODS[e.foodId].name}` | `/feed one` |

Decorations are not enumerated in the ruling that fixed this rule; they join the named-catalogue-item row deliberately, because a decoration is a permanently-installed named purchase priced off a frozen table, exactly like a building. Expedition sites stay bare so this slice and the later Dig-again confirm arm render the same sentence.

**Files:**
- Modify: `src/core/economy.ts` — the class body at `:7-11`, the cash/shards throws at `:41-42`, the food throw at `:50-51`. No other task in this plan edits this file.
- Test: `tests/economy.test.ts` — extend the import on line 3; append one top-level `describe` at the end. Every describe in that file is top-level and closes at column 0, so the file's last `});` is a describe's; confirm with `grep -n "^describe\|^});" tests/economy.test.ts`.

**Interfaces:**
- Consumes: nothing — this is the first task in the plan.
- Produces:
  - `export class InsufficientFundsError extends Error` with `constructor(public wallet: 'cash' | 'food' | 'shards', public needed: number, public held: number, public foodId?: FoodId)`. `message` is UNCHANGED: `Insufficient <FOODS[foodId].name>` for food, `Insufficient <wallet>` otherwise.
  - `export function shortfallLine(e: InsufficientFundsError): string` — the shared tail only. Returns `costs 12,000, you have 8,410 (3,590 short)` for cash/shards and `need 3, you have 1 (2 short)` for food. All numbers via `toLocaleString('en-US')`.
  - Both exported from `src/core/economy.js`.

- [ ] **Step 1: Write the failing test**

Extend line 3 of `tests/economy.test.ts` to:

```typescript
import { EconomyService, InsufficientFundsError, ReversalError, shortfallLine } from '../src/core/economy.js';
```

Then append this block at the end of the file. It uses the file's existing top-level `beforeEach` (fresh `:memory:` db, user `u1` at cash 500 / shards 0) and its `bal()` helper at line 13.

```typescript
describe('InsufficientFundsError carries the numbers it used to withhold', () => {
  // Never `expect(fn).toThrow(InsufficientFundsError)` here: that proves a CLASS, and what is
  // under test is the three fields on the instance. The trailing throw is what stops the whole
  // block passing vacuously if the guard stops firing and nothing is thrown at all.
  function overdraft(fn: () => void): InsufficientFundsError {
    try {
      fn();
    } catch (e) {
      if (e instanceof InsufficientFundsError) return e;
      throw e;
    }
    throw new Error('expected an InsufficientFundsError; nothing was thrown');
  }

  it('a cash overdraft carries the amount asked for, the balance held, and no foodId', () => {
    eco.apply('u1', { cash: 7_910 }, 'seed', 0);            // 500 -> 8,410
    const e = overdraft(() => eco.apply('u1', { cash: -12_000 }, 'build:gene_lab', 0));
    expect(e.wallet).toBe('cash');
    expect(e.needed).toBe(12_000);
    expect(e.held).toBe(8_410);
    expect(e.foodId).toBeUndefined();
    // The WHOLE line. Step 6 swaps the two constructor arguments and shows that
    // toContain('8,410') and toContain('3,590') BOTH still pass against the broken output;
    // only .toBe catches it.
    expect(shortfallLine(e)).toBe('costs 12,000, you have 8,410 (3,590 short)');
    // message is deliberately untouched: src/modules/admin/service.ts and the
    // "Insufficient Fish" assertion earlier in this file both still read it.
    expect(e.message).toBe('Insufficient cash');
    expect(bal().cash).toBe(8_410);                          // and nothing was written
  });

  it('a shards overdraft carries its own wallet and numbers', () => {
    eco.apply('u1', { shards: 340 }, 'seed', 0);
    const e = overdraft(() => eco.apply('u1', { shards: -500 }, 'mythic:indominus', 0));
    expect(e.wallet).toBe('shards');
    expect(e.needed).toBe(500);
    expect(e.held).toBe(340);
    expect(shortfallLine(e)).toBe('costs 500, you have 340 (160 short)');
    expect(e.message).toBe('Insufficient shards');
  });

  it('a food overdraft counts units, names the food, and says "need" rather than "costs"', () => {
    eco.apply('u1', { foods: { ferns: 1 } }, 'seed', 0);
    const e = overdraft(() => eco.apply('u1', { foods: { ferns: -3 } }, 'feed:triceratops', 0));
    expect(e.wallet).toBe('food');
    expect(e.foodId).toBe('ferns');
    expect(e.needed).toBe(3);
    expect(e.held).toBe(1);
    expect(shortfallLine(e)).toBe('need 3, you have 1 (2 short)');
    expect(e.message).toBe('Insufficient Ferns');
  });

  it('a food the player holds none of reports held 0, not a missing row', () => {
    // food_inventory has no row at all for a food never bought, and getFoodInventory drops
    // zero rows besides. `held` must still be the number 0 — not undefined, not NaN.
    const e = overdraft(() => eco.apply('u1', { foods: { goat: -2 } }, 'feed:trex', 0));
    expect(e.wallet).toBe('food');
    expect(e.held).toBe(0);
    expect(e.needed).toBe(2);
    expect(shortfallLine(e)).toBe('need 2, you have 0 (2 short)');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/economy.test.ts -t "carries the numbers it used to withhold"`

Expected: FAIL, four cases. **Not** a `SyntaxError`, and not an import error: vitest's SSR transform resolves a missing named export to `undefined`, so the file collects normally and every case RUNS. Each case therefore fails on its first `needed`/`held` assertion:

- `AssertionError: expected undefined to be 12000` (cash case)
- `AssertionError: expected undefined to be 500` (shards case)
- `AssertionError: expected undefined to be 3` (food case)
- `AssertionError: expected undefined to be +0` (empty-food case)

None of the four reaches its `shortfallLine(e)` line yet; if a `needed`/`held` assertion ever passes before Step 3, the next line fails with `TypeError: shortfallLine is not a function` instead — that is what `undefined` does when you call it.

Do **not** run `npx tsc --noEmit -p tsconfig.test.json` at this point: `e.needed` is not on the type yet, so it reports errors in the test file that Step 3 removes. The typecheck gate is Step 4.

- [ ] **Step 3: Widen the class and add the renderer**

Replace `src/core/economy.ts:7-11` (the whole class, `export class` through its closing `}`) with this. `foodId` stays LAST and optional because its absence is a real state (cash and shards have no food); `needed` and `held` go in front of it so an old two-argument call cannot typecheck.

```typescript
export class InsufficientFundsError extends Error {
  /**
   * `needed` is the amount the caller asked for and `held` is the balance at the moment the
   * guard fired, both required. Optional would have been the bug this class exists to fix,
   * re-added by its own default: a throw site that omitted them would compile, and the error
   * would go on withholding exactly the number every catch site wants.
   */
  constructor(
    public wallet: 'cash' | 'food' | 'shards',
    public needed: number,
    public held: number,
    public foodId?: FoodId,
  ) {
    super(foodId ? `Insufficient ${FOODS[foodId].name}` : `Insufficient ${wallet}`);
  }
}

/**
 * The tail every insufficiency message shares. The caller supplies the leading clause naming
 * WHAT was being bought, because only the caller knows it; the numbers live here because they
 * have exactly one definition — the guard that threw. Splitting it this way is what stops a
 * catch site re-deriving a price and disagreeing with the charge that actually failed.
 *
 * 'en-US' is passed explicitly, not left to the host locale: these strings are asserted whole.
 */
export function shortfallLine(e: InsufficientFundsError): string {
  const n = (v: number) => v.toLocaleString('en-US');
  const tail = `you have ${n(e.held)} (${n(e.needed - e.held)} short)`;
  // Food is a count of units, not a currency, so it reads "need 3" where cash reads "costs 3".
  return e.wallet === 'food' ? `need ${n(e.needed)}, ${tail}` : `costs ${n(e.needed)}, ${tail}`;
}
```

Then the throw sites. Replace lines 41-42:

```typescript
    if (u.cash + cash < 0) throw new InsufficientFundsError('cash');
    if (u.shards + shards < 0) throw new InsufficientFundsError('shards');
```

with:

```typescript
    // `cash` and `shards` are SIGNED deltas, negative for a spend, so the amount asked for is
    // the negation. A positive delta cannot push a non-negative balance below zero (both
    // columns carry a CHECK >= 0), so these are only reachable with a negative delta and
    // `needed` is always positive here.
    if (u.cash + cash < 0) throw new InsufficientFundsError('cash', -cash, u.cash);
    if (u.shards + shards < 0) throw new InsufficientFundsError('shards', -shards, u.shards);
```

And replace lines 50-51:

```typescript
      const next = (row?.qty ?? 0) + qty;
      if (next < 0) throw new InsufficientFundsError('food', foodId);
```

with this, so `held` is bound once and shared with `next` rather than repeating `row?.qty ?? 0`:

```typescript
      const held = row?.qty ?? 0;
      const next = held + qty;
      if (next < 0) throw new InsufficientFundsError('food', -qty, held, foodId);
```

- [ ] **Step 4: Break the required-ness and watch the type gate fire, then restore**

The gate on `needed`/`held` is the type system, not a test — so watch it fail before trusting it. Three commands, in order, each run on its own (this repo's primary shell is Windows PowerShell 5.1, where `&&` is a parser error).

First, temporarily revert the cash throw site to its old one-argument form:

```typescript
    if (u.cash + cash < 0) throw new InsufficientFundsError('cash');
```

Run: `npx tsc --noEmit -p tsconfig.test.json`

Expected: FAIL with `src/core/economy.ts(41,…): error TS2554: Expected 3-4 arguments, but got 1.`

Second, with that line still broken, temporarily make the two params optional in the class — `public needed?: number, public held?: number` — and run the same command again.

Expected: it now reports errors only inside `shortfallLine` (`'e.held' is possibly 'undefined'` / `Argument of type 'number | undefined' is not assignable to parameter of type 'number'`), and **not** on line 41. That is the failure mode being prevented: with optional params, a throw site that withholds the numbers compiles clean and no test anywhere notices.

Third, restore both edits exactly as written in Step 3 and run `npx tsc --noEmit -p tsconfig.test.json` once more. Expected: exit 0, no output.

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/economy.test.ts`

Expected: PASS — the new block plus every pre-existing case in the file, including `toThrow('Insufficient Fish')`, which still holds because `message` was not changed, and every `toThrow(InsufficientFundsError)` class assertion (`grep -n "InsufficientFundsError" tests/economy.test.ts` lists them; nothing in the file constructs the error itself, so nothing had to change).

- [ ] **Step 6: Break the argument order and watch the whole-string assertion fire, then restore**

A whole-string assertion is only worth writing if it can tell the two numbers apart. Temporarily swap the last two arguments at the cash throw site:

```typescript
    if (u.cash + cash < 0) throw new InsufficientFundsError('cash', u.cash, -cash);
```

Run: `npx vitest run tests/economy.test.ts -t "a cash overdraft carries the amount asked for"`

Expected: FAIL with `expected 'costs 8,410, you have 12,000 (-3,590 short)' to be 'costs 12,000, you have 8,410 (3,590 short)'`, plus failures on `e.needed` and `e.held`.

Read the broken string before restoring — it is what makes the `.toBe` earn its keep. `needed` and `held` are now swapped, so `shortfallLine` renders `n(8410 - 12000)`, i.e. the literal text `-3,590`. Both of the substring assertions somebody would reach for instead survive that swap: `toContain('3,590')` passes because `'-3,590'` contains `'3,590'`, and `toContain('8,410')` passes because 8,410 is still in the sentence, merely in the wrong slot. Only asserting the whole line distinguishes them.

Restore the line to the Step 3 version and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/economy.ts tests/economy.test.ts
git commit -m "feat(economy): carry the amount and balance on InsufficientFundsError"
```

---

---

### Task 2: Quote the shortfall at every park catch site

_Stable id: `G1-B`_

Enumerate the branches this task rewrites with `grep -n "e instanceof InsufficientFundsError" src/modules/park/index.ts`. They fall into two groups: `/upgrade`, `park:landmark:buy`, `park:buildyes` and `park:upgyes` already quote a price they re-derive by hand, while `/build` and `/decorate` say only "Not enough cash." — even though `park:buildyes`, the button for the very same `buildLot` call, names the building and its cost. This task makes every one of them read from the error instead, which closes that asymmetry and deletes the hand-rolled price re-derivations along with it.

Two existing assertions pin the OLD wording and will fail; updating them is part of this task, not a follow-up.

**Every edit below is anchored on QUOTED TEXT, not on a line number.** Task 6 (G2-B) later rewrites the `LotLimitError` arms in the `/build` and `park:buildyes` catches, Task 7 (G2-C) rewrites the `Already max level.` arms in the `/upgrade` and `park:upgyes` catches, and Task 16 (G6-A) adds a components row to the `/build` reply — three later tasks inside the same four blocks. This task lands first, so quoting is only belt-and-braces here; it is what stops the same edits drifting when the later tasks re-derive their own anchors.

**Files:**
- Modify: `src/modules/park/index.ts` — the `InsufficientFundsError` import (line 15 on the clean tree); the `/build` execute (`try {` / `const lot = buildLot(…)` and the `LotLimitError`+`InsufficientFundsError` arm pair); the `/upgrade` hoist comment and its `InsufficientFundsError` arm; the `/decorate` execute (`try {` / `decorateLot(…)` and the `AssignError`+`InsufficientFundsError` arm pair); one `content:` line each in `park:landmark:buy`, `park:buildyes` and `park:upgyes`
- Test: `tests/park.test.ts` — two assertions rewritten (anchored on their text), two new cases
- Test: `tests/landmarks.test.ts` — one assertion rewritten (anchored on its text)
- Test: `tests/lot-menus.test.ts` — two import lines extended (this task OWNS adding `replyText`; Task 6 (G2-B) only confirms it is present), one new top-level `describe` appended

**Interfaces:**
- Consumes: from Task 1 (G1-A) — `shortfallLine(e: InsufficientFundsError): string` and `class InsufficientFundsError` with `wallet`, `needed`, `held`, `foodId?`, both from `src/core/economy.js`.
- Produces: no new exported symbols. Rendered strings that no later task imports.

- [ ] **Step 1: Rewrite the three assertions that pin the old wording**

In `tests/park.test.ts`, replace this exact line (keep the three comment lines above it — they are still exactly right):

```typescript
    expect(replyText(brokeI.replies[0])).toBe('Not enough cash — that upgrade costs 5,000.');
```

with:

```typescript
    expect(replyText(brokeI.replies[0]))
      .toBe('Not enough cash — that upgrade costs 5,000, you have 0 (5,000 short).');
```

In `tests/park.test.ts`, replace this exact line — the last assertion inside `it('/build maps LotLimitError and InsufficientFundsError to ephemeral replies', …)`. That case deletes every lot, then sets `cash: 0`, before the `/build` it asserts on, and its `kind` is `Object.keys(PADDOCKS)[0]`, i.e. `herbivore_paddock` at `buildCost: 2_000`:

```typescript
    expect(replyText(broke.replies[0])).toContain('Not enough cash');
```

with:

```typescript
    expect(replyText(broke.replies[0]))
      .toBe('Not enough cash — the Herbivore Paddock costs 2,000, you have 0 (2,000 short).');
```

In `tests/landmarks.test.ts`, replace this exact line — the tail of the two-line assertion inside `it('reports insufficient cash with the exact price of the rung the button offered', …)`. `u1` is at the 500 starting cash from that file's `beforeEach`, and the Stone Marker is 5,000,000:

```typescript
      .toBe('Not enough cash — the Stone Marker costs 5,000,000.');
```

with:

```typescript
      .toBe('Not enough cash — the Stone Marker costs 5,000,000, you have 500 (4,999,500 short).');
```

- [ ] **Step 2: Add the two new command cases**

In `tests/park.test.ts`, insert these two cases immediately **before** the existing `it('/decorate execute adds decor', …)` — anchor on that `it(` line. They live in `describe('/upgrade, /decorate, /park rename, /dino unassign, park:collect', …)`, and every symbol they use is already imported by that file: `makeCtx`, `fakeCommand`, `replyText`, `getOrCreateUser`, `buildLot`, `parkModule`, `schema`, `MessageFlags`.

```typescript
  it('/build names the building and quotes the shortfall', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    const cmd = parkModule.commands.find((c) => c.data.name === 'build')!;
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'herbivore_paddock' } });
    await cmd.execute(ctx, i.asChatInput());
    // Whole string, never toContain('2,000'): that substring is satisfied by '12,000' and by
    // '2,000,000' just as happily, and the figures are the entire point of the change.
    expect(replyText(i.replies[0]))
      .toBe('Not enough cash — the Herbivore Paddock costs 2,000, you have 0 (2,000 short).');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('/decorate names the decoration and quotes the shortfall', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    const cmd = parkModule.commands.find((c) => c.data.name === 'decorate')!;
    const i = fakeCommand({ name: 'decorate', user: 'u1', options: { lot: lot.id, item: 'palm_tree' } });
    await cmd.execute(ctx, i.asChatInput());
    // DECOR.palm_tree is a frozen literal cost of 500 — no world-event or deal multiplier
    // touches decor, and decorateLot applies no biome filter, so this is safe to pin.
    expect(replyText(i.replies[0]))
      .toBe('Not enough cash — the Palm Tree costs 500, you have 0 (500 short).');
  });
```

- [ ] **Step 3: Add the two new confirm-button cases**

`tests/lot-menus.test.ts` is missing two names the cases need. This task owns both import edits:

- line 3 becomes `import { makeCtx, fakeButton, fakeSelect, replyText } from './harness.js';`
- line 4 becomes `import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';`

Then append this as a new top-level `describe` at the end of the file — every describe in it is top-level and closes at column 0, so the last `});` in the file is a describe's, not an `it`'s (`grep -n "^describe\|^});" tests/lot-menus.test.ts` shows the shape). The cases use that file's existing `ctx` `beforeEach`, its `parkComp()` helper and its `cashOf` helper:

```typescript
describe('confirm-button insufficiency messages', () => {
  it('park:buildyes names the building and quotes the shortfall', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 0 }).where(eq(schema.users.discordId, 'u1')).run();
    // The trailing :0 is the lot-count anchor the handler validates against a fresh read
    // before entering the try — the player owns no lots, so the id is not stale and the
    // handler reaches buildLot rather than the count-mismatch refusal above it.
    const b = fakeButton({ customId: 'park:buildyes:u1:herbivore_paddock:0', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0]))
      .toBe('Not enough cash — the Herbivore Paddock costs 2,000, you have 0 (2,000 short).');
    expect(cashOf('u1')).toBe(0);
  });

  it('park:upgyes quotes the shortfall for the level the button was minted at', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');   // level 1
    ctx.db.update(schema.users).set({ cash: 0 }).where(eq(schema.users.discordId, 'u1')).run();
    // herbivore_paddock L1 -> L2 is round(2,000 x 2.5) = 5,000 (upgradeCostFor). The trailing
    // :1 is the expected-level anchor the handler checks against a fresh read before the try.
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0]))
      .toBe('Not enough cash — that upgrade costs 5,000, you have 0 (5,000 short).');
    expect(cashOf('u1')).toBe(0);
  });
});
```

- [ ] **Step 4: Run the tests and watch them fail**

Run: `npx vitest run tests/park.test.ts tests/landmarks.test.ts tests/lot-menus.test.ts`

Expected: FAIL, six cases, every one an assertion mismatch (nothing here imports a symbol that does not exist yet):

- `/build names the building…` and the retargeted `/build maps LotLimitError…`: `expected 'Not enough cash.' to be 'Not enough cash — the Herbivore Paddock costs 2,000, you have 0 (2,000 short).'`
- `/decorate names the decoration…`: `expected 'Not enough cash.' to be 'Not enough cash — the Palm Tree costs 500, you have 0 (500 short).'`
- the `/upgrade` case: `expected 'Not enough cash — that upgrade costs 5,000.' to be 'Not enough cash — that upgrade costs 5,000, you have 0 (5,000 short).'`
- the landmark case: `expected 'Not enough cash — the Stone Marker costs 5,000,000.' to be '… costs 5,000,000, you have 500 (4,999,500 short).'`
- `park:buildyes …` and `park:upgyes …`: the same two mismatches against the current button wording.

- [ ] **Step 5: Extend the economy import**

In `src/modules/park/index.ts`, replace:

```typescript
import { InsufficientFundsError } from '../../core/economy.js';
```

with:

```typescript
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
```

`PADDOCKS`, `FACILITIES` and `DECOR` are already imported by this file — confirm with `grep -n "data/paddocks.js\|data/facilities.js\|data/decor.js" src/modules/park/index.ts`.

- [ ] **Step 6: Rewrite the `/build` branch**

Hoist `kind` above the try so the catch can name the building. Replace:

```typescript
        try {
          const lot = buildLot(ctx, i.user.id, i.options.getString('kind', true));
```

with:

```typescript
        // Hoisted out of the call below because the InsufficientFundsError arm in the catch
        // dereferences it to name the building. Do NOT re-inline this read: the catch stops
        // compiling (TS2304) and the reply loses the name the message is supposed to carry.
        // buildLot's own Object.hasOwn check runs first, so by the time that arm is reached
        // `kind` is a real key of PADDOCKS or FACILITIES.
        const kind = i.options.getString('kind', true);
        try {
          const lot = buildLot(ctx, i.user.id, kind);
```

Then replace this pair of lines (quoted together because the `InsufficientFundsError` line alone is not unique in this file — `/decorate` carries a byte-identical one):

```typescript
          else if (e instanceof LotLimitError) await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
```

with:

```typescript
          else if (e instanceof LotLimitError) await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            const def = PADDOCKS[kind] ?? FACILITIES[kind]!;
            await i.reply({ content: `Not enough cash — the ${def.name} ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
          }
```

(The `LotLimitError` line is reproduced verbatim and unchanged — it is Task 6 (G2-B)'s to rewrite, later.)

- [ ] **Step 7: Rewrite the `/upgrade` branch and correct its now-false hoist comment**

Replace these three comment lines:

```typescript
        // Hoisted so the InsufficientFundsError branch below can quote the price: upgradeLot
        // does the same lookup internally, so this is one cheap extra read, not a second
        // source of truth for the cost (upgradeCostFor stays the only place that computes it).
```

with:

```typescript
        // Hoisted for upgradeLot's expectedLevel argument below, NOT for the price: the price
        // now comes off the error the guard threw, so upgradeCostFor is no longer called on
        // this path at all. It is still used by this command's autocomplete, by the Lots-tab
        // upgrade select and by its confirm label — `grep -n "upgradeCostFor" src/modules/park/index.ts`.
```

Then replace:

```typescript
            content: `Not enough cash — that upgrade costs ${upgradeCostFor(lotRow!.kind, lotRow!.level).toLocaleString('en-US')}.`,
```

with:

```typescript
            content: `Not enough cash — that upgrade ${shortfallLine(e)}.`,
```

- [ ] **Step 8: Rewrite the `/decorate` branch**

Hoist `item`, same reason as `/build`. Replace:

```typescript
        try {
          decorateLot(ctx, i.user.id, i.options.getInteger('lot', true), i.options.getString('item', true));
```

with:

```typescript
        // Hoisted so the InsufficientFundsError arm can name the decoration, same rule as
        // /build's `kind`. decorateLot throws AssignError('Unknown decoration.') for a kind
        // absent from DECOR and that arm is checked first, so `item` is a real key here.
        const item = i.options.getString('item', true);
        try {
          decorateLot(ctx, i.user.id, i.options.getInteger('lot', true), item);
```

Then replace this pair of lines:

```typescript
          if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
```

with:

```typescript
          if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({
            content: `Not enough cash — the ${DECOR[item].name} ${shortfallLine(e)}.`,
            flags: MessageFlags.Ephemeral,
          });
```

- [ ] **Step 9: Rewrite the three component branches**

Each is a single `content:` line, and each quoted string below is unique in the file.

`park:landmark:buy` — replace:

```typescript
                  content: `Not enough cash — the ${rung.name} costs ${rung.cost.toLocaleString('en-US')}.`,
```

with:

```typescript
                  content: `Not enough cash — the ${rung.name} ${shortfallLine(e)}.`,
```

`park:buildyes` — replace:

```typescript
                  content: `Not enough cash — ${def.name} costs ${def.buildCost.toLocaleString('en-US')}.`,
```

with:

```typescript
                  content: `Not enough cash — the ${def.name} ${shortfallLine(e)}.`,
```

`park:upgyes` — replace:

```typescript
                  content: `Not enough cash — that upgrade costs ${upgradeCostFor(lot.kind, lot.level).toLocaleString('en-US')}.`,
```

with:

```typescript
                  content: `Not enough cash — that upgrade ${shortfallLine(e)}.`,
```

- [ ] **Step 10: Run the tests and watch them pass**

Run: `npx vitest run tests/park.test.ts tests/landmarks.test.ts tests/lot-menus.test.ts tests/park-tabs.test.ts`

Expected: PASS.

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.test.json`

Expected: exit 0, no output. (`npm run build` typechecks neither `tests/` nor `scripts/`, so this is the gate that sees the test edits.)

- [ ] **Step 12: Commit**

```bash
git add src/modules/park/index.ts tests/park.test.ts tests/landmarks.test.ts tests/lot-menus.test.ts
git commit -m "feat(park): quote the cost and balance on every insufficient-funds reply"
```

---

---

### Task 3: Quote the shortfall in shop, expeditions, guests, gene lab and hatchery

_Stable id: `G1-C`_

The cash and shards catch branches in these five modules — enumerate them with `grep -n "e instanceof InsufficientFundsError" src/modules/shop/index.ts src/modules/expeditions/index.ts src/modules/guests/index.ts src/modules/genelab/index.ts src/modules/hatchery/index.ts` (spelled out rather than brace-expanded: PowerShell 5.1 does not expand `{a,b}`) — each know the noun for what was being bought but not the number. With the number now on the error, the noun is all each site has to supply. That also removes `hatchery`'s hardcoded literal `500`, a figure that would have gone silently stale the moment `MYTHIC_SHARD_COST` changed (`grep -rn "MYTHIC_SHARD_COST" src/modules/hatchery` returns nothing: the constant lives in `src/data/sell.ts` and that module does not import it).

The gene lab's two breeding arms — `/breed`'s command and `breed:confirm` — are unreachable backstops: `startBreeding` pre-checks affordability outside its transaction and throws a `BreedError` that already carries both numbers. They are rewritten for consistency and get a comment saying so, but no behavioural test can reach them. `splice:confirm` is the reachable gene-lab site.

**How prices are pinned in this task.** Three classes, and the class decides whether a literal is safe:

1. **Frozen constants, no multiplier at all** — `ATTRACTIONS.picnic_lawn.buildCost` (250,000), `SPLICE_SHARD_COST` (15), `MYTHIC_SHARD_COST` (500). Pinned as literals.
2. **One world-event multiplier** — the expedition fee is `expeditionFeeFor(site.cost, eventMods(now).expeditionFee)`, and `site.cost` is a frozen literal in `src/data/sites.ts`. Day 0 (`makeCtx()`'s default clock) rolls `clear_skies`, whose every modifier is neutral, so this is pinned as a literal. The probe below prints both halves.
3. **TWO independent multipliers** — `eggPriceAt` and `foodPriceAt` (`src/modules/shop/service.ts`) fold the world event **and** the daily deal: `DEAL_EGG_DISCOUNT` when `rarity === todaysDeal(now).rarity`, `DEAL_FOOD_DISCOUNT` when `food.id === todaysDeal(now).food`. `todaysDeal` is a seeded roll over `dailyEggOffers` and `Object.values(FOODS)`. At day 0 it lands on `{ rarity: 'uncommon', food: 'royal_greens' }`, so common eggs and ferns happen to be undiscounted — **but that is a roll, not a fact**: reorder or extend `FOODS` and it can land on `ferns`, moving the unit price and the 5-unit total. A literal pinned here would go stale silently. **The two shop cases therefore read the price off `eggPriceAt` / `foodPriceAt` instead of pinning a number.**

Run the probe before writing the tests, so you have seen the numbers rather than trusted the paragraph above. Write the file into `scripts/` — `tsx` resolves the relative imports from the probe's own directory, so a temp-dir copy will not run:

```bash
cat > scripts/__probe.ts <<'EOF'
import { todaysDeal, dailyEggOffers, eggPriceAt, foodPriceAt } from '../src/modules/shop/service.js';
import { FOODS } from '../src/data/foods.js';
import { worldEventFor, eventMods } from '../src/core/world.js';
import { expeditionFeeFor } from '../src/modules/expeditions/service.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';
console.log('event', worldEventFor(0).id, JSON.stringify(eventMods(0)));
console.log('deal', JSON.stringify(todaysDeal(0)), 'offers', JSON.stringify(dailyEggOffers(0, 0)));
console.log('egg/food', eggPriceAt('common', 0), foodPriceAt(FOODS.ferns, 0));
console.log('coastal', expeditionFeeFor(EXPEDITION_SITES['coastal_dig'].cost, eventMods(0).expeditionFee));
EOF
```
```bash
npx tsx scripts/__probe.ts
```
```bash
rm scripts/__probe.ts
```

(Three separate commands, never chained with `&&`: this repo's primary shell is Windows PowerShell 5.1, where `&&` is a parser error.)

Every new case below is given a NON-ZERO held balance on purpose, so `needed`, `held` and the shortfall are three different numbers and a swapped-argument bug cannot render identically.

**Files:**
- Modify: `src/modules/shop/index.ts` — the `InsufficientFundsError` import, the `data/foods.js` import, the whole `catch` block of the `/shop` execute
- Modify: `src/modules/expeditions/index.ts` — the `InsufficientFundsError` import, the whole `catch` block of the `/expedition` execute
- Modify: `src/modules/guests/index.ts` — the `InsufficientFundsError` import, the `InsufficientFundsError` arm of the `/guests build` ternary
- Modify: `src/modules/genelab/index.ts` — the `InsufficientFundsError` import, the arm in `/breed`'s catch, the arm in `breed:confirm`'s catch, the arm in `splice:confirm`'s catch (three one-line arms, each anchored by its enclosing catch's preceding line)
- Modify: `src/modules/hatchery/index.ts` — the `InsufficientFundsError` import, the arm in `mythic:confirm`'s catch
- Test: `tests/shop.test.ts`, `tests/expeditions.test.ts`, `tests/guests.test.ts`, `tests/genelab-module.test.ts` (one new top-level `describe` appended to each); `tests/hatchery.test.ts` (one existing case's title and tail rewritten, anchored on quoted text)

Task 28 (G4-G) later mints an Incubate row on `mythic:confirm`'s success `i.update`, and Task 23 (G7-D)/E/F later restructure the shop's components and the `/shop egg` reply — both inside files this task edits, both landing after it. Anchoring on quoted text is what keeps those independent.

**Interfaces:**
- Consumes: from Task 1 (G1-A) — `shortfallLine(e: InsufficientFundsError): string`, and `e.wallet` / `e.needed` / `e.held` / `e.foodId` on the widened `InsufficientFundsError`.
- Produces: no new exported symbols.

- [ ] **Step 1: Write the shop and expeditions cases**

`tests/shop.test.ts` — append as a new top-level `describe` at the end of the file. It uses the file-level `ctx` `beforeEach`, which seeds 200,500 cash, so each case sets a small non-zero balance first. Every symbol used is already imported by that file: `eggPriceAt`, `foodPriceAt`, `FOODS`, `shopModule`, `fakeCommand`, `replyText`, `schema`, `eq`, `MessageFlags`.

```typescript
describe('/shop insufficiency', () => {
  it('/shop egg names the egg and quotes the shortfall', async () => {
    ctx.db.update(schema.users).set({ cash: 120 }).where(eq(schema.users.discordId, 'u1')).run();
    const cmd = shopModule.commands.find((c) => c.data.name === 'shop')!;
    const i = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity: 'common' } });
    await cmd.execute(ctx, i.asChatInput());
    // The price is READ from the same helper buyEgg charges through, never hand-pinned:
    // eggPriceAt folds the world event AND the daily deal, and the deal's target is a seeded
    // per-day roll a FOODS/offers change can move. What is under test is that the error's
    // number IS the charged number, which is exactly what this states.
    // `common` is structurally always in the rotation at the uncommon ceiling (the pool there
    // is exactly ['uncommon','common'] and slice(0,3) cannot truncate it), so the pre-buy
    // rotation gate in /shop egg cannot swallow this case.
    const need = eggPriceAt('common', 0);
    expect(replyText(i.replies[0])).toBe(
      `Not enough cash — a common egg costs ${need.toLocaleString('en-US')}, `
      + `you have 120 (${(need - 120).toLocaleString('en-US')} short).`);
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('/shop food names the order and quotes the shortfall', async () => {
    ctx.db.update(schema.users).set({ cash: 12 }).where(eq(schema.users.discordId, 'u1')).run();
    const cmd = shopModule.commands.find((c) => c.data.name === 'shop')!;
    const i = fakeCommand({ name: 'shop', sub: 'food', user: 'u1', options: { item: 'ferns', units: 5 } });
    await cmd.execute(ctx, i.asChatInput());
    // Same rule as the egg case, and buyFood charges `units * foodPriceAt(food, now)` exactly
    // — it never rounds the raw units*unitCost*mult product — so this IS the number the cash
    // guard saw. (The cash guard fires before the food credit, so the wallet is 'cash' here.)
    const need = 5 * foodPriceAt(FOODS.ferns, 0);
    expect(replyText(i.replies[0])).toBe(
      `Not enough cash — 5× Ferns costs ${need.toLocaleString('en-US')}, `
      + `you have 12 (${(need - 12).toLocaleString('en-US')} short).`);
  });
});
```

`tests/expeditions.test.ts` — append as a new top-level `describe` at the end. That file imports `expeditionsModule` mid-file (`grep -n "expeditionsModule" tests/expeditions.test.ts`), and already imports `MessageFlags`, `eq`, `schema`, `fakeCommand` and `replyText`. Its `beforeEach` seeds 50,500 cash.

```typescript
describe('/expedition start insufficiency', () => {
  it('names the site and quotes the shortfall', async () => {
    ctx.db.update(schema.users).set({ cash: 45 }).where(eq(schema.users.discordId, 'u1')).run();
    const cmd = expeditionsModule.commands[0];
    const i = fakeCommand({ name: 'expedition', sub: 'start', user: 'u1', options: { site: 'coastal_dig' } });
    await cmd.execute(ctx, i.asChatInput());
    // Class 2: ONE multiplier. Coastal Dig unlocks at rating 0, its cost is the frozen literal
    // 200 in src/data/sites.ts, and eventMods(0).expeditionFee is 1 on clear_skies — no daily
    // deal exists on this path — so the literal is safe. The probe prints both halves.
    // An expedition site is a proper place name, so no article: 'Coastal Dig costs 200'.
    expect(replyText(i.replies[0]))
      .toBe('Not enough cash — Coastal Dig costs 200, you have 45 (155 short).');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
});
```

- [ ] **Step 2: Write the guests, gene lab and hatchery cases**

`tests/guests.test.ts` — append as a new top-level `describe` at the end. It already imports `getOrCreateUser`, `guestsModule`, `fakeCommand`, `replyText`, `schema` and `eq`; its `beforeEach` seeds no user. This is the case the old code could not have written at all: the upgrade half's cost needs `levelValue`, which that module does not import — with the number on the error, one clause serves both halves.

```typescript
describe('/guests build insufficiency', () => {
  it('names the attraction and quotes the shortfall', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 1_500 }).where(eq(schema.users.discordId, 'u1')).run();
    const cmd = guestsModule.commands[0];
    const i = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd.execute(ctx, i.asChatInput());
    // Class 1: a frozen constant. ATTRACTIONS.picnic_lawn has unlockAt 0 and buildCost 250,000
    // — no multiplier of any kind touches attraction costs.
    expect(replyText(i.replies[0]))
      .toBe('Not enough cash — the Picnic Lawn costs 250,000, you have 1,500 (248,500 short).');
  });
});
```

`tests/genelab-module.test.ts` — append as a new top-level `describe` at the end. `splice:confirm` is the reachable gene-lab site: `/splice`'s own shard pre-check lives on the COMMAND, and the confirm button re-validates ownership, lock, escape and slot but never shards. The file already binds `spliceBtn` at module scope and imports `makeCtx`, `fakeButton`, `replyText`, `getOrCreateUser`, `schema` and `eq`. `spliceDino` allows slot 0 on a traitless dino (`slot > Math.min(d.traits.length, 1)` is `0 > 0`, false).

```typescript
describe('splice:confirm insufficiency', () => {
  it('quotes the splice cost and the shard balance', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const dino = ctx.db.insert(schema.dinos)
      .values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, traits: [] })
      .returning().get();
    ctx.db.update(schema.users).set({ shards: 3 }).where(eq(schema.users.discordId, 'u1')).run();
    const b = fakeButton({ customId: `splice:confirm:${dino.id}:0`, user: 'u1' });
    await spliceBtn.execute(ctx, b.asChatInput() as never);
    // Class 1: SPLICE_SHARD_COST is the flat literal 15 in src/data/breeding.ts. Pinned as a
    // literal on purpose — SPLICE_SHARD_COST is imported by this file but deliberately not
    // interpolated, so a silent change to the constant fails here instead of passing.
    expect(replyText(b.replies[0]))
      .toBe('Not enough shards — this splice costs 15, you have 3 (12 short).');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.shards).toBe(3);
  });
});
```

`tests/hatchery.test.ts` — rewrite the tail of `mythic:confirm blocks below 4-star rating and on empty wallet`. First replace its title line, which stops being true once the wallet is non-empty:

```typescript
  it('mythic:confirm blocks below 4-star rating and on empty wallet', async () => {
```

with:

```typescript
  it('mythic:confirm blocks below the rating gate and on a wallet that is short', async () => {
```

Then replace these four lines (the 8★ gate half of the case, above them, is untouched):

```typescript
    ctx.db.update(schema.users).set({ ratingHighWater: MYTHIC_UNLOCK_RATING, shards: 0 }).run();
    const broke = fakeButton({ customId: 'mythic:confirm:indominus', user: 'u1' });
    await comp.execute(ctx, broke.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(broke.replies[0])).toContain('Not enough shards');
```

with:

```typescript
    ctx.db.update(schema.users).set({ ratingHighWater: MYTHIC_UNLOCK_RATING, shards: 340 }).run();
    const broke = fakeButton({ customId: 'mythic:confirm:indominus', user: 'u1' });
    await comp.execute(ctx, broke.asInteraction() as unknown as ButtonInteraction);
    // Class 1: MYTHIC_SHARD_COST is the flat literal 500 in src/data/sell.ts. It is read off
    // the error now, not the literal '500' this reply used to hardcode while the constant
    // lived in a file src/modules/hatchery/index.ts does not import.
    expect(replyText(broke.replies[0]))
      .toBe('Not enough shards — a Mythic egg costs 500, you have 340 (160 short).');
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run tests/shop.test.ts tests/expeditions.test.ts tests/guests.test.ts tests/genelab-module.test.ts tests/hatchery.test.ts`

Expected: FAIL, six cases, every one an assertion mismatch — e.g. `expected 'Not enough cash.' to be 'Not enough cash — a common egg costs 500, you have 120 (380 short).'`, `expected 'Not enough cash for that expedition.' to be 'Not enough cash — Coastal Dig costs 200, you have 45 (155 short).'`, `expected 'Not enough shards for that splice.' to be 'Not enough shards — this splice costs 15, you have 3 (12 short).'`, and `expected 'Not enough shards (need 500).' to be 'Not enough shards — a Mythic egg costs 500, you have 340 (160 short).'`.

- [ ] **Step 4: Rewrite the shop and expeditions branches**

`src/modules/shop/index.ts` — replace:

```typescript
import { InsufficientFundsError } from '../../core/economy.js';
```

with:

```typescript
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
```

and replace:

```typescript
import { FOODS, foodsForDiet } from '../../data/foods.js';
```

with:

```typescript
import { FOODS, foodsForDiet, getFood } from '../../data/foods.js';
```

Then replace the whole `catch` block of the `/shop` execute:

```typescript
        } catch (e) {
          if (e instanceof ShopError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
```

with:

```typescript
        } catch (e) {
          if (e instanceof ShopError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // `sub` is 'egg' or 'food' here — 'view' performs no charge and cannot reach this
            // branch. getFood throws on an unknown id, which buyFood's own ShopError has
            // already caught above by the time this runs.
            const what = sub === 'egg'
              ? `a ${i.options.getString('rarity', true)} egg`
              : `${i.options.getInteger('units', true)}× ${getFood(i.options.getString('item', true)).name}`;
            await i.reply({ content: `Not enough cash — ${what} ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
          }
          else throw e;
        }
```

`src/modules/expeditions/index.ts` — replace:

```typescript
import { InsufficientFundsError } from '../../core/economy.js';
```

with:

```typescript
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
```

Then replace the whole `catch` block of the `/expedition` execute:

```typescript
        } catch (e) {
          if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for that expedition.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
```

with:

```typescript
        } catch (e) {
          if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // Only `start` charges — claimExpedition credits and nothing else — but the site
            // option is read behind the `sub` check rather than unconditionally, because
            // getString('site', true) THROWS on a subcommand that does not declare it.
            const what = sub === 'start'
              ? EXPEDITION_SITES[i.options.getString('site', true)].name
              : 'that expedition';
            await i.reply({ content: `Not enough cash — ${what} ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
          }
          else throw e;
        }
```

- [ ] **Step 5: Rewrite the guests, gene lab and hatchery branches**

`src/modules/guests/index.ts` — replace:

```typescript
import { InsufficientFundsError } from '../../core/economy.js';
```

with:

```typescript
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
```

Then replace these two lines — the `InsufficientFundsError` arm of the ternary AND the `: null;` that terminates it, which the block below re-emits:

```typescript
                : e instanceof InsufficientFundsError ? 'Not enough cash.'
                : null;
```

with:

```typescript
                : e instanceof InsufficientFundsError
                  // `kind` was validated by attractionFor inside the service and the
                  // UnknownAttractionError arm above is evaluated first, so ATTRACTIONS[kind]
                  // is a real def here. The cost comes off the error, which is what lets ONE
                  // clause serve both halves — build and upgrade have different prices and the
                  // upgrade price needs levelValue, which this module does not import.
                  ? `Not enough cash — the ${ATTRACTIONS[kind].name} ${shortfallLine(e)}.`
                : null;
```

`src/modules/genelab/index.ts` — replace:

```typescript
import { InsufficientFundsError } from '../../core/economy.js';
```

with:

```typescript
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
```

Then the three arms. The `/breed` command's arm and `breed:confirm`'s arm are byte-identical lines — and so is the `} catch (e) {` + `BreedError` pair above each — so each replacement below carries enough preceding context to be unique. For `/breed`, replace:

```typescript
            }));
          }
        } catch (e) {
          if (e instanceof BreedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for that pairing.', flags: MessageFlags.Ephemeral });
```

with:

```typescript
            }));
          }
        } catch (e) {
          if (e instanceof BreedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          // Backstop only: startBreeding pre-checks affordability OUTSIDE its transaction and
          // throws a BreedError already carrying both numbers, so nothing the current code
          // accepts reaches this arm. Rendered the same way as the reachable sites so it
          // cannot rot into a different shape if that pre-check is ever relaxed.
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `Not enough cash — this pairing ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
```

For `breed:confirm`, replace:

```typescript
          await i.update({ content: '🧬 Pairing started — check `/breed status`.', embeds: [], components: [], attachments: [] });
        } catch (e) {
          if (e instanceof BreedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for that pairing.', flags: MessageFlags.Ephemeral });
```

with:

```typescript
          await i.update({ content: '🧬 Pairing started — check `/breed status`.', embeds: [], components: [], attachments: [] });
        } catch (e) {
          if (e instanceof BreedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          // Backstop only, same reason as /breed's arm above.
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `Not enough cash — this pairing ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
```

For `splice:confirm` — this one IS reachable — replace:

```typescript
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough shards for that splice.', flags: MessageFlags.Ephemeral });
```

with:

```typescript
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `Not enough shards — this splice ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
```

`src/modules/hatchery/index.ts` — replace:

```typescript
import { InsufficientFundsError } from '../../core/economy.js';
```

with:

```typescript
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
```

Then replace:

```typescript
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough shards (need 500).', flags: MessageFlags.Ephemeral });
```

with:

```typescript
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `Not enough shards — a Mythic egg ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/shop.test.ts tests/expeditions.test.ts tests/guests.test.ts tests/genelab-module.test.ts tests/genelab.test.ts tests/hatchery.test.ts tests/shards.test.ts`

Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.test.json`

Expected: exit 0, no output.

- [ ] **Step 8: Commit**

```bash
git add src/modules/shop/index.ts src/modules/expeditions/index.ts src/modules/guests/index.ts src/modules/genelab/index.ts src/modules/hatchery/index.ts tests/shop.test.ts tests/expeditions.test.ts tests/guests.test.ts tests/genelab-module.test.ts tests/hatchery.test.ts
git commit -m "feat(shop,expeditions,guests,genelab,hatchery): quote cost and balance on insufficient funds"
```

---

---

### Task 4: Quote the shortfall in care, and rewrite the one unreachable backstop in trading

_Stable id: `G1-D`_

The branches this slice has not reached yet — `grep -n "e instanceof InsufficientFundsError" src/modules/care/index.ts src/modules/trading/index.ts` lists them. Care's pair is the interesting one: `/feed one` is the only site in the repo already interpolating `e.message`, and it is the site the spec's third worked example describes. Trading's is a backstop the current code cannot reach, and it is treated as such rather than pretended into behaviour.

**`src/modules/battles/index.ts` is deliberately NOT edited.** Its two `InsufficientFundsError` arms (`Not enough resources for that fight.`) are unreachable backstops — `runFight`'s single `economy.apply` is a pure payout guarded by `if (won)` with every component non-negative, and a fight's real price is ENERGY, deducted by a direct `db.update` and refused by `BattleError`. The spec says flatly "Nothing in battles changes" (§5.4), no behavioural test could cover the edit, and leaving them alone keeps that line true and the diff smaller.

**`src/modules/admin/service.ts` is EXPLICITLY out of scope and must not be edited.** Its `shortfallOf` helper derives `needed` from the target `tx_log` row's own `cashDelta`/`shardsDelta`/`foodDelta` and reads balances AFTER the reversal transaction has rolled back. Those two figures happen to be arithmetically equal to the new `e.needed`/`e.held`, which makes "simplify it to use the error" look like an obvious cleanup — do not. It is an operator surface with its own wording, the spec names it untouched, and its comment records why it reads post-rollback. Leave the file alone entirely.

**Files:**
- Modify: `src/modules/care/index.ts` — the `InsufficientFundsError` import, the whole `catch` block of the `/feed` execute, the whole `catch` block of the `/rescue` execute
- Modify: `src/modules/trading/index.ts` — the `InsufficientFundsError` import, the `InsufficientFundsError` arm of the `/trade` execute's catch
- Test: `tests/care.test.ts` — the `drizzle-orm` import line extended, one existing case replaced whole, one new case inserted

Task 18 (G6-B) later widens `rescuePayload` and adds the care module's first component prefix, inside the same file; this task lands first and every edit here is anchored on quoted text.

**Interfaces:**
- Consumes: from Task 1 (G1-A) — `shortfallLine(e: InsufficientFundsError): string`, plus `e.wallet`, `e.foodId`, `e.needed` and `e.held`.
- Produces: no new exported symbols.

- [ ] **Step 1: Write the rescue case**

In `tests/care.test.ts`, replace the entire `it('maps InsufficientFundsError to the recapture-fee message', …)` block — its `it(` line through its own closing `});`. It sits inside `describe('/rescue execute')`, which binds `rescueCmd`; that describe's own `});` follows and must be left alone. Replacing a shorter range leaves a stray `await rescueCmd.execute(…)`, an orphan `});` and the old `toContain('recapture fee')` behind — and that stale assertion then fails against the new wording.

Replace:

```typescript
  it('maps InsufficientFundsError to the recapture-fee message', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, escapedAt: 100,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('recapture fee');
  });
```

with:

```typescript
  it('maps InsufficientFundsError to a priced recapture message', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 90 }).run();
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, escapedAt: 100,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    // RECAPTURE_FEE_HOURS (4) x RARITY.common.incomePerHr (60) = 240 for a Triceratops. The
    // fee is deliberately NOT event-modified — eventMods is imported in care/service.ts only
    // for feedCostFor — so this literal holds on every day, unlike the shop's two-multiplier
    // prices in Task 3 (G1-C).
    expect(replyText(i.replies[0]))
      .toBe('Not enough cash — that recapture costs 240, you have 90 (150 short).');
  });
```

- [ ] **Step 2: Write the feed case**

First extend the `drizzle-orm` import — the new case needs `and`. Replace:

```typescript
import { eq } from 'drizzle-orm';
```

with:

```typescript
import { eq, and } from 'drizzle-orm';
```

Then insert the case at the end of `describe('care module', …)`, immediately after the wrong-diet case. Anchor on these four lines:

```typescript
    expect(reply.content).toBe("Triceratops is a herbivore — it won't eat Fish.");
    expect(reply.flags).toBeDefined();
  });
});
```

and replace them with:

```typescript
    expect(reply.content).toBe("Triceratops is a herbivore — it won't eat Fish.");
    expect(reply.flags).toBeDefined();
  });

  it('/feed one names the food and quotes the shortfall in units, not cash', async () => {
    const d = addDino();
    ctx.db.update(schema.foodInventory).set({ qty: 1 })
      .where(and(eq(schema.foodInventory.userId, 'u1'), eq(schema.foodInventory.foodId, 'ferns'))).run();
    const cmd = careModule.commands.find((c) => c.data.name === 'feed')!;
    // The food is named explicitly: feedDino only pre-checks stock when it AUTO-picks
    // (pickFood), so naming it is what routes the failure through economy.apply and this
    // catch rather than through pickFood's own CareError.
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: d.id, food: 'ferns' } });
    await cmd.execute(ctx, i.asChatInput());
    // feedCostFor('common', [], 0) is 5 — one world-event multiplier (eventMods(0).feedCost),
    // neutral at 1 on clear_skies. "need", never "costs": food is a count of units. feedDino
    // has no "not hungry" guard, so a default addDino() at now=0 still charges.
    expect(replyText(i.replies[0]))
      .toBe('Not enough Ferns — need 5, you have 1 (4 short). Buy more with /shop food.');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
});
```

- [ ] **Step 3: Run the rescue test and watch it fail**

Run: `npx vitest run tests/care.test.ts -t "recapture"`

Expected: FAIL — `expected 'Not enough cash for the recapture fee.' to be 'Not enough cash — that recapture costs 240, you have 90 (150 short).'`

- [ ] **Step 4: Run the feed test and watch it fail**

Run: `npx vitest run tests/care.test.ts -t "quotes the shortfall in units"`

Expected: FAIL — `expected 'Insufficient Ferns — buy more with /shop food.' to be 'Not enough Ferns — need 5, you have 1 (4 short). Buy more with /shop food.'`

(Two separate commands, never `A && B`. Under this repo's primary shell, Windows PowerShell 5.1, `&&` is a parser error and neither would run; and even under bash the first command is EXPECTED to exit non-zero, so `&&` would short-circuit and the second failure could never be observed.)

- [ ] **Step 5: Rewrite the two care branches**

Replace:

```typescript
import { InsufficientFundsError } from '../../core/economy.js';
```

with:

```typescript
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
```

Then replace the whole `catch` block of the `/feed` execute:

```typescript
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `${e.message} — buy more with /shop food.`, flags: MessageFlags.Ephemeral });
          else throw e;
        }
```

with:

```typescript
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // /feed spends only food, so this is always the food wallet — but the noun is
            // derived from the error rather than assumed, because `wallet` is what decides
            // whether shortfallLine says "need" or "costs" and the two must not disagree.
            const what = e.foodId ? FOODS[e.foodId].name : e.wallet;
            await i.reply({
              content: `Not enough ${what} — ${shortfallLine(e)}. Buy more with /shop food.`,
              flags: MessageFlags.Ephemeral,
            });
          }
          else throw e;
        }
```

And replace the whole `catch` block of the `/rescue` execute:

```typescript
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for the recapture fee.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
```

with:

```typescript
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: `Not enough cash — that recapture ${shortfallLine(e)}.`, flags: MessageFlags.Ephemeral });
          else throw e;
        }
```

- [ ] **Step 6: Run the care tests and watch them pass**

Run: `npx vitest run tests/care.test.ts tests/feed-skip.test.ts tests/autocomplete-care.test.ts`

Expected: PASS.

- [ ] **Step 7: Rewrite the trading backstop**

This branch cannot be reached by any input the current code accepts, so no behavioural test can cover it and none is written. The comment records why, so nobody hunts for the missing test.

`src/modules/trading/index.ts` — replace:

```typescript
import { InsufficientFundsError } from '../../core/economy.js';
```

with:

```typescript
import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';
```

Then replace the whole `catch` block of the `/trade` execute:

```typescript
        } catch (e) {
          if (e instanceof TradeError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash/food for that trade.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
```

with:

```typescript
        } catch (e) {
          if (e instanceof TradeError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // Backstop only: acceptTrade runs verifySide over BOTH sides before its
            // transaction, and verifySide already refuses a side that cannot cover its own
            // cash and food with a TradeError. Each side's net is bounded below by what it
            // gives, which verifySide proved it holds, so neither apply can overdraw.
            //
            // shortfallLine is deliberately NOT used here — the one place in this sweep that
            // skips it. acceptTrade applies to trade.fromUser first, so if this ever did fire
            // the numbers could describe the SENDER's wallet while the reply is shown to the
            // recipient, and shortfallLine says "you have", which would then be a false
            // statement about the reader's own balance. The gap is quoted without claiming
            // whose it is.
            const what = e.foodId ? FOODS[e.foodId].name : e.wallet;
            const short = (e.needed - e.held).toLocaleString('en-US');
            await i.reply({
              content: `Not enough ${what} for that trade — one side is ${short} short.`,
              flags: MessageFlags.Ephemeral,
            });
          }
          else throw e;
        }
```

`FOODS` is already imported by this file — confirm with `grep -n "data/foods.js" src/modules/trading/index.ts`.

- [ ] **Step 8: Run the full suite and re-enumerate the sweep**

Run: `npx vitest run`

Expected: PASS, zero failures.

Then re-enumerate the catch sites with `grep -rn "e instanceof InsufficientFundsError" src/modules/*/*.ts` and confirm that every match either sits beside a `shortfallLine` call or is one of the three documented exceptions: `src/modules/trading/index.ts` (Step 7's reasoning), `src/modules/battles/index.ts` (§5.4, untouched by design) and `src/modules/admin/service.ts` (its own `shortfallOf`, out of scope).

That grep is a snapshot of the tree at THIS point in the plan, not a permanent invariant: Task 18 (G6-B), Task 21 (G7-C) and Task 25 (G7-F) each add a new `InsufficientFundsError` catch site later, and each of those three carries its own obligation to render `Not enough <what> — ${shortfallLine(e)}.` Do not read a clean grep here as proof the sweep stays complete.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.test.json`

Expected: exit 0, no output.

- [ ] **Step 10: Commit**

```bash
git add src/modules/care/index.ts src/modules/trading/index.ts tests/care.test.ts
git commit -m "feat(care,trading): quote the shortfall on the remaining insufficiency replies"
```

---

### Task 5: `nextLotSlot(highWater)` beside `lotSlots`

_Stable id: `G2-A`_

Adds the pure helper §5.2 needs: given a player's **monotone** `ratingHighWater`, which lot slot
is next and what rating unlocks it — or `null` once every rung of `LOT_SLOT_THRESHOLDS` is
passed. No caller yet; Task 6 (G2-B) is the only consumer.

Background you need and nothing else: `src/data/progression.ts` already exports
`BASE_LOT_SLOTS_FALLBACK = 3` (line 14) and
`LOT_SLOT_THRESHOLDS = [100, 200, 400, 600, 800, 880, 950]` (line 15), described in that line's
own trailing comment as "high-water for slots 4..10". `lotSlots(hw)` (lines 25-27) is
`BASE_LOT_SLOTS_FALLBACK + (thresholds <= hw)`, so it returns 3 at high-water 0 and caps at 10.
Ratings are stored ×100 everywhere in this repo: `620` renders as `★6.2`.

**Files:**
- Modify: `src/data/progression.ts` — insert between the closing `}` of `export function
  lotSlots` and the line `export function shopCeiling(highWater: number): Rarity {`
- Test: `tests/rating.test.ts` — extend the import line
  `import { LOT_SLOT_THRESHOLDS } from '../src/data/progression.js';`, then append a new
  `describe` at the very end of the file

**Interfaces:**
- Consumes: nothing from any other task.
- Produces: `export function nextLotSlot(highWater: number): { slot: number; threshold: number } | null`
  in `src/data/progression.ts`. Consumed by Task 6 (G2-B).

- [ ] **Step 1: Write the failing test**

(a) In `tests/rating.test.ts`, replace the whole line

```typescript
import { LOT_SLOT_THRESHOLDS } from '../src/data/progression.js';
```
with
```typescript
import { LOT_SLOT_THRESHOLDS, BASE_LOT_SLOTS_FALLBACK, nextLotSlot } from '../src/data/progression.js';
```

`lotSlots` is already imported one line above, from `../src/modules/park/rating.js`, which
re-exports it — leave that line alone.

(b) Append this to the very end of the file, after the final `});`:

```typescript
describe('nextLotSlot', () => {
  it('names the next slot and its threshold on BOTH sides of every boundary, and null once exhausted', () => {
    // Written out as a literal table rather than derived from LOT_SLOT_THRESHOLDS on
    // purpose: a loop that recomputes the slot number the same way the implementation does
    // would pass against an off-by-one living in both. Every pair straddles one rung, so a
    // `<=` written for `<` fails the second row of each pair.
    const cases: Array<[number, { slot: number; threshold: number } | null]> = [
      [0, { slot: 4, threshold: 100 }],
      [99, { slot: 4, threshold: 100 }],
      [100, { slot: 5, threshold: 200 }],
      [199, { slot: 5, threshold: 200 }],
      [200, { slot: 6, threshold: 400 }],
      [399, { slot: 6, threshold: 400 }],
      [400, { slot: 7, threshold: 600 }],
      [599, { slot: 7, threshold: 600 }],
      [600, { slot: 8, threshold: 800 }],
      [799, { slot: 8, threshold: 800 }],
      [800, { slot: 9, threshold: 880 }],
      [879, { slot: 9, threshold: 880 }],
      [880, { slot: 10, threshold: 950 }],
      [949, { slot: 10, threshold: 950 }],
      [950, null],
      [9999, null],
    ];
    for (const [hw, expected] of cases) expect(nextLotSlot(hw), `high-water ${hw}`).toEqual(expected);
  });

  it('advertises exactly one slot past the slots lotSlots already grants', () => {
    // The invariant that makes the rendered sentence true — "All lots full (7/7). Slot 8
    // unlocks at…" is only honest while the advertised slot is lotSlots(hw) + 1. The two
    // functions read the same array from the same file and nothing else couples them.
    for (const hw of [0, 99, 100, 399, 400, 799, 800, 879, 880, 949, 950, 9999]) {
      const next = nextLotSlot(hw);
      if (next === null) {
        expect(lotSlots(hw), `high-water ${hw}`).toBe(BASE_LOT_SLOTS_FALLBACK + LOT_SLOT_THRESHOLDS.length);
      } else {
        expect(next.slot, `high-water ${hw}`).toBe(lotSlots(hw) + 1);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/rating.test.ts`

Expected: FAIL, exactly 2 tests — `nextLotSlot > names the next slot and its threshold on BOTH
sides of every boundary, and null once exhausted` and `nextLotSlot > advertises exactly one slot
past the slots lotSlots already grants`. The file **collects normally**: vitest's SSR transform
resolves a missing named export to `undefined` rather than throwing, so this is NOT a collection
error and NOT a `SyntaxError`; both cases fail at the call site with
`TypeError: nextLotSlot is not a function`. Every pre-existing case in the file still passes.

- [ ] **Step 3: Add `nextLotSlot` to `src/data/progression.ts`**

Insert this directly below the closing `}` of `lotSlots` and directly above
`export function shopCeiling(highWater: number): Rarity {`:

```typescript
/**
 * The next lot slot the player has NOT unlocked, and the high-water rating that unlocks it —
 * or null once every rung of LOT_SLOT_THRESHOLDS is passed.
 *
 * `BASE_LOT_SLOTS_FALLBACK + idx + 1` and not `idx + 1`: LOT_SLOT_THRESHOLDS[0] gates slot 4,
 * not slot 1, which is the same offset lotSlots applies by adding the base to a count of
 * passed rungs. The invariant the caller renders against is
 * `nextLotSlot(hw)!.slot === lotSlots(hw) + 1`.
 *
 * Unlike lotSlots' filter, findIndex relies on LOT_SLOT_THRESHOLDS being ASCENDING; it is,
 * and a rung inserted out of order would silently advertise the wrong slot.
 */
export function nextLotSlot(highWater: number): { slot: number; threshold: number } | null {
  const idx = LOT_SLOT_THRESHOLDS.findIndex((t) => highWater < t);
  if (idx === -1) return null;
  return { slot: BASE_LOT_SLOTS_FALLBACK + idx + 1, threshold: LOT_SLOT_THRESHOLDS[idx] };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/rating.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Break the boundary comparison, watch that specific row fail, restore**

A boundary nobody has watched fail is not yet pinned. In `src/data/progression.ts`, change
`(t) => highWater < t` to `(t) => highWater <= t`, then run
`npx vitest run tests/rating.test.ts`.

Expected: FAIL, exactly 2 tests — both new ones, and nothing else in the file.
Each `for` loop aborts at its FIRST failing row, so the below-the-rung rows pass and the
at-the-rung row is what is reported:
- `names the next slot and its threshold on BOTH sides of every boundary…` fails at
  `high-water 100`, expected `{ slot: 5, threshold: 200 }`, received `{ slot: 4, threshold: 100 }`.
  (The `high-water 950` row is never reached in that run — the loop has already stopped.)
- `advertises exactly one slot past the slots lotSlots already grants` fails at
  `high-water 100`, expected `5`, received `4`.

Then restore `<` and re-run to confirm PASS again before continuing.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no output. (`npm run build` includes only `src`, and vitest transpiles
without typechecking, so this is the only gate that sees the edited test file.)

- [ ] **Step 7: Commit**
```bash
git add src/data/progression.ts tests/rating.test.ts
git commit -m "feat(progression): add nextLotSlot beside lotSlots"
```

---

---

### Task 6: the slot-cap message names the slot, its threshold and both ratings

_Stable id: `G2-B`_

Spec §5.2. `LotLimitError` (`src/modules/park/service.ts:14`) carries no message and is thrown
for **two different reasons**: out of lot slots (`buildLot`, `service.ts:110`) and already at max
level (`upgradeLot`, `service.ts:165`). Its text is therefore hardcoded per call site, and
`docs/conventions/park-surface.md` §per-menu-error-mapping forbids a shared mapping. This task
rewrites only the two **slot-cap** sites; Task 7 (G2-C) owns the other two. Do not touch
`src/modules/admin/service.ts`'s `shortfallOf` — a different feature entirely (spec §5.1).

Target sentences, exactly:

```
All lots full (7/7). Slot 8 unlocks at ★8.0 — you're at ★6.2 (best ★6.4).
All lots full (10/10) — every slot is unlocked.
```

Both ratings appear on purpose: the gate reads the monotone `ratingHighWater`, while
`parkRating` is live and falls as comfort decays, so a player whose live rating has dipped
below their best would otherwise read the message as the gate having moved under them.

**ANCHOR ON QUOTED TEXT, NEVER ON A LINE NUMBER.** Task 2 (G1-B) lands before this task and rewrites
the `/build` execute body, the `/upgrade` catch, `park:landmark:buy`, `park:buildyes` and
`park:upgyes` in the same file, and adds cases to both test files this task edits. Every line
number below is a *hint about where to look in the pre-G1 tree*; the string is what identifies
the edit. The four lines this task replaces are byte-identical before and after Task 2 (G1-B) — G1-B
touches only the `InsufficientFundsError` arms, never the `LotLimitError` ones — so each quoted
snippet matches exactly once either way.

**Files:**
- Modify: `src/modules/park/index.ts`
  - the progression import, currently `import { lotSlots } from '../../data/progression.js';`
    (~line 36)
  - a new module-scope helper, inserted between the closing `}` of `dinoListPayload` and the
    line `export const parkModule: ModuleManifest = {` (~lines 95-97)
  - the `/build` command's catch — the line beginning
    `          else if (e instanceof LotLimitError) await i.reply({ content: 'All lots full.`
    (~line 250)
  - `case 'buildyes'`'s catch — the line
    `                await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });`
    (~line 788), identified by its sixteen leading spaces and the `} else if (e instanceof LotLimitError) {` immediately above it
- Test: `tests/lot-menus.test.ts` — a NEW top-level `describe` inserted immediately before the
  line `describe('upgrade menu', () => {`
- Test: `tests/park.test.ts` — two edits inside
  `it('/build maps LotLimitError and InsufficientFundsError to ephemeral replies', …)`,
  both anchored on assertion text

**Interfaces:**
- Consumes:
  - `nextLotSlot(highWater: number): { slot: number; threshold: number } | null` from Task 5 (G2-A)
    (`src/data/progression.ts`).
  - Already present in `src/modules/park/index.ts`: `lotSlots(highWater: number): number`
    (imported from `../../data/progression.js`), `Ctx` (type import), `schema`, `eq`.
  - `replyText(r: unknown): string` in `tests/lot-menus.test.ts`'s harness import — **added by
    Task 2 (G1-B)**, which owns that line. This task only confirms it is there (Step 1a).
- Produces: module-private `function lotSlotCapLine(ctx: Ctx, userId: string): string` in
  `src/modules/park/index.ts`. Not exported; consumed by nothing outside this file.

- [ ] **Step 1: Write the failing tests**

(a) Confirm — do not re-add — `replyText` in `tests/lot-menus.test.ts`'s harness import. Task 2 (G1-B) already rewrote that line to
`import { makeCtx, fakeButton, fakeSelect, replyText } from './harness.js';` (and line 4 to
`import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';`). Verify with:

```bash
grep -n "replyText" tests/lot-menus.test.ts | head -1
```

Expected: a hit on the harness import line. If there is no hit, Task 2 (G1-B) has not landed and this
task is out of order — stop and land it first.

(b) In the same file, insert this WHOLE new `describe` block immediately **before** the line
`describe('upgrade menu', () => {` (currently line 251), i.e. after the `});` that closes
`describe('build menu mint', …)`.

Do NOT put these cases inside `describe('build menu')`. That block is introduced by a comment
beginning "The five cases above all drive the SELECT HANDLER against a fakeSelect" — prose that
is already false today (`describe('build menu')` holds nine `it`s and five of them already drive
`fakeButton`; derive with `grep -c "  it(" tests/lot-menus.test.ts` scoped to that block).
Growing it further compounds a stale claim for no benefit, and a separate block reads better
anyway. Do not insert it *above* that comment either: the comment says "above" and would then
point at this new block.

```typescript
// The BUILD CONFIRM button, not the menu: park:buildyes is what reaches buildLot, and
// buildLot's slot-cap throw is the only way to observe the LotLimitError message at all.
// §5.2. LotLimitError carries no message and means two different things (slot cap in
// buildLot, already-max-level in upgradeLot), so this block pins the BUILD half only.
describe('build confirm', () => {
  it('names the slot, its threshold and BOTH ratings when slots remain locked', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (let n = 0; n < 7; n++) {
      ctx.db.insert(schema.lots).values({
        userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
      }).run();
    }
    // lotSlots(640) is 7, so seven lots fill the cap and nextLotSlot(640) is slot 8 at 800.
    // parkRating sits BELOW ratingHighWater deliberately: the gate reads the high-water, and
    // rendering one figure twice is the mistake this case exists to catch.
    ctx.db.update(schema.users)
      .set({ cash: 10_000_000, parkRating: 620, ratingHighWater: 640 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:7', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    // The WHOLE line, never a substring holding one of the four numbers: three of them are
    // one decimal place apart, so a substring assertion on any one of them passes a sentence
    // that quotes another wrongly.
    expect(replyText(b.replies[0]))
      .toBe("All lots full (7/7). Slot 8 unlocks at ★8.0 — you're at ★6.2 (best ★6.4).");
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(7);
  });

  it('says every slot is unlocked once the threshold ladder is exhausted', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (let n = 0; n < 10; n++) {
      ctx.db.insert(schema.lots).values({
        userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
      }).run();
    }
    // 950 is the last rung, so nextLotSlot returns null and the sentence must not promise a
    // slot 11 that LOT_SLOT_THRESHOLDS has no rung for.
    ctx.db.update(schema.users)
      .set({ cash: 10_000_000, parkRating: 950, ratingHighWater: 950 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:10', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0])).toBe('All lots full (10/10) — every slot is unlocked.');
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(10);
  });

  it('reads the lot COUNT and the CAP from different sources', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Eight rows against a cap of seven. This state is NOT reachable through buildLot —
    // ratingHighWater is monotone so the cap never falls, and lot rows only ever grow — and
    // that is exactly why the row is here. At every reachable state the two halves of the
    // slash are EQUAL (buildLot throws at `lots.length >= lotSlots(hw)`), so without one
    // row where they differ, `${lots}/${cap}` could be written `${lots}/${lots}` or
    // `${cap}/${cap}` and every other case in this block would still pass.
    for (let n = 0; n < 8; n++) {
      ctx.db.insert(schema.lots).values({
        userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
      }).run();
    }
    ctx.db.update(schema.users)
      .set({ cash: 10_000_000, parkRating: 620, ratingHighWater: 640 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:8', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0]))
      .toBe("All lots full (8/7). Slot 8 unlocks at ★8.0 — you're at ★6.2 (best ★6.4).");
  });
});
```

Every other name these cases use — `MessageFlags`, `getOrCreateUser`, `schema`, `eq`,
`fakeButton`, `parkComp`, and the file-level `ctx` `beforeEach` — is already at the top of
`tests/lot-menus.test.ts`.

(c) In `tests/park.test.ts`, inside
`it('/build maps LotLimitError and InsufficientFundsError to ephemeral replies', …)`, make two
edits, both anchored on the assertion text rather than a line number (Task 2 (G1-B) has already
inserted two cases earlier in this file, so every absolute number in this region has drifted).

First, insert three lines immediately **after** the existing guard line

```typescript
    expect(lotSlots(ctx.db.select().from(schema.users).all()[0].ratingHighWater)).toBe(3);
```
so that the guard is followed by:
```typescript
    // Pinned so the whole sentence can be asserted literally. lotSlots(90) is still 3, so the
    // cap still trips, and the live rating is set BELOW the best — the case the message
    // exists to disambiguate.
    ctx.db.update(schema.users).set({ parkRating: 40, ratingHighWater: 90 }).run();
```

Second, replace the whole line

```typescript
    expect(replyText(full.replies[0])).toContain('All lots full');
```
with
```typescript
    expect(replyText(full.replies[0]))
      .toBe("All lots full (3/3). Slot 4 unlocks at ★1.0 — you're at ★0.4 (best ★0.9).");
```

Leave the rest of that test alone: the `ctx.db.delete(schema.lots).run()` / `cash: 0` half below
still reaches the `InsufficientFundsError` branch Task 2 (G1-B) rewrote, unchanged.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/lot-menus.test.ts tests/park.test.ts`

Do NOT add a `-t` filter. `-t` matches the TEST NAME (describe path + it name), not the
assertion text, and a filter written against the message wording matches nothing at all. Both
files are green as Task 2 (G1-B) left them (its own Step 4 runs them), so any red here is
attributable to this task.

Expected: FAIL, exactly 4 tests —
- `build confirm > names the slot, its threshold and BOTH ratings when slots remain locked`
- `build confirm > says every slot is unlocked once the threshold ladder is exhausted`
- `build confirm > reads the lot COUNT and the CAP from different sources`
- `/upgrade, /decorate, /park rename, /dino unassign, park:collect > /build maps LotLimitError and InsufficientFundsError to ephemeral replies`

each reporting the old hardcoded string, e.g.
`expected 'All lots full. More slots unlock with park rating.' to be "All lots full (7/7). Slot 8 unlocks at ★8.0 — you're at ★6.2 (best ★6.4)."`

- [ ] **Step 3: Widen the progression import**

In `src/modules/park/index.ts`, replace the whole line

```typescript
import { lotSlots } from '../../data/progression.js';
```
with
```typescript
import { lotSlots, nextLotSlot } from '../../data/progression.js';
```

- [ ] **Step 4: Add `lotSlotCapLine` and rewrite the two slot-cap catch sites**

(a) Insert this helper in the module-scope helper region — after the closing `}` of
`dinoListPayload` (the function that ends `  attach(embed, payload, 'image', assetImage('banners', 'dino_roster', userId));` /
`  return payload;` / `}`) and before `export const parkModule: ModuleManifest = {`:

```typescript
/**
 * The slot-cap sentence for a LotLimitError thrown by `buildLot`. `upgradeLot` throws the SAME
 * class to mean "already at max level" — see `maxLevelLine` and §per-menu-error-mapping — so a
 * shared mapping here would tell a player "All lots full" when they meant the other thing.
 *
 * Both ratings are named on purpose. The gate reads `ratingHighWater`, which is monotone,
 * while `parkRating` is live and falls as comfort decays; a player whose live rating has
 * dipped below their best would otherwise read this as the gate having moved under them.
 *
 * Reads the row and the count itself rather than taking them as parameters: it runs on an
 * error path only, after the transaction has already rolled back, and the two call sites hold
 * different subsets of what it needs. The `!` is sound because buildLot reads that row and
 * dereferences `user.ratingHighWater` on the line immediately above its throw — an absent row
 * would have crashed there with a TypeError, so reaching this line proves it exists.
 */
function lotSlotCapLine(ctx: Ctx, userId: string): string {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get()!;
  const lots = ctx.db.select().from(schema.lots)
    .where(eq(schema.lots.userId, userId)).all().length;
  const head = `All lots full (${lots}/${lotSlots(user.ratingHighWater)})`;
  const next = nextLotSlot(user.ratingHighWater);
  if (!next) return `${head} — every slot is unlocked.`;
  return `${head}. Slot ${next.slot} unlocks at ★${(next.threshold / 100).toFixed(1)}`
    + ` — you're at ★${(user.parkRating / 100).toFixed(1)} (best ★${(user.ratingHighWater / 100).toFixed(1)}).`;
}
```

(b) In the `/build` command's catch, replace the whole line

```typescript
          else if (e instanceof LotLimitError) await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
```
with
```typescript
          else if (e instanceof LotLimitError) await i.reply({ content: lotSlotCapLine(ctx, i.user.id), flags: MessageFlags.Ephemeral });
```

The `else if` prefix and the ten leading spaces are what distinguish this from the button site in
(c); `grep -n "All lots full" src/modules/park/index.ts` returns both, and only this one begins
with `else if`.

(c) In `case 'buildyes'`'s catch, replace the whole line

```typescript
                await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
```
with
```typescript
                await i.reply({ content: lotSlotCapLine(ctx, i.user.id), flags: MessageFlags.Ephemeral });
```

Sixteen leading spaces, no `else if` on the same line; the `} else if (e instanceof LotLimitError) {`
above it and the comment block beginning "Mapped for the BUILD menu specifically" stay exactly as
they are.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/lot-menus.test.ts tests/park.test.ts`
Expected: `Test Files  2 passed (2)`, 0 failed.

- [ ] **Step 6: Break the live-vs-high-water split, watch those assertions fail, restore**

The whole reason two ratings are printed is that they can differ. Prove the tests can see it: in
`lotSlotCapLine`, change `${(user.parkRating / 100).toFixed(1)}` to
`${(user.ratingHighWater / 100).toFixed(1)}`, then run
`npx vitest run tests/lot-menus.test.ts tests/park.test.ts`.

Expected: FAIL, exactly 3 tests — the two cases that seed a live rating below the best
(`build confirm > names the slot, its threshold and BOTH ratings when slots remain locked`,
`build confirm > reads the lot COUNT and the CAP from different sources`) and the
`/build maps LotLimitError…` case. The `10/10` case still passes, because its sentence quotes no
rating at all. The first is reported as
`expected "All lots full (7/7). Slot 8 unlocks at ★8.0 — you're at ★6.4 (best ★6.4)." to be "All lots full (7/7). Slot 8 unlocks at ★8.0 — you're at ★6.2 (best ★6.4)."`

Restore `user.parkRating` and re-run to confirm PASS.

- [ ] **Step 7: Break the count-vs-cap head, watch that one row fail, restore**

In `lotSlotCapLine`, change the head to `` const head = `All lots full (${lots}/${lots})`; ``,
then run `npx vitest run tests/lot-menus.test.ts tests/park.test.ts`.

Expected: FAIL, exactly 1 test — `build confirm > reads the lot COUNT and the CAP from different
sources`, reporting `expected 'All lots full (8/8). …' to be "All lots full (8/7). …"`. Every
other case passes, which is the point: at every state buildLot can actually reach, the two
halves are equal and nothing else can tell them apart.

Restore `lotSlots(user.ratingHighWater)` and re-run to confirm PASS.

- [ ] **Step 8: Run the wider park surface and typecheck**

Run: `npx vitest run tests/lot-menus.test.ts tests/park.test.ts tests/park-tabs.test.ts`
Expected: PASS on all three files.

Then run: `npm run typecheck`
Expected: exits 0 with no output. (Two separate commands, not chained with `&&`: PowerShell 5.1
parses `&&` as a syntax error.)

- [ ] **Step 9: Commit**
```bash
git add src/modules/park/index.ts tests/lot-menus.test.ts tests/park.test.ts
git commit -m "feat(park): name the next lot slot and both ratings on the slot-cap error"
```

---

---

### Task 7: the already-max-level message names the cap and the capacity

_Stable id: `G2-C`_

Spec §5.3. The other two `LotLimitError` catch sites — the ones fed by `upgradeLot`
(`src/modules/park/service.ts`, `if (lot.level >= maxLevel) throw new LotLimitError();`).

Target sentences:

```
Already max level (4) — that paddock holds 8.
Already max level (3) — the Gene Lab is fully upgraded.
```

The cap must be **read off the def, never written into the string**: a paddock caps at 4,
`gene_lab` and `food_court` at 3, `visitor_center` and `hatchery_lab` at 5. A `PaddockDef`
(`src/data/types.ts:19`) has no `maxLevel` field at all, and today the paddock cap is a bare
literal repeated across the codebase — enumerate the copies with
`grep -rn 'maxLevel ?? 4\|def.maxLevel : 4' src/`. Writing one more copy inside the message would
leave the sentence quoting a stale cap AND a stale capacity if the paddock cap ever moved, with
nothing red. So this task first collapses them into one exported resolver, then renders from it.
That mirrors `upgradeCostFor`'s own docstring in the same file: "One helper so the autocomplete
label, the failure message and the actual charge cannot disagree."

Capacity comes from `paddockCapacity(level) => 2 * level` (`src/modules/park/dinos.ts:19`,
already imported in `index.ts`).

**ANCHOR ON QUOTED TEXT, NEVER ON A LINE NUMBER.** Task 2 (G1-B) and Task 6 (G2-B) both land before this
one and both edit `src/modules/park/index.ts`, `tests/park.test.ts` and `tests/lot-menus.test.ts`
— Task 6 (G2-B) alone inserts a whole `describe` block above the `upgrade menu` block this task
appends to. Line numbers quoted below describe the pre-G1 tree and are hints only.

**Files:**
- Modify: `src/modules/park/service.ts`
  - two new exports inserted after `export const BASE_LOT_SLOTS = 3;` (~line 13)
  - in `upgradeLot`, the two lines `  const def = FACILITIES[lot.kind];` and
    `  const maxLevel = def ? def.maxLevel : 4;                       // paddock max level 4 (capacity 8)`
    (~lines 163-164) collapse to one
- Modify: `src/modules/park/index.ts`
  - the `./service.js` import line (the long one beginning
    `import { getOrCreateUser, buildLot, upgradeLot, upgradeCostFor,`)
  - the `/upgrade` autocomplete's `            const maxLevel = FACILITIES[l.kind]?.maxLevel ?? 4;`
    (~line 298)
  - `renderTab`'s lots branch: the three-line `?? 4` comment plus
    `      .filter((l) => l.level < (FACILITIES[l.kind]?.maxLevel ?? 4))` (~lines 1016-1020)
  - a second module-scope helper, directly below `lotSlotCapLine` from Task 6 (G2-B)
  - the `/upgrade` command's catch — the line beginning
    `          if (e instanceof LotLimitError) await i.reply({ content: 'Already max level.'`
    (~line 275)
  - `case 'upgyes'`'s catch — the line
    `                await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });`
    (~line 835), identified by its sixteen leading spaces
- Test: `tests/park.test.ts` — tighten `expect(replyText(maxI.replies[0])).toContain('max level');`
  and add one new case after the `it()` that holds it
- Test: `tests/lot-menus.test.ts` — one new case at the end of `describe('upgrade menu')`

**Interfaces:**
- Consumes:
  - Already in `src/modules/park/index.ts`: `FACILITIES` (from `../../data/facilities.js`),
    `paddockCapacity` (from `./dinos.js`).
  - `replyText` in `tests/lot-menus.test.ts`'s harness import — owned by Task 2 (G1-B); already
    confirmed present by Task 6 (G2-B) Step 1(a).
  - Nothing from Task 5 (G2-A) or Task 6 (G2-B) at the code level. This task's helper sits beside
    Task 6 (G2-B)'s in the same region, and its Step 2 failure enumeration assumes Task 6 (G2-B) has
    landed (that task leaves both test files green apart from this one's three).
- Produces, in `src/modules/park/service.ts`:
  - `export const PADDOCK_MAX_LEVEL = 4`
  - `export function maxLevelFor(kind: string): number`
- Produces, in `src/modules/park/index.ts`: module-private
  `function maxLevelLine(kind: string): string` (not exported).
- Downstream: **Task 15 (G5-E) consumes `maxLevelFor`** — it extracts `renderTab`'s lots branch into
  a `lotsTab` helper and must call `maxLevelFor(l.kind)` there, never reintroduce the `?? 4`
  literal or the stale comment this task deletes.

- [ ] **Step 1: Write the failing tests**

(a) In `tests/park.test.ts`, inside
`it('/upgrade execute success and each error reply', …)`, replace the whole line

```typescript
    expect(replyText(maxI.replies[0])).toContain('max level');
```
with
```typescript
    // The WHOLE line. Both numbers are read off maxLevelFor (the single resolver upgradeLot
    // itself charges through) and paddockCapacity, and the facility case below is what fails
    // if either is written into the string as a literal — a paddock and a facility do not
    // share a cap.
    expect(replyText(maxI.replies[0])).toBe('Already max level (4) — that paddock holds 8.');
```

`grep -n "toContain('max level')" tests/park.test.ts` returns exactly one hit, so the anchor is
unambiguous.

(b) In the same file, add this case immediately after the `  });` that closes that `it(…)`, i.e.
directly above `  it('/upgrade execute quotes the price on the insufficient-funds reply', async () => {`:

```typescript
  it('/upgrade names the FACILITY cap at max level, not the paddock literal', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 10_000_000 }).run();
    // gene_lab caps at 3 (src/data/facilities.ts). Seeded and asserted as literals on both
    // sides so a data change fails loudly here rather than passing against a stale message —
    // and so a hardcoded "(4)" fails this case while still passing the paddock case above,
    // which is the only reason this case exists.
    const lot = buildLot(ctx, 'u1', 'gene_lab');
    ctx.db.update(schema.lots).set({ level: 3 }).where(eq(schema.lots.id, lot.id)).run();
    const cmd = parkModule.commands.find((c) => c.data.name === 'upgrade')!;
    const i = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: lot.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toBe('Already max level (3) — the Gene Lab is fully upgraded.');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
```

Every name it uses (`makeCtx`, `fakeCommand`, `replyText`, `getOrCreateUser`, `buildLot`,
`parkModule`, `schema`, `eq`, `MessageFlags`) is already imported at the top of
`tests/park.test.ts`. The `const ctx = makeCtx()` shadowing the file-level `beforeEach` ctx is
the established idiom in this describe — copy it, do not "fix" it.

(c) In `tests/lot-menus.test.ts`, insert this case at the END of `describe('upgrade menu')` —
immediately after the `  });` that closes
`it('refuses a non-integer level anchor without touching the database', …)` (whose last two lines
are `    expect(JSON.stringify(b.replies[0])).toContain('no longer valid');` and
`    expect(b.deferOpts).toEqual([]);`) and immediately before the `});` that closes the
describe. Do not anchor on the last `expect` inside that case: inserting there nests one `it()`
inside another, which vitest rejects at runtime and turns the whole file red for the wrong
reason. The case reuses that describe's own `seedLot(level)` helper and the file-level `cashOf`:

```typescript
  it('names the cap and the capacity when the lot is already at max level', async () => {
    const lot = seedLot(4);   // paddock max level; seedLot also gives u1 100,000,000 cash
    const before = cashOf('u1');
    // The anchor matches the fresh read, so the handler's own staleness pre-check passes and
    // the click reaches upgradeLot — which is what throws LotLimitError. Anchoring anything
    // else would test the pre-check instead and never exercise this message.
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:4`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0])).toBe('Already max level (4) — that paddock holds 8.');
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(4);
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/park.test.ts tests/lot-menus.test.ts`

Do NOT add `-t "max level"`. That filter matches two PRE-EXISTING tests — find them with
`grep -n "max level" tests/park.test.ts tests/lot-menus.test.ts` — while EXCLUDING
`'/upgrade execute success and each error reply'`, which is the very assertion step 1(a)
tightens, so the tightened line would never run in either the red or the green step.

Expected: FAIL, exactly 3 tests —
- `/upgrade, /decorate, /park rename, /dino unassign, park:collect > /upgrade execute success and each error reply` — `expected 'Already max level.' to be 'Already max level (4) — that paddock holds 8.'`
- `/upgrade, /decorate, /park rename, /dino unassign, park:collect > /upgrade names the FACILITY cap at max level, not the paddock literal` — `expected 'Already max level.' to be 'Already max level (3) — the Gene Lab is fully upgraded.'`
- `upgrade menu > names the cap and the capacity when the lot is already at max level` — same shape as the first

Everything else in both files is green, since Tasks G1-B and G2-B each ended on a green run of
both.

- [ ] **Step 3: Give the paddock cap one definition in `src/modules/park/service.ts`**

Insert directly after the line `export const BASE_LOT_SLOTS = 3;`:

```typescript
// A paddock has no FACILITIES entry and PaddockDef (src/data/types.ts) carries no maxLevel
// field, so this is the paddock cap's ONLY definition. maxLevelFor is the single resolver:
// the charge (upgradeLot), the /upgrade autocomplete label, the Lots-tab upgradable filter
// and the failure message all read it, which is what stops them disagreeing — the same rule
// upgradeCostFor states for the price a few lines below.
export const PADDOCK_MAX_LEVEL = 4;
export function maxLevelFor(kind: string): number {
  return FACILITIES[kind]?.maxLevel ?? PADDOCK_MAX_LEVEL;
}
```

Then, in `upgradeLot`, replace both of these lines —

```typescript
  const def = FACILITIES[lot.kind];
  const maxLevel = def ? def.maxLevel : 4;                       // paddock max level 4 (capacity 8)
```
with the single line
```typescript
  const maxLevel = maxLevelFor(lot.kind);
```

`def` was read only for that ternary and becomes dead if left; nothing below the `maxLevel` line
uses it (`grep -n "def" src/modules/park/service.ts` shows the surviving `def` locals belong to
`upgradeCostFor` and `buildLot`). `FACILITIES` stays imported — `facilityBonusPct`, `capHours`,
`breedingSlots`, `buildLot` and `upgradeCostFor` all still use it.

- [ ] **Step 4: Route the two `src/modules/park/index.ts` copies through it**

(a) Add `maxLevelFor` to the existing `./service.js` import so the whole line reads:

```typescript
import { getOrCreateUser, buildLot, upgradeLot, upgradeCostFor, maxLevelFor, collectIncome, pendingIncome, capHours, LotLimitError, UnknownKindError, DuplicateFacilityError, StaleLevelError, toClockDinos, needsAttentionCount } from './service.js';
```

(b) In the `/upgrade` autocomplete, replace the whole line

```typescript
            const maxLevel = FACILITIES[l.kind]?.maxLevel ?? 4;
```
with
```typescript
            const maxLevel = maxLevelFor(l.kind);
```

(c) In `renderTab`'s lots branch, replace the three comment lines and the `.filter(` line —

```typescript
    // `?? 4` matches upgradeLot's own `const maxLevel = def ? def.maxLevel : 4` — a
    // paddock has no FACILITIES entry and caps at level 4. Keep the two in step; a menu
    // that offers a maxed lot is rejected by LotLimitError, but it is a wasted click.
    const upgradable = lots
      .filter((l) => l.level < (FACILITIES[l.kind]?.maxLevel ?? 4))
```
with
```typescript
    // maxLevelFor is the one resolver upgradeLot itself charges through, so this menu cannot
    // drift from it. Filtering here keeps the menu honest but is NOT the guard: a maxed lot
    // offered anyway is rejected by LotLimitError, it is just a wasted click.
    const upgradable = lots
      .filter((l) => l.level < maxLevelFor(l.kind))
```

Leave the `.map((l) => ({ lotId: l.id, … }))` line that follows untouched. Task 15 (G5-E) later lifts
this whole branch into a `lotsTab` helper; it must carry `maxLevelFor(l.kind)` across with it.

- [ ] **Step 5: Add `maxLevelLine` and rewrite the two max-level catch sites**

(a) Insert this helper in `src/modules/park/index.ts` directly below `lotSlotCapLine` (Task 6 (G2-B)
put that one after `dinoListPayload`'s closing brace, before `export const parkModule`):

```typescript
/**
 * The already-at-max-level sentence for a LotLimitError thrown by `upgradeLot`. The build
 * handler reads the same class as "slot cap" — see `lotSlotCapLine`.
 *
 * The cap comes from maxLevelFor, the same resolver upgradeLot uses to decide whether to
 * throw, and never from a literal: a paddock caps at 4, gene_lab and food_court at 3,
 * visitor_center and hatchery_lab at 5, so any one number written here would be wrong for
 * most lots. The capacity then follows FROM that number through paddockCapacity rather than
 * being written down beside it, so a change to the paddock cap moves both halves together.
 */
function maxLevelLine(kind: string): string {
  const max = maxLevelFor(kind);
  const def = FACILITIES[kind];
  if (def) return `Already max level (${max}) — the ${def.name} is fully upgraded.`;
  return `Already max level (${max}) — that paddock holds ${paddockCapacity(max)}.`;
}
```

(b) In the `/upgrade` command's catch, replace the whole line

```typescript
          if (e instanceof LotLimitError) await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });
```
with
```typescript
          if (e instanceof LotLimitError) await i.reply({ content: maxLevelLine(lotRow!.kind), flags: MessageFlags.Ephemeral });
```

`lotRow!` is sound for the same reason the `InsufficientFundsError` branch a few lines below
already asserts it: if the hoisted read above the `try` found nothing, `upgradeLot`'s own read
finds nothing too and `UnknownKindError` fires first. (Task 2 (G1-B) rewrote that branch's message
and the comment above the hoisted read; neither is touched here.)

(c) In `case 'upgyes'`'s catch, replace the whole line

```typescript
                await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });
```
with
```typescript
                await i.reply({ content: maxLevelLine(lot.kind), flags: MessageFlags.Ephemeral });
```

Sixteen leading spaces, with `if (e instanceof LotLimitError) {` immediately above it and the
comment beginning "Mapped for the UPGRADE menu" above that — leave both alone. `lot` is the fresh
read taken before the `try`, already narrowed non-null by the `if (!lot || lot.level !== expected)`
guard.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/park.test.ts tests/lot-menus.test.ts`
Expected: `Test Files  2 passed (2)`, 0 failed.

- [ ] **Step 7: Break the facility half, watch it fail, restore**

Prove the facility case really is what holds the cap to the def. In `maxLevelLine`, change
`const max = maxLevelFor(kind);` to `const max = 4;`, then run
`npx vitest run tests/park.test.ts tests/lot-menus.test.ts`.

Expected: FAIL, exactly 1 test —
`/upgrade names the FACILITY cap at max level, not the paddock literal`, reporting
`expected 'Already max level (4) — the Gene Lab is fully upgraded.' to be 'Already max level (3) — the Gene Lab is fully upgraded.'`
Both paddock cases still pass, because 4 happens to be the paddock cap — which is precisely why
the gene_lab case has to exist.

Restore `maxLevelFor(kind)` and re-run to confirm PASS.

- [ ] **Step 8: Break the paddock cap, watch both paddock assertions fail, restore**

Nothing in the suite pins the paddock cap before this task; these two assertions become its only
pin, so watch them fail. Break it at the single definition, not at the render site — that is the
property `PADDOCK_MAX_LEVEL` buys.

In `src/modules/park/service.ts`, change `export const PADDOCK_MAX_LEVEL = 4;` to
`export const PADDOCK_MAX_LEVEL = 3;`, then run
`npx vitest run tests/park.test.ts tests/lot-menus.test.ts`.

Expected: FAIL, exactly 2 tests —
- `/upgrade execute success and each error reply` — `expected 'Already max level (3) — that paddock holds 6.' to be 'Already max level (4) — that paddock holds 8.'`
- `upgrade menu > names the cap and the capacity when the lot is already at max level` — the same pair of strings

Both numbers move together, which is the property `paddockCapacity(max)` buys. The gene_lab case
still passes, and nothing else in either file changes: a level-4 paddock still trips
`lot.level >= maxLevel` at a cap of 3, so the error path is unchanged, and
`renderTab excludes a lot already at max level from the minted options` seeds level-1 paddocks
which stay upgradable at either cap.

**Do not raise the cap instead of lowering it.** At `PADDOCK_MAX_LEVEL = 5` a level-4 paddock no
longer trips `lot.level >= maxLevel`, so `/upgrade` SUCCEEDS and replies "is now level 5" — the
error path is not exercised at all and the break proves nothing about this message.

Restore `4` and re-run to confirm PASS.

Note honestly, in passing: `paddockCapacity(max)` versus a literal `8` is still not
independently observable while `PADDOCK_MAX_LEVEL` stays at 4 (`2 * 4` is 8 either way). Step 8
is what makes the pair observable together; do not add a further test that merely recomputes
`2 * PADDOCK_MAX_LEVEL` to pretend otherwise.

- [ ] **Step 9: Run the wider park surface and typecheck**

Run: `npx vitest run tests/park.test.ts tests/lot-menus.test.ts tests/park-tabs.test.ts tests/autocomplete-park.test.ts`
Expected: PASS on all four files. (`autocomplete-park.test.ts` is in the list because step 4(b)
rewrote the `/upgrade` autocomplete's max-level read; `park-tabs.test.ts` because step 4(c)
rewrote the Lots tab's `upgradable` filter. Both are behaviour-preserving and must stay green.)

Then run: `npm run typecheck`
Expected: exits 0 with no output. (Separate commands, not chained with `&&` — PowerShell 5.1
parses `&&` as a syntax error.)

- [ ] **Step 10: Commit**
```bash
git add src/modules/park/service.ts src/modules/park/index.ts tests/park.test.ts tests/lot-menus.test.ts
git commit -m "feat(park): name the cap and capacity on the already-max-level error"
```

---

### Task 8: `claimExpedition` hands back the egg it just inserted

_Stable id: `G4-A`_

The `/expedition claim` reply has to mint a button carrying the new egg's id, and today the
service throws that id away — `src/modules/expeditions/service.ts:119-121` inserts with `.run()`,
not `.returning().get()`. Re-reading "the newest egg" in the handler would pick the wrong row for
a player who already owned eggs, so the service returns it.

This task lands before every task that rewrites either expedition claim surface — Task 19 (G7-A),
Task 20 (G7-B) and Task 22 (G4-D) — so all three destructure `{ loot, site, egg }` from the outset rather
than re-destructuring later. Widening a return type is additive, so nothing typechecks red if one
of them forgets; the button simply never appears. That is why this is first.

**Files:**
- Modify: `src/modules/expeditions/service.ts:14` (add an `Egg` alias below it), `:99` (signature), `:117-126` (the transaction body)
- Test: `tests/follow-through-incubate.test.ts` (create)

**Interfaces:**
- Consumes: nothing. Tasks G1-A…G1-D and G2-A…G2-C land before this one but produce nothing it uses.
- Produces:
  - `claimExpedition(ctx: Ctx, userId: string): { loot: Loot; site: SiteDef; egg: Egg }` — the return type gains a third key.
  - `export type Egg = typeof schema.eggs.$inferSelect` in `src/modules/expeditions/service.ts`.
  - `tests/follow-through-incubate.test.ts`, which every later task in this slice appends to.

- [ ] **Step 1: Write the failing test**

Create `tests/follow-through-incubate.test.ts` with exactly this content:

```typescript
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, claimExpedition } from '../src/modules/expeditions/service.js';

// Day 0 is `clear_skies` — every eventMods multiplier is 1 — so coastal_dig costs exactly
// 200 cash and takes exactly its 15-minute durationMs. Re-derive with:
//   npx tsx -e "import {worldEventFor,eventMods} from './src/core/world.ts'; console.log(worldEventFor(0).id, eventMods(0))"
const MIN = 60_000;

describe('claimExpedition returns the egg it minted', () => {
  it('hands back the newly inserted expedition egg, not a pre-existing one', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    // A shop egg the player already owned. A "read the newest row back" implementation
    // would be indistinguishable from a correct one without this row present.
    const older = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 })
      .returning().get();

    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(16 * MIN);
    const { egg } = claimExpedition(ctx, 'u1');

    const fromExpedition = ctx.db.select().from(schema.eggs).all()
      .filter((e) => e.source === 'expedition');
    expect(fromExpedition).toHaveLength(1);
    expect(egg.id).toBe(fromExpedition[0].id);
    expect(egg.id).not.toBe(older.id);
    expect(egg.userId).toBe('u1');
    expect(egg.source).toBe('expedition');
    // The returned row is the stored row, not a hand-built copy.
    expect(egg).toEqual(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get());
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `claimExpedition returns the egg it minted > hands back the
newly inserted expedition egg, not a pre-existing one` — with
`TypeError: Cannot read properties of undefined (reading 'id')` at the `expect(egg.id).toBe(...)`
line. `claimExpedition` returns `{ loot, site }` today, so `egg` destructures to `undefined`.
`expect(fromExpedition).toHaveLength(1)` above it passes — the row IS inserted, it is just not
handed back.

- [ ] **Step 3: Add the `Egg` alias**

In `src/modules/expeditions/service.ts`, immediately after line 14
(`export type Expedition = typeof schema.expeditions.$inferSelect;`) add:

```typescript
// The same one-line `$inferSelect` alias several other services declare for themselves.
// Enumerate them with `grep -rn "type Egg = typeof schema.eggs" src/`. Declared locally
// rather than imported from ../hatchery/service.js so this service keeps no import edge
// into another gameplay module for a type it can spell in one line.
export type Egg = typeof schema.eggs.$inferSelect;
```

- [ ] **Step 4: Widen the signature and return the inserted row**

In the same file, change the signature at line 99 from

```typescript
export function claimExpedition(ctx: Ctx, userId: string): { loot: Loot; site: SiteDef } {
```

to:

```typescript
export function claimExpedition(ctx: Ctx, userId: string): { loot: Loot; site: SiteDef; egg: Egg } {
```

Then replace the transaction body — lines 117 through 126 inclusive, i.e. from
`return ctx.db.transaction(() => {` down to and including the `});` that closes it — with:

```typescript
  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: loot.cash, foods: { [loot.food.foodId]: loot.food.qty } }, `expedition-loot:${exp.siteId}`, ctx.now());
    // .returning().get(), not .run(): the claim reply mints an Incubate button that carries
    // this egg's id, and "re-read the newest egg" would pick the wrong row for a player who
    // already owned eggs.
    const egg = ctx.db.insert(schema.eggs).values({
      userId, rarity: eggRarity, speciesId: null, source: 'expedition', obtainedAt: ctx.now(),
    }).returning().get();
    ctx.db.update(schema.expeditions).set({ claimedAt: ctx.now(), loot })
      .where(eq(schema.expeditions.id, exp.id)).run();
    track(ctx, userId, 'expeditions_claimed', 1);
    return { loot, site, egg };
  });
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: PASS.

- [ ] **Step 6: Confirm no existing caller broke**

Run: `npx vitest run tests/expeditions.test.ts tests/stats-sites.test.ts tests/world-effects.test.ts tests/alert-buttons.test.ts`

Then, as a separate command: `npm run typecheck`

Expected: PASS, and typecheck exits 0. Every existing caller destructures `{ loot }` or
`{ loot, site }`, so widening the return type is additive — enumerate them with
`grep -rn "claimExpedition(" src/ tests/ scripts/`. Run the two commands separately, never
chained with `&&`: this repo's primary shell is Windows PowerShell 5.1, where `&&` is a parser
error, and a chained run would also hide which of the two gates failed.

- [ ] **Step 7: Commit**
```bash
git add src/modules/expeditions/service.ts tests/follow-through-incubate.test.ts
git commit -m "feat(expeditions): return the claimed egg row from claimExpedition"
```

---

---

### Task 9: the harness reply-kind field, the one `incubateRow` builder, the one `hatch:inc` handler, and both bare returns

_Stable id: `G4-B`_

This is the single owner of everything shared by the four minters that follow.

**One builder.** Four surfaces mint the Incubate button, so the id grammar and the label live in
exactly one place — `src/modules/shop/index.ts:18` already imports `RARITY_COLOR` from
`../hatchery/embeds.js`, so that file is the established home for a shared hatchery-owned
builder. The routing note is worth keeping in the code but is easy to misread: `routeInteraction`
resolves a handler from the customId PREFIX alone, so no minter needs an import into
`hatchery/index.ts`. That is a reason not to import the HANDLER. It is never a reason to copy the
BUILDER.

**One handler** (spec §4.1). Every incubate validation — owned, not locked in a trade, not already
incubating, a free incubator slot — already exists exactly once inside `incubateEgg`
(`src/modules/hatchery/service.ts:29-47`); this arm adds none of it. It answers with
`i.update({ content, components: [] })`, not `i.reply`: stripping the spent button is how a
one-shot control is closed here, because neither router guard reads `disabled`.

**Both bare returns.** Spec §3.3's two-line fix is folded in here and NOWHERE else — this task is
the sole writer of `src/modules/hatchery/index.ts:94` and `:110`. Task 17 (G5-F)'s corresponding steps
are verification steps against already-converted code, never a second red-then-green cycle.

**One harness addition**, with live consumers in this plan. `replyKinds` is the only way any test
can tell `i.reply` from `i.update` — `replies` records both into one array and both set `replied`.
Step 11 breaks the handler by swapping one for the other and watches that single assertion fail
while every other assertion in the case stays green, which is exactly the swap nothing could see
before. Task 18 (G6-B) asserts the same field on its `care:feed` success case.

**What this task deliberately does NOT change:** `makeCtx`'s `config.modules`, which stays `{}`
(`tests/harness.ts:21`). Tasks G4-D, G4-E, G4-F and G5-F each gate a CROSS-MODULE mint on
`ctx.config.modules.<name>` and each therefore builds its own ctx with an explicit `config`.
Flipping the shared default to "everything enabled" would silently invert Task 17 (G5-F)'s
module-disabled case, which relies on that default. One fixture per file, never a global.

**Files:**
- Modify: `tests/harness.ts` — `fakeSelect`'s returned object at `:347`, its four reply methods at `:317-336`, and its `deferOpts` declaration at `:290`; then `fakeButton`'s returned object at `:279`, its four reply methods at `:243-262`, and its `deferOpts` declaration at `:213`; then the `FakeInteraction` interface at `:103-108`. **Work strictly bottom-up, in the order Steps 1-3 give them** — every insert shifts the lines below it, and the four-method block is textually IDENTICAL between the two fakes, so a text-only match is ambiguous.
- Modify: `src/modules/hatchery/embeds.ts` (append `incubateRow` after `crackButton`, whose closing `}` is line 18)
- Modify: `src/modules/hatchery/index.ts` — the `hatch` component's `if (action !== 'crack') return;` (line 94 today) and the `mythic` component's `if (action !== 'confirm') return;` (line 110 today). Anchored on that quoted text, not on the numbers: Task 3 (G1-C) edits line 14 and line 117 of this same file before this task, and Tasks G5-F and G4-G edit it after.
- Test: `tests/follow-through-incubate.test.ts`

**Interfaces:**
- Consumes: `tests/follow-through-incubate.test.ts` from Task 8 (G4-A) (this task replaces its import block and appends).
- Produces:
  - `incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder>` — exported from `src/modules/hatchery/embeds.ts`. One row, one Primary button, customId `hatch:inc:<userId>:<eggId>`, label `🥚 Incubate #<eggId>`. **Every minting surface imports this builder; nobody hand-writes the id or the label.**
  - The customId grammar **`hatch:inc:<ownerUserId>:<eggId>`**, dispatched by the existing `hatch` component prefix in `src/modules/hatchery/index.ts`. On success it sends `i.update({ content, components: [] })` — no `embeds` key and no `attachments` key. Refusals are ephemeral `i.reply`s.
  - Refusal strings: `That is not your egg.` (wrong clicker) and ``That incubate link is invalid — use `/incubate`.`` (unparseable egg segment). Every `HatcheryError` from `incubateEgg` passes through as `e.message`, ephemeral.
  - `hatch:<unknown>` and `mythic:<unknown>` now `await i.deferUpdate(); return;` instead of returning bare.
  - `tests/harness.ts`: `export type ReplyKind = 'reply' | 'update' | 'editReply' | 'followUp'` and `FakeInteraction.replyKinds?: ReplyKind[]`, populated by `fakeButton` and `fakeSelect`.
  - Test-file helpers in `tests/follow-through-incubate.test.ts`: `mintedChildren(payload: unknown): MintedChild[]`, `mintedIds(payload: unknown): string[]` and `seedEgg(ctx, userId)` — all three consumed from Task 10 (G4-C) onward.

- [ ] **Step 1: Add `replyKinds` to `fakeSelect`**

In `tests/harness.ts`, make these three edits **in this order** — highest line number first. The
four-method block below is textually IDENTICAL in `fakeButton` and `fakeSelect`, so a text-only
match is ambiguous; editing the later copy first keeps the earlier copy's line numbers valid.

(a) Replace line **347** (`fakeSelect`'s returned object, the line after `return {` on 346):

```typescript
    replies, replyKinds, deferOpts,
```

(b) Replace lines **317-336** — `fakeSelect`'s `reply`, `editReply`, `followUp` and `update`, four
contiguous methods ending with the `},` on 336 — with:

```typescript
    reply: async (payload: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      validateMessagePayload(payload, `${label} reply`);
      raw.replied = true; replies.push(payload); replyKinds.push('reply');
    },
    editReply: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} editReply`);
      raw.replied = true; replies.push(payload); replyKinds.push('editReply');
    },
    followUp: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} followUp`);
      replies.push(payload); replyKinds.push('followUp');
    },
    update: async (payload: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      validateMessagePayload(payload, `${label} update`);
      raw.replied = true; replies.push(payload); replyKinds.push('update');
    },
```

(c) Insert directly after line **290** (`  const deferOpts: unknown[] = [];`, inside `fakeSelect`):

```typescript
  // Parallel to `replies`, one entry per recorded payload. `replies` cannot tell reply from
  // update — all four methods push into it and all four set `replied` — and the two are not
  // interchangeable: i.update REPLACES the message the control sits on (which is how a
  // one-shot button is closed here, since neither router guard reads `disabled`), while
  // i.reply leaves the spent button standing and posts beside it.
  const replyKinds: ReplyKind[] = [];
```

- [ ] **Step 2: Add `replyKinds` to `fakeButton`**

Same three edits, again highest line number first.

(a) Replace line **279** (`fakeButton`'s returned object):

```typescript
    replies, replyKinds, deferOpts,
```

(b) Replace lines **243-262** — `fakeButton`'s `reply`, `editReply`, `followUp` and `update` —
with the **exact same four-method block** given in Step 1(b). The two fakes are deliberately kept
identical; a divergence between them is its own trap.

(c) Insert directly after line **213** (`  const deferOpts: unknown[] = [];`, inside `fakeButton`)
the **same** `const replyKinds: ReplyKind[] = [];` block given in Step 1(c).

- [ ] **Step 3: Declare `ReplyKind` and widen `FakeInteraction`**

Still bottom-up: this block sits ABOVE both fakes, so it comes last. In `tests/harness.ts`,
replace lines **103-108** — the whole `FakeInteraction` interface — with:

```typescript
export type ReplyKind = 'reply' | 'update' | 'editReply' | 'followUp';

export interface FakeInteraction {
  replies: unknown[];
  // Optional because fakeCommand and fakeAutocomplete do not populate it: a slash command
  // has no message to update, so the distinction does not exist there.
  replyKinds?: ReplyKind[];
  deferOpts: unknown[];
  asChatInput(): ChatInputCommandInteraction;
  asInteraction(): Interaction;
}
```

- [ ] **Step 4: Prove the shared harness change broke nothing**

Run: `npm test`

Then, as a separate command: `npm run typecheck`

Expected: PASS, the whole suite, and typecheck exits 0. This is a shared-fixture edit, so the
whole suite is the gate, not one file. The field is purely additive — `fakeCommand` and
`fakeAutocomplete` still return objects without it, which the optional declaration allows, and
no existing test destructures anything but `replies` and `deferOpts`.

- [ ] **Step 5: Write the failing tests**

Replace the import block at the top of `tests/follow-through-incubate.test.ts` so it reads
exactly:

```typescript
import { describe, it, expect } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, claimExpedition } from '../src/modules/expeditions/service.js';
import { incubateRow } from '../src/modules/hatchery/embeds.js';
```

then append to the file:

```typescript
/** The button/select children of a recorded payload, as Discord's own JSON. */
interface MintedChild { custom_id?: string }
function mintedChildren(payload: unknown): MintedChild[] {
  const rows = (payload as { components?: ReadonlyArray<{ toJSON(): { components: MintedChild[] } }> })
    .components ?? [];
  return rows.flatMap((r) => r.toJSON().components);
}
const mintedIds = (payload: unknown): string[] =>
  mintedChildren(payload).map((c) => c.custom_id).filter((id): id is string => typeof id === 'string');

/** An unincubated egg the given player owns. */
function seedEgg(ctx: ReturnType<typeof makeCtx>, userId: string) {
  return ctx.db.insert(schema.eggs)
    .values({ userId, rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
}

describe('incubateRow — the one Incubate button builder', () => {
  it('mints one row holding one button, with the owner and the egg in the id', () => {
    const json = incubateRow('u1', 7).toJSON() as
      { components: Array<{ custom_id: string; label: string }> };
    expect(json.components).toHaveLength(1);
    // Whole rendered strings, both of them. Every minting surface goes through this builder,
    // so these two assertions are the only place either string is pinned.
    expect(json.components[0].custom_id).toBe('hatch:inc:u1:7');
    expect(json.components[0].label).toBe('🥚 Incubate #7');
  });
});

describe('hatch:inc — the one Incubate handler', () => {
  it('routes through the real registry, starts the egg timer, and closes the button', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const egg = seedEgg(ctx, 'u1');
    // Dispatched through routeInteraction against testRegistry (the real ALL_MODULES), not
    // comp.execute: findComponent resolves on customId.split(':')[0] alone, so calling
    // execute directly would prove nothing about the button being reachable at all.
    const customId = `hatch:inc:u1:${egg.id}`;
    const b = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    const row = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!;
    expect(row.incubationStartedAt).toBe(0);
    expect(row.hatchesAt).toBe(15 * 60_000);          // common: RARITY.common.incubationMs
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
    expect(b.deferOpts).toHaveLength(0);
    expect(b.replies).toHaveLength(1);
    // Whole rendered line, never a substring around a number.
    expect(replyText(b.replies[0])).toBe(
      `🥚 Egg #${egg.id} is incubating — ready <t:${Math.floor(row.hatchesAt! / 1000)}:R>, then \`/hatch egg:${egg.id}\`.`);
    // The spent button is REMOVED, not disabled: neither router guard reads `disabled`.
    // A whole-list assertion is correct HERE and nowhere else in this file — this is the
    // handler's own payload, written by this task alone, not a components array a second
    // slice also pushes onto.
    expect(mintedIds(b.replies[0])).toEqual([]);
    // i.update, not i.reply. `replies` cannot tell the two apart — this is the only
    // assertion in the file that can, and Step 11 watches it fail on its own.
    expect(b.replyKinds).toEqual(['update']);
  });

  it('leaves the embed and its upload alone so the egg art survives the click', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const egg = seedEgg(ctx, 'u1');
    const customId = `hatch:inc:u1:${egg.id}`;
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    // Sending `attachments: []` would drop the upload the surrounding embed's
    // attachment:// URL points at, leaving a broken image; sending `embeds: []` would
    // throw the reveal away. Neither key may appear.
    const sent = b.replies[0] as Record<string, unknown>;
    expect(Object.hasOwn(sent, 'attachments')).toBe(false);
    expect(Object.hasOwn(sent, 'embeds')).toBe(false);
  });
});

describe('unrecognised hatchery actions acknowledge instead of timing out', () => {
  it('hatch:<unknown> defers the update', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const customId = 'hatch:nope:u1:1';
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    // deferUpdate, not deferReply: deferReply posts a public "thinking…" placeholder that
    // never resolves. Both satisfy toHaveLength(1), so `kind` is the assertion that matters.
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });

  it('mythic:<unknown> defers the update', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const customId = 'mythic:nope:whatever';
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });
});
```

- [ ] **Step 6: Run the tests and watch them fail**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL — every case this step added, and no others. The file **collects normally**:
vitest's SSR transform resolves a missing named export to `undefined` rather than throwing, so
this is NOT a collection error and NOT a `SyntaxError`, and Task 8 (G4-A)'s case still PASSES. The
failures, by case:

- `mints one row holding one button…` — `TypeError: incubateRow is not a function`.
- `routes through the real registry…` — `AssertionError: expected null to be +0` on
  `expect(row.incubationStartedAt).toBe(0)`. `hatch:inc` is not a known action, so the handler
  bare-returns and nothing at all happens.
- `leaves the embed and its upload alone…` — `TypeError: Cannot convert undefined or null to
  object`. Nothing replied, so `b.replies[0]` is `undefined` and `Object.hasOwn` rejects it.
- `hatch:<unknown> defers the update` — `expected [] to have a length of 1 but got +0` on
  `expect(b.deferOpts).toHaveLength(1)`. The bare return acknowledges nothing.
- `mythic:<unknown> defers the update` — the same failure, same line.

If Task 8 (G4-A)'s case is among the failures, stop: something in Steps 1-3's harness edit broke a
fixture, and that is a different problem from the missing export.

- [ ] **Step 7: Add the shared Incubate row builder**

In `src/modules/hatchery/embeds.ts`, immediately after `crackButton` (its closing `}` is line 18)
add:

```typescript
// The ONE Incubate button. Four surfaces mint it — /expedition claim and the exp:claim
// update, /shop egg, /breed claim and the breed:claim update, and mythic:confirm — so the id
// grammar and the label live here rather than being retyped at each one. Enumerate the call
// sites with `grep -rn "incubateRow(" src/`.
//
// Handled by the `hatch` component in src/modules/hatchery/index.ts. A minter needs no import
// into that module, because routeInteraction resolves a handler from the customId PREFIX
// alone — that is a reason not to import the HANDLER, never a reason to copy this BUILDER.
//
// The owner uid rides in the id because most of those replies are PUBLIC; see the handler's
// own owner check. Unicode 🥚 in the label, never emojiTag/setEmoji: the app-emoji map
// returns '' when unloaded and setEmoji throws on that rather than degrading.
export function incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hatch:inc:${userId}:${eggId}`)
      .setLabel(`🥚 Incubate #${eggId}`).setStyle(ButtonStyle.Primary));
}
```

`ActionRowBuilder`, `ButtonBuilder` and `ButtonStyle` are already imported at
`src/modules/hatchery/embeds.ts:1` — no import change.

- [ ] **Step 8: Add the `inc` arm and fix the `hatch` bare return**

In `src/modules/hatchery/index.ts`, replace the line

```typescript
        if (action !== 'crack') return;
```

with the block below. The outer destructure above it
(`const [, action, a2, a3] = i.customId.split(':');`) already lines up: for
`hatch:inc:<uid>:<eggId>`, `a2` is the owner and `a3` is the egg, exactly as
`hatch:eggs:<uid>:<page>` uses them.

```typescript
        if (action === 'inc') {
          // These buttons sit on PUBLIC messages (the /expedition claim, /shop egg and
          // /breed claim replies are not ephemeral), so the owner is checked here,
          // explicitly, before any read. incubateEgg's own (id, userId) filter would
          // refuse a bystander too — it resolves the egg against the CALLER, so a
          // bystander's click finds no row — but it refuses with "You do not own that
          // egg.", which is true and the wrong sentence for a click on somebody else's
          // card. This check buys the right MESSAGE, not the write protection.
          if (i.user.id !== a2) {
            await i.reply({ content: 'That is not your egg.', flags: MessageFlags.Ephemeral });
            return;
          }
          // Client-supplied and not even trusted to parse: a malformed segment must not
          // reach the DB lookup as NaN. (It binds fine and misses, so the cost is again
          // the wrong sentence — "You do not own that egg." for a mangled link.)
          const eggId = Number(a3);
          if (!Number.isInteger(eggId)) {
            await i.reply({ content: 'That incubate link is invalid — use `/incubate`.', flags: MessageFlags.Ephemeral });
            return;
          }
          try {
            const egg = incubateEgg(ctx, i.user.id, eggId, i.guildId);
            // i.update, and neither `embeds` nor `attachments` is sent. The message this
            // button sits on carries an egg embed whose image is an attachment:// URL into
            // its own upload: `attachments: []` would drop that upload and leave the embed
            // pointing at nothing, and `embeds: []` would throw the reveal away. Only
            // content and components are replaced — components: [] REMOVES the spent
            // button, which is how a one-shot flow is closed here, because neither router
            // guard reads `disabled`. i.reply would leave the button standing.
            await i.update({
              content: `🥚 Egg #${egg.id} is incubating — ready <t:${Math.floor(egg.hatchesAt! / 1000)}:R>, then \`/hatch egg:${egg.id}\`.`,
              components: [],
            });
          } catch (e) {
            if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e;
          }
          return;
        }
        // deferUpdate, never a bare return: a bare return paints "This interaction failed"
        // after 3 seconds, and a stale id from an older deploy lands right here.
        if (action !== 'crack') { await i.deferUpdate(); return; }
```

No new imports: `MessageFlags`, `incubateEgg` and `HatcheryError` are already imported at
`src/modules/hatchery/index.ts:1` and `:6`.

- [ ] **Step 9: Fix the `mythic` bare return**

In the same file, replace the line

```typescript
        if (action !== 'confirm') return;
```

with:

```typescript
        // Same reason as the hatch handler above: an unrecognised action must acknowledge.
        if (action !== 'confirm') { await i.deferUpdate(); return; }
```

This text occurs exactly once in this file — confirm with
`grep -n "action !== 'confirm'" src/modules/hatchery/index.ts`. (The gene lab has its own copy in
a different file; it is already a `deferUpdate` and is out of scope.)

- [ ] **Step 10: Run the tests and watch them pass**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: PASS.

- [ ] **Step 11: Break the reply-kind, watch exactly one assertion fail, restore**

In the `inc` arm's success path, change `await i.update({` to `await i.reply({`.

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `routes through the real registry, starts the egg timer, and
closes the button` — with `AssertionError: expected [ 'reply' ] to deeply equal [ 'update' ]`.
Every other assertion in that case stays green, `mintedIds(...)` `toEqual([])` included, because
the recorded PAYLOAD is byte-identical either way. That is the whole point: without `replyKinds`
this swap is invisible offline and shows up only in production, as a spent button left standing
under a "started incubating" message.

Restore `await i.update({` and re-run the same command; expected: PASS.

- [ ] **Step 12: Confirm the existing suites still pass, and typecheck**

Run: `npx vitest run tests/hatchery.test.ts tests/router.test.ts tests/journeys.test.ts tests/images.test.ts tests/harness.test.ts`

Then, as a separate command: `npm run typecheck`

Expected: PASS, and typecheck exits 0. `npm run build` typechecks only `src`, and vitest
transpiles without typechecking, so `npm run typecheck` is the only gate that reads the new test
file and the widened harness.

- [ ] **Step 13: Commit**
```bash
git add tests/harness.ts src/modules/hatchery/embeds.ts src/modules/hatchery/index.ts tests/follow-through-incubate.test.ts
git commit -m "feat(hatchery): add the Incubate row builder and the hatch:inc handler"
```

---

---

### Task 10: watch every `hatch:inc` guard fail, then restore

_Stable id: `G4-C`_

Four guards now stand behind `hatch:inc` and none has been seen failing, so none is yet a guard.
This task writes the cases that would catch their removal, then removes each in turn and confirms
the specific assertion fires.

Read this before you start: **neither of the two handler guards protects a write.** `incubateEgg`
filters on `(id, callerUserId)`, so it refuses a bystander and a NaN id on its own. What the
handler guards buy is the correct SENTENCE, and that is exactly what the break-and-watch steps
below observe changing. The two SERVICE guards (escrow, already-incubating) DO protect writes,
and their break steps show the write happening.

**Files:**
- Test: `tests/follow-through-incubate.test.ts`
- Temporarily modified and restored: `src/modules/hatchery/index.ts` (the `inc` arm added in Task 9 (G4-B)), `src/modules/hatchery/service.ts:35` and `:36`

**Interfaces:**
- Consumes: the `hatch:inc:<ownerUserId>:<eggId>` grammar, its handler, and the `mintedIds` / `seedEgg` helpers, all from Task 9 (G4-B). Also `incubateEgg(ctx: Ctx, userId: string, eggId: number, guildId: string | null): Egg` and two of its guards — `src/modules/hatchery/service.ts:35` (`if (locksFor(ctx, userId).eggs.has(eggId)) throw new HatcheryError('That egg is locked in a pending trade.');`) and `:36` (`if (egg.incubationStartedAt !== null) throw new HatcheryError('That egg is already incubating.');`). The slot cap is a separate, LATER guard at `:38-39`.
- Produces: nothing new. This task adds no production code — it turns four passing assertions into watched evidence.

- [ ] **Step 1: Write the guard tests**

Add this import to `tests/follow-through-incubate.test.ts`, directly under the `incubateRow`
import at the top of the file:

```typescript
import { incubateEgg } from '../src/modules/hatchery/service.js';
```

then append to the file:

```typescript
describe('hatch:inc guards', () => {
  it('tells a bystander it is not their egg, and touches nothing', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    getOrCreateUser(ctx, 'u2', 'Two');
    const owned = seedEgg(ctx, 'u1');
    // u2 owns an egg of their own. It is here as the BACKSTOP assertion: incubateEgg
    // filters on (id, CALLER), so even with the owner check deleted u2's own egg is
    // never started. That assertion stays green in Step 3 on purpose — it pins that
    // the service filter really is the second layer this guard is allowed to lean on.
    const bystanders = seedEgg(ctx, 'u2');

    const customId = `hatch:inc:u1:${owned.id}`;
    const b = fakeButton({ customId, user: 'u2', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    expect(replyText(b.replies[0])).toBe('That is not your egg.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, owned.id)).get()!.incubationStartedAt).toBeNull();
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, bystanders.id)).get()!.incubationStartedAt).toBeNull();
    expect(ctx.db.select().from(schema.timers).all()).toEqual([]);
  });

  it('names a malformed link as malformed rather than as an ownership problem', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    seedEgg(ctx, 'u1');
    const customId = 'hatch:inc:u1:not-a-number';
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    expect(replyText(b.replies[0])).toBe('That incubate link is invalid — use `/incubate`.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.timers).all()).toEqual([]);
  });

  it('refuses an egg that is already incubating, and enqueues no second timer', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const egg = seedEgg(ctx, 'u1');
    // A level-2 Hatchery Lab, so incubatorSlots is 2. It is NOT needed for this assertion:
    // service.ts:36's already-incubating check runs BEFORE the slot cap at :38-39, so the
    // cap cannot fire first here. It IS needed for Step 5 — with :36 commented out, a
    // one-slot park refuses the click with 'All incubator slots are full. Upgrade the
    // Hatchery Lab for more.', which is red for the wrong reason. Do not delete it.
    ctx.db.insert(schema.lots)
      .values({ userId: 'u1', type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab', level: 2 }).run();
    incubateEgg(ctx, 'u1', egg.id, 'g1');

    const customId = `hatch:inc:u1:${egg.id}`;
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    expect(replyText(b.replies[0])).toBe('That egg is already incubating.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    // One timer, not two: a re-incubation would enqueue a second egg_hatch for the same egg.
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
  });

  it('refuses an egg locked in a pending trade', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    getOrCreateUser(ctx, 'u2', 'Two');
    const egg = seedEgg(ctx, 'u1');
    // Escrow is DERIVED from the pending trade row at read time (src/core/locks.ts), so this
    // row is the only way to put an egg in escrow without going through createTrade's own
    // gates. createdAt must be > now - TRADE_EXPIRY_MS for locksFor to see it; at nowMs 0
    // that cutoff is negative, so 0 qualifies.
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
      status: 'pending', createdAt: ctx.now(),
    }).run();

    const customId = `hatch:inc:u1:${egg.id}`;
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    expect(replyText(b.replies[0])).toBe('That egg is locked in a pending trade.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    // Hatching CONSUMES the egg, so incubating an escrowed one would leave the trade
    // unfulfillable — the egg row must be untouched.
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!.incubationStartedAt).toBeNull();
    expect(ctx.db.select().from(schema.timers).all()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the file and observe that everything passes**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: PASS. All four new cases are green on arrival — Task 9 (G4-B) wrote the two handler guards
and the service has had the other two since long before this work. That is deliberate and it is
NOT yet evidence: a check that has only ever been seen passing is indistinguishable from one that
cannot fail. Steps 3 to 6 supply the evidence.

- [ ] **Step 3: Break the owner check and watch that assertion fire**

In `src/modules/hatchery/index.ts`, inside the `inc` arm, delete these four lines:

```typescript
          if (i.user.id !== a2) {
            await i.reply({ content: 'That is not your egg.', flags: MessageFlags.Ephemeral });
            return;
          }
```

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `tells a bystander it is not their egg, and touches nothing` —
with exactly one assertion diverging:
`AssertionError: expected 'You do not own that egg.' to be 'That is not your egg.'` on
`replyText(b.replies[0])`.

Both `incubationStartedAt` assertions STAY GREEN, and that is the point of the exercise:
`incubateEgg` resolves the egg with `and(eq(eggs.id, eggId), eq(eggs.userId, userId))`
(`src/modules/hatchery/service.ts:30-31`), so u2's click finds no row and throws
`HatcheryError('You do not own that egg.')` — u1's egg is untouched and u2's own egg is never
looked at. This guard buys the correct MESSAGE on a public card, not the write protection. If you
see any assertion other than the message one fail, stop: the service filter has changed and the
reasoning above no longer holds.

**Restore the four deleted lines exactly as written in Task 9 (G4-B) Step 8.** Re-run the same command
and confirm PASS.

- [ ] **Step 4: Break the integer parse and watch that assertion fire**

In the same arm, delete these four lines:

```typescript
          if (!Number.isInteger(eggId)) {
            await i.reply({ content: 'That incubate link is invalid — use `/incubate`.', flags: MessageFlags.Ephemeral });
            return;
          }
```

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `names a malformed link as malformed rather than as an
ownership problem` — with ``expected 'You do not own that egg.' to be 'That incubate link is
invalid — use `/incubate`.'``. `Number('not-a-number')` is `NaN`, better-sqlite3 binds it happily,
the lookup misses, and the player is told they do not own an egg they do own.

**Restore the four deleted lines.** Re-run and confirm PASS.

- [ ] **Step 5: Break the `HatcheryError` catch arm and watch both service refusals fire**

The two service guards are pre-existing, but the catch arm that SURFACES them is new. In the
`inc` arm replace the catch body

```typescript
            if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e;
```

with just `throw e;`.

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly two cases — `refuses an egg that is already incubating…` and `refuses an
egg locked in a pending trade` — each with
`expected 'Something went wrong — nothing was charged. Try again.' to be '<the refusal>'`. The
`HatcheryError` escapes into `routeInteraction`'s outer catch (`src/core/router.ts:168`), which
replies with that generic ephemeral instead.

**Restore the catch body.** Re-run and confirm PASS.

- [ ] **Step 6: Break each service guard in turn and watch its case fire**

(a) In `src/modules/hatchery/service.ts`, comment out line **36**:

```typescript
  // if (egg.incubationStartedAt !== null) throw new HatcheryError('That egg is already incubating.');
```

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `refuses an egg that is already incubating…`. The click now
succeeds, so the message assertion fails against the success line
(``expected '🥚 Egg #1 is incubating — ready <t:900:R>, then `/hatch egg:1`.' to be 'That egg is
already incubating.'``), and the timers assertion would have caught the duplicate `egg_hatch` row
too. If you instead see `'All incubator slots are full. Upgrade the Hatchery Lab for more.'`, the
level-2 `hatchery_lab` lot has been dropped from the fixture and this break is red for the wrong
reason — put the lot back before drawing any conclusion. **Restore line 36 verbatim** and re-run;
expected: PASS.

(b) Now comment out line **35**:

```typescript
  // if (locksFor(ctx, userId).eggs.has(eggId)) throw new HatcheryError('That egg is locked in a pending trade.');
```

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `refuses an egg locked in a pending trade` — with the message
assertion failing against the success line AND `expected +0 to be null` on `incubationStartedAt`.
The escrowed egg starts incubating, which is the write that would leave the trade unfulfillable.
**Restore line 35 verbatim** and re-run; expected: PASS.

- [ ] **Step 7: Run the whole file, typecheck, and confirm `src` is untouched**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Then run: `npm run typecheck`

Then run: `git diff --stat src/`

Expected: PASS, typecheck exits 0, and `git diff --stat src/` prints nothing — every temporary
break has been undone. Run them as three separate commands, never chained: `&&` is a parser error
in PowerShell 5.1, and even under bash it would skip the `git diff` on any failure, which is the
one output this step exists to see.

- [ ] **Step 8: Commit**
```bash
git add tests/follow-through-incubate.test.ts
git commit -m "test(hatchery): pin every hatch:inc guard by watching it fail"
```

---

---

### Task 11: `paddockAccepts` and `eligiblePaddocks` — the one assign rule, written once

_Stable id: `G5-A`_

**Files:**
- Modify: `src/modules/park/dinos.ts` — insert after the line `export function paddockCapacity(level: number): number { return 2 * level; }` (line 19 today); rewrite the two throw literals inside `assignDino` (lines 33 and 37 today); insert `eligiblePaddocks` after `assignDino`'s closing `}` (line 44 today), before `export function unassignDino`
- Test: `tests/follow-through-assign.test.ts` (create — every later task in this slice appends to it)

**Interfaces:**
- Consumes: nothing from an earlier task. Repo symbols only, all already in `src/modules/park/dinos.ts`: `paddockCapacity(level: number): number` (line 19), `type Lot` (imported line 10), `PADDOCKS` (line 6), `getSpecies` (line 4), `type Diet` (line 7), `schema` (line 2), `and`/`eq` (line 1), `type Ctx` (line 3).
- Produces:
  - `export const PADDOCK_FULL = 'That paddock is full.'` — `src/modules/park/dinos.ts`
  - `export const DINO_ESCAPED = 'That dino has escaped — rescue it first.'` — `src/modules/park/dinos.ts`
  - `export function paddockAccepts(lot: Lot, diet: Diet, occupants: number): boolean` — `src/modules/park/dinos.ts`
  - `export function eligiblePaddocks(ctx: Ctx, userId: string, dinoId: number): Lot[]` — `src/modules/park/dinos.ts`
  - `tests/follow-through-assign.test.ts` module-scope fixtures reused by Tasks G5-B through G5-F: `CONFIG`, `seedUser(id?)`, `seedLot(over?)`, `seedDino(over?)`

- [ ] **Step 1: Create the test file with its fixtures and the `eligiblePaddocks` cases**

Create `tests/follow-through-assign.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { eligiblePaddocks } from '../src/modules/park/dinos.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';

let ctx: ReturnType<typeof makeCtx>;

// makeCtx defaults to `modules: {}` (tests/harness.ts), and the hatch reveal in the last
// task of this slice gates its CROSS-MODULE mint on `ctx.config.modules.park` — because
// ModuleRegistry resolves a component handler only among ENABLED modules
// (src/core/modules.ts), so a `park:` id minted while park is off is a dead button. Under
// the default that gate is false, no row is minted, and those cases would go
// green-but-vacuous. Mirroring modules.json's live values here is what keeps them honest;
// the one case that deliberately wants the gate SHUT builds its own default ctx.
// Derived from ALL_MODULES, never a hand-written list of names: a gate added later on a
// module this literal happened not to name would read `undefined`, suppress its own control,
// and leave the test green with nothing to show for it. tests/harness.ts already compiles this
// exact expression for testRegistry, so it is proven under `npm run typecheck`.
const CONFIG: Config = {
  token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner',
  modules: Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])),
};
beforeEach(() => { ctx = makeCtx({ config: CONFIG }); });

// Defaults are a matched pair: `triceratops` is a common herbivore
// (src/data/species/triceratops.ts) and the default lot is a herbivore paddock
// (src/data/paddocks.ts), so every mismatch case states its own override.
const seedUser = (id = 'u1') => getOrCreateUser(ctx, id, id);
const seedLot = (over: Partial<typeof schema.lots.$inferInsert> = {}) =>
  ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock', ...over,
  }).returning().get();
const seedDino = (over: Partial<typeof schema.dinos.$inferInsert> = {}) =>
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();

describe('eligiblePaddocks', () => {
  it('returns only paddocks that match the diet and still have room', () => {
    seedUser();
    const match = seedLot();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });              // off diet
    seedLot({ type: 'facility', kind: 'visitor_center', name: 'Visitor Center' });  // not a paddock
    const full = seedLot();
    seedDino({ lotId: full.id }); seedDino({ lotId: full.id });                     // 2/2 at level 1
    const d = seedDino();
    expect(eligiblePaddocks(ctx, 'u1', d.id).map((l) => l.id)).toEqual([match.id]);
  });

  it('still offers the paddock the dino already lives in, even at capacity', () => {
    seedUser();
    const lot = seedLot();
    const resident = seedDino({ lotId: lot.id });
    seedDino({ lotId: lot.id });      // 2/2 counting the resident itself
    // assignDino excludes the dino being moved from its own occupancy check
    // (ne(dinos.id, dinoId), src/modules/park/dinos.ts). A chooser that forgot that would
    // hide a move the service would happily accept.
    expect(eligiblePaddocks(ctx, 'u1', resident.id).map((l) => l.id)).toEqual([lot.id]);
  });

  it('reads capacity off the lot level rather than a constant', () => {
    seedUser();
    const lot = seedLot({ level: 2 });                     // paddockCapacity(2) === 4
    for (let n = 0; n < 3; n++) seedDino({ lotId: lot.id });
    const d = seedDino();
    expect(eligiblePaddocks(ctx, 'u1', d.id).map((l) => l.id)).toEqual([lot.id]);
    seedDino({ lotId: lot.id });                           // now 4/4
    expect(eligiblePaddocks(ctx, 'u1', d.id)).toEqual([]);
  });

  it('offers nothing for an escaped dino, a dino the caller does not own, or a junk id', () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    seedLot();
    const escaped = seedDino({ escapedAt: 1 });
    const mine = seedDino();
    expect(eligiblePaddocks(ctx, 'u1', escaped.id)).toEqual([]);
    expect(eligiblePaddocks(ctx, 'u2', mine.id)).toEqual([]);
    // Number('nope') is NaN, which better-sqlite3 binds as a legal no-match rather than
    // throwing — measured, not assumed. So a forged segment falls out as "offer nothing".
    expect(eligiblePaddocks(ctx, 'u1', Number('nope'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: FAIL. The file **collects and runs normally** — vitest's SSR transform resolves a
missing named export to `undefined` rather than throwing at import — so every case fails at
its first call with `TypeError: eligiblePaddocks is not a function`. Do not expect a
`SyntaxError`, and do not treat a clean collection as evidence the export exists.

- [ ] **Step 3: Add the two sentence constants and `paddockAccepts` to `src/modules/park/dinos.ts`**

Insert immediately after the line
`export function paddockCapacity(level: number): number { return 2 * level; }`:

```typescript
/**
 * The two AssignError texts a caller may hand a player VERBATIM.
 *
 * Both name a condition the player can act on right now — free a slot, rescue the dino —
 * so a follow-through button that swallowed them into a generic staleness line would be
 * telling the player the wrong thing. Every other AssignError text describes an id that
 * should never have been clickable, and those DO belong behind a staleness line.
 *
 * Constants rather than literals at the throw sites because the handler that decides which
 * ones pass through compares against them: two copies of a sentence, one in a throw and one
 * in a Set, drift the first time somebody edits the wording, and nothing fails.
 */
export const PADDOCK_FULL = 'That paddock is full.';
export const DINO_ESCAPED = 'That dino has escaped — rescue it first.';

/**
 * Would `lot` take one more dino of `diet`, given `occupants` already in it?
 *
 * The ONE place the assign rule — paddock, diet match, room — is written down, because it
 * gets asked in two opposite directions and a change to either half has to move both:
 *
 *   dino fixed, lots vary  → eligiblePaddocks below, which picks the shape of the hatch
 *                            reveal's Assign control
 *   lot fixed, dinos vary  → the /build follow-through's picker, which asks this once per
 *                            candidate dino, with that dino's own diet
 *
 * Neither direction is the authority and neither may claim to be: assignDino re-reads and
 * re-checks all three conditions itself and is the only thing standing between a forged id
 * and the database.
 *
 * `lot.type === 'paddock'` MUST stay the first term. PADDOCKS is a null-prototype map, so
 * PADDOCKS[<a facility kind>] is undefined and reading .diet off it throws a TypeError
 * rather than degrading to false. Reordering these two is a crash, not a miss.
 *
 * `occupants` is the CALLER's count and is never re-read here, because the two directions
 * count differently: a dino being MOVED must be excluded from the paddock it already sits
 * in — assignDino does exactly that with ne(schema.dinos.id, dinoId) — while a picker
 * choosing among unassigned dinos has nobody to exclude.
 */
export function paddockAccepts(lot: Lot, diet: Diet, occupants: number): boolean {
  return lot.type === 'paddock'
    && PADDOCKS[lot.kind].diet === diet
    && occupants < paddockCapacity(lot.level);
}
```

- [ ] **Step 4: Point `assignDino`'s two throws at the constants**

In `assignDino`, replace the escape line:

```typescript
  if (dino.escapedAt !== null) throw new AssignError('That dino has escaped — rescue it first.');
```

with:

```typescript
  if (dino.escapedAt !== null) throw new AssignError(DINO_ESCAPED);
```

and replace the capacity line:

```typescript
  if (occupants >= paddockCapacity(lot.level)) throw new AssignError('That paddock is full.');
```

with:

```typescript
  if (occupants >= paddockCapacity(lot.level)) throw new AssignError(PADDOCK_FULL);
```

Both are byte-identical in behaviour. Confirm nothing else in the repo pinned the literals
with `grep -rn "That paddock is full\|has escaped — rescue it first" src/ tests/ scripts/` —
the hits outside `src/modules/park/dinos.ts` belong to care, genelab and trading, which raise
their own error classes and are untouched.

- [ ] **Step 5: Add `eligiblePaddocks`**

Insert immediately after `assignDino`'s closing `}`, before `export function unassignDino`:

```typescript
/**
 * The paddocks this dino could be assigned to right now, decided through paddockAccepts.
 *
 * A MINT-SIDE chooser, not a barrier: it picks which of assignRow's three shapes to mint,
 * and assignDino independently refuses everything it filters out. What it buys is that the
 * control a player is OFFERED and the rule that executes come from one definition — in
 * particular the diet term, which is what keeps an off-diet paddock off a one-press
 * follow-through at all. The wrong-habitat "Assign anyway" confirm stays reachable from
 * /dino assign only.
 *
 * Returns [] rather than throwing for a dino that is unowned, escaped, or named by a junk
 * segment: every caller is a mint site deciding which control to offer, and "offer nothing"
 * is the right answer to all three. Number('x') is NaN, which better-sqlite3 binds as a
 * legal no-match, so a forged id lands in the `!dino` arm rather than crashing.
 */
export function eligiblePaddocks(ctx: Ctx, userId: string, dinoId: number): Lot[] {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino || dino.escapedAt !== null) return [];
  const diet = getSpecies(dino.speciesId).diet;
  const lots = ctx.db.select().from(schema.lots)
    .where(eq(schema.lots.userId, userId)).all();
  const owned = ctx.db.select().from(schema.dinos)
    .where(eq(schema.dinos.userId, userId)).all();
  return lots.filter((l) => paddockAccepts(
    l, diet, owned.filter((d) => d.lotId === l.id && d.id !== dinoId).length));
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: PASS.

- [ ] **Step 7: Break the diet term and watch that assertion fail**

In `paddockAccepts`, temporarily change `PADDOCKS[lot.kind].diet === diet` to `true`.

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: FAIL on `returns only paddocks that match the diet and still have room`, with
`expected [ 1, 2 ] to deeply equal [ 1 ]` — the carnivore paddock now counts as eligible.
This is the term that keeps an off-diet paddock off a one-press control in the first place.
**Restore it and re-run — the file must go green again.**

- [ ] **Step 8: Break the move-exclusion and watch that assertion fail**

In `eligiblePaddocks`, temporarily drop the `&& d.id !== dinoId` term from the occupancy
count, leaving `owned.filter((d) => d.lotId === l.id).length`.

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: FAIL on `still offers the paddock the dino already lives in, even at capacity`,
with `expected [] to deeply equal [ 1 ]` — the dino's own paddock hides itself at capacity
while assignDino would still take the move. **Restore the term and re-run.**

- [ ] **Step 9: Break the escaped arm and watch that assertion fail**

In `eligiblePaddocks`, temporarily change `if (!dino || dino.escapedAt !== null) return [];`
to `if (!dino) return [];`.

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: FAIL on `offers nothing for an escaped dino…`, at the first of its three
assertions: the seeded lot row comes back where `[]` was expected. **Restore the arm and
re-run.**

- [ ] **Step 10: Prove the term ORDER in `paddockAccepts` is load-bearing, then restore**

In `paddockAccepts`, temporarily swap the first two terms so `PADDOCKS[lot.kind].diet === diet`
is evaluated before `lot.type === 'paddock'`.

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: FAIL on `returns only paddocks that match the diet and still have room` with
`TypeError: Cannot read properties of undefined (reading 'diet')` — the seeded
`visitor_center` has no PADDOCKS entry, and the null prototype turns the lookup into a
crash rather than a silent `false`. That is exactly what the comment claims. **Restore the
order and re-run.**

- [ ] **Step 11: Commit**

```bash
git add src/modules/park/dinos.ts tests/follow-through-assign.test.ts
git commit -m "feat(park): add paddockAccepts and eligiblePaddocks, the assign eligibility rule"
```

---

---

### Task 12: `assignRow` and `assignSelectRow` — the three mint shapes

_Stable id: `G5-B`_

**Files:**
- Modify: `src/modules/park/embeds.ts` — append at the end of the file, after `tabRow`'s closing `}` (line 401 today; `tabRow` is the last function in the file)
- Test: `tests/follow-through-assign.test.ts` (append)

**Interfaces:**
- Consumes: `eligiblePaddocks(ctx: Ctx, userId: string, dinoId: number): Lot[]` (Task 11 (G5-A)). `ActionRowBuilder`, `ButtonBuilder`, `ButtonStyle`, `StringSelectMenuBuilder`, `StringSelectMenuOptionBuilder` and `type Lot` are all already imported at `src/modules/park/embeds.ts` lines 1-2 — no import edit is needed in that file.
- Produces:
  - `export function assignRow(userId: string, dinoId: number, eligible: Lot[]): ActionRowBuilder<ButtonBuilder>` — `src/modules/park/embeds.ts`
  - `export function assignSelectRow(userId: string, dinoId: number, eligible: Lot[]): ActionRowBuilder<StringSelectMenuBuilder>` — `src/modules/park/embeds.ts`
  - customIds minted: `park:assign:<uid>:<dinoId>:<lotId>`, `park:assignpick:<uid>:<dinoId>`, `park:goto:lots:<uid>`, `park:assignsel:<uid>:<dinoId>` (select namespace)

- [ ] **Step 1: Extend the test file's imports**

In `tests/follow-through-assign.test.ts`, add these two lines beside the existing imports:

```typescript
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { assignRow, assignSelectRow } from '../src/modules/park/embeds.js';
```

- [ ] **Step 2: Append the failing cases**

Append to `tests/follow-through-assign.test.ts`:

```typescript
describe('assignRow — the shape is chosen at mint time', () => {
  const buttonsOf = (row: ActionRowBuilder<ButtonBuilder>) =>
    (row.toJSON() as { components: Array<{ custom_id: string; label: string }> }).components;

  it('mints a direct Assign button carrying the one eligible lot', () => {
    seedUser();
    const lot = seedLot();
    const d = seedDino();
    const [btn] = buttonsOf(assignRow('u1', d.id, eligiblePaddocks(ctx, 'u1', d.id)));
    expect(btn!.custom_id).toBe(`park:assign:u1:${d.id}:${lot.id}`);
    expect(btn!.label).toBe(`🦕 Assign to #${lot.id}`);
  });

  it('mints the picker when several paddocks are eligible', () => {
    seedUser();
    seedLot(); seedLot();
    const d = seedDino();
    const [btn] = buttonsOf(assignRow('u1', d.id, eligiblePaddocks(ctx, 'u1', d.id)));
    expect(btn!.custom_id).toBe(`park:assignpick:u1:${d.id}`);
    expect(btn!.label).toBe('🦕 Assign… ▼');
  });

  it('mints Build a paddock, and no assign control at all, when none is eligible', () => {
    seedUser();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });   // off diet only
    const d = seedDino();
    const btns = buttonsOf(assignRow('u1', d.id, eligiblePaddocks(ctx, 'u1', d.id)));
    // One button, always: this builder's whole contract is that exactly one of the three
    // shapes is on the card, so the length IS the assertion here. (The payloads this row
    // gets PUSHED onto are a different matter — those are asserted with toContain, because
    // sibling work mints onto the same arrays.)
    expect(btns).toHaveLength(1);
    expect(btns[0]!.custom_id).toBe('park:goto:lots:u1');
    expect(btns[0]!.label).toBe('🏗️ Build a paddock');
  });

  it('assignSelectRow offers lot ids as values and nothing else', () => {
    seedUser();
    const a = seedLot(); const b = seedLot({ level: 2 });
    const d = seedDino();
    const menu = (assignSelectRow('u1', d.id, eligiblePaddocks(ctx, 'u1', d.id)).toJSON() as {
      components: Array<{ custom_id: string; options: Array<{ value: string; label: string }> }>;
    }).components[0]!;
    expect(menu.custom_id).toBe(`park:assignsel:u1:${d.id}`);
    expect(menu.options.map((o) => o.value)).toEqual([String(a.id), String(b.id)]);
    expect(menu.options[1]!.label).toBe(`#${b.id} Herbivore Paddock (lvl 2)`);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: FAIL. The file still collects — a missing named export resolves to `undefined` here
— so the four new cases fail with `TypeError: assignRow is not a function` (and
`assignSelectRow is not a function` on the last one), while Task 11 (G5-A)'s cases stay green.

- [ ] **Step 4: Append both builders to `src/modules/park/embeds.ts`**

Append at the end of the file, after `tabRow`'s closing `}`:

```typescript
/**
 * The follow-through assign control, in whichever of its three shapes the eligibility list
 * dictates. Always exactly one button, chosen AT MINT TIME:
 *
 *   one eligible → park:assign:<uid>:<dinoId>:<lotId>   the lot rides in the id
 *   several      → park:assignpick:<uid>:<dinoId>       opens assignSelectRow below
 *   none         → park:goto:lots:<uid>                 go build one instead
 *
 * The lot id is in the id and not merely in the label because a Discord message is durable
 * and its label is never re-derived; the handler re-checks that exact lot against current
 * state before it writes.
 *
 * The owner uid is in every one of the three because these rows land on PUBLIC messages —
 * the hatch reveal above all — where anyone in the channel can click.
 *
 * Unicode glyphs in the label, never emojiTag/setEmoji — the same reason tabRow gives: the
 * app-emoji map returns '' when unloaded and setEmoji throws on that rather than degrading.
 */
export function assignRow(
  userId: string, dinoId: number, eligible: Lot[],
): ActionRowBuilder<ButtonBuilder> {
  const button = eligible.length === 1
    ? new ButtonBuilder().setCustomId(`park:assign:${userId}:${dinoId}:${eligible[0]!.id}`)
      .setLabel(`🦕 Assign to #${eligible[0]!.id}`).setStyle(ButtonStyle.Success)
    : eligible.length > 1
      ? new ButtonBuilder().setCustomId(`park:assignpick:${userId}:${dinoId}`)
        .setLabel('🦕 Assign… ▼').setStyle(ButtonStyle.Success)
      : new ButtonBuilder().setCustomId(`park:goto:lots:${userId}`)
        .setLabel('🏗️ Build a paddock').setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

/**
 * The menu park:assignpick opens. A value is the lot id and nothing else — an identity,
 * never a price and never a capacity — so a stale option cannot describe a lot it no longer
 * names. The handler re-derives eligibility itself; the router only proves the value was
 * one this menu offered.
 *
 * Sliced at 25 for Discord's option cap. Ten lot slots is the live ceiling, so the slice is
 * insurance rather than a live constraint — the same shape lotsPayload's two menus use.
 *
 * NEVER call this with an empty list: a zero-option select is rejected by the payload
 * validator, and in production Discord rejects the message. The handler checks for that
 * before it reaches this builder.
 */
export function assignSelectRow(
  userId: string, dinoId: number, eligible: Lot[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`park:assignsel:${userId}:${dinoId}`)
      .setPlaceholder('Pick a paddock…')
      .addOptions(eligible.slice(0, 25).map((l) => new StringSelectMenuOptionBuilder()
        .setValue(String(l.id))
        .setLabel(`#${l.id} ${l.name} (lvl ${l.level})`))),
  );
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: PASS.

- [ ] **Step 6: Break the shape rule and watch that assertion fail**

In `assignRow`, temporarily change `eligible.length === 1` to `eligible.length >= 1`.

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: FAIL on `mints the picker when several paddocks are eligible`, with
`expected 'park:assign:u1:1:1' to be 'park:assignpick:u1:1'` — with two eligible paddocks the
row now mints a one-press control for whichever happened to be first, silently choosing the
paddock on the player's behalf. **Restore the condition and re-run.**

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/embeds.ts tests/follow-through-assign.test.ts
git commit -m "feat(park): mint the assign follow-through row in its three shapes"
```

---

---

### Task 13: the `park:assign` button — owner check, first-home rule, and which refusals pass through

_Stable id: `G5-C`_

**Files:**
- Modify: `src/modules/park/index.ts`, four edits, all anchored on quoted text because sibling tasks share this file:
  - the `./dinos.js` import (line 8 today)
  - the `./embeds.js` import (line 9 today)
  - the `discord.js` **type** import `import type { AttachmentBuilder, ButtonInteraction } from 'discord.js';` (line 37 today — line 35 is the `../daily/season.js` import and must not be touched)
  - insert the module-private helpers immediately before the line `export const parkModule: ModuleManifest = {`
  - insert the new `case 'assign'` in the component switch immediately before the line `          case 'dinos': {`
- Test: `tests/follow-through-assign.test.ts` (append)

**Interfaces:**
- Consumes: `eligiblePaddocks`, `PADDOCK_FULL`, `DINO_ESCAPED` (Task 11 (G5-A)); `assignRow` mints the id this task routes (Task 12 (G5-B)); repo symbols `assignDino(ctx, userId, dinoId, lotId, opts?): void`, `AssignError`, `DietMismatchError` (already in the line-8 import), `settleEscapes` (line 7), `MessageFlags` (line 1), `schema` (line 4), `and`/`eq` (line 2).
- Produces (all module-private to `src/modules/park/index.ts`, none exported):
  - `const STALE_ASSIGN = 'That lot changed — open \`/park view\` again.'`
  - `const PASS_THROUGH: Set<string>`
  - `function assignRefusal(ctx: Ctx, userId: string, dinoId: number): string | null` — returns `` `Already assigned to lot #<lotId>.` `` for a dino that already has a home, `null` otherwise. **It deliberately does NOT refuse an unowned or junk dino id**: `assignDino` refuses those one layer down and the catch below turns them into `STALE_ASSIGN`, so a second arm here would be a guard nothing could ever watch fail.
  - `async function assignFollowThrough(ctx: Ctx, i: MessageComponentInteraction, dinoId: number, lotId: number): Promise<void>`
  - routed customId `park:assign:<uid>:<dinoId>:<lotId>`

**The layering, stated up front so no step misreads it.** `assignDino` is the authority: it
re-reads and independently refuses every case — unowned dino, escaped dino, unowned or
non-paddock lot, `occupants >= paddockCapacity(lot.level)`, and diet mismatch (no
`allowMismatch` is passed). This handler adds exactly two things on top: the **first-home
rule**, which nothing anywhere else provides, and a **mapping from assignDino's refusals to
what a follow-through clicker should read**. There is deliberately no second eligibility
re-check before the call — one would produce the same sentences one layer earlier, and a
guard whose removal changes nothing observable is not a guard.

- [ ] **Step 1: Extend the test file's imports**

In `tests/follow-through-assign.test.ts`, add:

```typescript
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { routeInteraction } from '../src/core/router.js';
```

and extend the two existing imports rather than adding second copies of them:

```typescript
import { makeCtx, fakeButton, replyText, testRegistry } from './harness.js';
import { assignDino, eligiblePaddocks } from '../src/modules/park/dinos.js';
```

(`assignDino` is used by the first-home case to model a `/dino assign` that happened after
the button was minted.)

- [ ] **Step 2: Append the failing cases**

Append to `tests/follow-through-assign.test.ts`:

```typescript
// fakeButton defaults the message's component list to [customId] (tests/harness.ts), which
// is exactly the well-formed shape: in a real client the only button you can click is one
// the message carries. A fixture opts out with `componentIds: []` to model a forged id, and
// none of these cases wants that — they model real clicks on real cards.
const lotOf = (dinoId: number) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, dinoId)).get()!.lotId;

describe('park:assign — the one-eligible follow-through button', () => {
  it('routes the minted id through the registry and assigns the dino', async () => {
    seedUser();
    const lot = seedLot();
    const d = seedDino();
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);         // dispatched, not absorbed by the default arm
    expect(replyText(b.replies[0])).toBe(`🦕 Assigned to lot #${lot.id}.`);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(lotOf(d.id)).toBe(lot.id);
  });

  it('refuses a bystander and writes nothing', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    const lot = seedLot();
    const d = seedDino();
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('Not your assignment.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('says the paddock is full when it filled up between mint and click', async () => {
    seedUser();
    const lot = seedLot();                 // level 1 → capacity 2
    const d = seedDino();
    seedDino({ lotId: lot.id }); seedDino({ lotId: lot.id });   // 2/2 after the mint
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    // NOT the staleness line: a full paddock is a state the player can do something about,
    // and the /build follow-through's picker says exactly this sentence for the same cause.
    expect(replyText(b.replies[0])).toBe('That paddock is full.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('says the dino has escaped rather than blaming the lot', async () => {
    seedUser();
    const lot = seedLot();
    // Reachable in production by escaping (which needs a paddock) and then running
    // /dino unassign, which clears lotId without clearing escapedAt.
    const d = seedDino({ escapedAt: 1 });
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That dino has escaped — rescue it first.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('refuses when the lot is gone', async () => {
    seedUser();
    const lot = seedLot();
    const d = seedDino();
    ctx.db.delete(schema.lots).where(eq(schema.lots.id, lot.id)).run();
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('refuses a forged id naming somebody else’s dino, and leaves that dino alone', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    const lot = seedLot();
    const theirs = ctx.db.insert(schema.dinos).values({
      userId: 'u2', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const b = fakeButton({ customId: `park:assign:u1:${theirs.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
    expect(lotOf(theirs.id)).toBeNull();
  });

  it('refuses a forged id naming an off-diet paddock, and never halves comfort', async () => {
    seedUser();
    const carn = seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });
    const d = seedDino();                                  // triceratops, herbivore
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${carn.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('is a first-home control: a later click never drags the dino back', async () => {
    seedUser();
    const a = seedLot(); const b2 = seedLot();
    const d = seedDino();
    const customId = `park:assign:u1:${d.id}:${a.id}`;
    const first = fakeButton({ customId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, first.asInteraction());
    expect(replyText(first.replies[0])).toBe(`🦕 Assigned to lot #${a.id}.`);
    // The player then moves the dino with /dino assign. The reveal card is durable and is
    // never repainted, so it still holds the old button — this is stale SAME-MESSAGE
    // replay, which the router guard does not and cannot see.
    assignDino(ctx, 'u1', d.id, b2.id);
    const again = fakeButton({ customId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, again.asInteraction());
    expect(replyText(again.replies[0])).toBe(`Already assigned to lot #${b2.id}.`);
    expect(lotOf(d.id)).toBe(b2.id);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-assign.test.ts`

(Whole file, not `-t "park:assign"`: that filter also matches the describe Task 14 (G5-D) adds, and
a `-t` string that silently matches the wrong set — or none at all, which exits 0 with
everything skipped — is a trap this repo has already paid for.)

Expected: FAIL on `routes the minted id through the registry and assigns the dino` at its
FIRST assertion — `expected [ { kind: 'update' } ] to have a length of 0 but got 1`. `assign`
is not a `case`, so it falls to the switch's `default:` arm, which acknowledges with
`deferUpdate()` instead of dispatching. Task 11 (G5-A)'s and Task 12 (G5-B)'s cases stay green.

- [ ] **Step 4: Extend the three imports in `src/modules/park/index.ts`**

Replace the `./dinos.js` import line with:

```typescript
import { assignDino, unassignDino, decorateLot, listDinos, paddockCapacity, eligiblePaddocks, PADDOCK_FULL, DINO_ESCAPED, AssignError, DietMismatchError, renameDino } from './dinos.js';
```

Replace the `./embeds.js` import line with:

```typescript
import { dashboardPayload, animalsPayload, lotsPayload, prestigePayload, confirmPayload, assignRow, assignSelectRow, withParkImage, landmarkPayload, isParkTab, type ParkTab } from './embeds.js';
```

Replace the line `import type { AttachmentBuilder, ButtonInteraction } from 'discord.js';` with:

```typescript
import type { AttachmentBuilder, ButtonInteraction, MessageComponentInteraction } from 'discord.js';
```

(`assignSelectRow` is imported here rather than in Task 14 (G5-D) so both assign edits to this
import line happen once; it is used in Task 14 (G5-D)'s `assignpick` case.)

- [ ] **Step 5: Insert the two helpers**

Insert immediately **before** the line `export const parkModule: ModuleManifest = {`:

```typescript
// The Upgrade menu's stale-anchor wording, minus its "for current prices" tail: an assign
// moves no money, and pointing a player at prices they never asked about reads as a
// different bug. The stem is identical on purpose — it is the same class of failure, an id
// naming a lot that no longer answers for what its label promised.
const STALE_ASSIGN = 'That lot changed — open `/park view` again.';

// The AssignError texts a follow-through clicker reads VERBATIM. Everything else assignDino
// can raise ('You do not own that dino.', 'You do not own that lot.', 'Dinos can only go in
// paddocks.') describes an id that should never have been clickable, and those become
// STALE_ASSIGN.
//
// This Set IS the room re-check. There is no second occupancy read before the call: one
// would answer with the same sentence a layer earlier and could never be watched failing.
// Emptying this Set is what makes the full-paddock and escaped-dino cases go red — see the
// break step in this task.
const PASS_THROUGH = new Set<string>([PADDOCK_FULL, DINO_ESCAPED]);

/**
 * The refusal a follow-through assign control owes for this dino, or null when it may
 * proceed. ONE rule, and it is the one rule nothing else in this feature provides.
 *
 * assignDino relocates a dino perfectly happily, and `park:assign:<uid>:<dinoId>:<lotId>`
 * sits on a PUBLIC hatch reveal that is never repainted. Without this: hatch, click
 * "Assign to #1", later run `/dino assign dino:… lot:3`, scroll up, click the old button —
 * and the dino is silently dragged back to lot 1, with a different decor set, a different
 * level, and a different comfort, income and rating behind it. The router's
 * clickedIdIsOnMessage closes CROSS-message anchoring only and says nothing about this.
 * So the follow-through is a FIRST-HOME control: it gives a brand-new dino its first
 * paddock and refuses thereafter. Moving a dino that already has one is `/dino assign`'s job.
 *
 * A dino this caller does not own, or a junk id, deliberately falls through as `null`:
 * assignDino refuses both and the catch turns them into STALE_ASSIGN. An arm here would
 * produce the identical sentence one layer earlier and could never be watched failing.
 *
 * Synchronous by design: the caller's read and its write must have no suspension point
 * between them, and an async helper here would put an `await` inside that pair.
 */
function assignRefusal(ctx: Ctx, userId: string, dinoId: number): string | null {
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (dino && dino.lotId !== null) return `Already assigned to lot #${dino.lotId}.`;
  return null;
}

/**
 * The one place a follow-through assign control turns a (dinoId, lotId) pair into an
 * assignment, shared by the park:assign button and the park:assignsel menu so the two
 * cannot validate differently.
 *
 * assignDino IS THE AUTHORITY, and the catch below is the whole of this handler's contract
 * with it: PASS_THROUGH decides which of its refusals a player reads as written and which
 * collapse to staleness. Nothing is re-checked ahead of the call except the first-home rule,
 * which assignDino has no opinion about.
 *
 * No `await` sits between assignRefusal's read and assignDino's write, deliberately:
 * better-sqlite3 is synchronous and the absence of a suspension point is what makes that
 * pair atomic.
 */
async function assignFollowThrough(
  ctx: Ctx, i: MessageComponentInteraction, dinoId: number, lotId: number,
): Promise<void> {
  settleEscapes(ctx, i.user.id);
  const refusal = assignRefusal(ctx, i.user.id, dinoId);
  if (refusal !== null) { await i.reply({ content: refusal, flags: MessageFlags.Ephemeral }); return; }
  try {
    assignDino(ctx, i.user.id, dinoId, lotId);
  } catch (e) {
    // DietMismatchError is a SEPARATE class, not an AssignError subclass, so it needs its
    // own arm. It always means a forged id: the mint side never offers an off-diet paddock,
    // and the "Assign anyway" confirm lives on /dino assign alone.
    if (e instanceof DietMismatchError) {
      await i.reply({ content: STALE_ASSIGN, flags: MessageFlags.Ephemeral });
      return;
    }
    if (e instanceof AssignError) {
      await i.reply({
        content: PASS_THROUGH.has(e.message) ? e.message : STALE_ASSIGN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw e;
  }
  await i.reply({ content: `🦕 Assigned to lot #${lotId}.`, flags: MessageFlags.Ephemeral });
}
```

- [ ] **Step 6: Insert the `assign` case**

In the `park` component switch, insert immediately **before** the line `          case 'dinos': {`:

```typescript
          case 'assign': {
            // park:assign:<uid>:<dinoId>:<lotId> — minted where exactly one paddock was
            // eligible. This owner check is a MESSAGE-QUALITY layer, not the write barrier:
            // assignRefusal and assignDino both resolve the dino against the CLICKER, so a
            // bystander is already refused one level down. What it buys is that the
            // bystander is told "not yours" instead of a staleness line that would
            // misdescribe what happened.
            if (i.user.id !== uid) { await i.reply({ content: 'Not your assignment.', flags: MessageFlags.Ephemeral }); return; }
            await assignFollowThrough(ctx, i, Number(parts[3]), Number(parts[4]));
            return;
          }
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: PASS, Task 11 (G5-A)'s and Task 12 (G5-B)'s cases included.

- [ ] **Step 8: Break the first-home guard and watch that assertion fail**

In `assignRefusal`, temporarily change `if (dino && dino.lotId !== null)` to `if (false)`.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "first-home control"`

Expected: FAIL with `expected '🦕 Assigned to lot #1.' to be 'Already assigned to lot #2.'`,
and — this is the point — `expect(lotOf(d.id)).toBe(b2.id)` fails too on the follow-up run
once the message assertion is removed: the stale button really does drag the dino back out of
the lot the player last put it in. This is the one arm of the feature that nothing else
re-checks. **Restore the check and re-run — the file must go green again.**

- [ ] **Step 9: Break `PASS_THROUGH` and watch both of its assertions fail**

Temporarily change the constant to `const PASS_THROUGH = new Set<string>();`.

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: TWO failures, and no others —
`says the paddock is full when it filled up between mint and click` with
``expected 'That lot changed — open `/park view` again.' to be 'That paddock is full.'``, and
`says the dino has escaped rather than blaming the lot` with the same left-hand side against
`'That dino has escaped — rescue it first.'`. This is what makes the room check observable at
all: with every AssignError collapsing to one sentence, the two layers are indistinguishable
and nothing can tell you the check ran. **Restore the Set and re-run.**

- [ ] **Step 10: Break the diet arm and watch it fail**

In `assignFollowThrough`, temporarily delete the `if (e instanceof DietMismatchError) { … }`
block so the error falls through to `throw e`.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "off-diet paddock"`

Expected: FAIL with
``expected 'Something went wrong — nothing was charged. Try again.' to be 'That lot changed — open `/park view` again.'``
— `DietMismatchError` does not extend `AssignError`, so with its arm gone it escapes to
`routeInteraction`'s outer catch, which is the generic failure reply. That is also the proof
this arm is live code rather than a formality: `assignDino`'s diet check, not any pre-check,
is what stops a forged off-diet id on the execution path. **Restore the block and re-run.**

- [ ] **Step 11: Break the owner check and watch that assertion fail**

In `case 'assign'`, temporarily change the owner check to `if (false) {`.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "refuses a bystander and writes nothing"`

Expected: FAIL with
``expected 'That lot changed — open `/park view` again.' to be 'Not your assignment.'``.
NOTE, and do not misread this: **the dino is NOT moved even with the check disabled.**
`assignRefusal` and `assignDino` both resolve the dino against `i.user.id`, so u2 finds
nothing and is refused one layer down; `expect(lotOf(d.id)).toBeNull()` still passes. This
check exists to give a bystander the right message, never to prevent the write — do not
describe it as the thing that stops the assignment. **Restore the check and re-run.**

- [ ] **Step 12: Commit**

```bash
git add src/modules/park/index.ts tests/follow-through-assign.test.ts
git commit -m "feat(park): route park:assign, the first-home follow-through button"
```

---

---

### Task 14: `park:assignpick` and the `park:assignsel` select

_Stable id: `G5-D`_

**Files:**
- Modify: `src/modules/park/index.ts`, two edits, both anchored on quoted text:
  - insert the new `case 'assignpick'` in the component switch immediately after the `case 'assign'` block added by Task 13 (G5-C) closes, i.e. still immediately before the line `          case 'dinos': {`
  - insert the `assignsel` branch in the **select** handler immediately before the trailing `        await i.deferUpdate();` that closes its `execute` (the one following the `if (action === 'upgrade') { … }` block; line 496 today). **Task 16 (G6-A) inserts its own `builddinosel` branch at this same anchor and lands after this task**, so re-read the region before editing rather than trusting a line number.
- Test: `tests/follow-through-assign.test.ts` (append)

**Interfaces:**
- Consumes: `assignSelectRow(userId, dinoId, eligible)` (Task 12 (G5-B), already imported into `index.ts` by Task 13 (G5-C)); `assignFollowThrough`, `assignRefusal`, `STALE_ASSIGN` (Task 13 (G5-C)); `eligiblePaddocks` (Task 11 (G5-A)); `settleEscapes` (repo, line 7).
- Produces: routed customIds `park:assignpick:<uid>:<dinoId>` (component namespace) and `park:assignsel:<uid>:<dinoId>` (select namespace, values are `String(lotId)`).

**No registry change is owed.** `park` already holds both a component prefix and a select
prefix on `parkModule`, so `ModuleRegistry`'s boot-time duplicate checks are untouched, and
`tests/router.test.ts`'s hardcoded `PREFIXES` sweep already lists `park` — nothing to add
there either.

**What the select handler still validates for itself:** the router proves
`clickedIdIsOnMessage` (the bot minted this menu on this message) and
`submittedValuesAreOnMessage` (the value was one this menu offered). Neither proves the value
is still LEGAL. The handler therefore still owns the owner check against `uid` and — through
`assignFollowThrough` — the first-home rule and everything `assignDino` re-reads.

- [ ] **Step 1: Extend the test file's harness import**

Add `fakeSelect` to the existing `./harness.js` import in `tests/follow-through-assign.test.ts`:

```typescript
import { makeCtx, fakeButton, fakeSelect, replyText, testRegistry } from './harness.js';
```

- [ ] **Step 2: Append the failing cases**

Append to `tests/follow-through-assign.test.ts`:

```typescript
const menuOf = (reply: unknown) => (JSON.parse(JSON.stringify(reply)) as {
  components: Array<{ components: Array<{ custom_id: string; options: Array<{ value: string }> }> }>;
}).components[0]!.components[0]!;

describe('park:assignpick and park:assignsel', () => {
  it('the picker opens an ephemeral menu of exactly the currently eligible paddocks', async () => {
    seedUser();
    const a = seedLot(); const b2 = seedLot();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });   // never offered
    const d = seedDino();
    const btn = fakeButton({ customId: `park:assignpick:u1:${d.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, btn.asInteraction());
    expect(btn.deferOpts).toHaveLength(0);
    expect((btn.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    const menu = menuOf(btn.replies[0]);
    expect(menu.custom_id).toBe(`park:assignsel:u1:${d.id}`);
    expect(menu.options.map((o) => o.value)).toEqual([String(a.id), String(b2.id)]);
  });

  it('the picker refuses a bystander', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    seedLot(); seedLot();
    const d = seedDino();
    const btn = fakeButton({ customId: `park:assignpick:u1:${d.id}`, user: 'u2' });
    await routeInteraction(ctx, testRegistry, btn.asInteraction());
    expect(replyText(btn.replies[0])).toBe('Not your assignment.');
  });

  it('the picker refuses a dino that already has a home', async () => {
    seedUser();
    const a = seedLot(); seedLot();
    const d = seedDino({ lotId: a.id });
    const btn = fakeButton({ customId: `park:assignpick:u1:${d.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, btn.asInteraction());
    expect(replyText(btn.replies[0])).toBe(`Already assigned to lot #${a.id}.`);
  });

  it('the picker refuses rather than opening an empty menu', async () => {
    seedUser();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });   // off diet only
    const d = seedDino();
    const btn = fakeButton({ customId: `park:assignpick:u1:${d.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, btn.asInteraction());
    expect(replyText(btn.replies[0])).toBe('That lot changed — open `/park view` again.');
  });

  it('routes the select through the registry and assigns to the picked lot', async () => {
    seedUser();
    const a = seedLot(); const b2 = seedLot();
    const d = seedDino();
    const s = fakeSelect({
      customId: `park:assignsel:u1:${d.id}`, user: 'u1',
      values: [String(b2.id)], options: [String(a.id), String(b2.id)],
    });
    await routeInteraction(ctx, testRegistry, s.asInteraction());
    expect(replyText(s.replies[0])).toBe(`🦕 Assigned to lot #${b2.id}.`);
    expect(lotOf(d.id)).toBe(b2.id);
  });

  it('says the paddock is full when an offered lot filled up before the pick', async () => {
    seedUser();
    const a = seedLot(); const b2 = seedLot();
    const d = seedDino();
    seedDino({ lotId: b2.id }); seedDino({ lotId: b2.id });   // b2 is now 2/2
    const s = fakeSelect({
      customId: `park:assignsel:u1:${d.id}`, user: 'u1',
      values: [String(b2.id)], options: [String(a.id), String(b2.id)],
    });
    await routeInteraction(ctx, testRegistry, s.asInteraction());
    // Same sentence the button path gives for the same cause — the two share
    // assignFollowThrough precisely so they cannot disagree.
    expect(replyText(s.replies[0])).toBe('That paddock is full.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('refuses a bystander submitting the menu', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    const a = seedLot();
    const d = seedDino();
    const s = fakeSelect({
      customId: `park:assignsel:u1:${d.id}`, user: 'u2',
      values: [String(a.id)], options: [String(a.id)],
    });
    await routeInteraction(ctx, testRegistry, s.asInteraction());
    expect(replyText(s.replies[0])).toBe('Not your park.');
    expect(lotOf(d.id)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-assign.test.ts -t "park:assignpick"`

Expected: FAIL on the first case at its FIRST assertion —
`expected [ { kind: 'update' } ] to have a length of 0 but got 1`. `assignpick` is not a
`case`, so the switch's `default:` arm acknowledges with `deferUpdate()` and nothing is
replied.

- [ ] **Step 4: Add the `assignpick` case**

In the component switch, insert immediately after the `case 'assign'` block added by Task 13 (G5-C) (still immediately before `          case 'dinos': {`):

```typescript
          case 'assignpick': {
            // park:assignpick:<uid>:<dinoId> — the menu's options are derived HERE, at click
            // time, and never carried in the id: this button may have been minted an hour ago.
            if (i.user.id !== uid) { await i.reply({ content: 'Not your assignment.', flags: MessageFlags.Ephemeral }); return; }
            const pickDinoId = Number(parts[3]);
            settleEscapes(ctx, i.user.id);
            // Same first-home rule the write path applies, checked before the menu opens so
            // an already-housed dino is told so once rather than after a pointless pick.
            const pickRefusal = assignRefusal(ctx, i.user.id, pickDinoId);
            if (pickRefusal !== null) { await i.reply({ content: pickRefusal, flags: MessageFlags.Ephemeral }); return; }
            const eligible = eligiblePaddocks(ctx, i.user.id, pickDinoId);
            // NEVER fall through to assignSelectRow with an empty list: a zero-option select
            // is rejected outright, which would turn a legible refusal into the router's
            // generic failure line. This also covers a forged or junk dinoId, which
            // eligiblePaddocks answers with [].
            if (eligible.length === 0) { await i.reply({ content: STALE_ASSIGN, flags: MessageFlags.Ephemeral }); return; }
            // Ephemeral, never i.update: this button can sit on a PUBLIC hatch reveal, and
            // rewriting somebody's reveal card into a private chooser is the wrong trade.
            await i.reply({
              content: 'Which paddock?',
              components: [assignSelectRow(i.user.id, pickDinoId, eligible)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
```

- [ ] **Step 5: Add the `assignsel` select branch**

In the `park` **select** handler, insert immediately before its trailing
`        await i.deferUpdate();`:

```typescript
        if (action === 'assignsel') {
          // The router proved both halves centrally (clickedIdIsOnMessage, then
          // submittedValuesAreOnMessage), and the owner check at the top of this handler
          // proved the clicker. What is left is DOMAIN validity, which no guard can give
          // us: the first-home rule, and whether that lot is still a diet-matching paddock
          // with room. Both live in assignFollowThrough, which park:assign shares — the
          // two paths cannot answer the same question differently.
          await assignFollowThrough(ctx, i, Number(i.customId.split(':')[3]), Number(value));
          return;
        }
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: PASS.

- [ ] **Step 7: Break the empty-menu guard and watch that assertion fail**

In `case 'assignpick'`, temporarily change `if (eligible.length === 0)` to `if (false)`.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "rather than opening an empty menu"`

Expected: FAIL with
``expected 'Something went wrong — nothing was charged. Try again.' to be 'That lot changed — open `/park view` again.'``
— `assignSelectRow` builds a select with no options, the payload validator
(`tests/lib/discord-limits.ts`) rejects it before the fake records a reply, and
`routeInteraction`'s outer catch answers with the generic line. In production the same shape
is a rejected message. **Restore the guard and re-run.**

- [ ] **Step 8: Break the picker's owner check and watch that assertion fail**

In `case 'assignpick'`, temporarily change the owner check to `if (false) {`.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "the picker refuses a bystander"`

Expected: FAIL with
``expected 'That lot changed — open `/park view` again.' to be 'Not your assignment.'`` —
`eligiblePaddocks` resolves the dino against u2, finds nothing, and the empty-menu guard
answers. As on the button, this check buys the right sentence and not the refusal itself.
**Restore the check and re-run.**

- [ ] **Step 9: Break the select's owner check and watch that assertion fail**

Temporarily change the select handler's existing owner check — `if (i.user.id !== uid) {` at
the top of its `execute` — to `if (false) {`.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "refuses a bystander submitting the menu"`

Expected: FAIL with
``expected 'That lot changed — open `/park view` again.' to be 'Not your park.'`` — u2's own
dino lookup inside `assignRefusal`/`assignDino` finds nothing, so `expect(lotOf(d.id)).toBeNull()`
still passes either way. A bystander cannot move another player's dino with or without it.
**Restore the check and re-run.**

- [ ] **Step 10: Commit**

```bash
git add src/modules/park/index.ts tests/follow-through-assign.test.ts
git commit -m "feat(park): add the assign picker button and its paddock select"
```

---

---

### Task 15: `park:goto:lots` — where "Build a paddock" lands

_Stable id: `G5-E`_

**Files:**
- Modify: `src/modules/park/index.ts`, four edits, all anchored on quoted text:
  - the `./service.js` import (line 5 today) — **Task 7 (G2-C) has already added `maxLevelFor` to this line; re-read it before editing**
  - insert `lotsTab` immediately after the manifest's closing `};` (the one that follows the `components: [ … ]` array) and before `renderTab`'s doc comment
  - replace `renderTab`'s whole `if (tab === 'lots') { … }` branch — **Task 7 (G2-C) has already rewritten its max-level filter to `maxLevelFor(l.kind)`; re-read the branch before replacing it**
  - insert the `lots` target inside `case 'goto'`, after the `if (target === 'roster') { … }` block closes and before that case's trailing `await i.deferUpdate();`
- Test: `tests/follow-through-assign.test.ts` (append)

**Interfaces:**
- Consumes: `maxLevelFor(kind: string): number` from `src/modules/park/service.ts` (**Task 7 (G2-C)** — this task must land after it, and must call it rather than reintroducing the `?? 4` literal or its now-dead comment about `upgradeLot`'s ternary); `assignRow` mints `park:goto:lots:<uid>` (Task 12 (G5-B)); repo symbols `lotsPayload`, `lotSlots`, `upgradeCostFor`, `PADDOCKS`, `FACILITIES`, `schema`, `eq`, `MessageFlags`, all already imported in `index.ts`.
- Produces: module-private `function lotsTab(user: User, lots: Lot[], visit: boolean)` in `src/modules/park/index.ts`, returning `lotsPayload`'s payload shape; routed target `park:goto:lots:<uid>` on the existing `park:goto` branch (**owner id is at parts index 3, not the switch's outer `uid`**).

- [ ] **Step 1: Append the failing cases**

Append to `tests/follow-through-assign.test.ts`:

```typescript
describe('park:goto:lots — the Build a paddock landing', () => {
  it('routes the button to an ephemeral Lots surface carrying the Build and Upgrade menus', async () => {
    seedUser();
    seedLot({ type: 'facility', kind: 'gene_lab', name: 'Gene Lab' });
    const b = fakeButton({ customId: 'park:goto:lots:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    const json = JSON.stringify(b.replies[0]);
    expect(json).toContain('park:build:u1');
    expect(json).toContain('park:upgrade:u1');
    // lotsPayload appends tabRow on EVERY call, unlike landmarkPayload/guestsPayload/
    // dinoListPayload. This reply is not the card the player is navigating — it is a routed
    // ephemeral opened FROM one — so the row is stripped: leaving it would turn this
    // ephemeral into a second, parallel park dashboard on the first tab click, which is
    // exactly the duplication the goto family exists to avoid.
    expect(json).not.toContain('park:tab:u1:');
  });

  it('refuses a bystander', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    const b = fakeButton({ customId: 'park:goto:lots:u1', user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('Not your park.');
  });

  it('the Lots TAB still keeps its tab row after the extraction', async () => {
    seedUser();
    seedLot({ type: 'facility', kind: 'gene_lab', name: 'Gene Lab' });
    const b = fakeButton({ customId: 'park:tab:u1:lots', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const json = JSON.stringify(b.replies[0]);
    expect(json).toContain('park:build:u1');
    expect(json).toContain('park:upgrade:u1');
    expect(json).toContain('park:tab:u1:animals');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-assign.test.ts -t "park:goto:lots"`

Expected: FAIL on the first case at its FIRST assertion —
`expected [ { kind: 'update' } ] to have a length of 0 but got 1`. `lots` is not a recognised
`goto` target, so the branch falls to that case's trailing `await i.deferUpdate()` and
replies nothing.

- [ ] **Step 3: Add the two row types to the `./service.js` import**

Re-read line 5 first — Task 7 (G2-C) has already added `maxLevelFor` to it. Append
`, type User, type Lot` inside the existing braces, leaving every other name exactly as
found. After the edit the line reads (names in this order, `maxLevelFor` from Task 7 (G2-C)):

```typescript
import { getOrCreateUser, buildLot, upgradeLot, upgradeCostFor, maxLevelFor, collectIncome, pendingIncome, capHours, LotLimitError, UnknownKindError, DuplicateFacilityError, StaleLevelError, toClockDinos, needsAttentionCount, type User, type Lot } from './service.js';
```

If Task 7 (G2-C) placed `maxLevelFor` elsewhere in the list, keep its position and only append the
two type names.

- [ ] **Step 4: Extract `lotsTab`**

Insert immediately after the manifest's closing `};`, before `renderTab`'s doc comment:

```typescript
/**
 * The Lots tab's view model, in one place. Both the tab click and park:goto:lots render
 * through it, so the buildable and upgradable filters cannot drift between two call sites —
 * the same reason upgradeCostFor is a single helper.
 *
 * The max-level filter goes through maxLevelFor (src/modules/park/service.ts), the same
 * resolver upgradeLot charges through, and NEVER a local literal: a menu that offers a maxed
 * lot is merely a wasted click, but a menu built off a different cap than the charge is how a
 * label and a price come apart.
 *
 * Takes the rows the caller already read: a tab switch pays for this render's SELECTs as it
 * is, and re-reading here would add two more to every click.
 */
function lotsTab(user: User, lots: Lot[], visit: boolean) {
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
  const upgradable = lots
    .filter((l) => l.level < maxLevelFor(l.kind))
    .map((l) => ({ lotId: l.id, name: l.name, level: l.level, cost: upgradeCostFor(l.kind, l.level) }));
  return lotsPayload(user, lots, lotSlots(user.ratingHighWater), { visit, buildable, upgradable });
}
```

- [ ] **Step 5: Point `renderTab` at it**

Re-read the branch first:

```bash
sed -n "/if (tab === 'lots') {/,/^  }/p" src/modules/park/index.ts
```

Replace that whole branch — from the line `  if (tab === 'lots') {` through its closing `  }`
— with:

```typescript
  if (tab === 'lots') {
    const built = lotsTab(user, lots, visit);
    if (tourRow) built.components.push(tourRow);
    await i.update({ content: content ?? '', ...built, attachments: [] });
    return;
  }
```

- [ ] **Step 6: Add the `lots` target to `case 'goto'`**

Insert after the `if (target === 'roster') { … }` block closes and before that case's trailing
`await i.deferUpdate();`:

```typescript
            if (target === 'lots') {
              // The landing for assignRow's third shape, "🏗️ Build a paddock", minted on
              // the hatch reveal when nothing is eligible. Ephemeral exactly like the
              // landmark/guests/roster targets beside it: that button can sit on a PUBLIC
              // reveal card, and an i.update would rewrite somebody's card into a private
              // build screen.
              const ownLots = ctx.db.select().from(schema.lots)
                .where(eq(schema.lots.userId, i.user.id)).all();
              const built = lotsTab(fresh, ownLots, false);
              // Unlike landmarkPayload/guestsPayload/dinoListPayload, lotsPayload appends a
              // tab row on EVERY call, so this one has to be stripped rather than merely not
              // added. A decision, not an oversight: a tab click on this ephemeral would
              // advance THIS message, handing the player a second, parallel park card beside
              // the one they opened it from. The Build menu it keeps mints park:build:<uid>,
              // whose confirm re-renders this same ephemeral.
              //
              // `as unknown as` because the builder union's toJSON() types disagree about
              // whether custom_id is optional; the walk only reads it.
              built.components = built.components.filter((r) => {
                const row = r.toJSON() as unknown as { components?: Array<{ custom_id?: string }> };
                return !(row.components ?? []).some((c) => c.custom_id?.startsWith(`park:tab:${i.user.id}:`));
              });
              await i.reply({ ...built, flags: MessageFlags.Ephemeral });
              return;
            }
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `npx vitest run tests/follow-through-assign.test.ts`

Expected: PASS.

- [ ] **Step 8: Prove the extraction did not change the Lots tab**

Run: `npx vitest run tests/lot-menus.test.ts tests/park-tabs.test.ts`

Expected: PASS, no case changed. `tests/lot-menus.test.ts` is the file that actually pins the
moved code: its `park:tab:u1:lots` cases — `renderTab wires the owned-facility filter into the
minted menu`, `mints no build menu once every lot slot is used` and `renderTab excludes a lot
already at max level from the minted options` — dispatch a real Lots tab click and read the
minted menus back, which is precisely what moved into `lotsTab`. Do NOT verify this with
`tests/park.test.ts`: its only Lots coverage is a direct `lotsPayload(...)` call, which never
reaches `renderTab` at all and would report green against a broken extraction.

- [ ] **Step 9: Break `maxLevelFor` and watch the extracted filter fail**

In `src/modules/park/service.ts`, temporarily replace `maxLevelFor`'s body with `return 99;`.

Run: `npx vitest run tests/lot-menus.test.ts`

Expected: FAIL on `renderTab excludes a lot already at max level from the minted options` —
the level-3 `gene_lab` is no longer filtered out and appears in the minted Upgrade options.
That is the proof `lotsTab` really resolves the cap through `maxLevelFor` and not through a
literal of its own. **Restore the body and re-run.**

- [ ] **Step 10: Break the tab-row strip and watch that assertion fail**

In the `lots` goto target, temporarily comment out the `built.components = built.components.filter(…)`
assignment.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "park:goto:lots"`

Expected: FAIL on the first case with `expected '…' not to contain 'park:tab:u1:'` — the
ephemeral grows a full navigation row and becomes a second park card. **Restore the strip and
re-run.**

(No break step is owed for the `goto` owner check: it is pre-existing, shared with the
landmark/guests/roster targets, and this task only extends the set of targets behind it. The
bystander case above pins that the new target sits behind it too.)

- [ ] **Step 11: Commit**

```bash
git add src/modules/park/index.ts tests/follow-through-assign.test.ts
git commit -m "feat(park): land the Build a paddock control on an ephemeral Lots surface"
```

---

---

### Task 16: a new paddock offers an assign menu, on both build paths

_Stable id: `G6-A`_

A new paddock earns nothing until a dino lives in it. Today `/build` replies with a sentence telling
the player to go type `/dino assign`. This task replaces that with a button that opens a private menu
of the dinos that could actually move in — and mints the same button on the **other** way a paddock
gets built, the `park:buildyes` confirm behind the Lots tab's **Build…** dropdown, which is the path
`/park view` actively pushes players toward.

Four shapes must be right, and all four are decided in the handler, never by the menu: a paddock with
room and candidates gets the menu; a paddock that filled up gets `That paddock is full.`; a player who
owns dinos of the right diet but none free gets one sentence; a player who owns none of that diet at
all gets a **different** sentence. **Discord rejects a select carrying zero options**, so the empty
cases are not cosmetic — a menu built from an empty candidate list is an error payload, not an empty
dropdown.

The two empty cases are split for the reason `feedDino` already splits its own in
`src/modules/care/service.ts` (*"Two causes, two messages: telling a player holding 12 Fish that they
have no carnivore food is a false statement, not merely a vague one."*). "Every one you own is housed
or escaped" is FALSE for a new player who owns no herbivore at all, and `/dino unassign` cannot help
them — and that is exactly the case an operator reaches by building their first paddock.

**Two decisions this task inherits rather than re-litigates.**
1. `That paddock is full.` is the sentence a full paddock gets on **every** assign path, so this task
   imports `PADDOCK_FULL` from Task 11 (G5-A) rather than writing a second copy of the string.
2. The pick is executed by Task 13 (G5-C)'s `assignFollowThrough`, not by a second `assignDino` call site.
   One write path means the button and both menus cannot validate differently, and it is what gives
   this menu the first-home rule and the `DietMismatchError` → `STALE_ASSIGN` mapping for free.

**`docs/commands.md` is NOT edited here.** Task 31 (G8-C) is the sole writer of that file and owns the
`/build` row.

**Files:**
- Modify: `src/modules/park/dinos.ts` — append `assignableDinosFor` at the end of the file, after
  `listDinos`'s closing `}`. (Task 11 (G5-A) inserted `PADDOCK_FULL`, `paddockAccepts` and
  `eligiblePaddocks` higher up, between `assignDino` and `unassignDino`; this append does not touch
  that region.)
- Modify: `src/modules/park/embeds.ts` — append the two row builders at the end of the file, after
  `assignSelectRow`'s closing `}` (Task 12 (G5-B) appended it after `tabRow`).
- Modify: `src/modules/park/index.ts` — five edits, **every one anchored on quoted text**, because
  Tasks G1-B, G2-B, G2-C, G5-C, G5-D and G5-E all write to this file first and each edit invalidates
  the next task's line numbers:
  - the `./dinos.js` import line (add `assignableDinosFor`, `PADDOCK_FULL`)
  - the `./embeds.js` import line (add `buildDinoRow`, `buildDinoSelectRow`)
  - line 1's discord.js value import (add `StringSelectMenuBuilder`, `StringSelectMenuOptionBuilder`)
  - the `/build` execute's reply, quoted as the `const hint = …` line plus the `await i.reply(…)`
    under it — **Task 2 (G1-B)'s hoisted `const kind` above the `try`, and the whole `catch` under it,
    are left exactly as they are**
  - the `park:buildyes` success line, quoted as its `await renderTab(…)` call
  - a new `case 'builddino'` inserted immediately before the line `          case 'buildno':`
  - a new `if (action === 'builddinosel')` branch inserted immediately before the `await i.deferUpdate();`
    that closes the park SELECT handler — the one followed by `      },` then `    },` then `  ],`
    then `  components: [`. Task 14 (G5-D) inserted its `assignsel` branch at that same anchor already;
    both insert BEFORE that closing `deferUpdate`, so the anchor survives either order.
- Modify: `tests/park.test.ts` — retarget the existing `it('/build paddock reply hints at assigning a dino', …)`
  case, anchored on its own text.
- Test: `tests/build-assign.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 2 (G1-B) — `const kind = i.options.getString('kind', true);` hoisted above the `/build` `try`,
    and the `InsufficientFundsError` arm in that `catch` that dereferences it. Re-inlining the read
    would delete a binding the catch still references (TS2304).
  - Task 11 (G5-A) — `PADDOCK_FULL: string` (the value `'That paddock is full.'`),
    `paddockAccepts(lot: Lot, diet: Diet, occupants: number): boolean`, and
    `eligiblePaddocks(ctx: Ctx, userId: string, dinoId: number): Lot[]`, all from
    `src/modules/park/dinos.js`.
  - Task 12 (G5-B) — `assignRow` / `assignSelectRow` in `src/modules/park/embeds.ts`; this task's two
    builders are appended beside them, in the same file, on purpose.
  - Task 13 (G5-C) — module-private `const STALE_ASSIGN = 'That lot changed — open \`/park view\` again.'`
    and `assignFollowThrough(ctx: Ctx, i: MessageComponentInteraction, dinoId: number, lotId: number): Promise<void>`
    in `src/modules/park/index.ts`; also the `./dinos.js` and `./embeds.js` import lines it already
    extended, and the `MessageComponentInteraction` type import it added.
  - Task 14 (G5-D) — the `if (action === 'assignsel') { … }` branch already sitting before the select
    handler's trailing `deferUpdate()`.
  - Already in the repo, verified: `buildLot(ctx: Ctx, userId: string, kind: string): Lot`
    (`src/modules/park/service.ts`); `type Lot = typeof schema.lots.$inferSelect`;
    `assignDino(ctx, userId, dinoId, lotId, opts?): void` and
    `paddockCapacity(level: number): number` (`src/modules/park/dinos.ts`);
    `PADDOCKS: Record<string, PaddockDef>` (null-prototype — `PADDOCKS[kind].diet` on a facility row
    throws a TypeError, so `lot.type === 'paddock'` must be proven first);
    `getSpecies(id: string): Species`; `dinoLabel(dino, species, now): string`
    (`src/core/autocomplete.ts`, already imported into `park/index.ts`);
    `settleEscapes(ctx, userId): number[]`; `routeInteraction(ctx, registry, interaction, hooks?)`;
    `makeCtx`, `fakeCommand`, `fakeButton`, `fakeSelect`, `replyText`, `testRegistry`
    (`tests/harness.ts`).
- Produces:
  - `assignableDinosFor(ctx: Ctx, userId: string, lotId: number): { lot: Lot; hasRoom: boolean; ofDiet: Array<typeof schema.dinos.$inferSelect>; dinos: Array<typeof schema.dinos.$inferSelect> } | null`
    — exported from `src/modules/park/dinos.ts`
  - `buildDinoRow(userId: string, lotId: number): ActionRowBuilder<ButtonBuilder>` — exported from
    `src/modules/park/embeds.ts`; the ONLY place `park:builddino:<uid>:<lotId>` and its label are
    written
  - `buildDinoSelectRow(userId: string, lotId: number, dinos: Array<{ id: number; label: string }>): ActionRowBuilder<StringSelectMenuBuilder>`
    — exported from `src/modules/park/embeds.ts`; mints `park:builddinosel:<uid>:<lotId>` with one
    option per dino, each option's value the dino id as a decimal string
  - routed customId `park:builddino:<uid>:<lotId>` — a button on the existing `park` **component**
    prefix, as `case 'builddino'`
  - routed customId `park:builddinosel:<uid>:<lotId>` — a string select on the existing `park`
    **select** prefix, as `action === 'builddinosel'`
  - `park:buildyes` gains an ephemeral follow-up carrying `buildDinoRow` when the built lot is a
    paddock

---

- [ ] **Step 1: Write the failing test — the `/build` reply mints the button**

Create `tests/build-assign.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, fakeSelect, replyText, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino } from '../src/modules/park/dinos.js';
import { parkModule } from '../src/modules/park/index.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
});

const buildCmd = () => parkModule.commands.find((c) => c.data.name === 'build')!;
const addDino = (speciesId: string, over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId, lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();
const dinoOf = (id: number) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;

// Every customId on a recorded payload, read out of the REAL builder JSON (snake_case
// custom_id) rather than hand-typed, so these cases prove what the game actually mints.
const idsOf = (payload: unknown): string[] =>
  ((payload as { components?: ReadonlyArray<{ toJSON(): { components: Array<{ custom_id?: string }> } }> })
    .components ?? [])
    .flatMap((r) => r.toJSON().components)
    .map((c) => c.custom_id)
    .filter((x): x is string => typeof x === 'string');

// Whether any minted id belongs to a family, for the cases that assert a control is ABSENT.
// A negative `toContain` on one exact id would pass against `park:builddino:u1:99`.
const hasIdStarting = (payload: unknown, stem: string) =>
  idsOf(payload).some((id) => id.startsWith(stem));

// The option VALUES of every string select (ComponentType.StringSelect === 3) on a payload.
const optionsOf = (payload: unknown): string[] =>
  ((payload as {
    components?: ReadonlyArray<{ toJSON(): { components: Array<{ type: number; options?: Array<{ value: string }> }> } }>;
  }).components ?? [])
    .flatMap((r) => r.toJSON().components)
    .filter((c) => c.type === 3)
    .flatMap((c) => (c.options ?? []).map((o) => o.value));

describe('/build offers the next step as a control', () => {
  it('a paddock build mints the assign button, carrying the owner and the lot', async () => {
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'herbivore_paddock' } });
    await buildCmd().execute(ctx, i.asChatInput());
    // The WHOLE id, not a stem: a reply that merely carried something starting with
    // 'park:builddino' would still pass with the lot segment dropped — the segment that
    // stops one button opening a menu against the wrong lot.
    expect(idsOf(i.replies[0])).toContain('park:builddino:u1:1');
    // The whole content string, so "no longer names /dino assign" is proven by what the
    // reply IS rather than by a negative substring check.
    expect((i.replies[0] as { content: string }).content)
      .toBe('🏗️ Built **Herbivore Paddock** (lot #1).');
  });

  it('a facility build mints no assign button — nothing lives in a Visitor Center', async () => {
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'visitor_center' } });
    await buildCmd().execute(ctx, i.asChatInput());
    expect(hasIdStarting(i.replies[0], 'park:builddino')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/build-assign.test.ts`

Expected: FAIL on `a paddock build mints the assign button` — `expected [] to include 'park:builddino:u1:1'`, because the `/build` reply carries no components at all. The content assertion would also fail: the reply still ends in ` Assign a dino with /dino assign to start earning.` The facility case PASSES already (nothing is minted anywhere yet); Step 8's break step is what turns it into evidence.

- [ ] **Step 3: Add the two row builders to `src/modules/park/embeds.ts`**

Append at the end of the file, after `assignSelectRow`'s closing `}`. Every symbol used is already
imported on line 1 (`ActionRowBuilder`, `ButtonBuilder`, `ButtonStyle`, `StringSelectMenuBuilder`,
`StringSelectMenuOptionBuilder`), so no import line changes:

```typescript
/**
 * The follow-through on a freshly built paddock: one button that opens a private menu of the
 * dinos that could move in. Minted by BOTH build paths — the /build slash reply and the
 * park:buildyes confirm behind the Lots tab's Build… dropdown — which is why the id and the
 * label live here and are written nowhere else.
 *
 * A button rather than the menu itself, because the /build reply is a PUBLIC message: a
 * select sitting on it would be visible to the channel, and the roster it lists is the
 * owner's business. The button carries the owner uid so a bystander's click is refused, and
 * the lot id so the handler re-reads that exact lot instead of trusting the label.
 *
 * Unicode glyph in the label, never emojiTag/setEmoji — the same reason tabRow gives.
 */
export function buildDinoRow(userId: string, lotId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`park:builddino:${userId}:${lotId}`)
      .setLabel('🦕 Assign a dino').setStyle(ButtonStyle.Primary),
  );
}

/**
 * The menu park:builddino opens. This is assignSelectRow's MIRROR and the two are easy to
 * confuse, so state it plainly: there the lot varies and a value is a LOT id; here the lot is
 * fixed in the customId and a value is a DINO id. Wiring one where the other belongs compiles
 * cleanly and silently assigns the wrong pair.
 *
 * A value is the dino id and nothing else — an identity, never a diet and never a capacity —
 * so a stale option cannot describe a dino it no longer names. The handler re-derives
 * everything; the router only proves the value was one this menu offered.
 *
 * Labels are passed in already rendered: this file has no species lookup and should not grow
 * one. Sliced at 25 for Discord's option cap, which a roster genuinely reaches.
 */
export function buildDinoSelectRow(
  userId: string, lotId: number, dinos: Array<{ id: number; label: string }>,
): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`park:builddinosel:${userId}:${lotId}`)
      .setPlaceholder('Pick a dino…')
      .addOptions(dinos.slice(0, 25).map((d) => new StringSelectMenuOptionBuilder()
        .setValue(String(d.id))
        .setLabel(d.label))),
  );
}
```

- [ ] **Step 4: Mint the button on the `/build` reply**

In `src/modules/park/index.ts`, extend the `./embeds.js` import line (Task 13 (G5-C) already added
`assignRow, assignSelectRow` to it — run `grep -n "from './embeds.js'" src/modules/park/index.ts`
and add only what is missing):

```typescript
import { dashboardPayload, animalsPayload, lotsPayload, prestigePayload, confirmPayload, assignRow, assignSelectRow, buildDinoRow, buildDinoSelectRow, withParkImage, landmarkPayload, isParkTab, type ParkTab } from './embeds.js';
```

Then replace these two lines inside the `/build` execute's `try` — and **nothing else in that
block**. Task 2 (G1-B)'s `const kind = i.options.getString('kind', true);` above the `try`, and the whole
`catch` under it, stay exactly as they are; re-inlining that read deletes a binding the
`InsufficientFundsError` arm still references:

```typescript
          const hint = lot.type === 'paddock' ? ' Assign a dino with /dino assign to start earning.' : '';
          await i.reply({ content: `🏗️ Built **${lot.name}** (lot #${lot.id}).${hint}` });
```

with:

```typescript
          // A paddock earns nothing until a dino lives in it, so the next step ships as a
          // control instead of a sentence naming a command to type.
          //
          // A named local that is PUSHED onto, never an array assigned wholesale: this reply
          // carries no other row today, and the next task to add one must be able to join it
          // rather than having to rewrite this expression.
          const rows: ActionRowBuilder<ButtonBuilder>[] = [];
          if (lot.type === 'paddock') rows.push(buildDinoRow(i.user.id, lot.id));
          await i.reply({ content: `🏗️ Built **${lot.name}** (lot #${lot.id}).`, components: rows });
```

- [ ] **Step 5: Retarget the existing hint case in `tests/park.test.ts`**

The behaviour that case protects — a paddock build points the player at the next step — still holds;
it is a control now. Retarget it rather than deleting it. Replace this exact block:

```typescript
  it('/build paddock reply hints at assigning a dino', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'herbivore_paddock' } });
    await parkModule.commands.find((c) => c.data.name === 'build')!.execute(ctx, i.asChatInput());
    expect((i.replies[0] as { content: string }).content).toContain('/dino assign');
  });
```

with:

```typescript
  it('/build paddock reply offers the assign control instead of naming /dino assign', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'herbivore_paddock' } });
    await parkModule.commands.find((c) => c.data.name === 'build')!.execute(ctx, i.asChatInput());
    // Retargeted, not deleted: this case guarded "a paddock build points at assigning a
    // dino", which is still true — it is a button now rather than an instruction to type.
    // The WHOLE content string, so the old hint's absence is proven by what the reply is.
    expect((i.replies[0] as { content: string }).content)
      .toBe('🏗️ Built **Herbivore Paddock** (lot #1).');
    expect(JSON.stringify(i.replies[0])).toContain('park:builddino:u1:1');
  });
```

- [ ] **Step 6: Run both files and watch them pass**

Run: `npx vitest run tests/build-assign.test.ts tests/park.test.ts`

Expected: PASS.

- [ ] **Step 7: Break the paddock-only condition on the `/build` reply, watch it fire, restore it**

Temporarily change

```typescript
          if (lot.type === 'paddock') rows.push(buildDinoRow(i.user.id, lot.id));
```

to

```typescript
          rows.push(buildDinoRow(i.user.id, lot.id));
```

Run: `npx vitest run tests/build-assign.test.ts -t "a facility build mints no assign button"`

Expected: FAIL — `expected true to be false`. The Visitor Center reply now carries an Assign button
whose menu can only ever answer `That lot changed — open /park view again.`, because
`assignableDinosFor` refuses a facility.

Restore the condition and re-run the same command; expected: PASS.

- [ ] **Step 8: Write the failing test for `assignableDinosFor`**

Add `assignableDinosFor` to the existing `../src/modules/park/dinos.js` import at the top of
`tests/build-assign.test.ts`:

```typescript
import { assignDino, assignableDinosFor } from '../src/modules/park/dinos.js';
```

Then append:

```typescript
describe('assignableDinosFor', () => {
  it('offers only free, unescaped, diet-matching dinos and reports whether there is room', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');   // level 1 → capacity 2
    const free = addDino('triceratops');
    const escaped = addDino('triceratops', { escapedAt: 1 });   // escaped — never offered
    addDino('velociraptor');                                    // carnivore — wrong diet
    const housed = addDino('triceratops');
    assignDino(ctx, 'u1', housed.id, lot.id);
    const pick = assignableDinosFor(ctx, 'u1', lot.id)!;
    // toEqual on the whole id list, not a .some(): three separate filters produce this
    // answer and a containment check would still pass with two of them deleted.
    expect(pick.dinos.map((d) => d.id)).toEqual([free.id]);
    // ofDiet is the WHOLE herbivore cohort — free, escaped and housed alike. It is what
    // lets the handler tell "you own none of this diet" from "none of yours is free",
    // and dropping the escaped or housed row from it collapses the two back into one.
    expect(pick.ofDiet.map((d) => d.id)).toEqual([free.id, escaped.id, housed.id]);
    expect(pick.hasRoom).toBe(true);          // 1 of 2 occupied
    expect(pick.lot.id).toBe(lot.id);
  });

  it('reports no room once the paddock is at its level capacity', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    addDino('triceratops');                                     // free, but nowhere to put it
    expect(assignableDinosFor(ctx, 'u1', lot.id)!.hasRoom).toBe(false);
  });

  it('is null for a lot that is not an owned paddock', () => {
    const facility = buildLot(ctx, 'u1', 'visitor_center');
    expect(assignableDinosFor(ctx, 'u1', facility.id)).toBeNull();   // a facility, not a paddock
    const mine = buildLot(ctx, 'u1', 'herbivore_paddock');
    expect(assignableDinosFor(ctx, 'u2', mine.id)).toBeNull();       // somebody else's lot
    expect(assignableDinosFor(ctx, 'u1', 9_999)).toBeNull();         // no such lot
  });
});
```

- [ ] **Step 9: Run the test and watch it fail**

Run: `npx vitest run tests/build-assign.test.ts -t "assignableDinosFor"`

Expected: FAIL — the file collects and RUNS normally. Vitest's SSR transform resolves a missing named
export to `undefined` rather than throwing at import, so each case fails at its call with
`TypeError: assignableDinosFor is not a function`. There is no `SyntaxError` and no collection error;
if you see one, something else is wrong.

- [ ] **Step 10: Add `assignableDinosFor` to `src/modules/park/dinos.ts`**

Append at the end of the file, after `listDinos`'s closing `}`. Every symbol it uses is already in
scope — `and`, `eq`, `schema`, `Ctx`, `getSpecies`, `PADDOCKS`, `Lot`, and `paddockAccepts` from
Task 11 (G5-A) — so no import line changes:

```typescript
/**
 * The dinos that could move into `lotId` right now: owned, unassigned, not escaped, and eating
 * what this paddock serves. Returns null when `lotId` is not an owned paddock — a read helper,
 * so a lot that is gone is an answer, not an exception.
 *
 * This is the LOT-FIXED direction. `eligiblePaddocks` above is the dino-fixed one (one dino,
 * which paddocks accept it). Neither is THE definition of eligibility: `paddockAccepts` is, and
 * both call it, so a change to the capacity rule or the diet rule cannot move only one of them.
 *
 * The occupancy count passed to `paddockAccepts` here excludes NOTHING, and that asymmetry is
 * deliberate. The dino-fixed direction mirrors assignDino's `ne(schema.dinos.id, dinoId)` and
 * drops the dino being MOVED from the count, or a paddock a dino already lives in would hide
 * itself the moment it filled. Here the dino has not been chosen yet and is by construction
 * unassigned, so every occupant counts against the room this menu is about to offer.
 *
 * Off-diet dinos are deliberately absent. The wrong-habitat "Assign anyway" confirm stays
 * reachable only from /dino assign, so a one-click follow-through can never halve a dino's
 * comfort in a single press.
 *
 * Three facts ride back, not one, because they send the player to three different screens and
 * quoting the wrong one is a false statement rather than a vague one — the same split feedDino
 * makes in src/modules/care/service.ts:
 *   - `hasRoom` answers the paddock question, so a caller never carries a capacity of its own;
 *   - `ofDiet` is the WHOLE cohort of that diet, housed and escaped included, so a caller can
 *     say "you own no herbivores yet" instead of telling a brand-new player that every
 *     herbivore they own is housed;
 *   - `dinos` is the offerable subset.
 * One roster read serves all three; do not add a second query to recover `ofDiet`.
 *
 * PADDOCKS is null-prototype and holds no facility kinds, so `PADDOCKS[lot.kind].diet` would
 * throw a TypeError on a facility row: the `type !== 'paddock'` return above it is load-bearing
 * ordering, not a tidy-up.
 */
export function assignableDinosFor(ctx: Ctx, userId: string, lotId: number):
    { lot: Lot; hasRoom: boolean; ofDiet: Array<typeof schema.dinos.$inferSelect>;
      dinos: Array<typeof schema.dinos.$inferSelect> } | null {
  const lot = ctx.db.select().from(schema.lots)
    .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, userId))).get();
  if (!lot || lot.type !== 'paddock') return null;
  const diet = PADDOCKS[lot.kind].diet;
  const owned = ctx.db.select().from(schema.dinos)
    .where(eq(schema.dinos.userId, userId)).all();
  const ofDiet = owned.filter((d) => getSpecies(d.speciesId).diet === diet);
  return {
    lot,
    hasRoom: paddockAccepts(lot, diet, owned.filter((d) => d.lotId === lot.id).length),
    ofDiet,
    dinos: ofDiet.filter((d) => d.lotId === null && d.escapedAt === null),
  };
}
```

- [ ] **Step 11: Run the test and watch it pass**

Run: `npx vitest run tests/build-assign.test.ts -t "assignableDinosFor"`

Expected: PASS.

- [ ] **Step 12: Break the free/unescaped filter, watch it fire, restore it**

Temporarily change

```typescript
    dinos: ofDiet.filter((d) => d.lotId === null && d.escapedAt === null),
```

to

```typescript
    dinos: ofDiet,
```

Run: `npx vitest run tests/build-assign.test.ts -t "offers only free, unescaped, diet-matching dinos"`

Expected: FAIL — `expected [ 1, 2, 4 ] to deeply equal [ 1 ]`. The menu would offer an escaped dino
(which `assignDino` refuses outright) and a dino already living somewhere else (which the shared
first-home rule refuses), so every option but one would be a dead click.

Restore the filter and re-run the same command; expected: PASS.

(The diet and capacity terms are not broken here: they live in `paddockAccepts`, and Task 11 (G5-A) Steps 6
and 8 already watch each of them fail. Step 13 below breaks the one term of that predicate this
function supplies for itself.)

- [ ] **Step 13: Break the `ofDiet` cohort, watch it fire, restore it**

Temporarily change

```typescript
  const ofDiet = owned.filter((d) => getSpecies(d.speciesId).diet === diet);
```

to

```typescript
  const ofDiet = owned;
```

Run: `npx vitest run tests/build-assign.test.ts -t "offers only free, unescaped, diet-matching dinos"`

Expected: FAIL — `expected [ 1, 2, 3, 4 ] to deeply equal [ 1, 2, 4 ]` on the `ofDiet` assertion, and
the `dinos` assertion goes red too (`expected [ 1, 3 ] to deeply equal [ 1 ]`) because the carnivore is
now offerable. Both halves of the split break together, which is the point: `ofDiet` is what tells
"you own none of this diet" from "none of yours is free".

Restore the filter and re-run the same command; expected: PASS.

- [ ] **Step 14: Write the failing routed tests for the `park:builddino` button**

Append to `tests/build-assign.test.ts`. Every case dispatches through the real `routeInteraction`
against `testRegistry` (built from the real `ALL_MODULES`) — calling `parkModule.components[0].execute`
directly would prove nothing about routing, which is exactly how the `/admin ledger` pager nearly
shipped dead:

```typescript
describe('park:builddino — the assign menu', () => {
  // lotSeg is deliberately `number | string` so one case can send a MALFORMED segment
  // through the same real router path the well-formed ones take.
  const click = async (lotSeg: number | string, user: string) => {
    const customId = `park:builddino:u1:${lotSeg}`;
    // componentIds is STATED, never left to the harness default it happens to equal: these
    // cases must exercise the passing side of the router guard against a real button set.
    const b = fakeButton({ customId, user, componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return b;
  };

  it('routes through the real registry and opens a private menu of the free matching dinos', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const a = addDino('triceratops');
    const c = addDino('triceratops');
    addDino('velociraptor');                              // wrong diet
    addDino('triceratops', { escapedAt: 1 });             // escaped
    const b = await click(lot.id, 'u1');
    expect(b.deferOpts).toHaveLength(0);      // dispatched, not swallowed by the default arm
    expect(b.replies).toHaveLength(1);
    expect(idsOf(b.replies[0])).toContain(`park:builddinosel:u1:${lot.id}`);
    // The whole option list: this is the filtered roster, not a components array, and it is
    // the only assertion that proves the three filters ran.
    expect(optionsOf(b.replies[0])).toEqual([String(a.id), String(c.id)]);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('refuses a bystander clicking the public build reply', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    addDino('triceratops');
    const b = await click(lot.id, 'u2');
    expect(replyText(b.replies[0])).toBe('Not your park.');
    expect(hasIdStarting(b.replies[0], 'park:builddinosel')).toBe(false);
  });

  it('names the real cause when the player owns no dino of that diet at all', async () => {
    // The operator's own first-run case: build a paddock, click Assign, own nothing that
    // eats there. "Every one you own is housed or escaped" would be a FALSE statement here
    // and /dino unassign cannot help — the same two-causes-two-messages split feedDino makes.
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    addDino('velociraptor');                              // carnivore only
    const b = await click(lot.id, 'u1');
    expect(replyText(b.replies[0]))
      .toBe('You own no herbivore dinos yet — hatch one from `/eggs`.');
    expect(hasIdStarting(b.replies[0], 'park:builddinosel')).toBe(false);
  });

  it('names the OTHER cause when every dino of that diet is housed or escaped', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const other = buildLot(ctx, 'u1', 'herbivore_paddock');
    assignDino(ctx, 'u1', addDino('triceratops').id, other.id);   // housed elsewhere
    addDino('triceratops', { escapedAt: 1 });                     // escaped
    addDino('velociraptor');                                      // carnivore — wrong diet
    const b = await click(lot.id, 'u1');
    expect(replyText(b.replies[0])).toBe(
      'No free herbivore dinos — every herbivore you own is housed or escaped.'
      + ' Free one with `/dino unassign`, or hatch another from `/eggs`.');
    expect(hasIdStarting(b.replies[0], 'park:builddinosel')).toBe(false);
  });

  it('says the paddock is full rather than offering a menu that cannot be used', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');         // capacity 2
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    addDino('triceratops');                                       // free, but nowhere to put it
    const b = await click(lot.id, 'u1');
    // PADDOCK_FULL — the same sentence assignDino throws and the same one park:assign
    // surfaces, so a player who fills a paddock between mint and click reads one
    // explanation whichever control they pressed.
    expect(replyText(b.replies[0])).toBe('That paddock is full.');
    expect(hasIdStarting(b.replies[0], 'park:builddinosel')).toBe(false);
  });

  it('refuses once the lot is gone rather than crashing on a missing paddock def', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    addDino('triceratops');
    ctx.db.delete(schema.lots).run();                             // what adminReset does
    const b = await click(lot.id, 'u1');
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
  });

  it('answers a malformed lot segment as a lot that changed, and never crashes', async () => {
    // An id from an older deploy, or a forged one. Number('abc') is NaN, better-sqlite3 binds
    // NaN as a legal no-match, and the lot read therefore lands on its not-found arm — the
    // same behaviour assignRefusal relies on, and the reason this handler grows no parse
    // branch of its own. Pinned so "no integer guard" stays a decision rather than a gap.
    buildLot(ctx, 'u1', 'herbivore_paddock');
    addDino('triceratops');
    const b = await click('abc', 'u1');
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
  });
});
```

- [ ] **Step 15: Run the tests and watch them fail**

Run: `npx vitest run tests/build-assign.test.ts -t "park:builddino"`

Expected: FAIL, every case. The `park` prefix resolves, so each click reaches the component switch's
`default:` arm, which `deferUpdate()`s and replies nothing. The first case fails on
`expected [ { kind: 'update' } ] to have a length of 0 but got 1`; the six sentence cases fail on
`replyText(undefined)`, which returns `''` — e.g. `expected '' to be 'Not your park.'`.

- [ ] **Step 16: Add `case 'builddino'` to the `park` component switch**

Two import edits first, in `src/modules/park/index.ts`:

- line 1 — add the two select builders to the discord.js value import:

```typescript
import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
```

- the `./dinos.js` import line — add `assignableDinosFor` and `PADDOCK_FULL` (Task 11 (G5-A) exported both;
  Task 13 (G5-C) already added `eligiblePaddocks` to this line, so run
  `grep -n "from './dinos.js'" src/modules/park/index.ts` and add only what is missing):

```typescript
import { assignDino, unassignDino, decorateLot, listDinos, paddockCapacity, eligiblePaddocks, assignableDinosFor, PADDOCK_FULL, AssignError, DietMismatchError, renameDino } from './dinos.js';
```

Then insert this case immediately **before** the line `          case 'buildno':`:

```typescript
          case 'builddino': {
            // park:builddino:<uid>:<lotId> — minted on the PUBLIC /build reply and on the
            // ephemeral follow-up park:buildyes sends. routeInteraction dispatches on the
            // PREFIX alone, so both segments have to be here and both are re-read: the lot id
            // rides in the id rather than only in the label because a Discord message is
            // durable and its label is never re-derived.
            //
            // This owner check is a MESSAGE-QUALITY layer, not the write barrier, and must
            // not be described as one: assignableDinosFor scopes every read to the CALLER, so
            // a bystander is already refused one line down. What it buys is that they are
            // told whose park it is instead of being told a lot they can see has changed.
            if (i.user.id !== uid) { await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral }); return; }
            settleEscapes(ctx, i.user.id);
            // NO integer guard on the lot segment, for the reason assignRefusal states above:
            // Number('nonsense') is NaN, better-sqlite3 binds NaN as a legal no-match, so the
            // read below lands on its not-found arm and answers STALE_ASSIGN already. A parse
            // branch would be a guard no test could tell apart from that one.
            const pick = assignableDinosFor(ctx, i.user.id, Number(parts[3]));
            if (!pick) { await i.reply({ content: STALE_ASSIGN, flags: MessageFlags.Ephemeral }); return; }
            // Three refusals, three sentences, and none of them may fall through to the menu:
            // Discord REJECTS a select carrying zero options, so an empty candidate list is an
            // error payload, not an empty dropdown.
            if (!pick.hasRoom) { await i.reply({ content: PADDOCK_FULL, flags: MessageFlags.Ephemeral }); return; }
            if (pick.dinos.length === 0) {
              const diet = PADDOCKS[pick.lot.kind].diet;
              // Two causes, two messages — the split feedDino already makes in
              // src/modules/care/service.ts. "Every one you own is housed or escaped" is FALSE
              // for a player who owns none of this diet, and /dino unassign cannot help them;
              // that is the case a brand-new player's first paddock produces.
              await i.reply({
                content: pick.ofDiet.length === 0
                  ? `You own no ${diet} dinos yet — hatch one from \`/eggs\`.`
                  : `No free ${diet} dinos — every ${diet} you own is housed or escaped.`
                    + ' Free one with `/dino unassign`, or hatch another from `/eggs`.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            const pickNow = ctx.now();
            await i.reply({
              content: `Which dino moves into **${pick.lot.name}** (lot #${pick.lot.id})?`,
              components: [buildDinoSelectRow(i.user.id, pick.lot.id, pick.dinos.map((d) => ({
                id: d.id, label: dinoLabel(d, getSpecies(d.speciesId), pickNow),
              })))],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
```

- [ ] **Step 17: Run the tests and watch them pass**

Run: `npx vitest run tests/build-assign.test.ts -t "park:builddino"`

Expected: PASS.

- [ ] **Step 18: Break the owner check, watch it fire, restore it**

Temporarily change the owner check to

```typescript
            if (false) { await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral }); return; }
```

Run: `npx vitest run tests/build-assign.test.ts -t "refuses a bystander clicking the public build reply"`

Expected: FAIL — `expected 'That lot changed — open \`/park view\` again.' to be 'Not your park.'`.
Read that result correctly: **no roster leaks either way.** `assignableDinosFor` resolves the lot
against the clicker, so u2 gets no menu with or without this check; what the check buys is a sentence
that describes what actually happened instead of one about a lot that never changed.

Restore the check and re-run the same command; expected: PASS.

- [ ] **Step 19: Break the lot-gone guard, watch it fire, restore it**

Temporarily change

```typescript
            if (!pick) { await i.reply({ content: STALE_ASSIGN, flags: MessageFlags.Ephemeral }); return; }
```

to

```typescript
            if (false) { await i.reply({ content: STALE_ASSIGN, flags: MessageFlags.Ephemeral }); return; }
```

Run: `npx vitest run tests/build-assign.test.ts -t "refuses once the lot is gone"`

Expected: FAIL — reading `pick.hasRoom` on `null` throws
`TypeError: Cannot read properties of null (reading 'hasRoom')`, routeInteraction's outer catch turns
it into the generic reply, and the assertion reports
`expected 'Something went wrong — nothing was charged. Try again.' to be 'That lot changed — open \`/park view\` again.'`
The malformed-segment case goes red the same way, which is the same defect seen from the other side.

Restore the guard and re-run the same command; expected: PASS.

- [ ] **Step 20: Break the full-paddock guard, watch it fire, restore it**

This is the arm that most looks like a guard that cannot fail — the pick itself would end at
`That paddock is full.` anyway, because `assignDino` throws `PADDOCK_FULL` one layer down. It is
observable because removing it does not change a sentence, it opens a **menu**: the player is offered
a chooser that cannot succeed. Temporarily change

```typescript
            if (!pick.hasRoom) { await i.reply({ content: PADDOCK_FULL, flags: MessageFlags.Ephemeral }); return; }
```

to

```typescript
            if (false) { await i.reply({ content: PADDOCK_FULL, flags: MessageFlags.Ephemeral }); return; }
```

Run: `npx vitest run tests/build-assign.test.ts -t "says the paddock is full"`

Expected: FAIL — `expected 'Which dino moves into **Herbivore Paddock** (lot #1)?' to be 'That paddock is full.'`,
because the free third Triceratops is still a candidate and the menu is minted against a paddock with
nowhere to put it.

Restore the guard and re-run the same command; expected: PASS.

- [ ] **Step 21: Break the empty-candidate guard, watch it fire, restore it**

Temporarily change

```typescript
            if (pick.dinos.length === 0) {
```

to

```typescript
            if (false) {
```

Run: `npx vitest run tests/build-assign.test.ts -t "names the OTHER cause when every dino of that diet is housed or escaped"`

Expected: FAIL — the zero-option menu is refused before it can be sent (`tests/lib/discord-limits.ts`
rejects it with `options empty`), routeInteraction's outer catch swallows the throw, and the assertion
reports
`expected 'Something went wrong — nothing was charged. Try again.' to be 'No free herbivore dinos — …'`.
That generic sentence is exactly what a real player would get, because Discord rejects the same
payload.

Restore the condition and re-run the same command; expected: PASS.

- [ ] **Step 22: Break the two-causes split, watch it fire, restore it**

The condition inside that arm is a second, separate guard: it is what stops the bot telling a player
who owns nothing that everything they own is housed. Temporarily change

```typescript
                content: pick.ofDiet.length === 0
```

to

```typescript
                content: false
```

Run: `npx vitest run tests/build-assign.test.ts -t "names the real cause when the player owns no dino of that diet at all"`

Expected: FAIL —
`expected 'No free herbivore dinos — every herbivore you own is housed or escaped. Free one with \`/dino unassign\`, or hatch another from \`/eggs\`.' to be 'You own no herbivore dinos yet — hatch one from \`/eggs\`.'`
That is the false statement, sent to the player, pointing them at a command that cannot help them.

Restore `pick.ofDiet.length === 0` and re-run the same command; expected: PASS.

- [ ] **Step 23: Write the failing routed tests for the `park:builddinosel` select**

Append to `tests/build-assign.test.ts`:

```typescript
describe('park:builddinosel — the pick', () => {
  const pickDino = async (lotId: number, dinoId: number, user: string) => {
    const customId = `park:builddinosel:u1:${lotId}`;
    const s = fakeSelect({
      customId, user, values: [String(dinoId)], options: [String(dinoId)], componentIds: [customId],
    });
    await routeInteraction(ctx, testRegistry, s.asInteraction());
    return s;
  };

  it('routes the pick through the registry and reads the LOT from the id, the DINO from the value', async () => {
    // Two lots on purpose, so the paddock is #2 while the dino is #1. This mirror of
    // park:assignsel carries the two the other way round, and with both ids equal to 1 a
    // swapped pair would assign correctly by coincidence and prove nothing.
    buildLot(ctx, 'u1', 'carnivore_paddock');
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = addDino('triceratops');
    const s = await pickDino(lot.id, d.id, 'u1');
    expect(s.deferOpts).toHaveLength(0);
    expect(replyText(s.replies[0])).toBe(`🦕 Assigned to lot #${lot.id}.`);
    expect((s.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(dinoOf(d.id).lotId).toBe(lot.id);
  });

  it('says the paddock is full when it filled up between the mint and the pick', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');         // capacity 2
    const d = addDino('triceratops');
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    const s = await pickDino(lot.id, d.id, 'u1');
    expect(replyText(s.replies[0])).toBe('That paddock is full.');
    expect(dinoOf(d.id).lotId).toBeNull();
  });

  it('refuses a dino that found a home between the mint and the pick', async () => {
    // The shared first-home rule, reached through this menu: the chooser is an ephemeral that
    // survives a /dino assign run beside it, and this is the arm that stops a stale pick
    // dragging a dino back out of the paddock the player last chose.
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const other = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = addDino('triceratops');
    assignDino(ctx, 'u1', d.id, other.id);
    const s = await pickDino(lot.id, d.id, 'u1');
    expect(replyText(s.replies[0])).toBe(`Already assigned to lot #${other.id}.`);
    expect(dinoOf(d.id).lotId).toBe(other.id);
  });

  it('refuses a bystander submitting against somebody else\'s menu', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = addDino('triceratops');
    const s = await pickDino(lot.id, d.id, 'u2');
    expect(replyText(s.replies[0])).toBe('Not your park.');
    expect(dinoOf(d.id).lotId).toBeNull();
  });
});
```

- [ ] **Step 24: Run the tests and watch them fail**

Run: `npx vitest run tests/build-assign.test.ts -t "park:builddinosel"`

Expected: FAIL on the first three cases. `builddinosel` matches no branch, so the select handler falls
through to the trailing `await i.deferUpdate()`: the first fails on
`expected [ { kind: 'update' } ] to have a length of 0 but got 1`, and the next two on
`replyText(undefined)` returning `''` — e.g. `expected '' to be 'That paddock is full.'`.

The bystander case **already passes**, because the park select handler's shared owner check runs before
any action branch. Say so rather than counting it as evidence; Step 26 is what turns it into evidence.

- [ ] **Step 25: Add the `builddinosel` branch to the `park` select handler**

Insert immediately before the `await i.deferUpdate();` that closes the park select handler — the one
directly followed by `      },` then `    },` then `  ],` then `  components: [`. Task 14 (G5-D)'s
`assignsel` branch already sits above that same line; order between the two does not matter:

```typescript
        if (action === 'builddinosel') {
          // The MIRROR of assignsel directly above: there the dino is fixed in the id and a
          // value is a lot; here the LOT is fixed in the id and a value is a DINO. Swapping
          // the two arguments below compiles cleanly and silently assigns the wrong pair, so
          // read them once more before you move on.
          //
          // Re-split rather than widening the shared destructure at the top of this handler:
          // the lot id sits at index 3, where the build and upgrade menus carry nothing, and
          // every other branch here is untouched by this addition.
          //
          // No integer guard, and no second copy of the validation: assignFollowThrough owns
          // the first-home rule, the lot-identity check and the write, exactly as it does for
          // park:assign and park:assignsel — one write path, so the button and both menus
          // cannot validate differently. It replies ephemerally rather than updating: this
          // chooser is already an ephemeral of its own, and the shared path must stay safe for
          // the button, which can sit on a public message.
          await assignFollowThrough(ctx, i, Number(value), Number(i.customId.split(':')[3]));
          return;
        }
```

- [ ] **Step 26: Run the tests and watch them pass**

Run: `npx vitest run tests/build-assign.test.ts -t "park:builddinosel"`

Expected: PASS.

- [ ] **Step 27: Break the argument order, watch it fire, restore it**

Temporarily swap the two arguments:

```typescript
          await assignFollowThrough(ctx, i, Number(i.customId.split(':')[3]), Number(value));
```

Run: `npx vitest run tests/build-assign.test.ts -t "reads the LOT from the id, the DINO from the value"`

Expected: FAIL — `expected 'That assign button is invalid — use \`/dino assign\`.' to be '🦕 Assigned to lot #2.'`.
The call now names dino #2, which does not exist, and lot #1, which is the carnivore paddock. With the
two ids equal this step would report PASS against broken code, which is why the fixture builds a
throwaway first lot.

Restore the original argument order and re-run the same command; expected: PASS.

- [ ] **Step 28: Break the shared write path, watch it fire, restore it**

The whole point of routing the pick through `assignFollowThrough` is that the paddock is re-checked at
click time. Temporarily replace that call with a write that trusts the menu instead:

```typescript
          ctx.db.update(schema.dinos).set({ lotId: Number(i.customId.split(':')[3]) })
            .where(eq(schema.dinos.id, Number(value))).run();
          await i.reply({ content: '🦕 Assigned.', flags: MessageFlags.Ephemeral });
```

Run: `npx vitest run tests/build-assign.test.ts -t "says the paddock is full when it filled up between the mint and the pick"`

Expected: FAIL — `expected '🦕 Assigned.' to be 'That paddock is full.'`, and the second assertion then
shows the dino crammed into a paddock already at capacity (`expected 1 to be null`).

Restore the `assignFollowThrough` call and re-run the same command; expected: PASS.

- [ ] **Step 29: Write the failing test for the `park:buildyes` confirm path**

`/park view`'s Lots tab pushes players at the **Build…** dropdown, whose confirm is `park:buildyes`.
That path builds the same paddock and, as it stands, offers no follow-through at all. Append to
`tests/build-assign.test.ts`:

```typescript
describe('park:buildyes also mints the assign control', () => {
  // The trailing :0 is the lot-count anchor the handler validates against a fresh read before
  // it builds — the player owns no lots, so the id is not stale.
  const confirm = async (kind: string) => {
    const customId = `park:buildyes:u1:${kind}:0`;
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return b;
  };

  it('follows the Lots tab render with a private Assign control for the new paddock', async () => {
    const b = await confirm('herbivore_paddock');
    // Two payloads: renderTab's i.update of the Lots tab, then the ephemeral follow-up. The
    // control cannot ride on the tab itself — renderTab owns that whole payload and sends it.
    expect(b.replies).toHaveLength(2);
    expect(idsOf(b.replies[1])).toContain('park:builddino:u1:1');
    expect((b.replies[1] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('mints no assign control when the confirm built a facility', async () => {
    const b = await confirm('visitor_center');
    expect(b.replies).toHaveLength(1);
  });
});
```

- [ ] **Step 30: Run the tests and watch them fail**

Run: `npx vitest run tests/build-assign.test.ts -t "park:buildyes also mints"`

Expected: FAIL on `follows the Lots tab render with a private Assign control` —
`expected [ { … } ] to have a length of 2 but got 1`: the confirm renders the Lots tab and stops there.
The facility case already passes and is not evidence until Step 32 breaks the guard.

- [ ] **Step 31: Mint the follow-up on the `park:buildyes` success path**

In `src/modules/park/index.ts`, replace this line inside `case 'buildyes'`'s `try`:

```typescript
              const lot = buildLot(ctx, i.user.id, kind);
              await renderTab(ctx, i, i.user.id, 'lots', false, `🏗️ Built **${lot.name}** (lot #${lot.id}).`);
```

with:

```typescript
              const lot = buildLot(ctx, i.user.id, kind);
              await renderTab(ctx, i, i.user.id, 'lots', false, `🏗️ Built **${lot.name}** (lot #${lot.id}).`);
              // The Lots tab's Build… dropdown is the path /park view actively pushes players
              // toward, so this confirm owes the same follow-through the /build slash reply
              // mints. It cannot ride on the tab: renderTab builds AND sends that whole
              // payload, so the control arrives as an ephemeral follow-up beside it —
              // legal here precisely because renderTab's 'lots' branch has already replied.
              //
              // No module gate: park mints this and park handles it. Only a CROSS-module mint
              // has to check ctx.config.modules, because ModuleRegistry searches enabled
              // modules only.
              if (lot.type === 'paddock') {
                await i.followUp({
                  content: `**${lot.name}** (lot #${lot.id}) is empty — put a dino in it.`,
                  components: [buildDinoRow(i.user.id, lot.id)],
                  flags: MessageFlags.Ephemeral,
                });
              }
```

- [ ] **Step 32: Run the tests and watch them pass, then break the paddock condition**

Run: `npx vitest run tests/build-assign.test.ts -t "park:buildyes also mints"`

Expected: PASS.

Then temporarily change `if (lot.type === 'paddock') {` to `if (true) {` and re-run the same command.

Expected: FAIL on `mints no assign control when the confirm built a facility` —
`expected [ { … }, { … } ] to have a length of 1 but got 2`. The Visitor Center now gets an Assign
button whose menu can only answer `That lot changed — open /park view again.`

Restore `lot.type === 'paddock'` and re-run the same command; expected: PASS.

- [ ] **Step 33: Run the gates**

Run: `npm run typecheck`

Expected: exit 0, no output. `npm run build` typechecks only `src`, so this is the only gate that sees
`tests/build-assign.test.ts`.

Then, as a separate command: `npm test`

Expected: PASS, whole suite. (Two commands, never `A && B`: under this repo's primary shell, Windows
PowerShell 5.1, `&&` is a parser error.)

- [ ] **Step 34: Commit**

```bash
git add src/modules/park/dinos.ts src/modules/park/embeds.ts src/modules/park/index.ts tests/build-assign.test.ts tests/park.test.ts
git commit -m "feat(park): offer an assign menu on every newly built paddock"
```

---

---

### Task 17: the `hatch:crack` reveal mints the assign control, and loses its typed-command footer

_Stable id: `G5-F`_

**Files:**
- Modify: `src/modules/hatchery/index.ts` — add two imports; widen the `hatchEgg` destructure; push the row and set the footer before `await i.update(payload);`. **Task 9 (G4-B) has already edited this file (the `inc` arm, both unknown-action `deferUpdate`s), so every anchor below is quoted text, never a line number.**
- Modify: `src/modules/hatchery/embeds.ts` — delete the `embed.setFooter({ … })` line inside `revealPayload`. (Task 9 (G4-B) added `incubateRow` to this file; the two edits do not overlap.)
- Modify: `tests/hatchery.test.ts` — retarget the case `it('reveal embed points at /dino assign', …)`
- Test: `tests/follow-through-assign.test.ts` (append)

**Interfaces:**
- Consumes: `assignRow(userId, dinoId, eligible)` (Task 12 (G5-B)), `eligiblePaddocks(ctx, userId, dinoId)` (Task 11 (G5-A)), and the `park:assign` / `park:assignpick` / `park:goto:lots` handlers (Tasks G5-C, G5-D, G5-E) — every id this task can mint must already route before it lands. `hatchEgg(ctx, userId, eggId)` already returns `{ species: Species; dinoId: number; traits: string[] }` (`src/modules/hatchery/service.ts`); the handler currently destructures only two of the three. `ctx.config.modules` is `Record<string, boolean>` (`src/core/config.ts`), reached through `Ctx.config` (`src/core/context.ts`).
- Produces: no new exported symbols. The `hatch:crack` reveal now carries one extra `ActionRowBuilder<ButtonBuilder>` (pushed, never assigned) and sets its own footer; `revealPayload` sets none.

**Scope notes.**
1. Spec §3.3's two bare-return fixes are **not** this task's work: `if (action !== 'crack')` and
   `if (action !== 'confirm')` were both converted by **Task 9 (G4-B)**. Steps 2 and 8 below verify
   that rather than re-doing it, and this task adds no "unrecognised action" test — Task 9 (G4-B)
   owns the only copy.
2. The mint is **cross-module** — hatchery minting `park:` ids — so it is gated on
   `ctx.config.modules.park`. `ModuleRegistry` searches only ENABLED modules
   (`src/core/modules.ts`), so a `park:` id minted while park is off is a button that answers
   nothing.

- [ ] **Step 1: Append the failing cases**

Add one import to `tests/follow-through-assign.test.ts`:

```typescript
import { incubateEgg } from '../src/modules/hatchery/service.js';
```

Then append:

```typescript
describe('the hatch reveal mints the assign follow-through', () => {
  // speciesId is pinned so the hatch is deterministic: `triceratops` is a common herbivore,
  // which is what makes the default herbivore paddock the matching one. common's
  // incubationMs is 15 minutes (src/data/rarity.ts), so an hour is comfortably past it.
  const readyEgg = () => {
    const egg = ctx.db.insert(schema.eggs).values({
      userId: 'u1', rarity: 'common', speciesId: 'triceratops', source: 'shop', obtainedAt: 0,
    }).returning().get();
    incubateEgg(ctx, 'u1', egg.id, null);
    ctx.setNow(ctx.now() + 3_600_000);
    return egg;
  };
  const hatchedDinoId = () =>
    ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'u1')).all().at(-1)!.id;
  const footerOf = (reply: unknown) =>
    (reply as { embeds: Array<{ toJSON(): { footer?: { text: string } } }> }).embeds[0].toJSON().footer;

  it('offers Assign to the single eligible paddock, and drops the typed-command footer', async () => {
    seedUser();
    const lot = seedLot();
    const egg = readyEgg();
    const b = fakeButton({ customId: `hatch:crack:${egg.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(JSON.stringify(b.replies[0])).toContain(`park:assign:u1:${hatchedDinoId()}:${lot.id}`);
    // A button that does the thing, next to a sentence telling the player to type the
    // command that does the thing, is the exact failure this whole change removes.
    expect(footerOf(b.replies[0])).toBeUndefined();
  });

  it('offers the picker when several paddocks are eligible', async () => {
    seedUser();
    seedLot(); seedLot();
    const egg = readyEgg();
    const b = fakeButton({ customId: `hatch:crack:${egg.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(JSON.stringify(b.replies[0])).toContain(`park:assignpick:u1:${hatchedDinoId()}`);
    expect(footerOf(b.replies[0])).toBeUndefined();
  });

  it('offers Build a paddock, and keeps the pointer, when there is nowhere to put it', async () => {
    seedUser();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });
    const egg = readyEgg();
    const b = fakeButton({ customId: `hatch:crack:${egg.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const json = JSON.stringify(b.replies[0]);
    expect(json).toContain('park:goto:lots:u1');
    expect(json).not.toContain('park:assign');
    // The one shape where /dino assign is still the next step the player takes, because the
    // control on the card only gets them as far as owning a paddock.
    expect(footerOf(b.replies[0])!.text)
      .toBe('Build a paddock, then /dino assign — unassigned dinos earn nothing.');
  });

  it('mints no park control at all when the park module is disabled', async () => {
    // A DEFAULT ctx — makeCtx leaves `modules` empty, which is what a park-less deployment
    // looks like to this handler. ModuleRegistry resolves a component only among enabled
    // modules, so an ungated mint here would put a dead button on a public card.
    ctx = makeCtx();
    seedUser();
    seedLot();
    const egg = readyEgg();
    const b = fakeButton({ customId: `hatch:crack:${egg.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect((b.replies[0] as { components: unknown[] }).components).toHaveLength(0);
    expect(footerOf(b.replies[0])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verify Task 9 (G4-B)'s §3.3 conversions are already in place**

Run:

```bash
grep -n "if (action !== 'crack')" src/modules/hatchery/index.ts
grep -n "if (action !== 'confirm')" src/modules/hatchery/index.ts
```

Expected: both lines already read `{ await i.deferUpdate(); return; }`, not a bare `return;`.
If either is still a bare return, **stop** — Task 9 (G4-B) has not landed and this task is out of
order. Do not convert them here and do not add a red step for them: Task 9 (G4-B) owns both lines
and the only copy of their tests.

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-assign.test.ts -t "hatch reveal"`

Expected: FAIL on the first case at `expected '…' to contain 'park:assign:u1:1:1'` —
`revealPayload` ships `components: []` and nothing pushes onto it. The `footer` assertions
fail too, on the opposite side: `revealPayload` still sets
`'Next: /dino assign — unassigned dinos earn nothing.'` unconditionally, so
`expect(footerOf(...)).toBeUndefined()` gets an object.

- [ ] **Step 4: Take the footer out of `revealPayload`**

In `src/modules/hatchery/embeds.ts`, delete this line from `revealPayload`:

```typescript
  embed.setFooter({ text: 'Next: /dino assign — unassigned dinos earn nothing.' });
```

and put this comment in its place:

```typescript
  // No footer here, deliberately. What the reveal should say next depends on which of the
  // three assign shapes was minted onto the same card, and this builder is pure — it never
  // sees ctx, the dino, or the player's paddocks. The hatch:crack handler sets it.
```

- [ ] **Step 5: Add the two imports to `src/modules/hatchery/index.ts`**

Append after the last existing import line:

```typescript
import { eligiblePaddocks } from '../park/dinos.js';
import { assignRow } from '../park/embeds.js';
```

- [ ] **Step 6: Mint the row and decide the footer**

In the `hatch` component handler, replace this run of lines:

```typescript
          const { species, traits } = hatchEgg(ctx, i.user.id, Number(idStr));
          const payload = revealPayload(species, Number(idStr));
          // Traits field appended after revealPayload's Diet/Biome/Income/hr fields —
          // added here rather than inside revealPayload so the two attach() calls
          // there (crack image, archetype thumbnail) stay untouched.
          payload.embeds[0].addFields({ name: '🧬 Traits', value: traitLines(traits), inline: false });
          await i.update(payload);
```

with:

```typescript
          const { species, dinoId, traits } = hatchEgg(ctx, i.user.id, Number(idStr));
          const payload = revealPayload(species, Number(idStr));
          // Traits field appended after revealPayload's Diet/Biome/Income/hr fields —
          // added here rather than inside revealPayload so the two attach() calls
          // there (crack image, archetype thumbnail) stay untouched.
          payload.embeds[0].addFields({ name: '🧬 Traits', value: traitLines(traits), inline: false });
          // CROSS-MODULE mint, so it is gated on park being enabled: ModuleRegistry resolves
          // a component's handler only among ENABLED modules (src/core/modules.ts), and a
          // park: id minted while park is off is a button that silently answers nothing. The
          // gate belongs at the MINT — the handler lives in the module that may be absent, so
          // it cannot possibly refuse on its own behalf.
          if (ctx.config.modules.park) {
            const eligible = eligiblePaddocks(ctx, i.user.id, dinoId);
            // PUSHED, never assigned: revealPayload's empty components array is what this
            // i.update uses to strip the crack button, and an assignment would work by
            // accident today and break the moment revealPayload mints a row of its own.
            payload.components.push(assignRow(i.user.id, dinoId, eligible));
            // The footer is decided HERE, beside the control, because it is a function of
            // which of assignRow's three shapes was just minted — something revealPayload
            // cannot see. With an Assign control on the card, "Next: /dino assign" was the
            // exact instruction this change exists to replace, so it goes. With only "Build a
            // paddock", the pointer is still the step AFTER building, so it stays.
            if (eligible.length === 0) {
              payload.embeds[0].setFooter({
                text: 'Build a paddock, then /dino assign — unassigned dinos earn nothing.',
              });
            }
          }
          await i.update(payload);
```

- [ ] **Step 7: Retarget the existing footer assertion in `tests/hatchery.test.ts`**

First confirm nothing else pins the old sentence:

```bash
grep -rn "unassigned dinos earn nothing" tests/
grep -rn "dino assign" tests/hatchery.test.ts tests/dino-image.test.ts
```

The only hit is the case below (`src/modules/help/index.ts` carries a similar sentence in the
first-ten-minutes walkthrough — a different surface, out of scope). Replace this case:

```typescript
  it('reveal embed points at /dino assign', () => {
    const p = revealPayload(getSpecies('velociraptor'), 7);
    expect(p.embeds[0].toJSON().footer?.text).toContain('/dino assign');
  });
```

with:

```typescript
  it('revealPayload leaves the footer to its caller', () => {
    // This used to assert the footer read 'Next: /dino assign — unassigned dinos earn
    // nothing.' That decision moved to the hatch:crack handler, which is the only place that
    // knows whether an Assign control was minted onto the same card. The surviving pointer —
    // the no-eligible-paddock shape — is asserted whole in tests/follow-through-assign.test.ts.
    const p = revealPayload(getSpecies('velociraptor'), 7);
    expect(p.embeds[0].toJSON().footer).toBeUndefined();
  });
```

- [ ] **Step 8: Run both files and watch them pass**

Run: `npx vitest run tests/follow-through-assign.test.ts tests/hatchery.test.ts`

Expected: PASS.

- [ ] **Step 9: Break the module gate and watch that assertion fail**

Temporarily change `if (ctx.config.modules.park) {` to `if (true) {`.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "park module is disabled"`

Expected: FAIL with `expected [ … ] to have a length of 0 but got 1` — a `park:assign` button
is minted onto a public card in a deployment where no handler will ever answer it.
**Restore the gate and re-run.**

- [ ] **Step 10: Break the footer rule and watch that assertion fail**

Temporarily change `if (eligible.length === 0) {` to `if (true) {`.

Run: `npx vitest run tests/follow-through-assign.test.ts -t "hatch reveal"`

Expected: FAIL on `offers Assign to the single eligible paddock, and drops the typed-command
footer` with `expected { text: 'Build a paddock, then /dino assign — unassigned dinos earn nothing.' } to be undefined`,
and on the several-paddocks case for the same reason — the card once again tells the player to
type a command while carrying the button that does it. **Restore the condition and re-run.**

- [ ] **Step 11: Run the whole suite and the typecheck gate**

Run: `npm test`

Then run: `npm run typecheck`

Expected: PASS both, as two separate commands — `npm run build` is `tsc` against
`tsconfig.json`, which includes only `src`, so it never typechecks the new test file;
`npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) is the gate that does. Run them
separately rather than chained: PowerShell 5.1 parses `&&` as an error, and a chain would hide
which gate failed.

- [ ] **Step 12: Commit**

```bash
git add src/modules/hatchery/index.ts src/modules/hatchery/embeds.ts tests/hatchery.test.ts tests/follow-through-assign.test.ts
git commit -m "feat(hatchery): offer the assign follow-through on the hatch reveal"
```

---

### Task 18: `/rescue` offers a one-click feed, and care gains its first component

_Stable id: `G6-B`_

A rescued dino comes back at roughly half comfort and drains from there, so feeding is the next move.
This task puts a **🍖 Feed it** button on the `/rescue` reply.

**It is one click, with no confirm — but only once it is idempotent.** `/park view`'s
`park:feedall:<uid>` button has consumed food on a single click since it shipped
(`src/modules/park/embeds.ts`, label `🍖 Feed all`, style `Success`), and that is safe because `feedAll`
filters its candidates with `.filter((c) => !c.escaped && c.hunger < 100)` — a second click spends
nothing and answers "Nothing needed feeding." **`feedDino` has no such filter**: it re-feeds a dino
already at `fillTo` for the full cost, and its `wasHungry` local gates only the `dinos_fed` stat, never
the spend. So a bare `feedDino` behind a one-click button charges twice for two clicks landing before
the first repaint — a public, durable button with no anchor, the exact shape
§money-button-carries-its-rung exists for. Step 7 therefore reproduces the same already-full filter
`feedAll` has, and only with that filter in place is "the same as Feed all" a true statement. Do not
later add a confirm to this button alone, and do not delete that filter.

`src/modules/care/index.ts` declares `components: []` — the care module registers **no** component
prefix today (`grep -n "prefix:" src/modules/care/index.ts` returns nothing). This is its first, so it
needs a `ComponentDef` on the manifest, a prefix that collides with nothing (a duplicate throws at
`ModuleRegistry` construction, i.e. at boot), and its own routed test. Derive the currently-claimed
prefixes with `grep -rn "prefix: '" src/modules/` before picking one.

**No `ctx.config.modules` gate.** `care:feed` is minted by care and handled by care. Only a
CROSS-module mint needs the gate the four Incubate minters and the hatch reveal carry, because
`ModuleRegistry` searches enabled modules only; a same-module mint is dead exactly when the surface
that minted it is dead.

**`docs/commands.md` is NOT edited here.** Task 31 (G8-C) is the sole writer of that file and owns the
`/rescue` row.

**Files:**
- Modify: `src/modules/care/index.ts` — four edits, all anchored on quoted text, because Task 4 (G1-D)
  rewrote both `catch` blocks in this same file first:
  - line 1's discord.js import (add `ActionRowBuilder`, `ButtonBuilder`, `ButtonStyle`)
  - `rescuePayload`, replaced whole
  - the two lines of the `/rescue` success path inside its `try`
  - `  components: [],` on the manifest → the new `ComponentDef`
- Test: `tests/care-feed-button.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 1 (G1-A) — `shortfallLine(e: InsufficientFundsError): string` and `InsufficientFundsError` with
    required `wallet`, `needed`, `held` and optional `foodId`, both from `src/core/economy.js`.
  - Task 4 (G1-D) — the rewritten `/rescue` catch
    (`Not enough cash — that recapture ${shortfallLine(e)}.`), the rewritten `/feed` catch whose
    wording this task's own catch matches exactly, and the
    `import { InsufficientFundsError, shortfallLine } from '../../core/economy.js';` line it produced.
    That task lands first; this one edits around both blocks without touching them.
  - Task 9 (G4-B) — `tests/harness.ts`'s `export type ReplyKind = 'reply' | 'update' | 'editReply' | 'followUp'`
    and `FakeInteraction.replyKinds?: ReplyKind[]`, populated by `fakeButton` and `fakeSelect`. Step 5
    asserts it on the success case: `replies` records reply and update into one array and both set
    `replied`, so this field is the only thing that can tell a swapped `i.reply` from the `i.update`
    this handler needs in order to strip the spent button.
  - Task 9 (G4-B) deliberately leaves `makeCtx`'s `config.modules` at `{}` (`tests/harness.ts:21`) and
    does not touch `testRegistry`, which builds its own all-enabled flags map as a separate
    `ModuleRegistry` argument (`tests/harness.ts:33-34`). Nothing here reads either — see the
    no-gate note above, this task's mint is same-module and ungated — so this task needs no module
    fixture at all. Do not change the shared default: Task 17 (G5-F)'s last case relies on it to watch
    a cross-module gate suppress a control, and flipping it would turn that case green for the
    wrong reason with nothing failing.
  - Already in the repo, verified line by line against `src/modules/care/index.ts`'s import block:
    `feedDino(ctx: Ctx, userId: string, dinoId: number, foodId?: string): { species: Species; food: FoodDef; cost: number }`
    and `rescueDino(ctx: Ctx, userId: string, dinoId: number): { fee: number; species: Species }` and
    `class CareError extends Error {}` (`./service.js`); `settleEscapes(ctx, userId)`
    (`../park/escapes.js`); `hungerAt(hungerAtFed, lastFedAt, at, drainMs)` and `drainMsFor(traits)`
    (`../../core/clock.js`); `getSpecies`; `FOODS`; `and`/`eq`; `schema`; the module-private
    `carePayload(ctx: Ctx, userId: string, description: string)`; `attach` / `assetImage`
    (`../../core/images.js`).
- Produces:
  - component prefix **`care`**, registered as the care module's first `ComponentDef`
  - customId `care:feed:<uid>:<dinoId>` — one click, feeds that dino with the auto-picked cheapest
    affordable food, and spends nothing when the dino is already full
  - `rescuePayload(speciesName: string, fee: number, userId: string, dinoId: number)` — module-private,
    signature widened by two params, return type widened by a `components` key

---

- [ ] **Step 1: Write the failing test — the `/rescue` reply mints the feed button**

Create `tests/care-feed-button.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino } from '../src/modules/park/dinos.js';
import { careModule } from '../src/modules/care/index.js';
import { schema } from '../src/core/db/index.js';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 100_000, foods: { ferns: 100 } }, 'seed', 0);
});

const rescueCmd = () => careModule.commands.find((c) => c.data.name === 'rescue')!;
const dinoOf = (id: number) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;
const fernsHeld = () => ctx.economy.getFoodInventory('u1').ferns ?? 0;

// Read out of the REAL builder JSON (snake_case custom_id), never hand-typed.
const idsOf = (payload: unknown): string[] =>
  ((payload as { components?: ReadonlyArray<{ toJSON(): { components: Array<{ custom_id?: string }> } }> })
    .components ?? [])
    .flatMap((r) => r.toJSON().components)
    .map((c) => c.custom_id)
    .filter((x): x is string => typeof x === 'string');

const embedOf = (payload: unknown) =>
  (payload as { embeds: Array<{ toJSON(): { description?: string } }> }).embeds[0].toJSON();

/**
 * An escaped, paddocked dino ready for /rescue, with the clock at day 1.
 *
 * The clock matters: feedCostFor multiplies by eventMods(now).feedCost, so a cost this file
 * pins as a whole rendered string only holds on a day whose event leaves it at 1. Verify with
 * `eventMods(24 * 3_600_000).feedCost` before changing this fixture's instant.
 */
const escapedDino = () => {
  const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
  const d = ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
  }).returning().get();
  assignDino(ctx, 'u1', d.id, lot.id);
  ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, d.id)).run();
  ctx.setNow(24 * H);
  return d;
};

describe('/rescue offers the next step as a control', () => {
  it('mints the feed button, carrying the owner and the dino', async () => {
    const d = escapedDino();
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: d.id } });
    await rescueCmd().execute(ctx, i.asChatInput());
    // The WHOLE id: a reply that merely carried something starting with 'care:feed' would
    // still pass with the dino segment dropped, and the button would then feed nothing.
    expect(idsOf(i.replies[0])).toContain(`care:feed:u1:${d.id}`);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/care-feed-button.test.ts`

Expected: FAIL — `expected [] to include 'care:feed:u1:1'`. `rescuePayload` returns embeds and files
only; the reply carries no components.

- [ ] **Step 3: Put the button on the `/rescue` reply**

In `src/modules/care/index.ts`, replace line 1's discord.js import:

```typescript
import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
```

Then replace `rescuePayload` entirely — its comment block and its body. The payload's local annotation
has to grow a `components` key: its inferred type IS that annotation, so a caller cannot add one from
outside:

```typescript
// /rescue success carries the rescue banner; the two failure branches stay
// content-only ephemerals (care.test.ts pins them via replyText).
//
// A rescued dino comes back at roughly half comfort and drains from there, so feeding is the
// next move and it ships as a control. ONE CLICK, NO CONFIRM: the park:feedall button on
// /park view (src/modules/park/embeds.ts) has consumed food on a single click since it
// shipped, and it is safe there because feedAll skips a dino already at 100. The handler on
// the care component below reproduces that skip before it spends anything, which is what
// makes the two genuinely equivalent — the confirm rule in this feature is scoped to CASH.
//
// This reply is PUBLIC, so the owner uid rides in the customId beside the dino id.
function rescuePayload(speciesName: string, fee: number, userId: string, dinoId: number) {
  const embed = new EmbedBuilder().setTitle('🪝 Rescue').setColor(0x3ba55c)
    .setDescription(`Recaptured your ${speciesName} for ${fee.toLocaleString()} cash.`);
  // A named local that is PUSHED onto, never an array assigned wholesale: the next task to
  // add a row to this reply must be able to join it rather than rewrite this expression.
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`care:feed:${userId}:${dinoId}`)
      .setLabel('🍖 Feed it').setStyle(ButtonStyle.Success)));
  const payload: {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
    files?: AttachmentBuilder[];
  } = { embeds: [embed], components: rows };
  attach(embed, payload, 'image', assetImage('banners', 'rescue'));
  return payload;
}
```

Then bind the dino id once in the `/rescue` execute so the payload can carry it. Replace:

```typescript
          const { species, fee } = rescueDino(ctx, i.user.id, i.options.getInteger('dino', true));
          await i.reply(rescuePayload(species.name, fee));
```

with:

```typescript
          const dinoId = i.options.getInteger('dino', true);
          const { species, fee } = rescueDino(ctx, i.user.id, dinoId);
          await i.reply(rescuePayload(species.name, fee, i.user.id, dinoId));
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/care-feed-button.test.ts`

Expected: PASS.

Then run `npx vitest run tests/care.test.ts tests/journeys.test.ts` and expect PASS: the existing
`/rescue` cases read `embeds`, `files` and `replyText` only, so a new `components` key changes none
of them.

- [ ] **Step 5: Write the failing routed tests for the `care` prefix**

Append to `tests/care-feed-button.test.ts`. These dispatch through the real `routeInteraction` against
`testRegistry`, which is the only thing that proves the new prefix is reachable at all — a handler
registered as `prefix: 'care:feed'` would match nothing, because `findComponent` resolves on
`customId.split(':')[0]`, and every direct-`execute` test in the suite would still pass:

```typescript
describe('care:feed — the care module\'s first component', () => {
  const click = async (customId: string, user: string) => {
    const b = fakeButton({ customId, user, componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return b;
  };
  const rescued = async () => {
    const d = escapedDino();
    await rescueCmd().execute(ctx,
      fakeCommand({ name: 'rescue', user: 'u1', options: { dino: d.id } }).asChatInput());
    return d;
  };

  it('routes through the real registry and feeds the dino on one click', async () => {
    const d = await rescued();
    const before = fernsHeld();
    const b = await click(`care:feed:u1:${d.id}`, 'u1');
    expect(b.deferOpts).toHaveLength(0);      // dispatched, not swallowed by the router guard
    expect(b.replies).toHaveLength(1);
    // i.update, never i.reply. `replies` records both and both set `replied`, so this is the
    // only assertion that can tell them apart — and the difference is the whole one-shot
    // control: an i.reply would leave the spent Feed it button standing on a public message.
    expect(b.replyKinds).toEqual(['update']);
    // The whole rendered line, never a substring holding the number: a substring check on
    // '5' passes against a sentence quoting the wrong figure somewhere else in it.
    expect(embedOf(b.replies[0]).description).toBe('Fed your Triceratops (−5 Ferns).');
    expect(fernsHeld()).toBe(before - 5);
    expect(dinoOf(d.id).lastFedAt).toBe(24 * H);
    // The used button is REMOVED, not disabled: neither router guard reads `disabled`.
    expect(idsOf(b.replies[0])).not.toContain(`care:feed:u1:${d.id}`);
    // The rescue banner this update replaces must be shed, or the message keeps both.
    expect((b.replies[0] as { attachments?: unknown[] }).attachments).toEqual([]);
  });

  it('a second click spends nothing — the dino is already full', async () => {
    // The double-click-before-the-repaint case. The fixture deliberately does NOT model the
    // button being removed by the first update: on a public, durable message a stale control
    // is still clickable, and idempotence is what has to hold, not the repaint.
    const d = await rescued();
    await click(`care:feed:u1:${d.id}`, 'u1');
    const after = fernsHeld();
    const b = await click(`care:feed:u1:${d.id}`, 'u1');
    expect(embedOf(b.replies[0]).description).toBe('Your Triceratops is already full.');
    expect(fernsHeld()).toBe(after);
  });

  it('refuses a bystander clicking the public rescue reply', async () => {
    const d = await rescued();
    const before = fernsHeld();
    const b = await click(`care:feed:u1:${d.id}`, 'u2');
    expect(replyText(b.replies[0])).toBe('Not your dino.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(fernsHeld()).toBe(before);
  });

  it('acknowledges an unrecognised care action instead of leaving it hanging', async () => {
    const b = await click('care:bogus:u1:1', 'u1');
    // A bare return would paint "This interaction failed" after three seconds, and a stale
    // id from an older deploy lands exactly here.
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    // deferReply would also satisfy the length check while posting a public "thinking…"
    // placeholder that never resolves. Only deferUpdate is a silent, correct no-op.
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });

  it('answers a malformed dino segment the way any unowned id is answered', async () => {
    // Number('abc') is NaN, better-sqlite3 binds NaN as a legal no-match, so both reads land
    // on their not-found arm and feedDino says what it says for every other id naming a dino
    // this player does not own. Pinned so "no parse branch here" stays a decision rather than
    // a gap: a guard for NaN alone, beside a `care:feed:u1:999999` that answers identically,
    // would be one no test could tell apart from this.
    await rescued();
    const b = await click('care:feed:u1:abc', 'u1');
    expect(replyText(b.replies[0])).toBe('You do not own that dino.');
  });

  it('names the shortfall when there is no food, and charges nothing', async () => {
    const d = await rescued();
    ctx.economy.apply('u1', { foods: { ferns: -fernsHeld() } }, 'seed', 0);
    const b = await click(`care:feed:u1:${d.id}`, 'u1');
    // feedDino auto-picks, so an empty pantry is a CareError that already carries the numbers.
    // The InsufficientFundsError arm beside it is a backstop this path cannot reach, and no
    // case here pretends otherwise.
    expect(replyText(b.replies[0]))
      .toBe('You have no herbivore food — buy Ferns with /shop food.');
    expect(fernsHeld()).toBe(0);
  });
});
```

- [ ] **Step 6: Run the tests and watch them fail**

Run: `npx vitest run tests/care-feed-button.test.ts -t "care:feed"`

Expected: FAIL, every case. No module claims the `care` prefix, so `findComponent` returns `undefined`
and the router does nothing at all. The first fails on `expected [] to have a length of 1 but got 0`;
the already-full case fails inside `embedOf` with
`TypeError: Cannot read properties of undefined (reading 'embeds')`; the two acknowledgement cases fail
on `expected [] to have a length of 1`; the bystander, malformed-segment and no-food cases fail on
`replyText(undefined)`, which returns `''`.

- [ ] **Step 7: Register the `care` component**

In `src/modules/care/index.ts`, replace the manifest's `  components: [],` with:

```typescript
  components: [
    {
      // The care module's first component prefix. It must be the FIRST customId segment and
      // nothing more: findComponent resolves on customId.split(':')[0] (src/core/modules.ts),
      // so 'care:feed' here would match nothing and this button would be dead in production
      // while every direct-execute test still passed.
      prefix: 'care',
      async execute(ctx, i) {
        const [, action, uid, dinoIdRaw] = i.customId.split(':');
        // deferUpdate, never a bare return — a bare return paints "This interaction failed"
        // after three seconds, and a stale id from an older deploy lands right here.
        if (action !== 'feed') { await i.deferUpdate(); return; }
        // The /rescue reply is a PUBLIC message. feedDino resolves against the CALLER, so a
        // bystander spends nothing either way; without this they would simply be told they do
        // not own a dino they never named. A message-quality layer, not the spend barrier.
        if (i.user.id !== uid) { await i.reply({ content: 'Not your dino.', flags: MessageFlags.Ephemeral }); return; }
        // No integer guard on the dino segment: Number('nonsense') is NaN, better-sqlite3
        // binds NaN as a legal no-match, and both reads below therefore land on the same
        // not-found arm that answers every other unowned id.
        const dinoId = Number(dinoIdRaw);
        // No getOrCreateUser: the uid was checked against the clicker and the id came off that
        // player's own /rescue reply, so the row exists. settleEscapes matches what /feed one
        // does, and it only ever stamps an escape — it never clears one.
        settleEscapes(ctx, i.user.id);
        // feedAll skips a dino already at 100 (its `.filter((c) => !c.escaped && c.hunger < 100)`
        // in src/modules/care/service.ts); feedDino does NOT — its `wasHungry` gates only the
        // dinos_fed stat, never the spend — so without this the second of two clicks landing
        // before the repaint buys a second full meal for a dino that is already full. THIS is
        // what makes "the same as Feed all" a true statement, and it is the reason this button
        // ships with no confirm. Do not remove it, and do not "fix" a double charge later by
        // adding a confirm to this button alone.
        const dino = ctx.db.select().from(schema.dinos)
          .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, i.user.id))).get();
        if (dino && dino.escapedAt === null
            && hungerAt(dino.hunger, dino.lastFedAt, ctx.now(), drainMsFor(dino.traits)) >= 100) {
          await i.update({
            ...carePayload(ctx, i.user.id, `Your ${getSpecies(dino.speciesId).name} is already full.`),
            content: '', components: [], attachments: [],
          });
          return;
        }
        try {
          // No food id, so feedDino auto-picks the cheapest affordable stack and, when there is
          // none, throws a CareError that already names the cost and what is held.
          const { species, food, cost } = feedDino(ctx, i.user.id, dinoId);
          await i.update({
            ...carePayload(ctx, i.user.id, `Fed your ${species.name} (−${cost} ${food.name}).`),
            // content: '' because discord.js drops an OMITTED content key and Discord then
            // leaves the message's existing content in place. components: [] strips the spent
            // one-shot button — neither router guard reads `disabled`, so a disabled button is
            // not a lock. attachments: [] because this update replaces a message already
            // carrying rescue.webp, which would otherwise strand as an orphan attachment card
            // beside the care banner.
            content: '', components: [], attachments: [],
          });
        } catch (e) {
          if (e instanceof CareError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // Backstop only, and deliberately uncovered: this call passes no food id, so
            // feedDino routes through pickFood, which refuses an unaffordable stack with a
            // CareError BEFORE economy.apply is reached — apply cannot overdraw a stack
            // pickFood already proved sufficient. It still renders through shortfallLine, in
            // the same shape the /feed one arm uses, so the §5.1 sweep holds if that changes.
            const what = e.foodId ? FOODS[e.foodId].name : e.wallet;
            await i.reply({
              content: `Not enough ${what} — ${shortfallLine(e)}. Buy more with /shop food.`,
              flags: MessageFlags.Ephemeral,
            });
          }
          else throw e;
        }
      },
    },
  ],
```

- [ ] **Step 8: Run the tests and watch them pass**

Run: `npx vitest run tests/care-feed-button.test.ts -t "care:feed"`

Expected: PASS.

- [ ] **Step 9: Break the prefix, watch it fire, restore it**

The routed test is the only evidence this button is reachable. Temporarily change

```typescript
      prefix: 'care',
```

to

```typescript
      prefix: 'care:feed',
```

Run: `npx vitest run tests/care-feed-button.test.ts -t "routes through the real registry and feeds the dino"`

Expected: FAIL — `expected [] to have a length of 1 but got 0`. `findComponent` compares `'care'`
against `'care:feed'`, matches nothing, and the click vanishes — silently, in production, forever.

Restore `prefix: 'care'` and re-run the same command; expected: PASS.

- [ ] **Step 10: Break the already-full guard, watch it fire, restore it**

This is the guard that makes one-click-no-confirm honest. Temporarily delete the whole block

```typescript
        const dino = ctx.db.select().from(schema.dinos)
          .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, i.user.id))).get();
        if (dino && dino.escapedAt === null
            && hungerAt(dino.hunger, dino.lastFedAt, ctx.now(), drainMsFor(dino.traits)) >= 100) {
          await i.update({
            ...carePayload(ctx, i.user.id, `Your ${getSpecies(dino.speciesId).name} is already full.`),
            content: '', components: [], attachments: [],
          });
          return;
        }
```

Run: `npx vitest run tests/care-feed-button.test.ts -t "a second click spends nothing"`

Expected: FAIL — `expected 'Fed your Triceratops (−5 Ferns).' to be 'Your Triceratops is already full.'`,
and the pantry assertion then shows 5 fewer Ferns than after the first click. That is the double charge,
on a public durable button, for one feed.

Restore the block and re-run the same command; expected: PASS.

- [ ] **Step 11: Break the owner check, watch it fire, restore it**

Temporarily change

```typescript
        if (i.user.id !== uid) { await i.reply({ content: 'Not your dino.', flags: MessageFlags.Ephemeral }); return; }
```

to

```typescript
        if (false) { await i.reply({ content: 'Not your dino.', flags: MessageFlags.Ephemeral }); return; }
```

Run: `npx vitest run tests/care-feed-button.test.ts -t "refuses a bystander clicking the public rescue reply"`

Expected: FAIL — `expected 'You do not own that dino.' to be 'Not your dino.'`. Note what stays green:
`expect(fernsHeld()).toBe(before)` still passes, because `feedDino` resolves against the clicker and a
bystander could never have spent the owner's food. This check exists to give a bystander the right
message, never to prevent the spend — do not describe it as the thing that stops the charge.

Restore the check and re-run the same command; expected: PASS.

- [ ] **Step 12: Break the unknown-action acknowledgement, watch it fire, restore it**

Temporarily change

```typescript
        if (action !== 'feed') { await i.deferUpdate(); return; }
```

to

```typescript
        if (action !== 'feed') return;
```

Run: `npx vitest run tests/care-feed-button.test.ts -t "acknowledges an unrecognised care action"`

Expected: FAIL — `expected [] to have a length of 1 but got 0`. Nothing acknowledges the interaction,
which is what paints "This interaction failed" three seconds later in production.

Restore the `await i.deferUpdate(); return;` form and re-run the same command; expected: PASS.

- [ ] **Step 13: Prove the new prefix collides with nothing at registry construction**

Run: `npx vitest run tests/registry-load.test.ts`

Expected: PASS. This is the test that builds a `ModuleRegistry` over the real `ALL_MODULES` with every
module enabled, and `ModuleRegistry`'s constructor throws
`Duplicate component prefix across modules: <prefix>` on a collision — at boot, so the bot would not
start. It is the specific gate this task owes, because this task adds a prefix and nothing else in the
suite constructs that registry from the real list. Derive the currently-claimed set with
`grep -rn "prefix: '" src/modules/` if it goes red.

**`tests/router.test.ts`'s hardcoded `PREFIXES` array is deliberately NOT extended.** That sweep builds
a throwaway registry from `PREFIXES` and dispatches every id minted by an explicit list of payload
builders through it. No entry in that list mints a `care:` id — the `/rescue` reply comes from the
module-private `rescuePayload`, which is not exported and is not in `surfaces` — so adding `'care'` to
`PREFIXES` would register a handler nothing in that test can reach: a line that looks like coverage and
is not. The routed cases in Step 5 are this component's real evidence.

- [ ] **Step 14: Run the gates**

Run: `npm run typecheck`

Expected: exit 0, no output. `npm run build` typechecks only `src`, so this is the only gate that sees
`tests/care-feed-button.test.ts`.

Then, as a separate command: `npm test`

Expected: PASS, whole suite. (Two commands, never `A && B`: under this repo's primary shell, Windows
PowerShell 5.1, `&&` is a parser error.)

- [ ] **Step 15: Commit**

```bash
git add src/modules/care/index.ts tests/care-feed-button.test.ts
git commit -m "feat(care): offer a one-click feed on the rescue reply"
```

---

### Task 19: Mint **🧭 Dig again** on both expedition-claim surfaces

_Stable id: `G7-A`_

The button that starts the spend flow. It is minted on two PUBLIC messages, so the owner id rides
in the customId (spec §3.2). The arm that consumes it does not exist yet — until Task 20 (G7-B),
`exp`'s unknown-action arm answers `exp:again` with `deferUpdate()`, which is the correct silent
no-op, not a crash.

**Components arrays are built empty and PUSHED into, never assigned.** Spec §3 puts two controls
on each of these two surfaces — **🧭 Dig again** here and **🥚 Incubate #id** from Tasks G7-B and
G4-D — so an assignment would let whichever edit lands second silently delete the other's button
with nothing failing. Per-slice tests assert with `toContain` for the id the task owns; the single
whole-list assertion over each surface lives only in Task 29 (G8-A)'s GRAPH.

**Files:**
- Modify: `src/modules/expeditions/index.ts` — the `discord.js` import on line 1; a new
  `digAgainRow` inserted after `sitePayload` (whose closing `}` is line 61 today); the
  `/expedition claim` branch's `payload` declaration; the `exp:claim` arm's `await i.update({…})`.
  **Every edit is anchored on quoted text, never a line number** — Task 3 (G1-C) has already rewritten
  this file's `catch` block, and Tasks G7-B, G7-C and G4-D each edit the same handler after this
  one.
- Test: `tests/follow-through-spend.test.ts` (create)

**Interfaces:**
- Consumes: nothing this task's own code calls. It edits a file Task 3 (G1-C) (the `/expedition`
  catch block) and Task 8 (G4-A) (`claimExpedition`'s widened return) have already changed, which is
  why every anchor below is quoted text.
- Produces:
  - `export function digAgainRow(userId: string, siteId: string): ActionRowBuilder<ButtonBuilder>`
    in `src/modules/expeditions/index.ts` — one row, one Primary button, customId
    `exp:again:<userId>:<siteId>`, label `🧭 Dig again`. Every minter of that id calls this
    builder; nobody hand-writes it.
  - `/expedition claim`'s reply payload gains
    `components: ActionRowBuilder<ButtonBuilder>[]`, built as `[]` and pushed into.
  - The `exp:claim` arm's `i.update` gains a named `rows` local, pushed into.
  - Module-scope helpers in `tests/follow-through-spend.test.ts`, consumed by Tasks G7-B through
    G7-F: `const DAY = 86_400_000`, `mintedIds(reply: unknown): string[]`,
    `labelOf(reply: unknown, customId: string): string`,
    `cashOf(c: ReturnType<typeof makeCtx>, id: string): number`,
    `seedDigger(c: ReturnType<typeof makeCtx>, id?: string): void`,
    `digAndReturn(c: ReturnType<typeof makeCtx>, id?: string): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/follow-through-spend.test.ts` with exactly this content:

```typescript
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeButton, fakeCommand, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, activeExpedition } from '../src/modules/expeditions/service.js';

const DAY = 86_400_000;

/** Every custom_id on a payload's action rows, read out of the REAL builder JSON.
 *  Builder JSON is snake_case: `custom_id`, never `customId`.
 *  `?.components ?? []` on BOTH counts: a REFUSAL reply is `{ content, flags }` with no
 *  components key at all, and an unrouted or deferred click leaves `replies[0]` undefined
 *  entirely. The helper must answer "no ids" in both cases rather than throwing, or every
 *  refusal case below dies here instead of asserting what it came to assert — and every
 *  red step that predicts an empty list would report a TypeError instead. */
type MintedRows = { components?: ReadonlyArray<{ toJSON(): unknown }> } | undefined;
function mintedIds(reply: unknown): string[] {
  const rows = (reply as MintedRows)?.components ?? [];
  return rows
    .flatMap((r) => (r.toJSON() as { components: Array<{ custom_id?: string }> }).components)
    .map((c) => c.custom_id)
    .filter((id): id is string => typeof id === 'string');
}

/** The rendered label of one minted button, for whole-string assertions. */
function labelOf(reply: unknown, customId: string): string {
  const rows = (reply as MintedRows)?.components ?? [];
  return rows
    .flatMap((r) => (r.toJSON() as { components: Array<{ custom_id?: string; label?: string }> }).components)
    .find((c) => c.custom_id === customId)!.label!;
}

const cashOf = (c: ReturnType<typeof makeCtx>, id: string): number =>
  c.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;

/** A player who can afford several digs. users.cash defaults to 500, so this leaves 50,500. */
function seedDigger(c: ReturnType<typeof makeCtx>, id = 'u1'): void {
  getOrCreateUser(c, id, 'Reg');
  c.economy.apply(id, { cash: 50_000 }, 'seed', c.now());
}

/** Dispatch to coastal_dig and advance to its return. coastal_dig's durationMs IS 15 minutes
 *  and claimExpedition refuses only on `returnsAt > now`, so landing exactly on it counts as
 *  returned — the same idiom tests/alert-buttons.test.ts already uses. 15 minutes never
 *  crosses a UTC midnight from the day starts these tests use, so the world event cannot
 *  move underneath a fixture. */
function digAndReturn(c: ReturnType<typeof makeCtx>, id = 'u1'): void {
  startExpedition(c, id, 'coastal_dig', null);
  c.setNow(c.now() + 15 * 60_000);
}

describe('Dig again — the button', () => {
  it('/expedition claim mints the Dig again button carrying the owner and the site', async () => {
    const ctx = makeCtx();
    seedDigger(ctx);
    digAndReturn(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    // toContain, never a whole-list toEqual: Tasks G7-B and G4-D each add a second control to
    // this same array, and the ONE whole-list assertion over this surface lives in Task 29 (G8-A)'s
    // GRAPH so a deletion is a single findable failure rather than four.
    expect(mintedIds(i.replies[0])).toContain('exp:again:u1:coastal_dig');
    expect(labelOf(i.replies[0], 'exp:again:u1:coastal_dig')).toBe('🧭 Dig again');
  });

  it("the exp:claim button's own update mints it too, so both claim surfaces agree", async () => {
    const ctx = makeCtx();
    seedDigger(ctx);
    digAndReturn(ctx);
    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(mintedIds(b.replies[0])).toContain('exp:again:u1:coastal_dig');
    expect(labelOf(b.replies[0], 'exp:again:u1:coastal_dig')).toBe('🧭 Dig again');
  });

  it('an unrecognised exp action still acknowledges rather than painting "This interaction failed"', async () => {
    // Already true today, and pinned here because Task 20 (G7-B) restructures this handler and must
    // keep it true: the unknown-action arm stays FIRST, ahead of the owner check. That ordering
    // is also pinned by tests/alert-buttons.test.ts's 'exp defers before the owner check on an
    // unknown action, even with a mismatched uid'.
    const ctx = makeCtx();
    seedDigger(ctx);
    const b = fakeButton({ customId: 'exp:whatever:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: FAIL, exactly these two cases, each on its first assertion:

- `/expedition claim mints the Dig again button carrying the owner and the site` —
  `AssertionError: expected [] to include 'exp:again:u1:coastal_dig'`. The claim reply payload
  has no `components` key today, so `mintedIds` takes its `?? []` branch and returns an empty
  list. Not a `SyntaxError` and not a collection error — every symbol imported here exists.
- `the exp:claim button's own update mints it too, so both claim surfaces agree` — the same
  message. That update ships a literal `components: []`.

`an unrecognised exp action still acknowledges…` PASSES: it pins behaviour the file already has
and that Task 20 (G7-B) must not lose.

- [ ] **Step 3: Widen the discord.js import**

In `src/modules/expeditions/index.ts`, replace line 1:

```typescript
import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
```

with:

```typescript
import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
```

Leave line 2 (`import type { AttachmentBuilder } from 'discord.js';`) exactly as it is.

- [ ] **Step 4: Add the `digAgainRow` builder**

Insert this immediately after `sitePayload`'s closing `}` (line 61 today) and before
`export const expeditionsModule`:

```typescript
/**
 * The Dig again control, minted onto both surfaces that END an expedition: the
 * /expedition claim reply and the exp:claim button's own update. Both are PUBLIC messages,
 * so the owner id rides in the customId and the handler rejects a mismatch before the
 * service call — startExpedition resolves against the CALLER, so a bystander's click would
 * silently dispatch their own crew rather than be refused.
 *
 * Unicode in the LABEL, never setEmoji: emojiTag returns '' when no emoji map is loaded and
 * ButtonBuilder#setEmoji throws on that rather than degrading.
 *
 * No price in this id, deliberately. The fee moves with the world event at every UTC
 * midnight and a public message is durable — the price is quoted, and baked into an id,
 * only on the ephemeral confirm card this button opens (Task 20 (G7-B)).
 */
export function digAgainRow(userId: string, siteId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`exp:again:${userId}:${siteId}`)
      .setLabel('🧭 Dig again').setStyle(ButtonStyle.Primary));
}
```

- [ ] **Step 5: Push the row onto the `/expedition claim` reply**

Inside the `/expedition claim` branch, replace this line — **match it with its twelve spaces of
leading indentation**, because `sitePayload` carries a textually identical declaration at two
spaces of indentation and a bare text match would hit that one first:

```typescript
            const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
```

with:

```typescript
            // components starts EMPTY and is PUSHED into. Spec §3 gives this surface two
            // controls from two separate tasks; assigning the array wholesale would make
            // whichever lands second silently delete the other's button, with nothing failing.
            const payload: {
              embeds: EmbedBuilder[];
              components: ActionRowBuilder<ButtonBuilder>[];
              files?: AttachmentBuilder[];
            } = { embeds: [embed], components: [] };
            payload.components.push(digAgainRow(i.user.id, site.id));
```

Leave the `claimExpedition` destructure above it alone: Task 22 (G4-D) is the task that widens it to
`{ loot, site, egg }` and pushes the Incubate row onto this same array.

- [ ] **Step 6: Push the row onto the `exp:claim` update**

Still in `src/modules/expeditions/index.ts`, in the `exp` component's `claim` path, replace this
whole statement (lines 154-157 today — the `try {` on 152 and the `claimExpedition` destructure
on 153 are NOT part of it and must survive):

```typescript
          await i.update({
            content: `🧭 **${site.name}** claimed — a **${loot.eggRarity}** egg, **${loot.cash}** cash, and **${loot.food.qty}× ${FOODS[loot.food.foodId].name}**.`,
            embeds: [], components: [], attachments: [],
          });
```

with:

```typescript
          // Same push-never-assign contract as the /expedition claim reply above.
          const rows: ActionRowBuilder<ButtonBuilder>[] = [];
          rows.push(digAgainRow(i.user.id, site.id));
          await i.update({
            content: `🧭 **${site.name}** claimed — a **${loot.eggRarity}** egg, **${loot.cash}** cash, and **${loot.food.qty}× ${FOODS[loot.food.foodId].name}**.`,
            embeds: [], components: rows, attachments: [],
          });
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: PASS.

- [ ] **Step 8: Confirm the neighbouring expedition suites still pass**

Run: `npx vitest run tests/expeditions.test.ts tests/alert-buttons.test.ts tests/notify-handlers.test.ts`

Expected: PASS. `tests/alert-buttons.test.ts` asserts the `exp:claim` update's text with
`expect(JSON.stringify(b.replies[0])).toContain(…)`, and `tests/expeditions.test.ts`'s claim cases
assert the embed, its image and its thumbnail — none of them asserts the payload has no
components, so adding a row disturbs neither.

- [ ] **Step 9: Commit**
```bash
git add src/modules/expeditions/index.ts tests/follow-through-spend.test.ts
git commit -m "feat(expeditions): offer Dig again on both claim surfaces"
```

---

---

### Task 20: the `exp` handler becomes three arms, and `exp:again` opens a priced confirm card

_Stable id: `G7-B`_

Two things at once, because both are the same edit: this task rewrites the whole `exp` handler
body, so it is the LAST writer of the `exp:claim` arm and therefore the task that must emit both
controls there.

**The claim arm emits both rows from one named local.** Spec §3 row 1 gives that message
**🥚 Incubate #id** as well as **🧭 Dig again**. Task 22 (G4-D) covers only the `/expedition claim`
SLASH reply and verifies this arm rather than rewriting it, so if this task emits only
`digAgainRow` the button half of row 1 never ships and nothing in Task 22 (G4-D) fails.

**The Incubate mint is gated on `ctx.config.modules.hatchery`.** `hatch:inc` is handled in the
HATCHERY module and `ModuleRegistry.findComponent` searches only ENABLED modules
(`src/core/modules.ts`), so with `"hatchery": false` in `modules.json` that button would be a dead
control on a durable public message — a click nothing answers at all, "This interaction failed"
after three seconds. `digAgainRow` needs no such gate: expeditions mints it and expeditions
handles it.

**The card quotes the fee NOW and bakes it into its confirm id.** Task 21 (G7-C) is what refuses on a
mismatch; this task's job is that the number on the card and the number in the id come from one
expression.

**Files:**
- Modify: `src/modules/expeditions/index.ts` — the `../world/embeds.js` import region (add
  `incubateRow`), and the whole `execute` body of the `exp` `ComponentDef`. Anchored on the
  quoted `prefix: 'exp',` line, never a line number: Task 19 (G7-A) has already edited inside this
  body and Tasks G7-C and G4-D edit it after.
- Test: `tests/follow-through-spend.test.ts`

**Interfaces:**
- Consumes:
  - `claimExpedition(ctx: Ctx, userId: string): { loot: Loot; site: SiteDef; egg: Egg }` — Task 8 (G4-A) widened the return with its third key.
  - `incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder>` exported from
    `src/modules/hatchery/embeds.js`, and the `hatch:inc:<uid>:<eggId>` handler on the existing
    `hatch` prefix — Task 9 (G4-B). Import the BUILDER; never the handler, which prefix dispatch
    makes unnecessary.
  - `tests/harness.ts`'s `makeCtx`, whose `config.modules` stays `{}` (`tests/harness.ts:21`) —
    Task 9 (G4-B) deliberately does NOT change it. Every case below that turns on the hatchery gate
    builds its own ctx through this file's `modulesConfig` fixture, the POSITIVE cases included:
    under the default `{}` the gate suppresses its own button, so a case asserting the button
    exists would go green while proving nothing. `testRegistry` is a separate object and stays
    fully enabled either way — the gate reads `ctx.config`, not the registry.
  - `Config` from `src/core/config.js`, for the fixture's return type. Its only fields are
    `token`, `clientId`, `databasePath`, `ownerId` and `modules: Record<string, boolean>`
    (`grep -n "export interface Config" -A 4 src/core/config.ts`), so the literal below
    satisfies it whole with no cast.
  - `digAgainRow(userId, siteId)` and the module-scope test helpers — Task 19 (G7-A).
- Produces:
  - The customId grammar `exp:againyes:<uid>:<siteId>:<price>`, minted only by the `again` arm.
  - The `exp` handler restructured into `claim | again | againyes` behind one unknown-action
    `deferUpdate()` (which stays FIRST) and one shared owner check.
  - The `exp:claim` update's final shape: `rows` holding **Dig again**, then **Incubate** when
    the hatchery module is enabled.
  - `modulesConfig(over?: Record<string, boolean>): Config` and
    `ctxWithModules(over?: Record<string, boolean>, nowMs?: number)` in
    `tests/follow-through-spend.test.ts`, both reused by Task 25 (G7-F). Same fixture shape as Task 22 (G4-D)'s `modulesConfig`/`ctxOn`/`ctxNoHatchery` — declared again here rather than imported,
    because no test file may import another test file's helpers.

- [ ] **Step 1: Extend the test file's imports**

In `tests/follow-through-spend.test.ts`:

(a) add, above the `drizzle-orm` line:

```typescript
import { MessageFlags } from 'discord.js';
```

(b) replace the harness import with:

```typescript
import { makeCtx, fakeButton, fakeCommand, replyText, testRegistry } from './harness.js';
```

(c) merge `expeditionFeeFor` into the existing expeditions-service import so it reads:

```typescript
import { startExpedition, activeExpedition, expeditionFeeFor } from '../src/modules/expeditions/service.js';
```

(d) add these two lines below it:

```typescript
import { EXPEDITION_SITES } from '../src/data/sites.js';
import { eventMods, worldEventFor } from '../src/core/world.js';
```

(e) add the fixture's return type, below those:

```typescript
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/follow-through-spend.test.ts`:

```typescript
/**
 * makeCtx leaves `config.modules` as `{}` (tests/harness.ts:21) and Task 9 (G4-B) deliberately
 * keeps it that way, so every CROSS-MODULE mint below — expeditions and the shop both minting
 * an id the HATCHERY module handles — is gated on `ctx.config.modules.hatchery` and would
 * suppress its own button under a plain ctx. Every case that asserts such a button EXISTS
 * builds its ctx here too, not only the module-disabled ones, or it would go green having
 * watched the gate close rather than the button ship. `testRegistry` is a separate object and
 * stays fully enabled on purpose: the gate reads ctx.config, not the registry, so a fixture
 * has to move exactly that. Same shape as Task 22 (G4-D)'s fixture, declared again rather than
 * imported — no test file imports another test file's helpers.
 */
function modulesConfig(over: Record<string, boolean> = {}): Config {
  return {
    token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner',
    // Derived from ALL_MODULES, never a hand-written list of names: a gate added later on a
    // module this literal happened not to name would read `undefined`, suppress its own
    // control, and leave the test green with nothing to show for it. tests/harness.ts already
    // compiles this exact expression for testRegistry, so it is proven under `npm run typecheck`.
    modules: { ...Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])), ...over },
  };
}
const ctxWithModules = (over: Record<string, boolean> = {}, nowMs = 0) =>
  makeCtx({ nowMs, config: modulesConfig(over) });

const eggsOf = (c: ReturnType<typeof makeCtx>, id: string) =>
  c.db.select().from(schema.eggs).where(eq(schema.eggs.userId, id)).all();

describe('the exp:claim update carries both follow-through controls', () => {
  it('mints Dig again AND Incubate for the egg it just found, and the Incubate id routes', async () => {
    // ctxWithModules, not a plain makeCtx: the Incubate mint is gated on
    // ctx.config.modules.hatchery and the harness default is `{}`, so a plain ctx would make
    // the gate suppress the very button this case is here to see.
    const ctx = ctxWithModules({}, 9 * DAY);
    seedDigger(ctx);
    digAndReturn(ctx);
    const claimedAt = ctx.now();

    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const egg = eggsOf(ctx, 'u1')[0]!;
    expect(mintedIds(b.replies[0])).toContain('exp:again:u1:coastal_dig');
    expect(mintedIds(b.replies[0])).toContain(`hatch:inc:u1:${egg.id}`);

    // Mint it, then ROUTE it. Asserting the id alone would not catch a prefix that resolves
    // to no handler: routeInteraction has no else-branch for an unresolved prefix, so a dead
    // id is a fully silent no-op.
    const inc = `hatch:inc:u1:${egg.id}`;
    const click = fakeButton({ customId: inc, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());
    expect(click.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!.incubationStartedAt)
      .toBe(claimedAt);
  });

  it('mints no Incubate row when the hatchery module is disabled', async () => {
    const ctx = ctxWithModules({ hatchery: false }, 9 * DAY);
    seedDigger(ctx);
    digAndReturn(ctx);
    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const egg = eggsOf(ctx, 'u1')[0]!;
    expect(mintedIds(b.replies[0])).not.toContain(`hatch:inc:u1:${egg.id}`);
    // Dig again still ships: this gate is about the hatchery module, not about the reply.
    expect(mintedIds(b.replies[0])).toContain('exp:again:u1:coastal_dig');
  });
});

describe('Dig again — the confirm card', () => {
  // Day 9 is Heat Wave (expeditionFee x1) and day 10 is Amber Storm (expeditionFee x2).
  // These assertions are not decoration: they are what makes every fixture below a statement
  // about the real world-event pipeline rather than about two constants someone typed.
  // WORLD_SALT or a reorder of WORLD_EVENTS moves which day is which, and this fails loudly
  // instead of the fee tests going quietly vacuous.
  it('day 9 and day 10 really do price coastal_dig differently, through the real pipeline', () => {
    expect(worldEventFor(9 * DAY).id).toBe('heat_wave');
    expect(worldEventFor(10 * DAY).id).toBe('amber_storm');
    expect(eventMods(9 * DAY).expeditionFee).toBe(1);
    expect(eventMods(10 * DAY).expeditionFee).toBe(2);
    expect(expeditionFeeFor(EXPEDITION_SITES.coastal_dig.cost, eventMods(9 * DAY).expeditionFee)).toBe(200);
    expect(expeditionFeeFor(EXPEDITION_SITES.coastal_dig.cost, eventMods(10 * DAY).expeditionFee)).toBe(400);
  });

  it('opens an ephemeral card whose confirm button carries the fee it was minted for', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    digAndReturn(ctx);
    const claim = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1' });
    await routeInteraction(ctx, testRegistry, claim.asInteraction());
    // The REAL minted id, read back out of the payload that mints it — never hand-typed.
    const openId = mintedIds(claim.replies[0]).find((id) => id.startsWith('exp:again:'))!;

    const open = fakeButton({ customId: openId, user: 'u1' });
    const before = cashOf(ctx, 'u1');
    await routeInteraction(ctx, testRegistry, open.asInteraction());

    expect(open.deferOpts).toHaveLength(0);
    expect(open.replies).toHaveLength(1);
    expect((open.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(mintedIds(open.replies[0])).toContain('exp:againyes:u1:coastal_dig:200');
    expect(labelOf(open.replies[0], 'exp:againyes:u1:coastal_dig:200')).toBe('Dig — 200 cash');
    // Nothing is spent by OPENING the card — read before the click, compared after it.
    expect(cashOf(ctx, 'u1')).toBe(before);
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });

  it('quotes the DOUBLED fee, in the card text as well as the id, on an Amber Storm day', async () => {
    const ctx = makeCtx({ nowMs: 10 * DAY });
    seedDigger(ctx);
    const b = fakeButton({ customId: 'exp:again:u1:coastal_dig', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(mintedIds(b.replies[0])).toContain('exp:againyes:u1:coastal_dig:400');
    expect(labelOf(b.replies[0], 'exp:againyes:u1:coastal_dig:400')).toBe('Dig — 400 cash');
    // The LAST rendered line, whole — never a substring around the number. The line above it
    // is the world-event header, whose emoji resolves through EMOJI_FALLBACK and is not what
    // this case is about.
    const lines = replyText(b.replies[0]).split('\n');
    expect(lines[lines.length - 1]).toBe('Send a crew back to **Coastal Dig** for **400** cash?');
  });

  it('a bystander gets nothing back but a refusal', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    seedDigger(ctx, 'u2');
    const b = fakeButton({ customId: 'exp:again:u1:coastal_dig', user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That is not your expedition.');
    // A refusal is content-only, so mintedIds takes its `?? []` branch — no card, no button.
    expect(mintedIds(b.replies[0])).toHaveLength(0);
  });

  it('a forged site segment is acknowledged and dropped, never priced', async () => {
    // EXPEDITION_SITES is a PLAIN object literal (src/data/sites.ts), so
    // EXPEDITION_SITES['constructor'] reads back truthy off Object.prototype and its .cost is
    // undefined. A truthiness guard would quote "undefined for NaN cash" and mint
    // exp:againyes:u1:constructor:NaN.
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    for (const forged of ['exp:again:u1:constructor', 'exp:again:u1:__proto__', 'exp:again:u1']) {
      const b = fakeButton({ customId: forged, user: 'u1' });
      await routeInteraction(ctx, testRegistry, b.asInteraction());
      expect(b.replies, forged).toHaveLength(0);
      expect(b.deferOpts, forged).toHaveLength(1);
      expect(b.deferOpts[0], forged).toMatchObject({ kind: 'update' });
    }
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: FAIL, exactly these cases:

- `mints Dig again AND Incubate for the egg it just found, and the Incubate id routes` —
  `AssertionError: expected [ 'exp:again:u1:coastal_dig' ] to include 'hatch:inc:u1:1'`.
- `opens an ephemeral card whose confirm button carries the fee it was minted for` —
  `AssertionError: expected [ { kind: 'update' } ] to have a length of +0 but got 1` on
  `expect(open.deferOpts).toHaveLength(0)`. `again` is not a known action yet, so the
  unknown-action arm acknowledges and never replies; that assertion is first, so
  `expect(open.replies).toHaveLength(1)` is never reached.
- `quotes the DOUBLED fee, in the card text as well as the id, on an Amber Storm day` —
  `AssertionError: expected [] to include 'exp:againyes:u1:coastal_dig:400'`.
- `a bystander gets nothing back but a refusal` — `AssertionError: expected '' to be 'That is
  not your expedition.'`. The unknown-action arm runs BEFORE the owner check, so today an
  unknown `again` is silently deferred for everyone.

`day 9 and day 10 really do price coastal_dig differently…` PASSES — it is a fixture self-check
over the shipped pipeline, not a claim about the handler. `mints no Incubate row when the
hatchery module is disabled` and `a forged site segment…` also pass, vacuously: nothing answers
`again` yet. Steps 6 and 7 are what turn those two into evidence.

- [ ] **Step 4: Import the Incubate builder**

In `src/modules/expeditions/index.ts`, add directly under

```typescript
import { eventHeaderLine } from '../world/embeds.js';
```

this line:

```typescript
import { incubateRow } from '../hatchery/embeds.js';
```

The BUILDER, not the handler: `routeInteraction` resolves a handler from the customId prefix
alone, so no minter ever imports `hatchery/index.ts`. That is a reason not to import the handler;
it is never a reason to copy the builder. (`src/modules/shop/index.ts` already imports
`RARITY_COLOR` from this same file, so the edge exists.)

- [ ] **Step 5: Restructure the handler and add the `again` arm**

In `src/modules/expeditions/index.ts`, in the `components:` array, replace everything from the
line `      prefix: 'exp',` down to and including the `      },` that closes `execute` — the whole
handler as Task 19 (G7-A) left it — with:

```typescript
      prefix: 'exp',
      async execute(ctx, i) {
        const parts = i.customId.split(':');
        const [, action, uid] = parts;
        // Unknown action FIRST, and it must acknowledge: a bare return paints "This
        // interaction failed" after three seconds, and a stale id from an older deploy lands
        // exactly here. The ordering is pinned by tests/alert-buttons.test.ts's 'exp defers
        // before the owner check on an unknown action, even with a mismatched uid'. Any
        // future exp action needs its own arm below or it lands here silently.
        if (action !== 'claim' && action !== 'again' && action !== 'againyes') {
          await i.deferUpdate();
          return;
        }
        // Shared by all three arms. A customId is client-supplied and this handler is
        // reachable from anywhere; both services behind it resolve against the CALLER —
        // claimExpedition takes no id at all, and startExpedition dispatches the clicker's
        // own crew — so without this check a bystander clicking someone else's public card
        // would silently act on their OWN park rather than being refused.
        if (i.user.id !== uid) {
          await i.reply({ content: 'That is not your expedition.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === 'claim') {
          try {
            const { loot, site, egg } = claimExpedition(ctx, i.user.id);
            // ONE named local, PUSHED into, never assigned: spec §3 puts two controls on this
            // message and an assignment would silently delete whichever one it did not name.
            const rows: ActionRowBuilder<ButtonBuilder>[] = [];
            rows.push(digAgainRow(i.user.id, site.id));
            // Cross-module mint. hatch:inc is handled in the HATCHERY module and
            // ModuleRegistry.findComponent searches only ENABLED modules (src/core/modules.ts),
            // so with "hatchery": false in modules.json this button would be a dead control on
            // a durable public message — a click nothing answers at all.
            if (ctx.config.modules.hatchery) rows.push(incubateRow(i.user.id, egg.id));
            await i.update({
              content: `🧭 **${site.name}** claimed — a **${loot.eggRarity}** egg, **${loot.cash}** cash, and **${loot.food.qty}× ${FOODS[loot.food.foodId].name}**.`,
              embeds: [], components: rows, attachments: [],
            });
          } catch (e) {
            if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
            else throw e;
          }
          return;
        }
        const siteId = parts[3];
        // Object.hasOwn, never a truthiness test: EXPEDITION_SITES is a plain object literal
        // (src/data/sites.ts), so EXPEDITION_SITES['constructor'] reads back truthy through
        // Object.prototype with an undefined .cost, and the card would quote "undefined for
        // NaN cash" off a segment the client chose. A truncated id has no fourth segment at
        // all; hasOwn coerces that undefined to the string 'undefined', which is not a site.
        if (!Object.hasOwn(EXPEDITION_SITES, siteId)) { await i.deferUpdate(); return; }
        const site = EXPEDITION_SITES[siteId];
        const now = ctx.now();
        // ONE expression, both arms: the price the card QUOTES and the price the confirm
        // RECHECKS are the same call, so they cannot drift apart.
        const price = expeditionFeeFor(site.cost, eventMods(now).expeditionFee);
        if (action === 'again') {
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`exp:againyes:${i.user.id}:${siteId}:${price}`)
              .setLabel(`Dig — ${price.toLocaleString('en-US')} cash`).setStyle(ButtonStyle.Success));
          await i.reply({
            // EXPEDITION_START_HEADER_KEYS, not the claim keys: this card is about to LOCK IN
            // a duration and a fee, which is exactly what those two keys cover, and it is what
            // tells a player why an Amber Storm doubled the number in front of them.
            content: `${eventHeaderLine(now, EXPEDITION_START_HEADER_KEYS)}\n\nSend a crew back to **${site.name}** for **${price.toLocaleString('en-US')}** cash?`,
            components: [row],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await i.deferUpdate();
      },
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: PASS.

- [ ] **Step 7: Break the module gate and watch its case fire**

Drop the condition from the Incubate push, so the line reads:

```typescript
            rows.push(incubateRow(i.user.id, egg.id));
```

Run: `npx vitest run tests/follow-through-spend.test.ts -t "mints no Incubate row when the hatchery module is disabled"`

Expected: FAIL with
`AssertionError: expected [ 'exp:again:u1:coastal_dig', 'hatch:inc:u1:1' ] not to include 'hatch:inc:u1:1'`.
That is the live shape of the bug: a Discord message is durable, so the button outlives the
deploy that disabled the module, and every click on it does nothing at all — no reply, no
deferUpdate, "This interaction failed" after three seconds.

**Restore the `if (ctx.config.modules.hatchery)` guard** and re-run the same command; expected:
PASS.

- [ ] **Step 8: Break the forged-site guard and watch it fail**

Change `if (!Object.hasOwn(EXPEDITION_SITES, siteId))` to `if (!EXPEDITION_SITES[siteId])` — the
truthiness test the guard replaces.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "forged site segment"`

Expected: FAIL with
`AssertionError: expected [ { content: '…Send a crew back to **undefined** for **NaN** cash?…' } ] to have a length of +0 but got 1: exp:again:u1:constructor`
on `expect(b.replies, forged).toHaveLength(0)` — the prototype key passes a truthiness test and
the handler replies with a priced card built off a segment the client chose.

Restore `Object.hasOwn` and re-run the same command; expected: PASS.

- [ ] **Step 9: Confirm the ordering pin and the expedition suites still hold**

Run: `npx vitest run tests/expeditions.test.ts tests/alert-buttons.test.ts tests/notify-handlers.test.ts`

Then, as a separate command: `npm run typecheck`

Expected: PASS, typecheck exits 0. `tests/alert-buttons.test.ts` is the file that proves the
unknown-action arm still runs before the owner check after the restructure.

- [ ] **Step 10: Commit**
```bash
git add src/modules/expeditions/index.ts tests/follow-through-spend.test.ts
git commit -m "feat(expeditions): split the exp handler into arms and price the Dig again card"
```

---

---

### Task 21: `exp:againyes` charges once, and refuses when the fee moved

_Stable id: `G7-C`_

The guard the whole chain exists for. The confirm carries the fee it was minted for; the handler
recomputes it and refuses on any difference. Refusing is the PURPOSE of the segment, not a
nicety — re-rendering the card on success is a second layer only, because any other open message
still holds a button minted at the old price.

**Files:**
- Modify: `src/modules/expeditions/index.ts` — the trailing `await i.deferUpdate();` that closes
  the `exp` handler (added by Task 20 (G7-B)) becomes the `againyes` arm. Anchored on that quoted
  statement plus the `      },` that follows it.
- Modify: `docs/conventions/router-and-registry.md` — one row appended to the anchor table in
  §guard-scope-cross-message-only, anchored on the quoted `hatch:crack` row (line 115 today).
- Test: `tests/follow-through-spend.test.ts`

**Interfaces:**
- Consumes:
  - The `exp:againyes:<uid>:<siteId>:<price>` grammar and the `site` / `now` / `price` locals from
    Task 20 (G7-B)'s arm.
  - `shortfallLine(e: InsufficientFundsError): string` from `src/core/economy.js` — Task 1 (G1-A) —
    already imported into this file by Task 3 (G1-C), which also fixed the article rule this arm
    follows: an expedition site is a proper place name and takes NO article
    (`Not enough cash — Coastal Dig costs 200, you have 45 (155 short).`).
  - The module-scope test helpers from Tasks G7-A and G7-B.
- Produces: nothing later tasks import. The refusal wording
  `<site> costs <now> cash now, not <quoted> — open the Dig again card for the current price.`
  is asserted whole in this task's own test and nowhere else.

- [ ] **Step 1: Write the failing tests**

Append to `tests/follow-through-spend.test.ts`:

```typescript
describe('Dig again — the confirm click', () => {
  /** Open the card on whatever day ctx is at and hand back the confirm id it really minted. */
  async function openCard(ctx: ReturnType<typeof makeCtx>): Promise<string> {
    const b = fakeButton({ customId: 'exp:again:u1:coastal_dig', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return mintedIds(b.replies[0])[0]!;
  }
  const digRows = (c: ReturnType<typeof makeCtx>) =>
    c.db.select().from(schema.txLog).all().filter((r) => r.reason === 'expedition:coastal_dig');

  it('REFUSES the confirm when one UTC rollover has moved the fee under it', async () => {
    // Minted on day 9 (Heat Wave, fee x1 -> 200). Clicked on day 10 (Amber Storm, fee x2 ->
    // 400). The clock crossing one midnight is what moves the price — nothing here writes a
    // wrong number into the id, which would prove only that `!==` works.
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    const confirmId = await openCard(ctx);
    expect(confirmId).toBe('exp:againyes:u1:coastal_dig:200');

    ctx.setNow(10 * DAY);
    const before = cashOf(ctx, 'u1');
    const beforeRows = digRows(ctx).length;
    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(replyText(click.replies[0])).toBe(
      'Coastal Dig costs 400 cash now, not 200 — open the Dig again card for the current price.');
    expect((click.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(cashOf(ctx, 'u1')).toBe(before);
    expect(digRows(ctx)).toHaveLength(beforeRows);
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });

  it('charges exactly once on the happy path, and refuses a second click of the same confirm', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    const confirmId = await openCard(ctx);
    const before = cashOf(ctx, 'u1');
    const beforeRows = digRows(ctx).length;

    const first = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, first.asInteraction());
    expect(first.deferOpts).toHaveLength(0);
    expect(cashOf(ctx, 'u1')).toBe(before - 200);
    expect(digRows(ctx)).toHaveLength(beforeRows + 1);
    expect(activeExpedition(ctx, 'u1')!.siteId).toBe('coastal_dig');
    // The card blanks itself. Second layer only — any OTHER open message still holds a stale
    // button, which is why the price segment above is the actual guard.
    expect(mintedIds(first.replies[0])).toHaveLength(0);

    const afterFirst = cashOf(ctx, 'u1');
    const second = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, second.asInteraction());
    expect(replyText(second.replies[0])).toBe('You already have an expedition out — claim it first.');
    expect(cashOf(ctx, 'u1')).toBe(afterFirst);
    expect(digRows(ctx)).toHaveLength(beforeRows + 1);
  });

  it('a bystander clicking the confirm dispatches nothing and pays nothing', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    seedDigger(ctx, 'u2');
    const confirmId = await openCard(ctx);
    const before = cashOf(ctx, 'u2');
    const b = fakeButton({ customId: confirmId, user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That is not your expedition.');
    expect(cashOf(ctx, 'u2')).toBe(before);
    expect(activeExpedition(ctx, 'u2')).toBeUndefined();
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });

  it('quotes the shortfall when the player cannot afford the dig it just confirmed', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Three different numbers — needed 200, held 45, short 155 — so a swapped-argument bug
    // in shortfallLine cannot render identically. An expedition SITE is a proper place name
    // and takes no article, matching /expedition start's own wording (Task 3 (G1-C)).
    ctx.db.update(schema.users).set({ cash: 45 }).where(eq(schema.users.discordId, 'u1')).run();
    const confirmId = await openCard(ctx);
    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());
    expect(replyText(click.replies[0]))
      .toBe('Not enough cash — Coastal Dig costs 200, you have 45 (155 short).');
    expect(cashOf(ctx, 'u1')).toBe(45);
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });

  it('a non-integer price segment is acknowledged and dropped', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    for (const forged of ['exp:againyes:u1:coastal_dig:abc', 'exp:againyes:u1:coastal_dig']) {
      const b = fakeButton({ customId: forged, user: 'u1' });
      await routeInteraction(ctx, testRegistry, b.asInteraction());
      expect(b.replies, forged).toHaveLength(0);
      expect(b.deferOpts[0], forged).toMatchObject({ kind: 'update' });
    }
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: FAIL, exactly these cases:

- `REFUSES the confirm when one UTC rollover has moved the fee under it` —
  `AssertionError: expected '' to be 'Coastal Dig costs 400 cash now, not 200 — open the Dig
  again card for the current price.'`. `againyes` is a KNOWN action after Task 20 (G7-B), so it falls
  through to that task's trailing `deferUpdate()`; nothing is replied and `replyText(undefined)`
  returns `''`.
- `charges exactly once on the happy path, and refuses a second click of the same confirm` —
  `AssertionError: expected [ { kind: 'update' } ] to have a length of +0 but got 1`.
- `a bystander clicking the confirm dispatches nothing and pays nothing` — passes the owner
  refusal (the shared check already runs) but there is nothing else to see; it PASSES.
- `quotes the shortfall when the player cannot afford the dig it just confirmed` —
  `AssertionError: expected '' to be 'Not enough cash — Coastal Dig costs 200, you have 45 (155
  short).'`.

`a non-integer price segment is acknowledged and dropped` PASSES vacuously — everything is
deferred today. Step 6 turns it into evidence.

- [ ] **Step 3: Add the `againyes` arm**

In `src/modules/expeditions/index.ts`, replace the trailing

```typescript
        await i.deferUpdate();
      },
```

that closes the `exp` handler (the last statement Task 20 (G7-B) left in place) with:

```typescript
        const quoted = Number(parts[4]);
        if (!Number.isInteger(quoted)) { await i.deferUpdate(); return; }
        // The whole point of the segment. An expedition fee moves with the world event at
        // every UTC midnight, so a confirm card left open across one would charge today's
        // price under yesterday's label. Refusing is the PURPOSE of the segment, not a
        // nicety — the repaint below is a second layer only, because any OTHER open card
        // still holds a button minted at the old price.
        if (price !== quoted) {
          await i.reply({
            content: `${site.name} costs ${price.toLocaleString('en-US')} cash now, not ${quoted.toLocaleString('en-US')} — open the Dig again card for the current price.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        try {
          // startExpedition is what makes a second click of this same confirm harmless: it
          // refuses while a dig is out. There is no idempotency key here and none is needed.
          const exp = startExpedition(ctx, i.user.id, siteId, i.guildId);
          await i.update({
            content: `🧭 Crew dispatched to **${site.name}** — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.`,
            embeds: [], components: [], attachments: [],
          });
        } catch (e) {
          if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            // A site is a proper place name, so no article — the same clause /expedition
            // start renders (Task 3 (G1-C)), and the numbers come off the error rather than
            // being re-derived here.
            await i.reply({
              content: `Not enough cash — ${site.name} ${shortfallLine(e)}.`,
              flags: MessageFlags.Ephemeral,
            });
          } else throw e;
        }
      },
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: PASS.

- [ ] **Step 5a: Break the price guard and watch the refusal fail**

Change `if (price !== quoted) {` to `if (false) {`. Leave it broken for Step 5b.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "REFUSES the confirm when one UTC rollover"`

Expected: FAIL on ONE assertion — vitest aborts a test at its first failing `expect`, so only the
leading one reports:
```
AssertionError: expected '🧭 Crew dispatched to **Coastal Dig**…' to be 'Coastal Dig costs 400 cash now, not 200 — open the Dig again card for the current price.'
Received: "🧭 Crew dispatched to **Coastal Dig** — back <t:864675:R>."
```
(Day 10 is Amber Storm, whose `expeditionMs` is 0.75, so `864000000 + 675000` stamps as 864675.)

- [ ] **Step 5b: Watch the CHARGE itself fail, then restore**

With the guard still broken, comment out the two assertions above the money one — the
`replyText(...)` line and the `flags` line — so `expect(cashOf(ctx, 'u1')).toBe(before)` becomes
the reporting line.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "REFUSES the confirm when one UTC rollover"`

Expected: FAIL with `AssertionError: expected 50100 to be 50500` — a 400 charge landed under a 200
label. That is the money the segment exists to protect, watched moving.

Now restore both: un-comment the two assertions and change `if (false) {` back to
`if (price !== quoted) {`.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "REFUSES the confirm when one UTC rollover"`

Expected: PASS.

- [ ] **Step 6: Break the integer guard and watch it fail**

Comment out the line `if (!Number.isInteger(quoted)) { await i.deferUpdate(); return; }`.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "non-integer price segment"`

Expected: FAIL with
`AssertionError: expected [ { content: 'Coastal Dig costs 200 cash now, not NaN — open the Dig again card for the current price.', … } ] to have a length of +0 but got 1: exp:againyes:u1:coastal_dig:abc`
— `Number('abc')` is NaN, `200 !== NaN` is true, and the refusal renders the forged segment back
to the player as the word "NaN". Restore the line and re-run; expected: PASS.

- [ ] **Step 7: Break the owner check and watch it fail**

Comment out the three lines `if (i.user.id !== uid) { … }` in the `exp` handler.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "a bystander clicking the confirm"`

Expected: FAIL on the FIRST assertion only:
```
AssertionError: expected '🧭 Crew dispatched to **Coastal Dig**…' to be 'That is not your expedition.'
Received: "🧭 Crew dispatched to **Coastal Dig** — back <t:778500:R>."
```
u2's OWN crew was dispatched off u1's button — `startExpedition` resolves against the caller,
which is exactly why the check is explicit here rather than left to the service. Restore the
check and re-run; expected: PASS.

- [ ] **Step 8: Record the new anchor in the conventions**

`docs/conventions/router-and-registry.md` §guard-scope-cross-message-only carries the table headed
"The anchors shipped today, and what each one is anchored against", and
§money-button-carries-its-rung points at it as the authoritative set. A new price anchor that is
not in it makes the table an incomplete claim.

Insert one row immediately after the row that begins ``| `hatch:crack:<eggId>` |`` (line 115
today, the last row of that table), leaving the blank line and the `pageRow` paragraph below it
untouched:

```
| `exp:againyes:<uid>:<siteId>:<price>` | the expedition fee the card quoted | a card left open across a UTC midnight charging an Amber Storm's doubled fee under yesterday's label |
```

- [ ] **Step 9: Run the gates**

Run: `npx vitest run tests/follow-through-spend.test.ts tests/expeditions.test.ts tests/alert-buttons.test.ts tests/conventions.test.ts`

Then, as a separate command: `npm run typecheck`

Expected: PASS, typecheck exits 0. `tests/conventions.test.ts` is in the list because Step 8
edited a file under `docs/conventions/`.

- [ ] **Step 10: Commit**
```bash
git add src/modules/expeditions/index.ts tests/follow-through-spend.test.ts docs/conventions/router-and-registry.md
git commit -m "feat(expeditions): refuse a Dig again confirm whose fee has moved"
```

---

---

### Task 22: `/expedition claim`'s slash reply mints Incubate

_Stable id: `G4-D`_

Spec §3 row 1, slash half only. **The `exp:claim` BUTTON's half belongs to Task 20 (G7-B)**, which
restructures that whole handler into per-action arms and is therefore its last writer; it emits
both `incubateRow` and `digAgainRow` from one named local. This task neither re-implements nor
re-tests that arm — Task 29 (G8-A)'s GRAPH row is what pins it — it only verifies the arm is there
before moving on.

This task lands after Tasks G7-A, G7-B and G7-C precisely so it is a push onto a settled array
rather than an assignment that would silently delete **🧭 Dig again**.

**Files:**
- Modify: `src/modules/expeditions/index.ts` — the `../hatchery/embeds.js` import (only if Task 20 (G7-B) did not already add it — see Step 1), the `/expedition claim` branch's `claimExpedition` destructure, its `.setDescription(...)` line, and the line after `payload.components.push(digAgainRow(i.user.id, site.id));`. Every edit is anchored on quoted text, not on a line number: Tasks G1-C, G7-A and G7-B all edit this file first.
- Test: `tests/follow-through-incubate.test.ts`

**Interfaces:**
- Consumes:
  - `claimExpedition(ctx: Ctx, userId: string): { loot: Loot; site: SiteDef; egg: Egg }` (Task 8 (G4-A)).
  - `incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder>`, the `hatch:inc` handler, and the `mintedIds` helper (Task 9 (G4-B)).
  - `digAgainRow(userId: string, siteId: string): ActionRowBuilder<ButtonBuilder>` (customId `exp:again:<userId>:<siteId>`) and the `/expedition claim` payload's `components: ActionRowBuilder<ButtonBuilder>[]`, built empty and pushed into (Task 19 (G7-A)).
  - The restructured `exp` component handler whose `claim` arm already emits both rows (Task 20 (G7-B)).
- Produces:
  - `/expedition claim`'s reply gains `hatch:inc:<uid>:<eggId>` on `payload.components`, pushed after Dig again, and its description names the egg id and the typed fallback. Row order on that reply: **Dig again, then Incubate** — Task 29 (G8-A)'s GRAPH row is the one place that pins the whole list.
  - Test helpers in `tests/follow-through-incubate.test.ts`: `modulesConfig(over?: Record<string, boolean>): Config`, `ctxOn(nowMs?: number)` and `ctxNoHatchery(nowMs?: number)`, all three reused by Tasks G4-E and G4-F.

- [ ] **Step 1: Verify Task 20 (G7-B) already shipped the button half**

Run: `grep -n "incubateRow\|config.modules.hatchery\|claimExpedition(ctx" src/modules/expeditions/index.ts`

Expected: an `import { incubateRow } from '../hatchery/embeds.js';` line, plus a line inside the
`exp` component's `claim` arm naming both `ctx.config.modules.hatchery` and
`incubateRow(i.user.id, egg.id)`, and that arm destructuring `{ loot, site, egg }`.

If the import is missing, add it directly under
`import { eventHeaderLine } from '../world/embeds.js';`:

```typescript
import { incubateRow } from '../hatchery/embeds.js';
```

If the component arm is missing the mint, make its three lines read:

```typescript
            const { loot, site, egg } = claimExpedition(ctx, i.user.id);
            const rows: ActionRowBuilder<ButtonBuilder>[] = [];
            rows.push(digAgainRow(i.user.id, site.id));
            if (ctx.config.modules.hatchery) rows.push(incubateRow(i.user.id, egg.id));
```

Do **not** add a second import if one is already there, and do not add a second `rows.push` for
Dig again.

- [ ] **Step 2: Write the failing tests**

Add this import to `tests/follow-through-incubate.test.ts`, directly under the `incubateEgg`
import at the top of the file:

```typescript
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';
```

then append to the file:

```typescript
/**
 * makeCtx leaves `config.modules` as `{}` (tests/harness.ts:21), and every Incubate mint from
 * here on is CROSS-MODULE: expeditions, the shop and the gene lab all mint an id the HATCHERY
 * module handles, so each is gated on `ctx.config.modules.hatchery`. ModuleRegistry filters to
 * ENABLED modules (src/core/modules.ts), so a button whose handler's module is off is a control
 * nothing answers at all. Left at the default, every one of those gates would suppress its own
 * button and every case asserting the button exists would go green while proving nothing.
 * `testRegistry` is a separate object and stays fully enabled on purpose: the gate reads
 * ctx.config, not the registry, so a fixture has to move exactly that.
 */
function modulesConfig(over: Record<string, boolean> = {}): Config {
  return {
    token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner',
    // Derived from ALL_MODULES, never a hand-written list of names: a gate added later on a
    // module this literal happened not to name would read `undefined`, suppress its own
    // control, and leave the test green with nothing to show for it. tests/harness.ts already
    // compiles this exact expression for testRegistry, so it is proven under `npm run typecheck`.
    modules: { ...Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])), ...over },
  };
}
const ctxOn = (nowMs = 0) => makeCtx({ nowMs, config: modulesConfig() });
const ctxNoHatchery = (nowMs = 0) => makeCtx({ nowMs, config: modulesConfig({ hatchery: false }) });

describe('/expedition claim offers Incubate', () => {
  function digReady(ctx: ReturnType<typeof makeCtx>) {
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(16 * 60_000);
  }

  it('the slash reply mints hatch:inc for the egg it just found, and that id routes', async () => {
    const ctx = ctxOn();
    digReady(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    // toContain, never a whole-list toEqual: Task 19 (G7-A) owns another control on this same
    // array and Task 29 (G8-A)'s GRAPH row is the ONE place the whole list is pinned. The second
    // assertion is a clobber tripwire, not a claim on that button.
    expect(mintedIds(i.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);
    expect(mintedIds(i.replies[0])).toContain('exp:again:u1:coastal_dig');

    // Mint it, then ROUTE it: asserting the id alone would not catch a prefix that
    // resolves to no handler at all.
    const customId = `hatch:inc:u1:${eggRow.id}`;
    const b = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt).toBe(16 * 60_000);
  });

  it('the slash reply keeps the typed fallback beside the button', async () => {
    const ctx = ctxOn();
    digReady(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    const description = (i.replies[0] as { embeds: Array<{ toJSON(): { description: string } }> })
      .embeds[0].toJSON().description;
    // The LAST rendered line, whole. The lines above it are the world-event header and the
    // loot line, neither of which this task changes. The sentence names only the TYPED path
    // because the button is gated on the hatchery module being enabled — "the button below"
    // would be a lie in exactly the configuration the next case covers.
    const lines = description.split('\n');
    expect(lines[lines.length - 1]).toBe(`Incubate it with \`/incubate egg:${eggRow.id}\`.`);
  });

  it('mints no Incubate row when the hatchery module is disabled', async () => {
    const ctx = ctxNoHatchery();
    digReady(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(i.replies[0])).not.toContain(`hatch:inc:u1:${eggRow.id}`);
    // Dig again still ships: this gate is about the hatchery module, not about the reply.
    expect(mintedIds(i.replies[0])).toContain('exp:again:u1:coastal_dig');
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly two cases:

- `the slash reply mints hatch:inc for the egg it just found, and that id routes` —
  `AssertionError: expected [ 'exp:again:u1:coastal_dig' ] to include 'hatch:inc:u1:1'`.
- `the slash reply keeps the typed fallback beside the button` —
  ``expected 'Found a **common** egg!' to be 'Incubate it with `/incubate egg:1`.'``. (Day 0 is
  clear_skies and the ctx rng is `mulberry32(42)`, so the first rarity roll for `coastal_dig` is
  `common` and `rarityEmoji('common')` renders as the empty string.)

`mints no Incubate row when the hatchery module is disabled` PASSES here, vacuously — nothing
mints the row yet. That is why Step 5 exists.

- [ ] **Step 4: Mint the button on the slash reply**

In `src/modules/expeditions/index.ts`, all three edits inside the `/expedition claim` branch.

(a) Replace the destructure

```typescript
            const { loot, site } = claimExpedition(ctx, i.user.id);
```

with:

```typescript
            const { loot, site, egg } = claimExpedition(ctx, i.user.id);
```

After Task 20 (G7-B) this text occurs exactly once — the component arm already destructures `egg`.
Confirm with `grep -n "const { loot, site } = claimExpedition" src/modules/expeditions/index.ts`,
which must print exactly one line before the edit and none after it. If it prints two, Step 1's
remedy was skipped: go back and apply it, then return here.

(b) Replace the description line

```typescript
              .setDescription(`${header}\n\nFound a **${rarityEmoji(loot.eggRarity)}${loot.eggRarity}** egg!`)
```

with:

```typescript
              .setDescription(`${header}\n\nFound a **${rarityEmoji(loot.eggRarity)}${loot.eggRarity}** egg (#${egg.id})!\nIncubate it with \`/incubate egg:${egg.id}\`.`)
```

(c) Insert directly after

```typescript
            payload.components.push(digAgainRow(i.user.id, site.id));
```

this line:

```typescript
            // Cross-module mint, and PUSHED, never assigned. hatch:inc is handled in the
            // HATCHERY module, and ModuleRegistry.findComponent searches only enabled modules
            // (src/core/modules.ts), so with "hatchery": false in modules.json this button
            // would be a dead control on a public message — a click nothing answers at all.
            // Task 19 (G7-A) owns digAgainRow on this same array; assigning it would delete that.
            if (ctx.config.modules.hatchery) payload.components.push(incubateRow(i.user.id, egg.id));
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: PASS.

- [ ] **Step 6: Break the module gate and watch its case fire**

Change the line just added to drop the condition:

```typescript
            payload.components.push(incubateRow(i.user.id, egg.id));
```

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `mints no Incubate row when the hatchery module is disabled` —
with `AssertionError: expected [ 'exp:again:u1:coastal_dig', 'hatch:inc:u1:1' ] not to include
'hatch:inc:u1:1'`. That is the live shape of the bug: a Discord message is durable, so the button
outlives the deploy that disabled the module, and every click on it does nothing at all — no
reply, no deferUpdate, "This interaction failed" after three seconds.

**Restore the `if (ctx.config.modules.hatchery)` guard** and re-run; expected: PASS.

- [ ] **Step 7: Confirm the neighbouring suites still pass, and typecheck**

Run: `npx vitest run tests/expeditions.test.ts tests/alert-buttons.test.ts tests/world-effects.test.ts tests/world-module.test.ts tests/images.test.ts tests/follow-through-spend.test.ts`

Then, as a separate command: `npm run typecheck`

Expected: PASS, typecheck exits 0. `tests/follow-through-spend.test.ts` is in that list on
purpose: it is Task G7's file, and it is the thing that would go red if this task's push had
clobbered **🧭 Dig again**. If it fails on a whole-list `toEqual` over the claim reply's ids, the
fix belongs in that file — per the plan's components rule a per-slice test asserts only the id it
owns, and the single whole-list assertion lives in Task 29 (G8-A)'s GRAPH.

- [ ] **Step 8: Commit**
```bash
git add src/modules/expeditions/index.ts tests/follow-through-incubate.test.ts
git commit -m "feat(expeditions): offer Incubate on the claim reply"
```

---

---

### Task 23: Mint **🥚 Buy another** on `/shop egg`'s reply

_Stable id: `G7-D`_

Spec §3 row 2 gives `/shop egg` two controls — **🥚 Buy another** here and **🥚 Incubate #id** in
Task 26 (G4-E), which lands after this one — so this payload's `components` array is built empty and
pushed into, never assigned.

**Files:**
- Modify: `src/modules/shop/index.ts` — a new `buyAnotherRow` inserted after the
  `eggRarityChoices` declaration (line 24 today), and the `sub === 'egg'` branch's `eggPayload`
  declaration. Anchored on quoted text: Task 3 (G1-C) has already rewritten this file's `catch`
  block, and Tasks G7-E, G7-F and G4-E each edit it after.
- Test: `tests/follow-through-spend.test.ts`

**Interfaces:**
- Consumes: the module-scope test helpers from Tasks G7-A and G7-B.
- Produces:
  - `export function buyAnotherRow(userId: string, rarity: Rarity): ActionRowBuilder<ButtonBuilder>`
    in `src/modules/shop/index.ts` — customId `shop:again:<userId>:<rarity>`, label
    `🥚 Buy another`.
  - `/shop egg`'s `eggPayload` gains `components: ActionRowBuilder<ButtonBuilder>[]`, built as
    `[]` and pushed into. Task 26 (G4-E) pushes `incubateRow` onto this same array.

- [ ] **Step 1: Extend the test file's imports**

In `tests/follow-through-spend.test.ts`, add these two lines below the expeditions imports:

```typescript
import { shopModule } from '../src/modules/shop/index.js';
import { dailyEggOffers, eggPriceAt, todaysDeal } from '../src/modules/shop/service.js';
```

(`shopModule` is used by Task 24 (G7-E)'s card fixture and `todaysDeal` by its pipeline self-check;
both land two tasks from now, and an unused import is not an error under either tsconfig. Adding
them once keeps the import block a single edit.)

- [ ] **Step 2: Write the failing test**

Append to `tests/follow-through-spend.test.ts`:

```typescript
describe('Buy another — the button', () => {
  it('/shop egg mints the Buy another button carrying the owner and the rarity', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    // Day 0 really does offer it. `common` is structurally always in the rotation at the
    // uncommon ceiling — the pool there is exactly ['common','uncommon'] and slice(0,3)
    // cannot truncate it — so the pre-buy rotation gate cannot swallow this case.
    expect(dailyEggOffers(0, 0)).toContain('common');
    const i = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity: 'common' } });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    // toContain for the id this task owns; Task 26 (G4-E) adds a second control to this same
    // array and Task 29 (G8-A)'s GRAPH is the one place the whole list is pinned.
    expect(mintedIds(i.replies[0])).toContain('shop:again:u1:common');
    expect(labelOf(i.replies[0], 'shop:again:u1:common')).toBe('🥚 Buy another');
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-spend.test.ts -t "mints the Buy another button"`

Expected: FAIL with `AssertionError: expected [] to include 'shop:again:u1:common'` — the
`/shop egg` payload carries no `components` key today, so `mintedIds` takes its `?? []` branch.

- [ ] **Step 4: Add the builder**

In `src/modules/shop/index.ts`, insert immediately after

```typescript
const eggRarityChoices = (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((r) => ({ name: r, value: r }));
```

this:

```typescript
/**
 * The Buy another control, minted on /shop egg's PUBLIC reply. The owner id rides in the
 * customId because buyEgg resolves against the CALLER — a bystander's click would buy
 * themselves an egg rather than be refused.
 *
 * Unicode in the label, never setEmoji: emojiTag returns '' when no emoji map is loaded and
 * ButtonBuilder#setEmoji throws on that rather than degrading. No price here either — an egg
 * price rolls at every UTC midnight, and only the ephemeral confirm card this opens quotes a
 * number and bakes it into an id.
 */
export function buyAnotherRow(userId: string, rarity: Rarity): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`shop:again:${userId}:${rarity}`)
      .setLabel('🥚 Buy another').setStyle(ButtonStyle.Primary));
}
```

`ActionRowBuilder`, `ButtonBuilder` and `ButtonStyle` are already on this file's line 1 and
`type Rarity` on line 4, so no import change is needed here.

- [ ] **Step 5: Push the row onto the egg reply**

In the `sub === 'egg'` branch, replace:

```typescript
            const eggPayload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [eggEmbed] };
```

with:

```typescript
            // components starts EMPTY and is PUSHED into. Spec §3 gives this surface two
            // controls from two separate tasks; assigning the array wholesale would make
            // whichever lands second silently delete the other's button, with nothing failing.
            const eggPayload: {
              embeds: EmbedBuilder[];
              components: ActionRowBuilder<ButtonBuilder>[];
              files?: AttachmentBuilder[];
            } = { embeds: [eggEmbed], components: [] };
            eggPayload.components.push(buyAnotherRow(i.user.id, egg.rarity));
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/follow-through-spend.test.ts tests/shop.test.ts`

Expected: PASS. Nothing in `tests/shop.test.ts` asserts that the egg reply has no components —
its egg case reads the embed's thumbnail and description only.

- [ ] **Step 7: Commit**
```bash
git add src/modules/shop/index.ts tests/follow-through-spend.test.ts
git commit -m "feat(shop): offer Buy another on the /shop egg reply"
```

---

---

### Task 24: the `shop` component prefix, the `sell` bare return, and the Buy another card

_Stable id: `G7-E`_

Shop gains a SECOND component prefix beside its existing `sell`. Prefixes are globally unique and
a duplicate throws at `ModuleRegistry` construction — i.e. at boot — so confirm `shop` is
unclaimed before writing anything:

```bash
grep -rho "prefix: '[a-z]*'" src/modules | sort -u
```

**The `sell` bare return goes with it.** Spec §3.3's scope test is "in scope because this work
edits the switch", and this task edits the very `components:` array `sell` lives in. Its
`if (action !== 'confirm') return;` paints "This interaction failed" after three seconds on any
stale id from an older deploy. It becomes a `deferUpdate()`, with its own red step first.

**Note on the router sweep.** `tests/router.test.ts:525`'s hardcoded
`const PREFIXES = ['park', 'dex', 'battle', 'hatch', 'season', 'guests', 'daily', 'alert', 'top'];`
already omits `exp` and `sell`, and is deliberately NOT extended with `shop` here. That sweep
builds a SYNTHETIC registry from that list to prove the router GUARD accepts every minted id; it
is not a registration check. Registration is proved by this task's own routed tests against the
real `testRegistry`, per §routed-test-per-component, and by `tests/registry-load.test.ts` for the
boot-time collision. Leaving the list alone is a decision, not an oversight.

**Files:**
- Modify: `src/modules/shop/index.ts` — a new `notInRotation` inserted after `buyAnotherRow`; the
  `sub === 'egg'` rotation gate rewritten to call it; the `sell` component's
  `if (action !== 'confirm') return;`; and a second `ComponentDef` appended to the `components:`
  array. All four anchored on quoted text.
- Test: `tests/follow-through-spend.test.ts`

**Interfaces:**
- Consumes:
  - `buyAnotherRow(userId: string, rarity: Rarity)` — Task 23 (G7-D).
  - The module-scope test helpers from Tasks G7-A and G7-B.
  - Already imported in this file and used unchanged: `getOrCreateUser`, `dailyEggOffers`,
    `eggPriceAt`, `eggRarityChoices`, `MessageFlags`, `ActionRowBuilder`, `ButtonBuilder`,
    `ButtonStyle`.
- Produces:
  - The component prefix `shop` — a second `ComponentDef` on `shopModule.components`, branching
    on the action segment (`again` | `againyes`) and `deferUpdate()`ing anything else.
  - The customId grammar `shop:again:<uid>:<rarity>` (opens the card) and
    `shop:againyes:<uid>:<rarity>:<price>` (Task 25 (G7-F) consumes it).
  - `function notInRotation(rarity: string): string` — module-private, renders
    ``A <rarity> egg isn't in today's rotation — see /shop view.``
  - `sell:<unknown>` now `await i.deferUpdate(); return;` instead of returning bare.

- [ ] **Step 1: Write the failing `sell` test**

Append to `tests/follow-through-spend.test.ts`:

```typescript
describe('the sell prefix acknowledges an action it does not know', () => {
  it('defers rather than painting "This interaction failed"', async () => {
    // Spec §3.3, applied to the third switch this work edits: a bare return leaves the
    // interaction unanswered, and a stale id from an older deploy lands exactly here.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'sell:whatever:1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/follow-through-spend.test.ts -t "defers rather than painting"`

Expected: FAIL with `AssertionError: expected undefined to match object { kind: 'update' }` —
`deferOpts` is empty because the handler returns bare, leaving the interaction unanswered.

- [ ] **Step 3: Convert the `sell` bare return**

In `src/modules/shop/index.ts`, inside the `sell` `ComponentDef`, replace:

```typescript
        if (action !== 'confirm') return;
```

with:

```typescript
        // deferUpdate, never a bare return: a bare return paints "This interaction failed"
        // after three seconds, and a stale id from an older deploy lands exactly here.
        if (action !== 'confirm') { await i.deferUpdate(); return; }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/follow-through-spend.test.ts tests/shop.test.ts tests/shards.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing card tests**

Append to `tests/follow-through-spend.test.ts`:

```typescript
describe('Buy another — the confirm card', () => {
  // Day 17 is Clear Skies (eggPrice x1) and day 18 is Bumper Harvest (eggPrice x1.25). The
  // daily deal is `uncommon` on both, so `common` is undiscounted either side and the ONLY
  // thing moving its price is the world event. These assertions keep every fixture below a
  // statement about the real pipeline rather than about typed constants.
  it('day 17 and day 18 really do price a common egg differently, through the real pipeline', () => {
    expect(worldEventFor(17 * DAY).id).toBe('clear_skies');
    expect(worldEventFor(18 * DAY).id).toBe('bumper_harvest');
    expect(eventMods(17 * DAY).eggPrice).toBe(1);
    expect(eventMods(18 * DAY).eggPrice).toBe(1.25);
    expect(todaysDeal(17 * DAY).rarity).toBe('uncommon');
    expect(todaysDeal(18 * DAY).rarity).toBe('uncommon');
    expect(dailyEggOffers(0, 17 * DAY)).toContain('common');
    expect(dailyEggOffers(0, 18 * DAY)).toContain('common');
    expect(eggPriceAt('common', 17 * DAY)).toBe(500);
    expect(eggPriceAt('common', 18 * DAY)).toBe(625);
  });

  it('opens an ephemeral card whose confirm button carries the price it was minted for', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    const buy = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity: 'common' } });
    await routeInteraction(ctx, testRegistry, buy.asInteraction());
    // The REAL minted id, read back out of the payload that mints it.
    const openId = mintedIds(buy.replies[0]).find((id) => id.startsWith('shop:again:'))!;

    const open = fakeButton({ customId: openId, user: 'u1' });
    const before = cashOf(ctx, 'u1');
    await routeInteraction(ctx, testRegistry, open.asInteraction());

    expect(open.deferOpts).toHaveLength(0);
    expect((open.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(mintedIds(open.replies[0])).toContain('shop:againyes:u1:common:500');
    expect(labelOf(open.replies[0], 'shop:againyes:u1:common:500')).toBe('Buy — 500 cash');
    // The card's own sentence, whole — never a substring around the number.
    expect(replyText(open.replies[0])).toBe('Buy another **common** egg for **500** cash?');
    // Nothing is spent by OPENING the card — read before the click, compared after it.
    expect(cashOf(ctx, 'u1')).toBe(before);
    expect(eggsOf(ctx, 'u1')).toHaveLength(1);   // the one /shop egg bought, and no more
  });

  it('quotes the Bumper Harvest price when the card is opened on day 18', async () => {
    const ctx = makeCtx({ nowMs: 18 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'shop:again:u1:common', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(mintedIds(b.replies[0])).toContain('shop:againyes:u1:common:625');
    expect(labelOf(b.replies[0], 'shop:againyes:u1:common:625')).toBe('Buy — 625 cash');
    expect(replyText(b.replies[0])).toBe('Buy another **common** egg for **625** cash?');
  });

  it('refuses to open a card for a rarity that has left the rotation', async () => {
    // At an epic ceiling, day 0 offers rare and day 1 does not.
    const ctx = makeCtx({ nowMs: DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ ratingHighWater: 400 })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(dailyEggOffers(400, DAY)).not.toContain('rare');
    const b = fakeButton({ customId: 'shop:again:u1:rare', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe("A rare egg isn't in today's rotation — see /shop view.");
    expect(mintedIds(b.replies[0])).toHaveLength(0);
  });

  it('a bystander gets a refusal and no card', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Two');
    const b = fakeButton({ customId: 'shop:again:u1:common', user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That is not your purchase.');
    expect(mintedIds(b.replies[0])).toHaveLength(0);
  });

  it('a forged rarity segment is acknowledged and dropped, never echoed and never priced', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    for (const forged of ['shop:again:u1:__proto__', 'shop:again:u1:constructor', 'shop:again:u1:mythic', 'shop:again:u1']) {
      const b = fakeButton({ customId: forged, user: 'u1' });
      await routeInteraction(ctx, testRegistry, b.asInteraction());
      expect(b.replies, forged).toHaveLength(0);
      expect(b.deferOpts[0], forged).toMatchObject({ kind: 'update' });
    }
    expect(eggsOf(ctx, 'u1')).toHaveLength(0);
  });

  it('an unrecognised shop action acknowledges rather than painting "This interaction failed"', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'shop:whatever:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: FAIL, every case in the new `describe` except the pipeline self-check. No module claims
the `shop` prefix, so `findComponent` resolves nothing and `routeInteraction` is a fully SILENT
no-op — it has no else-branch for an unresolved prefix. So:

- `opens an ephemeral card whose confirm button carries the price it was minted for` —
  `TypeError: Cannot read properties of undefined (reading 'flags')`. Note the preceding
  `expect(open.deferOpts).toHaveLength(0)` PASSES for that same reason, which is why the
  TypeError is what reports.
- `quotes the Bumper Harvest price when the card is opened on day 18` —
  `AssertionError: expected [] to include 'shop:againyes:u1:common:625'`.
- `refuses to open a card for a rarity that has left the rotation`, `a bystander gets a refusal
  and no card` — `AssertionError: expected '' to be …`.
- `a forged rarity segment…` and `an unrecognised shop action…` —
  `AssertionError: expected undefined to match object { kind: 'update' }`.

`day 17 and day 18 really do price a common egg differently, through the real pipeline` PASSES.

- [ ] **Step 7: Hoist the rotation sentence**

In `src/modules/shop/index.ts`, insert immediately after `buyAnotherRow` (added by Task 23 (G7-D)):

```typescript
/**
 * One sentence, two surfaces: /shop egg's own gate below and shop:againyes's recheck. Two
 * literals would drift silently, because nothing ever renders both at once.
 */
function notInRotation(rarity: string): string {
  return `A ${rarity} egg isn't in today's rotation — see /shop view.`;
}
```

Then replace the `sub === 'egg'` gate:

```typescript
            if (!offers.includes(rarity)) { await i.reply({ content: `A ${rarity} egg isn't in today's rotation — see /shop view.`, flags: MessageFlags.Ephemeral }); return; }
```

with:

```typescript
            if (!offers.includes(rarity)) { await i.reply({ content: notInRotation(rarity), flags: MessageFlags.Ephemeral }); return; }
```

- [ ] **Step 8: Add the `shop` component**

Still in `src/modules/shop/index.ts`, add a SECOND entry to the `components:` array, immediately
after the `sell` entry's closing `      } },` and before the `  ],` that closes the array:

```typescript
    { prefix: 'shop', async execute(ctx, i) {
        const parts = i.customId.split(':');
        const [, action, uid, rarityRaw] = parts;
        // Unknown action first, and it must acknowledge: a bare return paints "This
        // interaction failed" after three seconds, and a stale id from an older deploy lands
        // here. Any future shop action needs its own arm below.
        if (action !== 'again' && action !== 'againyes') { await i.deferUpdate(); return; }
        // buyEgg resolves against the CALLER, so without this a bystander clicking the public
        // /shop egg reply would buy THEMSELVES an egg rather than be refused.
        if (i.user.id !== uid) {
          await i.reply({ content: 'That is not your purchase.', flags: MessageFlags.Ephemeral });
          return;
        }
        // Narrow the client-supplied segment against the rarities the builder itself offers,
        // rather than casting it. This is what stops a forged segment being echoed back inside
        // a rendered sentence, and what lets buyEgg below take a real Rarity with no cast.
        const rarity = eggRarityChoices.map((c) => c.value).find((r) => r === rarityRaw);
        if (!rarity) { await i.deferUpdate(); return; }
        const user = getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const now = ctx.now();
        // Rotation BEFORE price. eggPriceAt happily prices a rarity that is no longer on
        // offer, so a price-first order would sometimes report a moved price for an egg that
        // cannot be bought at any price today.
        if (!dailyEggOffers(user.ratingHighWater, now).includes(rarity)) {
          await i.reply({ content: notInRotation(rarity), flags: MessageFlags.Ephemeral });
          return;
        }
        // ONE expression, both arms: the price the card QUOTES and the price the confirm
        // RECHECKS are the same call, so they cannot drift apart.
        const price = eggPriceAt(rarity, now);
        if (action === 'again') {
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`shop:againyes:${i.user.id}:${rarity}:${price}`)
              .setLabel(`Buy — ${price.toLocaleString('en-US')} cash`).setStyle(ButtonStyle.Success));
          await i.reply({
            content: `Buy another **${rarity}** egg for **${price.toLocaleString('en-US')}** cash?`,
            components: [row],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await i.deferUpdate();
      } },
```

- [ ] **Step 9: Run the tests and watch them pass**

Run: `npx vitest run tests/follow-through-spend.test.ts tests/shop.test.ts tests/registry-load.test.ts`

Expected: PASS. `tests/registry-load.test.ts` is what proves the second prefix does not collide at
`ModuleRegistry` construction — a collision there is a boot failure, not a test failure.

- [ ] **Step 10: Break the rarity narrowing and watch it fail**

Change `.find((r) => r === rarityRaw)` to `.find(() => true)` — the shape a bare
`rarityRaw as Rarity` cast would have.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "forged rarity segment"`

Expected: FAIL with
`AssertionError: expected [ { content: 'Buy another **common** egg for **500** cash?', … } ] to have a length of +0 but got 1: shop:again:u1:__proto__`
on `expect(b.replies, forged).toHaveLength(0)` — a forged segment silently becomes `common` and
gets a real priced card. Restore `.find((r) => r === rarityRaw)` and re-run; expected: PASS.

(The rotation gate's own break-and-watch is Task 25 (G7-F) Step 8: it is one guard serving both arms,
and breaking it there fails this task's `refuses to open a card…` case as well.)

- [ ] **Step 11: Commit**
```bash
git add src/modules/shop/index.ts tests/follow-through-spend.test.ts
git commit -m "feat(shop): add a shop component prefix and the Buy another card"
```

---

---

### Task 25: `shop:againyes` rechecks the rotation and the price, charges once, and hands the egg on

_Stable id: `G7-F`_

Two independent rechecks, because a rarity can leave the rotation at an unchanged price and a
price can move while the rarity stays: neither is a consequence of the other, and each gets its
own test and its own break step.

**This surface hands over an egg, so it mints Incubate.** Spec §3's rule is per-surface, not
per-command, and this is the third place in the plan where an egg appears in a player's hands.
The follow-up sentence names the TYPED path only — ``Incubate it with `/incubate egg:<id>`.`` —
never "below": the button is gated on the hatchery module being enabled, so prose promising a
control beside it would be false in exactly the configuration the gate exists for, and no test
can catch that because the module-disabled case is the one nobody reads. `egg:` is mandatory:
`/incubate`'s option is NAMED (`o.setName('egg')` in `src/modules/hatchery/index.ts`), so
`/incubate 1` is not valid Discord syntax.

**Files:**
- Modify: `src/modules/shop/index.ts` — the `../hatchery/embeds.js` import, and the `shop`
  handler's trailing `await i.deferUpdate();` (added by Task 24 (G7-E)) which becomes the `againyes`
  arm. Anchored on quoted text.
- Modify: `docs/conventions/router-and-registry.md` — one row appended to the anchor table,
  anchored on the quoted `exp:againyes` row Task 21 (G7-C) added.
- Test: `tests/follow-through-spend.test.ts`

**NOTE FOR TASK G4-E, which lands immediately after this task:** its Step 3 instructs replacing
`import { RARITY_COLOR } from '../hatchery/embeds.js';` with
`import { RARITY_COLOR, incubateRow } from '../hatchery/embeds.js';`. Step 3 below has already
made that exact edit, so after this task that half is done — do not add a second import. The rest
of Task 26 (G4-E) (the `/shop egg` description, and the push onto `eggPayload.components`) is
untouched by this task and still applies.

**Interfaces:**
- Consumes:
  - The `shop:againyes:<uid>:<rarity>:<price>` grammar and the `user` / `rarity` / `now` /
    `price` locals from Task 24 (G7-E)'s arm.
  - `incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder>` from
    `src/modules/hatchery/embeds.js` and the `hatch:inc` handler — Task 9 (G4-B).
  - `modulesConfig(over?)` and `ctxWithModules(over?, nowMs?)` — Task 20 (G7-B). `makeCtx` leaves
    `config.modules` as `{}` (`tests/harness.ts:21`), so BOTH cases that touch the hatchery gate
    below build their ctx through the fixture: the one that expects the Incubate row and the one
    that expects it withheld.
  - `shortfallLine(e: InsufficientFundsError): string` — Task 1 (G1-A), already imported into this
    file by Task 3 (G1-C). An egg takes the indefinite article: `a ${rarity} egg`.
  - `buyEgg(ctx, userId, rarity): Egg` and `ShopError`, already imported on this file's line 6.
- Produces: nothing later tasks import. The success content, both refusals and the insufficiency
  clause are each asserted whole in this task's own tests.

- [ ] **Step 1: Write the failing tests**

Append to `tests/follow-through-spend.test.ts`:

```typescript
describe('Buy another — the confirm click', () => {
  async function openCard(ctx: ReturnType<typeof makeCtx>, rarity: string): Promise<string> {
    const b = fakeButton({ customId: `shop:again:u1:${rarity}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return mintedIds(b.replies[0])[0]!;
  }

  it('REFUSES the confirm when one UTC rollover has moved the price under it', async () => {
    // Minted on day 17 (Clear Skies -> 500), clicked on day 18 (Bumper Harvest -> 625). The
    // clock crossing one midnight is what moves the price — nothing here writes a wrong number
    // into the id, which would prove only that `!==` works. `common` is on offer on BOTH days,
    // so the rotation recheck passes and this case isolates the price guard.
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    const confirmId = await openCard(ctx, 'common');
    expect(confirmId).toBe('shop:againyes:u1:common:500');

    ctx.setNow(18 * DAY);
    const before = cashOf(ctx, 'u1');
    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(replyText(click.replies[0])).toBe(
      'A common egg costs 625 cash now, not 500 — open the Buy another card for the current price.');
    expect((click.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(cashOf(ctx, 'u1')).toBe(before);
    expect(eggsOf(ctx, 'u1')).toHaveLength(0);
  });

  it('REFUSES the confirm when the rarity has left the rotation, at an unchanged price', async () => {
    // At an epic ceiling, day 0 offers rare and day 1 does not — and rare costs 8,000 on BOTH
    // days, so the price guard passes and this case isolates the rotation recheck.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    ctx.db.update(schema.users).set({ ratingHighWater: 400 })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(dailyEggOffers(400, 0)).toContain('rare');
    expect(dailyEggOffers(400, DAY)).not.toContain('rare');
    expect(eggPriceAt('rare', 0)).toBe(8000);
    expect(eggPriceAt('rare', DAY)).toBe(8000);

    const confirmId = await openCard(ctx, 'rare');
    expect(confirmId).toBe('shop:againyes:u1:rare:8000');

    ctx.setNow(DAY);
    const before = cashOf(ctx, 'u1');
    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(replyText(click.replies[0])).toBe("A rare egg isn't in today's rotation — see /shop view.");
    expect(cashOf(ctx, 'u1')).toBe(before);
    expect(eggsOf(ctx, 'u1')).toHaveLength(0);
  });

  it('charges exactly once, hands the egg over with an Incubate button, and blanks the confirm', async () => {
    // ctxWithModules, not a plain makeCtx: the Incubate mint below is gated on
    // ctx.config.modules.hatchery, which the harness leaves `{}`.
    const ctx = ctxWithModules({}, 17 * DAY);
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    const confirmId = await openCard(ctx, 'common');
    const before = cashOf(ctx, 'u1');

    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(click.deferOpts).toHaveLength(0);
    expect(cashOf(ctx, 'u1')).toBe(before - 500);
    const egg = eggsOf(ctx, 'u1')[0]!;
    expect(eggsOf(ctx, 'u1')).toHaveLength(1);
    expect(ctx.db.select().from(schema.txLog).all()
      .filter((r) => r.reason === 'shop-egg:common')).toHaveLength(1);
    // The WHOLE sentence, numbers included. `/incubate egg:<id>`, never `/incubate <id>` —
    // the option is named — and it never says "below", because the button beside it is gated
    // on the hatchery module being enabled.
    expect(replyText(click.replies[0])).toBe(
      `🥚 Bought another **common** egg (#${egg.id}) for **500** cash. Incubate it with \`/incubate egg:${egg.id}\`.`);
    // The spent confirm is gone and the Incubate control has taken its place.
    expect(mintedIds(click.replies[0])).not.toContain(confirmId);
    expect(mintedIds(click.replies[0])).toContain(`hatch:inc:u1:${egg.id}`);

    // Mint it, then ROUTE it: an unresolved prefix is a fully silent no-op, so asserting the
    // id alone would not catch a dead control.
    const inc = fakeButton({ customId: `hatch:inc:u1:${egg.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, inc.asInteraction());
    expect(inc.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!.incubationStartedAt)
      .toBe(17 * DAY);
  });

  it('mints no Incubate row on the confirm when the hatchery module is disabled', async () => {
    const ctx = ctxWithModules({ hatchery: false }, 17 * DAY);
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    const confirmId = await openCard(ctx, 'common');
    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());
    const egg = eggsOf(ctx, 'u1')[0]!;
    // The purchase still lands; only the dead control is withheld.
    expect(eggsOf(ctx, 'u1')).toHaveLength(1);
    expect(mintedIds(click.replies[0])).not.toContain(`hatch:inc:u1:${egg.id}`);
  });

  it('a second click of a card the confirm already replaced is refused by the router', async () => {
    // ctxWithModules again, so the componentIds fixture below models what this ctx really
    // mints: with the harness default `{}` the confirm would leave NO Incubate row behind.
    const ctx = ctxWithModules({}, 17 * DAY);
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    const confirmId = await openCard(ctx, 'common');
    const first = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, first.asInteraction());
    const afterFirst = cashOf(ctx, 'u1');
    const egg = eggsOf(ctx, 'u1')[0]!;

    // componentIds models the message AFTER the confirm replaced its own controls: the
    // Incubate row is what it carries now, and the confirm id is simply gone.
    const second = fakeButton({
      customId: confirmId, user: 'u1', componentIds: [`hatch:inc:u1:${egg.id}`],
    });
    await routeInteraction(ctx, testRegistry, second.asInteraction());
    expect(second.replies).toHaveLength(0);
    expect(second.deferOpts[0]).toMatchObject({ kind: 'update' });
    expect(cashOf(ctx, 'u1')).toBe(afterFirst);
    expect(eggsOf(ctx, 'u1')).toHaveLength(1);
  });

  it('a bystander clicking the confirm buys nothing and pays nothing', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Two');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    ctx.economy.apply('u2', { cash: 50_000 }, 'seed', ctx.now());
    const confirmId = await openCard(ctx, 'common');
    const before = cashOf(ctx, 'u2');
    const b = fakeButton({ customId: confirmId, user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That is not your purchase.');
    expect(cashOf(ctx, 'u2')).toBe(before);
    expect(eggsOf(ctx, 'u2')).toHaveLength(0);
  });

  it('quotes the shortfall when the player cannot afford the egg it just confirmed', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Three different numbers — needed 500, held 120, short 380 — so a swapped-argument bug
    // in shortfallLine cannot render identically. An egg takes the indefinite article, the
    // same clause /shop egg renders (Task 3 (G1-C)).
    ctx.db.update(schema.users).set({ cash: 120 }).where(eq(schema.users.discordId, 'u1')).run();
    const confirmId = await openCard(ctx, 'common');
    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());
    expect(replyText(click.replies[0]))
      .toBe('Not enough cash — a common egg costs 500, you have 120 (380 short).');
    expect(cashOf(ctx, 'u1')).toBe(120);
    expect(eggsOf(ctx, 'u1')).toHaveLength(0);
  });

  it('a non-integer price segment is acknowledged and dropped', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    for (const forged of ['shop:againyes:u1:common:abc', 'shop:againyes:u1:common']) {
      const b = fakeButton({ customId: forged, user: 'u1' });
      await routeInteraction(ctx, testRegistry, b.asInteraction());
      expect(b.replies, forged).toHaveLength(0);
      expect(b.deferOpts[0], forged).toMatchObject({ kind: 'update' });
    }
    expect(eggsOf(ctx, 'u1')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: FAIL, exactly these cases — `againyes` is a KNOWN action after Task 24 (G7-E), so it falls
through to that task's trailing `deferUpdate()` and nothing is replied:

- `REFUSES the confirm when one UTC rollover has moved the price under it` —
  `AssertionError: expected '' to be 'A common egg costs 625 cash now, not 500 — open the Buy
  another card for the current price.'`
- `REFUSES the confirm when the rarity has left the rotation, at an unchanged price` —
  `AssertionError: expected '' to be "A rare egg isn't in today's rotation — see /shop view."`
- `charges exactly once, hands the egg over with an Incubate button, and blanks the confirm` —
  `AssertionError: expected [ { kind: 'update' } ] to have a length of +0 but got 1`.
- `mints no Incubate row on the confirm when the hatchery module is disabled` —
  `AssertionError: expected [] to have a length of 1 but got +0` on `eggsOf(ctx, 'u1')`.
- `a second click of a card the confirm already replaced is refused by the router` —
  `TypeError: Cannot read properties of undefined (reading 'id')`, thrown building the
  `` `hatch:inc:u1:${egg.id}` `` componentIds fixture: the first click bought nothing, so
  `eggsOf(ctx, 'u1')[0]` is undefined.
- `quotes the shortfall when the player cannot afford the egg it just confirmed` —
  `AssertionError: expected '' to be 'Not enough cash — a common egg costs 500, you have 120
  (380 short).'`

`a bystander clicking the confirm buys nothing and pays nothing` and `a non-integer price segment
is acknowledged and dropped` PASS — the shared owner check already runs, and everything else is
deferred. Steps 9 and 10 turn them into evidence.

- [ ] **Step 3: Import the Incubate builder**

In `src/modules/shop/index.ts`, replace:

```typescript
import { RARITY_COLOR } from '../hatchery/embeds.js';
```

with:

```typescript
import { RARITY_COLOR, incubateRow } from '../hatchery/embeds.js';
```

- [ ] **Step 4: Add the `againyes` arm**

Replace the trailing

```typescript
        await i.deferUpdate();
      } },
```

that closes the `shop` handler (the last statement Task 24 (G7-E) left in place) with:

```typescript
        const quoted = Number(parts[4]);
        if (!Number.isInteger(quoted)) { await i.deferUpdate(); return; }
        // The whole point of the segment. An egg price rolls at every UTC midnight — the world
        // event moves eggPrice and the daily deal moves which rarity is discounted — so a
        // confirm card left open across one would charge today's price under yesterday's
        // label. Refusing is the PURPOSE of the segment, not a nicety; the repaint below is a
        // second layer only, because any OTHER open card still holds a button minted at the
        // old price.
        if (price !== quoted) {
          await i.reply({
            content: `A ${rarity} egg costs ${price.toLocaleString('en-US')} cash now, not ${quoted.toLocaleString('en-US')} — open the Buy another card for the current price.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        try {
          const egg = buyEgg(ctx, i.user.id, rarity);
          // One named local, pushed into. Cross-module mint: hatch:inc is handled in the
          // HATCHERY module and ModuleRegistry.findComponent searches only ENABLED modules
          // (src/core/modules.ts), so with "hatchery": false this button would answer nothing.
          const rows: ActionRowBuilder<ButtonBuilder>[] = [];
          if (ctx.config.modules.hatchery) rows.push(incubateRow(i.user.id, egg.id));
          await i.update({
            // `/incubate egg:<id>`, never `/incubate <id>`: the option is NAMED
            // (o.setName('egg') in src/modules/hatchery/index.ts). The sentence names only the
            // TYPED path — "below" would be a lie in exactly the configuration the gate above
            // exists for, and nothing would catch it.
            content: `🥚 Bought another **${egg.rarity}** egg (#${egg.id}) for **${price.toLocaleString('en-US')}** cash. Incubate it with \`/incubate egg:${egg.id}\`.`,
            embeds: [], components: rows, attachments: [],
          });
        } catch (e) {
          if (e instanceof ShopError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) {
            await i.reply({
              content: `Not enough cash — a ${rarity} egg ${shortfallLine(e)}.`,
              flags: MessageFlags.Ephemeral,
            });
          } else throw e;
        }
      } },
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: PASS.

- [ ] **Step 6a: Break the price guard and watch the refusal fail**

Change `if (price !== quoted) {` to `if (false) {`. Leave it broken for Step 6b.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "REFUSES the confirm when one UTC rollover has moved the price"`

Expected: FAIL on ONE assertion — vitest aborts at the first failing `expect`:
```
AssertionError: expected '🥚 Bought another **common** egg (#1)…' to be 'A common egg costs 625 cash now, not 500 — open the Buy another card for the current price.'
Received: "🥚 Bought another **common** egg (#1) for **625** cash. Incubate it with `/incubate egg:1`."
```

- [ ] **Step 6b: Watch the CHARGE itself fail, then restore**

With the guard still broken, comment out the two assertions above the money one — the
`replyText(...)` line and the `flags` line — so `expect(cashOf(ctx, 'u1')).toBe(before)` becomes
the reporting line.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "REFUSES the confirm when one UTC rollover has moved the price"`

Expected: FAIL with `AssertionError: expected 49875 to be 50500` — a 625 charge landed under a 500
label.

Now restore both: un-comment the two assertions and change `if (false) {` back to
`if (price !== quoted) {`.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "REFUSES the confirm when one UTC rollover has moved the price"`

Expected: PASS.

- [ ] **Step 7: Break the integer guard and watch it fail**

Comment out `if (!Number.isInteger(quoted)) { await i.deferUpdate(); return; }` in the `shop`
handler.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "non-integer price segment"`

Expected: FAIL with
`AssertionError: expected [ { content: 'A common egg costs 500 cash now, not NaN — open the Buy another card for the current price.', … } ] to have a length of +0 but got 1: shop:againyes:u1:common:abc`
— `Number('abc')` is NaN, `500 !== NaN` is true, and the refusal renders the forged segment back
to the player as the word "NaN". Restore the line and re-run; expected: PASS.

- [ ] **Step 8: Break the rotation recheck and watch it fail**

Comment out the four lines
`if (!dailyEggOffers(user.ratingHighWater, now).includes(rarity)) { … }` in the `shop` handler.

Run: `npx vitest run tests/follow-through-spend.test.ts`

Expected: FAIL, exactly two cases — one per arm the gate serves:

- `REFUSES the confirm when the rarity has left the rotation, at an unchanged price`:
```
AssertionError: expected '🥚 Bought another **rare** egg (#1)…' to be "A rare egg isn't in today's rotation — see /shop view."
Received: "🥚 Bought another **rare** egg (#1) for **8,000** cash. Incubate it with `/incubate egg:1`."
```
  A rare egg was bought off the rotation entirely, at a price the price guard had no reason to
  reject — which is why the rotation recheck is a separate guard and not a consequence of it.
- `refuses to open a card for a rarity that has left the rotation` (Task 24 (G7-E)'s case):
  `AssertionError: expected 'Buy another **rare** egg for **8,000** cash?' to be "A rare egg isn't in today's rotation — see /shop view."`

Restore the four lines and re-run the whole file; expected: PASS.

- [ ] **Step 9: Break the owner check and watch it fail**

Comment out the four lines `if (i.user.id !== uid) { … }` in the `shop` handler.

Run: `npx vitest run tests/follow-through-spend.test.ts -t "a bystander clicking the confirm"`

Expected: FAIL on the FIRST assertion:
```
AssertionError: expected '🥚 Bought another **common** egg (#1)…' to be 'That is not your purchase.'
Received: "🥚 Bought another **common** egg (#1) for **500** cash. Incubate it with `/incubate egg:1`."
```
u2 bought THEMSELVES an egg off u1's button — `buyEgg` resolves against the caller, which is
exactly why the check is explicit here rather than left to the service. Restore it and re-run;
expected: PASS.

- [ ] **Step 10: Break the module gate and watch its case fire**

Drop the condition from the Incubate push, so the line reads:

```typescript
          rows.push(incubateRow(i.user.id, egg.id));
```

Run: `npx vitest run tests/follow-through-spend.test.ts -t "mints no Incubate row on the confirm"`

Expected: FAIL with
`AssertionError: expected [ 'hatch:inc:u1:1' ] not to include 'hatch:inc:u1:1'` — the button
outlives the deploy that disabled the module, and every click on it does nothing at all.

**Restore the `if (ctx.config.modules.hatchery)` guard** and re-run; expected: PASS.

- [ ] **Step 11: Record the second anchor in the conventions**

In `docs/conventions/router-and-registry.md` §guard-scope-cross-message-only, insert one row
immediately after the row that begins ``| `exp:againyes:<uid>:<siteId>:<price>` |`` (added by
Task 21 (G7-C)), still above the blank line and the `pageRow` paragraph:

```
| `shop:againyes:<uid>:<rarity>:<price>` | the egg price the card quoted | the same, plus buying a rarity that has since left the day's rotation |
```

- [ ] **Step 12: Re-enumerate the shortfall sweep**

This chain added two `InsufficientFundsError` catch sites after Task 4 (G1-D) completed its sweep, so
re-run its enumeration:

```bash
grep -rn "e instanceof InsufficientFundsError" src/modules/*/*.ts
```

Confirm every match either sits beside a `shortfallLine` call or is one of the three documented
exceptions Task 4 (G1-D) settled: `src/modules/trading/index.ts` (it quotes the gap with no "you
have" clause, because `acceptTrade` applies to `trade.fromUser` first while the reply is read by
`trade.toUser`), `src/modules/battles/index.ts` (spec §5.4 — nothing in battles changes) and
`src/modules/admin/service.ts` (its own `shortfallOf`, out of scope). The two new sites are the
`exp:againyes` arm (Task 21 (G7-C)) and the `shop:againyes` arm above.

- [ ] **Step 13: Run the gates**

Run: `npm run typecheck`

Then, as a separate command: `npm test`

Expected: typecheck exits 0 and the whole suite passes. `npm test` rather than a file list here:
this is the last task in the chain, it edited a shared component array, a conventions doc and two
handlers, and `npm run build` typechecks neither `tests/` nor `scripts/`.

- [ ] **Step 14: Commit**
```bash
git add src/modules/shop/index.ts tests/follow-through-spend.test.ts docs/conventions/router-and-registry.md
git commit -m "feat(shop): refuse a Buy another confirm whose price or rotation has moved"
```

---

### Task 26: `/shop egg` mints Incubate

_Stable id: `G4-E`_

Spec §3 row 2. Lands after Task 23 (G7-D) so it is a push onto the array that task declared, and it
also corrects the reply's typed pointer: `/incubate` takes a NAMED option
(`src/modules/hatchery/index.ts:29` — `o.setName('egg')`), so `/incubate 1` is not valid Discord
syntax and never was.

**Files:**
- Modify: `src/modules/shop/index.ts` — the `../hatchery/embeds.js` import, the egg embed's `.setDescription(...)`, and the line after `eggPayload.components.push(buyAnotherRow(i.user.id, egg.rarity));`. Anchored on quoted text: Tasks G1-C, G7-D, G7-E and G7-F all edit this file first.
- Test: `tests/follow-through-incubate.test.ts`

**Interfaces:**
- Consumes:
  - `incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder>`, the `hatch:inc` handler and `mintedIds` (Task 9 (G4-B)).
  - `ctxOn(nowMs?)` and `ctxNoHatchery(nowMs?)` (Task 22 (G4-D)).
  - `buyAnotherRow(userId: string, rarity: Rarity): ActionRowBuilder<ButtonBuilder>` (customId `shop:again:<userId>:<rarity>`) and `/shop egg`'s `eggPayload.components: ActionRowBuilder<ButtonBuilder>[]`, built empty and pushed into (Task 23 (G7-D)).
- Produces: `/shop egg`'s reply gains `hatch:inc:<uid>:<eggId>` on `eggPayload.components`, pushed after Buy another, and its description reads ``Incubate it with `/incubate egg:<id>`.``. Row order: **Buy another, then Incubate**.

- [ ] **Step 1: Write the failing tests**

Add this import to `tests/follow-through-incubate.test.ts`, directly under the `Config` type
import at the top of the file:

```typescript
import { dailyEggOffers } from '../src/modules/shop/service.js';
```

then append to the file:

```typescript
describe('/shop egg offers Incubate', () => {
  /** Buy the first rarity actually on offer today. The rotation gate runs before buyEgg, and
   *  ratingHighWater is 0 for a fresh user — the same argument the handler itself passes.
   *  Re-derive today's list with:
   *    npx tsx -e "import {dailyEggOffers} from './src/modules/shop/service.ts'; console.log(dailyEggOffers(0,0))" */
  function buyFirstOffered(ctx: ReturnType<typeof makeCtx>) {
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 200_000 }, 'seed', 0);
    return fakeCommand({
      name: 'shop', sub: 'egg', user: 'u1', guild: 'g1',
      options: { rarity: dailyEggOffers(0, ctx.now())[0] },
    });
  }

  it('mints hatch:inc for the bought egg, and that id routes', async () => {
    const ctx = ctxOn();
    const i = buyFirstOffered(ctx);
    await routeInteraction(ctx, testRegistry, i.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(i.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);
    // Clobber tripwire for Task 23 (G7-D)'s control, not a claim on it.
    expect(mintedIds(i.replies[0])).toContain(`shop:again:u1:${eggRow.rarity}`);
    // The typed path survives beside the button — the whole description, which is one line.
    expect((i.replies[0] as { embeds: Array<{ toJSON(): { description: string } }> }).embeds[0].toJSON().description)
      .toBe(`Incubate it with \`/incubate egg:${eggRow.id}\`.`);

    const customId = `hatch:inc:u1:${eggRow.id}`;
    const b = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt).toBe(0);
  });

  it('mints no Incubate row when the hatchery module is disabled', async () => {
    const ctx = ctxNoHatchery();
    const i = buyFirstOffered(ctx);
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(i.replies[0])).not.toContain(`hatch:inc:u1:${eggRow.id}`);
    expect(mintedIds(i.replies[0])).toContain(`shop:again:u1:${eggRow.rarity}`);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `/shop egg offers Incubate > mints hatch:inc for the bought
egg, and that id routes` — with
`AssertionError: expected [ 'shop:again:u1:uncommon' ] to include 'hatch:inc:u1:1'`. The
module-disabled case passes vacuously; Step 5 is what turns it into evidence.

- [ ] **Step 3: Import the builder and fix the typed pointer**

In `src/modules/shop/index.ts`, replace

```typescript
import { RARITY_COLOR } from '../hatchery/embeds.js';
```

with:

```typescript
import { RARITY_COLOR, incubateRow } from '../hatchery/embeds.js';
```

Then, in the `sub === 'egg'` branch, replace

```typescript
              .setDescription(`Incubate it with /incubate ${egg.id}.`);
```

with:

```typescript
              // `/incubate egg:<id>`, never `/incubate <id>`: the option is NAMED
              // (src/modules/hatchery/index.ts, o.setName('egg')), so the old text was not
              // valid Discord syntax. Names only the typed path — the button beside it is
              // gated on the hatchery module being enabled.
              .setDescription(`Incubate it with \`/incubate egg:${egg.id}\`.`);
```

- [ ] **Step 4: Push the row**

Insert directly after

```typescript
            eggPayload.components.push(buyAnotherRow(i.user.id, egg.rarity));
```

this line:

```typescript
            // Cross-module mint, and PUSHED, never assigned — same reasoning as the
            // /expedition claim reply: ModuleRegistry routes only enabled modules, so with
            // "hatchery": false this button would answer nothing, and Task 23 (G7-D) owns
            // buyAnotherRow on this same array.
            if (ctx.config.modules.hatchery) eggPayload.components.push(incubateRow(i.user.id, egg.id));
```

- [ ] **Step 5: Run the tests, then break the module gate and watch its case fire**

Run: `npx vitest run tests/follow-through-incubate.test.ts` — expected: PASS.

Now drop the condition from the line just added:

```typescript
            eggPayload.components.push(incubateRow(i.user.id, egg.id));
```

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `/shop egg offers Incubate > mints no Incubate row when the
hatchery module is disabled` — with `expected [ 'shop:again:u1:uncommon', 'hatch:inc:u1:1' ] not
to include 'hatch:inc:u1:1'`.

**Restore the `if (ctx.config.modules.hatchery)` guard** and re-run; expected: PASS.

- [ ] **Step 6: Confirm the shop suites still pass, and typecheck**

Run: `npx vitest run tests/shop.test.ts tests/shards.test.ts tests/images.test.ts tests/follow-through-spend.test.ts`

Then, as a separate command: `npm run typecheck`

Expected: PASS, typecheck exits 0. `tests/shop.test.ts` asserts the egg reply's description
contains `/incubate`, which the reworded line keeps — locate it with
`grep -n "'/incubate'" tests/shop.test.ts`. `tests/follow-through-spend.test.ts` is here for the
same reason as in Task 22 (G4-D): it is what goes red if this push had clobbered **🥚 Buy another**.

- [ ] **Step 7: Commit**
```bash
git add src/modules/shop/index.ts tests/follow-through-incubate.test.ts
git commit -m "feat(shop): offer Incubate on the egg purchase reply"
```

---

---

### Task 27: `/breed claim` and the `breed:claim` button mint Incubate

_Stable id: `G4-F`_

Spec §3 row 3, both surfaces. `claimPayload` stays a pure builder — it has no `Ctx`, and the
module-enabled gate needs one — so both mints live at their call sites in
`src/modules/genelab/index.ts` and the builder only gains the typed pointer its description never
had.

**Files:**
- Modify: `src/modules/genelab/embeds.ts` — `claimPayload`'s embed construction (lines 61-66 today; nothing else in that function changes, and its closing `}` on line 75 is untouched)
- Modify: `src/modules/genelab/index.ts` — the `./embeds.js` import line, the `/breed claim` reply, and the `breed:claim` update. Anchored on quoted text: Task 3 (G1-C) edits this file's `InsufficientFundsError` catch arms first.
- Test: `tests/follow-through-incubate.test.ts`

**Interfaces:**
- Consumes: `incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder>`, the `hatch:inc` handler and `mintedIds` (Task 9 (G4-B)); `ctxOn(nowMs?)` and `ctxNoHatchery(nowMs?)` (Task 22 (G4-D)).
- Produces:
  - `claimPayload(opts)`'s description gains a second line, ``Incubate it with `/incubate egg:<id>`.``. Its `components` key is still set by the CALLER, not by the builder.
  - `/breed claim`'s reply and the `breed:claim` update both carry `hatch:inc:<uid>:<eggId>` when the hatchery module is enabled.
  - Test helper `pairedDinos(ctx): { a: number; b: number }` in `tests/follow-through-incubate.test.ts`.

- [ ] **Step 1: Write the failing tests**

Add these imports to `tests/follow-through-incubate.test.ts`, directly under the `dailyEggOffers`
import at the top of the file:

```typescript
import { buildLot } from '../src/modules/park/service.js';
import { BREED_MS } from '../src/data/breeding.js';
```

then append to the file:

```typescript
/**
 * A gene lab, a herbivore paddock, and two common herbivores standing in it — the minimum
 * startBreeding accepts (same rarity, same diet, both in a paddock, fed, affordable).
 * triceratops and gallimimus are both common/herbivore; hunger defaults to 100 and lastFedAt
 * 0 at nowMs 0, comfortably over BREED_MIN_HUNGER. Returns the two dino ids.
 */
function pairedDinos(ctx: ReturnType<typeof makeCtx>): { a: number; b: number } {
  getOrCreateUser(ctx, 'u1', 'One');
  ctx.economy.apply('u1', { cash: 500_000 }, 'seed', 0);
  buildLot(ctx, 'u1', 'gene_lab');
  buildLot(ctx, 'u1', 'herbivore_paddock');
  const lot = ctx.db.select().from(schema.lots).all().find((l) => l.kind === 'herbivore_paddock')!;
  const a = ctx.db.insert(schema.dinos)
    .values({ userId: 'u1', speciesId: 'triceratops', lotId: lot.id, lastFedAt: 0, hatchedAt: 0 })
    .returning().get();
  const b = ctx.db.insert(schema.dinos)
    .values({ userId: 'u1', speciesId: 'gallimimus', lotId: lot.id, lastFedAt: 0, hatchedAt: 0 })
    .returning().get();
  return { a: a.id, b: b.id };
}

describe('/breed claim offers Incubate', () => {
  /** Start a pairing through the routed confirm button, advance to its ready time, and
   *  return the breeding row's id. */
  async function startAndAdvance(ctx: ReturnType<typeof makeCtx>): Promise<number> {
    const { a, b } = pairedDinos(ctx);
    const confirmId = `breed:confirm:${a}:${b}`;
    const confirm = fakeButton({ customId: confirmId, user: 'u1', guild: 'g1', componentIds: [confirmId] });
    await routeInteraction(ctx, testRegistry, confirm.asInteraction());
    const breeding = ctx.db.select().from(schema.breedings).all()[0];
    // BREED_MS.common is 30 minutes and day 0's clear_skies breedMs multiplier is 1, so the
    // pairing is ready at exactly this stamp. claimBreeding refuses only on readyAt > now.
    ctx.setNow(BREED_MS.common);
    return breeding.id;
  }

  it('the slash reply mints hatch:inc, and that id routes', async () => {
    const ctx = ctxOn();
    await startAndAdvance(ctx);

    const claim = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, claim.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(claim.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);

    const customId = `hatch:inc:u1:${eggRow.id}`;
    const clicked = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, clicked.asInteraction());
    expect(clicked.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt)
      .toBe(BREED_MS.common);
  });

  // Its own case, not a second assertion inside the one above: behind that case's first
  // assertion it would never be OBSERVED failing, and an assertion nobody has watched fail
  // is not yet an assertion.
  it('the slash reply names the typed fallback under the pairing result', async () => {
    const ctx = ctxOn();
    await startAndAdvance(ctx);
    const claim = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, claim.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    // The whole LAST line of the description. The line above it is the pairing result,
    // whose wording depends on the upgrade roll and which this task does not change.
    const description = (claim.replies[0] as { embeds: Array<{ toJSON(): { description: string } }> })
      .embeds[0].toJSON().description;
    const lines = description.split('\n');
    expect(lines[lines.length - 1]).toBe(`Incubate it with \`/incubate egg:${eggRow.id}\`.`);
  });

  it('the breed:claim button mints hatch:inc, and that id routes', async () => {
    const ctx = ctxOn();
    const breedingId = await startAndAdvance(ctx);

    const claimId = `breed:claim:${breedingId}`;
    const claim = fakeButton({ customId: claimId, user: 'u1', guild: 'g1', componentIds: [claimId] });
    await routeInteraction(ctx, testRegistry, claim.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(claim.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);
    // Whole rendered line. The rarity is read back off the row because claimBreeding can
    // upgrade it (BREED_UPGRADE_CHANCE), so the sentence must track what was actually stored.
    expect(replyText(claim.replies[0])).toBe(
      `🧬 Claimed — a **${eggRow.rarity}** egg is yours. Incubate it with \`/incubate egg:${eggRow.id}\`.`);

    const customId = `hatch:inc:u1:${eggRow.id}`;
    const clicked = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, clicked.asInteraction());
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt)
      .toBe(BREED_MS.common);
  });

  it('mints no Incubate row on either surface when the hatchery module is disabled', async () => {
    const slash = ctxNoHatchery();
    await startAndAdvance(slash);
    const claimCmd = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(slash, testRegistry, claimCmd.asInteraction());
    const slashEgg = slash.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(claimCmd.replies[0])).not.toContain(`hatch:inc:u1:${slashEgg.id}`);

    const button = ctxNoHatchery();
    const breedingId = await startAndAdvance(button);
    const claimId = `breed:claim:${breedingId}`;
    const clicked = fakeButton({ customId: claimId, user: 'u1', guild: 'g1', componentIds: [claimId] });
    await routeInteraction(button, testRegistry, clicked.asInteraction());
    const buttonEgg = button.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(clicked.replies[0])).not.toContain(`hatch:inc:u1:${buttonEgg.id}`);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly three cases:

- `the slash reply mints hatch:inc, and that id routes` —
  `AssertionError: expected [] to include 'hatch:inc:u1:1'`. `claimPayload` sets no `components`
  key at all today, so `mintedChildren` takes its `?? []` branch.
- `the breed:claim button mints hatch:inc, and that id routes` — the same failure, against the
  update's literal `components: []`.
- `the slash reply names the typed fallback under the pairing result` —
  ``expected 'The pairing produced a **common** egg.' to be 'Incubate it with `/incubate
  egg:1`.'``. (If the rng rolled an upgrade, the left-hand side is the "— an upgrade!" variant
  instead; either way the description is one line today and the assertion reads it.)

`mints no Incubate row on either surface…` passes vacuously; Step 6 makes it evidence.

- [ ] **Step 3: Give `claimPayload` the typed pointer**

In `src/modules/genelab/embeds.ts`, inside `claimPayload`, replace

```typescript
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('🧬 A new egg!')
    .setDescription(opts.upgraded
      ? `The pairing produced a **${rarityEmoji(opts.rarity)}${opts.rarity}** egg — an upgrade!`
      : `The pairing produced a **${rarityEmoji(opts.rarity)}${opts.rarity}** egg.`)
    .addFields({ name: '🧬 Inherited traits', value: traitLines(opts.traits) });
```

with:

```typescript
  const lead = opts.upgraded
    ? `The pairing produced a **${rarityEmoji(opts.rarity)}${opts.rarity}** egg — an upgrade!`
    : `The pairing produced a **${rarityEmoji(opts.rarity)}${opts.rarity}** egg.`;
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('🧬 A new egg!')
    // Names only the TYPED path. The Incubate button is minted by the CALLER, gated on the
    // hatchery module being enabled, so a builder-side "the button below" would be false in
    // exactly the configuration that gate exists for. This builder takes no Ctx and must not
    // grow one just to read a flag.
    .setDescription(`${lead}\nIncubate it with \`/incubate egg:${opts.eggId}\`.`)
    .addFields({ name: '🧬 Inherited traits', value: traitLines(opts.traits) });
```

Nothing else in `claimPayload` changes — the two `attach` calls keep their order, because call
order is upload order and `tests/genelab-module.test.ts` pins
`['gene_lab-v2.webp', 'rare-v3.webp']` with `toEqual`.

- [ ] **Step 4: Mint on the `/breed claim` slash reply**

In `src/modules/genelab/index.ts`, add this import directly under

```typescript
import { confirmPayload, statusPayload, claimPayload, splicePreviewPayload, splicedPayload } from './embeds.js';
```

the line:

```typescript
import { incubateRow } from '../hatchery/embeds.js';
```

Then replace

```typescript
            await i.reply(claimPayload({
              rarity: egg.rarity, traits: egg.traits, upgraded,
              speciesName: egg.speciesId ? getSpecies(egg.speciesId).name : null,
              remaining: readyRows.length - 1, eggId: egg.id, userId: i.user.id,
            }));
```

with:

```typescript
            const payload = claimPayload({
              rarity: egg.rarity, traits: egg.traits, upgraded,
              speciesName: egg.speciesId ? getSpecies(egg.speciesId).name : null,
              remaining: readyRows.length - 1, eggId: egg.id, userId: i.user.id,
            });
            // Cross-module mint: hatch:inc is handled in the HATCHERY module and
            // ModuleRegistry.findComponent searches only enabled modules, so with
            // "hatchery": false this row would be a control nothing answers. Pushed onto
            // whatever the builder returned rather than assigned, so a future control added
            // inside claimPayload survives this line.
            if (ctx.config.modules.hatchery) (payload.components ??= []).push(incubateRow(i.user.id, egg.id));
            await i.reply(payload);
```

(`Payload.components` is declared optional at `src/modules/genelab/embeds.ts:9`, which is why the
`??=` is needed and why it typechecks.)

- [ ] **Step 5: Mint on the `breed:claim` button**

In the same file, inside the `breed` component's `claim` arm, replace

```typescript
            const { egg } = claimBreeding(ctx, i.user.id, id);
            await i.update({
              content: `🧬 Claimed — a **${egg.rarity}** egg is yours. Incubate it with \`/incubate egg:${egg.id}\`.`,
              embeds: [], components: [], attachments: [],
            });
```

with:

```typescript
            const { egg } = claimBreeding(ctx, i.user.id, id);
            // Same cross-module gate as the slash reply above. A named local rather than an
            // inline array so the mint decision is visible in a diff; no other task in this
            // plan pushes onto this one, which is why the ternary is safe here.
            const rows = ctx.config.modules.hatchery ? [incubateRow(i.user.id, egg.id)] : [];
            await i.update({
              content: `🧬 Claimed — a **${egg.rarity}** egg is yours. Incubate it with \`/incubate egg:${egg.id}\`.`,
              embeds: [], components: rows, attachments: [],
            });
```

- [ ] **Step 6: Run the tests, then break each gate and watch its case fire**

Run: `npx vitest run tests/follow-through-incubate.test.ts` — expected: PASS.

(a) Drop the condition on the slash reply:
`(payload.components ??= []).push(incubateRow(i.user.id, egg.id));`

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `mints no Incubate row on either surface when the hatchery
module is disabled` — with `expected [ 'hatch:inc:u1:1' ] not to include 'hatch:inc:u1:1'` on the
FIRST of its two `not.toContain` assertions. **Restore the guard** and re-run; expected: PASS.

(b) Drop the condition on the button: `const rows = [incubateRow(i.user.id, egg.id)];`

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, the same one case, now on its SECOND `not.toContain` — the button half. Running
the two breaks separately is what proves each gate independently; breaking both at once would
fail the case on the first assertion alone and say nothing about the second.
**Restore the guard** and re-run; expected: PASS.

- [ ] **Step 7: Confirm the gene lab suites still pass, and typecheck**

Run: `npx vitest run tests/genelab-module.test.ts tests/genelab.test.ts tests/images.test.ts`

Then, as a separate command: `npm run typecheck`

Then run: `git diff --stat src/modules/genelab/`

Expected: PASS, typecheck exits 0, and the diff shows both genelab files changed with no leftover
break from Step 6. `tests/genelab-module.test.ts:320` asserts the button reply contains
`/incubate egg:<id>`, which this task leaves word-for-word intact — the button surface's content
does not change at all, only its `components`.

- [ ] **Step 8: Commit**
```bash
git add src/modules/genelab/embeds.ts src/modules/genelab/index.ts tests/follow-through-incubate.test.ts
git commit -m "feat(genelab): offer Incubate on the breed claim reply and claim button"
```

---

---

### Task 28: `mythic:confirm` mints Incubate, and the slice's full gate

_Stable id: `G4-G`_

Spec §3 row 4. This message is ephemeral, so the owner segment in the id is redundant here — it is
minted anyway because there is one builder and one grammar, not two. It is also the one mint in
this slice that needs **no module gate**: the hatchery module both mints and handles the id, so if
it were disabled the message would never be sent in the first place.

The typed pointer on this reply is corrected at the same time: it reads `/incubate <id>` today,
which is not valid Discord syntax — `/incubate` takes a NAMED option
(`src/modules/hatchery/index.ts:29`, `o.setName('egg')`).

**Files:**
- Modify: `src/modules/hatchery/index.ts` — the `./embeds.js` import line, and the `mythic:confirm` success `i.update`. Anchored on quoted text, not line numbers: Task 3 (G1-C) rewrites this file's `InsufficientFundsError` arm just below the edit, Task 9 (G4-B) inserts the whole `inc` arm above it, and Task 17 (G5-F) rewrites the `crack` body above it too.
- Test: `tests/follow-through-incubate.test.ts`

**Interfaces:**
- Consumes: `incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder>`, the `hatch:inc` handler, `mintedIds`, and `FakeInteraction.replyKinds` (Task 9 (G4-B)).
- Produces: the `mythic:confirm` update's `components` is no longer `[]`, and its content names the egg id and a valid `/incubate egg:<id>` invocation.

- [ ] **Step 1: Write the failing test**

Add these imports to `tests/follow-through-incubate.test.ts`, directly under the `BREED_MS` import
at the top of the file:

```typescript
import { mythicSpeciesChoices } from '../src/modules/shop/shards.js';
import { MYTHIC_UNLOCK_RATING } from '../src/data/progression.js';
import { getSpecies } from '../src/data/species/index.js';
```

then append to the file:

```typescript
describe('mythic:confirm offers Incubate', () => {
  it('mints hatch:inc for the Mythic egg, and that id routes', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { shards: 500 }, 'seed', 0);
    ctx.db.update(schema.users).set({ ratingHighWater: MYTHIC_UNLOCK_RATING })
      .where(eq(schema.users.discordId, 'u1')).run();
    const speciesId = mythicSpeciesChoices()[0].id;

    const confirmId = `mythic:confirm:${speciesId}`;
    const confirm = fakeButton({ customId: confirmId, user: 'u1', guild: 'g1', componentIds: [confirmId] });
    await routeInteraction(ctx, testRegistry, confirm.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(confirm.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);
    expect(replyText(confirm.replies[0])).toBe(
      `🌟 A Mythic **${getSpecies(speciesId).name}** egg is yours (#${eggRow.id})! Incubate it with \`/incubate egg:${eggRow.id}\`.`);
    // Plain makeCtx here, with config.modules left at {}: this mint needs NO module gate,
    // because the hatchery module mints AND handles this id — if it were disabled this
    // message would never have been sent. A ctx with modules off is therefore the sharpest
    // fixture available, and the button must still appear.
    expect(confirm.replyKinds).toEqual(['update']);

    const customId = `hatch:inc:u1:${eggRow.id}`;
    const clicked = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, clicked.asInteraction());
    expect(clicked.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: FAIL, exactly one case — `mythic:confirm offers Incubate > mints hatch:inc for the
Mythic egg, and that id routes` — with `AssertionError: expected [] to include 'hatch:inc:u1:1'`.

- [ ] **Step 3: Mint the button on the Mythic confirmation**

In `src/modules/hatchery/index.ts`, replace

```typescript
import { preHatchPayload, revealPayload, eggListPayload, RARITY_COLOR } from './embeds.js';
```

with:

```typescript
import { preHatchPayload, revealPayload, eggListPayload, RARITY_COLOR, incubateRow } from './embeds.js';
```

Then, in the `mythic` handler, replace

```typescript
          const egg = buyMythicEgg(ctx, i.user.id, speciesId);
          await i.update({ content: `🌟 A Mythic **${getSpecies(egg.speciesId!).name}** egg is yours! Incubate it with /incubate ${egg.id}.`, components: [] });
```

with:

```typescript
          const egg = buyMythicEgg(ctx, i.user.id, speciesId);
          await i.update({
            // `/incubate egg:<id>`, never `/incubate <id>`: the option is NAMED, so the old
            // text was not valid Discord syntax.
            content: `🌟 A Mythic **${getSpecies(egg.speciesId!).name}** egg is yours (#${egg.id})! Incubate it with \`/incubate egg:${egg.id}\`.`,
            // No ctx.config.modules gate here, unlike the expedition, shop and gene lab
            // mints: hatch:inc is handled by the `hatch` component in THIS module, so a
            // disabled hatchery module means this handler never ran either. A gate would be
            // a condition that cannot be false.
            components: [incubateRow(i.user.id, egg.id)],
          });
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/follow-through-incubate.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the slice's full gate**

Run: `npm run typecheck`

Then run: `npm test`

Then run: `git diff --stat src/`

Expected: typecheck exits 0, the whole suite passes, and the `src/` diff names only
`src/modules/expeditions/service.ts`, `src/modules/expeditions/index.ts`,
`src/modules/hatchery/embeds.ts`, `src/modules/hatchery/index.ts`, `src/modules/shop/index.ts`,
`src/modules/genelab/embeds.ts` and `src/modules/genelab/index.ts` relative to this slice's
commits — nothing left broken by any of the break-and-watch steps.

Run all three separately, never chained: `&&` is a parser error in PowerShell 5.1, `npm run build`
does not typecheck `tests/` so `npm run typecheck` is the only gate that reads the new test file,
and each result has to be read on its own.

No `npm run deploy-commands` is owed by this slice: it adds no slash command and no builder
option — confirm with
`grep -n "SlashCommandBuilder\|addStringOption\|addIntegerOption\|addChoices\|setAutocomplete" src/modules/expeditions/index.ts src/modules/shop/index.ts src/modules/genelab/index.ts src/modules/hatchery/index.ts`
and check that nothing in the slice's diff touches one of those lines. No migration, no emoji, no
art.

- [ ] **Step 6: Commit**
```bash
git add src/modules/hatchery/index.ts tests/follow-through-incubate.test.ts
git commit -m "feat(hatchery): offer Incubate after a Mythic egg purchase"
```

---

### Task 29: the follow-through contract test — the free half of the graph

_Stable id: `G8-A`_

This is the only structural defence the feature has. Spec §8 says it plainly: "Nothing stops a
future module minting an egg and forgetting to offer Incubate. The contract test in §6.1 is the
only thing that would catch it." Every row below drives a **real** surface, reads the customIds
back out of the **real** builder JSON, dispatches one of them through the **real** router against
a registry built from the real `ALL_MODULES`, and asserts the effect landed in the database.

**This task runs AFTER every task that mints a control** — it is the second-to-last group in the
plan for exactly that reason. A contract test for behaviour that does not exist yet fails for the
wrong reason.

**This file owns the ONE whole-list assertion.** Per-slice tests in Tasks G4-D, G4-E, G7-A and
G7-D assert only the id each task owns, with `toContain`, because `/expedition claim`'s reply and
`/shop egg`'s reply are each built by two different slices. The full, ordered id list for those
shared payloads is pinned here and nowhere else, through the `exactly` field below, so "a later
slice deleted my button" and "a later slice added a control nobody declared" are a single findable
failure rather than four contradictory ones.

**Files:**
- Create: `tests/follow-through.test.ts`
- Test: `tests/follow-through.test.ts` (the created file is the test)

**Interfaces:**
- Consumes, from earlier tasks in this plan:
  - **Task 9 (G4-B)** — the customId grammar `hatch:inc:<uid>:<eggId>` dispatched by the existing `hatch` component prefix, and `incubateRow(userId: string, eggId: number)` as its only minter. Task 9 (G4-B) **deliberately leaves `makeCtx`'s `config.modules` at `{}`** (`tests/harness.ts:21`), and nothing in this plan changes it — "One fixture per file, never a global", in that task's own words. That is load-bearing here: most rows below drive a CROSS-MODULE mint, each gated on `ctx.config.modules.<name>` — expeditions, the shop and the gene lab each mint a `hatch:` id, and the hatch reveal mints `park:` ids — so against the bare `{}` default every one of those gates would suppress its own control and this whole table would go green while proving nothing. So this file declares its OWN module-flag fixture and every row runs against a ctx built from it. Do NOT change the shared default to fix this: Task 17 (G5-F)'s module-disabled case deliberately uses a bare `makeCtx()` so it can watch its gate SUPPRESS a control, and flipping the default would turn that case green for the wrong reason with nothing failing.
  - **Task 22 (G4-D)** — the `modulesConfig(over?): Config` / `ctxOn(nowMs?)` shape this file's own copy matches, declared there in `tests/follow-through-incubate.test.ts` and reused inside that same file by Tasks G4-E and G4-F. `tests/follow-through-assign.test.ts` carries its own equivalent (Task 11 (G5-A)'s `CONFIG`). Each file declares its own because a test file imports nothing from another test file; this is that same shape copied again, never a competing one. `testRegistry` is unrelated to all of them: it builds its own all-enabled flags map as a separate `ModuleRegistry` argument (`tests/harness.ts:33-34`), so routing is fully enabled whatever `makeCtx`'s config says. The gates read `ctx.config`, never the registry, which is why only a fixture can move them.
  - **Task 8 (G4-A)** — `claimExpedition(ctx, userId): { loot: Loot; site: SiteDef; egg: Egg }`.
  - **Tasks G4-D, G4-E, G4-F, G4-G** — the four Incubate mints: `/expedition claim`'s slash reply, `/shop egg`, `/breed claim` (slash and button), `mythic:confirm`.
  - **Task 12 (G5-B)** — `assignRow(userId, dinoId, eligible)` and its three shapes: `park:assign:<uid>:<dinoId>:<lotId>`, `park:assignpick:<uid>:<dinoId>`, `park:goto:lots:<uid>`; and `assignSelectRow`, minting `park:assignsel:<uid>:<dinoId>` on the SELECT namespace with `String(lotId)` values.
  - **Tasks G5-C, G5-D, G5-E** — the handlers behind those three ids. `park:assign` and `park:assignsel` both write through `assignFollowThrough`, which replies ephemerally `🦕 Assigned to lot #<lotId>.`; `park:goto:lots` replies ephemerally with `lotsTab(fresh, ownLots, false)` **with the tab row stripped**.
  - **Task 17 (G5-F)** — the `hatch:crack` reveal pushes `assignRow(...)` onto `revealPayload`'s empty `components` and sets its own footer.
  - **Task 16 (G6-A)** — `park:builddino:<uid>:<lotId>` (button, park component prefix) minted on BOTH build paths, and `park:builddinosel:<uid>:<lotId>` (string select, park select prefix) whose option values are dino ids. The `park:buildyes` confirm mints its copy as an **ephemeral follow-up** beside `renderTab`'s update, so that surface records two payloads.
  - **Task 18 (G6-B)** — the `care` component prefix and `care:feed:<uid>:<dinoId>`.
  - **Task 19 (G7-A)** — `digAgainRow(userId, siteId)`, minting `exp:again:<uid>:<siteId>`, pushed onto `/expedition claim`'s `payload.components`.
  - **Task 20 (G7-B)** — the restructured `exp` component, whose `claim` arm builds a named `rows` local and pushes **Dig again first, then Incubate**.
  - **Task 23 (G7-D)** — `buyAnotherRow(userId, rarity)`, minting `shop:again:<uid>:<rarity>`, pushed onto `/shop egg`'s `eggPayload.components` **before** Incubate.
- Consumes, already in the repo and verified line by line:
  - `makeCtx(overrides?: Partial<Ctx> & { nowMs?: number }): Ctx & { setNow(ms: number): void; notifications: … }`, `fakeCommand`, `fakeButton`, `fakeSelect`, `replyText(r: unknown): string`, `testRegistry: ModuleRegistry`, `type FakeInteraction` — all `tests/harness.ts`
  - `routeInteraction(ctx, registry, interaction, hooks?): Promise<void>` — `src/core/router.ts`
  - `getOrCreateUser(ctx, userId, displayName): User` and `buildLot(ctx, userId, kind): Lot` — `src/modules/park/service.ts`
  - `startExpedition(ctx, userId, siteId, guildId): Expedition` — `src/modules/expeditions/service.ts`
  - `feedCostFor(rarity, traits, now): number` — `src/modules/care/service.ts`
  - `dailyEggOffers(highWater, now): Rarity[]` — `src/modules/shop/service.ts`
  - `mythicSpeciesChoices(): Species[]` — `src/modules/shop/shards.ts`
  - `MYTHIC_UNLOCK_RATING` — `src/data/progression.ts`; `schema` — `src/core/db/index.ts`
  - `ALL_MODULES: ModuleManifest[]` — `src/core/module-list.ts`; `interface Config { token; clientId; databasePath; ownerId; modules: Record<string, boolean> }` — `src/core/config.ts` (that is the whole interface — re-read it with `grep -n -A 3 "export interface Config" src/core/config.ts`; the fixture below must satisfy whatever it actually requires)
- Produces (Task 30 (G8-B) extends the same file):
  - `function modulesConfig(over?: Record<string, boolean>): Config` and `const ctxOn = (nowMs?: number) => makeCtx({ nowMs, config: modulesConfig() })` — the file-local module-flag fixture, also used by Task 30 (G8-B)
  - `const GRAPH: GraphRow[]`, `interface GraphRow { surface: string; run(ctx: TestCtx): Promise<Step> }`
  - `interface Step { payload: unknown; required: string[]; exactly?: string[]; forbiddenPrefixes?: string[]; follow: string; effect(followed: FakeInteraction): Promise<void> }`
  - `type TestCtx = ReturnType<typeof makeCtx>`; `interface Rendered { custom_id: string; type?: number; options?: Array<{ value: string }> }`
  - `const OWNER = 'u1'`, `const DAY_MS = 86_400_000`, `const DAY0 = 5_000 * DAY_MS`
  - `function controlsOf(payload: unknown, label: string): Rendered[]`
  - `function expectDispatched(f: FakeInteraction, label: string): void`
  - `async function clickSurface(ctx: TestCtx, customId: string, label: string): Promise<FakeInteraction>`
  - `async function submitFirstOptionOfTheOnlyMenu(ctx: TestCtx, payload: unknown, label: string, expectedId?: string): Promise<string>`
  - `function seedOwner(ctx: TestCtx): void`
  - `const eggsOf(ctx)`, `dinosOf(ctx)`, `eggRow(ctx, id)`, `dinoRow(ctx, id)`; `function onlyEgg(ctx)`, `function onlyDino(ctx)`, `function hatchReadyEgg(ctx)`
  - Task 29 does **not** define `cashOf`; that is Task 30 (G8-B)'s.

---

- [ ] **Step 1: Write the file — helpers, the driver, and the first row**

Create `tests/follow-through.test.ts` with exactly this content:

```typescript
import { describe, it, expect } from 'vitest';
import { ComponentType } from 'discord.js';
import { eq } from 'drizzle-orm';
import {
  makeCtx, fakeCommand, fakeButton, fakeSelect, replyText, testRegistry,
  type FakeInteraction,
} from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { startExpedition } from '../src/modules/expeditions/service.js';
import { feedCostFor } from '../src/modules/care/service.js';
import { dailyEggOffers } from '../src/modules/shop/service.js';
import { mythicSpeciesChoices } from '../src/modules/shop/shards.js';
import { MYTHIC_UNLOCK_RATING } from '../src/data/progression.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';

// ---------------------------------------------------------------------------
// The follow-through graph (docs/superpowers/specs/2026-08-31-follow-through-design.md §3).
//
// Every surface that hands a player a new object offers the next step on it as a
// control on the same message. The graph is a CONVENTION — per-module minting on
// each module's own existing prefix — so nothing structural holds it together, and
// this table is the whole defence. A future surface that mints an egg and never
// offers Incubate compiles, typechecks, and passes every other test in the suite.
//
// Each row does three things, in this order, and all three matter:
//   1. drives the REAL surface (a command or a button, through routeInteraction),
//   2. reads the minted customIds out of the REAL builder JSON — never hand-typed,
//      which would prove only that two strings someone wrote match each other,
//   3. dispatches one of those ids back through routeInteraction against
//      `testRegistry` (built from the real ALL_MODULES) and asserts the DB effect.
//
// Step 3 is why this file exists rather than a set of `comp.execute` calls.
// `ModuleRegistry.findComponent` resolves a handler by `customId.split(':')[0]`
// alone (src/core/modules.ts), so a component registered under a two-segment
// prefix matches nothing, is never acknowledged, and ships dead — the
// `/admin ledger` pager was written that way. Only a ROUTED test sees it
// (§routed-test-per-component).
//
// The `exactly` field below is the ONE whole-list assertion in the plan. Per-slice
// tests use toContain for the id their own task owns, because /expedition claim's
// reply and /shop egg's reply are each built by two different slices pushing onto
// one array. The full ordered list lives here so a deletion AND an undeclared
// addition are each a single findable failure.
// ---------------------------------------------------------------------------

type TestCtx = ReturnType<typeof makeCtx>;

const OWNER = 'u1';
// src/core/world.ts keeps its own day constant module-private, so it is restated here.
const DAY_MS = 86_400_000;
// Day 5,000 of the epoch. Nothing in this file hard-codes a price or a fee off that
// choice: every row that cares derives its number from the same function production
// calls. What the day DOES buy is a calm world event, which keeps the fixtures legible.
// Re-derive it with:
//   npx tsx -e "import {worldEventFor} from './src/core/world.ts'; console.log(worldEventFor(5000*86400000).id)"
const DAY0 = 5_000 * DAY_MS;

/**
 * The module flags every row runs against. `makeCtx` leaves `config.modules` as `{}`
 * (tests/harness.ts:21) and nothing in this plan changes that, so each test file that needs flags
 * declares its own copy — tests/follow-through-incubate.test.ts and
 * tests/follow-through-assign.test.ts each carry one already, and a test file imports nothing from
 * another test file. Same shape as theirs, copied rather than shared — not a second shape.
 *
 * It is load-bearing here, not decoration. Most rows below drive a CROSS-MODULE mint: expeditions,
 * the shop and the gene lab each mint a `hatch:` id, and the hatch reveal mints `park:` ids, so
 * each is gated on `ctx.config.modules.<name>` — ModuleRegistry resolves a component handler only
 * among ENABLED modules (src/core/modules.ts), so a control whose handler's module is off is a
 * button nothing answers at all. Left at the `{}` default, every one of those gates would suppress
 * its own control and this entire table would pass while asserting nothing — the exact vacuous
 * green this file exists to prevent.
 *
 * Derived from ALL_MODULES rather than a hand-written list of names, unlike the sibling files,
 * which each name only the modules their own cases touch: this table drives every module that
 * mints anything, so a name left out of a literal list would silently re-open that vacuous pass on
 * one row while the rest of the table stayed green.
 *
 * `testRegistry` is NOT affected by this and does not need to be: it builds its own all-enabled
 * flags map as a separate ModuleRegistry argument (tests/harness.ts:33-34), so routing is fully
 * enabled either way. The gates read ctx.config, so only a fixture can move them.
 *
 * No row here asserts the DISABLED shape — those cases belong to the per-slice files that own each
 * gate (Tasks G4-D, G4-E, G4-F, G5-F). `over` is kept so a row that ever needs one has the same
 * handle those files use, and such a row would build its own ctx rather than change ctxOn.
 */
function modulesConfig(over: Record<string, boolean> = {}): Config {
  return {
    token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner',
    modules: { ...Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])), ...over },
  };
}
// makeCtx spreads `...overrides` last, so a passed `config` replaces the default outright.
const ctxOn = (nowMs = 0) => makeCtx({ nowMs, config: modulesConfig() });

interface Rendered { custom_id: string; type?: number; options?: Array<{ value: string }> }

/**
 * The customIds a recorded reply actually carries. `.toJSON()` turns an
 * ActionRowBuilder into Discord's own wire shape, where the field is snake_case
 * `custom_id` — the camelCase form only exists on the fake interaction object.
 */
function controlsOf(payload: unknown, label: string): Rendered[] {
  const rows = (payload as { components?: unknown[] } | undefined)?.components ?? [];
  return rows.flatMap((row) => {
    const toJSON = (row as { toJSON?: () => unknown }).toJSON;
    expect(typeof toJSON, `${label}: a component row that is not an ActionRowBuilder`).toBe('function');
    const json = (row as { toJSON(): { components?: Rendered[] } }).toJSON();
    return (json.components ?? []).filter((c) => typeof c.custom_id === 'string');
  });
}

/**
 * The click reached its handler AND the handler answered it.
 *
 * The first assertion is the load-bearing one and must stay first. When
 * `registry.findComponent(customId)` returns undefined — the exact defect
 * §routed-test-per-component exists for — routeInteraction falls through in
 * COMPLETE SILENCE: `if (comp)` has no else (src/core/router.ts:113), so there is
 * no reply, no deferUpdate, nothing. Both of the other two assertions pass
 * vacuously against empty arrays, so without this first one the helper proves
 * nothing at all about the failure mode this whole file exists to catch.
 *
 * The second distinguishes a real dispatch from the router's own guard, which
 * rejects with `deferUpdate()` and nothing else. It also holds these handlers to
 * replying or updating rather than deferring: every follow-through action is
 * synchronous DB work with nothing to wait on, so a defer here is a mistake, not
 * a style choice.
 *
 * The third catches the router's outer catch swallowing a handler throw and
 * answering with one fixed sentence (src/core/router.ts:168).
 */
function expectDispatched(f: FakeInteraction, label: string): void {
  expect(f.replies.length + f.deferOpts.length,
    `${label}: nothing answered the click at all — no handler resolved for this prefix`)
    .toBeGreaterThan(0);
  expect(f.deferOpts, `${label}: the router acknowledged the click instead of dispatching it`)
    .toHaveLength(0);
  for (const r of f.replies) {
    expect(replyText(r), `${label}: the handler threw and the router's catch swallowed it`)
      .not.toContain('Something went wrong');
  }
}

/** Click a control that IS the surface (a button whose reply carries the next step). */
async function clickSurface(ctx: TestCtx, customId: string, label: string): Promise<FakeInteraction> {
  const b = fakeButton({ customId, user: OWNER, componentIds: [customId] });
  await routeInteraction(ctx, testRegistry, b.asInteraction());
  expectDispatched(b, label);
  return b;
}

/**
 * Submits the first option of the one select menu a reply opened, and RETURNS the
 * value it submitted so the caller can assert the handler acted on that value and
 * not on some other option it happened to find. Values are read off the real
 * payload rather than hardcoded, so the second hop stays independent of how the
 * minting module spells them.
 */
async function submitFirstOptionOfTheOnlyMenu(
  ctx: TestCtx, payload: unknown, label: string, expectedId?: string,
): Promise<string> {
  const menus = controlsOf(payload, label).filter((c) => c.type === ComponentType.StringSelect);
  expect(menus, `${label} opened no select menu, or opened more than one`).toHaveLength(1);
  const menu = menus[0]!;
  if (expectedId !== undefined) expect(menu.custom_id, `${label} opened the wrong menu`).toBe(expectedId);
  const values = (menu.options ?? []).map((o) => o.value);
  expect(values.length, `${label}: ${menu.custom_id} offered no options`).toBeGreaterThan(0);
  const picked = values[0]!;
  const submit = fakeSelect({
    customId: menu.custom_id, user: OWNER,
    values: [picked], options: values, componentIds: [menu.custom_id],
  });
  await routeInteraction(ctx, testRegistry, submit.asInteraction());
  expectDispatched(submit, `${label} → ${menu.custom_id}`);
  return picked;
}

function seedOwner(ctx: TestCtx): void {
  getOrCreateUser(ctx, OWNER, 'One');
  // One pot every fixture below spends from, rather than each computing its own
  // affordability. The shard grant is exactly MYTHIC_SHARD_COST (src/data/sell.ts),
  // and the fern stack covers many meals of the tier-1 herbivore food.
  ctx.economy.apply(OWNER, { cash: 10_000_000, shards: 500, foods: { ferns: 40 } }, 'seed', ctx.now());
}

const eggsOf = (ctx: TestCtx) =>
  ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, OWNER)).all();
const dinosOf = (ctx: TestCtx) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, OWNER)).all();
const eggRow = (ctx: TestCtx, id: number) =>
  ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, id)).get()!;
const dinoRow = (ctx: TestCtx, id: number) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;

function onlyEgg(ctx: TestCtx) {
  const eggs = eggsOf(ctx);
  expect(eggs, 'the fixture expected the surface to hand over exactly one egg').toHaveLength(1);
  return eggs[0]!;
}

function onlyDino(ctx: TestCtx) {
  const dinos = dinosOf(ctx);
  expect(dinos, 'the fixture expected exactly one dino').toHaveLength(1);
  return dinos[0]!;
}

/**
 * An egg that /hatch's crack button will hatch immediately. hatchEgg refuses only on
 * `incubationStartedAt === null`, `hatchesAt === null` and `hatchesAt > now`
 * (src/modules/hatchery/service.ts), so stamping both columns in the past is a
 * legitimate fixture. speciesId is pinned so the hatched species — and therefore its
 * DIET, which decides which paddocks are eligible below — is not an rng roll.
 * Triceratops is a common herbivore.
 */
function hatchReadyEgg(ctx: TestCtx) {
  return ctx.db.insert(schema.eggs).values({
    userId: OWNER, rarity: 'common', speciesId: 'triceratops', source: 'shop',
    obtainedAt: DAY0 - 1, incubationStartedAt: DAY0 - 1, hatchesAt: DAY0 - 1,
  }).returning().get();
}

interface Step {
  /** The payload the surface rendered — what `required` and `exactly` are checked against. */
  payload: unknown;
  /** Every customId that payload MUST carry. */
  required: string[];
  /**
   * The WHOLE minted list, in order — the plan's single whole-list assertion.
   * Declared here, on the record each row's run() returns, rather than on GraphRow,
   * because the ids embed row ids the database allocates at runtime.
   */
  exactly?: string[];
  /** No minted id may start with any of these. */
  forbiddenPrefixes?: string[];
  /** The one id this row dispatches back through the router. */
  follow: string;
  /** Asserted after `follow` has routed. Receives the click that routed it. */
  effect(followed: FakeInteraction): Promise<void>;
}

interface GraphRow { surface: string; run(ctx: TestCtx): Promise<Step> }

/** Every Incubate row asserts the same thing about the egg it was minted for. */
const startedIncubating = (ctx: TestCtx, eggId: number) => async () => {
  expect(eggRow(ctx, eggId).incubationStartedAt,
    'the Incubate button did not start the egg incubating').not.toBeNull();
};

const GRAPH: GraphRow[] = [
  {
    surface: '/expedition claim',
    async run(ctx) {
      seedOwner(ctx);
      const exp = startExpedition(ctx, OWNER, 'coastal_dig', null);
      // returnsAt is read off the committed row, never recomputed: startExpedition
      // captures the world event's duration multiplier at start.
      ctx.setNow(exp.returnsAt);
      const cmd = fakeCommand({ name: 'expedition', sub: 'claim', user: OWNER });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      const egg = onlyEgg(ctx);
      return {
        payload: cmd.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`, `exp:again:${OWNER}:coastal_dig`],
        // Dig again first, then Incubate — Task 19 (G7-A) pushes onto the array, Task 22 (G4-D)
        // pushes after it. This is the only place that order is pinned.
        exactly: [`exp:again:${OWNER}:coastal_dig`, `hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
];

describe('the follow-through graph', () => {
  for (const row of GRAPH) {
    it(`${row.surface} offers its next step, and that step routes`, async () => {
      // ctxOn, never a bare makeCtx: every cross-module control below is gated on
      // ctx.config.modules, and the harness default of {} would suppress them all silently.
      const ctx = ctxOn(DAY0);
      const step = await row.run(ctx);
      expect(step.payload, `${row.surface} recorded no reply at all`).toBeDefined();
      const minted = controlsOf(step.payload, row.surface).map((c) => c.custom_id);
      for (const id of step.required) {
        expect(minted, `${row.surface} minted ${JSON.stringify(minted)} and is missing ${id}`)
          .toContain(id);
      }
      if (step.exactly) {
        // A fixture self-check first, so a row cannot declare a `required` id its own
        // `exactly` list contradicts — that would make the two assertions below
        // unsatisfiable and the row impossible to read.
        for (const id of step.required) {
          expect(step.exactly, `${row.surface} requires ${id}, which its own exact list omits`)
            .toContain(id);
        }
        expect(minted,
          `${row.surface} minted a control list this table does not describe — a new control needs a row here, and a deleted one needs its owner back`)
          .toEqual(step.exactly);
      }
      for (const prefix of step.forbiddenPrefixes ?? []) {
        expect(minted.filter((id) => id.startsWith(prefix)),
          `${row.surface} minted a ${prefix}… control it must not offer in this state`).toEqual([]);
      }
      expect(step.required, 'this row dispatches an id it never required').toContain(step.follow);
      const click = fakeButton({ customId: step.follow, user: OWNER, componentIds: minted });
      await routeInteraction(ctx, testRegistry, click.asInteraction());
      expectDispatched(click, `${row.surface} → ${step.follow}`);
      await step.effect(click);
    });
  }
});
```

- [ ] **Step 2: Run the one row and watch it pass**

Run: `npx vitest run tests/follow-through.test.ts`

Expected: PASS, one test per row in `GRAPH` — at this point exactly the `/expedition claim` row.

If instead it fails with `/expedition claim minted [] and is missing hatch:inc:u1:1`, the tasks
that mint that reply's buttons have not landed. Stop and finish Tasks G7-A and G4-D first — do
not weaken this assertion. If it fails on the `exactly` line with the two ids in the other order,
one of those two tasks assigned the array instead of pushing onto it.

- [ ] **Step 3: Add the five remaining Incubate rows**

Insert these five objects into `GRAPH`, after the `/expedition claim` row and before the closing
`];`:

```typescript
  {
    surface: 'the exp:claim button',
    async run(ctx) {
      seedOwner(ctx);
      const exp = startExpedition(ctx, OWNER, 'coastal_dig', null);
      ctx.setNow(exp.returnsAt);
      const b = await clickSurface(ctx, `exp:claim:${OWNER}`, 'the exp:claim button');
      const egg = onlyEgg(ctx);
      return {
        payload: b.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`, `exp:again:${OWNER}:coastal_dig`],
        exactly: [`exp:again:${OWNER}:coastal_dig`, `hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: '/shop egg',
    async run(ctx) {
      seedOwner(ctx);
      // The rotation gate runs before buyEgg and reads ratingHighWater, which is 0 for a
      // fresh user. Asserted rather than assumed, because which rarities are on offer is a
      // function of the day and would otherwise fail this row while blaming the shop reply.
      expect(dailyEggOffers(0, ctx.now()),
        'the fixture assumes common is in the rotation at high-water 0').toContain('common');
      const cmd = fakeCommand({ name: 'shop', sub: 'egg', user: OWNER, options: { rarity: 'common' } });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      const egg = onlyEgg(ctx);
      return {
        payload: cmd.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`, `shop:again:${OWNER}:common`],
        // Buy another first, then Incubate — Task 23 (G7-D) pushes, Task 26 (G4-E) pushes after it.
        exactly: [`shop:again:${OWNER}:common`, `hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: '/breed claim',
    async run(ctx) {
      seedOwner(ctx);
      // breedings.parentA/parentB deliberately carry no foreign key, and claimBreeding reads
      // both parents tolerantly (`a?.traits ?? []`), so a row inserted straight into the
      // table is a legitimate fixture — far cheaper than a Gene Lab, two fed same-rarity
      // parents in paddocks, and a real pairing. claimBreeding refuses only on a missing
      // row, an already-claimed row, and `readyAt > now`.
      ctx.db.insert(schema.breedings).values({
        userId: OWNER, parentA: 1, parentB: 2, rarity: 'common',
        startedAt: DAY0 - 1_000, readyAt: DAY0 - 1,
      }).run();
      const cmd = fakeCommand({ name: 'breed', sub: 'claim', user: OWNER });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      const egg = onlyEgg(ctx);
      return {
        payload: cmd.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`],
        exactly: [`hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: 'the breed:claim button',
    async run(ctx) {
      seedOwner(ctx);
      const breeding = ctx.db.insert(schema.breedings).values({
        userId: OWNER, parentA: 1, parentB: 2, rarity: 'common',
        startedAt: DAY0 - 1_000, readyAt: DAY0 - 1,
      }).returning().get();
      const b = await clickSurface(ctx, `breed:claim:${breeding.id}`, 'the breed:claim button');
      const egg = onlyEgg(ctx);
      return {
        payload: b.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`],
        exactly: [`hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: 'the mythic:confirm button',
    async run(ctx) {
      seedOwner(ctx);
      // The gate reads ratingHighWater, which is monotone, so writing it directly is the
      // honest fixture — a live parkRating would decay back under the gate.
      ctx.db.update(schema.users).set({ ratingHighWater: MYTHIC_UNLOCK_RATING })
        .where(eq(schema.users.discordId, OWNER)).run();
      // Derived, never a species id typed in here: the roster is data and this row has no
      // opinion about which mythic exists.
      const speciesId = mythicSpeciesChoices()[0]!.id;
      const b = await clickSurface(ctx, `mythic:confirm:${speciesId}`, 'the mythic:confirm button');
      const egg = onlyEgg(ctx);
      return {
        payload: b.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`],
        exactly: [`hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
```

- [ ] **Step 4: Run the six Incubate rows and watch them pass**

Run: `npx vitest run tests/follow-through.test.ts`

Expected: PASS, one test per row in `GRAPH`.

- [ ] **Step 5: Add the three hatch-reveal rows**

Insert these three objects into `GRAPH`, after the `mythic:confirm` row and before the closing
`];`:

```typescript
  {
    surface: 'the hatch reveal, with exactly one eligible paddock',
    async run(ctx) {
      seedOwner(ctx);
      const lot = buildLot(ctx, OWNER, 'herbivore_paddock');
      const egg = hatchReadyEgg(ctx);
      const b = await clickSurface(ctx, `hatch:crack:${egg.id}`, 'the hatch reveal');
      const dino = onlyDino(ctx);
      return {
        payload: b.replies[0],
        required: [`park:assign:${OWNER}:${dino.id}:${lot.id}`],
        exactly: [`park:assign:${OWNER}:${dino.id}:${lot.id}`],
        follow: `park:assign:${OWNER}:${dino.id}:${lot.id}`,
        async effect() {
          expect(dinoRow(ctx, dino.id).lotId,
            'the Assign button did not put the dino in the paddock it named').toBe(lot.id);
        },
      };
    },
  },
  {
    surface: 'the hatch reveal, with several eligible paddocks',
    async run(ctx) {
      seedOwner(ctx);
      // Paddocks are duplicable by design; facilities are one per park.
      const first = buildLot(ctx, OWNER, 'herbivore_paddock');
      const second = buildLot(ctx, OWNER, 'herbivore_paddock');
      const egg = hatchReadyEgg(ctx);
      const b = await clickSurface(ctx, `hatch:crack:${egg.id}`, 'the hatch reveal');
      const dino = onlyDino(ctx);
      return {
        payload: b.replies[0],
        required: [`park:assignpick:${OWNER}:${dino.id}`],
        exactly: [`park:assignpick:${OWNER}:${dino.id}`],
        follow: `park:assignpick:${OWNER}:${dino.id}`,
        async effect(followed) {
          const picked = await submitFirstOptionOfTheOnlyMenu(
            ctx, followed.replies[0], 'the assign picker', `park:assignsel:${OWNER}:${dino.id}`);
          // Against the SUBMITTED value, not merely against the eligible set. The router's
          // submittedValuesAreOnMessage proves only that the value was OFFERED; a handler
          // that ignored i.values entirely and assigned to whichever eligible paddock it
          // found first would satisfy a membership check — and picking the right one is the
          // only thing a select adds over a button.
          //
          // A value here is a LOT id. The /build picker below is this menu's mirror and its
          // values are DINO ids; the two are easy to confuse and swapping them compiles.
          expect(dinoRow(ctx, dino.id).lotId,
            'the assign menu did not use the option that was actually submitted')
            .toBe(Number(picked));
          expect([first.id, second.id],
            'the assign menu submitted a lot that was never eligible').toContain(Number(picked));
        },
      };
    },
  },
  {
    surface: 'the hatch reveal, with no eligible paddock',
    async run(ctx) {
      seedOwner(ctx);
      // A carnivore paddock, against a herbivore hatch: this proves the DIET filter, where
      // building nothing at all would only prove the empty case.
      buildLot(ctx, OWNER, 'carnivore_paddock');
      const egg = hatchReadyEgg(ctx);
      const b = await clickSurface(ctx, `hatch:crack:${egg.id}`, 'the hatch reveal');
      onlyDino(ctx);
      return {
        payload: b.replies[0],
        // 'park:assign' is the prefix of park:assign, park:assignpick and park:assignsel
        // alike, so one entry forbids every assign shape.
        forbiddenPrefixes: ['park:assign'],
        // park:goto, never park:tab — the hatch reveal is a PUBLIC message and park:tab's
        // handler ends in renderTab's `i.update`, which would destroy the reveal and leave
        // the owner's Lots card in a public channel. park:goto replies EPHEMERALLY, which
        // is what the landmark/guests/roster targets beside it already do, for that reason.
        // Note the owner id sits at parts index 3 in a goto id, not index 2.
        required: [`park:goto:lots:${OWNER}`],
        exactly: [`park:goto:lots:${OWNER}`],
        follow: `park:goto:lots:${OWNER}`,
        async effect(followed) {
          const ids = controlsOf(followed.replies[0], 'the Lots card').map((c) => c.custom_id);
          // The Build select, not merely a reply: this pins that the goto arm hands back a
          // real Lots payload with `buildable` computed, rather than an empty card the
          // player cannot act on.
          expect(ids, 'Build a paddock did not open a Lots card carrying the Build menu')
            .toContain(`park:build:${OWNER}`);
          // lotsPayload appends a tab row on EVERY call, unlike its landmark/guests/roster
          // neighbours, so Task 15 (G5-E) strips it here. Owned by this table too, and not only
          // by that task's own file: without the strip, one tab click on this ephemeral
          // hands the player a second, parallel park dashboard.
          expect(ids.filter((id) => id.startsWith(`park:tab:${OWNER}:`)),
            'the Build a paddock ephemeral grew a tab row and became a second park dashboard')
            .toEqual([]);
        },
      };
    },
  },
```

- [ ] **Step 6: Run the file and watch the hatch rows pass**

Run: `npx vitest run tests/follow-through.test.ts`

Expected: PASS, one test per row in `GRAPH`.

- [ ] **Step 7: Add the two build rows and the rescue row**

Insert these three objects into `GRAPH`, after the no-eligible-paddock row and before the closing
`];`:

```typescript
  {
    surface: '/build, when the built lot is a paddock',
    async run(ctx) {
      seedOwner(ctx);
      const dino = ctx.db.insert(schema.dinos).values({
        userId: OWNER, lotId: null, speciesId: 'triceratops',
        hunger: 100, lastFedAt: DAY0, hatchedAt: DAY0,
      }).returning().get();
      const cmd = fakeCommand({ name: 'build', user: OWNER, options: { kind: 'herbivore_paddock' } });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, OWNER)).all();
      expect(lots, '/build did not build exactly one lot').toHaveLength(1);
      const lot = lots[0]!;
      return {
        payload: cmd.replies[0],
        required: [`park:builddino:${OWNER}:${lot.id}`],
        exactly: [`park:builddino:${OWNER}:${lot.id}`],
        follow: `park:builddino:${OWNER}:${lot.id}`,
        async effect(followed) {
          const picked = await submitFirstOptionOfTheOnlyMenu(
            ctx, followed.replies[0], 'the Assign a dino picker',
            `park:builddinosel:${OWNER}:${lot.id}`);
          // This menu runs the assign machinery backwards: the LOT is fixed by the customId
          // and the values are the player's unassigned diet-matching dinos, so a value here
          // is a DINO id. Pinned, because the minting task and this row would otherwise be
          // free to disagree about it silently, and a swap compiles cleanly.
          expect(picked, 'the Assign a dino menu offered a value that is not a dino id')
            .toBe(String(dino.id));
          expect(dinoRow(ctx, dino.id).lotId,
            'the Assign a dino menu did not put the dino in the lot just built').toBe(lot.id);
        },
      };
    },
  },
  {
    surface: 'the park:buildyes confirm',
    async run(ctx) {
      seedOwner(ctx);
      ctx.db.insert(schema.dinos).values({
        userId: OWNER, lotId: null, speciesId: 'triceratops',
        hunger: 100, lastFedAt: DAY0, hatchedAt: DAY0,
      }).run();
      // The Lots tab's Build… dropdown is the path /park view actively pushes players
      // toward, and it reaches buildLot through this confirm rather than through /build.
      // The trailing :0 is the lot-count anchor the handler re-reads before it builds; the
      // player owns no lots, so the id is not stale.
      const b = await clickSurface(ctx, `park:buildyes:${OWNER}:herbivore_paddock:0`,
        'the park:buildyes confirm');
      const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, OWNER)).all();
      expect(lots, 'the confirm did not build exactly one lot').toHaveLength(1);
      const lot = lots[0]!;
      // Two payloads: renderTab's i.update of the Lots tab, then the ephemeral follow-up.
      // The control cannot ride on the tab — renderTab builds AND sends that whole payload.
      expect(b.replies, 'the confirm sent no follow-up beside the Lots tab').toHaveLength(2);
      return {
        payload: b.replies[1],
        required: [`park:builddino:${OWNER}:${lot.id}`],
        exactly: [`park:builddino:${OWNER}:${lot.id}`],
        follow: `park:builddino:${OWNER}:${lot.id}`,
        async effect(followed) {
          const ids = controlsOf(followed.replies[0], 'the Assign a dino picker')
            .map((c) => c.custom_id);
          expect(ids, 'the confirm path minted an Assign button that opens no menu')
            .toContain(`park:builddinosel:${OWNER}:${lot.id}`);
        },
      };
    },
  },
  {
    surface: '/rescue',
    async run(ctx) {
      seedOwner(ctx);
      const lot = buildLot(ctx, OWNER, 'herbivore_paddock');
      const dino = ctx.db.insert(schema.dinos).values({
        userId: OWNER, lotId: lot.id, speciesId: 'triceratops',
        hunger: 0, lastFedAt: DAY0 - 1, hatchedAt: DAY0 - 1, escapedAt: DAY0 - 1,
      }).returning().get();
      const cmd = fakeCommand({ name: 'rescue', user: OWNER, options: { dino: dino.id } });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      // The dino MUST be in a matching paddock: rescueDino sets hunger to
      // round(50 / paddockFit), and the lotId-less fallback fit of 0.5 would put it back at
      // 100 — full — so the Feed it click would legitimately spend nothing and this row
      // would assert against a no-op. A herbivore in an undecorated herbivore paddock is
      // fit 0.75, so it comes back hungry.
      const fernsBefore = ctx.economy.getFoodInventory(OWNER).ferns ?? 0;
      return {
        payload: cmd.replies[0],
        required: [`care:feed:${OWNER}:${dino.id}`],
        exactly: [`care:feed:${OWNER}:${dino.id}`],
        follow: `care:feed:${OWNER}:${dino.id}`,
        async effect() {
          // Ferns is the tier-1 herbivore food and the pantry holds far more than one meal,
          // so feedDino's auto-pick lands on it. Feeding is a food spend, never cash, which
          // is why this button takes effect on the first click.
          const spent = fernsBefore - (ctx.economy.getFoodInventory(OWNER).ferns ?? 0);
          expect(spent, 'the Feed it button did not consume one meal of Ferns')
            .toBe(feedCostFor('common', [], ctx.now()));
        },
      };
    },
  },
```

- [ ] **Step 8: Run the whole table and watch it pass**

Run: `npx vitest run tests/follow-through.test.ts`

Expected: PASS. The run's test count equals `GRAPH.length` — derive the row list with
`grep -n "surface: '" tests/follow-through.test.ts`.

- [ ] **Step 9: GUARD — break one mint, watch that one row fail, restore**

A table nobody has watched fail is not yet a table.

In `src/modules/shop/index.ts`, in the `sub === 'egg'` branch, comment out the line
`if (ctx.config.modules.hatchery) eggPayload.components.push(incubateRow(i.user.id, egg.id));`
(leave the `buyAnotherRow` push above it alone).

Run: `npx vitest run tests/follow-through.test.ts -t "/shop egg"`

Expected: FAIL, exactly one test, with
`/shop egg minted ["shop:again:u1:common"] and is missing hatch:inc:u1:1`.

Restore the line and re-run the same command. Expected: PASS.

- [ ] **Step 10: GUARD — add an undeclared control, watch ONLY the `exactly` assertion fail, restore**

Step 9 proves the table catches a DELETED control — but `required`'s `toContain` catches that on
its own, so nothing yet proves `exactly` earns its place. The failure only `exactly` can see is a
control nobody declared.

In `src/modules/shop/index.ts`, directly after the `incubateRow` push restored in Step 9, add:

```typescript
            eggPayload.components.push(incubateRow(i.user.id, egg.id + 1));
```

Run: `npx vitest run tests/follow-through.test.ts -t "/shop egg"`

Expected: FAIL, exactly one test, on the `exactly` assertion:
`/shop egg minted a control list this table does not describe — a new control needs a row here, and a deleted one needs its owner back`, with
`expected [ 'shop:again:u1:common', 'hatch:inc:u1:1', 'hatch:inc:u1:2' ] to deeply equal [ 'shop:again:u1:common', 'hatch:inc:u1:1' ]`.
Both `required` assertions pass on the way there — that is the point of the step.

Delete the added line and re-run the same command. Expected: PASS.

- [ ] **Step 11: GUARD — break the ROUTING, watch every hatch row fail, restore**

This is the defect `§routed-test-per-component` exists for, and it is invisible to a test that
calls `comp.execute` directly. It is also what the first assertion in `expectDispatched` is for:
`routeInteraction` has no `else` on `if (comp)`, so an unresolvable prefix produces no reply, no
`deferUpdate`, and no error — the click is answered by nothing at all.

In `src/modules/hatchery/index.ts`, change the component entry
`{ prefix: 'hatch', async execute(ctx, i) {` to
`{ prefix: 'hatch:inc', async execute(ctx, i) {`.

Run: `npx vitest run tests/follow-through.test.ts`

Expected: FAIL. Exactly the rows that touch a `hatch:` id fail, and they fail in two distinct
places — both with the same message, `nothing answered the click at all — no handler resolved for
this prefix`, because `findComponent` splits on `:` and takes only `hatch`:

- **At the follow**, labelled `<surface> → hatch:inc:u1:<id>`: `/expedition claim`, `the exp:claim
  button`, `/shop egg`, `/breed claim`, `the breed:claim button`, `the mythic:confirm button`.
  The `mythic` prefix is a separate registry entry and still resolves, so that row's own surface
  click is unaffected — only its Incubate follow dies.
- **Inside `run()`**, labelled `the hatch reveal`: the three hatch-reveal rows. Their own
  `hatch:crack` click no longer resolves either, so `clickSurface` fails before any dino exists.

`/build`, `the park:buildyes confirm` and `/rescue` touch no `hatch:` id and still pass.

Change it back to `{ prefix: 'hatch', async execute(ctx, i) {` and re-run.
Expected: PASS, the whole file.

- [ ] **Step 12: Typecheck**

Run: `npm run typecheck`

Expected: exit 0, no output. `npm run build` compiles only `src` (`tsconfig.json` `include`s
`src` alone) and vitest transpiles without typechecking, so this is the only gate that reads this
file.

- [ ] **Step 13: Commit**

```bash
git add tests/follow-through.test.ts
git commit -m "test(follow-through): pin the follow-through graph with a routed contract test"
```

---

---

### Task 30: the spend half — the two-step confirms and the price recheck

_Stable id: `G8-B`_

Spec §4.4 bakes the quoted price into the confirm button's customId and refuses when it has
moved. Spec §6.2 is emphatic about how to test that: "The price test **must move the clock across
a UTC rollover, or flip the world event, so that `eventMods` genuinely returns a different fee**.
Passing a hand-written wrong price into the customId would prove the equality operator works and
nothing whatsoever about staleness."

**Files:**
- Modify: `tests/follow-through.test.ts` — three edits, all anchored on quoted text: the import block Task 29 (G8-A) wrote, the region immediately after `hatchReadyEgg`'s closing `}`, and the `GRAPH` array's closing `];`. Then append one new `describe` at the end of the file.

**Interfaces:**
- Consumes, from Task 29 (G8-A): `GRAPH`, `Step`, `GraphRow`, `TestCtx`, `OWNER`, `DAY_MS`, `seedOwner`, `controlsOf`, `expectDispatched`, `clickSurface`, `eggsOf`, and the module-flag fixture `modulesConfig` / `ctxOn` — the two tests in Step 5 build their ctx with `ctxOn` like every row does, rather than a bare `makeCtx`, so the file has one way of building a ctx and a later gate on either confirm card cannot quietly hollow them out.
- Consumes, from earlier tasks in this plan:
  - **Task 20 (G7-B)** — the `exp:again:<uid>:<siteId>` arm, which quotes `expeditionFeeFor(site.cost, eventMods(now).expeditionFee)` and mints `exp:againyes:<uid>:<siteId>:<price>` on an EPHEMERAL card.
  - **Task 21 (G7-C)** — the `exp:againyes` arm, which recomputes that same expression and refuses on mismatch before `startExpedition`.
  - **Task 24 (G7-E)** — the `shop` component prefix and the `shop:again:<uid>:<rarity>` arm, which rechecks `dailyEggOffers(user.ratingHighWater, now)` before pricing and mints `shop:againyes:<uid>:<rarity>:<price>`.
  - **Task 25 (G7-F)** — the `shop:againyes` arm, which rechecks the rotation and then the price.
- Consumes, already in the repo:
  - `expeditionFeeFor(cost: number, feeMult: number): number` and `activeExpedition(ctx, userId): Expedition | undefined` — `src/modules/expeditions/service.ts`
  - `eggPriceAt(rarity: Rarity, now: number): number` — `src/modules/shop/service.ts`
  - `eventMods(now: number): EventMods` — `src/core/world.ts`
  - `EXPEDITION_SITES: Record<string, SiteDef>` — `src/data/sites.ts`; `type Rarity` — `src/data/types.ts`
- Produces: `const cashOf(ctx: TestCtx): number`, `function daysWhereExpeditionFeeMoves(): { before: number; after: number }`, `function daysWhereEggPriceMoves(rarity: Rarity): { before: number; after: number }`, and two more `GRAPH` rows.

---

- [ ] **Step 1: Add the imports and the three new helpers**

In `tests/follow-through.test.ts`, replace the line

```typescript
import { startExpedition } from '../src/modules/expeditions/service.js';
```

with

```typescript
import { startExpedition, activeExpedition, expeditionFeeFor } from '../src/modules/expeditions/service.js';
```

and replace the line

```typescript
import { dailyEggOffers } from '../src/modules/shop/service.js';
```

with

```typescript
import { dailyEggOffers, eggPriceAt } from '../src/modules/shop/service.js';
import { eventMods } from '../src/core/world.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';
import type { Rarity } from '../src/data/types.js';
```

(both are replacements, not additions — do not leave two import statements for one module).

Then, immediately after the `hatchReadyEgg` function's closing `}`, add:

```typescript
const cashOf = (ctx: TestCtx) =>
  ctx.db.select().from(schema.users).where(eq(schema.users.discordId, OWNER)).get()!.cash;

/**
 * The first pair of adjacent UTC days on which Coastal Dig's expedition fee genuinely
 * differs. DERIVED, never written down: which day carries which world event is a function of
 * WORLD_SALT and the order of WORLD_EVENTS, so a pinned day index would go stale silently the
 * moment either changed — and a stale one would leave the staleness test comparing a price
 * against itself, passing forever while proving nothing.
 *
 * It compares the FEE, not the multiplier that scales it: expeditionFeeFor rounds and floors
 * at 1, so a moved multiplier does not by itself guarantee a moved price.
 */
function daysWhereExpeditionFeeMoves(): { before: number; after: number } {
  const cost = EXPEDITION_SITES.coastal_dig.cost;
  const feeOn = (day: number) => expeditionFeeFor(cost, eventMods(day * DAY_MS).expeditionFee);
  for (let day = 0; day < 2_000; day++) {
    if (feeOn(day) !== feeOn(day + 1)) return { before: day, after: day + 1 };
  }
  throw new Error("no adjacent UTC day pair moves Coastal Dig's fee — the fixture cannot be built");
}

/** The same, for the shop's egg price, which rolls with both the world event and the Daily Deal. */
function daysWhereEggPriceMoves(rarity: Rarity): { before: number; after: number } {
  for (let day = 0; day < 2_000; day++) {
    if (eggPriceAt(rarity, day * DAY_MS) !== eggPriceAt(rarity, (day + 1) * DAY_MS)) {
      return { before: day, after: day + 1 };
    }
  }
  throw new Error(`no adjacent UTC day pair moves eggPriceAt('${rarity}') — the fixture cannot be built`);
}
```

- [ ] **Step 2: Run the file and watch it still pass**

Run: `npx vitest run tests/follow-through.test.ts`

Expected: PASS, unchanged — helpers added, nothing consuming them yet.

- [ ] **Step 3: Add the two spend rows to the table**

Insert these two objects into `GRAPH`, after the `/rescue` row and before the closing `];`:

```typescript
  {
    surface: 'the Dig again button',
    async run(ctx) {
      seedOwner(ctx);
      const price = expeditionFeeFor(
        EXPEDITION_SITES.coastal_dig.cost, eventMods(ctx.now()).expeditionFee);
      // Read before the card opens and compared against itself afterwards: a literal here
      // would bake in both seedOwner's grant AND users.cash's schema default, and a change to
      // either would fail this line while blaming the Dig again handler.
      const cashAtOpen = cashOf(ctx);
      const b = await clickSurface(ctx, `exp:again:${OWNER}:coastal_dig`, 'the Dig again card');
      // Two steps, never one: opening the card charges nothing at all.
      expect(cashOf(ctx), 'opening the Dig again card charged the player').toBe(cashAtOpen);
      expect(activeExpedition(ctx, OWNER),
        'opening the Dig again card started an expedition').toBeUndefined();
      return {
        payload: b.replies[0],
        required: [`exp:againyes:${OWNER}:coastal_dig:${price}`],
        exactly: [`exp:againyes:${OWNER}:coastal_dig:${price}`],
        follow: `exp:againyes:${OWNER}:coastal_dig:${price}`,
        async effect() {
          expect(cashOf(ctx), 'the confirmed dig did not charge exactly the price it quoted')
            .toBe(cashAtOpen - price);
          expect(activeExpedition(ctx, OWNER),
            'the confirmed dig did not start an expedition').toBeDefined();
        },
      };
    },
  },
  {
    surface: 'the Buy another button',
    async run(ctx) {
      seedOwner(ctx);
      expect(dailyEggOffers(0, ctx.now()),
        'the fixture assumes common is in the rotation at high-water 0').toContain('common');
      const price = eggPriceAt('common', ctx.now());
      const cashAtOpen = cashOf(ctx);
      const b = await clickSurface(ctx, `shop:again:${OWNER}:common`, 'the Buy another card');
      expect(eggsOf(ctx), 'opening the Buy another card bought an egg').toHaveLength(0);
      expect(cashOf(ctx), 'opening the Buy another card charged the player').toBe(cashAtOpen);
      return {
        payload: b.replies[0],
        required: [`shop:againyes:${OWNER}:common:${price}`],
        exactly: [`shop:againyes:${OWNER}:common:${price}`],
        follow: `shop:againyes:${OWNER}:common:${price}`,
        async effect() {
          expect(cashOf(ctx), 'the confirmed purchase did not charge exactly the price it quoted')
            .toBe(cashAtOpen - price);
          expect(eggsOf(ctx), 'the confirmed purchase did not hand over an egg').toHaveLength(1);
        },
      };
    },
  },
```

- [ ] **Step 4: Run the table and watch the two new rows pass**

Run: `npx vitest run tests/follow-through.test.ts`

Expected: PASS, one test per row in `GRAPH`.

- [ ] **Step 5: Add the staleness block**

Append this `describe` to the end of `tests/follow-through.test.ts`, after the existing one:

```typescript
// ---------------------------------------------------------------------------
// The price segment is the guard, not a nicety (spec §4.4). A confirm card left
// open across a UTC midnight would otherwise charge today's price under
// yesterday's label — and re-rendering the message on success is a second layer
// only, because any OTHER open message still holds the stale button
// (§repaint-is-second-layer-not-guard).
//
// Both tests MOVE THE CLOCK to a day where the price genuinely differs and then
// replay the id minted on the earlier day. Handing the handler a hand-written
// wrong price would prove that `!==` works and nothing at all about staleness, so
// each test asserts up front that its two days really do disagree.
// ---------------------------------------------------------------------------
describe('a spend confirm refuses a price that moved under it', () => {
  it('Dig again refuses a confirm minted on a day with a different expedition fee', async () => {
    const { before, after } = daysWhereExpeditionFeeMoves();
    const ctx = ctxOn(before * DAY_MS);
    seedOwner(ctx);
    const site = EXPEDITION_SITES.coastal_dig;
    const quoted = expeditionFeeFor(site.cost, eventMods(ctx.now()).expeditionFee);

    const open = `exp:again:${OWNER}:coastal_dig`;
    const card = fakeButton({ customId: open, user: OWNER, componentIds: [open] });
    await routeInteraction(ctx, testRegistry, card.asInteraction());
    const minted = controlsOf(card.replies[0], open).map((c) => c.custom_id);
    const stale = `exp:againyes:${OWNER}:coastal_dig:${quoted}`;
    expect(minted, `the card did not quote ${quoted}`).toContain(stale);

    ctx.setNow(after * DAY_MS);
    expect(expeditionFeeFor(site.cost, eventMods(ctx.now()).expeditionFee),
      'the two days must genuinely disagree about the fee, or this test proves nothing')
      .not.toBe(quoted);

    const cashBefore = cashOf(ctx);
    const click = fakeButton({ customId: stale, user: OWNER, componentIds: minted });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(cashOf(ctx), 'the stale confirm charged the player').toBe(cashBefore);
    expect(activeExpedition(ctx, OWNER),
      'the stale confirm started an expedition at the earlier day’s price').toBeUndefined();
    // Refused, but ANSWERED: a bare return paints "This interaction failed" after three
    // seconds, so the click must leave either a reply or an acknowledgement.
    expect(click.replies.length + click.deferOpts.length,
      'the stale confirm left the interaction unacknowledged').toBeGreaterThan(0);
  });

  it('Buy another refuses a confirm minted on a day with a different egg price', async () => {
    const { before, after } = daysWhereEggPriceMoves('common');
    const ctx = ctxOn(before * DAY_MS);
    seedOwner(ctx);
    // The ROTATION recheck is not what this test isolates, so both days must offer common —
    // otherwise the handler would refuse on rotation and the price guard would never run.
    expect(dailyEggOffers(0, before * DAY_MS)).toContain('common');
    expect(dailyEggOffers(0, after * DAY_MS)).toContain('common');
    const quoted = eggPriceAt('common', ctx.now());

    const open = `shop:again:${OWNER}:common`;
    const card = fakeButton({ customId: open, user: OWNER, componentIds: [open] });
    await routeInteraction(ctx, testRegistry, card.asInteraction());
    const minted = controlsOf(card.replies[0], open).map((c) => c.custom_id);
    const stale = `shop:againyes:${OWNER}:common:${quoted}`;
    expect(minted, `the card did not quote ${quoted}`).toContain(stale);

    ctx.setNow(after * DAY_MS);
    expect(eggPriceAt('common', ctx.now()),
      'the two days must genuinely disagree about the price, or this test proves nothing')
      .not.toBe(quoted);

    const cashBefore = cashOf(ctx);
    const click = fakeButton({ customId: stale, user: OWNER, componentIds: minted });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(cashOf(ctx), 'the stale confirm charged the player').toBe(cashBefore);
    expect(eggsOf(ctx), 'the stale confirm bought an egg at the earlier day’s price')
      .toHaveLength(0);
    expect(click.replies.length + click.deferOpts.length,
      'the stale confirm left the interaction unacknowledged').toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run the file and watch it pass**

Run: `npx vitest run tests/follow-through.test.ts`

Expected: PASS — the table rows plus the two staleness tests.

- [ ] **Step 7: GUARD — break the expedition price recheck, watch its test fail, restore**

In `src/modules/expeditions/index.ts`, inside the `againyes` arm, change
`if (price !== quoted) {` to `if (false) {`, so the handler charges unconditionally.

Run: `npx vitest run tests/follow-through.test.ts -t "Dig again refuses"`

Expected: FAIL with `the stale confirm charged the player`.

Restore `if (price !== quoted) {` and re-run the same command. Expected: PASS.

- [ ] **Step 8: GUARD — break the shop price recheck, watch its test fail, restore**

The shop half has its own copy of this guard, and a guard only ever seen passing is
indistinguishable from one that cannot fail. In `src/modules/shop/index.ts`, inside the
`againyes` arm, change its price-mismatch condition to `if (false) {`.

Run: `npx vitest run tests/follow-through.test.ts -t "Buy another refuses"`

Expected: FAIL with `the stale confirm charged the player`, followed by
`the stale confirm bought an egg at the earlier day’s price` had the run continued.

Restore the condition and re-run the same command. Expected: PASS.

- [ ] **Step 9: GUARD — break the FIXTURE, watch its self-check fire, restore**

The fixture has a guard of its own, and it has not been watched either: if the two days did not
disagree, both tests above would pass while proving nothing.

Temporarily replace the body of `daysWhereExpeditionFeeMoves` with `return { before: 0, after: 0 };`.

Run: `npx vitest run tests/follow-through.test.ts -t "Dig again refuses"`

Expected: FAIL with
`the two days must genuinely disagree about the fee, or this test proves nothing`. The assertion
fires BEFORE the stale click, which is why a same-day pair cannot slip through as a pass.

Restore the real loop and re-run. Expected: PASS.

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`

Expected: exit 0, no output.

- [ ] **Step 11: Commit**

```bash
git add tests/follow-through.test.ts
git commit -m "test(follow-through): pin the spend confirms and their price recheck"
```

---

---

### Task 31: docs — name the buttons in the command reference, and file the convention

_Stable id: `G8-C`_

Two files carry the rule forward. `docs/commands.md` currently tells players to type follow-up
commands that are now buttons; `docs/conventions/command-and-handler-surface.md` is the doc that
fires on every `src/modules/*/index.ts` — every place a control is minted — so it is where the
next implementer inherits the rule.

**This task is the SOLE writer of `docs/commands.md` in this plan.** Tasks G6-A and G6-B each
drafted a competing rewrite of the `/build` and `/rescue` rows and both struck it; nothing else in
the plan touches this file. It is also the sole writer of
`docs/conventions/command-and-handler-surface.md` — Task 21 (G7-C) and Task 25 (G7-F) edit
`docs/conventions/router-and-registry.md`, a different file, so the append anchors below are not
shared with any other task.

Both files are governed by `docs/conventions/prose-and-specs.md`: **never write a count into
prose.** `docs/commands.md` already carries several, spread across rows this task does not touch;
they are pre-existing and explicitly **not this task's to fix**. Do not add new ones, and do not
"tidy" the old ones — Step 2 scopes the check to the ten rewritten lines precisely so those
pre-existing hits stay out of scope.

**Deliberately NOT edited, so each is a decision rather than a gap:**
- `docs/gameplay.md` — its `/rescue` section (find it with `grep -n "^### Rescue" docs/gameplay.md`) documents the recapture FEE and never tells the player to type a follow-up command, so nothing in it is made false by this change.
- `src/modules/help/index.ts` — the first-ten-minutes walkthrough still says to type `/incubate egg:<id>` and `/dino assign` (`grep -n "dino assign" src/modules/help/index.ts`). Those invocations still work; they are merely no longer the shortest path. Rewriting the walkthrough is onboarding's job, which spec §1 names as sub-project 3 of 3 and puts out of scope here.

**Files:**
- Modify: `docs/commands.md:22`, `:26`, `:35`, `:36`, `:37`, `:45`, `:53`, `:60`, `:62`, `:76` — each a single table row, replaced whole, left column unchanged
- Modify: `docs/conventions/command-and-handler-surface.md` (two headline bullets, two body sections)
- Modify: `docs/conventions/manifest.json` (one `triggerGlobs` entry)

**Interfaces:**
- Consumes: `tests/follow-through.test.ts` must already exist **and be committed** (Task 29 (G8-A)), because the new manifest glob names it and the audit's dead-glob check reads `git ls-files`.
- Produces: `§follow-through-graph-has-a-row-per-surface` and `§follow-through-control-carries-the-owner-uid` — two new anchors in `docs/conventions/command-and-handler-surface.md`.

---

- [ ] **Step 1: Rewrite the ten `docs/commands.md` rows**

Each is a single-line table row. Replace the whole line; the left column is unchanged.

Line 22 — `/build`:

```
| `/build` | Build on an empty lot | Also offered as a **Build…** dropdown on the Lots tab of `/park view`, behind a confirm — pick a menu option and it doesn't charge until you confirm. Either way, building a paddock carries a **🦕 Assign a dino** button that opens a private dropdown of your free dinos that eat the right food |
```

Line 26 — `/dino assign`:

```
| `/dino assign` | Put a dino in a paddock so it starts earning | Autocomplete: dino, lot. The hatch reveal and `/build` offer this as a button instead. This command is still how you MOVE a dino that already has a paddock, and the only way to put a dino in a paddock that halves its comfort — it asks you to confirm first |
```

Line 35 — `/incubate`:

```
| `/incubate` | Start incubating an egg | Autocomplete: egg. Every surface that hands you an egg — an expedition, the shop, the Gene Lab, `/mythic` — also carries an **🥚 Incubate** button for that egg, so you rarely need to type this |
```

Line 36 — `/hatch`. Note the wording: **"a single matching paddock"**, never "one matching
paddock". `\bone\b` is a token Step 2's check rejects, and this row is the one place the natural
phrasing walks into it:

```
| `/hatch` | Hatch an egg that has finished incubating | Autocomplete: egg. Reveals the species on a button press, and the reveal offers to put the new dino straight into a paddock: a single matching paddock with room becomes an **Assign** button, several become a dropdown, and none becomes **🏗️ Build a paddock**. Wrong-habitat paddocks are never offered here — `/dino assign` is the only way to make that trade |
```

Line 37 — `/mythic`:

```
| `/mythic` | Trade shards for a Mythic egg | Needs 8.0★ best-ever rating. Asks for confirmation before spending, then carries an **🥚 Incubate** button for the egg |
```

Line 45 — `/rescue`:

```
| `/rescue` | Recapture a dino that escaped | Autocomplete: dino. The reply carries a **🍖 Feed it** button — a recaptured dino comes back hungry. Feeding spends food rather than cash, so that button takes effect on the first click, the same as **Feed all** on `/park view` |
```

Line 53 — `/breed claim`:

```
| `/breed claim` | Claim the oldest finished pairing | Reveals the egg's rarity and inherited traits, and carries an **🥚 Incubate** button for it; reports how many more pairings are still waiting if you have several ready at once |
```

Line 60 — `/expedition start`:

```
| `/expedition start` | Send a dig crew out to a site | Autocomplete: site. Also offered as a **🧭 Dig again** button on the `/expedition claim` reply, which quotes today's fee and asks you to confirm before it charges |
```

Line 62 — `/expedition claim`:

```
| `/expedition claim` | Collect the rewards from a returned expedition | Reply names any live cash/egg-odds world event effect, and carries an **🥚 Incubate** button for the egg you just found plus a **🧭 Dig again** button for the same site. Dig again quotes today's fee and asks you to confirm before it charges |
```

Line 76 — `/shop egg`:

```
| `/shop egg` | Buy an egg | Autocomplete: rarity. Only rarities currently on offer. The reply carries an **🥚 Incubate** button for the egg you just bought and a **🥚 Buy another** button that quotes today's price and asks you to confirm before it charges |
```

- [ ] **Step 2: Check the prose gate on the ten rewritten lines only**

Run:

```bash
grep -nE '\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\b' docs/commands.md | grep -E '^(22|26|35|36|37|45|53|60|62|76):'
```

Expected: **no output** (the second grep exits 1).

The unscoped grep over the whole file hits many other lines — the `/park view` row, `/season`,
`/help`, `/guests build` and more. **Every one of those is pre-existing and out of scope for this
task**; the second grep exists so they cannot be mistaken for a failure here. Enumerate them, if
you want to see what is being excluded, by running the first grep alone. If one of the ten scoped
lines does print, reword that line — "a single", "several" and "none" carry the meaning without a
count that decays.

- [ ] **Step 3: Add the two headlines to the convention doc**

In `docs/conventions/command-and-handler-surface.md`, append these two bullets to the end of the
`## Headlines` block — immediately after the line that ends
`§existence-check-before-acknowledgement` and before the blank line preceding
`## commands-live-in-manifests`:

```markdown
- Every surface that hands a player a new object offers the next step as a control on that same message, and every such control is a row in the table in `tests/follow-through.test.ts` — the graph is convention, nothing structural, so that table is the only thing that catches a new surface minting an egg and forgetting to offer Incubate. §follow-through-graph-has-a-row-per-surface
- A follow-through control on a PUBLIC reply carries the owner's id and its handler rejects a mismatch BEFORE the service call — but only for `claimExpedition` and `startExpedition` is that check the write barrier, because both resolve the CALLER's own dig and take no id. For `incubateEgg`, `assignDino` and `feedDino` the service already filters on the caller, so the check buys the right SENTENCE on a public card and nothing more; never describe it as the protection. §follow-through-control-carries-the-owner-uid
```

- [ ] **Step 4: Add the two body sections**

Append to the very end of `docs/conventions/command-and-handler-surface.md`, after the
`## existence-check-before-acknowledgement` section (the file's last section today — confirm with
`grep -n '^## ' docs/conventions/command-and-handler-surface.md | tail -1`):

```markdown
## follow-through-graph-has-a-row-per-surface

Every surface that hands the player a new object offers the next step on it as a control on the
same message: an egg gets Incubate, a newly hatched dino gets Assign, a claimed expedition gets
Dig again. Those controls are minted per module, on each module's own existing prefix, rather
than through a central registry. A central one was considered and rejected twice over: a single
`next:` prefix means one handler switching over every module's actions, which is the shape
§one-entry-per-prefix-branch-internally exists to prevent, and such a registry would have to
import from every module, inverting the dependency direction the repo has today.

The price of that choice is that NOTHING structural holds the graph together. Nothing stops a
future surface minting an egg and never offering Incubate; the code compiles, `npm run typecheck`
is clean, and every other test passes. The only symptom is a player typing a command they should
not have had to. `tests/follow-through.test.ts` is the whole defence: one table of (surface,
expected customId) pairs, each row driving the real surface, asserting the minted payload actually
carries the id, then dispatching that id back through `routeInteraction` and asserting the
database effect. A new surface that hands out an object adds its row there in the same change —
and the table only catches the omission if whoever adds the surface also adds the row.

That table also owns the ONE whole-list assertion. Two of those payloads are built by two
different modules pushing onto the same array (`/expedition claim` carries Dig again and Incubate;
`/shop egg` carries Buy another and Incubate), so a components array is always built as a named
local and PUSHED onto, never assigned wholesale — an assignment deletes the other module's control
with no error anywhere. Per-surface tests therefore assert only the id they own, with `toContain`,
and the full ordered list is pinned in the contract table alone, so a deleted control and an
undeclared new one are each a single findable failure rather than several contradictory ones.

A CROSS-MODULE mint is gated on the handler's module being enabled — `ctx.config.modules.<name>`,
read off `Ctx.config` (`src/core/context.ts`, `src/core/config.ts`). `ModuleRegistry` filters to
enabled modules before it resolves anything (`src/core/modules.ts`), so a `hatch:inc` button minted
by the shop while the hatchery module is off is a control nothing answers at all, sitting on a
durable message that outlives the deploy that disabled it. A mint by the module that also handles
the id needs no gate: it is a condition that cannot be false.

A follow-through control REPLIES or UPDATES; it never defers. Every action behind one is
synchronous DB work with nothing to wait on, so the contract test treats a `deferUpdate` as a
router rejection rather than a dispatch — which is also what makes it able to tell "the handler
answered" apart from "no handler resolved for this prefix at all", the silent shape
`routeInteraction` takes when `findComponent` misses.

Two shapes are settled and should not be re-litigated per surface. A control that spends CASH goes
behind a two-step confirm whose second button carries the price it quoted, and the handler refuses
when the price has moved: §money-button-carries-its-rung applied to a number that genuinely moves,
since expedition fees shift with the day's world event and egg prices roll at UTC midnight. A
control that spends FOOD does not: `park:feedall:<uid>` has consumed food on one click since it
shipped, and putting a confirm on one food button but not the other would make the two disagree
for no reason a player could infer.

A follow-through control that NAVIGATES rather than acts replies EPHEMERALLY under the
`park:goto:<target>:<uid>` shape — `park:goto:lots:<uid>` is the hatch reveal's "Build a paddock" —
and never reuses `park:tab:<uid>:<tab>`. `park:tab` ends in `renderTab`, which `i.update`s the
message it was clicked from; the hatch reveal is public, so that would destroy the reveal and leave
the owner's private Lots card sitting in the channel. Note the owner id sits at index 3 in a `goto`
id, not index 2, which is why that arm re-destructures its parts. That ephemeral also strips the
tab row `lotsPayload` appends unconditionally, unlike its landmark/guests/roster neighbours: left
in, one tab click would advance THIS message and hand the player a second, parallel park card
beside the one they opened it from.

## follow-through-control-carries-the-owner-uid

`/expedition claim`, `/shop egg`, `/build` and the hatch reveal are PUBLIC messages, so anyone in
the channel can click a button sitting on one. Every follow-through customId therefore carries the
owner's id, and its handler rejects a mismatch before the service call — the same explicit check
`exp:claim` already performed before this work.

What that check actually buys differs by service, and the difference is worth stating precisely
because getting it backwards produces a comment that lies. `claimExpedition` takes no id at all and
`startExpedition` dispatches the clicker's own crew: both always resolve the CALLER, so without the
owner check a bystander's click on somebody else's card does not fail — it silently succeeds
against their OWN expedition. There the check IS the barrier. `incubateEgg`, `assignDino` and
`feedDino` each filter their own read on `userId` already, so a bystander is refused with or
without it; there the check buys a legible sentence ("That is not your egg.") on a public card
instead of a confusing one about something the clicker never named. Do not write a comment calling
either kind "the protection" without checking which one you are holding.

This is also the mirror image of §target-segment-customids-no-owner-check, where the id segment
names a TARGET and an ownership check would break the feature outright. Check which kind of segment
you are holding before copying either pattern.
```

- [ ] **Step 5: Point the doc's trigger globs at the contract test**

In `docs/conventions/manifest.json`, in the `command-and-handler-surface` entry, add
`"tests/follow-through.test.ts"` to `triggerGlobs`, immediately after `"tests/contract.test.ts"`.
The doc that carries the rule then fires whenever anyone edits the table that enforces it.

Only the contract test is added. The per-slice test files this plan also creates are already
claimed by the `fallback` doc's `tests/*.ts` glob, and none of them owns the graph.

Leave `rules` untouched: `tests/conventions.test.ts` asserts the filed rule-id set equals the
frozen measured map in `docs/superpowers/plans/artifacts/2026-08-28-claude-md-rule-map.json`
exactly, so adding a rule id there would fail that test. Headlines and body sections are not
checked against that map — only rule ids are.

- [ ] **Step 6: Check the line endings of both edited markdown files**

Both files are CRLF today with no bare LF anywhere. Any editor or script that writes LF-terminated
markdown into one of them makes the next step fail on an error that step would otherwise never
mention, and `git diff` cannot show it.

Run:

```bash
node -e "for (const p of ['docs/conventions/command-and-handler-surface.md','docs/commands.md']) { const b=require('fs').readFileSync(p); let c=0,l=0; for(let i=0;i<b.length;i++){ if(b[i]!==0x0a) continue; if(i>0&&b[i-1]===0x0d) c++; else l++; } console.log(p, 'CRLF='+c, 'LF='+l); }"
```

Expected: `LF=0` for both, with `CRLF` equal to each file's line count. If a bare LF appears,
rewrite the whole file with CRLF rather than patching the one line.

`scripts/conventions-audit.mjs`'s mixed-EOL check inspects `CLAUDE.md` and `docs/conventions/*.md`
only — `docs/commands.md` is not in its path list — so a bare LF in the convention doc is what the
next step catches, and a bare LF in `docs/commands.md` is caught here and nowhere else. That is why
this step reads both files rather than deferring to the audit.

- [ ] **Step 7: Run the conventions audit and the conventions test**

Run: `node scripts/conventions-audit.mjs command-and-handler-surface`

Then, as a separate command: `npx vitest run tests/conventions.test.ts tests/conventions-hook.test.ts`

Expected: the audit prints one `[body-ratio]` info line and ends with
`command-and-handler-surface: clean.`, exit 0; both vitest files PASS. In particular there must be
no `[broken-anchor]`, no `[dead-glob]` and no `[mixed-eol]` line. `tests/conventions-hook.test.ts`
is in the list because it proves every manifest doc — the `fallback` doc included — is still
reachable from some tracked file after a glob is added.

(Two commands, never `A && B`: under this repo's primary shell, Windows PowerShell 5.1, `&&` is a
parser error, and a chain would hide which gate failed.)

- [ ] **Step 8: GUARD — break one anchor, watch the audit catch it, restore**

The audit is the only thing that pairs a headline's `§name` with a `## name` body heading, and it
has not been watched failing on this doc.

In `docs/conventions/command-and-handler-surface.md`, change the body heading
`## follow-through-control-carries-the-owner-uid` to
`## follow-through-control-carries-the-owner-id`.

Run: `node scripts/conventions-audit.mjs command-and-handler-surface`

Expected: FAIL, exit 1, with
`[broken-anchor] command-and-handler-surface: headline cites §follow-through-control-carries-the-owner-uid, no "## follow-through-control-carries-the-owner-uid" heading in the body`.

Restore the heading and re-run. Expected: `command-and-handler-surface: clean.`, exit 0.

- [ ] **Step 9: GUARD — break the new glob, watch the dead-glob check catch it, restore**

A glob nobody has watched fail is not yet a glob: the check reads `git ls-files`, so a glob naming
an uncommitted or misspelled path is silently useless.

In `docs/conventions/manifest.json`, change the entry just added to
`"tests/follow-through-NOPE.test.ts"`.

Run: `node scripts/conventions-audit.mjs command-and-handler-surface`

Expected: FAIL, exit 1, with
`[dead-glob] command-and-handler-surface: "tests/follow-through-NOPE.test.ts" matches no tracked file`.

Restore `"tests/follow-through.test.ts"` and re-run. Expected: `command-and-handler-surface: clean.`,
exit 0. If it still reports a dead glob with the correct spelling, Task 29 (G8-A)'s commit has not
landed — `git ls-files tests/follow-through.test.ts` returns nothing for an untracked file.

- [ ] **Step 10: Commit**

```bash
git add docs/commands.md docs/conventions/command-and-handler-surface.md docs/conventions/manifest.json
git commit -m "docs: name the follow-through buttons and file the convention behind them"
```

---

---

### Task 32: gates, and the operator hand-off

_Stable id: `G8-D`_

This task changes no files. It runs every gate in order and hands the operator the list of things
only a human at a real Discord client can do.

**Files:**
- None. Nothing is created, modified or committed by this task.

**Interfaces:**
- Consumes: every preceding task, merged. In particular **Task 4 (G1-D)**, which settled the three
  documented exceptions the sweep grep in Step 3 must name, and stated in as many words that its
  own copy of that grep is a snapshot rather than a permanent invariant — because Tasks G6-B, G7-C
  and G7-F each add a new `InsufficientFundsError` catch site after it. This step is where the
  sweep is checked with all three of those in the tree.
- Produces: nothing consumed by later tasks.

Run the shell commands below in Git Bash. Several use `$(...)`, `for`/`case` and single-quoted
pathspecs, which Windows PowerShell 5.1 parses differently or not at all.

---

- [ ] **Step 1: Confirm no break-and-watch edit was left behind, then typecheck**

Run: `git status --porcelain`

Expected: **no output**. Every task in this plan ends with a commit, and every break-and-watch step
ends with a restore; anything printed here is a temporary edit somebody forgot to undo.

Then run: `npm run typecheck`

Expected: exit 0, no output. `npm run build` runs `tsc` against `tsconfig.json`, which `include`s
only `src`, and vitest transpiles without typechecking — so this is the only gate that reads
`tests/` and `scripts/`. Spec §6.5 leans on it directly: `needed` and `held` on
`InsufficientFundsError` are REQUIRED parameters precisely so the compiler, not a test, catches a
call site that still throws the numberless error.

- [ ] **Step 2: Run the whole offline suite**

Run: `npm test`

Expected: exit 0, every test passing, including `tests/follow-through.test.ts`,
`tests/follow-through-incubate.test.ts`, `tests/follow-through-assign.test.ts`,
`tests/follow-through-spend.test.ts`, `tests/build-assign.test.ts`,
`tests/care-feed-button.test.ts` and `tests/contract.test.ts`.

- [ ] **Step 3: Prove the error sweep is still complete with the late catch sites in the tree**

Spec §5.1 says every `InsufficientFundsError` catch site quotes the number it withholds. Task 4 (G1-D)
swept the tree, but three sites land AFTER it — Task 18 (G6-B)'s `care:feed` arm, Task 21 (G7-C)'s
`exp:againyes` arm and Task 25 (G7-F)'s `shop:againyes` arm — so this is the first point at which the
claim can honestly be checked.

Run:

```bash
for f in $(grep -rl "e instanceof InsufficientFundsError" src/modules/*/*.ts); do
  case "$f" in
    src/modules/admin/service.ts|src/modules/battles/index.ts|src/modules/trading/index.ts) continue ;;
  esac
  c=$(grep -c "e instanceof InsufficientFundsError" "$f")
  q=$(grep -c "shortfallLine(e)" "$f")
  [ "$c" -le "$q" ] || echo "$f: $c catch site(s), only $q shortfallLine(e) call(s)"
done
```

Expected: **no output**.

The three skipped paths are the only exceptions, each settled by Task 4 (G1-D), and listing them
explicitly is what keeps this loop a real check rather than one that is green by construction:

- `src/modules/admin/service.ts` — out of scope by spec §5.1. Its own `shortfallOf` derives the
  numbers from the `tx_log` row and reads balances after the reversal transaction rolled back.
- `src/modules/trading/index.ts` — quotes the gap with no "you have" clause, because `acceptTrade`
  applies to `trade.fromUser` first while the reply is read by `trade.toUser`, so `shortfallLine`'s
  "you have" would be a false statement about the reader's own balance.
- `src/modules/battles/index.ts` — untouched by design. Spec §5.4 says flatly "Nothing in battles
  changes"; it is already the house shape this sweep copies.

**This loop has been watched failing**: run the same command on `main` (or on any commit before
Task 2 (G1-B)) and it prints every non-exempt module, because `shortfallLine` does not exist there.
If it prints nothing on `main` too, the loop is broken, not the tree.

- [ ] **Step 4: Prove no builder changed, so no command deploy is owed**

Run:

```bash
git diff "$(git merge-base main HEAD)" HEAD -- src | grep -E '^[+-].*(SlashCommandBuilder|addSubcommand|addStringOption|addIntegerOption|addBooleanOption|addUserOption|addChannelOption|setAutocomplete|addChoices)'
```

Expected: **no output** (grep exits 1). Components and select menus are not builder changes and no
command gained an option, which is why spec §7 owes **no `npm run deploy-commands`**.

First confirm the diff is not empty by construction: `git diff "$(git merge-base main HEAD)" HEAD --stat -- src` must list this plan's source files. If it lists nothing, the work was committed onto `main` itself, the merge base is `HEAD`, and the grep above proves nothing — compare against the commit before this plan's first commit instead (`git log --oneline -- src/core/economy.ts | head` locates it).

If this grep prints anything, a builder did change: run `npm run deploy-commands` after the restart
in Step 7, and check whether `tests/contract.test.ts`'s `AUTOCOMPLETE_OPTIONS` manifest and its
command-count assertion need updating in the same change.

- [ ] **Step 5: Run the whole-repo conventions audit**

Run: `node scripts/conventions-audit.mjs`

Expected: `[body-ratio]` info lines, then `clean.`, exit 0. Task 31 (G8-C) ran this scoped to one doc;
whole-repo mode additionally runs the orphan check across every tracked file, which is the one that
would notice a new test file no doc's globs claim.

- [ ] **Step 6: Build**

Run: `npm run build`

Expected: exit 0. The bot runs compiled `dist/`, so this must happen before the restart, not after.

- [ ] **Step 7: Restart the bot (operator)**

RegEdits starts the bot; never start it for them. Ask them to stop the running process and run
`npm start`, then confirm the boot line naming the loaded application emoji count appears.

Nothing else is owed: no migration (no new table and no new column), no `npm run deploy-emojis` (no
new emoji), no art, and — per Step 4 — no `npm run deploy-commands`.

- [ ] **Step 8: Run the live sweep**

Run: `npm run test:live`

Expected: exit 0, every case ok.

- [ ] **Step 9: Hand the operator the manual checklist**

State this plainly, in these words:

> `npm run test:live` is **REST-only**. It opens no gateway session and clicks **none** of the
> buttons this change adds — not Incubate, not Assign, not Feed it, not Dig again, not Buy
> another. Nothing automated has exercised this feature against real Discord. The offline
> contract test proves the ids are minted and that the router dispatches them; it cannot prove
> Discord renders them or that a real click arrives.
>
> These checks are owed by hand, in a real server, after the restart:
>
> 1. `/hatch` a ready egg and press **Crack it open** — twice, in two different states. Holding
>    exactly **one** eligible paddock, the reveal must show an **Assign** button naming that
>    paddock, and pressing it must put the dino in it. Holding **several**, it must show a
>    dropdown instead, and picking an option must assign the dino to that paddock. In both
>    shapes the reveal must NOT still read "Next: /dino assign".
> 2. `/hatch` again holding only a wrong-diet paddock, and press **Build a paddock**. The Lots
>    card must arrive as an EPHEMERAL reply, the hatch reveal must still be there unchanged in
>    the channel, and that ephemeral must carry the Build dropdown and **no tab buttons**. If the
>    reveal was replaced, the control is minting `park:tab` instead of `park:goto:lots` and it is
>    destroying a public message.
> 3. `/expedition claim` a returned dig, press **Incubate**, then run `/eggs` and confirm that
>    egg is showing a timer. The spent Incubate button must be gone from the claim message.
> 4. Press **Dig again**, confirm it, and check `/admin ledger` for your own id: the charge must
>    appear exactly **once**. Then press the *same* confirm button a second time and check the
>    ledger again — no second charge may appear.
> 5. `/build` a paddock while holding **no** unassigned dino of that diet, and press **Assign a
>    dino**. Discord rejects a select menu with zero options, so the empty case must answer with a
>    sentence rather than an empty dropdown — and the sentence must match your actual situation
>    (owning none of that diet reads differently from owning some that are all housed).
> 6. Build a paddock the OTHER way — `/park view` → Lots tab → **Build…** → confirm — and check
>    that an **Assign a dino** control arrives beside the refreshed Lots tab.
> 7. Let a dino escape, `/rescue` it, and press **Feed it**. Food must be spent exactly once and
>    the button must disappear; pressing a stale copy of it on an older message must spend
>    nothing more.
>
> Report back which of these you ran and what each showed. Do not treat the feature as verified
> until all of them have been done by hand.

---

