# Gameplay Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three confirmed gameplay bugs — trade escrow ignored by the hatchery, the via-trade flag lost at hatch, and duplicate facilities whose cap resolves to the wrong row.

**Architecture:** Point fixes at each service boundary, no new abstractions beyond one shared `facilityLevel` resolver. Five source files carry behavior changes (`hatchery/service.ts`, `hatchery/index.ts`, `hatchery/embeds.ts`, `core/autocomplete.ts`, `park/service.ts`), two carry wiring or copy (`park/index.ts`, `help/index.ts`). No schema migration, no command-builder change, no new command or module.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js 14, drizzle-orm over better-sqlite3 (synchronous), vitest.

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()`/`Math.random()`.
- DB access is synchronous drizzle (`.get()`/`.all()`/`.run()`), never awaited.
- **No command builder may change.** Every edit here is service logic, embed body text, or autocomplete labels. `npm run deploy-commands` must NOT be needed, and `tests/contract.test.ts` must stay untouched.
- Autocomplete providers only ever `i.respond(...)`, never call `getOrCreateUser`, and are read-only except for `settleEscapes` and `expireStale`.
- `tests/park.test.ts:282` builds three identical paddocks and `tests/park.test.ts:32` expects a fourth paddock build to throw `LotLimitError`. Paddocks stay duplicable; the new block is facility-only.
- The 🔒 marker is a unicode literal, never a custom app emoji. There is no `dw_lock` in the 33-name `EMOJI_FALLBACK` table, and a custom tag is illegal in an autocomplete label.
- `eggListPayload`'s two `attach()` calls are pinned in call order by three `mockImplementationOnce` queues. Never reorder them, never add a third, never hand-assign `payload.files`.
- Gates: `npm test` (vitest, no typechecking) **and** `npm run typecheck` (the only thing that typechecks `tests/`). Both must pass before every commit that touches `tests/`.
- Authorship: commits are by RegEdits. No AI/Claude/tool attribution anywhere in commit messages, code comments, or docs.

---

## File Structure

**Modified — source:**

- `src/core/autocomplete.ts` — `eggLabel` gains a locked branch, checked first. Shared by both egg autocompletes.
- `src/modules/hatchery/service.ts` — `incubateEgg` and `hatchEgg` reject locked eggs; `hatchEgg` propagates `viaTrade`; `incubatorSlots` resolves max-per-kind.
- `src/modules/hatchery/index.ts` — `expireStale` sweep in both executes and both autocomplete providers; `/hatch` locked pre-check; `valid` flags demote locked eggs.
- `src/modules/hatchery/embeds.ts` — `eggListPayload` renders a 🔒 status.
- `src/modules/park/service.ts` — new `DuplicateFacilityError` and `facilityLevel`; `buildLot` blocks duplicate facilities; `capHours` and `facilityBonusPct` resolve max-per-kind.
- `src/modules/park/index.ts` — `/build` catch arm for `DuplicateFacilityError`.
- `src/modules/help/index.ts` — one clause each in the `park` and `eggs` topic bodies.

**Modified — tests:**

- `tests/autocomplete-kit.test.ts` — `eggLabel` locked case.
- `tests/autocomplete-hatchery.test.ts` — locked-egg tagging and demotion, in new `it`s with their own seeds.
- `tests/hatchery.test.ts` — service rejections, `viaTrade` inheritance, `/hatch` pre-check, stale-lock sweep, `/eggs` 🔒, `incubatorSlots` max.
- `tests/park.test.ts` — duplicate-facility rejection, `/build` reply arm, max-per-kind resolvers.
- `tests/journeys.test.ts` — the trade → hatch → sell exploit, end to end.

**Modified — docs:**

- `CLAUDE.md` — records the two new invariants and why they exist.

No files are created or deleted.

---

## Task 1: `eggLabel` locked branch

**Files:**
- Modify: `src/core/autocomplete.ts:48-53`
- Test: `tests/autocomplete-kit.test.ts:103-109`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `eggLabel(egg: EggRow, now: number): string` — unchanged signature; returns `` `🥚 #${id} ${Rarity} — locked in a trade` `` when `egg.locked` is true, checked before every other state. `EggRow` is `typeof schema.eggs.$inferSelect`, so `locked` is already in scope and typed `boolean`.

- [ ] **Step 1: Write the failing test**

In `tests/autocomplete-kit.test.ts`, inside the existing `describe('eggLabel', …)` block (line 103), add a second `it` after the existing one. The `egg(over)` fixture at line 88 already carries `locked: false` and takes an override bag — no fixture change is needed.

```ts
  it('tags a trade-locked egg, ahead of every other state', () => {
    expect(eggLabel(egg({ locked: true }), 0)).toBe('🥚 #12 Rare — locked in a trade');
    // Lock wins over READY: a pre-existing locked+incubating row predates the
    // incubate guard, and the lock is the state that blocks the player.
    expect(eggLabel(egg({ locked: true, incubationStartedAt: 0, hatchesAt: 100 }), 100))
      .toBe('🥚 #12 Rare — locked in a trade');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/autocomplete-kit.test.ts -t "trade-locked"`
Expected: FAIL — received `'🥚 #12 Rare — in inventory'` (and `'🥚 #12 Rare — READY'` for the second assertion).

- [ ] **Step 3: Write minimal implementation**

In `src/core/autocomplete.ts`, replace the `eggLabel` body (lines 48-53):

```ts
export function eggLabel(egg: EggRow, now: number): string {
  const base = `🥚 #${egg.id} ${capitalize(egg.rarity)}`;
  // Checked first: a locked egg cannot be incubated or hatched, so the lock is the
  // state the player needs, whatever the timer says.
  if (egg.locked) return `${base} — locked in a trade`;
  if (egg.hatchesAt === null) return `${base} — in inventory`;
  if (egg.hatchesAt <= now) return `${base} — READY`;
  return `${base} — hatching, ${fmtDuration(egg.hatchesAt - now)} left`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-kit.test.ts`
Expected: PASS, including the three pre-existing `eggLabel` assertions at lines 105-108 (their fixtures all have `locked: false`).

- [ ] **Step 5: Commit**

```bash
git add src/core/autocomplete.ts tests/autocomplete-kit.test.ts
git commit -m "Tag trade-locked eggs in eggLabel"
```

---

## Task 2: Reject locked eggs in `incubateEgg` and `hatchEgg`

**Files:**
- Modify: `src/modules/hatchery/service.ts:25-46`
- Test: `tests/hatchery.test.ts` (describe `'hatchery'`, line 31)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `incubateEgg` and `hatchEgg` both throw `HatcheryError('That egg is locked in a pending trade.')` for an egg with `locked === true`. Signatures unchanged: `incubateEgg(ctx: Ctx, userId: string, eggId: number, guildId: string | null): Egg`, `hatchEgg(ctx: Ctx, userId: string, eggId: number): { species: Species; dinoId: number }`.

**Why `hatchEgg`'s guard cannot be reached through services:** `createTrade` (`src/modules/trading/service.ts:68`) is the only writer of `eggs.locked = true` anywhere in `src/`, and its `verifySide` refuses any egg with `incubationStartedAt !== null` (`:49`). Once `incubateEgg` refuses a locked egg, no sequence of service calls produces a locked *and* incubating row. The test must therefore lock the row with a raw `ctx.db.update` **after** calling `incubateEgg`.

- [ ] **Step 1: Write the failing test**

In `tests/hatchery.test.ts`, add to the `describe('hatchery', …)` block (line 31), after the existing `'a preset-species egg hatches exactly that species'` test. The file's `addEgg` helper takes no override bag, so insert directly — the idiom already used at lines 241, 261, 274, 288 and 314. `eq` is imported at line 9, `schema` at line 8.

```ts
  it('refuses to incubate an egg escrowed in a pending trade', () => {
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, locked: true })
      .returning().get();
    expect(() => incubateEgg(ctx, 'u1', egg.id, 'g1')).toThrow(HatcheryError);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!.incubationStartedAt).toBeNull();
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(0);
  });

  it('refuses to hatch an egg that was locked after incubation started', () => {
    // Unreachable through services — createTrade refuses an incubating egg and is the
    // only writer of eggs.locked — so the belt guard is exercised by locking the row
    // directly, which is exactly the pre-existing state bug 1 could leave behind.
    const egg = addEgg('common');
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    ctx.db.update(schema.eggs).set({ locked: true }).where(eq(schema.eggs.id, egg.id)).run();
    ctx.setNow(ctx.now() + 15 * M);
    expect(() => hatchEgg(ctx, 'u1', egg.id)).toThrow(HatcheryError);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()).toBeDefined();
    expect(ctx.db.select().from(schema.dinos).all()).toHaveLength(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hatchery.test.ts -t "escrowed in a pending trade"`
Expected: FAIL — `incubateEgg` returns normally, so the `toThrow` assertion fails with "received function did not throw".

Run: `npx vitest run tests/hatchery.test.ts -t "locked after incubation started"`
Expected: FAIL — same, `hatchEgg` succeeds and the dino count is 1.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/hatchery/service.ts`, add one guard to each function, immediately after its ownership check.

`incubateEgg` (after line 28's `if (!egg) throw new HatcheryError('You do not own that egg.');`):

```ts
  // Trade escrow: hatching CONSUMES the egg, so unlike battling a locked dino
  // (src/modules/battles/service.ts) it would make the pending trade unfulfillable.
  if (egg.locked) throw new HatcheryError('That egg is locked in a pending trade.');
```

`hatchEgg` (after line 44's `if (!egg) throw new HatcheryError('You do not own that egg.');`):

```ts
  if (egg.locked) throw new HatcheryError('That egg is locked in a pending trade.');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/service.ts tests/hatchery.test.ts
git commit -m "Block incubating and hatching eggs held in trade escrow"
```

---

## Task 3: `/hatch` pre-check and the stale-trade sweep on both executes

**Files:**
- Modify: `src/modules/hatchery/index.ts:1-14` (imports), `:28-38` (`/incubate` execute), `:50-57` (`/hatch` execute)
- Test: `tests/hatchery.test.ts` (describes `'/incubate execute'` line 238 and `'/hatch execute'` line 271)

**Interfaces:**
- Consumes: Task 2's service guards (the `/incubate` path relies on `incubateEgg` throwing).
- Produces: both executes call `expireStale(ctx, i.user.id)` before reading any egg; `/hatch` replies ephemerally with `'That egg is locked in a pending trade.'` instead of showing the crack button.

**Why the sweep:** `expireStale` is lazy — nothing expires trades on a timer, and its only four call sites are all in `src/modules/trading/index.ts`. Without the sweep, a trade that timed out 25 hours ago would keep blocking `/incubate` with a message that is false. `expireStale` reads only `schema.trades` (no user row), so it is safe for any user.

- [ ] **Step 1: Write the failing tests**

In `tests/hatchery.test.ts`, extend the import block at the top with the trading service and the park seeder already present:

```ts
import { createTrade } from '../src/modules/trading/service.js';
```

(`getOrCreateUser` is already imported at line 5.)

Add to `describe('/incubate execute', …)` (line 238):

```ts
  it('rejects an egg locked in a pending trade, ephemeral', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();   // both sides ≥ 2★ gate
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('locked in a pending trade');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('sweeps an expired trade first, so a stale lock does not block incubation', async () => {
    // expireStale is lazy and only ever ran from /trade surfaces, so without the sweep
    // a dead trade would hold the lock — and reject with a statement that is false.
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    ctx.setNow(ctx.now() + 25 * 3_600_000);          // TRADE_EXPIRY_MS is 24h
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    const after = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!;
    expect(after.locked).toBe(false);
    expect(after.incubationStartedAt).not.toBeNull();
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('expired');
  });
```

Add to `describe('/hatch execute', …)` (line 271):

```ts
  it('locked egg is an ephemeral rejection, with no crack button', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    incubateEgg(ctx, 'u1', egg.id, null);
    ctx.db.update(schema.eggs).set({ locked: true }).where(eq(schema.eggs.id, egg.id)).run();
    ctx.setNow(RARITY.common.incubationMs + 1);
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'hatch')!;
    const i = fakeCommand({ name: 'hatch', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('locked in a pending trade');
    expect(JSON.stringify(i.replies[0])).not.toContain('hatch:crack');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hatchery.test.ts -t "locked in a pending trade"`
Expected: the `/hatch` case FAILS — the reply carries `hatch:crack:<id>` and the pre-hatch embed instead of the lock message. The `/incubate` case PASSES already, because Task 2's service guard throws and `/incubate`'s existing catch arm renders it; it is included as a regression pin on the command layer, not as a driver for new code.

Run: `npx vitest run tests/hatchery.test.ts -t "sweeps an expired trade"`
Expected: FAIL — `after.locked` is `true` and `incubationStartedAt` is `null`, because nothing swept the dead trade.

- [ ] **Step 3: Write the implementation**

In `src/modules/hatchery/index.ts`, add the import after the existing module-crossing imports (line 7's `../shop/shards.js`):

```ts
import { expireStale } from '../trading/service.js';
```

In the `/incubate` execute, add the sweep right after `getOrCreateUser` (line 29):

```ts
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        // Escrow locks only clear when someone touches a /trade surface, so sweep before
        // reading eggs — otherwise a dead trade rejects with a lock that no longer exists.
        expireStale(ctx, i.user.id);
```

In the `/hatch` execute, add the same sweep after `getOrCreateUser` (line 51) and a third guard after the ownership check (line 54), before the readiness check:

```ts
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        expireStale(ctx, i.user.id);
        const eggId = i.options.getInteger('egg', true);
        const egg = ctx.db.select().from(schema.eggs).where(and(eq(schema.eggs.id, eggId), eq(schema.eggs.userId, i.user.id))).get();
        if (!egg) { await i.reply({ content: 'You do not own that egg.', flags: MessageFlags.Ephemeral }); return; }
        if (egg.locked) { await i.reply({ content: 'That egg is locked in a pending trade.', flags: MessageFlags.Ephemeral }); return; }
        if (egg.hatchesAt === null || egg.hatchesAt > ctx.now()) { await i.reply({ content: 'That egg is not ready to hatch.', flags: MessageFlags.Ephemeral }); return; }
```

- [ ] **Step 4: Run tests and the typecheck gate**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/index.ts tests/hatchery.test.ts
git commit -m "Reject locked eggs at /hatch and sweep expired trades first"
```

---

## Task 4: Demote and tag locked eggs in both autocompletes

**Files:**
- Modify: `src/modules/hatchery/index.ts:40-47` (`/incubate` autocomplete), `:58-65` (`/hatch` autocomplete)
- Test: `tests/autocomplete-hatchery.test.ts`

**Interfaces:**
- Consumes: Task 1's `eggLabel` locked branch (the label text comes from there) and Task 3's `import { expireStale } from '../trading/service.js';` — already at the top of this file, so no new import is needed here.
- Produces: `/incubate` marks an entry valid when `e.incubationStartedAt === null && !e.locked`; `/hatch` when `e.hatchesAt !== null && e.hatchesAt <= ctx.now() && !e.locked`. Both providers call `expireStale(ctx, i.user.id)` before selecting eggs.

**Hazard:** the shared `seedEggs` helper (line 10) is pinned by a full-array `toEqual` at line 28 and a `toHaveLength(3)` at line 59. Do **not** add a locked egg to it. New coverage goes in its own `it` with a local insert.

- [ ] **Step 1: Write the failing tests**

In `tests/autocomplete-hatchery.test.ts`, add these imports to the existing block at the top:

```ts
import { createTrade } from '../src/modules/trading/service.js';
import { eq } from 'drizzle-orm';
```

Add a new `it` at the end of `describe('/incubate egg autocomplete', …)`:

```ts
  it('tags a locked egg and ranks it below the valid ones', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { inventory } = seedEggs(ctx);
    const locked = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'legendary', source: 'shop', obtainedAt: 0, locked: true })
      .returning().get();
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0].value).toBe(inventory.id);                      // valid first
    expect(rows[rows.length - 1]).toEqual({
      name: `🥚 #${locked.id} Legendary — locked in a trade`, value: locked.id,
    });
  });
```

Add a new `it` at the end of `describe('/hatch egg autocomplete', …)`:

```ts
  it('never ranks a locked egg as ready, even when its timer is up', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    seedEggs(ctx);
    const locked = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'legendary', source: 'shop', obtainedAt: 0,
                incubationStartedAt: 0, hatchesAt: 1, locked: true })
      .returning().get();
    const i = fakeAutocomplete({ name: 'hatch', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0].value).not.toBe(locked.id);
    expect(rows.find((r) => r.value === locked.id)!.name)
      .toBe(`🥚 #${locked.id} Legendary — locked in a trade`);
  });

  it('sweeps expired trades so a stale lock does not demote a ready egg', async () => {
    // A locked AND ready row cannot be built through services in either order —
    // createTrade refuses an incubating egg, and (after this work) incubateEgg refuses
    // a locked one. Trade first, then set the timer fields directly.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    createTrade(ctx, 'u1', 'u2', { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    ctx.db.update(schema.eggs).set({ incubationStartedAt: 0, hatchesAt: 1 })
      .where(eq(schema.eggs.id, egg.id)).run();
    ctx.setNow(25 * 3_600_000);                                        // TRADE_EXPIRY_MS is 24h
    const i = fakeAutocomplete({ name: 'hatch', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0]).toEqual({ name: `🥚 #${egg.id} Common — READY`, value: egg.id });
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!.locked).toBe(false);
  });
```

The second test builds its locked-and-ready row the same way — it passes `incubationStartedAt: 0, hatchesAt: 1, locked: true` straight to the insert, which is legal because no service ever sees that row.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-hatchery.test.ts`
Expected: FAIL on all three new tests. The label assertions fail because Task 1's branch is live but the ordering is not (`valid` still ignores `locked`), so the locked egg sorts among the valid rows; the sweep test fails because the row is still locked.

- [ ] **Step 3: Write the implementation**

In `src/modules/hatchery/index.ts`, `/incubate`'s `autocomplete` (line 40):

```ts
      async autocomplete(ctx, i) {
        expireStale(ctx, i.user.id);
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        if (!eggs.length) { await respondRanked(i, [emptyRow('No eggs — get one from /shop egg or /expedition', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, eggs
          .filter((e) => matches(q, e.id, e.rarity))
          .map((e) => ({ value: e.id, label: eggLabel(e, ctx.now()), valid: e.incubationStartedAt === null && !e.locked })));
      } },
```

`/hatch`'s `autocomplete` (line 58):

```ts
      async autocomplete(ctx, i) {
        expireStale(ctx, i.user.id);
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        if (!eggs.length) { await respondRanked(i, [emptyRow('No eggs — get one from /shop egg or /expedition', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, eggs
          .filter((e) => matches(q, e.id, e.rarity))
          .map((e) => ({ value: e.id, label: eggLabel(e, ctx.now()), valid: e.hatchesAt !== null && e.hatchesAt <= ctx.now() && !e.locked })));
      } },
```

Both providers stay read-only apart from `expireStale`, and neither calls `getOrCreateUser` — the provider contract holds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-hatchery.test.ts`
Expected: PASS, including the pre-existing tests at lines 21, 33, 42, 52 and 62.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/index.ts tests/autocomplete-hatchery.test.ts
git commit -m "Demote trade-locked eggs in the incubate and hatch autocompletes"
```

---

## Task 5: 🔒 marker in the `/eggs` list

**Files:**
- Modify: `src/modules/hatchery/embeds.ts:65-69`
- Test: `tests/hatchery.test.ts` (describe `'hatchery visuals'`, line 84)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `eggListPayload(eggs: Egg[], now: number, userId: string, page = 1)` — unchanged signature; a locked egg's line reads `#N — <rarity emoji><rarity> egg — 🔒 locked in a trade`.

**Constraint:** the edit is confined to the `lines` map. The two `attach()` calls below it (lines 76 and 79) are pinned in call order by three `mockImplementationOnce` queues in this same file, and `tests/images.test.ts:230` bans `payload.files = [...]` outright.

- [ ] **Step 1: Write the failing test**

In `tests/hatchery.test.ts`, add to `describe('hatchery visuals', …)`. Use the object-spread idiom from line 140 — those rows never hit the DB, which is exactly what this payload builder wants.

```ts
  it('eggListPayload marks a trade-locked egg with a padlock, ahead of its timer state', () => {
    const locked = { ...addEgg('epic'), locked: true, hatchesAt: 5, incubationStartedAt: 1 };
    const free = addEgg('common');
    const p = eggListPayload([locked, free], 10, 'u1');
    const desc = p.embeds[0].toJSON().description!;
    expect(desc).toContain(`#${locked.id} — epic egg — 🔒 locked in a trade`);
    expect(desc).toContain(`#${free.id} — common egg — in inventory`);
  });
```

Note there is no rarity glyph in the expected strings. The six rarity gems fall back to the empty string (`EMOJI_FALLBACK` in `src/core/emojis.ts`), tests load no emoji map, and `rarityEmoji` returns `''` rather than a space when the tag is empty — so `${rarityEmoji('epic')}${'epic'}` renders as exactly `epic`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hatchery.test.ts -t "padlock"`
Expected: FAIL — the received description shows `— READY — /hatch` for the locked row, with no padlock.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/hatchery/embeds.ts`, extend the status ternary inside `eggListPayload`'s `lines` map (lines 65-69):

```ts
  const lines = items.length ? items.map((e) => {
    // Lock first: it outranks every timer state, because a locked egg cannot be acted on.
    const status = e.locked ? '🔒 locked in a trade'
      : e.hatchesAt === null ? 'in inventory'
      : e.hatchesAt <= now ? 'READY — /hatch' : `hatching (ready <t:${Math.floor(e.hatchesAt / 1000)}:R>)`;
    return `#${e.id} — ${rarityEmoji(e.rarity)}${e.rarity} egg — ${status}`;
  }).join('\n') : 'No eggs. Run /expedition or /shop.';
```

Nothing below this line changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS. The five pre-existing `eggListPayload` tests (lines 139, 148, 159, 173, 179) assert only thumbnail/image URLs and file names, so none is affected.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/embeds.ts tests/hatchery.test.ts
git commit -m "Show a padlock on escrowed eggs in the /eggs list"
```

---

## Task 6: Propagate `viaTrade` through the hatch

**Files:**
- Modify: `src/modules/hatchery/service.ts:48-54`
- Test: `tests/hatchery.test.ts` (describe `'hatchery'`, line 31)

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of the lock work, same function body).
- Produces: `hatchEgg` inserts the dino with `viaTrade: egg.viaTrade`. `hatchEgg`'s return type stays `{ species: Species; dinoId: number }` — no dino row is returned, so tests re-select by `dinoId`.

This is the first read of `eggs.viaTrade` in the codebase; it has been write-only until now.

- [ ] **Step 1: Write the failing test**

In `tests/hatchery.test.ts`, add to `describe('hatchery', …)`:

```ts
  it('a hatchling inherits the egg\'s via-trade flag, and only that', () => {
    const traded = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, viaTrade: true })
      .returning().get();
    incubateEgg(ctx, 'u1', traded.id, 'g1');
    ctx.setNow(ctx.now() + 15 * M);
    const fromTrade = hatchEgg(ctx, 'u1', traded.id);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, fromTrade.dinoId)).get()!.viaTrade).toBe(true);

    const own = addEgg('common');
    incubateEgg(ctx, 'u1', own.id, 'g1');
    ctx.setNow(ctx.now() + 15 * M);
    const fromLoot = hatchEgg(ctx, 'u1', own.id);
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, fromLoot.dinoId)).get()!.viaTrade).toBe(false);
  });
```

The two incubations are sequential, not concurrent — the first egg is deleted by its hatch before the second is incubated, so the one-slot incubator cap is never exceeded.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hatchery.test.ts -t "via-trade flag"`
Expected: FAIL — the first assertion receives `false`, because the insert omits the column and takes the schema default.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/hatchery/service.ts`, add the key to `hatchEgg`'s dino insert:

```ts
  const dinoId = ctx.db.transaction(() => {
    const dino = ctx.db.insert(schema.dinos).values({
      userId, lotId: null, speciesId: species.id, hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      // Provenance survives the hatch: without this the dino takes the column default and a
      // traded egg launders into a full-shard sale, reopening the alt-to-main funnel that
      // moveItems (src/modules/trading/service.ts) closes for dinos.
      viaTrade: egg.viaTrade,
    }).returning().get();
    ctx.db.delete(schema.eggs).where(eq(schema.eggs.id, eggId)).run();
    return dino.id;
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/service.ts tests/hatchery.test.ts
git commit -m "Carry the via-trade flag from egg to hatchling"
```

---

## Task 7: End-to-end shard-funnel regression

**Files:**
- Modify: `tests/journeys.test.ts` (new `it` inside `describe('journeys', …)`, line 58)

**Interfaces:**
- Consumes: Task 6's `viaTrade` propagation. Also exercises Task 3's sweep incidentally (the trade is accepted, not expired).
- Produces: no source change. This is the money-boundary pin — it is also the first end-to-end coverage of `moveItems`' egg write, which no test asserts today.

**Ordering constraint:** the egg must be traded **before** it is incubated. `verifySide` (`src/modules/trading/service.ts:49`) refuses an incubating egg.

- [ ] **Step 1: Write the failing test**

In `tests/journeys.test.ts`, add one import — `shop/shards.js` is not currently imported by this file:

```ts
import { sellDino } from '../src/modules/shop/shards.js';
```

Add the `it` inside the existing `describe('journeys', …)`:

```ts
  it('shard funnel: /trade offer egg → accept → incubate → crack → /sell pays 0 shards', async () => {
    // The alt-to-main funnel one hatch-step removed. Trading flags the EGG via_trade;
    // before the fix hatchEgg dropped the flag and the hatchling sold at full shard value.
    const ctx = makeCtx(); ctx.setNow(1000);
    getOrCreateUser(ctx, 'a', 'a'); getOrCreateUser(ctx, 'b', 'b');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();   // both sides ≥ 2★ gate
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'a', rarity: 'rare', source: 'expedition', obtainedAt: 0 }).returning().get();

    await dispatch(ctx, tradingModule, 'trade', {
      name: 'trade', sub: 'offer', user: 'a', options: { user: 'b', 'give-eggs': String(egg.id) },
    });
    const t = ctx.db.select().from(schema.trades).where(eq(schema.trades.fromUser, 'a')).get()!;
    await dispatch(ctx, tradingModule, 'trade', {
      name: 'trade', sub: 'accept', user: 'b', options: { id: t.id },
    });
    const moved = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!;
    expect(moved.userId).toBe('b');
    expect(moved.viaTrade).toBe(true);
    expect(moved.locked).toBe(false);            // accept unlocks, so 'b' can incubate it

    await dispatch(ctx, hatcheryModule, 'incubate', { name: 'incubate', user: 'b', options: { egg: egg.id } });
    ctx.setNow(ctx.now() + RARITY.rare.incubationMs + 1);
    await click(ctx, hatcheryModule, `hatch:crack:${egg.id}`, 'b');

    const dino = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'b')).get()!;
    expect(dino.viaTrade).toBe(true);
    const sale = sellDino(ctx, 'b', dino.id);
    expect(sale.shards).toBe(0);
    expect(sale.cash).toBeGreaterThan(0);        // cash still flows; only shards are denied
  });
```

- [ ] **Step 2: Run test to verify it pins the fix**

Run: `npx vitest run tests/journeys.test.ts -t "shard funnel"`
Expected: PASS (Task 6 is already in). To prove it is a real regression net, temporarily delete the `viaTrade: egg.viaTrade` line from `src/modules/hatchery/service.ts`, re-run, and confirm it FAILS at `expect(dino.viaTrade).toBe(true)`. Restore the line before continuing.

- [ ] **Step 3: Run the full suite and the typecheck gate**

Run: `npm test`
Expected: PASS, all files.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/journeys.test.ts
git commit -m "Pin the trade-to-hatch-to-sell shard funnel end to end"
```

---

## Task 8: One facility per kind in `buildLot`

**Files:**
- Modify: `src/modules/park/service.ts:12-14` (error classes), `:44-66` (`buildLot`)
- Test: `tests/park.test.ts` (describe `'park service'`, line 17)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export class DuplicateFacilityError extends Error {}` — thrown as `new DuplicateFacilityError(facility.name)`, i.e. its `message` carries the facility's display name (`'Visitor Center'`, `'Hatchery Lab'`, `'Food Court'`) for the catch site to render. `buildLot(ctx, userId, kind)` signature unchanged.

**Guard order:** the duplicate check goes **before** the lot-slot cap check. With three base slots and exactly three facility kinds, a player who owns all three is already at the cap, and "You already have a Food Court" is the actionable message where "All lots full" is merely true.

- [ ] **Step 1: Write the failing test**

In `tests/park.test.ts`, extend the service import on line 4 with `DuplicateFacilityError`. Add to `describe('park service', …)`:

```ts
  it('allows one facility of each kind and refuses a second, while paddocks still stack', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test:seed', 0);
    buildLot(ctx, 'u1', 'visitor_center');
    expect(() => buildLot(ctx, 'u1', 'visitor_center')).toThrow(DuplicateFacilityError);
    buildLot(ctx, 'u1', 'herbivore_paddock');
    buildLot(ctx, 'u1', 'herbivore_paddock');                          // paddocks are capacity, not upgrades
    expect(ctx.db.select().from(schema.lots).all()).toHaveLength(3);
  });

  it('names the facility on the duplicate error and charges nothing', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test:seed', 0);
    buildLot(ctx, 'u1', 'food_court');
    const before = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash;
    expect(() => buildLot(ctx, 'u1', 'food_court')).toThrow('Food Court');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(before);
    expect(ctx.db.select().from(schema.lots).all()).toHaveLength(1);
  });
```

No `ratingHighWater` bump is needed: the first test ends with exactly three lots, which is the base cap (`lotSlots(0)` is `BASE_LOT_SLOTS_FALLBACK` = 3, `src/data/progression.ts:19-21`), and the rejected duplicate never reaches the cap check because the new guard runs before it. Total cost is 5,000 + 2,000 + 2,000 against the 100,000 seed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/park.test.ts -t "one facility of each kind"`
Expected: FAIL — `DuplicateFacilityError` is not exported, so the file does not even compile under vitest's transpile. After adding the bare class (step 3) but before the guard, it fails with "received function did not throw".

- [ ] **Step 3: Write the implementation**

In `src/modules/park/service.ts`, add the class beside the existing two (line 13):

```ts
export class LotLimitError extends Error {}
export class UnknownKindError extends Error {}
// Carries the facility's display name as its message so /build can name it in the reply.
// LotLimitError has no message, which is why its text is hardcoded at the call site.
export class DuplicateFacilityError extends Error {}
```

Rewrite the head of `buildLot` (lines 44-51) to reuse the lot rows it already fetches:

```ts
export function buildLot(ctx: Ctx, userId: string, kind: string): Lot {
  const paddock = PADDOCKS[kind]; const facility = FACILITIES[kind];
  if (!paddock && !facility) throw new UnknownKindError(kind);
  const lots = ctx.db.select().from(schema.lots)
    .where(eq(schema.lots.userId, userId)).all();
  // One facility per kind. capHours/incubatorSlots/facilityBonusPct each resolve a kind
  // to its best row, so a second one costs cash and changes nothing. Paddocks are exempt:
  // building more of one kind IS the capacity progression.
  // Checked before the slot cap: with 3 base slots and 3 facility kinds a player who owns
  // all three is already capped, and naming the facility is the more actionable message.
  if (facility && lots.some((l) => l.kind === kind)) throw new DuplicateFacilityError(facility.name);
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;
  if (lots.length >= lotSlots(user.ratingHighWater)) throw new LotLimitError();
  const cost = paddock ? paddock.buildCost : facility!.buildCost;
```

Everything from the `// Charge + insert must be atomic` comment onward is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/park.test.ts`
Expected: PASS. Watch three pre-existing tests specifically — line 26 (`'builds lots up to the slot limit'`, one of each facility then a duplicate paddock → `LotLimitError`), line 278 (`'/build maps LotLimitError…'`, three identical paddocks), and line 76 (the raw-trigger rollback test, which uses a paddock and so never reaches the new guard).

- [ ] **Step 5: Commit**

```bash
git add src/modules/park/service.ts tests/park.test.ts
git commit -m "Allow only one facility of each kind per park"
```

---

## Task 9: `/build` reply arm for the duplicate error

**Files:**
- Modify: `src/modules/park/index.ts:5` (import), `:137-141` (catch chain)
- Test: `tests/park.test.ts` (describe at line 242)

**Interfaces:**
- Consumes: Task 8's `DuplicateFacilityError`, whose `message` is the facility display name.
- Produces: `/build` replies ephemerally with `` `You already have a ${e.message} — upgrade it instead.` ``

- [ ] **Step 1: Write the failing test**

In `tests/park.test.ts`, add to the `describe('/upgrade, /decorate, /park rename, /dino unassign, park:collect', …)` block:

```ts
  it('/build maps DuplicateFacilityError to an ephemeral reply naming the facility', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    buildLot(ctx, 'u1', 'visitor_center');
    const cmd = parkModule.commands.find((c) => c.data.name === 'build')!;
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'visitor_center' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toBe('You already have a Visitor Center — upgrade it instead.');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
```

`MessageFlags` must be imported from `discord.js` in this file if it is not already — check the import block at the top and add it if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/park.test.ts -t "DuplicateFacilityError to an ephemeral"`
Expected: FAIL — the error escapes the catch chain's `else throw e`, so the test fails with the thrown `DuplicateFacilityError` rather than an assertion message.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/park/index.ts`, extend the service import on line 5 with `DuplicateFacilityError`, then add the arm at the head of `/build`'s catch chain (line 137):

```ts
        } catch (e) {
          if (e instanceof DuplicateFacilityError) await i.reply({ content: `You already have a ${e.message} — upgrade it instead.`, flags: MessageFlags.Ephemeral });
          else if (e instanceof LotLimitError) await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
```

`/upgrade`'s catch chain is not touched — `DuplicateFacilityError` is thrown only by `buildLot`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/park.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/park/index.ts tests/park.test.ts
git commit -m "Tell /build users which facility they already own"
```

---

## Task 10: Resolve every facility kind to its best row

**Files:**
- Modify: `src/modules/park/service.ts:34-42` (`facilityBonusPct`, `capHours`, new `facilityLevel`), `src/modules/hatchery/service.ts:15-18` (`incubatorSlots`)
- Test: `tests/park.test.ts` (describe `'park service'`, line 17), `tests/hatchery.test.ts` (describe `'hatchery'`, line 31)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function facilityLevel(lots: Lot[], kind: string): number` in `src/modules/park/service.ts` — the highest `level` among lots of that kind, or `0` when absent. `capHours(lots: Lot[]): number`, `facilityBonusPct(lots: Lot[]): number` and `incubatorSlots(lots: Lot[]): number` keep their signatures and their absent-facility defaults (8 hours, 0 %, 1 slot).

**Bounds trap:** `Math.max()` over an empty array is `-Infinity`, and neither resolver guards its array index — `capHours![-Infinity - 1]` is `undefined`, which would flow into `accruedIncome` as `NaN`. `facilityLevel` therefore returns `0` for the no-match case and every caller branches on `level > 0`, never indexing with a computed maximum directly.

`src/modules/hatchery/service.ts` already imports `type { Lot } from '../park/service.js'` (line 10), so importing the value alongside it adds no new dependency direction.

- [ ] **Step 1: Write the failing tests**

In `tests/park.test.ts`, add a local lot seeder near the top of the file (copy the shape from `tests/autocomplete-park.test.ts:9` — `park.test.ts` has none today, because every lot in it comes from `buildLot`, which now refuses duplicates):

```ts
// Direct insert, because buildLot refuses a duplicate facility — these rows simulate
// the pre-existing duplicates on a live DB that the fix deliberately does not migrate.
const seedLot = (over: Partial<typeof schema.lots.$inferInsert> = {}) =>
  ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'facility', kind: 'visitor_center', name: 'Visitor Center', ...over,
  }).returning().get();
```

Add to `describe('park service', …)`:

```ts
  it('resolves duplicate facility rows to the best one, for cap and for income alike', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Level 2 first, not level 1: a level-1 Visitor Center contributes 0% income, which
    // would make the summing and max-per-kind answers identical and prove nothing.
    seedLot({ level: 2 });                                             // built first, the one find() returns
    seedLot({ level: 4 });                                             // the one actually upgraded
    seedLot({ type: 'facility', kind: 'food_court', name: 'Food Court', level: 2 });
    const lots = ctx.db.select().from(schema.lots).all();
    expect(capHours(lots)).toBe(20);                                   // capHours[3], not the lvl-2 row's 12
    expect(facilityBonusPct(lots)).toBe(23);                           // VC lvl4 15% + Food Court lvl2 8%,
                                                                       // not 5+15+8 summed across both VCs
  });

  it('keeps the no-facility defaults', () => {
    expect(capHours([])).toBe(8);
    expect(facilityBonusPct([])).toBe(0);
  });

  it('ignores paddock rows when resolving facilities', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    seedLot({ type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock', level: 4 });
    const lots = ctx.db.select().from(schema.lots).all();
    expect(capHours(lots)).toBe(8);
    expect(facilityBonusPct(lots)).toBe(0);
  });
```

In `tests/hatchery.test.ts`, add to `describe('hatchery', …)`:

```ts
  it('incubator slots come from the best Hatchery Lab, not the first one built', () => {
    const lab = (level: number) => ctx.db.insert(schema.lots)
      .values({ userId: 'u1', type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab', level })
      .returning().get();
    const lots = [lab(1), lab(3)];
    expect(incubatorSlots(lots)).toBe(3);
    expect(incubatorSlots([])).toBe(1);
  });
```

Verify the expected numbers against `src/data/facilities.ts` before running: `visitor_center.capHours = [8, 12, 16, 20, 24]`, `visitor_center.incomeBonusPct = [0, 5, 10, 15, 20]`, `food_court.incomeBonusPct = [4, 8, 12]`, `hatchery_lab.incubatorSlots = [1, 2, 3]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/park.test.ts -t "best one"`
Expected: FAIL — `capHours` returns 12 (the first-built level-2 row) instead of 20, and `facilityBonusPct` returns 28 (5 + 15 + 8, summed across both Visitor Centers) instead of 23.

Run: `npx vitest run tests/hatchery.test.ts -t "best Hatchery Lab"`
Expected: FAIL — returns 1.

- [ ] **Step 3: Write the implementation**

In `src/modules/park/service.ts`, replace `facilityBonusPct` and `capHours` (lines 34-42):

```ts
// Best row per kind. buildLot now blocks new duplicates, but rows that predate that block
// still exist on live databases, and `find` resolved them to whichever the unordered SELECT
// returned first — usually the lowest id, i.e. the one the player did NOT upgrade.
// Returns 0 when the kind is absent; callers branch on that rather than indexing with a
// computed maximum, because Math.max() of an empty list is -Infinity and neither level
// table guards its index.
export function facilityLevel(lots: Lot[], kind: string): number {
  return lots.reduce((best, l) => (l.kind === kind && l.level > best ? l.level : best), 0);
}

export function facilityBonusPct(lots: Lot[]): number {
  return Object.keys(FACILITIES).reduce((sum, kind) => {
    const level = facilityLevel(lots, kind);
    return sum + (level > 0 ? FACILITIES[kind].incomeBonusPct[level - 1] ?? 0 : 0);
  }, 0);
}

export function capHours(lots: Lot[]): number {
  const level = facilityLevel(lots, 'visitor_center');
  return level > 0 ? FACILITIES.visitor_center.capHours![level - 1] : 8;
}
```

Iterating `FACILITIES` keys rather than filtering `l.type === 'facility'` is deliberate: it makes an unknown `kind` incapable of contributing, and `buildLot` derives `type` from `kind` so the two can never disagree.

In `src/modules/hatchery/service.ts`, line 10 currently reads `import type { Lot } from '../park/service.js';` — a **type-only** import, which cannot carry a function. Replace it with a value import:

```ts
import { facilityLevel, type Lot } from '../park/service.js';
```

Then rewrite `incubatorSlots` (lines 15-18):

```ts
export function incubatorSlots(lots: Lot[]): number {
  const level = facilityLevel(lots, 'hatchery_lab');
  return level > 0 ? FACILITIES.hatchery_lab.incubatorSlots![level - 1] : 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/park.test.ts tests/hatchery.test.ts`
Expected: PASS. Watch `tests/park.test.ts:36` (`'derives capHours and bonus from facilities'`, one VC + one Food Court → `capHours` 8, bonus 4) and `tests/hatchery.test.ts:42` (`incubatorSlots([])` → 1) — both single/zero-row cases must be unchanged.

Run: `npm test`
Expected: PASS. `pendingIncome` and the `/park view` capped banner both read `capHours`; `tests/journeys.test.ts` and `tests/clock.test.ts` exercise the income maths.

- [ ] **Step 5: Commit**

```bash
git add src/modules/park/service.ts src/modules/hatchery/service.ts tests/park.test.ts tests/hatchery.test.ts
git commit -m "Resolve each facility kind to its highest-level lot"
```

---

## Task 11: Document the two new rules

**Files:**
- Modify: `src/modules/help/index.ts:24` (park topic), `:31-36` (eggs topic)
- Modify: `CLAUDE.md`
- Test: `tests/help.test.ts` (no new test — the existing assertions must stay green)

**Interfaces:**
- Consumes: the behavior from Tasks 2-4 and 8-10.
- Produces: no code interface. Topic KEYS are unchanged, so `/help`'s builder choices are unchanged and `npm run deploy-commands` is still not needed.

Both `HELP_TOPICS` edits are embed body text. `tests/help.test.ts:14` counts fields against `Object.keys(HELP_TOPICS).length` (derived) and `:53` lists art-bearing topic keys (unchanged) — neither breaks on body text.

- [ ] **Step 1: Update the `/help` copy**

In `src/modules/help/index.ts`, in the `park` topic body, replace the `/build` line:

```ts
    '`/build kind:<lot>` — build on an empty lot. Paddocks stack; one facility of each kind, so upgrade rather than rebuild.',
```

In the `eggs` topic body, add a fourth line after the `/hatch` line and before `/mythic`:

```ts
    'An egg you have offered in a trade is locked 🔒 — incubate and hatch are blocked until the trade resolves.',
```

- [ ] **Step 2: Verify the help tests and payload limits**

Run: `npx vitest run tests/help.test.ts`
Expected: PASS. The harness validates every reply against Discord's message limits, so a topic body that outgrew the 4096-character description cap would fail here — both edits are one line each, far under it.

- [ ] **Step 3: Record the invariants in CLAUDE.md**

Add a bullet to `CLAUDE.md`, near the trading/hatchery material. Write the *why*, not the *what*:

```markdown
- Trade escrow is enforced at every path that CONSUMES an item, never at paths that
  merely use one: `sellDino`, `incubateEgg` and `hatchEgg` all reject `locked` rows,
  while battling a locked dino stays legal (`src/modules/battles/service.ts`) because
  it neither consumes nor transfers. `createTrade` is the only writer of
  `eggs.locked = true`, and its `verifySide` refuses an incubating egg, so a locked
  *and* incubating row can only be legacy data — `hatchEgg`'s guard is unreachable
  through the public API and its test must lock the row with a raw `ctx.db.update`.
  Because `expireStale` is lazy (no timer sweeps it; its call sites are all in
  `src/modules/trading/index.ts`), every hatchery entry point — both executes and both
  autocomplete providers — calls it before reading eggs, or a dead trade would reject
  with a lock that no longer exists. `/sell` still has that staleness gap for dinos.
- Provenance survives the hatch: `hatchEgg` inserts the dino with
  `viaTrade: egg.viaTrade`. `eggs.viaTrade` had no reader before this; the three
  readers of `dinos.viaTrade` are all in the shop module, so dropping it at the hatch
  boundary silently reopened the alt-to-main shard funnel.
- One facility of each kind per park (`buildLot` throws `DuplicateFacilityError`,
  whose `message` is the facility's display name). Paddocks stay duplicable — more of
  one kind IS the capacity progression. `facilityLevel` (`src/modules/park/service.ts`)
  resolves a kind to its highest-level row and is the single source for `capHours`,
  `facilityBonusPct` and `incubatorSlots`, so pre-existing duplicate rows on a live DB
  resolve to the best facility rather than to whichever the unordered SELECT returned
  first. It returns 0 for an absent kind on purpose: `Math.max()` over an empty array
  is `-Infinity` and neither level table guards its index, so a bare reduce would
  return `undefined` and poison `accruedIncome` with `NaN`. There is no cleanup
  migration and no way to delete a duplicate lot short of `adminReset`.
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/help/index.ts CLAUDE.md
git commit -m "Document the escrow, provenance and one-facility rules"
```

---

## Task 12: Full verification and branch wrap-up

**Files:** none modified unless a gate fails.

**Interfaces:**
- Consumes: every prior task.
- Produces: a branch ready for review.

- [ ] **Step 1: Run both gates**

Run: `npm test`
Expected: PASS, zero failures. Record the total test count — it was 648 before this work.

Run: `npm run typecheck`
Expected: exit 0, no output. This is the only gate that typechecks `tests/`, and every task in this plan touched test files.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 2: Confirm no builder changed**

Run: `git diff main --stat`
Expected: the changed-file list matches the File Structure section exactly — seven source files, five test files, `CLAUDE.md`, and the two spec commits. If `src/deploy-commands.ts`, `src/core/module-list.ts`, `modules.json`, or `tests/contract.test.ts` appear, a command builder was touched and `npm run deploy-commands` is now required — stop and reassess.

Run: `git diff main -- src | grep -E "SlashCommandBuilder|addStringOption|addIntegerOption|setAutocomplete|addChoices"`
Expected: no output.

- [ ] **Step 3: Verify the three bugs are actually closed**

Run: `npx vitest run tests/journeys.test.ts tests/hatchery.test.ts tests/park.test.ts tests/autocomplete-hatchery.test.ts tests/autocomplete-kit.test.ts`
Expected: PASS. These five files carry every regression this plan adds.

- [ ] **Step 4: Report**

State the before/after test counts, confirm both gates passed with their actual output, and note that no operator step is required — no `deploy-commands`, no `deploy-emojis`, no migration. `npm run test:live` is optional here: no embed art changed, and the only visual change is the 🔒 line in `/eggs`.
