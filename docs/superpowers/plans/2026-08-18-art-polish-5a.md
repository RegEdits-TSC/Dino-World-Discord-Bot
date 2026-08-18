# Art Coverage and Hardening Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every bare or borrowed user-visible surface its own art, give the six guest attractions art on the park map and the eight rarest species portraits of their own, and fix every defect a full seventeen-module adversarial sweep confirms.

**Architecture:** Species art is an optional override resolved by filename with a fallback to the existing archetype art, so adding a species stays a data-only change. Attraction art is a new `ParkArt` family loaded through the renderer's existing never-rejecting loader and drawn as a full-cell band, with the current flat-fill path preserved byte-for-byte as the missing-art degrade. Banner coverage is pure wiring through the existing `attach()` helper. No migration, no new command, no builder change.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js, drizzle + better-sqlite3 (synchronous), `@napi-rs/canvas` for the park renderer, vitest, Higgsfield `nano_banana_pro` for raster generation.

**Spec:** `docs/superpowers/specs/2026-08-18-art-polish-5a-design.md`
**Baseline:** `main` @ `23bb1cf` — 17 modules, 29 commands, 111 test files, 53 custom emoji, 26 banners

## Global Constraints

Every task's requirements implicitly include this section.

**Language and idiom**
- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()` / `Math.random()`. Tests inject both via `makeCtx` (`tests/harness.ts`).
- DB access is synchronous drizzle/better-sqlite3 (`.get()` / `.all()` / `.run()`), never awaited.

**Art wiring**
- Embed art is wired **only** through `attach(embed, payload, slot, ref)`. Hand-assigning `payload.files` is banned outright by `tests/images.test.ts`.
- The single exception is `fightFrames` (`src/modules/battles/embeds.ts`), whose refs are dressed onto several embeds and split across two payloads by the F1/F4 contract. Do not convert it.
- `attach` appends, and **call order is upload order** — several tests pin `files.map((f) => f.name)` with `toEqual`. Never reorder, hoist, or collect refs into an array first.
- A payload reaching `deliverNotification` must carry **no** `attachments` key. F1 and F4 of `fightFrames` must carry `attachments: []` unconditionally. These are opposite rules for opposite reasons; both are load-bearing.

**Asset formats**
- Every file under `assets/images/` is WebP q95. Banners are 1536×1024, cutouts 1024² with a 31px margin, tile bands 270×150.
- `assets/emojis/png/` is PNG (Discord's upload expects it and `manifest.json` hashes those exact bytes) and `assets/emojis/svg/` is SVG (the park renderer needs synchronous decode). Neither is WebP.
- Never stage a test fixture inside `assets/images/` — vitest runs test files in parallel forks, so a write or delete on a committed asset path can be observed by another file mid-run. Mock `assetImage` instead.

**Emoji**
- Never call `emojiTag` in a module-level constant — the map loads after client ready, which would freeze the unicode fallback permanently.
- Never put a custom emoji tag in an autocomplete label — Discord renders it as literal text there.
- Never pass `rarityEmoji(...)` to `ButtonBuilder.setEmoji` — unlike every other call site it throws rather than degrading.

**Gates**
- `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) is the test-inclusive gate. `npm run build` covers only `src`, and vitest transpiles without typechecking — a type error in a test file passes both.
- `tests/contract.test.ts` must stay at **29** commands. That number holding is the proof no builder changed, which is what makes `deploy-commands` unnecessary for this release.
- Never skip, weaken, comment out or delete a test to make a change pass.

**Authorship**
- Commit messages, PR bodies, code comments and documentation are authored by RegEdits-TSC. Never mention Claude, Anthropic, AI, LLMs, assistants or any tool in any durable artifact. No `Co-Authored-By` trailer, no generated-with footer, no AI-referencing branch name.

**Operations**
- Exactly one bot process per token. Duplicate instances produce 10062 on every command, which reads as a code bug and is not one.
- Dependencies, actions and runtimes stay pinned to current latest stable.

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `assets/images/banners/{guests,dex,landmark,season,duel,battles}.webp` | 6 embed banners, 1536×1024 |
| `assets/images/park/attraction-{picnic_lawn,gift_shop,viewing_platform,amber_carousel,sky_gondola,grand_atrium}.webp` | 6 park-map tile bands, 270×150 |
| `assets/images/dinos/{tyrannosaurus,spinoraptor,liopleurodon,mosasaurus,quetzalcoatlus,indominus,indoraptor,ultimasaurus}.webp` | 8 hero species cutouts, 1024² |
| `assets/emojis/svg/dw_{guest,season,duel,landmark}.svg` + rendered PNGs | 4 custom emoji |
| `docs/superpowers/plans/2026-08-18-sweep-findings.md` | Output of the adversarial sweep |

**Modified**

| Path | Change |
|---|---|
| `src/core/images.ts` | adds `dinoImage()` — species override with archetype fallback |
| `src/core/render/art.ts` | `ParkArt.attractions` family, loaded via the existing `raster()` helper in the existing `Promise.all` |
| `src/core/render/draw.ts` | `drawAttraction` gains an `img` parameter and an art path; null branch unchanged |
| `src/modules/guests/{embeds,index,service}.ts` | `Payload` gains `files`; banner wiring; **F1** — `recomputeRating` restricted to `build`/`claim` |
| `src/modules/park/attendance.ts` | **F2** — `attendanceOf` becomes time-aware, stays pure |
| `src/modules/dex/embeds.ts` | banner wiring only — its `Payload` already declares `files` |
| `src/modules/park/{embeds,index}.ts` | landmark banner; `dinoImage` at the featured-dino thumbnail |
| `src/modules/park/alert-embeds.ts` | season arm switches to the season banner; still no `attachments` key |
| `src/modules/daily/{embeds,season-embeds}.ts` | season banner; claim-payload rewires |
| `src/modules/duels/embeds.ts` | duel banner; `dinoImage` at the lead thumbnail |
| `src/modules/hatchery/embeds.ts` | `dinoImage` at the reveal thumbnail |
| `src/modules/battles/embeds.ts` | `dinoImage` at the lead-enemy thumbnail, preserving the raw-ref F1/F4 contract |
| `src/modules/help/index.ts` | art on the `daily`, `guests`, `duel`, `battles` and `eggs` topics — **no new topic key** |
| `scripts/fit-art.mjs` | new `band` mode, 270×150 cover-scale |
| `docs/assets/prompts.md`, `docs/ops.md` | prompt rows and the machine-checked asset counts |

**Test files touched:** `tests/images.test.ts`, `tests/emojis.test.ts`, `tests/emoji-assets.test.ts`, `tests/help.test.ts`, `tests/docs-assets.test.ts`, `tests/park-art-assets.test.ts`, `tests/render-draw.test.ts`, `tests/render-art.test.ts`, `tests/guests.test.ts`, `tests/attendance.test.ts`, `tests/park.test.ts`, `tests/duels.test.ts`, `tests/dex.test.ts`, `tests/hatchery.test.ts`.

## Ordering and rationale

The defect fixes land first because they are live on the bot and independent of every asset. The sweep runs before asset generation for the reason the spec gives: a finding needing a migration or a retune changes the shape of the release, and discovering it after twenty assets are committed wastes the art work.

Within the art work, plumbing precedes assets everywhere. `tests/images.test.ts` fails in **both** directions for banners — a wired call site with no file, and a committed file with no call site — so each banner's asset and its wiring must land in one commit. The park-art and species families have no such symmetry today, which is why this plan adds directory-enumerating gates for them before the files they guard exist.

| Phase | Tasks | Deliverable |
|---|---|---|
| A — Live defects | 1–2 | Both confirmed guests defects fixed with regression tests |
| B — Foundations | 3–5 | `dinoImage`, the new asset gates, `fit-art.mjs band` |
| C — Banners | 6–12 | 6 banners wired, 4 borrows dropped, 3 bare payloads dressed |
| D — Park attractions | 13–15 | `ParkArt` family, the art path, 6 committed bands |
| E — Hero species | 16–17 | 8 portraits with per-species coverage and end-to-end override tests |
| F — Emoji | 18 | 4 emoji, 53 → 57 |
| G — Sweep | 19–20 | Findings document, then a fix and regression test per confirmed defect |
| H — Release | 21 | Full gate, then the operator runbook |

---

### Task 1: F1 — make `/guests view` a pure read that cannot restamp park rating

**Files:**
- Modify: `src/modules/guests/index.ts:26-73` (the `execute` body — move the `recomputeRating` call out of the dispatch preamble and into the `build` and `claim` arms only)
- Test: `tests/guests.test.ts` (one new test in the `describe('/guests')` block; plus a rewrite of the existing test at `tests/guests.test.ts:314-342`, which asserts the behaviour this task deliberately removes and would otherwise fail)

**Interfaces:**
- Consumes: `recomputeRating(ctx: Ctx, userId: string): { rating: number; highWater: number }` from `src/modules/park/rating.ts`; `getOrCreateUser(ctx: Ctx, userId: string, displayName: string)` and `buildLot(ctx: Ctx, userId: string, kind: string): Lot` from `src/modules/park/service.ts`; `makeCtx()`, `fakeCommand({ name, sub, user, options? })`, `replyText(r)` from `tests/harness.ts`.
- Produces: no signature changes. `guestsModule.commands[0].execute` keeps its exact shape; the only behavioural contract added is **`/guests view` performs zero writes to `users`**. Later tasks may rely on `/guests build` and `/guests claim` still stamping `attendanceHighWater` before they read it.

---

- [ ] **Step 1: Write the failing test**

Add this import line to `tests/guests.test.ts`, directly beneath the existing `park/service.js` import at line 6:

```ts
import { recomputeRating } from '../src/modules/park/rating.js';
```

Then add this test inside the `describe('/guests', …)` block, immediately **before** the existing test that begins `it('view stamps the attendance high-water before it reads it, …`:

```ts
  it('view never restamps the live park rating, so reading the screen cannot revoke /trade', async () => {
    // No rich(): this fixture is about parkRating, not cash. Eight herbivore species in
    // one L1 herbivore paddock, all fed at t=0 — parkRaw 1, collection weight 22/190,
    // comfort 0.75 (correct diet, no decor).
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 500_000 }, 'test:seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const species = [
      'triceratops', 'stegosaurus', 'parasaurolophus', 'iguanodon',
      'ankylosaurus', 'brachiosaurus', 'gallimimus', 'maiasaura',
    ];
    ctx.db.insert(schema.dinos).values(species.map((speciesId) => ({
      userId: 'u1', lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }))).run();
    // Stamp the rating once at full comfort, exactly as a real build/feed/assign would.
    recomputeRating(ctx, 'u1');
    const before = ctx.db.select().from(schema.users).all()[0].parkRating;
    expect(before).toBe(243);

    // 20h of hunger drain: comfort has fallen to 58.33% of its fed value, but escapeAt
    // for this fixture is 40h, so nothing has escaped and the ONLY term that moved is
    // comfort. That isolates the defect from the escaped-dino one.
    ctx.setNow(20 * 3_600_000);

    const i = fakeCommand({ name: 'guests', sub: 'view', user: 'u1' });
    await cmd().execute(ctx, i.asChatInput());

    // The whole point: a read path may not move the column liveRating() checks against
    // TRADE_MIN_RATING at both createTrade and acceptTrade.
    expect(ctx.db.select().from(schema.users).all()[0].parkRating).toBe(before);
    expect(i.replies).toHaveLength(1);   // and the screen still rendered

    // Not vacuous: a recompute at this same instant genuinely lowers the stored value by
    // 79 points (0.79 star). If this line ever stops dropping, the assertion above has
    // stopped proving anything and the fixture needs rebuilding, not the assertion.
    expect(recomputeRating(ctx, 'u1').rating).toBe(164);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/guests.test.ts -t "view never restamps the live park rating"`

Expected: FAIL with `AssertionError: expected 164 to be 243 // Object.is equality` at the `expect(ctx.db.select().from(schema.users).all()[0].parkRating).toBe(before)` line — `/guests view` recomputed and wrote the decayed rating.

- [ ] **Step 3: Rewrite the existing high-water test to the new contract**

The test currently at `tests/guests.test.ts:314-342` asserts that `view` stamps `attendanceHighWater`. That is the behaviour being removed, so it must be re-pointed at the arm that still stamps. Its underlying concern — a pre-migration account with a stored high-water of 0 must still reach its rewards — survives intact on the `claim` arm. Replace the whole test with:

```ts
  it('claim stamps the attendance high-water before it reads it, so a pre-migration account is not locked out of its rewards — and view never does', async () => {
    // No rich() here — attendanceHighWater is left at its migration default of 0, the
    // same starting point as every account that existed before this column shipped.
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 500_000 }, 'test:seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const species = [
      'triceratops', 'stegosaurus', 'parasaurolophus', 'iguanodon', 'ankylosaurus',
      'brachiosaurus', 'gallimimus', 'maiasaura', 'massospondylus', 'ouranosaurus',
    ];
    ctx.db.insert(schema.dinos).values(species.map((speciesId) => ({
      userId: 'u1', lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }))).run();
    const liveAttendance = attendanceOf(ctx, 'u1').attendance;
    // Sanity: the fixture must actually clear the first milestone, or a stale
    // high-water of 0 and a correctly-stamped one would both fail to offer a claim
    // button and this test could pass for the wrong reason.
    expect(liveAttendance).toBeGreaterThanOrEqual(ATTENDANCE_MILESTONES[0].at);
    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(0);

    // view writes nothing at all — not the rating, and not the high-water either.
    const viewI = fakeCommand({ name: 'guests', sub: 'view', user: 'u1' });
    await cmd().execute(ctx, viewI.asChatInput());
    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(0);

    // claim leads directly to a payout, so it stamps first and then reads.
    const i = fakeCommand({ name: 'guests', sub: 'claim', user: 'u1' });
    await cmd().execute(ctx, i.asChatInput());

    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(liveAttendance);
    const reply = i.replies[0] as { embeds: EmbedBuilder[]; components?: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> };
    expect(reply.components).toHaveLength(1);
    expect(reply.components![0].toJSON().components[0].custom_id)
      .toBe(`guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`);
  });
```

- [ ] **Step 4: Run the rewritten test to verify it also fails**

Run: `npx vitest run tests/guests.test.ts -t "claim stamps the attendance high-water"`

Expected: FAIL with `AssertionError: expected 250 to be +0 // Object.is equality` — `/guests view` stamped the high-water to 250 when it should have left it at 0.

- [ ] **Step 5: Move `recomputeRating` out of the dispatch preamble into the two mutating arms**

In `src/modules/guests/index.ts`, replace the block that currently runs from the `getOrCreateUser` call through the `case 'claim':` arm (lines 27-70) with this. The unconditional call and the comment justifying it are deleted; three new comments record why each arm now does what it does:

```ts
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        // A real switch with a default arm, never a fallthrough to the view: the /park
        // dispatch trap (a new subcommand silently rendering the dashboard and reporting
        // success for a command that did nothing) is what this shape exists to avoid.
        switch (i.options.getSubcommand()) {
          // view is a PURE READ, and recomputeRating must never be hoisted back above this
          // switch. It used to run for every subcommand, to stamp the attendance high-water
          // before anything read it — but it writes three columns in one UPDATE, and one of
          // them is parkRating, the LIVE value, which falls freely as comfort decays.
          // liveRating (../trading/service.ts) is a plain SELECT of that column, checked
          // against TRADE_MIN_RATING at both createTrade and acceptTrade, so opening this
          // screen after a few hours of hunger drain could drop a park below the trade gate
          // and kill a pending offer — a state change caused by reading a screen. /park view
          // deliberately never recomputes either. The high-water still advances on every
          // build, claim, feed, assign, upgrade and decorate, so nothing becomes unreachable.
          case 'view':
            await i.reply(guestsPayload(ctx, i.user.id));
            return;
          case 'build': {
            // Stamped here because buildAttraction reads the high-water as its unlock gate:
            // every account predating that column starts at a stored 0, so without this the
            // catalog would refuse a kind the dashboard already shows as earned. This arm
            // mutates regardless, so the parkRating write riding along carries no surprise.
            recomputeRating(ctx, i.user.id);
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
            // Same reason as build: claimableMilestones gates on the stored high-water, so a
            // pre-migration account would be offered nothing until some other command
            // stamped it. This arm leads straight to a payout, so the write belongs here.
            recomputeRating(ctx, i.user.id);
            await i.reply(milestonePayload(ctx, i.user.id));
            return;
```

Leave the rest of the file — the `default:` arm, the closing braces and the whole `components` array — exactly as it is. The `recomputeRating` import at line 4 is still used and must stay.

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npx vitest run tests/guests.test.ts`

Expected: PASS — 28 tests in the file, including `view never restamps the live park rating, so reading the screen cannot revoke /trade` and `claim stamps the attendance high-water before it reads it, …`.

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npx vitest run`

Expected: all pass — 109 test files, 1795 tests (one more than the 1794 baseline).

- [ ] **Step 8: Commit**

```bash
git add src/modules/guests/index.ts tests/guests.test.ts
git commit -m "Stop /guests view from restamping the live park rating

recomputeRating ran for every /guests subcommand including view. It writes
parkRating in the same UPDATE as the two high-water columns, and parkRating
falls freely as comfort decays, so opening the guests screen after a few hours
of hunger drain rewrote a park's stored rating downward. liveRating checks that
column against TRADE_MIN_RATING at both createTrade and acceptTrade, so a read
path could revoke trading and kill a pending offer, leaving the counterparty's
escrowed dino locked for nothing.

The call now runs only on the build and claim arms, which mutate anyway and
which both read the attendance high-water as a gate. view becomes a pure read,
matching /park view. The high-water still advances on every build, claim, feed,
assign, upgrade and decorate, so no reward becomes unreachable.

The existing high-water test moves to the claim arm and additionally pins that
view writes nothing."
```

---

### Task 2: F2 — make `attendanceOf` time-aware without making it write

**Files:**
- Modify: `src/modules/park/attendance.ts:1-36` (import `escapeMoment`, rewrite the predicate and the docblock paragraph that justifies the stored-column read)
- Modify: `src/modules/leaderboards/service.ts:160-164` (comment only — it claims the board's predicate matches `attendanceOf`'s byte for byte, which stops being true)
- Test: `tests/attendance.test.ts` (one new test in the `describe('attendanceOf')` block)

**Interfaces:**
- Consumes: `escapeMoment(d: ClockDino, from: number): number | null` from `src/core/clock.ts` — returns the stored `escapedAt` when one is set, otherwise the computed `escapeAt(d)` if it is `<= from`, otherwise `null`. It is a **pure** function of a `ClockDino` and an instant; `settleEscapes` (`src/modules/park/escapes.ts`) is the writing variant and must not be used here. `eligibleDinos` (`src/modules/duels/service.ts:43-50`) is the existing precedent for this exact read-only filter idiom on another player's park.
- Produces: `attendanceOf(ctx: Ctx, userId: string): Attendance` — unchanged signature, unchanged `{ attendance, distinctSpecies, drawTotal, vcLevel }` return shape, and unchanged purity guarantee. Only the `distinctSpecies` term's membership rule changes. `recomputeRating` remains the sole writer of `attendanceHighWater`.

---

- [ ] **Step 1: Write the failing test**

Add this test to `tests/attendance.test.ts` inside the `describe('attendanceOf', …)` block, immediately **before** the existing `it('recomputeRating stamps a monotone attendance high-water', …)`. The file already imports `makeCtx`, `schema`, `recomputeRating` and `attendanceOf`, and already defines the `seedPark` helper at line 72 — no new imports are needed:

```ts
  it('drops a live-escaped dino whose escape has never been settled, and banks nothing for it', () => {
    const ctx = makeCtx();
    const lot = seedPark(ctx);
    const species = [
      'triceratops', 'stegosaurus', 'parasaurolophus', 'iguanodon',
      'ankylosaurus', 'brachiosaurus', 'gallimimus', 'maiasaura',
      'massospondylus', 'ouranosaurus', 'dryosaurus', 'othnielia',
    ];
    // escapedAt is left NULL on every row and stays that way for the whole test — that is
    // the entire point. Neither /guests build nor /build nor /upgrade calls settleEscapes,
    // so a park can sit for weeks with live-escaped dinos whose column was never stamped.
    ctx.db.insert(schema.dinos).values(species.map((speciesId) => ({
      userId: 'u1', lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }))).run();
    const fed = attendanceOf(ctx, 'u1');
    expect(fed.distinctSpecies).toBe(species.length);
    expect(fed.attendance).toBe(300);

    // 30 days, far past escapeAt (40h for a fed, undecorated herbivore paddock).
    ctx.setNow(30 * 86_400_000);
    expect(ctx.db.select().from(schema.dinos).all().every((d) => d.escapedAt === null)).toBe(true);

    const starved = attendanceOf(ctx, 'u1');
    expect(starved.distinctSpecies).toBe(0);
    expect(starved.attendance).toBe(0);
    // Still PURE: the fix is a time-aware FILTER, never a settling call. attendanceOf is
    // read for other players' parks (/top, a visit, another player's card), where writing
    // would settle escapes for a command that player never ran.
    expect(ctx.db.select().from(schema.dinos).all().every((d) => d.escapedAt === null)).toBe(true);

    // And the monotone high-water — which claimMilestone pays out on, with no path back
    // down — banks nothing for a park whose dinos are all long gone.
    recomputeRating(ctx, 'u1');
    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/attendance.test.ts -t "drops a live-escaped dino whose escape has never been settled"`

Expected: FAIL with `AssertionError: expected 12 to be +0 // Object.is equality` at `expect(starved.distinctSpecies).toBe(0)` — all twelve escaped dinos still count, and `attendanceHighWater` banks 300.

- [ ] **Step 3: Filter on the live escape instant in `attendanceOf`**

In `src/modules/park/attendance.ts`, add the `escapeMoment` import directly above the existing `./service.js` import (line 4):

```ts
import { escapeMoment } from '../../core/clock.js';
```

Replace this paragraph of the `attendanceOf` docblock:

```ts
 * The dino predicate is byte-identical to recomputeRating's `assigned` filter (./rating.ts:18)
 * on purpose: it reads the STORED escapedAt column, never the computed escapeAt instant, so
 * every surface that settles escapes first sees a fresh value and no surface has to settle
 * just to render a number.
```

with:

```ts
 * The dino predicate is TIME-AWARE, via escapeMoment (../../core/clock.js): it resolves a
 * stored escapedAt when one is set and otherwise computes the escape instant, so a dino that
 * is live-escaped but never settled stops counting the moment it crosses. Reading the stored
 * column alone let attendanceHighWater — monotone, and the column claimMilestone pays out on
 * with no path back down — bank guests from dinos that were long gone, because neither
 * /guests build nor /build nor /upgrade calls settleEscapes and nothing else had settled
 * them. ratingHighWater was never exposed to this shape: baseComfortAt is time-aware, so a
 * starving dino already contributes near-zero comfort there.
 *
 * This is a FILTER and never a settling call. escapeMoment is a pure read — the same reason
 * duels' eligibleDinos (../duels/service.ts) uses it instead of settleEscapes when resolving
 * a DEFENDER's squad from a command they never ran.
```

Then replace the predicate itself:

```ts
export function attendanceOf(ctx: Ctx, userId: string): Attendance {
  const { clockDinos, lots } = toClockDinos(ctx, userId);
  const now = ctx.now();
  const assigned = clockDinos.filter((d) => d.paddock !== null && escapeMoment(d, now) === null);
  const distinctSpecies = new Set(assigned.map((d) => d.species.id)).size;
```

Leave the rest of the function — the attractions read, the `levelValue` draw reduce, the `facilityLevel` lookup and the `attendanceFrom` call — untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/attendance.test.ts -t "drops a live-escaped dino whose escape has never been settled"`

Expected: PASS

- [ ] **Step 5: Correct the now-stale claim in the leaderboards docblock**

`attendanceScores` (`src/modules/leaderboards/service.ts`) reads the stored column across three batched queries and does not change here — the board is a standing, not a payout gate, and its rows converge the next time any command touches the park. But its comment at lines 160-164 asserts a byte-for-byte match that no longer holds, and a stale comment of exactly that kind is how the next reader reintroduces the defect. Replace:

```ts
 * The dino predicate matches attendanceOf/recomputeRating's `assigned` filter byte for
 * byte: a dino counts only when its lot is PADDOCK-typed (never a facility) and its
 * stored escapedAt is null. That is the STORED column, never the computed escape instant
 * — the same "no surface has to settle just to render a number" discipline attendanceOf
 * documents.
```

with:

```ts
 * The dino predicate matches recomputeRating's `assigned` filter: a dino counts only when
 * its lot is PADDOCK-typed (never a facility) and its stored escapedAt is null. It is
 * deliberately LAXER than attendanceOf, which resolves the live escape instant through
 * escapeMoment — so a board row can read higher than that player's own /guests view for a
 * park whose escapes nothing has settled yet, and converges the next time any command
 * touches it. Accepted: this board is a standing, and only the high-water attendanceOf
 * feeds — the column milestone payouts gate on, with no path back down — had to be exact.
```

- [ ] **Step 6: Run the full gate**

Run: `npm run typecheck && npx vitest run`

Expected: all pass — 109 test files, 1795 tests. In particular `tests/leaderboards.test.ts`'s `agrees with /guests view (attendanceOf) for the same player` still passes: its fixture runs at `nowMs = 0` with `lastFedAt: 0`, where nothing has escaped and the two predicates coincide.

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/attendance.ts src/modules/leaderboards/service.ts tests/attendance.test.ts
git commit -m "Filter attendance on live escape state, not the stored column

attendanceOf tested dinos with a bare escapedAt IS NULL check and no time term,
so a dino long past its escape instant kept counting toward the variety term
until something settled it. Nothing does: neither /guests build nor /build nor
/upgrade calls settleEscapes. recomputeRating then banked that phantom figure
into attendanceHighWater, which is monotone and is the column milestone claims
gate on, with no path back down. Measured on a twelve-species park thirty days
past its last feed: 300 attendance banked from a park with no living dinos, a
state that never simultaneously existed.

ratingHighWater was never exposed to this because baseComfortAt is time-aware.
Attendance now resolves each dino through escapeMoment, the same pure read duels
uses when eligibility must be judged without writing. attendanceOf stays pure --
it is read for other players' parks via /top and visits, where settling escapes
for a command that player never ran would be wrong twice over.

The board-wide twin in leaderboards keeps the stored column and its comment now
records that divergence as deliberate rather than claiming an exact match."
```

---

### Task 3: Species art override — `dinoImage` helper and all five dino-art call sites

**Files:**
- Create: `tests/dino-image.test.ts`
- Modify: `src/core/images.ts:19-24` (add `dinoImage` below `assetImage`)
- Modify: `src/modules/park/showcase.ts:46` and `src/modules/park/showcase.ts:65`
- Modify: `src/modules/park/embeds.ts:7` and `src/modules/park/embeds.ts:100-104`
- Modify: `src/modules/duels/embeds.ts:2` and `src/modules/duels/embeds.ts:54-57`
- Modify: `src/modules/dex/embeds.ts:5` and `src/modules/dex/embeds.ts:92`
- Modify: `src/modules/hatchery/embeds.ts:4` and `src/modules/hatchery/embeds.ts:50-53`
- Modify: `src/modules/battles/embeds.ts:2` and `src/modules/battles/embeds.ts:66-70`
- Modify: `CLAUDE.md:288-295`
- Test: `tests/images.test.ts:6` and `tests/images.test.ts:389-401` (append a `dinoImage` block)
- Test: `tests/park.test.ts:946-956` (fixture gains `speciesId`)
- Test: `tests/battles-embeds.test.ts:11-40` (mock factory gains `dinoImage`)
- Test: `tests/hatchery.test.ts:14`, `tests/hatchery.test.ts:21-28`, `tests/hatchery.test.ts:288-300`

**Interfaces:**
- Consumes: `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos', name: string): ImageRef | null` and `attach(embed: EmbedBuilder, payload: { files?: AttachmentBuilder[] }, slot: 'image' | 'thumbnail', ref: ImageRef | null): void`, both `src/core/images.ts`; `interface ImageRef { file: AttachmentBuilder; url: string }`; `getSpecies(id: string): Species` (`src/data/species/index.ts`); `rosterFor(stage, squadSize)` and `STAGES` (`src/data/battle/chapters/index.ts`); `makeCtx()` (`tests/harness.ts`); `getOrCreateUser(ctx, userId, displayName): User` (`src/modules/park/service.ts`); `resolveDuel(ctx, challengerId, defenderId, mode): DuelOutcome` (`src/modules/duels/service.ts`).
- Produces: `dinoImage(speciesId: string, archetype: string, diet: string): ImageRef | null` exported from `src/core/images.ts` — later tasks (the hero-portrait asset drop, the cross-kind basename collision gate) depend on this exact name and signature, and on the rule that a committed `assets/images/dinos/<speciesId>.webp` wins over `assets/images/dinos/<archetype>-<diet>.webp`. Also produces the widened `interface Featured { name: string; speciesId: string; archetype: string; diet: string }` (`src/modules/park/showcase.ts`).

**The two "no species id in hand" call sites — verified by reading, and they are NOT the two the brief predicted:**

1. **`src/modules/park/embeds.ts:103` genuinely has no species id.** It reads `opts.featured.archetype` / `opts.featured.diet` only, and `opts.featured` is typed `Featured | null` from `src/modules/park/showcase.ts:46`, which today is `{ name: string; archetype: string; diet: string }` — no species field at all. The producer is `featuredFor` (`src/modules/park/showcase.ts:57-66`), which already holds `const species = getSpecies(dino.speciesId)` and simply never forwarded the id. **Exact type change:** add `speciesId: string` to `Featured`. **Exact producer change:** add `speciesId: species.id` to the object literal returned at `showcase.ts:65`. **Exact fixture change:** `tests/park.test.ts:949` builds `featured: { name: 'Trixie', archetype: 'tank', diet: 'herbivore' }` as an inline object literal — it gains `speciesId: 'triceratops'`. That fixture is the ONLY hand-built `Featured` literal in the whole repo (`grep -rn "featured:" tests/ src/` returns exactly `tests/park.test.ts:949`, `src/modules/park/index.ts:202`, `src/modules/park/visit.ts:83`; the last two pass `featuredFor(ctx, user)` and need no edit). `tests/showcase.test.ts` also renders featured dinos, but only through the real `setFeaturedDino` + `featuredFor`, so it needs no change either.

2. **`src/modules/duels/embeds.ts:57` DOES have a species id — the brief is wrong on this one, and no type or fixture change is needed there.** `lead` is a `DuelSquadMember`, declared at `src/modules/duels/service.ts:19-22` as `{ dinoId: number; name: string; speciesId: string; archetype: Archetype; diet: Diet; level: number; traits: string[] }` — `speciesId` has been on that interface since the module shipped, populated by `toMember` at `service.ts:26-32`. `DuelOutcome.squads` (`service.ts:115`) is `{ challenger: DuelSquadMember[]; defender: DuelSquadMember[] }`, so `lead.speciesId` is in scope at the call site. The fixture at `tests/duels.test.ts:390-396` builds its outcome by inserting real dino rows and calling `resolveDuel`, so it produces real `speciesId` values with no literal to edit. The call site changes to `dinoImage(lead.speciesId, lead.archetype, lead.diet)` and nothing else moves.

**Consequently the typecheck-only break is a single one — `tests/park.test.ts:949` — and it is invisible to both other gates:** `npm run build` is `tsc` against `tsconfig.json`, which `include`s `src` only, and `npm test` is vitest, which transpiles without typechecking. Only `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`, which adds `tests` and `scripts`) sees it. Step 9 runs it.

**Two further breaks are runtime, not typecheck, and no gate but the full suite catches them.** `vi.mock('../src/core/images.js', …)` replaces what *importers* see; `dinoImage` calls `assetImage` from **inside** `src/core/images.ts`, and that call resolves against the module's own local binding, never the mocked registry entry. So every existing test that forces a dino-art miss by queueing `vi.mocked(assetImage).mockImplementationOnce(() => null)` stops working the moment a call site routes through `dinoImage` — the queued miss is simply never consumed, and the assertion that the thumbnail is absent fails with the real archetype art present. Two such tests exist: `tests/hatchery.test.ts:288-300` (`revealPayload still ships the crack when the archetype art is missing`) and the `art.dinos = false` fixture in `tests/battles-embeds.test.ts:33` used by the replay-contract test at `:178-203`. Step 6 repairs both by mocking `dinoImage` itself. This is also why the new tests below mock `dinoImage` rather than `assetImage`, and why `dinoImage`'s own two branches are proved against committed files instead of mocks.

**`src/modules/battles/embeds.ts:70` keeps its exact shape and its raw-ref contract.** The line becomes `const thumb = portrait ?? (lead ? dinoImage(lead.id, lead.archetype, lead.diet) : null);` — still `portrait ?? (lead ? … : null)`, still a bare ref assigned to a local, still **no** `attach()`. The comment at `:53-57` says every ref in `fightFrames` is deliberately raw because each is dressed onto several embeds by `dress()` and the files are then split across two payloads by the F1/F4 contract, which `attach`'s one-embed-one-payload shape cannot express; that comment stays and the rule stays. `lead` is already `null` on boss stages (`:69`), so a boss with a missing portrait still degrades to **no** thumbnail and never to species or archetype art.

- [ ] **Step 1: Write the failing test**

Create `tests/dino-image.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AttachmentBuilder } from 'discord.js';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dinoImage } from '../src/core/images.js';
import { dashboardPayload } from '../src/modules/park/embeds.js';
import { duelResultPayload } from '../src/modules/duels/embeds.js';
import { resolveDuel } from '../src/modules/duels/service.js';
import { dexViewPayload } from '../src/modules/dex/embeds.js';
import { revealPayload } from '../src/modules/hatchery/embeds.js';
import { fightFrames } from '../src/modules/battles/embeds.js';
import type { FightOutcome } from '../src/modules/battles/service.js';
import type { BeatSummary } from '../src/data/battle/resolve.js';
import { getSpecies } from '../src/data/species/index.js';
import { STAGES, rosterFor } from '../src/data/battle/chapters/index.js';

// dinoImage is mocked here, NOT assetImage. dinoImage calls assetImage from inside
// src/core/images.ts, and that module-internal call resolves against the module's own
// local binding — vi.mock only replaces what IMPORTERS see, so a mocked assetImage
// leaves dinoImage's two lookups running against the real filesystem and nothing about
// "which id did this call site pass?" becomes observable. Mocking dinoImage does make it
// observable: the ref is named after the SPECIES id, so a call site still passing
// `${archetype}-${diet}` as the first argument renders a different URL and fails here.
// Same vi.mock + importOriginal idiom as tests/battles-embeds.test.ts. Nothing is written
// under assets/images — vitest runs test FILES in parallel forks, so a writeFileSync or
// rmSync on a committed asset path can be observed, or deleted, by another file mid-run.
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return {
    ...actual,
    dinoImage: vi.fn((speciesId: string, _archetype: string, _diet: string) => {
      const fileName = `${speciesId}.webp`;
      return { file: new AttachmentBuilder(Buffer.from('dino'), { name: fileName }), url: `attachment://${fileName}` };
    }),
  };
});

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); vi.clearAllMocks(); });

/** Insert a dino for `user` and return its row id. `.returning().get()` is the repo idiom. */
function addDino(user: string, speciesId: string, battleXp = 0): number {
  return ctx.db.insert(schema.dinos)
    .values({ userId: user, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, battleXp })
    .returning().get().id;
}

describe('dashboardPayload routes the featured dino through dinoImage', () => {
  it('passes the featured species id, not just its archetype and diet', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 0, 0, 0, {
      featured: { name: 'Trixie', speciesId: 'triceratops', archetype: 'tank', diet: 'herbivore' },
    });
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['triceratops', 'tank', 'herbivore']]);
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://triceratops.webp');
    expect(p.files!.map((f) => f.name)).toEqual(['triceratops.webp']);
  });

  it('never calls dinoImage when nothing is featured — that ternary guards domain data', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 0, 0, 0, {});
    expect(dinoImage).not.toHaveBeenCalled();
    // Not [] — attach() on a null ref never creates the array at all.
    expect(p.files).toBeUndefined();
  });
});

describe('duelResultPayload routes the winning lead through dinoImage', () => {
  it('passes the lead member species id off the real squad', () => {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
    addDino('a', 'tyrannosaurus', 3200);
    addDino('b', 'triceratops', 0);
    const out = resolveDuel(ctx, 'a', 'b', 'ghost');
    const payload = duelResultPayload(out);
    const lead = out.result === 'loss' ? out.squads.defender[0] : out.squads.challenger[0];
    expect(vi.mocked(dinoImage).mock.calls).toEqual([[lead.speciesId, lead.archetype, lead.diet]]);
    // Still EXACTLY ONE ref: two would collide on a shared basename and attach never dedupes.
    expect(payload.files!.map((f) => f.name)).toEqual([`${lead.speciesId}.webp`]);
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${lead.speciesId}.webp`);
  });
});

describe('dexViewPayload routes the entry art through dinoImage', () => {
  it('passes the species id of the entry being viewed', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dexViewPayload(ctx, 'u1', 'triceratops');
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['triceratops', 'tank', 'herbivore']]);
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://triceratops.webp');
    expect(p.files!.map((f) => f.name)).toEqual(['triceratops.webp']);
  });
});

describe('revealPayload routes the hatched species through dinoImage', () => {
  it('passes the hatched species id and keeps the crack on the real assetImage path', () => {
    const species = getSpecies('velociraptor');
    const p = revealPayload(species);
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['velociraptor', species.archetype, species.diet]]);
    expect(p.embeds[0].toJSON().image?.url).toBe('attachment://rare-crack.webp');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://velociraptor.webp');
    // Call order is upload order, and only dinoImage is mocked — the crack is still real.
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.webp', 'velociraptor.webp']);
    expect(p.attachments).toEqual([]);
  });
});

describe('fightFrames routes the lead enemy through dinoImage', () => {
  const beats: [BeatSummary, BeatSummary] = [
    { title: '⚔️ Clash!', lines: ['Rexy bites Compy for 24 (crit!)'] },
    { title: '💥 Climax', lines: ['Compy is KO’d!'] },
  ];
  function makeOutcome(over: Partial<FightOutcome> = {}): FightOutcome {
    return {
      result: { won: true, rounds: 5, squadKos: 0, squadSurvivors: ['Rexy'], beats, finalHp: {} },
      stars: 3, firstClear: true, won: true,
      rewards: { cash: 120, food: { foodId: 'fish', qty: 2 }, shards: 5, xpPerDino: [40] },
      bossEgg: null, energyAfter: 9, energyUpdatedAtMs: 600_000,
      squad: [{ dinoId: 1, name: 'Rexy', speciesId: 'tyrannosaurus', level: 2 }],
      stageId: 'coastal_dig_1',
      ...over,
    };
  }
  const skipStub = () => null;

  it('passes the rosterFor lead species id on a non-boss stage, on every frame', () => {
    const stage = STAGES.get('coastal_dig_1')!;
    // rosterFor is the single source of truth for who is fielded — never re-derived.
    const lead = getSpecies(rosterFor(stage, 1)[0].speciesId);
    const frames = fightFrames(makeOutcome(), skipStub);
    expect(vi.mocked(dinoImage).mock.calls).toEqual([[lead.id, lead.archetype, lead.diet]]);
    for (const f of frames) {
      expect(f.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${lead.id}.webp`);
    }
    // The F1/F4 upload contract is unchanged: files on the two attaching frames only.
    expect(frames[0].files!.map((f) => f.name)).toContain(`${lead.id}.webp`);
    expect(frames[1].files).toBeUndefined();
    expect(frames[2].files).toBeUndefined();
    expect(frames[3].files!.map((f) => f.name)).toContain(`${lead.id}.webp`);
  });

  it('never calls dinoImage on a boss stage — a boss is a named individual, never a species stand-in', () => {
    const frames = fightFrames(
      makeOutcome({ stageId: 'coastal_dig_boss', bossEgg: { rarity: 'rare' } }), skipStub);
    expect(dinoImage).not.toHaveBeenCalled();
    const bossId = STAGES.get('coastal_dig_boss')!.boss!.bossId;
    expect(frames[3].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.webp`);
  });
});
```

Append to `tests/images.test.ts` (after the closing `});` of the final `describe('dino archetype art', …)` block at `:389-401`) — no mocks here on purpose, see the comment:

```ts
describe('dinoImage', () => {
  // No mocking in this block. dinoImage calls assetImage from inside the same module,
  // so vi.mock on src/core/images.js would replace what importers see and leave both of
  // dinoImage's own lookups untouched — the branches have to be proved against committed
  // files instead. Nothing is ever staged or deleted under assets/images: vitest runs
  // test files in parallel forks and another file can observe the write mid-run.
  it('falls back to the archetype×diet file when no species file is committed', () => {
    // A synthetic id that can never gain committed art, so this stays true when the
    // hero-species portraits ship.
    const ref = dinoImage('no-such-species', 'bruiser', 'carnivore');
    expect(ref).not.toBeNull();
    expect(ref!.url).toBe('attachment://bruiser-carnivore.webp');
    expect(ref!.file.name).toBe('bruiser-carnivore.webp');
  });

  it('prefers the species file when one is committed', () => {
    // The override branch, exercised with a name that IS committed under
    // assets/images/dinos. The archetype arguments name a DIFFERENT, equally committed
    // file, so a fallback-only implementation returns tank-herbivore.webp and fails.
    const ref = dinoImage('bruiser-carnivore', 'tank', 'herbivore');
    expect(ref).not.toBeNull();
    expect(ref!.url).toBe('attachment://bruiser-carnivore.webp');
  });

  it('returns null when neither the species nor the archetype file exists', () => {
    expect(dinoImage('no-such-species', 'no-such-archetype', 'carnivore')).toBeNull();
  });

  it('resolves every species in the live roster — adding a species still needs no art', () => {
    for (const s of allSpecies()) {
      expect(dinoImage(s.id, s.archetype, s.diet), s.id).not.toBeNull();
    }
  });
});
```

And widen the import at `tests/images.test.ts:6`:

```ts
import { assetImage, attach, dinoImage } from '../src/core/images.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dino-image.test.ts tests/images.test.ts`
Expected: FAIL. `tests/images.test.ts` fails at import with `SyntaxError: The requested module '/src/core/images.ts' does not provide an export named 'dinoImage'`, and `tests/dino-image.test.ts` fails the same way (the `vi.mock` factory spreads `...actual`, so the mocked `dinoImage` key exists, but the direct `import { dinoImage }` in the test file resolves against the factory's return and the call-site assertions fail with `expected [] to deeply equal [ [ 'triceratops', 'tank', 'herbivore' ] ]` — the call sites still use `assetImage`).

- [ ] **Step 3: Add `dinoImage` to `src/core/images.ts`**

Insert directly below `assetImage` (after the closing brace on `src/core/images.ts:24`, before the `attach` comment block):

```ts
// Species art is an OPTIONAL override: a committed assets/images/dinos/<speciesId>.webp
// wins, and a species with no file of its own falls back to its archetype×diet art. That
// fallback is what keeps adding a species a data-only change — no SpeciesDef field, no
// species-file edit, no migration. `present()` above caches existsSync per absolute path,
// so the extra lookup costs one Map hit after the first call.
//
// Every dino-art call site goes through this, never a bare assetImage('dinos', …).
// Note for tests: the two assetImage calls below are MODULE-INTERNAL, so mocking
// assetImage cannot intercept them — a test that needs a dino-art miss must mock
// dinoImage itself.
export function dinoImage(speciesId: string, archetype: string, diet: string): ImageRef | null {
  return assetImage('dinos', speciesId) ?? assetImage('dinos', `${archetype}-${diet}`);
}
```

- [ ] **Step 4: Switch the three call sites whose only dino-art import is `assetImage` (park, duels, dex), and widen `Featured`**

`src/modules/park/showcase.ts:45-46` — replace the one-line doc comment and the interface:

```ts
/**
 * What the card renders: a display name, the species id (the art OVERRIDE key) and the
 * archetype×diet pair its art falls back to. speciesId is required, not optional — every
 * producer resolves a real dino row, and an optional field would let a call site silently
 * skip the override and always render the shared archetype art.
 */
export interface Featured { name: string; speciesId: string; archetype: string; diet: string }
```

`src/modules/park/showcase.ts:65` — the return inside `featuredFor`:

```ts
  return { name: dino.nickname ?? species.name, speciesId: species.id, archetype: species.archetype, diet: species.diet };
```

`src/modules/park/embeds.ts:7` — this file's only `assetImage` use was the dino thumbnail, so the import swaps outright:

```ts
import { dinoImage, attach } from '../../core/images.js';
```

`src/modules/park/embeds.ts:100-104` — keep the domain-data ternary outside `attach`:

```ts
  // The ternary guards on DOMAIN data (is anything featured), so it stays outside attach —
  // "nothing featured" is not an asset miss. Same shape as shop's `best ? … : null`.
  // dinoImage, not assetImage: a hero species with its own committed portrait overrides the
  // shared archetype art, and everything else falls back to exactly what shipped before.
  attach(embed, payload, 'thumbnail',
    opts.featured ? dinoImage(opts.featured.speciesId, opts.featured.archetype, opts.featured.diet) : null);
```

`src/modules/duels/embeds.ts:2`:

```ts
import { dinoImage, attach } from '../../core/images.js';
```

`src/modules/duels/embeds.ts:54-57`:

```ts
  // EXACTLY ONE ref. Attachment names are basenames with no kind prefix, so a second
  // ref would collide whenever both leads share an archetype×diet — attach appends
  // without deduping and one slot would render the other's picture.
  const lead = result === 'loss' ? squads.defender[0] : squads.challenger[0];
  const payload: DuelPayload = { embeds: [embed], components: [] };
  attach(embed, payload, 'thumbnail', dinoImage(lead.speciesId, lead.archetype, lead.diet));
  return payload;
```

`src/modules/dex/embeds.ts:5` — `assetImage` appears elsewhere in this file only inside a comment (`:45`), so the import swaps outright:

```ts
import { attach, dinoImage } from '../../core/images.js';
```

`src/modules/dex/embeds.ts:92`:

```ts
  attach(embed, payload, 'thumbnail', dinoImage(e.species.id, e.species.archetype, e.species.diet));
```

- [ ] **Step 5: Switch the two call sites that keep `assetImage` for other kinds (hatchery, battles)**

`src/modules/hatchery/embeds.ts:4` — `assetImage` is still used for `eggs`, `hatch` and `banners` here, so both names are imported:

```ts
import { assetImage, dinoImage, attach } from '../../core/images.js';
```

`src/modules/hatchery/embeds.ts:50-53`:

```ts
  attach(embed, payload, 'image', assetImage('hatch', `${species.rarity}-crack`));
  // Two files on one payload, each degrading independently: the crack is the
  // "your egg burst open" beat, the species (or archetype) thumb is what came out of it.
  // attach appends, so neither call can clobber the other's file.
  attach(embed, payload, 'thumbnail', dinoImage(species.id, species.archetype, species.diet));
```

`src/modules/battles/embeds.ts:2` — `assetImage` is still used for `sites`, `battles` and `banners` here:

```ts
import { assetImage, dinoImage, attach } from '../../core/images.js';
```

`src/modules/battles/embeds.ts:66-70` — the shape `portrait ?? (lead ? … : null)` is preserved exactly, and the ref stays raw (no `attach()`), per the contract comment at `:53-57` which must be left in place:

```ts
  // A boss stage shows its named individual and nothing else: if the portrait is
  // missing it degrades to no thumbnail, never to species or archetype art standing in
  // for a boss. Non-boss stages have no individual, so they show the lead enemy rosterFor
  // fields — the same entry the enemy list opens with — through dinoImage, which prefers
  // that species' own portrait and falls back to its archetype art.
  const lead = stage.boss ? null : getSpecies(roster[0].speciesId);
  const thumb = portrait ?? (lead ? dinoImage(lead.id, lead.archetype, lead.diet) : null);
```

- [ ] **Step 6: Repair the three existing test files the switch breaks**

`tests/park.test.ts:949` — the only hand-built `Featured` literal in the repo. `triceratops` is tank/herbivore and ships no species file, so the two assertions below it (`attachment://tank-herbivore.webp`, `files` length 1) stay correct:

```ts
      featured: { name: 'Trixie', speciesId: 'triceratops', archetype: 'tank', diet: 'herbivore' },
```

`tests/battles-embeds.test.ts:11-40` — replace the whole comment block, `art` object and `vi.mock` factory with:

```ts
// Portrait presence is mocked, never staged on disk. vitest runs test FILES in
// parallel forks, so a writeFileSync/rmSync fixture on a committed asset path
// (this file used to stub the coastal portrait) can be observed — or deleted —
// by another file mid-run. `portraits: false` is also the only fixture left for
// the null-degrade branch: every boss stage ships a portrait now.
//
// For every other kind, assetImage stays a pass-through spy (calls the real
// implementation) wrapped in vi.fn, so the two chaptersPayload degrade-path
// tests below can still override exactly one queued call via
// mockImplementationOnce to force a miss without touching real asset files.
//
// `dinos: false` has to be expressed on dinoImage rather than on assetImage: fightFrames
// resolves the lead enemy through dinoImage, whose own two assetImage lookups are
// module-internal and are therefore never routed through the spy below. Mocked on
// dinoImage it keeps working, and it stays out of the assetImage once-queue entirely, so
// the two chaptersPayload tests below keep their 1st-call/2nd-call identity.
const art = vi.hoisted(() => ({ portraits: true, sites: true, dinos: true }));
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return {
    ...actual,
    assetImage: vi.fn((kind: Parameters<typeof actual.assetImage>[0], name: string) => {
      // `sites: false` models a deploy with no chapter art (docs/ops.md: every
      // asset is individually optional) — the only way F1 ends up with no files.
      if (kind === 'sites' && !art.sites) return null;
      if (kind !== 'battles') return actual.assetImage(kind, name);   // chapter banners/thumbs stay real
      if (!art.portraits) return null;
      const fileName = `${name}.webp`;
      return { file: new AttachmentBuilder(Buffer.from('portrait'), { name: fileName }), url: `attachment://${fileName}` };
    }),
    // Pass-through by default, so every frame test still resolves the real archetype art.
    // `dinos: false` is the same fixture the assetImage branch used to provide — without
    // it F1 always has a file and the replay contract below stops testing the no-art case
    // it exists to test.
    dinoImage: vi.fn((speciesId: string, archetype: string, diet: string) =>
      (art.dinos ? actual.dinoImage(speciesId, archetype, diet) : null)),
  };
});
```

`tests/hatchery.test.ts:14` — widen the import:

```ts
import { assetImage, dinoImage } from '../src/core/images.js';
```

`tests/hatchery.test.ts:21-28` — the mock factory gains a `dinoImage` pass-through spy:

```ts
// assetImage is a pass-through spy by default (calls the real implementation),
// so every test in this file except the two degrade-path tests below is
// unaffected. Those two override exactly one queued call via
// mockImplementationOnce to force a miss without touching real asset files.
// dinoImage needs its own spy: revealPayload resolves the thumb through it now, and its
// two assetImage lookups are module-internal — the assetImage spy cannot intercept them.
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return { ...actual, assetImage: vi.fn(actual.assetImage), dinoImage: vi.fn(actual.dinoImage) };
});
```

`tests/hatchery.test.ts:288-300` — the degrade-path-2/2 test. It no longer needs `async` or `vi.importActual`: with the thumb miss forced on `dinoImage`, the crack call is served by the default pass-through `assetImage` spy:

```ts
  it('revealPayload still ships the crack when the archetype art is missing', () => {
    // Degrade path 2/2: the mirror case — a miss on the thumb must not drop the
    // crack that attach already appended to payload.files. The miss is forced on
    // dinoImage, not on the assetImage queue: revealPayload resolves the thumb through
    // dinoImage, whose own assetImage calls are module-internal and unmockable from here.
    vi.mocked(dinoImage).mockImplementationOnce(() => null);
    const p = revealPayload(getSpecies('velociraptor'));
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://rare-crack.webp');
    expect(embed.thumbnail).toBeUndefined();
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.webp']);
  });
```

- [ ] **Step 7: Run the new and repaired tests to verify they pass**

Run: `npx vitest run tests/dino-image.test.ts tests/images.test.ts tests/hatchery.test.ts tests/battles-embeds.test.ts tests/park.test.ts tests/duels.test.ts tests/dex.test.ts tests/showcase.test.ts`
Expected: PASS — all files green. No species file is committed under `assets/images/dinos/` yet, so every unmocked assertion in `hatchery`, `battles-embeds`, `park`, `duels`, `dex` and `showcase` still resolves to the same `<archetype>-<diet>.webp` name it asserted before.

- [ ] **Step 8: Record the override in the repo CLAUDE.md**

In `CLAUDE.md`, replace the two lines at `:291-292`:

```
  `docs/assets/prompts.md`): **art is keyed on archetype×diet, never on species**,
  which is what keeps adding a species a data-only change. `support-carnivore`
```

with:

```
  `docs/assets/prompts.md`): **art is keyed on archetype×diet, with a per-species file
  as an OPTIONAL override** — `dinoImage(speciesId, archetype, diet)`
  (`src/core/images.ts`) tries `dinos/<speciesId>.webp` first and falls back to
  `dinos/<archetype>-<diet>.webp`, so a species with no file of its own costs no art and
  adding a species stays a data-only change. All five dino-art call sites go through that
  helper (`park/embeds.ts`, `duels/embeds.ts`, `dex/embeds.ts`, `hatchery/embeds.ts`,
  `battles/embeds.ts`), never a bare `assetImage('dinos', …)`; `park/embeds.ts` needed
  `Featured` (`park/showcase.ts`) to carry `speciesId` for it, a typecheck-only break that
  `npm run build` and `npm test` both miss. Mocking `assetImage` can NOT intercept the two
  lookups inside `dinoImage` — that call is module-internal — so a test that needs a
  dino-art miss must mock `dinoImage` itself (`tests/hatchery.test.ts` and
  `tests/battles-embeds.test.ts` both do). `support-carnivore`
```

- [ ] **Step 9: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass. `npm run typecheck` is the only gate that sees the `Featured` fixture change at `tests/park.test.ts:949`; a forgotten `speciesId` there reports `Property 'speciesId' is missing in type '{ name: string; archetype: string; diet: string; }' but required in type 'Featured'`.

- [ ] **Step 10: Commit**

```bash
git add src/core/images.ts src/modules/park/showcase.ts src/modules/park/embeds.ts src/modules/duels/embeds.ts src/modules/dex/embeds.ts src/modules/hatchery/embeds.ts src/modules/battles/embeds.ts tests/dino-image.test.ts tests/images.test.ts tests/park.test.ts tests/hatchery.test.ts tests/battles-embeds.test.ts CLAUDE.md
git commit -m "Resolve dino art through a species override with an archetype fallback

Add dinoImage(speciesId, archetype, diet) to src/core/images.ts: a committed
dinos/<speciesId>.webp wins, and anything without one falls back to the shared
dinos/<archetype>-<diet>.webp, so adding a species still ships no art. Switch all
five dino-art call sites to it. The park card had no species id in hand, so
Featured now carries speciesId and featuredFor forwards it; the battles frame
keeps its portrait ?? (lead ? ... : null) shape and its raw refs, since fightFrames
splits its files across two payloads and cannot use attach.

Tests mock dinoImage rather than assetImage where a miss has to be forced:
dinoImage calls assetImage from inside the same module, so the assetImage spy
never sees those two lookups."
```

**Forward hazard for the hero-portrait asset task (no action now, nothing failing today):** `tests/duels.test.ts:390-396` builds its outcome from `allSpecies().find((s) => s.rarity === 'legendary')`, and `tests/duels.test.ts:432-441` asserts the attachment is `` `${lead.archetype}-${lead.diet}.webp` ``. Every legendary species is on the hero-portrait list in the spec's asset manifest, so the moment `dinos/<legendaryId>.webp` is committed that expectation flips to the species file and the test fails. `tests/park.test.ts` (`triceratops`), `tests/hatchery.test.ts` (`velociraptor`, `triceratops`), `tests/battles-embeds.test.ts` (`compsognathus`, `othnielia`, `microceratus`) and `tests/dex.test.ts` (`triceratops`) all pin non-hero species and are unaffected.

---

### Task 4: Ship the cross-kind basename collision gate and the `dinos/` naming gate

**Files:**
- Modify: `tests/images.test.ts:402-455` (append at end of file; the file is 401 lines today and ends with the `dino archetype art` describe's closing `});`)
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes (all already imported at `tests/images.test.ts:1-10` — **this task adds no import lines**):
  - `import { describe, it, expect } from 'vitest';` (line 1)
  - `import { readdirSync, readFileSync } from 'node:fs';` (line 4)
  - `import { join, resolve } from 'node:path';` (line 5)
  - `import { assetImage, attach } from '../src/core/images.js';` (line 6) — signature: `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos', name: string): ImageRef | null`
  - `import { allSpecies } from '../src/data/species/index.js';` (line 8) — signature: `allSpecies(): Species[]`, where `Species` is `{ id: string; name: string; rarity: Rarity; diet: Diet; archetype: Archetype; biomeTags: string[]; flavor: string }` (`src/data/types.ts:4-7`)
  - existing module-level `const DINO_ART_KEYS: string[]` at `tests/images.test.ts:374` — the 8 `${archetype}-${diet}` strings, derived from `satisfies Record<Archetype, 0>` / `satisfies Record<Diet, 0>` at `:371-373`
- Produces (module-level in `tests/images.test.ts`, available to every later task in this file):
  - `type AssetKind = Parameters<typeof assetImage>[0]` — the six-kind union, pulled off the real signature so it can never drift from `src/core/images.ts:19`
  - `const ASSET_KINDS: AssetKind[]` — exhaustive by `satisfies Record<AssetKind, 0>`; a seventh kind added to `assetImage` is a **typecheck** break here
  - `const SPECIES_IDS: Set<string>` — every live species id from `allSpecies()`

Context for the implementer: both tests **pass on the current tree**. They are gates for later tasks in this release (species art adds a second naming family inside `assets/images/dinos/`, and 6 new banners plus 6 attraction bands widen the basename space), not fixes for anything broken today. So the usual red-then-green order is impossible without lying about it — Steps 3 and 4 replace it with a mutation proof, which is what this repo's own rule ("a test nobody has watched fail is not yet a test") actually asks for. Do not skip them.

- [ ] **Step 1: Write the two gates**

Append this verbatim to the end of `tests/images.test.ts` (after line 401, the closing `});` of `describe('dino archetype art', …)`). It must go at the end because the second gate reads `DINO_ART_KEYS`, which is declared at line 374.

```ts

// Attachment names are BASENAMES ONLY — assetImage builds `${name}.webp` with no
// `kind` prefix — so two refs on ONE payload that resolve to the same basename
// make `attachment://<name>.webp` ambiguous and one of the two embed slots
// renders the wrong picture. attach() appends and can never clobber, but it
// cannot DEDUPE, so nothing else in the suite can see this. Exhaustive by
// construction: `satisfies Record<AssetKind, 0>` rejects a missing key and an
// unknown one, so a seventh kind added to assetImage fails typecheck here before
// it can ship uncovered. assets/images/park/ is deliberately absent — those
// rasters are read by the park renderer directly and never become Discord
// attachments, so they cannot collide with anything.
type AssetKind = Parameters<typeof assetImage>[0];
const ASSET_KINDS = Object.keys({
  eggs: 0, sites: 0, banners: 0, battles: 0, hatch: 0, dinos: 0,
} satisfies Record<AssetKind, 0>) as AssetKind[];

describe('cross-kind basename collisions', () => {
  it('no two committed assets share a basename across the six assetImage kinds', () => {
    const owners = new Map<string, AssetKind[]>();
    for (const kind of ASSET_KINDS) {
      for (const file of readdirSync(resolve(process.cwd(), 'assets/images', kind))) {
        if (!file.endsWith('.webp')) continue;   // battles/ ships a .gitkeep
        const base = file.replace(/\.webp$/, '');
        const owner = owners.get(base);
        if (owner) owner.push(kind);
        else owners.set(base, [kind]);
      }
    }
    expect(owners.size, 'no assets found — wrong root?').toBeGreaterThan(0);
    const collisions = [...owners]
      .filter(([, kinds]) => kinds.length > 1)
      .map(([base, kinds]) => `${base}.webp: ${kinds.join(' + ')}`);
    expect(collisions, `rename one side — two payloads cannot both use these:\n${collisions.join('\n')}`).toEqual([]);
  });
});

// The inverse of the banner orphan check above, for the one directory with TWO
// naming families: `<archetype>-<diet>` (the fixed set of 8) and `<speciesId>`
// (the optional per-species override). Both sides are derived — DINO_ART_KEYS
// from the real Archetype/Diet unions, ids from allSpecies() — so a typo'd or
// retired name is caught here rather than null-degrading to an imageless embed,
// which is silent everywhere else.
const SPECIES_IDS = new Set(allSpecies().map((s) => s.id));

describe('dino art file names', () => {
  it('every committed dinos/ file is an archetype-diet pair or a real species id', () => {
    const names = readdirSync(resolve(process.cwd(), 'assets/images/dinos'))
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.replace(/\.webp$/, ''));
    expect(names.length, 'no dino art found — wrong root?').toBeGreaterThan(0);
    const strays = names.filter((n) => !DINO_ART_KEYS.includes(n) && !SPECIES_IDS.has(n));
    expect(strays, `neither an archetype-diet pair nor a species id: ${strays.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run both gates on the unmodified tree**

Run: `npx vitest run tests/images.test.ts -t "no two committed assets share a basename"`
Expected: PASS — `Tests 1 passed | 71 skipped (72)`. The six kinds hold 67 distinct basenames today with zero overlap (eggs are `<rarity>`, hatch are `<rarity>-crack`, sites are `<id>-banner`/`<id>-thumb`, battles are `boss-<id>-portrait`, dinos are `<archetype>-<diet>`, banners are their own words).

Run: `npx vitest run tests/images.test.ts -t "every committed dinos"`
Expected: PASS — `Tests 1 passed | 71 skipped (72)`. `assets/images/dinos/` holds exactly the 8 archetype×diet files today, so every name is in `DINO_ART_KEYS` and the species branch is dormant until hero portraits land.

- [ ] **Step 3: Prove the collision gate is not vacuous (temporary mutation, then revert)**

Do **not** stage a fixture inside `assets/images/` to do this — vitest runs test files in parallel forks and a `writeFileSync`/`rmSync` on a committed asset path can be observed or deleted by another file mid-run. Mutate the derivation instead, so the existing files collide with each other.

In the block you just added, change this one line:

```ts
        const base = file.replace(/\.webp$/, '');   // battles/ ships a .gitkeep
```

to:

```ts
        const base = file.replace(/(-crack)?\.webp$/, '');   // battles/ ships a .gitkeep
```

Run: `npx vitest run tests/images.test.ts -t "no two committed assets share a basename"`
Expected: FAIL with

```
AssertionError: rename one side — two payloads cannot both use these:
common.webp: eggs + hatch
epic.webp: eggs + hatch
legendary.webp: eggs + hatch
mythic.webp: eggs + hatch
rare.webp: eggs + hatch
uncommon.webp: eggs + hatch: expected [ 'common.webp: eggs + hatch', …(5) ] to deeply equal []
```

That is exactly the collision `docs/superpowers/specs/2026-08-18-art-polish-5a-design.md` records as the reason the hatch cracks were named `<rarity>-crack` and not `hatch/<rarity>` in the first place. Now revert the `(-crack)?` edit — restore the line to `const base = file.replace(/\.webp$/, '');   // battles/ ships a .gitkeep` — and re-run the same command to confirm PASS again.

- [ ] **Step 4: Prove the dinos naming gate is not vacuous (temporary mutation, then revert)**

In the block you just added, change this line:

```ts
      .map((f) => f.replace(/\.webp$/, ''));
```

to:

```ts
      .map((f) => f.replace(/\.webp$/, '')).concat('bruiser_carnivore');
```

Warning: an identical `.map((f) => f.replace(/\.webp$/, ''));` line already exists at `tests/images.test.ts:168` inside the banner orphan check. Edit the one in the **new** `dino art file names` describe (near the end of the file), not that one.

Run: `npx vitest run tests/images.test.ts -t "every committed dinos"`
Expected: FAIL with

```
AssertionError: neither an archetype-diet pair nor a species id: bruiser_carnivore: expected [ 'bruiser_carnivore' ] to deeply equal []
```

`bruiser_carnivore` is the underscore typo of the real `bruiser-carnivore` — the same failure class as a hero portrait committed as `scorpios-rex.webp` against the species id `scorpios_rex`, which would otherwise null-degrade to an imageless embed with the whole suite green. Now revert the `.concat('bruiser_carnivore')` edit and re-run the same command to confirm PASS again.

- [ ] **Step 5: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck silent (exit 0), then `Test Files 109 passed (109)` / `Tests 1796 passed (1796)` — the 1794 baseline plus these two.

Optional one-time confirmation that the `satisfies` exhaustiveness is live, if you want to see it: delete `dinos: 0,` from the `ASSET_KINDS` object and run `npm run typecheck` alone. Expected error, then restore the key:

```
tests/images.test.ts(416,3): error TS2741: Property 'dinos' is missing in type '{ eggs: 0; sites: 0; banners: 0; battles: 0; hatch: 0; }' but required in type 'Record<"banners" | "battles" | "dinos" | "eggs" | "hatch" | "sites", 0>'.
```

Note that `npm run build` cannot see this — `tsconfig.json` only `include`s `src`, and vitest transpiles without typechecking, so `npm run typecheck` is the only thing standing between a stale kind list and a green run.

- [ ] **Step 6: Commit**

```bash
git add tests/images.test.ts
git commit -m "Gate asset basenames against cross-kind collisions and stray dino art names

Attachment names are basenames only, so two refs on one payload that resolve
to the same name make the attachment:// URL ambiguous and one embed slot
renders the wrong picture. attach() appends and cannot dedupe, and nothing
else in the suite could see this.

The dinos directory is about to carry two naming families at once, the fixed
archetype-diet set and an optional per-species override, so a file matching
neither is now a failure rather than a silent imageless embed.

Both gates pass on the current tree and were each watched to fail under a
deliberate mutation before landing."
```

---

### Task 5: Add a `band` mode to `fit-art.mjs` for the 270×150 tile family

**No test is added, and that is not an oversight: nothing in this repo tests `scripts/fit-art.mjs`.** `grep -rn "fit-art" tests/` returns exactly one hit — a *comment* at `tests/images.test.ts:221` — and no test file spawns, imports, or otherwise exercises the script. The two tests that live nearest to it guard different things and must both keep passing: `tests/park-art-assets.test.ts` asserts the five **committed** 270×150 rasters decode at exactly 270×150 (it checks the assets, never the script that fitted them), and `tests/docs-assets.test.ts` scrapes counts out of `docs/assets/prompts.md`. Step 1/2 and Step 6 below are therefore a real smoke run against a committed asset re-fitted to a scratch path — **never writing into `assets/`** — with the output dimensions read back through `@napi-rs/canvas`, the same decoder `tests/park-art-assets.test.ts` uses.

**Files:**
- Modify: `scripts/fit-art.mjs:1-28` (header usage block lines 2-4, the `COVER` comment and table lines 15-23, the usage string line 26)
- Modify: `docs/assets/prompts.md:56` (the "both modes" claim in **Output format**)
- Modify: `docs/assets/prompts.md:62-63` (insert the new post-processing modes table after the **Output format** paragraph, before **Decode trap**)
- Modify: `docs/assets/prompts.md:1120-1122` (the plate pre-crop note)
- Modify: `docs/assets/prompts.md:1285-1290` (the landmark-band "no committed mode of its own" note)
- Test: none — see the paragraph above. Verification is the scratch-path smoke run in Steps 1, 2 and 6.

**Interfaces:**
- Consumes: nothing from any earlier task. `createCanvas` and `Image` from `@napi-rs/canvas` are already imported at `scripts/fit-art.mjs:13`; `readFileSync`/`writeFileSync` from `node:fs` at line 12. The existing cover branch at `scripts/fit-art.mjs:46-55` (`if (Object.hasOwn(COVER, mode)) { … }`) already handles any key present in `COVER`, so no new code path is written — only a new table entry and the strings that advertise it.
- Produces: the CLI mode **`node scripts/fit-art.mjs band <src> <dest.webp>`** → cover-scaled, center-cropped 270×150 WebP q95, exit 0, logging `band <dest> 270x150 (source <w>x<h>)`. Also `COVER.band === [270, 150]` inside the script. Later art tasks (the 6 attraction bands at `assets/images/park/attraction-<kind>.webp`, and any regeneration of `park/landmark-{a,b,c}.webp`) invoke this exact command instead of repeating a one-off hand pass.

- [ ] **Step 1: Write the failing check (there is no test harness for this script)**

Establish the current behaviour first. `landmark-a.webp` is chosen because it is already committed at exactly 270×150, so re-fitting it must be a no-op in size — any other output proves the mode is wrong rather than the source being odd.

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/8bc02eaa-c64d-45c3-a2ce-1d421c8f5a01/scratchpad"
node scripts/fit-art.mjs band assets/images/park/landmark-a.webp "$SCRATCH/band-smoke.webp"; echo "exit=$?"
```

- [ ] **Step 2: Run the check to verify it fails**

Run: the two commands in Step 1.

Expected: FAIL with

```
usage: node scripts/fit-art.mjs <banner|ground|cutout> <src> <dest.webp>
exit=2
```

and no `$SCRATCH/band-smoke.webp` written. `band` is neither `'cutout'` nor a key of `COVER`, so the guard at `scripts/fit-art.mjs:25` rejects it before the decode.

- [ ] **Step 3: Add the mode to `scripts/fit-art.mjs`**

Three edits, all in the first 28 lines. **No edit to the cover branch at lines 46-55 and no edit to the guard's condition at line 25** — `Object.hasOwn(COVER, mode)` picks the new key up on its own, and that call must stay `Object.hasOwn` rather than `in`, because `in` walks the prototype chain and once made `node scripts/fit-art.mjs constructor a b` pass validation.

Edit 1 — the header usage block. Current `scripts/fit-art.mjs:2-4`:

```js
//   node scripts/fit-art.mjs banner <src> <dest>   -> 1536x1024, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs ground <src> <dest>   -> 1200x800, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs cutout <src> <dest>   -> 1024x1024 transparent, defringed and centered, WebP q95
```

Replace with (the three spaces after `band` keep the `<src>` column aligned with the six-letter modes):

```js
//   node scripts/fit-art.mjs banner <src> <dest>   -> 1536x1024, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs ground <src> <dest>   -> 1200x800, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs band   <src> <dest>   -> 270x150, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs cutout <src> <dest>   -> 1024x1024 transparent, defringed and centered, WebP q95
```

Edit 2 — the `COVER` comment and table. Current `scripts/fit-art.mjs:15-23`:

```js
// The cover-scaled modes. Both are 3:2 — `ground` differs from `banner` only in
// pixel size, because the park renderer's ground is cover-scaled onto a canvas
// that is at most 752px tall (gridDims in src/core/render/draw.ts: height =
// 88 + 166*rows, and rows maxes out at 4 — lotSlots caps at 10 in
// src/data/progression.ts, over a 3-wide grid), so 1536x1024 would ship ~64%
// more bytes than the renderer can ever use. 1200x800 is what the committed
// park/ground.webp already is; the season variants must match it exactly or
// they crop differently from each other at the same row count.
const COVER = { banner: [1536, 1024], ground: [1200, 800] };
```

Replace with (the opening sentence has to change: it says "Both are 3:2", and `band` is 1.8:1):

```js
// The cover-scaled modes. `banner` and `ground` are both 3:2 and differ only in
// pixel size, because the park renderer's ground is cover-scaled onto a canvas
// that is at most 752px tall (gridDims in src/core/render/draw.ts: height =
// 88 + 166*rows, and rows maxes out at 4 — lotSlots caps at 10 in
// src/data/progression.ts, over a 3-wide grid), so 1536x1024 would ship ~64%
// more bytes than the renderer can ever use. 1200x800 is what the committed
// park/ground.webp already is; the season variants must match it exactly or
// they crop differently from each other at the same row count.
//
// `band` is 270x150 — TILE_W x TILE_H in src/core/render/draw.ts — and 1.8:1, an
// aspect ratio no generator offers, so the source is generated at 16:9 and
// cropped down. Committing at exactly the tile size is what the mode is for:
// drawTile and drawLandmark call drawImage(img, x, y, TILE_W, TILE_H) with an
// explicit destination size, so an off-size raster is silently squashed to fit
// and never throws — a 1024-square source ships stretched from 1.0 to 1.8 and
// still renders "successfully". Every 270x150 asset committed before this mode
// existed (the two plates, the three landmark bands) was fitted by a separate
// one-off pass; the plates additionally cropped to the plate object's own
// bounding box FIRST, which this mode does not do — see docs/assets/prompts.md.
const COVER = { banner: [1536, 1024], ground: [1200, 800], band: [270, 150] };
```

Edit 3 — the usage string. Current `scripts/fit-art.mjs:25-28`:

```js
if (!(mode === 'cutout' || Object.hasOwn(COVER, mode)) || !src || !dest) {
  console.error('usage: node scripts/fit-art.mjs <banner|ground|cutout> <src> <dest.webp>');
  process.exit(2);
}
```

Replace with (only the message changes; the condition is already correct):

```js
if (!(mode === 'cutout' || Object.hasOwn(COVER, mode)) || !src || !dest) {
  console.error('usage: node scripts/fit-art.mjs <banner|ground|band|cutout> <src> <dest.webp>');
  process.exit(2);
}
```

- [ ] **Step 4: Document the mode in `docs/assets/prompts.md`**

Four edits. Note for the implementer: `tests/docs-assets.test.ts` regexes this file for `(\d+)\s+(?:custom |application )?emojis` and `(\d+)\s+(?:embed |wide )?banners`, so none of the new prose may put a bare number immediately before the word "emojis" or "banners" — the wording below deliberately avoids both.

Edit 1 — `docs/assets/prompts.md:56`. Current:

```md
`scripts/fit-art.mjs` emits it directly, so both modes write the shipped format and no
```

Replace with:

```md
`scripts/fit-art.mjs` emits it directly, so every mode writes the shipped format and no
```

Edit 2 — insert the modes table between line 62 (`synchronously.`, the end of the **Output format** paragraph) and line 64 (`**Decode trap: Content Credentials (C2PA) in a source PNG.** *Symptom:*`). This is the `band` mode's own documentation row:

```md
**Post-processing modes (`scripts/fit-art.mjs`).** Every mode writes WebP q95 and
takes whatever the generator emitted (usually PNG) as its source.

| Mode | Output | Fit | Used by |
|---|---|---|---|
| `node scripts/fit-art.mjs banner <src> <dest>` | 1536×1024 (3:2) | cover-scale, center-crop | `assets/images/sites/<id>-banner.webp`, `assets/images/banners/` |
| `node scripts/fit-art.mjs ground <src> <dest>` | 1200×800 (3:2) | cover-scale, center-crop | `assets/images/park/ground{,-wet,-dry,-cold}.webp` |
| `node scripts/fit-art.mjs band <src> <dest>` | 270×150 (1.8:1) | cover-scale, center-crop | `assets/images/park/attraction-<kind>.webp`, `assets/images/park/landmark-{a,b,c}.webp` — anything the park renderer draws 1:1 at `TILE_W`×`TILE_H` |
| `node scripts/fit-art.mjs cutout <src> <dest>` | 1024×1024 transparent | defringe, then whole-bbox fit at a 31px margin | `assets/images/hatch/`, `assets/images/dinos/` |

`band` exists because 270×150 is 1.8:1 and no generator offers that aspect ratio:
generate at 16:9 and let the mode crop. It is the `ground` mode's arithmetic with
different constants, nothing more. It is **not** a complete recipe for the two
tile plates — those need a bounding-box crop first, described under Park map —
and it is **not** interchangeable with `cutout`, which fits a transparent
subject rather than cover-cropping an opaque frame.
```

Edit 3 — `docs/assets/prompts.md:1120-1122` (the plate pre-crop warning). Current:

```md
outside the plate's own frame. Crop tight to the plate object's own bounding
box first, then cover-fit that crop to 270×150 — do not cover-fit the raw
generation directly.
```

Replace with:

```md
outside the plate's own frame. Crop tight to the plate object's own bounding
box first, then cover-fit that crop to 270×150 — do not cover-fit the raw
generation directly. `fit-art.mjs band` performs that second step only, so a
plate regeneration still needs the bounding-box crop by hand before the mode is
run. Art that already fills its frame edge to edge — the landmark bands, the
attraction bands — goes straight through `band` with no pre-crop.
```

Edit 4 — `docs/assets/prompts.md:1285-1290` (the claim that 270×150 has no mode, which this task makes false). Current:

```md
Generated with model `nano_banana_pro` (the API silently routes this to
`nano_banana_2`) at aspect ratio `16:9`, source output 1376×768, cover-scaled
and center-cropped to 270×150 WebP q95 — the same cover-and-crop idea as
`fit-art.mjs`'s `ground`/`banner` modes, but 270×150 has no committed mode of
its own; these three were fitted with a one-off pass rather than a new
`fit-art.mjs` mode.
```

Replace with:

```md
Generated with model `nano_banana_pro` (the API silently routes this to
`nano_banana_2`) at aspect ratio `16:9`, source output 1376×768, cover-scaled
and center-cropped to 270×150 WebP q95. These three predate `fit-art.mjs`'s
`band` mode and were fitted with a one-off pass; `band` now does exactly that
cover-and-crop at exactly that size, so a regeneration runs
`node scripts/fit-art.mjs band <src> assets/images/park/landmark-a.webp`
rather than repeating the one-off.
```

- [ ] **Step 5: Run the mode against a committed 270×150 asset, into scratch**

The exact command an operator runs for real work is:

```
node scripts/fit-art.mjs band <src> <dest>
```

The verification run re-fits an already-committed 270×150 asset to a scratch path. **The destination is never under `assets/`** — this is a read of `landmark-a.webp` and a write to the scratchpad only:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/8bc02eaa-c64d-45c3-a2ce-1d421c8f5a01/scratchpad"
node scripts/fit-art.mjs band assets/images/park/landmark-a.webp "$SCRATCH/band-smoke.webp"; echo "exit=$?"
```

Expected: exit 0 and the line

```
band C:/Users/.../scratchpad/band-smoke.webp 270x150 (source 270x150)
```

- [ ] **Step 6: Read the output dimensions back with `@napi-rs/canvas`**

Same decoder `tests/park-art-assets.test.ts` uses, and the same `await img.decode()` discipline — raster decode is asynchronous in `@napi-rs/canvas`, and an un-awaited decode reports the right width/height over blank pixels, so the `await` is what makes this check mean anything.

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/8bc02eaa-c64d-45c3-a2ce-1d421c8f5a01/scratchpad"
node -e "
const { readFileSync } = require('node:fs');
const { Image } = require('@napi-rs/canvas');
(async () => {
  const bytes = readFileSync(process.argv[1]);
  const img = new Image();
  img.src = bytes;
  await img.decode();
  const magic = bytes.subarray(0, 4).toString('ascii') + '/' + bytes.subarray(8, 12).toString('ascii');
  const ok = img.width === 270 && img.height === 150;
  console.log(magic, img.width + 'x' + img.height, ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
" "$SCRATCH/band-smoke.webp"; echo "exit=$?"
rm -f "$SCRATCH/band-smoke.webp"
git status --porcelain assets/
```

Expected: `RIFF/WEBP 270x150 PASS`, `exit=0`, and `git status --porcelain assets/` prints nothing — nothing under `assets/` was touched.

Also re-run the failure case from Step 2's sibling to confirm the usage string is the new one:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
node scripts/fit-art.mjs bogus a b; echo "exit=$?"
```

Expected: `usage: node scripts/fit-art.mjs <banner|ground|band|cutout> <src> <dest.webp>` and `exit=2`.

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npx vitest run`

Expected: all pass. `scripts/fit-art.mjs` is `.mjs` and outside `tsc`'s reach, so `typecheck` covers only that nothing else regressed; the tests that matter here are `tests/docs-assets.test.ts` (both `prompts.md` scrapes still find their counts) and `tests/park-art-assets.test.ts` (the five committed 270×150 rasters still decode at 270×150 — they must be byte-identical, since this task writes nothing under `assets/`).

- [ ] **Step 8: Commit**

`tests/images.test.ts` is already modified in the working tree from other work — do not stage it.

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
git add scripts/fit-art.mjs docs/assets/prompts.md
git commit -m "Add a band mode to fit-art.mjs for the 270x150 tile family

270x150 is TILE_W x TILE_H in the park renderer and 1.8:1, an aspect ratio
no generator offers, so every asset at that size was fitted by a separate
one-off pass. band is the ground mode's cover-scale and center-crop with
different constants, so the landmark bands and the attraction bands have a
committed, repeatable pass. Document all four modes in prompts.md and drop
the note claiming 270x150 has no mode of its own."
```

---

### Task 6: Guests banner — `banners/guests.webp` (banner #27)

**Files:**
- Create: `assets/images/banners/guests.webp`
- Modify: `src/modules/guests/embeds.ts:1-16` (imports + `Payload`), `:109`, `:127`, `:160` (the three return statements)
- Modify: `src/modules/guests/index.ts:107-112` (the `i.update` comment)
- Modify: `src/modules/help/index.ts:98` (the `guests` topic gains an `art` descriptor)
- Modify: `docs/assets/prompts.md:7` (`26` → `27`), `:409` (`26` → `27`), `:432` (new table row after the `achievements.webp` row), `:658` (new prompt block after the `achievements.webp` prompt, before `**Gene Lab (…)**`)
- Modify: `tests/images.test.ts:174` (the `26`/`17` count comment), `:189` (new case inside `describe('banner art')`)
- Modify: `tests/help.test.ts:55-56` (the hard-coded art-bearing topic list)
- Test: `tests/guests.test.ts`, `tests/images.test.ts`, `tests/help.test.ts`

**Interfaces:**
- Consumes: `attach(embed: EmbedBuilder, payload: { files?: AttachmentBuilder[] }, slot: 'image' | 'thumbnail', ref: ImageRef | null): void` and `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos', name: string): ImageRef | null`, both from `src/core/images.js`. `makeCtx()`, `fakeCommand({ name, sub, user, options })`, `fakeButton({ customId, user })` from `tests/harness.js`.
- Produces: `export interface Payload { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }` in `src/modules/guests/embeds.ts` — the widened shape Tasks 7 and 8 do **not** depend on. A committed `assets/images/banners/guests.webp` at 1536×1024, which raises the on-disk banner count from 26 to **27** and the scrape-visible (non-event) count from 17 to 18. Both counts are read by `tests/docs-assets.test.ts` and by the comment at `tests/images.test.ts:174`, so Task 7 starts from 27/18.

---

- [ ] **Step 1: Write the failing tests**

Add to `tests/images.test.ts`, inside `describe('banner art', …)`, immediately after the `it.each(DIMENSION_CHECKED_BANNERS)` case (currently ending at `:188`):

```ts
  // The dimension case for this banner is REGISTERED by the it.each above, not written
  // by hand — DIMENSION_CHECKED_BANNERS is built from BANNERS, which is scraped from
  // src/. That is exactly why this test exists: a wiring form scrapeBannerNames cannot
  // read (a call wrapped across two lines, double quotes, a template literal) silently
  // drops the name out of that loop, registering zero cases for it with the suite still
  // green. Assert the name is IN the scrape, then read the file directly so a
  // committed-but-unfitted banner fails here even if the loop is somehow starved.
  it('guests is scrape-visible and ships at 1536×1024', async () => {
    expect(BANNERS, 'banners/guests is not reachable by scrapeBannerNames').toContain('guests');
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', 'guests.webp'));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });
```

Add to `tests/guests.test.ts`, inside `describe('/guests', …)`, after the last case (currently ending at `:342`):

```ts
  it('every /guests surface ships the guests banner and its file together', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    for (const sub of ['view', 'build', 'claim'] as const) {
      const i = fakeCommand({
        name: 'guests', sub, user: 'u1',
        options: sub === 'build' ? { attraction: 'picnic_lawn' } : {},
      });
      await cmd().execute(ctx, i.asChatInput());
      const payload = i.replies[0] as { embeds: EmbedBuilder[]; files?: Array<{ name?: string | null }> };
      expect(payload.embeds[0].toJSON().image?.url, sub).toBe('attachment://guests.webp');
      // toEqual on the whole list, not toContain: attach() APPENDS, so a second slot
      // wired later would show up here rather than hiding behind a membership check.
      expect(payload.files!.map((f) => f.name), sub).toEqual(['guests.webp']);
    }
  });

  // An i.update carrying `files` REPLACES the message's whole attachment set. The claim
  // handler re-renders through guestsPayload, so the banner has to be re-attached on the
  // post-claim render or the message the player just used loses the image it had — a
  // silent regression with no error anywhere, and one no existing test could see, since
  // this module shipped no art before and nothing asserted files/attachments on this path.
  it('the claim re-render carries the banner again rather than blanking the message art', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    const i = fakeButton({ customId: `guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`, user: 'u1' });
    await comp().execute(ctx, i.asInteraction() as unknown as ButtonInteraction);
    const update = i.replies[0] as { embeds: EmbedBuilder[]; files?: Array<{ name?: string | null }> };
    expect(update.embeds[0].toJSON().image?.url).toBe('attachment://guests.webp');
    expect(update.files!.map((f) => f.name)).toEqual(['guests.webp']);
    // And NEVER a hand-set attachments key. The fightFrames rule (attachments: []
    // mandatory and unconditional) exists because one MessagePayload object reaches two
    // send sites and each must shed the other's set; this payload is built fresh by
    // guestsPayload and sent exactly once, so the replacement set is already identical.
    expect('attachments' in update).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/images.test.ts -t "guests is scrape-visible"`
Expected: FAIL with `AssertionError: banners/guests is not reachable by scrapeBannerNames: expected [ 'achievements', 'battle_defeat', … ] to include 'guests'`

Run: `npx vitest run tests/guests.test.ts -t "every /guests surface ships the guests banner"`
Expected: FAIL with `AssertionError: view: expected undefined to be 'attachment://guests.webp'`

- [ ] **Step 3: Generate the banner with Higgsfield and fit it**

Model `nano_banana_pro` (the API silently routes this to `nano_banana_2`), aspect ratio `3:2`, generated **image-to-image** against two existing banners so the set does not drift: `banners/help.webp` (the park gates at golden hour — the same warm park-entrance vocabulary) and `banners/leaderboards.webp` (the only existing banner with a crowd of cartoon dinosaurs and bunting).

1. `mcp__claude_ai_Higgsfield__media_upload` with `files: [{ filename: 'help.webp' }, { filename: 'leaderboards.webp' }]`, PUT the bytes of `assets/images/banners/help.webp` and `assets/images/banners/leaderboards.webp` to the returned `upload_url` values, then `mcp__claude_ai_Higgsfield__media_confirm`.
2. `mcp__claude_ai_Higgsfield__generate_image` with:

```json
{ "params": { "model": "nano_banana_pro", "aspect_ratio": "3:2",
  "medias": [{ "role": "image", "value": "<media_id help.webp>" },
             { "role": "image", "value": "<media_id leaderboards.webp>" }],
  "prompt": "A wide cartoon scene of a busy dinosaur park visitor plaza on a bright open day: a paved central concourse running back from a timber entrance arch with turnstile gates, a striped gift-shop awning on the left and a picnic lawn with chequered blankets and benches on the right, a raised timber viewing platform on stilts behind them, a cable gondola strung between two pylons overhead, colourful bunting and balloons tied to the lamp posts, a crowd of small friendly cartoon dinosaurs of assorted colours strolling the concourse in ones and twos, lush palms and ferns beyond the fence line, warm cheerful midday daylight. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no lettering, no words, no numbers, no signage writing anywhere in the scene, no human characters, no people, no human visitors of any kind, no UI elements." } }
```

3. Download the result to a scratch file **outside the repo** (never stage a working file under `assets/images/` — vitest runs test files in parallel forks and another file can observe it mid-run), e.g. `C:/Users/Claude/AppData/Local/Temp/art-5a/guests-src.png`.
4. `node scripts/fit-art.mjs banner C:/Users/Claude/AppData/Local/Temp/art-5a/guests-src.png assets/images/banners/guests.webp`
   The generator emits 1264×848; `banner` cover-scales and center-crops to 1536×1024 WebP q95.
5. Review by eye before committing: the no-human clause is doubled here on purpose — a scene literally about *guests* is the one prompt in this file most likely to render people, and a single human figure makes the banner unusable beside the other 26.

- [ ] **Step 4: Wire the three `/guests` surfaces and widen `Payload`**

`src/modules/guests/embeds.ts` — replace lines 1-16 (the imports and the `Payload` block) with:

```ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import type { Ctx } from '../../core/context.js';
import { attach, assetImage } from '../../core/images.js';
import { attendanceOf } from '../park/attendance.js';
import { levelValue } from '../park/service.js';
import { FOODS } from '../../data/foods.js';
import { ATTRACTIONS, attractionFor, type AttractionDef } from '../../data/attractions.js';
import {
  ATTENDANCE_MAX, ATTENDANCE_SPECIES_TARGET, ATTRACTION_DRAW_TARGET,
  type MilestoneDef,
} from '../../data/attendance.js';
import { attractionRows, buildableKinds, claimableMilestones, nextMilestone } from './service.js';

// Matches dex/embeds.ts's Payload shape, `files` and all. The previous version of this
// comment said there would never be a files key here because the module shipped no art;
// that recorded what a past release had not done, not a design decision, and it is no
// longer true. All three builders below attach banners/guests through attach(), so every
// /guests surface carries exactly one upload. The i.update at src/modules/guests/index.ts
// re-renders through guestsPayload, and an update carrying `files` replaces the message's
// whole attachment set — with an identical one, because the pre- and post-claim renders go
// through the same builder and reference the same banner. That is precisely why nothing
// here sets an `attachments` key by hand: attach() supplies `files` on every render, so
// there is never a stale set left for an update to shed.
export interface Payload {
  embeds: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}
```

Replace the `return` on line 109 (`guestsPayload`) with:

```ts
  const payload: Payload = { embeds: [embed], components: claimRows(userId, claimable) };
  attach(embed, payload, 'image', assetImage('banners', 'guests'));
  return payload;
```

Replace the `return` on line 127 (`builtPayload`) with:

```ts
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', 'guests'));
  return payload;
```

Replace the `return` on line 160 (`milestonePayload`) with:

```ts
  const payload: Payload = { embeds: [embed], components: claimRows(userId, claimable) };
  attach(embed, payload, 'image', assetImage('banners', 'guests'));
  return payload;
```

`src/modules/guests/index.ts` — replace the comment at lines 107-111 (leave `await i.update(guestsPayload(ctx, i.user.id));` on line 112 untouched):

```ts
        // Re-render so the message that was just used advances — a second layer only.
        // The customId check above is what actually protects the claim. No attachments
        // key by hand: guestsPayload attaches banners/guests on every render, so this
        // update replaces the message's attachment set with an identical one. Setting
        // `attachments: []` here would be the fightFrames rule misapplied — that rule
        // exists because one MessagePayload object reaches two send sites and each must
        // shed the other's set; this payload is built fresh and sent exactly once.
```

`src/modules/help/index.ts` — line 98, add the lazy art descriptor (a descriptor, never a built `ImageRef` — `assetImage` returns a fresh `AttachmentBuilder` per call and `HELP_TOPICS` is module-level):

```ts
  guests: { title: '🎡 Guests', art: { kind: 'banners', name: 'guests' }, body: [
```

`tests/help.test.ts` — line 56, add `'guests'` to the hard-coded sorted list:

```ts
    expect([...covered].sort()).toEqual(
      ['battles', 'care', 'eggs', 'expeditions', 'genelab', 'getting-started', 'guests', 'ranks', 'shop', 'trading']);
```

This adds no `HELP_TOPICS` **key**, only a field on an existing value, so the `/help` builder's choices are unchanged and **no `npm run deploy-commands` is needed**.

- [ ] **Step 5: Update `tests/images.test.ts`'s count comment**

Replace lines 174-175 (`// Covers all 26 committed banners, not just the 17 the static scrape can see:` and its continuation) with:

```ts
  // Covers all 27 committed banners, not just the 18 the static scrape can see:
```

- [ ] **Step 6: Document the banner in `docs/assets/prompts.md`**

Line 7: `rarities section). The 26 embed banners were generated with Higgsfield` → `rarities section). The 27 embed banners were generated with Higgsfield`.

Line 409: `26 wide banners for the surfaces that have no site or egg art of their` → `27 wide banners for the surfaces that have no site or egg art of their`.

Immediately after the `achievements.webp` table row (line 432), insert:

```
| `assets/images/banners/guests.webp` | 1536×1024 | `/guests view`, `/guests build`, `/guests claim` and `/help topic:guests` embed image |
```

Immediately after the `achievements.webp` prompt block and before `**Gene Lab (`gene_lab.webp`) and Gene Splice (`gene_splice.webp`):**` (line 658), insert:

```
**Guests (`guests.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. Generated with
`help.webp` **and** `leaderboards.webp` attached as `image` references: the
first carries the warm park-entrance vocabulary, the second is the only
existing banner with a crowd of cartoon dinosaurs and bunting, and the guests
plaza has to read as the same park as both.

**The no-human clause is doubled on this one prompt, and that is load-bearing.**
Every banner in this section forbids human characters, but a scene whose whole
subject is *visitors* is the one that will render people anyway; a single human
figure makes the banner unusable beside the other 26, and no test can see it.
Keep "no human characters, no people, no human visitors of any kind" verbatim on
any regeneration. The visitors are cartoon dinosaurs, the same way `trading.webp`
staffs its market stall.

> A wide cartoon scene of a busy dinosaur park visitor plaza on a bright open
> day: a paved central concourse running back from a timber entrance arch with
> turnstile gates, a striped gift-shop awning on the left and a picnic lawn
> with chequered blankets and benches on the right, a raised timber viewing
> platform on stilts behind them, a cable gondola strung between two pylons
> overhead, colourful bunting and balloons tied to the lamp posts, a crowd of
> small friendly cartoon dinosaurs of assorted colours strolling the concourse
> in ones and twos, lush palms and ferns beyond the fence line, warm cheerful
> midday daylight. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no lettering, no words,
> no numbers, no signage writing anywhere in the scene, no human characters, no
> people, no human visitors of any kind, no UI elements.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/images.test.ts tests/guests.test.ts tests/help.test.ts tests/docs-assets.test.ts`
Expected: PASS — including `docs-assets`'s "every banner count quoted in prompts.md equals the number of committed banner files" (both quoted `27`s now match the 27 files on disk) and `images`'s "references every committed non-event banner", which would fail if the asset were committed without the wiring.

- [ ] **Step 8: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add assets/images/banners/guests.webp src/modules/guests/embeds.ts src/modules/guests/index.ts src/modules/help/index.ts docs/assets/prompts.md tests/images.test.ts tests/guests.test.ts tests/help.test.ts
git commit -m "Add the guests banner and wire it to every /guests surface

The three /guests payload builders and the /help guests topic all shipped
bare text. All four now attach banners/guests through attach(), and the
Payload type carries files.

The claim button re-renders with i.update, which replaces the message's
whole attachment set, so the banner is re-attached on the post-claim render
rather than the message silently losing its image. No attachments key is set
by hand: the payload is built fresh and sent once, so the replacement set is
already identical."
```

---

### Task 7: Dex banner — `banners/dex.webp` (banner #28)

**Files:**
- Create: `assets/images/banners/dex.webp`
- Modify: `src/modules/dex/embeds.ts:42-63` (the "no art" comment and `dexListPayload`'s return)
- Modify: `docs/assets/prompts.md` (`27` → `28` at line 7 and at the `## Embed banners` opening paragraph; new table row after the `guests.webp` row Task 6 added; new prompt block after Task 6's Guests block)
- Modify: `tests/images.test.ts` (the `27`/`18` count comment Task 6 left, and a new case inside `describe('banner art')`)
- Test: `tests/dex.test.ts`, `tests/images.test.ts`

**Interfaces:**
- Consumes: `attach(embed, payload, slot, ref)` and `assetImage('banners', name)` from `src/core/images.js`; the already-present `export interface Payload { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }` at `src/modules/dex/embeds.ts:12`.
- Produces: `dexListPayload(ctx: Ctx, userId: string, filters: DexFilters, page: number): Payload` now returns a payload whose `files` is `[AttachmentBuilder('dex.webp')]` whenever the asset is present. A committed `assets/images/banners/dex.webp` at 1536×1024, taking the on-disk banner count from 27 to **28** and the scrape-visible count from 18 to 19.

**Correction to the spec, verified against the file:** the spec's Architecture C says *"`guests/embeds.ts` and `dex/embeds.ts` `Payload` types gain `files?: AttachmentBuilder[]`"*. That is true of guests (Task 6) but **not** of dex — `src/modules/dex/embeds.ts:12` already declares `files?: AttachmentBuilder[]`, because `dexViewPayload` has attached a `dinos/<archetype>-<diet>` thumbnail since the dex shipped. There is no type change to make here. What does exist is the stale comment at `:42-46`, whose last sentence claims *"Ships no banner — this spec has no art"*; that is the comment to rewrite, and it sits above `dexListPayload`, not above the interface.

- [ ] **Step 1: Write the failing tests**

Add to `tests/images.test.ts`, inside `describe('banner art', …)`, immediately after the `guests is scrape-visible` case Task 6 added:

```ts
  // Same reasoning as the guests case above: the it.each loop's case for this name is
  // REGISTERED from the scrape, so a wiring form scrapeBannerNames cannot read would
  // register zero cases for it and go dark with the suite green.
  it('dex is scrape-visible and ships at 1536×1024', async () => {
    expect(BANNERS, 'banners/dex is not reachable by scrapeBannerNames').toContain('dex');
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', 'dex.webp'));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });
```

Add to `tests/dex.test.ts`, inside `describe('dexListPayload', …)`, after the `omits it entirely when unranked` case (currently ending at `:119`):

```ts
  it('ships the dex banner as the embed image with its file', () => {
    const payload = dexListPayload(ctx, 'u1', {}, 1);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://dex.webp');
    // toEqual on the whole list, not toContain: attach() appends, so a second slot
    // wired later shows up here rather than hiding behind a membership check. The
    // basenames also have to stay distinct — assetImage names a file `${name}.webp`
    // with no kind prefix, so two refs resolving to one name make attachment://dex.webp
    // ambiguous and one embed slot renders the wrong picture.
    expect(payload.files!.map((f) => f.name)).toEqual(['dex.webp']);
  });
```

Add to `tests/dex.test.ts`, inside `describe('dex module', …)`, after the `an unrecognised action still degrades to deferUpdate` case (currently ending at `:185`):

```ts
  // The page button answers with i.update, and an update carrying `files` replaces the
  // message's whole attachment set. That handler already sent an explicit
  // `attachments: []` while the payload carried no files at all; now that it does, the
  // pair is the fightFrames F1/F4 shape — the empty array sheds the old set and the
  // fresh upload re-establishes it. Both halves are asserted, because dropping either
  // one leaves a dangling attachment:// URL with no error anywhere.
  it('the page button re-attaches the banner alongside its explicit empty attachments', async () => {
    const i = fakeButton({ customId: 'dex:page:u1:2:-:-:-', user: 'u1' });
    await dexModule.components[0].execute(ctx, i.asInteraction() as never);
    const update = i.replies[0] as {
      embeds: Array<{ toJSON(): { image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
      attachments: unknown[];
    };
    expect(update.embeds[0].toJSON().image?.url).toBe('attachment://dex.webp');
    expect(update.files!.map((f) => f.name)).toEqual(['dex.webp']);
    expect(update.attachments).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/images.test.ts -t "dex is scrape-visible"`
Expected: FAIL with `AssertionError: banners/dex is not reachable by scrapeBannerNames: expected [ 'achievements', 'battle_defeat', … ] to include 'dex'`

Run: `npx vitest run tests/dex.test.ts -t "ships the dex banner"`
Expected: FAIL with `AssertionError: expected undefined to be 'attachment://dex.webp'`

- [ ] **Step 3: Generate the banner with Higgsfield and fit it**

Model `nano_banana_pro` (routes to `nano_banana_2`), aspect ratio `3:2`, image-to-image against `banners/sell.webp` (the buyer's stall — a warm indoor bench of ledger, scale and props, the closest existing composition) and `banners/daily.webp` (the quest board, the banner that solved the blank-surface problem: its "three blank scroll-shaped tags" is the phrasing that kept the model from lettering them).

1. `mcp__claude_ai_Higgsfield__media_upload` with `files: [{ filename: 'sell.webp' }, { filename: 'daily.webp' }]`, PUT the bytes of `assets/images/banners/sell.webp` and `assets/images/banners/daily.webp` to the returned `upload_url` values, then `mcp__claude_ai_Higgsfield__media_confirm`.
2. `mcp__claude_ai_Higgsfield__generate_image` with:

```json
{ "params": { "model": "nano_banana_pro", "aspect_ratio": "3:2",
  "medias": [{ "role": "image", "value": "<media_id sell.webp>" },
             { "role": "image", "value": "<media_id daily.webp>" }],
  "prompt": "A wide cartoon scene of a dinosaur park field-study desk: a heavy leather-bound field guide lying open at the centre of a worn timber bench, its blank unlettered pages carrying only hand-painted dinosaur portraits and empty ruled lines, a brass magnifying glass resting across one page, a corkboard behind it pinned with amber specimens, pressed ferns and small blank index cards, a short stack of closed volumes and a cup of ink brushes beside the guide, a lit brass desk lamp casting warm light from the upper left, jungle foliage visible through a window beyond. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no lettering, no words, no numbers, no handwriting, no signage writing anywhere in the scene, no human characters, no UI elements." } }
```

3. Download the result to a scratch file outside the repo, e.g. `C:/Users/Claude/AppData/Local/Temp/art-5a/dex-src.png`.
4. `node scripts/fit-art.mjs banner C:/Users/Claude/AppData/Local/Temp/art-5a/dex-src.png assets/images/banners/dex.webp`
5. Review by eye: an open book and a pinned card board are two of the strongest lettering magnets in this whole file. If any legible writing survives, regenerate rather than shipping it — the `collect.webp` precedent (a carved "PARK ENTRANCE" sign that got through a plain "No text" clause) is the reason the "blank"/"unlettered" adjectives are in the prompt and not just the negative clause.

- [ ] **Step 4: Wire `/dex list` and rewrite the stale comment**

`src/modules/dex/embeds.ts` — replace the comment block at lines 42-46 and `dexListPayload`'s `return` at `:60-63` so the function reads:

```ts
// Models achievementsPayload (src/modules/daily/embeds.ts:92): the payload builder
// calls the read service itself, paginate() clamps the page, and the page row only
// renders once there's more than one page. The previous version of this comment said
// this surface ships no banner because "this spec has no art" — a record of what a past
// release did not do, not a design decision, and no longer true: it now attaches
// banners/dex. tests/images.test.ts scrapes every `assetImage('banners', ...)` call, so
// that reference is what makes the committed file non-orphaned and dimension-checked.
export function dexListPayload(ctx: Ctx, userId: string, filters: DexFilters, page: number): Payload {
  const all = dexRows(ctx, userId, filters);
  const { items, page: p, pages } = paginate(all, page);
  const progress = dexProgress(ctx, userId);
  const rank = tierForPoints(bumpLegacyBest(ctx, userId));
  const rankPart = rank ? ` · ${rank.title}` : '';
  const lines = items.length
    ? items.map((r) => `${r.seen ? '✅' : '▫️'} ${rarityEmoji(r.species.rarity)}${r.species.name} — ${capitalize(r.species.diet)} ${capitalize(r.species.archetype)}`).join('\n')
    : 'No species match that filter.';
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`📖 Dex${filterLabel(filters)}`)
    .setDescription(lines)
    .setFooter({ text: `${progress.seen}/${progress.total} seen · Page ${p}/${pages}${rankPart}` });
  const payload: Payload = {
    embeds: [embed],
    components: pages > 1 ? [dexPageRow(userId, filters, p, pages)] : [],
  };
  attach(embed, payload, 'image', assetImage('banners', 'dex'));
  return payload;
}
```

`src/modules/dex/index.ts` needs **no change**: its page-button handler at `:80-83` already sends `attachments: []` alongside the spread payload, and the spread builds a fresh object per click, so no array is shared between two send sites. Leave it exactly as it is.

- [ ] **Step 5: Update `tests/images.test.ts`'s count comment**

Replace the line Task 6 left as `// Covers all 27 committed banners, not just the 18 the static scrape can see:` with:

```ts
  // Covers all 28 committed banners, not just the 19 the static scrape can see:
```

- [ ] **Step 6: Document the banner in `docs/assets/prompts.md`**

Line 7: `rarities section). The 27 embed banners were generated with Higgsfield` → `rarities section). The 28 embed banners were generated with Higgsfield`.

The `## Embed banners` opening paragraph: `27 wide banners for the surfaces that have no site or egg art of their` → `28 wide banners for the surfaces that have no site or egg art of their`.

Immediately after the `guests.webp` table row Task 6 added, insert:

```
| `assets/images/banners/dex.webp` | 1536×1024 | `/dex list` embed image |
```

Immediately after Task 6's Guests prompt block and before `**Gene Lab (`gene_lab.webp`) and Gene Splice (`gene_splice.webp`):**`, insert:

```
**Dex (`dex.webp`):** generated with model `nano_banana_pro` (the API silently
routes this to `nano_banana_2`) at aspect ratio `3:2`, source output 1264×848,
then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024 WebP q95 —
same pipeline as the rest of this section. Generated with `sell.webp` **and**
`daily.webp` attached as `image` references: `sell.webp` is the closest existing
composition (a warm timber bench of ledger, scale and props) and `daily.webp` is
the banner that already solved this prompt's hardest problem.

**The lettering risk here is the highest in this section**, because the subject
is an open book on a desk pinned with index cards — three surfaces a model will
happily letter. Two defences are load-bearing together, and neither is enough
alone: the objects are described as *blank* and *unlettered* in the positive
part of the prompt (the `daily.webp` "three blank scroll-shaped tags" trick, and
the `collect.webp` "blank chalkboard" fix before it), and the negative clause is
extended with "no handwriting" beyond the usual expanded form. `collect.webp`
rendered a carved "PARK ENTRANCE" sign past a plain "No text" clause; assume the
same of any regeneration that drops either defence.

> A wide cartoon scene of a dinosaur park field-study desk: a heavy
> leather-bound field guide lying open at the centre of a worn timber bench, its
> blank unlettered pages carrying only hand-painted dinosaur portraits and empty
> ruled lines, a brass magnifying glass resting across one page, a corkboard
> behind it pinned with amber specimens, pressed ferns and small blank index
> cards, a short stack of closed volumes and a cup of ink brushes beside the
> guide, a lit brass desk lamp casting warm light from the upper left, jungle
> foliage visible through a window beyond. Glossy cartoon mobile-game art style,
> bold dark outlines, vibrant saturated colors, strong glossy highlights, clean
> cel shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no handwriting, no signage writing anywhere
> in the scene, no human characters, no UI elements.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/images.test.ts tests/dex.test.ts tests/docs-assets.test.ts`
Expected: PASS

- [ ] **Step 8: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add assets/images/banners/dex.webp src/modules/dex/embeds.ts docs/assets/prompts.md tests/images.test.ts tests/dex.test.ts
git commit -m "Add the dex banner and wire it to /dex list

/dex list shipped bare text behind a comment claiming the dex has no art,
which recorded what an earlier release had not done rather than a decision.
It now attaches banners/dex and the comment says so.

The Payload type needed no change: it has carried an optional files array
since /dex view started attaching an archetype thumbnail. The page button's
i.update already sent an explicit empty attachments array, which now pairs
with a real upload the same way the battle frame contract does."
```

---

### Task 8: Landmark banner — `banners/landmark.webp` (banner #29)

**Files:**
- Create: `assets/images/banners/landmark.webp`
- Modify: `src/modules/park/embeds.ts:123-148` (`landmarkPayload`'s local payload type and return)
- Modify: `src/modules/park/index.ts:499-501` (the `i.update` comment)
- Modify: `docs/assets/prompts.md` (`28` → `29` at line 7 and at the `## Embed banners` opening paragraph; new table row after the `dex.webp` row Task 7 added; new prompt block after Task 7's Dex block)
- Modify: `tests/images.test.ts` (the `28`/`19` count comment Task 7 left, and a new case inside `describe('banner art')`)
- Test: `tests/landmarks.test.ts`, `tests/images.test.ts`

**Interfaces:**
- Consumes: `attach(embed, payload, slot, ref)` and `assetImage('banners', name)` from `src/core/images.js` — both already imported at `src/modules/park/embeds.ts:7`, as is `AttachmentBuilder` (a value import at `:1`, used by `withParkImage`).
- Produces: `landmarkPayload(user: User, current: LandmarkDef | null, next: LandmarkDef | null): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }` — `components` stays **non-optional**, because `tests/landmarks.test.ts:193-195` indexes `row.components[0]` directly. A committed `assets/images/banners/landmark.webp` at 1536×1024, taking the on-disk banner count from 28 to **29** and the scrape-visible count from 19 to 20.

- [ ] **Step 1: Write the failing tests**

Add to `tests/images.test.ts`, inside `describe('banner art', …)`, immediately after the `dex is scrape-visible` case Task 7 added:

```ts
  // Same reasoning as the two cases above: the it.each loop's case for this name is
  // registered from the scrape, so a wiring form scrapeBannerNames cannot read would
  // register zero cases for it and go dark with the suite still green.
  it('landmark is scrape-visible and ships at 1536×1024', async () => {
    expect(BANNERS, 'banners/landmark is not reachable by scrapeBannerNames').toContain('landmark');
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', 'landmark.webp'));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });
```

Add to `tests/landmarks.test.ts`, inside `describe('/park landmark', …)`, after the `reports the ladder complete when the top rung is clicked again` case (the last one in that block):

```ts
  it('ships the landmark banner as the embed image with its file', async () => {
    const i = await run();
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://landmark.webp');
    // toEqual on the whole list, not toContain: attach() appends, so a second slot wired
    // later shows up here rather than hiding behind a membership check.
    expect(payload.files!.map((f) => f.name)).toEqual(['landmark.webp']);
  });

  // The buy button answers with i.update, and an update carrying `files` replaces the
  // message's whole attachment set. The success path spreads landmarkPayload's output, so
  // the banner is re-attached and the set is replaced with an identical one — without
  // this, the message the player just paid on would silently lose its image.
  it('the buy button re-renders with the banner rather than blanking the message art', async () => {
    ctx.db.update(schema.users).set({ cash: 5_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = await click('park:landmark:buy:u1:1');
    const update = i.replies[0] as {
      embeds: Array<{ toJSON(): { image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    expect(update.embeds[0].toJSON().image?.url).toBe('attachment://landmark.webp');
    expect(update.files!.map((f) => f.name)).toEqual(['landmark.webp']);
    // And no hand-set attachments key. The fightFrames rule (attachments: [] mandatory
    // and unconditional) exists because one MessagePayload object reaches two send sites
    // and each must shed the other's set; landmarkPayload builds a fresh object on every
    // call and this spread is sent exactly once.
    expect('attachments' in update).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/images.test.ts -t "landmark is scrape-visible"`
Expected: FAIL with `AssertionError: banners/landmark is not reachable by scrapeBannerNames: expected [ 'achievements', 'battle_defeat', … ] to include 'landmark'`

Run: `npx vitest run tests/landmarks.test.ts -t "ships the landmark banner"`
Expected: FAIL with `AssertionError: expected undefined to be 'attachment://landmark.webp'`

- [ ] **Step 3: Generate the banner with Higgsfield and fit it**

Model `nano_banana_pro` (routes to `nano_banana_2`), aspect ratio `3:2`, image-to-image against `banners/help.webp` (the carved gate posts and golden-hour god rays — the monumental register this scene needs) and `banners/leaderboards.webp` (the existing ceremonial plaza: stone podium, bunting, celebratory lighting).

1. `mcp__claude_ai_Higgsfield__media_upload` with `files: [{ filename: 'help.webp' }, { filename: 'leaderboards.webp' }]`, PUT the bytes of `assets/images/banners/help.webp` and `assets/images/banners/leaderboards.webp` to the returned `upload_url` values, then `mcp__claude_ai_Higgsfield__media_confirm`.
2. `mcp__claude_ai_Higgsfield__generate_image` with:

```json
{ "params": { "model": "nano_banana_pro", "aspect_ratio": "3:2",
  "medias": [{ "role": "image", "value": "<media_id help.webp>" },
             { "role": "image", "value": "<media_id leaderboards.webp>" }],
  "prompt": "A wide cartoon scene of a dinosaur park monument plaza at golden hour: a broad paved circle ringed by low stone kerbs and clipped hedges, a tall tiered pale-stone monument rising at its centre banded with glowing amber inlay and topped with a gleaming verdigris-bronze dinosaur silhouette, a shallow reflecting pool in front of it catching the light, flanking marble columns hung with plain colored banners, a small friendly cartoon dinosaur standing at the plaza edge for scale, lush park greenery and distant misty green hills behind, warm golden evening light with long soft shadows and gentle god rays. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no lettering, no words, no numbers, no plaques, no dedication inscriptions or carved writing anywhere on the monument or its base, no signage writing anywhere in the scene, no human characters, no UI elements." } }
```

3. Download the result to a scratch file outside the repo, e.g. `C:/Users/Claude/AppData/Local/Temp/art-5a/landmark-src.png`.
4. `node scripts/fit-art.mjs banner C:/Users/Claude/AppData/Local/Temp/art-5a/landmark-src.png assets/images/banners/landmark.webp`
5. Review by eye: a monument is *the* object a model inscribes. The banners on the columns must stay plain, and the plinth must carry no dedication plaque.

Note this banner is **1536×1024 and has no contrast requirement**, unlike the three `park/landmark-a|b|c.webp` bands at `docs/assets/prompts.md:1280`. Those are 270×150 map tiles that `drawLandmark` paints a tier name over with no scrim, so they need a dark label band baked into the composition. This is an embed image with text nowhere near it — do not copy the "BOTTOM FIFTH is a solid dark slate kerb band" clause across.

- [ ] **Step 4: Wire `/park landmark`**

`src/modules/park/embeds.ts` — replace lines 136 and 148 so `landmarkPayload` reads:

```ts
  const payload: {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
    files?: AttachmentBuilder[];
  } = { embeds: [embed], components: [] };
```

…and, at the end of the function, replace `return payload;` with:

```ts
  // attach(), never a hand-assigned payload.files — the idiom that shipped three
  // attachment defects in round 2 and is banned outright by tests/images.test.ts.
  // `components` stays non-optional: tests/landmarks.test.ts indexes components[0]
  // directly to read the buy button's customId back.
  attach(embed, payload, 'image', assetImage('banners', 'landmark'));
  return payload;
```

`src/modules/park/index.ts` — replace the comment at lines 499-501 (leave the `await i.update({ … })` block at `:502-505` untouched):

```ts
            // i.update, not i.reply: the message the player just clicked must stop offering a
            // rung it has already sold. No attachments key by hand — landmarkPayload attaches
            // banners/landmark on every call, so this update replaces the message's attachment
            // set with an identical one. Setting `attachments: []` here would be the fightFrames
            // rule misapplied: that rule exists because one MessagePayload object reaches two
            // send sites and each must shed the other's set, and landmarkPayload builds a fresh
            // object per call that is spread into exactly one send.
```

- [ ] **Step 5: Update `tests/images.test.ts`'s count comment**

Replace the line Task 7 left as `// Covers all 28 committed banners, not just the 19 the static scrape can see:` with:

```ts
  // Covers all 29 committed banners, not just the 20 the static scrape can see:
```

- [ ] **Step 6: Document the banner in `docs/assets/prompts.md`**

Line 7: `rarities section). The 28 embed banners were generated with Higgsfield` → `rarities section). The 29 embed banners were generated with Higgsfield`.

The `## Embed banners` opening paragraph: `28 wide banners for the surfaces that have no site or egg art of their` → `29 wide banners for the surfaces that have no site or egg art of their`.

Immediately after the `dex.webp` table row Task 7 added, insert:

```
| `assets/images/banners/landmark.webp` | 1536×1024 | `/park landmark` embed image |
```

Immediately after Task 7's Dex prompt block and before `**Gene Lab (`gene_lab.webp`) and Gene Splice (`gene_splice.webp`):**`, insert:

```
**Landmark (`landmark.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. Generated with
`help.webp` **and** `leaderboards.webp` attached as `image` references:
`help.webp` carries the carved-monument register and the golden-hour god rays,
`leaderboards.webp` is the only existing banner built around a ceremonial plaza.

**Do not confuse this with `park/landmark-{a,b,c}` further down this file.**
Those three are 270×150 map tiles that `drawLandmark` paints a tier name over
with no scrim, which is why each of them carries a hard contrast requirement and
an explicit dark kerb band baked into the composition. This is a 1536×1024 embed
image with no text drawn over it anywhere, so none of that applies — copying the
"BOTTOM FIFTH is a solid dark slate kerb band" clause across would darken a fifth
of the banner for nothing.

**No inscriptions is the load-bearing clause.** A monument is the single object a
model is most likely to letter — a dedication plaque on the plinth reads as
deliberate and survives casual review. The negative clause names plaques,
dedication inscriptions and carved writing explicitly, on top of the expanded
no-text form used elsewhere in this section, and the column banners are
specified as plain and colored rather than left open to interpretation.

> A wide cartoon scene of a dinosaur park monument plaza at golden hour: a broad
> paved circle ringed by low stone kerbs and clipped hedges, a tall tiered
> pale-stone monument rising at its centre banded with glowing amber inlay and
> topped with a gleaming verdigris-bronze dinosaur silhouette, a shallow
> reflecting pool in front of it catching the light, flanking marble columns hung
> with plain colored banners, a small friendly cartoon dinosaur standing at the
> plaza edge for scale, lush park greenery and distant misty green hills behind,
> warm golden evening light with long soft shadows and gentle god rays. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no plaques, no
> dedication inscriptions or carved writing anywhere on the monument or its base,
> no signage writing anywhere in the scene, no human characters, no UI elements.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/images.test.ts tests/landmarks.test.ts tests/park.test.ts tests/docs-assets.test.ts`
Expected: PASS — `tests/park.test.ts` is included because `landmarkPayload` is reached from `/park landmark`'s dispatch there, and `tests/landmarks.test.ts`'s "landmark power-freedom" file-list guard must stay green (this change adds no `landmarkTier` reader, so `src/modules/park/embeds.ts` must not appear in `LANDMARK_TIER_READERS`).

- [ ] **Step 8: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add assets/images/banners/landmark.webp src/modules/park/embeds.ts src/modules/park/index.ts docs/assets/prompts.md tests/images.test.ts tests/landmarks.test.ts
git commit -m "Add the landmark banner and wire it to /park landmark

/park landmark was the prestige surface with no picture on it. It now
attaches banners/landmark through attach(), and the buy button's i.update
re-attaches it so the message the player just paid on keeps its image
instead of having its attachment set replaced with an empty one.

The banner is unrelated to the three 270x150 park/landmark-a|b|c map tiles:
those carry a tier label drawn over the art and need a dark band baked in,
this one has no text over it and needs none."
```

---

### Task 9: Season banner — `/season`, `season:claim`, and the season arm of the park alert DM

**Files:**
- Create: `assets/images/banners/season.webp`
- Modify: `src/modules/daily/season-embeds.ts:47` (the `banners/daily` borrow in `seasonPayload`)
- Modify: `src/modules/daily/season-embeds.ts:51-63` (`seasonClaimPayload`, currently art-free)
- Modify: `src/modules/park/alert-embeds.ts:66-69` (the `banners/collect` borrow in the season arm)
- Modify: `docs/assets/prompts.md` (banner count ×2, one table row, one prompt block)
- Test: `tests/season-embeds.test.ts`
- Test: `tests/alert-embeds.test.ts`
- Test: `tests/images.test.ts` (no edit — the `it.each` dimension case registers itself from the scrape; verified in Step 6)
- Test: `tests/docs-assets.test.ts` (no edit — the banner count is read from disk; the doc is what changes)

**Interfaces:**
- Consumes: `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos', name: string): ImageRef | null` and `attach(embed: EmbedBuilder, payload: { files?: AttachmentBuilder[] }, slot: 'image' | 'thumbnail', ref: ImageRef | null): void`, both from `src/core/images.js`. `Payload` (`src/modules/daily/embeds.js`) is `{ embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }`.
- Produces: the committed file `assets/images/banners/season.webp` (1536×1024 WebP q95), so `assetImage('banners', 'season')` resolves non-null. `seasonPayload(view: SeasonView, userId: string): Payload` and `seasonClaimPayload(res: SeasonClaimResult): Payload` both now populate `files` with exactly `[season.webp]`. `alertPayload(userId: string, escapes: EscapeAlert[], income: IncomeCapAlert | null, season: SeasonEndAlert | null, now: number)` gains a third banner arm and still returns an object with **no** `attachments` key.

---

- [ ] **Step 1: Write the failing test**

Append these three tests to `tests/season-embeds.test.ts`. The first goes inside the existing `describe('seasonPayload', …)` block, the second inside `describe('seasonClaimPayload', …)`.

```ts
  // Was a borrow: the season hub shipped with banners/daily, the same picture /daily
  // already uses, so the two hubs were indistinguishable at a glance.
  it('attaches its own season banner, not the daily hub borrow', () => {
    rollSeason(ctx, 'p');
    const payload = seasonPayload(seasonView(ctx, 'p')!, 'p');
    expect(payload.files!.map((f) => f.name)).toEqual(['season.webp']);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://season.webp');
  });
```

```ts
  it('dresses the claim reply with the season banner', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 45);   // 225 = rungs 1-3
    const payload = seasonClaimPayload(claimSeason(ctx, 'p'));
    expect(payload.files!.map((f) => f.name)).toEqual(['season.webp']);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://season.webp');
  });
```

In `tests/alert-embeds.test.ts`, add this helper immediately below the existing `json` helper (line 10):

```ts
// alertPayload's return type is `NotifyPayload & {…}`, and NotifyPayload is a UNION whose
// other arm is `string` — so `.files` is not readable off the intersection the way
// `.embeds` and `.components` are. One narrow cast here beats a cast in every test below.
const fileNames = (p: NonNullable<ReturnType<typeof alertPayload>>): Array<string | null | undefined> =>
  ((p as { files?: Array<{ name?: string | null }> }).files ?? []).map((f) => f.name);
```

…then append these two tests inside `describe('alertPayload', …)`:

```ts
  it('dresses a season-only alert with the season banner and STILL carries no attachments key', () => {
    const p = alertPayload('u1', [], null, seasonNudge, 0)!;
    expect(fileNames(p)).toEqual(['season.webp']);
    expect(json(p).image?.url).toBe('attachment://season.webp');
    // The banner may be added; the attachments key may NEVER be. deliverNotification hands
    // ONE object to channelSend and then, on failure, to dmSend. MessagePayload.resolveBody
    // pushes resolved files into an explicit attachments array and create() only
    // shallow-copies it, so a pre-set key carries the first attempt's mutation into the
    // second and the DM ships duplicate attachment ids. Omitting the key is the whole fix.
    expect('attachments' in (p as Record<string, unknown>)).toBe(false);
  });

  it('keeps the escape and income banners when either condition rides alongside the season nudge', () => {
    // The banner arms must track the title arms: escapes lead, then income, and only a
    // season-ONLY alert gets the season banner — matching the '🎖️ Season ending soon' title.
    const withEscape = alertPayload('u1', [esc()], null, seasonNudge, 0)!;
    expect(fileNames(withEscape)).toEqual(['care_neglect.webp']);
    const withIncome = alertPayload('u1', [], { capAt: 0, pending: 500, capHours: 8 }, seasonNudge, 0)!;
    expect(fileNames(withIncome)).toEqual(['collect.webp']);
    for (const p of [withEscape, withIncome]) {
      expect('attachments' in (p as Record<string, unknown>)).toBe(false);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/season-embeds.test.ts tests/alert-embeds.test.ts -t "season banner"`
Expected: FAIL. `attaches its own season banner, not the daily hub borrow` fails with `AssertionError: expected [ 'daily.webp' ] to deeply equal [ 'season.webp' ]`. `dresses the claim reply with the season banner` fails with `TypeError: Cannot read properties of undefined (reading 'map')` (`seasonClaimPayload` sets no `files` at all). `dresses a season-only alert with the season banner…` fails with `expected [ 'collect.webp' ] to deeply equal [ 'season.webp' ]`.

- [ ] **Step 3: Generate and fit the banner**

House style for this section: dinosaurs are permitted (this is the one section that drops the shared block's "no characters" clause and forbids only human ones), and the expanded no-text clause is load-bearing — a model will happily letter a festival ground.

Generate with the Higgsfield `generate_image` tool, model `nano_banana_pro` (the API silently routes this to `nano_banana_2`), aspect ratio `3:2` (source output 1264×848), with this prompt:

> A wide cartoon scene of a dinosaur park season festival ground: a tall carved timber totem post in the center hung with a large gleaming gold medal on a deep purple ribbon, a row of four wooden reward posts stepping up in height beside it, each topped with a small prize — a plump coin sack, a glowing crystal shard, a bundle of fresh ferns, a speckled egg in straw — strings of colorful triangular pennants running between the posts, three large painted cloth hangings behind them showing a rain-soaked paddock, a sun-baked golden plain, and a frost-dusted ridge, a cheerful cartoon dinosaur looking up at the medal with its head raised, warm late-afternoon light with petals drifting through the air. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no lettering, no words, no numbers, no signage writing anywhere in the scene, no human characters, no UI elements.

Save the returned image, then fit it:

```bash
mkdir -p "C:/Users/Claude/AppData/Local/Temp/claude/art-5a"
# save the generated image to C:/Users/Claude/AppData/Local/Temp/claude/art-5a/season-src.png first
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
node scripts/fit-art.mjs banner "C:/Users/Claude/AppData/Local/Temp/claude/art-5a/season-src.png" assets/images/banners/season.webp
```

Expected output: `banner assets/images/banners/season.webp 1536x1024 (source 1264x848)`.

If `fit-art.mjs` throws `Error: Invalid SVG image` on a PNG that opens fine elsewhere, the file is not corrupt — it carries a C2PA `caBX` chunk whose metadata contains the literal text `<svg`, and `@napi-rs/canvas`'s format sniffer scans the whole buffer for that substring. Strip the chunk (pure provenance metadata, no pixel data) and retry. The recipe is in `docs/assets/prompts.md` under "Decode trap".

- [ ] **Step 4: Wire the three surfaces**

In `src/modules/daily/season-embeds.ts`, replace line 47:

```ts
  attach(embed, payload, 'image', assetImage('banners', 'season'));
```

…and replace the whole tail of `seasonClaimPayload` (the `const embed = …` statement through `return { embeds: [embed] };`) with:

```ts
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`🎖️ Claimed ${res.claimed.length} reward${res.claimed.length === 1 ? '' : 's'}`)
    .setDescription(parts.join('\n') || 'Nothing to claim.');
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', 'season'));
  return payload;
}
```

In `src/modules/park/alert-embeds.ts`, replace lines 66-69 (the comment and the `attach` call) with:

```ts
  // Domain-data ternary, deliberately OUTSIDE attach(): a park with no escapes is not a
  // missing asset, it is a different banner. The three arms track the title chosen above —
  // escapes lead, then income, and a season-ONLY alert gets the season banner so the
  // picture agrees with the '🎖️ Season ending soon' framing. Reachability: the null guard
  // at the top of this function means escapes.length === 0 && !income implies season !== null.
  //
  // Every name stays a literal ON THIS LINE. tests/images.test.ts scrapes banner names one
  // source line at a time, taking every quoted string after `assetImage('banners'` — hoisting
  // the choice into a `const banner` would silently drop all three names from that coverage.
  attach(embed, payload, 'image',
    assetImage('banners', escapes.length > 0 ? 'care_neglect' : income ? 'collect' : 'season'));
```

- [ ] **Step 5: Update `docs/assets/prompts.md`**

Three edits. The banner count is machine-checked by `tests/docs-assets.test.ts` against the actual file count in `assets/images/banners/`, which this task takes from 29 to 30.

1. In the opening paragraph, change `The 29 embed banners were generated with Higgsfield` to `The 30 embed banners were generated with Higgsfield`.
2. In the `## Embed banners` section intro, change `29 wide banners for the surfaces that have no site or egg art of their` to `30 wide banners for the surfaces that have no site or egg art of their`.
3. In the banner table, insert this row directly **above** the `| assets/images/banners/event-clear_skies.webp |` row:

```
| `assets/images/banners/season.webp` | 1536×1024 | `/season` hub + `season:claim` embed image, and the season-ending alert DM |
```

4. Insert this prompt block directly **above** the line beginning ``**Gene Lab (`gene_lab.webp`) and Gene Splice``:

```markdown
**Season (`season.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. The three cloth hangings
stand in for the wet / dry / cold cycle deliberately: the season track rides
the same 30-day rotation the park ground art already renders, so the banner
has to read as "this season" rather than as a generic festival.

> **season.webp:** A wide cartoon scene of a dinosaur park season festival
> ground: a tall carved timber totem post in the center hung with a large
> gleaming gold medal on a deep purple ribbon, a row of four wooden reward
> posts stepping up in height beside it, each topped with a small prize — a
> plump coin sack, a glowing crystal shard, a bundle of fresh ferns, a
> speckled egg in straw — strings of colorful triangular pennants running
> between the posts, three large painted cloth hangings behind them showing a
> rain-soaked paddock, a sun-baked golden plain, and a frost-dusted ridge, a
> cheerful cartoon dinosaur looking up at the medal with its head raised, warm
> late-afternoon light with petals drifting through the air. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/season-embeds.test.ts tests/alert-embeds.test.ts tests/docs-assets.test.ts`
Expected: PASS

Then confirm the dimension case registered itself. `DIMENSION_CHECKED_BANNERS` in `tests/images.test.ts` is built from the source scrape, so wiring `assetImage('banners', 'season')` adds the `it.each` case with no test edit — but a case that never registered is a silent gap, so run it by name:

Run: `npx vitest run tests/images.test.ts -t "season is 1536×1024"`
Expected: PASS, and the reporter shows exactly **1** test passed, 0 skipped. If it reports "No test files found" or 0 tests matched, the scrape did not see the call — check that the name is a plain single-quoted literal on the same line as `assetImage('banners'`.

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add assets/images/banners/season.webp src/modules/daily/season-embeds.ts src/modules/park/alert-embeds.ts docs/assets/prompts.md tests/season-embeds.test.ts tests/alert-embeds.test.ts
git commit -m "Give the season track its own banner

The season hub borrowed banners/daily, so /season and /daily showed the same
picture, and the season-ending alert DM borrowed banners/collect, framing a
rewards deadline as an income warning. Wire banners/season through /season,
season:claim and the season arm of alertPayload.

The alert payload still ships no attachments key: deliverNotification forwards
one object to channelSend and then dmSend, and MessagePayload pushes resolved
files into an explicit attachments array in place while only shallow-copying
it, so a pre-set key would carry the first attempt's mutation into the second."
```

---

### Task 10: Duel banner — `/duel challenge`, `/duel record`, the duel result, and `/help topic:duel`

**Files:**
- Create: `assets/images/banners/duel.webp`
- Modify: `src/modules/duels/embeds.ts:52-58` (`duelResultPayload` tail), `:77-83` (`challengePayload` tail), `:100-105` (`recordPayload` tail)
- Modify: `src/modules/help/index.ts:104` (the `duel` topic header line)
- Modify: `docs/assets/prompts.md` (banner count ×2, one table row, one prompt block)
- Test: `tests/duels.test.ts` (import line 13; the two attach tests at ~426-441; new challenge/record/accept-path tests)
- Test: `tests/help.test.ts:37-57` (the hard-coded sorted art list) and `:84-92` (the duel topic test)

**Interfaces:**
- Consumes: `assetImage`, `attach` (`src/core/images.js`). `DuelPayload` (`src/modules/duels/embeds.js`) is `{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }`. `HelpTopic` (`src/modules/help/index.ts:11`) is `{ title: string; body: string; art?: { kind: 'eggs' | 'sites' | 'banners'; name: string } }`.
- Produces: the committed file `assets/images/banners/duel.webp` (1536×1024 WebP q95). `duelResultPayload(outcome: DuelOutcome): DuelPayload` now returns `files` of length **2**, in call order `[<archetype>-<diet>.webp, duel.webp]`. `challengePayload(challengerId: string, defenderId: string, challengerName: string, defenderName: string, expiresAtMs: number): DuelPayload` and `recordPayload(name: string, record: DuelRecord): DuelPayload` each now return `files` of `[duel.webp]`. `HELP_TOPICS.duel.art` becomes `{ kind: 'banners', name: 'duel' }`.

---

- [ ] **Step 1: Write the failing test**

In `tests/duels.test.ts`, first widen the embeds import on line 13:

```ts
import { duelResultPayload, challengePayload, recordPayload, DUEL_PREFIX } from '../src/modules/duels/embeds.js';
```

Then, inside `describe('duel embeds', …)`, **replace** the two existing tests `it('never attaches more than one image', …)` and `it('attaches exactly one image, keyed on the winning lead archetype x diet', …)` (and their comment blocks) with these four:

```ts
  // Two DINO refs could resolve to the SAME basename whenever both leads share an
  // archetype×diet, and attach() appends without deduping — one embed slot would then
  // render the other's picture. Exactly one dino ref, always. The duel banner rides
  // alongside it safely because `duel.webp` can never equal `<archetype>-<diet>.webp`;
  // what matters is the basenames being distinct, not the count.
  it('attaches exactly two images and no two share a basename', () => {
    const names = duelResultPayload(outcome()).files!.map((f) => f.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size, `colliding attachment names: ${names.join(', ')}`).toBe(2);
  });

  // The opposite regression to the collision guard above: an attach() that silently
  // stopped firing would leave files undefined and pass every other assertion here.
  // attach APPENDS and call order is upload order, so the order is pinned too.
  it('attaches the lead archetype x diet thumbnail first, then the duel banner', () => {
    const out = outcome();
    const payload = duelResultPayload(out);
    const lead = out.result === 'loss' ? out.squads.defender[0] : out.squads.challenger[0];
    const expected = `${lead.archetype}-${lead.diet}.webp`;
    expect(payload.files!.map((f) => f.name)).toEqual([expected, 'duel.webp']);
    const embed = payload.embeds[0].toJSON();
    expect(embed.thumbnail?.url).toBe(`attachment://${expected}`);
    expect(embed.image?.url).toBe('attachment://duel.webp');
  });

  it('dresses the challenge card with the duel banner', () => {
    const payload = challengePayload('111', '222', 'A', 'B', 900_000);
    expect(payload.files!.map((f) => f.name)).toEqual(['duel.webp']);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://duel.webp');
  });

  it('dresses the record card with the duel banner', () => {
    getOrCreateUser(ctx, 'a', 'A');
    const payload = recordPayload('A', duelRecord(ctx, 'a'));
    expect(payload.files!.map((f) => f.name)).toEqual(['duel.webp']);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://duel.webp');
  });
```

Also append this to `describe('/duel challenge', …)`, next to the existing "replaces the card in place, shedding its buttons and attachments" test:

```ts
  it('accepting uploads the result art while still shedding the challenge card attachment set', async () => {
    pairWithDinos();
    await challenge('a', 'b');
    const b = await click(`duel:accept:a:b:${DUEL_CHALLENGE_TTL_MS}`, 'b');
    const payload = b.replies[0] as { files?: Array<{ name?: string | null }>; attachments?: unknown[] };
    // i.update carrying files replaces the message's whole attachment set, and the
    // explicit attachments: [] is what drops the challenge card's own duel.webp upload
    // so the result's two files are the only ones left on the message.
    expect(payload.attachments).toEqual([]);
    expect(payload.files!.map((f) => f.name)).toContain('duel.webp');
    expect(payload.files).toHaveLength(2);
  });
```

In `tests/help.test.ts`, replace the hard-coded sorted list at lines 55-56 with:

```ts
    expect([...covered].sort()).toEqual(
      ['battles', 'care', 'duel', 'eggs', 'expeditions', 'genelab', 'getting-started', 'guests', 'ranks', 'shop', 'trading']);
```

…and replace lines 89-91 (the trailing comment and the `art` assertion inside `it('carries a duel topic naming every /duel subcommand', …)`) with:

```ts
    // The duel topic shipped art-less in 3b because that branch added no image files.
    // It has its own banner now, so it must also appear in the hard-coded sorted list
    // in the art test above — that list is what fails a PARTIAL regression.
    expect(HELP_TOPICS.duel?.art).toEqual({ kind: 'banners', name: 'duel' });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/duels.test.ts tests/help.test.ts -t "duel banner"`
Expected: FAIL — `dresses the challenge card with the duel banner` fails with `TypeError: Cannot read properties of undefined (reading 'map')`, since `challengePayload` currently returns `{ embeds, components }` with no `files` key at all.

Run: `npx vitest run tests/duels.test.ts -t "attaches"`
Expected: FAIL — `attaches exactly two images and no two share a basename` fails with `AssertionError: expected [ 'bruiser-carnivore.webp' ] to have a length of 2 but got 1`.

- [ ] **Step 3: Generate and fit the banner**

Generate with the Higgsfield `generate_image` tool, model `nano_banana_pro` (the API silently routes this to `nano_banana_2`), aspect ratio `3:2` (source output 1264×848), with this prompt. It must not read as the campaign arena — `battle_victory.webp` and `battle_defeat.webp` already own that scene, and a duel stakes nothing but a rating, so the ring is an exhibition ground with empty benches rather than a war pit:

> A wide cartoon scene of a dinosaur park exhibition duelling ring at midday: a circular raked sand arena ringed by a low timber fence and rows of empty tiered wooden benches, two cartoon dinosaurs squared off across the sand facing each other mid-stare — a stocky horned ceratopsian on the left digging in a front foot, a lean green theropod on the right crouched low with its tail raised — a pair of crossed wooden practice poles planted at the ring's edge and a rolled coil of rope beside them, a curl of dust drifting between the two, lush palms and a clear blue sky behind, bright even daylight, friendly and sporting rather than violent. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no lettering, no words, no numbers, no signage writing anywhere in the scene, no human characters, no UI elements.

```bash
mkdir -p "C:/Users/Claude/AppData/Local/Temp/claude/art-5a"
# save the generated image to C:/Users/Claude/AppData/Local/Temp/claude/art-5a/duel-src.png first
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
node scripts/fit-art.mjs banner "C:/Users/Claude/AppData/Local/Temp/claude/art-5a/duel-src.png" assets/images/banners/duel.webp
```

Expected output: `banner assets/images/banners/duel.webp 1536x1024 (source 1264x848)`.

- [ ] **Step 4: Wire the four surfaces**

In `src/modules/duels/embeds.ts`, replace lines 52-58 (the comment through `return payload;` at the end of `duelResultPayload`) with:

```ts
  // EXACTLY ONE *dino* ref. Attachment names are basenames with no kind prefix, so a
  // second dino ref would collide whenever both leads share an archetype×diet — attach
  // appends without deduping and one slot would render the other's picture. The duel
  // banner below is a different basename entirely, so it is safe alongside it.
  const lead = result === 'loss' ? squads.defender[0] : squads.challenger[0];
  const payload: DuelPayload = { embeds: [embed], components: [] };
  attach(embed, payload, 'thumbnail', assetImage('dinos', `${lead.archetype}-${lead.diet}`));
  // attach APPENDS and call order is upload order — the thumbnail stays files[0] and the
  // banner is files[1]. tests/duels.test.ts pins that order with toEqual; never swap them.
  attach(embed, payload, 'image', assetImage('banners', 'duel'));
  return payload;
```

Replace the tail of `challengePayload` (the `const row = …` statement through `return { embeds: [embed], components: [row] };`) with:

```ts
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${DUEL_PREFIX}:accept:${challengerId}:${defenderId}:${expiresAtMs}`)
      .setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${DUEL_PREFIX}:decline:${challengerId}:${defenderId}:${expiresAtMs}`)
      .setLabel('Decline').setStyle(ButtonStyle.Secondary),
  );
  const payload: DuelPayload = { embeds: [embed], components: [row] };
  attach(embed, payload, 'image', assetImage('banners', 'duel'));
  return payload;
}
```

Replace the last line of `recordPayload` (`  return { embeds: [embed], components: [] };`) with:

```ts
  const payload: DuelPayload = { embeds: [embed], components: [] };
  attach(embed, payload, 'image', assetImage('banners', 'duel'));
  return payload;
```

In `src/modules/help/index.ts`, replace line 104:

```ts
  duel: { title: '⚔️ Duels', art: { kind: 'banners', name: 'duel' }, body: [
```

Adding an `art` field to an existing topic changes no builder data. Only adding or removing a `HELP_TOPICS` **key** changes the `/help` builder's option choices and forces `npm run deploy-commands`; no key is added here.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/duels.test.ts tests/help.test.ts`
Expected: PASS

Run: `npx vitest run tests/images.test.ts -t "duel is 1536×1024"`
Expected: PASS, exactly 1 test. The `it.each` dimension case registers itself from the `assetImage('banners', 'duel')` scrape; a report of 0 matched tests means the scrape missed the call.

- [ ] **Step 6: Update `docs/assets/prompts.md`**

This task takes the committed banner count from 30 to 31, which `tests/docs-assets.test.ts` checks against the directory listing.

1. Change `The 30 embed banners were generated with Higgsfield` to `The 31 embed banners were generated with Higgsfield`.
2. Change `30 wide banners for the surfaces that have no site or egg art of their` to `31 wide banners for the surfaces that have no site or egg art of their`.
3. Insert this row directly **above** the `| assets/images/banners/event-clear_skies.webp |` row:

```
| `assets/images/banners/duel.webp` | 1536×1024 | `/duel challenge`, `/duel record` and the duel result embed image, `/help topic:duel` |
```

4. Insert this prompt block directly **above** the line beginning ``**Gene Lab (`gene_lab.webp`) and Gene Splice``:

```markdown
**Duel (`duel.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. The empty benches and
the "sporting rather than violent" clause are deliberate and should survive
any regeneration: `battle_victory.webp` and `battle_defeat.webp` already own
the campaign arena, and a duel stakes nothing but a rating, so this has to
read as an exhibition ground rather than a second war pit.

> **duel.webp:** A wide cartoon scene of a dinosaur park exhibition duelling
> ring at midday: a circular raked sand arena ringed by a low timber fence and
> rows of empty tiered wooden benches, two cartoon dinosaurs squared off across
> the sand facing each other mid-stare — a stocky horned ceratopsian on the
> left digging in a front foot, a lean green theropod on the right crouched low
> with its tail raised — a pair of crossed wooden practice poles planted at the
> ring's edge and a rolled coil of rope beside them, a curl of dust drifting
> between the two, lush palms and a clear blue sky behind, bright even daylight,
> friendly and sporting rather than violent. Glossy cartoon mobile-game art
> style, bold dark outlines, vibrant saturated colors, strong glossy highlights,
> clean cel shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene, no
> human characters, no UI elements.
```

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add assets/images/banners/duel.webp src/modules/duels/embeds.ts src/modules/help/index.ts docs/assets/prompts.md tests/duels.test.ts tests/help.test.ts
git commit -m "Give duels a banner across all four of their surfaces

The challenge card, the record card and the help topic shipped bare, and the
result carried only a lead-dino thumbnail. Wire banners/duel through all four.

The result payload now carries two files. The one-ref rule it was written under
guarded a basename collision between two dino refs sharing an archetype and
diet, not the file count, so the test that enforced it is rewritten to assert
distinct basenames in a pinned upload order instead of a bare maximum of one."
```

---

### Task 11: Battles banner — `/help topic:battles` stops borrowing the Coastal Dig site art

**Files:**
- Create: `assets/images/banners/battles.webp`
- Modify: `src/modules/help/index.ts:74` (the `battles` topic header line)
- Modify: `docs/assets/prompts.md` (banner count ×2, one table row, one prompt block)
- Test: `tests/help.test.ts:37-57` (the hard-coded sorted art list) plus one new test

**Interfaces:**
- Consumes: `assetImage`, `attach` (`src/core/images.js`), invoked for help topics by the existing `if (t.art) attach(embed, payload, 'image', assetImage(t.art.kind, t.art.name));` line at `src/modules/help/index.ts:130`. `HelpTopic` is `{ title: string; body: string; art?: { kind: 'eggs' | 'sites' | 'banners'; name: string } }`.
- Produces: the committed file `assets/images/banners/battles.webp` (1536×1024 WebP q95). `HELP_TOPICS.battles.art` becomes `{ kind: 'banners', name: 'battles' }`; `HELP_TOPICS.expeditions.art` is left at `{ kind: 'sites', name: 'coastal_dig-banner' }` and is now its sole owner. No `HELP_TOPICS` key is added, so no `deploy-commands`.

---

- [ ] **Step 1: Write the failing test**

In `tests/help.test.ts`, append this test inside `describe('/help', …)`:

```ts
  // /help topic:battles and /help topic:expeditions shared sites/coastal_dig-banner
  // VERBATIM — the whole campaign, seven chapters of it, illustrated with the picture
  // of the tutorial dig site. The generic per-topic art test above cannot see that: it
  // walks each topic in isolation and both borrows resolve fine.
  it('gives every art-bearing topic a picture no other topic uses', () => {
    expect(HELP_TOPICS.battles.art).toEqual({ kind: 'banners', name: 'battles' });
    expect(HELP_TOPICS.expeditions.art).toEqual({ kind: 'sites', name: 'coastal_dig-banner' });
    const keys = Object.values(HELP_TOPICS).flatMap((t) => (t.art ? [`${t.art.kind}/${t.art.name}`] : []));
    expect(keys.length, 'no art-bearing topics found — did the descriptor shape change?').toBeGreaterThan(0);
    expect(new Set(keys).size, `two topics share art: ${keys.join(', ')}`).toBe(keys.length);
  });
```

Also confirm the hard-coded sorted art list at lines 55-56 reads exactly this — `battles` already carries art, so this list is unchanged by this task and must stay unchanged; a diff here means something else drifted:

```ts
    expect([...covered].sort()).toEqual(
      ['battles', 'care', 'duel', 'eggs', 'expeditions', 'genelab', 'getting-started', 'guests', 'ranks', 'shop', 'trading']);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/help.test.ts -t "gives every art-bearing topic a picture no other topic uses"`
Expected: FAIL with `AssertionError: expected { kind: 'sites', name: 'coastal_dig-banner' } to deeply equal { kind: 'banners', name: 'battles' }`.

- [ ] **Step 3: Generate and fit the banner**

Generate with the Higgsfield `generate_image` tool, model `nano_banana_pro` (the API silently routes this to `nano_banana_2`), aspect ratio `3:2` (source output 1264×848), with this prompt. It must read as the campaign as a whole — a route with stages ahead of you — rather than as any one site, and must not collide with `battle_victory.webp` / `battle_defeat.webp`, which are single-moment arena scenes:

> A wide cartoon scene of the campaign trail leading out of a dinosaur park: a rocky canyon pass opening onto a chain of stacked stone waypoint cairns marching away into the distance, each cairn topped with a small carved dinosaur skull, a heavy timber gate standing open at the near end with two crossed wooden shields lashed to its posts, a broad armored spike-tailed dinosaur planted at the trailhead in a braced ready stance, tiered ridges rising behind one another toward a smoking volcano on the far horizon, dramatic late-afternoon light with long shadows and dust hanging in the air. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no lettering, no words, no numbers, no signage writing anywhere in the scene, no human characters, no UI elements.

```bash
mkdir -p "C:/Users/Claude/AppData/Local/Temp/claude/art-5a"
# save the generated image to C:/Users/Claude/AppData/Local/Temp/claude/art-5a/battles-src.png first
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
node scripts/fit-art.mjs banner "C:/Users/Claude/AppData/Local/Temp/claude/art-5a/battles-src.png" assets/images/banners/battles.webp
```

Expected output: `banner assets/images/banners/battles.webp 1536x1024 (source 1264x848)`.

- [ ] **Step 4: Repoint the topic**

In `src/modules/help/index.ts`, replace line 74:

```ts
  battles: { title: '⚔️ Battles', art: { kind: 'banners', name: 'battles' }, body: [
```

That is the entire code change — the topic embed builder at `src/modules/help/index.ts:130` already reads `t.art.kind` and `t.art.name` generically, so changing the descriptor's kind from `sites` to `banners` needs no branch. No `HELP_TOPICS` key is added or removed, so the `/help` builder's `topicChoices` are untouched and `npm run deploy-commands` is not required.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/help.test.ts`
Expected: PASS

Run: `npx vitest run tests/images.test.ts -t "battles is 1536×1024"`
Expected: PASS, exactly 1 test. `tests/images.test.ts` scrapes `kind: 'banners', name: '<name>'` descriptors out of `src/modules/help/index.ts` specifically because that shape is invisible to any `assetImage`-call regex, so this case registers itself with no test edit.

- [ ] **Step 6: Update `docs/assets/prompts.md`**

This task takes the committed banner count from 31 to 32.

1. Change `The 31 embed banners were generated with Higgsfield` to `The 32 embed banners were generated with Higgsfield`.
2. Change `31 wide banners for the surfaces that have no site or egg art of their` to `32 wide banners for the surfaces that have no site or egg art of their`.
3. Insert this row directly **above** the `| assets/images/banners/event-clear_skies.webp |` row:

```
| `assets/images/banners/battles.webp` | 1536×1024 | `/help topic:battles` embed image |
```

4. Insert this prompt block directly **above** the line beginning ``**Gene Lab (`gene_lab.webp`) and Gene Splice``:

```markdown
**Battles (`battles.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. Two constraints on any
regeneration. It must read as the campaign as a WHOLE — a route with stages
still ahead of it, hence the receding chain of cairns and the tiered ridges —
because it replaces a borrow of `sites/coastal_dig-banner`, i.e. the tutorial
site standing in for all seven chapters. And it must not converge on
`battle_victory.webp` / `battle_defeat.webp`, which are single-moment arena
scenes: this is the road to the arena, not the arena.

> **battles.webp:** A wide cartoon scene of the campaign trail leading out of a
> dinosaur park: a rocky canyon pass opening onto a chain of stacked stone
> waypoint cairns marching away into the distance, each cairn topped with a
> small carved dinosaur skull, a heavy timber gate standing open at the near end
> with two crossed wooden shields lashed to its posts, a broad armored
> spike-tailed dinosaur planted at the trailhead in a braced ready stance,
> tiered ridges rising behind one another toward a smoking volcano on the far
> horizon, dramatic late-afternoon light with long shadows and dust hanging in
> the air. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no lettering, no words, no
> numbers, no signage writing anywhere in the scene, no human characters, no UI
> elements.
```

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add assets/images/banners/battles.webp src/modules/help/index.ts docs/assets/prompts.md tests/help.test.ts
git commit -m "Give the battles help topic its own banner

/help topic:battles and /help topic:expeditions pointed at the same file, so
the seven-chapter campaign was illustrated with the tutorial dig site. Wire
banners/battles and leave the site banner to expeditions alone.

The per-topic art test walks each topic in isolation and passes on a verbatim
borrow, so a new test asserts every art-bearing topic resolves to a picture no
other topic uses."
```

---

### Task 12: Four art rewires — no new assets

**Files:**
- Modify: `src/modules/help/index.ts:36` (the `eggs` topic header line) and `:90` (the `daily` topic header line)
- Modify: `src/modules/daily/embeds.ts:72-87` (`claimPayload`) and `:112-125` (`claimAllPayload`)
- Modify: `docs/assets/prompts.md` (three table `Use` cells only — no count change)
- Test: `tests/help.test.ts:37-57` (the hard-coded sorted art list)
- Test: `tests/daily-command.test.ts`

**Interfaces:**
- Consumes: `assetImage`, `attach` (already imported in both files). `Payload` (`src/modules/daily/embeds.ts:14`) is `{ embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }`. All three banner names — `daily`, `achievements`, `eggs_incubator` — are already committed and already referenced (`src/modules/daily/embeds.ts:60`, `:108`, `src/modules/hatchery/embeds.ts:86`), so no file is created and the banner count does not move.
- Produces: `claimPayload(result: ClaimResult): Payload` now returns `files` of `[daily.webp]`. `claimAllPayload(result: ReturnType<typeof claimAchievements>): Payload` now returns `files` of `[achievements.webp]`. `HELP_TOPICS.daily.art` becomes `{ kind: 'banners', name: 'daily' }`; `HELP_TOPICS.eggs.art` becomes `{ kind: 'banners', name: 'eggs_incubator' }`.

This task ships **no new asset**, so there is no Higgsfield prompt, no `fit-art.mjs` run, no new `it.each` dimension case and no banner-count bump — the three names already have their table rows, their prompt blocks and their 1536×1024 cases. Only the `Use` column and the wiring change.

---

- [ ] **Step 1: Write the failing test**

In `tests/help.test.ts`, replace the hard-coded sorted list at lines 55-56 with (adding `daily`, which becomes art-bearing here; `eggs` was already in the list and only changes which file it points at):

```ts
    expect([...covered].sort()).toEqual(
      ['battles', 'care', 'daily', 'duel', 'eggs', 'expeditions', 'genelab', 'getting-started', 'guests', 'ranks', 'shop', 'trading']);
```

…and append this test inside `describe('/help', …)`:

```ts
  // The eggs topic borrowed eggs/rare — a single rarity's egg icon standing in for the
  // whole hatchery screen. banners/eggs_incubator is the picture /eggs itself already
  // uses. The daily topic shipped bare; banners/daily is what /daily itself uses.
  it('points the daily and eggs topics at the banners their own screens use', () => {
    expect(HELP_TOPICS.daily.art).toEqual({ kind: 'banners', name: 'daily' });
    expect(HELP_TOPICS.eggs.art).toEqual({ kind: 'banners', name: 'eggs_incubator' });
  });
```

In `tests/daily-command.test.ts`, append this test to `describe('/daily claim button', …)`:

```ts
  it('dresses the claim reply with the daily banner', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());
    const rows = rowsFor(ctx, 'u1');
    const def = QUESTS.find((q) => q.id === rows[0].questId)!;
    track(ctx, 'u1', def.stat, rows[0].target);

    const btn = fakeButton({ customId: 'daily:claim:u1', user: 'u1' });
    await dailyBtn.execute(ctx, btn.asChatInput() as never);
    const payload = btn.replies[0] as EmbedPayload;
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('daily.webp');
  });
```

…and this one to `describe('ach:claimall button', …)`:

```ts
  it('dresses the claim-all reply with the achievements banner', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    track(ctx, 'u1', 'stages_first_cleared', explorerDef.tiers[3]);
    const btn = fakeButton({ customId: 'ach:claimall:u1', user: 'u1' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    const payload = btn.replies[0] as EmbedPayload;
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('achievements.webp');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/help.test.ts tests/daily-command.test.ts -t "banner"`
Expected: FAIL — `points the daily and eggs topics at the banners their own screens use` fails with `AssertionError: expected undefined to deeply equal { kind: 'banners', name: 'daily' }`; `dresses the claim reply with the daily banner` fails with `AssertionError: expected undefined to have a length of 1`.

Run: `npx vitest run tests/help.test.ts -t "every topic that declares art"`
Expected: FAIL with `AssertionError: expected [ …, 'eggs', … ] to deeply equal [ …, 'daily', 'duel', 'eggs', … ]` — the `daily` topic is not yet art-bearing, so the loop never covers it.

- [ ] **Step 3: Repoint the two help topics**

In `src/modules/help/index.ts`, replace line 36:

```ts
  eggs: { title: '🥚 Eggs', art: { kind: 'banners', name: 'eggs_incubator' }, body: [
```

…and replace line 90:

```ts
  daily: { title: 'Daily quests', art: { kind: 'banners', name: 'daily' }, body: [
```

Both are `art` fields on topics that already exist. No `HELP_TOPICS` key is added or removed, so `topicChoices` — and therefore the `/help` builder JSON — is byte-identical and `npm run deploy-commands` is not required. (The `'eggs'` member of the `HelpTopic` art-kind union stays: nothing else uses it today, but narrowing the union is a change nobody asked for.)

- [ ] **Step 4: Dress the two claim payloads**

In `src/modules/daily/embeds.ts`, replace the tail of `claimPayload` — from `  const embed = new EmbedBuilder().setColor(0xf1c40f)` through `  return { embeds: [embed] };` — with:

```ts
  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle('📅 Quests claimed')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Rewards', value: rewardParts.join(', ') });
  if (result.chest) {
    const chestParts: string[] = [];
    if (result.chest.cash) chestParts.push(`${result.chest.cash.toLocaleString('en-US')} cash`);
    if (result.chest.shards) chestParts.push(`${result.chest.shards.toLocaleString('en-US')} shards`);
    if (result.chest.eggRarity) chestParts.push(`a ${result.chest.eggRarity} egg`);
    embed.addFields({
      name: 'Chest!',
      value: `${emojiTag('dw_chest')} ${result.chest.streak}-day chest: ${chestParts.join(', ')}`,
    });
  }
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', 'daily'));
  return payload;
}
```

…and replace the tail of `claimAllPayload` — from `  const embed = new EmbedBuilder().setColor(0xf1c40f)` through `  return { embeds: [embed] };` — with:

```ts
  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle('🏆 Achievements claimed')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Rewards', value: rewardParts.join(', ') });
  const payload: Payload = { embeds: [embed] };
  attach(embed, payload, 'image', assetImage('banners', 'achievements'));
  return payload;
}
```

Both replies are spread into an ephemeral reply at `src/modules/daily/index.ts:54` and `:75` (`{ ...claimPayload(result), flags: MessageFlags.Ephemeral }`), which carries the new `files` key through unchanged. Neither handler sets `attachments`, and neither should: these are plain `i.reply` calls on a fresh message, not an `i.update` replacing an existing attachment set and not a payload handed to `deliverNotification`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/help.test.ts tests/daily-command.test.ts`
Expected: PASS

- [ ] **Step 6: Update the three `Use` cells in `docs/assets/prompts.md`**

No count changes and no new prompt blocks — these three banners already have both. Only the `Use` column drifts, and nothing machine-checks it, so it is the one part of this task that has to be got right by hand.

Replace:

```
| `assets/images/banners/eggs_incubator.webp` | 1536×1024 | `/eggs` embed image |
```

with:

```
| `assets/images/banners/eggs_incubator.webp` | 1536×1024 | `/eggs` embed image, `/help topic:eggs` |
```

Replace:

```
| `assets/images/banners/daily.webp` | 1536×1024 | `/daily` hub embed image |
```

with:

```
| `assets/images/banners/daily.webp` | 1536×1024 | `/daily` hub + `daily:claim` embed image, `/help topic:daily` |
```

Replace:

```
| `assets/images/banners/achievements.webp` | 1536×1024 | `/achievements` embed image |
```

with:

```
| `assets/images/banners/achievements.webp` | 1536×1024 | `/achievements` + `ach:claimall` embed image |
```

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/modules/help/index.ts src/modules/daily/embeds.ts docs/assets/prompts.md tests/help.test.ts tests/daily-command.test.ts
git commit -m "Rewire four claim and help surfaces onto banners they already own

No new art. /help topic:eggs borrowed eggs/rare, a single rarity's egg icon
standing in for the whole hatchery screen, and now uses banners/eggs_incubator
- the picture /eggs itself renders. /help topic:daily shipped bare and now uses
banners/daily. The daily:claim and ach:claimall replies were the only two
payloads in the module with no art at all, and now match the hubs their buttons
sit on.

The banner count is unchanged, so prompts.md moves only in its Use column."
```

---

### Task 13: Add an `attractions` raster family to `ParkArt`

**Files:**
- Modify: `src/core/render/art.ts:1-7` (imports), `src/core/render/art.ts:9-26` (the `ParkArt` interface), `src/core/render/art.ts:52-55` (`EMPTY_ART`), `src/core/render/art.ts:83-104` (`loadParkArt`)
- Modify: `tests/render-draw.test.ts:141-149` (the suite's only exhaustive `ParkArt` object literal — a new required field is a **typecheck** break, invisible to `npm run build` and `npm test`)
- Test: `tests/render-art.test.ts`, `tests/render-draw.test.ts`

**Interfaces:**
- Consumes: `ATTRACTIONS: Record<string, AttractionDef>` from `src/data/attractions.ts`; `loadRasterImage(absPath: string): Promise<Image | null>` (module-private in `art.ts`, reached only through the local `raster(name: string)` helper inside `loadParkArt`).
- Produces: `ParkArt.attractions: Record<string, Image | null>` — an **open** `Record` keyed by attraction slug, present on `EMPTY_ART` as `{}` and populated by `loadParkArt` with one entry per `Object.keys(ATTRACTIONS)` slug reading `assets/images/park/attraction-<kind>.webp`. Task 14's `drawAttraction` consumes it as `art.attractions[kind]`, which returns `undefined` for an unmapped slug.

---

- [ ] **Step 1: Write the failing test**

Add to `tests/render-art.test.ts`. First extend the import block at the top of the file (line 5 onward) so `ATTRACTIONS` is available:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EMPTY_ART, loadParkArt, loadSvgImage } from '../src/core/render/art.js';
import { RARITY } from '../src/data/rarity.js';
import { ATTRACTIONS } from '../src/data/attractions.js';
import type { Rarity } from '../src/data/types.js';
```

Then, inside the existing `describe('EMPTY_ART', …)` block, add one line to the `is exhaustive over every rarity with all-null entries` test, immediately after the `expect(EMPTY_ART.lotIcons).toEqual({});` line:

```ts
    // The OPEN shape, exactly like lotIcons and deliberately unlike dinoChips/groundBySeason/landmarks:
    // attraction slugs are not a closed union, so an absent key reading back `undefined` is the
    // intended, tested behaviour (tests/render-draw.test.ts renders a `retired_kind` and requires no
    // throw). An exhaustively-keyed Record would break that promise.
    expect(EMPTY_ART.attractions).toEqual({});
```

Then add a new test inside the existing `describe('loadParkArt', …)` block, after the `loads all three landmark bands from the real asset directory` test:

```ts
  // The kind list drives both the reads and the keys they are stored under, inside loadParkArt, so a
  // hand-swapped kind→image pairing is not expressible — the defect class
  // tests/render-park-art.test.ts:114-127 documents for groundBySeason, where a swapped pair in an
  // object literal is silent and green. No attraction raster is committed yet, so every value is null
  // today; this asserts the KEYS, which is the part that must not drift.
  it('carries one attraction slot per catalog kind, and leaves unknown slugs unmapped', async () => {
    const art = await loadParkArt();
    expect(Object.keys(art.attractions).sort()).toEqual(Object.keys(ATTRACTIONS).sort());
    // A slug with no entry must read back undefined and fall through to the flat fill, never resolve
    // to some near-miss file — the same contract lotIcons['not_a_real_kind'] is pinned on above.
    expect(art.attractions['retired_kind']).toBeUndefined();
  });
```

Then add one line to the existing `resolves with all-null art instead of rejecting when nothing is on disk` test, immediately after `expect(art.landmarks).toEqual({ a: null, b: null, c: null });`:

```ts
      expect(art.attractions['gift_shop']).toBeNull();
```

Now add the byte-identity pin to `tests/render-draw.test.ts`. Add this test inside the existing `describe('attraction cells', …)` block, after the `renders an attraction of an unknown or retired kind without throwing` test:

```ts
    // ParkArt gained an `attractions` family with no rasters committed yet, so every entry is null and
    // an attraction cell must still render exactly what it rendered before the field existed. Both
    // directions are pinned: an art object that CARRIES the record must agree with EMPTY_ART, and
    // EMPTY_ART must agree with the no-art call — the same fallback pin the top-level
    // "an all-null ParkArt renders byte-for-byte what the no-art call renders" test makes for a park
    // with no attractions at all, restated for a park that has some. Task 14 gives drawAttraction an
    // art path; this is what proves its null branch did not drift.
    it('an attractions record of all-null entries renders byte-identically to no art at all', () => {
      const snap: ParkSnapshot = {
        ...sample,
        attractions: [{ kind: 'gift_shop', level: 2 }, { kind: 'picnic_lawn', level: 1 }],
      };
      const nulledArt: ParkArt = { ...EMPTY_ART, attractions: { gift_shop: null, picnic_lawn: null } };
      expect(renderParkPng(snap, nulledArt).equals(renderParkPng(snap, EMPTY_ART))).toBe(true);
      expect(renderParkPng(snap, EMPTY_ART).equals(renderParkPng(snap))).toBe(true);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-art.test.ts -t "carries one attraction slot per catalog kind"`

Expected: FAIL with `TypeError: Cannot convert undefined or null to object` — `loadParkArt`'s result has no `attractions` property, so `Object.keys(art.attractions)` is `Object.keys(undefined)`.

- [ ] **Step 3: Add the field to `ParkArt` and `EMPTY_ART`**

In `src/core/render/art.ts`, add the import alongside the existing data imports at the top of the file:

```ts
import { ATTRACTIONS } from '../../data/attractions.js';
```

Then add the new field as the last member of the `ParkArt` interface, after `landmarks`:

```ts
  // One raster per built attraction kind (src/data/attractions.ts). Deliberately the OPEN lotIcons
  // shape, NOT the exhaustively-keyed landmarks/dinoChips/groundBySeason shape: attraction slugs are
  // not a closed union — AttractionDef.kind is a plain string and the attractions table carries no
  // SQL CHECK — and renderParkPng must tolerate a retired slug, which
  // tests/render-draw.test.ts's "renders an attraction of an unknown or retired kind without throwing"
  // machine-gates. An exhaustive Record<AttractionKind, …> would break that promise.
  //
  // The cost of the open shape: a lookup miss reads back `undefined` even though it TYPES as
  // Image | null (tsconfig sets strict but not noUncheckedIndexedAccess), so every draw site must
  // guard with `if (img)` and never `if (img !== null)` — drawImage(undefined) throws the identical
  // TypeError drawImage(null) does, and that throw costs the user the whole park image.
  attractions: Record<string, Image | null>;
```

Then extend `EMPTY_ART`:

```ts
export const EMPTY_ART: ParkArt = {
  ground: null, groundBySeason: nullSeasons(), platePaddock: null, plateFacility: null,
  lotIcons: {}, dinoChips: nullChips(), landmarks: nullLandmarks(), attractions: {},
};
```

- [ ] **Step 4: Load the six rasters inside the existing `Promise.all`**

Replace the body of `loadParkArt` in `src/core/render/art.ts` with:

```ts
export async function loadParkArt(): Promise<ParkArt> {
  const raster = (name: string) => loadRasterImage(resolve(process.cwd(), 'assets/images/park', name));
  const svg = (name: string) => loadSvgImage(resolve(process.cwd(), 'assets/emojis/svg', `${name}.svg`));

  // One kind list drives both the reads and the keys they are stored under, so a mis-paired
  // kind→image entry is not expressible by hand. That matters because the alternative — six more
  // named slots in the destructure below, taking it from 9 members to 15 — makes a swapped pair
  // silent and green (tests/render-park-art.test.ts:114-127 records that exact defect class for
  // groundBySeason).
  //
  // Spread into the EXISTING Promise.all, never awaited separately: each read still goes through
  // raster() -> loadRasterImage, whose own try/catch is what makes this whole call non-rejecting, and
  // a second await would be a second chance for worker.ts's top-level await to reject — which
  // terminates and nulls the worker, costing every later /park view its image.
  const attractionKinds = Object.keys(ATTRACTIONS);

  const [ground, platePaddock, plateFacility, groundWet, groundDry, groundCold, markA, markB, markC,
    ...attractionImages] = await Promise.all([
    raster('ground.webp'), raster('plate-paddock.webp'), raster('plate-facility.webp'),
    raster('ground-wet.webp'), raster('ground-dry.webp'), raster('ground-cold.webp'),
    raster('landmark-a.webp'), raster('landmark-b.webp'), raster('landmark-c.webp'),
    ...attractionKinds.map((kind) => raster(`attraction-${kind}.webp`)),
  ]);

  const lotIcons: Record<string, Image | null> = {};
  for (const [kind, file] of Object.entries(LOT_ICON_SVG)) lotIcons[kind] = svg(file);

  const dinoChips = nullChips();
  for (const r of Object.keys(RARITY) as Rarity[]) dinoChips[r] = svg(`dw_dino_${r}`);

  // Filename is the slug verbatim, underscores and all (attraction-gift_shop.webp), so a raster named
  // attraction-gift-shop.webp resolves to null and the cell silently keeps its flat fill.
  const attractions: Record<string, Image | null> = {};
  attractionKinds.forEach((kind, i) => { attractions[kind] = attractionImages[i]; });

  return {
    ground, groundBySeason: { wet: groundWet, dry: groundDry, cold: groundCold },
    platePaddock, plateFacility, lotIcons, dinoChips,
    landmarks: { a: markA, b: markB, c: markC }, attractions,
  };
}
```

- [ ] **Step 5: Repair the exhaustive `ParkArt` literal in the draw tests**

`tests/render-draw.test.ts:141-149` is the suite's only hand-written, fully-enumerated `ParkArt` object. Adding a required field breaks it at typecheck time only — `npm run build` only includes `src`, and vitest transpiles without typechecking, so both stay green while it is wrong. Add the trailing field:

```ts
  const stubArt: ParkArt = {
    ground: svgStub('#0000ff', 120, 80),
    groundBySeason: { wet: null, dry: null, cold: null },
    platePaddock: svgStub('#ff00ff', 270, 150),
    plateFacility: svgStub('#ff8800', 270, 150),
    lotIcons: { carnivore_paddock: svgStub('#00ffff', 64, 64), hatchery_lab: svgStub('#00ffff', 64, 64) },
    dinoChips: { common: null, uncommon: null, rare: null, epic: null, legendary: svgStub('#ffff00', 64, 64), mythic: null },
    landmarks: { a: null, b: null, c: null },
    attractions: {},
  };
```

(`seasonalArt` at `:185` and both `markedArt` literals at `:239` and `:318` build on `{ ...stubArt }` / `{ ...EMPTY_ART }`, so they need no edit.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/render-art.test.ts tests/render-draw.test.ts tests/render-park-art.test.ts`

Expected: PASS — including `an attractions record of all-null entries renders byte-identically to no art at all`, `an all-null ParkArt renders byte-for-byte what the no-art call renders`, and `renders byte-identically whether attractions is absent or an empty array, matching the pre-attraction grid`. No raster is committed, so every `attractions` entry is null and the rendered bytes cannot have moved.

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npx vitest run`

Expected: all pass. `typecheck` is the only gate that can see the exhaustive-literal break from Step 5 — run it, do not skip it.

- [ ] **Step 8: Commit**

```bash
git add src/core/render/art.ts tests/render-art.test.ts tests/render-draw.test.ts
git commit -m "Add an attractions raster family to the park render art

ParkArt gains attractions: Record<string, Image | null>, using the open
lotIcons shape rather than an exhaustively-keyed record — attraction
slugs are plain strings with no SQL CHECK, and the renderer must keep
tolerating a retired slug. loadParkArt reads assets/images/park/
attraction-<kind>.webp for every catalog kind through the existing
raster helper inside the existing Promise.all, deriving the key from the
same list that drives the read so a mis-paired entry is not expressible.

No raster is committed yet, so every entry resolves to null and the
rendered output is byte-identical to before."
```

---

### Task 14: Draw the attraction art band on the park map

**Files:**
- Modify: `src/core/render/draw.ts:178-194` (the `drawAttraction` comment block and function), `src/core/render/draw.ts:240-244` (its only call site, inside `renderParkPng`)
- Modify: `tests/render-park-art.test.ts:1-7` (imports)
- Test: `tests/render-park-art.test.ts`, `tests/render-draw.test.ts`

**Interfaces:**
- Consumes: `ParkArt.attractions: Record<string, Image | null>` and `EMPTY_ART` from `src/core/render/art.js` (Task 13); `attractionFor(kind: string): AttractionDef | null` from `src/data/attractions.js`; `renderParkPng(snap: ParkSnapshot, art?: ParkArt): Buffer`.
- Produces: `drawAttraction(c: SKRSContext2D, x: number, y: number, img: Image | null | undefined, kind: string, level: number): void` — module-private to `draw.ts`, parameter order matching `drawLandmark(c, x, y, img, tier)`. `renderParkPng`'s public signature is unchanged.

---

- [ ] **Step 1: Write the failing test**

Add to `tests/render-park-art.test.ts`. First extend the art import on line 6 so the `ParkArt` type is available:

```ts
import { EMPTY_ART, loadParkArt, type ParkArt } from '../src/core/render/art.js';
```

Then add this test at the end of the existing `describe('park render with the committed art', …)` block, after `paints the real landmark art onto the canvas at the landmark cell draw.ts targets`:

```ts
  // The attraction family's positive real-raster check, in the same shape as the landmark one above
  // and the seasonal-ground one before it: the reference image is read straight off disk BY EXPECTED
  // FILENAME and drawn alone with the identical drawImage arguments draw.ts uses — never sourced from
  // loadParkArt's own output. Sourcing it from loadParkArt makes the assertion tautological against
  // exactly the defect it exists to catch: a mis-paired kind→image entry moves the reference along
  // with the real render and the two agree by construction. A bare "differs from the flat fill" check
  // is not a substitute either — that shape already let a removed drawImage call through undetected
  // once (see this file's own note at the renderAlone helper).
  //
  // No attraction raster is committed yet — this task ships the draw path, not the art — so the image
  // is landmark-a.webp, read by that explicit filename. It is a real committed 270×150 fully-opaque
  // raster, which is all this assertion needs: it proves drawAttraction actually blits the Image it
  // is handed, 1:1 to the tile, at the cell draw.ts targets. When the six real bands land, this test
  // re-points at assets/images/park/attraction-gift_shop.webp and nothing else changes.
  it('blits the attraction image it is handed 1:1 into the attraction cell', async () => {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/park', 'landmark-a.webp'));
    await img.decode();          // raster decode is async — an un-awaited decode draws a blank canvas

    // `sample` has 2 lots and lotCap 5, so hasBuild is true and, with no landmarkTier, the first
    // attraction takes cell index 3 — draw.ts's own
    // `snap.lots.length + (hasBuild ? 1 : 0) + (band ? 1 : 0)` — which is column `3 % COLS = 0`,
    // row `floor(3 / COLS) = 1` at 3 columns. Origin is
    // (PAD, HEADER_H + PAD + (TILE_H + GAP)) = (20, 64 + 20 + 166) = (20, 250).
    const art: ParkArt = { ...EMPTY_ART, attractions: { gift_shop: img } };
    const png = renderParkPng({ ...sample, attractions: [{ kind: 'gift_shop', level: 2 }] }, art);
    const real = await decodeToCanvas(png);

    const cellX = PAD, cellY = HEADER_H + PAD + (TILE_H + GAP);
    const ref = renderAlone(TILE_W, TILE_H, (c) => c.drawImage(img, 0, 0, TILE_W, TILE_H));
    // Tile-local (135, 100): horizontally centered, well clear of the rounded-rect corners and below
    // both labels, which drawAttraction paints at the tile's TOP (18px baseline at y + 34, 13px at
    // y + 54) rather than at the bottom the way drawLandmark does.
    expect(pixelAt(real, cellX + 135, cellY + 100)).toEqual(pixelAt(ref, 135, 100));

    // And the flat-fill sentinel is genuinely gone: #2d4a63 is what the null branch paints there.
    expect(pixelAt(real, cellX + 135, cellY + 100)).not.toEqual([0x2d, 0x4a, 0x63]);
  });
```

Now add the guard test to `tests/render-draw.test.ts`, inside the existing `describe('attraction cells', …)` block, directly after the existing `renders an attraction of an unknown or retired kind without throwing` test:

```ts
    // The reason the draw site must guard `if (img)` and never `if (img !== null)`. ParkArt.attractions
    // is an OPEN Record<string, Image | null>, and tsconfig sets strict but not
    // noUncheckedIndexedAccess — so indexing it with a retired slug TYPES as Image | null while
    // RETURNING undefined, and drawImage(undefined) throws the identical TypeError drawImage(null)
    // does. That throw is not a degrade: it becomes { ok: false } from handleRenderRequest, rejects in
    // client.ts and costs the user the whole park image. Neither `npm run build` nor `npm test` can
    // see the wrong guard on its own.
    //
    // The record must be POPULATED for this to bite. The retired-slug test above renders with the
    // default EMPTY_ART, whose attractions is {}, so an implementation could in principle be wrong
    // only for a partially-populated record and still pass it.
    it('renders a retired kind without throwing even when other attraction art is loaded', () => {
      const artWithSome: ParkArt = {
        ...EMPTY_ART,
        attractions: { gift_shop: svgStub('#00ffff', 270, 150) },
      };
      expect(() => renderParkPng(
        { ...sample, attractions: [{ kind: 'retired_kind', level: 1 }] },
        artWithSome,
      )).not.toThrow();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-park-art.test.ts -t "blits the attraction image it is handed"`

Expected: FAIL with `AssertionError: expected [ 45, 74, 99 ] to deeply equal [ 139, 188, 65 ]` — `drawAttraction` takes no art today, so the cell paints its flat `#2d4a63` fill (45, 74, 99) where the reference raster's own pixel (139, 188, 65) belongs.

- [ ] **Step 3: Give `drawAttraction` an `img` parameter and an art branch**

In `src/core/render/draw.ts`, replace the `drawAttraction` comment block and function wholesale with:

```ts
// One guest attraction cell. Structurally the same two-branch shape as drawLandmark: the art band
// when one loaded, and otherwise the original flat fill plus its 3px stroke. The null branch draws
// EXACTLY what this whole function drew before it gained art — same #2d4a63 rrect, same #7fb3d9
// stroke, same label coordinates — which is what keeps tests/render-draw.test.ts's byte-identical
// pins green and what makes the whole art family reversible: delete the rasters and today's map
// comes back with no code change.
//
// `img` is typed `Image | null | undefined` and guarded with `if (img)`, NEVER `if (img !== null)`.
// art.attractions is an OPEN Record<string, Image | null> — attraction slugs are not a closed union —
// and tsconfig sets strict but not noUncheckedIndexedAccess, so a retired slug TYPES as Image | null
// while RETURNING undefined. drawImage(undefined) throws the identical TypeError drawImage(null)
// does, and that throw is not a degrade: it becomes { ok: false } from handleRenderRequest, rejects
// in client.ts, and costs the user the entire park image. Neither `npm run build` nor `npm test` can
// see the wrong guard.
//
// save()/clip()/restore() around the blit is mandatory, exactly as drawTile's plate branch above: an
// opaque rectangular raster would otherwise square off the rounded corners, and a leaked clip would
// corrupt the up-to-six sibling attraction cells drawn later in the same loop.
//
// attractionFor keeps its `?? kind` fallback — deliberately NOT drawLandmark's landmarkFor(tier)!
// non-null assertion. A landmark tier cannot be retired; an attraction slug can, and an unrecognised
// one degrades to the raw slug rather than throwing, the same tolerance attendanceOf and
// matchedKindCount give an unknown kind elsewhere.
function drawAttraction(c: SKRSContext2D, x: number, y: number, img: Image | null | undefined, kind: string, level: number): void {
  if (img) {
    c.save();
    rrect(c, x, y, TILE_W, TILE_H, 12); c.clip();
    c.drawImage(img, x, y, TILE_W, TILE_H);
    c.restore();
  } else {
    rrect(c, x, y, TILE_W, TILE_H, 12); c.fillStyle = '#2d4a63'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#7fb3d9'; rrect(c, x, y, TILE_W, TILE_H, 12); c.stroke();
  }

  c.fillStyle = '#eaf4fb';
  c.font = `18px "${SANS}"`;
  c.fillText(trunc(c, attractionFor(kind)?.name ?? kind, TILE_W - 28), x + 14, y + 34);
  c.font = `13px "${SANS}"`;
  c.fillText(`Lv ${level}`, x + 14, y + 54);
}
```

- [ ] **Step 4: Pass the art through at the call site**

In `src/core/render/draw.ts`, inside `renderParkPng`, replace the attraction loop:

```ts
  // Attraction cells append AFTER the landmark cell (constraint: never earlier), so every
  // tile index that existed before this feature — including the landmark cell's own — keeps
  // the exact coordinates it already had.
  const attractionBase = snap.lots.length + (hasBuild ? 1 : 0) + (band ? 1 : 0);
  for (let i = 0; i < attractions.length; i++) {
    const idx = attractionBase + i, col = idx % COLS, row = Math.floor(idx / COLS);
    drawAttraction(c, PAD + col * (TILE_W + GAP), HEADER_H + PAD + row * (TILE_H + GAP),
      art.attractions[attractions[i].kind], attractions[i].kind, attractions[i].level);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/render-park-art.test.ts tests/render-draw.test.ts`

Expected: PASS — specifically `blits the attraction image it is handed 1:1 into the attraction cell`, `renders a retired kind without throwing even when other attraction art is loaded`, and, unchanged from Task 13, `an attractions record of all-null entries renders byte-identically to no art at all`. That last one is the proof the null branch did not drift; if it fails, the `else` arm was edited and must be restored character-for-character.

- [ ] **Step 6: Run the full gate**

Run: `npm run typecheck && npx vitest run`

Expected: all pass. `tests/render-draw.test.ts`'s pinned pixel samples all render under `EMPTY_ART` or `stubArt`, both of which carry an empty `attractions` record, so every one of them takes the null branch and cannot have moved.

- [ ] **Step 7: Commit**

```bash
git add src/core/render/draw.ts tests/render-draw.test.ts tests/render-park-art.test.ts
git commit -m "Draw the attraction art band on the park map

drawAttraction takes the tile's Image and blits it 1:1 inside a
save/clip/restore, matching drawTile's plate and drawLandmark's band, so
an opaque raster cannot square off the rounded corners and no clip leaks
into the sibling cells drawn after it. The guard is if (img), not
if (img !== null): attractions is an open record, so a retired slug
returns undefined despite typing as Image | null, and drawImage on it
throws and costs the whole park image.

The null branch is unchanged, so a park with no committed band renders
byte-identically to before, and the label keeps its attractionFor(kind)
?.name ?? kind fallback rather than a non-null assertion."
```

---

### Task 15: The six attraction art bands

**Files:**
- Create: `assets/images/park/attraction-picnic_lawn.webp`, `assets/images/park/attraction-gift_shop.webp`, `assets/images/park/attraction-viewing_platform.webp`, `assets/images/park/attraction-amber_carousel.webp`, `assets/images/park/attraction-sky_gondola.webp`, `assets/images/park/attraction-grand_atrium.webp`
- Modify: `docs/assets/prompts.md:43-44` (File targets rows), `docs/assets/prompts.md:1356-1357` (new subsection at the end of the Park map section, immediately before `## Hatch cracks`)
- Test: `tests/park-art-assets.test.ts:2-5` (imports), `tests/park-art-assets.test.ts:29-33` (the hand-typed size list), `tests/park-art-assets.test.ts:33-34` (new directory-enumerating test), `tests/docs-assets.test.ts:33-37` (the hard-coded park raster list)

**Interfaces:**
- Consumes: `node scripts/fit-art.mjs band <src> <dest.webp>` — the `band` entry in `scripts/fit-art.mjs`'s `COVER` table, which cover-scales, center-crops and writes 270×150 WebP q95, exactly as its `banner` (1536×1024) and `ground` (1200×800) siblings do for their sizes. `ATTRACTIONS: Record<string, AttractionDef>` from `src/data/attractions.js`, whose six keys are `picnic_lawn`, `gift_shop`, `viewing_platform`, `amber_carousel`, `sky_gondola`, `grand_atrium`. The label geometry of `drawAttraction(c: SKRSContext2D, x: number, y: number, kind: string, level: number): void` (`src/core/render/draw.ts:185`): the kind name is painted in `#eaf4fb` at 18px with baseline `(x + 14, y + 34)` and `Lv N` in the same colour at 13px with baseline `(x + 14, y + 54)`, both directly over the art with no scrim, into a `TILE_W`×`TILE_H` = 270×150 cell.
- Produces: six committed rasters at `assets/images/park/attraction-<kind>.webp`, each exactly 270×150 WebP, loaded by the `ParkArt.attractions: Record<string, Image | null>` wiring through `loadParkArt`'s existing `raster()` helper (`src/core/render/art.ts`). No TypeScript surface at all — this task ships assets, docs and guards only, and orders freely against the wiring task: the wiring null-degrades every missing file, and these files sit unread until it lands.

- [ ] **Step 1: Write the failing test**

Three edits. First, `tests/park-art-assets.test.ts` — add `readdirSync` to the `node:fs` import, add the `ATTRACTIONS` import, extend the hand-typed size list to all eleven 270×150 rasters, and append the directory-enumerating test inside the same `describe`. The file in full after the edit:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Image } from '@napi-rs/canvas';
import { ATTRACTIONS } from '../src/data/attractions.js';

const PARK_DIR = resolve(process.cwd(), 'assets/images/park');

// Raster decode (PNG and WebP alike) is async in @napi-rs/canvas: an un-awaited decode reports the
// right width/height while the pixels are still blank, so dimension checks alone would pass on a
// truncated download.
async function decodeRaster(bytes: Buffer): Promise<Image> {
  const i = new Image();
  i.src = bytes;
  await i.decode();
  return i;
}

describe('park map art', () => {
  it('ground.webp decodes and is wider than tall (it is cover-scaled to the canvas, never tiled)', async () => {
    const img = await decodeRaster(readFileSync(resolve(PARK_DIR, 'ground.webp')));
    expect(img.width).toBeGreaterThan(0);
    expect(img.width / img.height).toBeGreaterThan(1);
  });

  // Plates, landmarks AND attraction bands draw 1:1 at TILE_W×TILE_H (draw.ts's drawTile /
  // drawLandmark / drawAttraction, respectively). Committing any of them at exactly that size is
  // what keeps a square (or otherwise mis-sized) generation from being silently squashed/stretched
  // into the tile — a defect that renders "successfully" (drawImage never throws on a mismatched
  // raster size) and just looks wrong.
  it.each([
    'plate-paddock.webp', 'plate-facility.webp',
    'landmark-a.webp', 'landmark-b.webp', 'landmark-c.webp',
    'attraction-picnic_lawn.webp', 'attraction-gift_shop.webp', 'attraction-viewing_platform.webp',
    'attraction-amber_carousel.webp', 'attraction-sky_gondola.webp', 'attraction-grand_atrium.webp',
  ])('%s decodes at the 270×150 tile size', async (f) => {
    const img = await decodeRaster(readFileSync(resolve(PARK_DIR, f)));
    expect(img.width).toBe(270);
    expect(img.height).toBe(150);
  });

  // The inverse of the banner orphan check, and the only guard on the slug spelling. These rasters
  // load through loadParkArt, not assetImage, and a basename that does not match its ATTRACTIONS
  // key never throws: the lookup misses, drawAttraction takes its null branch, and the cell falls
  // back to the flat #2d4a63 fill — indistinguishable from "art not shipped yet". Enumerating the
  // directory is what turns attraction-gift-shop.webp against the slug gift_shop into a failure.
  // Set equality asserts both directions: an unknown basename fails here, a missing file fails the
  // size list above with ENOENT.
  it('names every committed attraction band after a real ATTRACTIONS key', () => {
    const kinds = Object.keys(ATTRACTIONS);
    const committed = readdirSync(PARK_DIR)
      .filter((f) => f.startsWith('attraction-') && f.endsWith('.webp'))
      .map((f) => f.slice('attraction-'.length, -'.webp'.length));
    for (const kind of committed) {
      expect(kinds, `assets/images/park/attraction-${kind}.webp does not name an ATTRACTIONS kind`).toContain(kind);
    }
    expect([...committed].sort()).toEqual([...kinds].sort());
  });
});
```

Second, `tests/docs-assets.test.ts` — the hard-coded park raster list, in full after the edit:

```ts
  it('prompts.md carries a regeneration target for every generated park raster', () => {
    for (const f of [
      'park/ground.webp', 'park/ground-wet.webp', 'park/ground-dry.webp', 'park/ground-cold.webp',
      'park/plate-paddock.webp', 'park/plate-facility.webp',
      'park/landmark-a.webp', 'park/landmark-b.webp', 'park/landmark-c.webp',
      'park/attraction-picnic_lawn.webp', 'park/attraction-gift_shop.webp',
      'park/attraction-viewing_platform.webp', 'park/attraction-amber_carousel.webp',
      'park/attraction-sky_gondola.webp', 'park/attraction-grand_atrium.webp',
    ]) {
      expect(prompts, `prompts.md is missing the regeneration target ${f}`).toContain(f);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/park-art-assets.test.ts tests/docs-assets.test.ts`

Expected: FAIL, three distinct ways.
- `attraction-picnic_lawn.webp decodes at the 270×150 tile size` (and its five siblings) fails with `ENOENT: no such file or directory, open '<repo>/assets/images/park/attraction-picnic_lawn.webp'`.
- `names every committed attraction band after a real ATTRACTIONS key` fails with `expected [] to deeply equal [ 'amber_carousel', 'gift_shop', 'grand_atrium', 'picnic_lawn', 'sky_gondola', 'viewing_platform' ]`.
- `prompts.md carries a regeneration target for every generated park raster` fails with `prompts.md is missing the regeneration target park/attraction-picnic_lawn.webp`.

- [ ] **Step 3: Confirm the `band` fit mode is present**

Run: `node scripts/fit-art.mjs`

Expected: `usage: node scripts/fit-art.mjs <banner|ground|band|cutout> <src> <dest.webp>` and exit code 2. If the usage line still reads `<banner|ground|cutout>`, the `band` mode has not landed yet — stop and land it first rather than hand-fitting these six, because a one-off pass is exactly what the landmark bands did and exactly what this release exists to stop repeating.

- [ ] **Step 4: Record the six prompts in `docs/assets/prompts.md`**

First, six rows appended to the File targets table, inserted directly after the `landmark-c.webp` row at `:43`:

```
| `assets/images/park/attraction-picnic_lawn.webp` | 270×150 | `/park view` attraction cell art, `picnic_lawn` |
| `assets/images/park/attraction-gift_shop.webp` | 270×150 | `/park view` attraction cell art, `gift_shop` |
| `assets/images/park/attraction-viewing_platform.webp` | 270×150 | `/park view` attraction cell art, `viewing_platform` |
| `assets/images/park/attraction-amber_carousel.webp` | 270×150 | `/park view` attraction cell art, `amber_carousel` |
| `assets/images/park/attraction-sky_gondola.webp` | 270×150 | `/park view` attraction cell art, `sky_gondola` |
| `assets/images/park/attraction-grand_atrium.webp` | 270×150 | `/park view` attraction cell art, `grand_atrium` |
```

Then the subsection below, inserted at the end of the Park map section — after the `Lesson — describe full scenes, not single objects` block that ends at `:1356`, and before `## Hatch cracks` at `:1358`:

```markdown
**park/attraction-{picnic_lawn,gift_shop,viewing_platform,amber_carousel,sky_gondola,grand_atrium}**
— the guest attraction cell (`drawAttraction`, `draw.ts`), one raster per
`ATTRACTIONS` kind (`src/data/attractions.ts`). The basename after
`attraction-` is the catalog slug **verbatim, underscores and all**:
`attraction-gift-shop.webp` against the slug `gift_shop` is not a near miss,
it is a silent flat-fill degrade that looks exactly like art nobody has
shipped yet, which is why `tests/park-art-assets.test.ts` enumerates this
directory and requires set equality with `Object.keys(ATTRACTIONS)` rather
than trusting a hand-typed list alone. Generated with model
`nano_banana_pro` (the API silently routes this to `nano_banana_2`) at
aspect ratio `16:9`, source output 1376×768, then
`node scripts/fit-art.mjs band <src> assets/images/park/attraction-<kind>.webp`
— cover-scaled and center-cropped to 270×150 WebP q95. The three landmark
bands above predate that mode and were fitted by a one-off pass; this family
is the reason the mode exists, and nothing at 270×150 should be hand-fitted
again.

**Workflow (reference chain):** each is an image-edit of a committed landmark
band, never of another attraction and never from a bare text prompt, so the
two families share light direction, outline weight, ground treatment and
palette temperature — they sit in the same grid, on the same ground raster,
one cell apart. `picnic_lawn`, `gift_shop` and `viewing_platform` reference
`landmark-a` (the modest ground-level scene); `amber_carousel` and
`sky_gondola` reference `landmark-b` (the mid-scale monument pair);
`grand_atrium` references `landmark-c` (the only grand architectural
interior in either family). The catalog's unlock order is also its power
order, so the set escalates the same way the landmark bands do: turf and
trestle tables, then a kiosk, then built timber, then a fairground ride,
then engineering, then architecture.

**No guest figures in any of the six.** The shared style block's "no
characters" clause applies unchanged: a crowd is unreadable at 270×150, and
attendance is a number on the card, not something the tile depicts.

**Contrast requirement (hard gate, not a style preference) — the dark band
sits at the TOP here, not the bottom.** `drawAttraction` paints the kind
name in `#eaf4fb` at tile-local `(14, 34)` (18px) and `Lv N` at `(14, 54)`
(13px), both directly over the art with no scrim — the mirror image of
`drawLandmark`, which paints its single line at `(14, TILE_H - 16)`.
Copying a landmark prompt's "BOTTOM FIFTH … dark kerb band" clause verbatim
therefore puts the dark band where no text is and strands both labels over
open sky. Sample the committed WebP over the label rectangle x 14–250,
y 14–58 and take the **worst** pixel, never the mean: band a of the landmark
pass measured a healthy 5.53:1 mean against a 1.14:1 worst, and judging by
average would have shipped an illegible label. The flat `#2d4a63` fill these
rasters replace measures 8.29:1 against `#eaf4fb`; treat ~6:1 as the target,
matching what the plates and the landmark bands settled on, with 4.5:1 as a
floor rather than a goal.

**park/attraction-picnic_lawn — Picnic Lawn:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a mown green picnic lawn with two long wooden trestle
> tables and benches at the centre, a red-and-white checked blanket spread
> on the grass beside a wicker hamper, and a single furled cream parasol on
> a pole, low hedges and a few ferns at the sides. The TOP THIRD of the
> frame is a solid dark shaded tree-canopy band running the full width,
> clearly darker than everything below it, calm and untextured with no
> detail, so pale text can sit on it legibly. Even flat lighting, no cast
> shadows. Glossy cartoon mobile-game art style, bold dark outlines, clean
> cel shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

**park/attraction-gift_shop — Gift Shop:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a small timber-and-glass souvenir kiosk stands at the
> centre with a striped awning over its open counter, its window shelves
> stacked with plush toy dinosaurs, painted eggs and souvenir mugs, a blank
> unlettered wooden sign board hanging above the counter, potted ferns and
> a paved forecourt in front. The TOP THIRD of the frame is a solid dark
> green shop-awning band running the full width, clearly darker than
> everything below it, calm and untextured with no detail, so pale text can
> sit on it legibly. Even flat lighting, no cast shadows. Glossy cartoon
> mobile-game art style, bold dark outlines, clean cel shading with smooth
> gradients, polished game-asset look. No text, no characters, no UI
> elements.

**park/attraction-viewing_platform — Viewing Platform:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a raised timber observation deck on stout stilts
> stands centre-right with a plank staircase climbing to it, a heavy
> railing along its edge and a brass viewing telescope mounted on a post,
> a wide jungle valley of layered green canopy dropping away behind it.
> The TOP THIRD of the frame is a solid dark timber roof-beam band running
> the full width, clearly darker than everything below it, calm and
> untextured with no detail, so pale text can sit on it legibly. Even flat
> lighting, no cast shadows. Glossy cartoon mobile-game art style, bold
> dark outlines, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**park/attraction-amber_carousel — Amber Carousel:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a fairground carousel stands at the centre on a paved
> circle, carved dinosaur mounts on polished brass poles under a scalloped
> canopy, glowing translucent amber panels set between the poles casting
> warm gold light across the carved mounts, low hedges and ferns behind it.
> The TOP THIRD of the frame is a solid deep maroon carousel-canopy band
> running the full width, clearly darker than everything below it, calm and
> untextured with no detail, so pale text can sit on it legibly. Even flat
> lighting, no cast shadows. Glossy cartoon mobile-game art style, bold
> dark outlines, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**park/attraction-sky_gondola — Sky Gondola:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a cable-car station of dark steel and timber stands
> centre-left with two rounded gondola cabins hanging from a taut steel
> cable that runs out across the frame, a lattice pylon tower centre-right,
> a jungle valley and distant ridges far below. The TOP THIRD of the frame
> is a solid dark slate storm-sky band running the full width, clearly
> darker than everything below it, calm and untextured with no detail, so
> pale text can sit on it legibly. Even flat lighting, no cast shadows.
> Glossy cartoon mobile-game art style, bold dark outlines, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

**park/attraction-grand_atrium — Grand Atrium:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a vast domed glass atrium of white steel ribs and gold
> trim fills the centre, tall palms and tree ferns visible through its
> panes with a mounted dinosaur skeleton on a plinth inside, a broad paved
> approach and planted beds in front of it. The TOP THIRD of the frame is a
> solid dark bronze entablature band running the full width above the
> glass, clearly darker than everything below it, calm and untextured with
> no detail, so pale text can sit on it legibly. Even flat lighting, no
> cast shadows. Glossy cartoon mobile-game art style, bold dark outlines,
> clean cel shading with smooth gradients, polished game-asset look. No
> text, no characters, no UI elements.
```

- [ ] **Step 5: Generate the six sources**

Load the tools: `ToolSearch` with query `select:mcp__claude_ai_Higgsfield__media_upload,mcp__claude_ai_Higgsfield__media_confirm,mcp__claude_ai_Higgsfield__generate_image,mcp__claude_ai_Higgsfield__job_status`.

Make a scratch directory **outside the repo** — vitest runs test files in parallel forks, so a staged intermediate under `assets/images/` can be observed or deleted by another file mid-run:

```bash
SCRATCH="$(mktemp -d)/attraction-bands" && mkdir -p "$SCRATCH" && echo "$SCRATCH"
```

Upload the three landmark bands as references. For each of `landmark-a`, `landmark-b`, `landmark-c`: call `mcp__claude_ai_Higgsfield__media_upload` with `filename: "landmark-a.webp"` and `content_type: "image/webp"`, PUT the bytes to the returned `upload_url` with `curl -T assets/images/park/landmark-a.webp "<upload_url>"`, then call `mcp__claude_ai_Higgsfield__media_confirm` on the returned id. Keep the three `media_id`s.

Then six `mcp__claude_ai_Higgsfield__generate_image` calls, issued in one message so they run in parallel (the tool silently routes `nano_banana_pro` to `nano_banana_2` — expected, do not fight it). Each call is the same shape; the reference id and the prompt change:

```json
{ "params": {
  "model": "nano_banana_pro",
  "aspect_ratio": "16:9",
  "count": 1,
  "medias": [{ "value": "<landmark-a media_id>", "role": "image" }],
  "prompt": "Wide landscape ground-level view inside a dinosaur park, filling the ENTIRE frame edge to edge with no border, no plain background margin and no framing device: a mown green picnic lawn with two long wooden trestle tables and benches at the centre, a red-and-white checked blanket spread on the grass beside a wicker hamper, and a single furled cream parasol on a pole, low hedges and a few ferns at the sides. The TOP THIRD of the frame is a solid dark shaded tree-canopy band running the full width, clearly darker than everything below it, calm and untextured with no detail, so pale text can sit on it legibly. Even flat lighting, no cast shadows. Glossy cartoon mobile-game art style, bold dark outlines, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements."
} }
```

Reference mapping, and the prompt for each is the matching `park/attraction-<kind>` block written verbatim in Step 4:

| Kind | `medias[].value` |
|---|---|
| `picnic_lawn` | `landmark-a` media_id |
| `gift_shop` | `landmark-a` media_id |
| `viewing_platform` | `landmark-a` media_id |
| `amber_carousel` | `landmark-b` media_id |
| `sky_gondola` | `landmark-b` media_id |
| `grand_atrium` | `landmark-c` media_id |

Poll each with `mcp__claude_ai_Higgsfield__job_status` using `sync: true`, then download all six results:

```bash
curl -L -o "$SCRATCH/picnic_lawn.png" "<result url>"
curl -L -o "$SCRATCH/gift_shop.png" "<result url>"
curl -L -o "$SCRATCH/viewing_platform.png" "<result url>"
curl -L -o "$SCRATCH/amber_carousel.png" "<result url>"
curl -L -o "$SCRATCH/sky_gondola.png" "<result url>"
curl -L -o "$SCRATCH/grand_atrium.png" "<result url>"
```

Cost is 2 credits per image, 12 for the set. If `fit-art.mjs` throws `Error: Invalid SVG image` with `{ code: 'InvalidArg' }` on one of these PNGs in the next step, the file is not corrupt — it carries a C2PA `caBX` chunk whose metadata contains the literal text `<svg`; the strip recipe is in `docs/assets/prompts.md` under "Decode trap".

- [ ] **Step 6: Fit each source to 270×150**

```bash
node scripts/fit-art.mjs band "$SCRATCH/picnic_lawn.png" assets/images/park/attraction-picnic_lawn.webp
node scripts/fit-art.mjs band "$SCRATCH/gift_shop.png" assets/images/park/attraction-gift_shop.webp
node scripts/fit-art.mjs band "$SCRATCH/viewing_platform.png" assets/images/park/attraction-viewing_platform.webp
node scripts/fit-art.mjs band "$SCRATCH/amber_carousel.png" assets/images/park/attraction-amber_carousel.webp
node scripts/fit-art.mjs band "$SCRATCH/sky_gondola.png" assets/images/park/attraction-sky_gondola.webp
node scripts/fit-art.mjs band "$SCRATCH/grand_atrium.png" assets/images/park/attraction-grand_atrium.webp
```

Each prints `band assets/images/park/attraction-<kind>.webp 270x150 (source 1376x768)`.

- [ ] **Step 7: Measure the label-band contrast and review by eye**

Write the measurement script to the scratch directory (not the repo) and run it from the repo root:

```bash
cat > "$SCRATCH/measure.mjs" <<'EOF'
import { readFileSync } from 'node:fs';
import { Image, createCanvas } from '@napi-rs/canvas';

// drawAttraction's label colour and the flat fill the art replaces (src/core/render/draw.ts).
const TEXT = [0xea, 0xf4, 0xfb];
const FILL = [0x2d, 0x4a, 0x63];

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

const KINDS = ['picnic_lawn', 'gift_shop', 'viewing_platform', 'amber_carousel', 'sky_gondola', 'grand_atrium'];
console.log(`flat-fill baseline ${ratio(TEXT, FILL).toFixed(2)}:1`);

for (const kind of KINDS) {
  const img = new Image();
  img.src = readFileSync(`assets/images/park/attraction-${kind}.webp`);
  await img.decode();                       // raster decode is async — an un-awaited decode reads blank
  const canvas = createCanvas(270, 150);
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0, 270, 150);
  // The label rectangle: the name's baseline is (14, 34) at 18px and `Lv N`'s is (14, 54) at 13px,
  // truncated to TILE_W-28 wide, so x 14..250 / y 14..58 covers both ascenders and both baselines.
  const { data } = c.getImageData(14, 14, 236, 44);
  let worst = Infinity;
  for (let i = 0; i < data.length; i += 4) worst = Math.min(worst, ratio(TEXT, [data[i], data[i + 1], data[i + 2]]));
  console.log(`${kind} worst ${worst.toFixed(2)}:1 ${worst >= 6 ? 'ok' : worst >= 4.5 ? 'FLOOR ONLY' : 'TOO LOW'}`);
}
EOF
node "$SCRATCH/measure.mjs"
```

Expected: `flat-fill baseline 8.29:1`, then six `ok` lines. Any kind printing `TOO LOW` or `FLOOR ONLY` goes back to Step 5 with the dark-band clause strengthened for that scene — darken the band's material and push it further down the frame, do not darken the whole image. Then open all six committed WebPs and confirm by eye that the upper band is calm and untextured (no glare streaks, no foliage detail crossing it) and that each attraction is recognisable at 270×150 — legibility of the subject is a review-by-eye property no test covers.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/park-art-assets.test.ts tests/docs-assets.test.ts -t "tile size"` then `npx vitest run tests/park-art-assets.test.ts tests/docs-assets.test.ts`

Expected: PASS — eleven tile-size cases, the naming test, and the park raster documentation test.

- [ ] **Step 9: Run the full gate**

Run: `npm run typecheck && npx vitest run`

Expected: all pass. `tests/images.test.ts` asserts every file under `assets/images/` is WebP, so the six new rasters are covered there too.

- [ ] **Step 10: Commit**

```bash
git add assets/images/park/attraction-picnic_lawn.webp assets/images/park/attraction-gift_shop.webp assets/images/park/attraction-viewing_platform.webp assets/images/park/attraction-amber_carousel.webp assets/images/park/attraction-sky_gondola.webp assets/images/park/attraction-grand_atrium.webp docs/assets/prompts.md tests/park-art-assets.test.ts tests/docs-assets.test.ts
git commit -m "Add the six attraction cell rasters, their regeneration prompts, and a directory-enumerating slug guard"
```

---

### Task 16: Ship the eight hero species portraits

**Files:**
- Create: `assets/images/dinos/tyrannosaurus.webp`
- Create: `assets/images/dinos/spinoraptor.webp`
- Create: `assets/images/dinos/liopleurodon.webp`
- Create: `assets/images/dinos/mosasaurus.webp`
- Create: `assets/images/dinos/quetzalcoatlus.webp`
- Create: `assets/images/dinos/indominus.webp`
- Create: `assets/images/dinos/indoraptor.webp`
- Create: `assets/images/dinos/ultimasaurus.webp`
- Modify: `docs/assets/prompts.md:1098-1099` — insert a new `## Hero species portraits` section between the end of `## Dino archetypes` (ends at :1098) and `## Park map` (starts at :1099)
- Modify: `tests/images.test.ts:374` — add the hero constants immediately after `DINO_ART_KEYS`
- Modify: `tests/images.test.ts:376-387` — add a prompt-row test inside `describe('dino archetype prompts')`
- Modify: `tests/images.test.ts:389-401` — append a new `describe('hero species art')` after `describe('dino archetype art')` (currently the last block in the file)
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos', name: string): ImageRef | null` (`src/core/images.ts:19`); `dinoImage(speciesId: string, archetype: string, diet: string): ImageRef | null` (`src/core/images.ts`, added by the earlier task); `expectTransparentCutout(kind: 'battles' | 'dinos', name: string): Promise<void>` (`tests/images.test.ts:207`, margin rule `kind === 'battles' ? 24 : 31` at `:236`); `DINO_ART_KEYS: string[]` (`tests/images.test.ts:374`); `allSpecies(): Species[]` (`src/data/species/index.js`)
- Produces: eight committed rasters at `assets/images/dinos/<speciesId>.webp`, each 1024×1024 transparent WebP q95 at a 31px alpha margin, which `dinoImage(<speciesId>, …)` resolves ahead of the archetype fallback; the module-local test constants `HERO_SPECIES: string[]`, `DINO_ART_FILES: string[]`, `SPECIES_IDS: Set<string>`, `SPECIES_ART_FILES: string[]` in `tests/images.test.ts`; the `## Hero species portraits` section in `docs/assets/prompts.md`

---

- [ ] **Step 1: Write the failing test**

Everything this test needs is already imported at the top of `tests/images.test.ts` — `readdirSync` and `readFileSync` (`:4`), `resolve` (`:5`), `assetImage` (`:6`), `allSpecies` (`:8`), `Image`/`createCanvas` (`:2`). Add no imports.

Insert immediately after `const DINO_ART_KEYS = …` (`tests/images.test.ts:374`):

```ts
// The 8 rarest species — the five legendaries and the three mythics — each ship a
// per-species OVERRIDE portrait that dinoImage() prefers over the archetype×diet
// art they used to share. HAND-TYPED on purpose: deriving this from rarity would
// silently demand a new raster the moment a legendary or mythic species ships,
// which is exactly the "adding a species is a data-only change" guarantee the
// fixed 8-file archetype set exists to keep. Adding a ninth hero portrait is an
// edit here, deliberately.
const HERO_SPECIES = [
  'indominus', 'indoraptor', 'liopleurodon', 'mosasaurus',
  'quetzalcoatlus', 'spinoraptor', 'tyrannosaurus', 'ultimasaurus',
].sort();

// Enumerated from DISK, never from HERO_SPECIES: a hand-typed list can only prove
// that what exists, exists (the same reason scrapeBannerNames above is a scrape).
// Reading the directory is what makes a stray or misspelled file — dinos/t-rex.webp,
// dinos/gift-shop.webp — visible, instead of it null-degrading into an imageless
// embed forever with this suite green.
const DINO_ART_FILES = readdirSync(resolve(process.cwd(), 'assets/images/dinos'))
  .filter((f) => f.endsWith('.webp'))
  .map((f) => f.replace(/\.webp$/, ''))
  .sort();
const SPECIES_IDS = new Set(allSpecies().map((s) => s.id));
const SPECIES_ART_FILES = DINO_ART_FILES.filter((n) => SPECIES_IDS.has(n));
```

Add this case inside the existing `describe('dino archetype prompts', …)` block (after the `it('documents all 8 archetype-diet targets …')` case at `tests/images.test.ts:380-386`):

```ts
  // Same precedent as the archetype case above and tests/battle-content.test.ts's
  // bossId cross-check: prompts.md is the regeneration source of truth, so a
  // shipped raster with no prompt row is unreproducible.
  it('documents a regeneration prompt for all 8 hero species portraits', () => {
    const prompts = readFileSync(new URL('../docs/assets/prompts.md', import.meta.url), 'utf8');
    expect(HERO_SPECIES).toHaveLength(8);
    expect(prompts).toContain('## Hero species portraits');
    for (const id of HERO_SPECIES) expect(prompts, id).toContain(`dinos/${id}.webp`);
  });
```

Append after the closing `});` of `describe('dino archetype art', …)` (end of file, `tests/images.test.ts:401`):

```ts
describe('hero species art', () => {
  // it.each over an EMPTY array registers zero tests and goes dark with the suite
  // still green — the same failure mode the banner-scrape guard above exists for.
  // This case is what makes a missing, short or misnamed set red, and it also
  // classifies every file in the directory: a dinos/ raster that is neither an
  // archetype-diet pair nor a real species id is referenced by nothing and renders
  // nowhere, because dinoImage only ever asks for those two shapes.
  it('ships exactly the hero portraits, and no unclassifiable dinos/ file', () => {
    expect(SPECIES_ART_FILES, 'per-species override files on disk').toEqual(HERO_SPECIES);
    const known = new Set([...DINO_ART_KEYS, ...SPECIES_IDS]);
    const strays = DINO_ART_FILES.filter((n) => !known.has(n));
    expect(strays, `neither an archetype-diet pair nor a species id: ${strays.join(', ')}`).toEqual([]);
  });

  // The gap this closes: expectTransparentCutout was reachable for the dinos kind
  // ONLY through it.each(DINO_ART_KEYS) — an 8-name list derived from the Archetype
  // and Diet type unions — so a per-species override file inherited NO dimension, no
  // corner-transparency and NO margin checking at all. 31px here, matching the
  // archetype set these render beside in the same embeds; never the boss portraits'
  // 24px (expectTransparentCutout picks the number off `kind`).
  it.each(SPECIES_ART_FILES)('%s is a 1024×1024 transparent cutout at the 31px margin',
    (name) => expectTransparentCutout('dinos', name));

  // The override must be an override, not a replacement: the other 44 species ship
  // no file of their own and must keep resolving archetype art through dinoImage's
  // fallback arm, or "adding a species is a data-only change" stops being true.
  it('every non-hero species still resolves to a shipped archetype image', () => {
    for (const s of allSpecies()) {
      if (HERO_SPECIES.includes(s.id)) continue;
      expect(assetImage('dinos', `${s.archetype}-${s.diet}`), s.id).not.toBeNull();
      expect(assetImage('dinos', s.id), `${s.id} unexpectedly ships its own portrait`).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "hero"`

Expected: FAIL, three ways at once —

```
FAIL  tests/images.test.ts > dino archetype prompts > documents a regeneration prompt for all 8 hero species portraits
AssertionError: expected '# Image generation prompts — egg, expedi…' to contain '## Hero species portraits'

FAIL  tests/images.test.ts > hero species art > ships exactly the hero portraits, and no unclassifiable dinos/ file
AssertionError: per-species override files on disk: expected [] to deeply equal [ 'indominus', 'indoraptor', 'liopleurodon', 'mosasaurus', 'quetzalcoatlus', 'spinoraptor', 'tyrannosaurus', 'ultimasaurus' ]
```

and the `it.each(SPECIES_ART_FILES)` block registers **zero** cases, which is precisely the dark-test hazard the case above is there to expose. Confirm that: `npx vitest run tests/images.test.ts -t "transparent cutout at the 31px margin"` reports no matching tests today, and must report 8 by Step 7.

- [ ] **Step 3: Write the prompts.md section**

Insert this verbatim into `docs/assets/prompts.md` between line 1098 (the last `support-carnivore.webp` bullet of `## Dino archetypes`) and line 1099 (`## Park map`). Keep a blank line either side.

Do not write the words "banners" or "emojis" preceded by a number anywhere in this section — `tests/docs-assets.test.ts:14-30` regexes `(\d+)\s+…emojis` and `(\d+)\s+…banners` out of this file and asserts each equals the committed count.

````markdown
## Hero species portraits

Eight per-species portraits for the rarest species in the roster — the five
legendaries and the three mythics — resolved by `dinoImage`
(`src/core/images.ts`) ahead of the archetype art, and used at every surface
that shows one dino: the `/dex view` entry thumbnail, the `hatch:crack` reveal
thumbnail, the featured dino on the park card, the duel lead, and the non-boss
battle thumbnail.

| File | Size | Use |
|---|---|---|
| `assets/images/dinos/tyrannosaurus.webp` | 1024×1024, transparent | per-species override for `dinos/bruiser-carnivore.webp` |
| `assets/images/dinos/spinoraptor.webp` | 1024×1024, transparent | per-species override for `dinos/bruiser-carnivore.webp` |
| `assets/images/dinos/liopleurodon.webp` | 1024×1024, transparent | per-species override for `dinos/bruiser-carnivore.webp` |
| `assets/images/dinos/indominus.webp` | 1024×1024, transparent | per-species override for `dinos/bruiser-carnivore.webp` |
| `assets/images/dinos/mosasaurus.webp` | 1024×1024, transparent | per-species override for `dinos/tank-carnivore.webp` |
| `assets/images/dinos/ultimasaurus.webp` | 1024×1024, transparent | per-species override for `dinos/tank-carnivore.webp` |
| `assets/images/dinos/quetzalcoatlus.webp` | 1024×1024, transparent | per-species override for `dinos/swift-carnivore.webp` |
| `assets/images/dinos/indoraptor.webp` | 1024×1024, transparent | per-species override for `dinos/swift-carnivore.webp` |

**Override, never replacement.** `dinoImage(speciesId, archetype, diet)` tries
`dinos/<speciesId>.webp` first and falls back to `dinos/<archetype>-<diet>.webp`,
so the other 44 species keep the shared archetype art and adding a species stays
a data-only change. Deleting any one of these eight files restores that species'
archetype art with no code change and no error — the same null-degrade every
family here relies on.

**Rim light: a HARD SPECULAR EDGE on the silhouette, never a soft outer glow.**
This is the one prompt constraint that can silently produce an asset *worse* than
the stand-in it replaces. `remove_background` cuts on alpha: a soft outer glow is
either eaten whole by the matte, leaving a portrait that reads as flatter than
the archetype art beside it, or it survives as a pale halo ringing the animal on
transparency — which reads as a rendering fault at 80px thumbnail size, in both
Discord themes. The rim must sit ON the creature's own edge pixels, crisp, with
no bloom, no feathering and no falloff into the background.

- **Legendary rim: warm gold `#f1c40f`** — `tyrannosaurus`, `spinoraptor`,
  `liopleurodon`, `mosasaurus`, `quetzalcoatlus`. This is exactly
  `RARITY_COLOR.legendary` (`src/modules/hatchery/embeds.ts`), so the rim and the
  reveal embed's side bar agree.
- **Mythic rim: violet `#8e44ad`** — `indominus`, `indoraptor`, `ultimasaurus`.
  Violet deliberately does **not** match `RARITY_COLOR.mythic` (`0xe74c3c`, red).
  A red rim on Indominus' pale bone hide and on Indoraptor's black-and-gold reads
  as blood or damage; violet reads as engineered, which is what the mythic tier
  is. Do not "correct" this to the embed color.

**Hard no-glow rule** (inherited verbatim from Dino archetypes, and it is not in
tension with the rim light above — a rim is on-silhouette, a glow is off-it): no
glow, rays, embers, sparkles, or light effects may extend beyond the dinosaur
silhouette. Emissive detail is allowed only ON surfaces. Every prompt below
carries both rules.

**Margin: 31px — `node scripts/fit-art.mjs cutout`, never the boss portraits'
24px.** These render beside the archetype art in the same embeds, so they must
match that family, not `assets/images/battles/`. The divergence between the two
families is recorded in the table in Egg rarities; this set sits on the
`fit-art.mjs` side of it. `tests/images.test.ts` asserts the fitted margin to
±1px per file.

**Facing right:** like all seven boss portraits and all eight archetype cutouts,
snout pointing right. Two boss generations came back mirrored and had to be
flipped in post — check every generation against its reference before shipping.

**Workflow (reference chain):** each hero portrait is generated as an image-edit
of **the archetype cutout that species currently shares** (Nano Banana Pro,
`medias` role `image`) — the strongest available style lock, because the stand-in
is precisely the image the new file replaces, so pose, camera, scale in frame and
rendering all carry over for free. Post-process each with `remove_background`,
then
`node scripts/fit-art.mjs cutout <src> assets/images/dinos/<speciesId>.webp`.

| Target | Reference attached as `image` |
|---|---|
| `dinos/tyrannosaurus.webp` | `assets/images/dinos/bruiser-carnivore.webp` |
| `dinos/spinoraptor.webp` | `assets/images/dinos/bruiser-carnivore.webp` |
| `dinos/liopleurodon.webp` | `assets/images/dinos/bruiser-carnivore.webp` |
| `dinos/indominus.webp` | `assets/images/dinos/bruiser-carnivore.webp` |
| `dinos/mosasaurus.webp` | `assets/images/dinos/tank-carnivore.webp` |
| `dinos/ultimasaurus.webp` | `assets/images/dinos/tank-carnivore.webp` |
| `dinos/quetzalcoatlus.webp` | `assets/images/dinos/swift-carnivore.webp` |
| `dinos/indoraptor.webp` | `assets/images/dinos/swift-carnivore.webp` |

**Species, not individual, and not a kind either.** The archetype set reads as a
*kind* (clean, unblemished, flat); the boss portraits read as a named
*individual* (scarred, chipped, damaged). These sit between: individuating
species detail — a real skull shape, real coloring, real body plan — but no
scars, no chipped teeth, no torn frills, no battle damage. Scarring stays
reserved for `assets/images/battles/`.

**Two stand-ins are anatomically wrong, and correcting them is a large part of
why this set exists.** `liopleurodon` is a short-necked marine pliosaur currently
rendered as a heavy toothy land theropod, and `quetzalcoatlus` is a toothless
azhdarchid pterosaur currently rendered as a lean toothy land theropod. Their
prompts below say so explicitly and instruct the model to replace the entire body
plan rather than restyle the reference — an edit prompt that only adds color to a
theropod will happily keep the theropod.

**Silhouettes that grow past the reference: `spinoraptor`'s sail,
`quetzalcoatlus`' crest and neck, `ultimasaurus`' shoulder plating.** These three
read larger in frame than the archetype poses they edit from, and that is exactly
how `boss-founders_park` came back cropped at the bottom and right edges on its
first attempt. All three prompts below therefore carry the CRITICAL FRAMING block
from Battle bosses. If a generation still touches an edge, regenerate rather than
re-cropping.

### tyrannosaurus (dinos/tyrannosaurus.webp)

Reference: `assets/images/dinos/bruiser-carnivore.webp`. Rim: gold `#f1c40f`.

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the dinosaur to
> a massive cartoon Tyrannosaurus rex with a deep boxy skull, heavy brow ridges
> over small forward-set eyes, thick jaw muscles, banded teeth showing at the lip
> line, a powerfully corded neck, tiny two-fingered forelimbs, and coarse pebbled
> hide in deep crimson over charcoal with a paler bone-white throat. Render it as
> a specific species with individuating detail, but with clean unblemished hide:
> no scars, no chipped teeth, no battle damage. Add a hard specular rim light
> along the silhouette edge only — a crisp warm gold #f1c40f highlight sitting
> tight on the creature's outline, like a sharp light source directly behind it.
> The rim must stay ON the animal's own edge; it must not bleed, feather, bloom
> or halo outward into the background, and there must be no soft glow of any kind
> around the silhouette. No glow, rays, embers, sparkles, or light effects
> extending beyond the dinosaur silhouette; glowing details may appear only on
> the surfaces themselves. Plain flat light-gray studio background, completely
> empty, no drawn border, no frame, no panel edge, no letterboxing. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

### spinoraptor (dinos/spinoraptor.webp)

Reference: `assets/images/dinos/bruiser-carnivore.webp`. Rim: gold `#f1c40f`.
Carries the CRITICAL FRAMING block — the sail runs well above the reference's
shoulder line.

> Keep the exact same head-and-shoulders three-quarter portrait camera angle and
> facing as the reference image: facing right with the snout pointing right, on a
> plain flat light-gray studio background with no scenery and no ground shadow.
> Change the dinosaur to a cartoon hybrid theropod — a raptor's narrow alert head
> and sickle-clawed forelimbs carried on a heavy spinosaur frame, with a long
> crocodilian snout of interlocking conical teeth, a high forward-set eye, and a
> tall ridged skin sail rising from the shoulders and back — coloured in olive
> and rust striping with the sail membrane in warm translucent amber. Render it
> as a specific species with individuating detail, but with clean unblemished
> hide: no scars, no chipped teeth, no torn sail, no battle damage. Add a hard
> specular rim light along the silhouette edge only — a crisp warm gold #f1c40f
> highlight sitting tight on the creature's outline, including the top edge of
> the sail, like a sharp light source directly behind it. The rim must stay ON
> the animal's own edge; it must not bleed, feather, bloom or halo outward into
> the background, and there must be no soft glow of any kind around the
> silhouette. No glow, rays, embers, sparkles, or light effects extending beyond
> the dinosaur silhouette; glowing details may appear only on the surfaces
> themselves. CRITICAL FRAMING: zoom out so the ENTIRE creature — the whole head,
> the full neck, the complete sail and both shoulders — sits well inside the
> frame, small in the canvas, surrounded by a wide band of empty background on
> all four sides. Nothing may touch, run off, or be cropped by any edge of the
> image, especially the top and bottom edges. Plain flat light-gray studio
> background, completely empty, no drawn border, no frame, no panel edge, no
> letterboxing. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no lettering, no words, no
> numbers, no signage writing anywhere in the scene, no human characters, no UI
> elements.

### liopleurodon (dinos/liopleurodon.webp)

Reference: `assets/images/dinos/bruiser-carnivore.webp`. Rim: gold `#f1c40f`.
**Anatomy correction — the reference is the wrong animal.** Liopleurodon is a
short-necked marine pliosaur: four broad paddle flippers, no hind legs, no
upright bipedal stance, no theropod skull. The stand-in is a land theropod, so
the prompt replaces the body plan outright rather than restyling it.

> Keep only the camera angle, the scale in frame, the small even margin and the
> facing of the reference image — head and forequarters in three-quarter view,
> facing right with the snout pointing right, on a plain flat light-gray studio
> background with no scenery and no ground shadow. The animal in the reference is
> a land theropod and is the WRONG animal: replace the entire body plan. Do not
> keep the hind legs, do not keep the upright bipedal stance, do not keep the
> theropod skull. Draw instead a cartoon Liopleurodon — a short-necked marine
> pliosaur with an enormous elongated crocodile-like skull that is nearly a
> quarter of its whole body, a jaw of long interlocking fangs, a thick short
> muscular neck running straight into a broad torpedo-shaped body, and four wide
> flat paddle flippers with no toes and no claws, the leading front flipper
> sweeping into frame. Smooth wet rubbery hide with no scales and no feathers,
> countershaded deep marine blue over a pale silver belly, with a wet glossy
> sheen. Render it as a specific species with individuating detail, but with
> clean unblemished hide: no scars, no chipped teeth, no battle damage. Add a
> hard specular rim light along the silhouette edge only — a crisp warm gold
> #f1c40f highlight sitting tight on the creature's outline, like a sharp light
> source directly behind it. The rim must stay ON the animal's own edge; it must
> not bleed, feather, bloom or halo outward into the background, and there must
> be no soft glow of any kind around the silhouette. No water, no waves, no
> spray, no bubbles, no underwater caustics — the background stays an empty flat
> studio gray. No glow, rays, embers, sparkles, or light effects extending beyond
> the creature silhouette; glowing details may appear only on the surfaces
> themselves. Plain flat light-gray studio background, completely empty, no drawn
> border, no frame, no panel edge, no letterboxing. Glossy cartoon mobile-game
> art style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset look.
> No text, no lettering, no words, no numbers, no signage writing anywhere in the
> scene, no human characters, no UI elements.

### mosasaurus (dinos/mosasaurus.webp)

Reference: `assets/images/dinos/tank-carnivore.webp`. Rim: gold `#f1c40f`. The
stand-in's broad blunt snout is already the right general read, so this is a
restyle rather than a body-plan replacement — but the flippers are new and must
be stated.

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the animal to a
> cartoon Mosasaurus — a huge marine lizard with a long streamlined body, a broad
> wedge-shaped skull, a heavy lower jaw and a double row of conical teeth, a
> forked flicking tongue, small high-set eyes, keeled scales ridging the back of
> the neck, and short broad paddle flippers rather than clawed legs, with the
> leading flipper visible at the lower edge of the portrait. Slate and deep teal
> countershading over a cream belly, with a wet glossy sheen. Render it as a
> specific species with individuating detail, but with clean unblemished hide: no
> scars, no chipped teeth, no battle damage. Add a hard specular rim light along
> the silhouette edge only — a crisp warm gold #f1c40f highlight sitting tight on
> the creature's outline, like a sharp light source directly behind it. The rim
> must stay ON the animal's own edge; it must not bleed, feather, bloom or halo
> outward into the background, and there must be no soft glow of any kind around
> the silhouette. No water, no waves, no spray, no bubbles, no underwater
> caustics — the background stays an empty flat studio gray. No glow, rays,
> embers, sparkles, or light effects extending beyond the creature silhouette;
> glowing details may appear only on the surfaces themselves. Plain flat
> light-gray studio background, completely empty, no drawn border, no frame, no
> panel edge, no letterboxing. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel shading
> with smooth gradients, polished game-asset look. No text, no lettering, no
> words, no numbers, no signage writing anywhere in the scene, no human
> characters, no UI elements.

### quetzalcoatlus (dinos/quetzalcoatlus.webp)

Reference: `assets/images/dinos/swift-carnivore.webp`. Rim: gold `#f1c40f`.
**Anatomy correction — the reference is the wrong animal.** Quetzalcoatlus is a
toothless azhdarchid pterosaur; the stand-in is a lean toothy theropod, and
`## Dino archetypes` above already records that mismatch as an accepted cost of
the fixed set. This file is what pays it off. Carries the CRITICAL FRAMING block
— the crest and the long neck both run past the reference's silhouette.

> Keep only the camera angle, the scale in frame, the small even margin and the
> facing of the reference image — head-and-shoulders three-quarter view, facing
> right with the beak pointing right, on a plain flat light-gray studio
> background with no scenery and no ground shadow. The animal in the reference is
> a toothy land theropod and is the WRONG animal: replace the entire body plan.
> Draw instead a cartoon Quetzalcoatlus, a giant azhdarchid pterosaur — a long
> straight spear-like beak that is completely TOOTHLESS with smooth clean jaw
> edges, a tall backswept blade-shaped head crest, a very long stiff upright
> neck, a small compact body covered in short fuzzy pycnofibres rather than
> scales, and a membranous wing folded at the shoulder with the wing finger
> visible as a long spar. No teeth anywhere, no scaly theropod snout, no clawed
> theropod forelimbs, no feathered wings. Pale bone-white and slate colouring
> with a warm coral crest and a dark eye stripe. Render it as a specific species
> with individuating detail, but with clean unblemished hide: no scars, no torn
> wing membrane, no battle damage. Add a hard specular rim light along the
> silhouette edge only — a crisp warm gold #f1c40f highlight sitting tight on the
> creature's outline, including the crest and the beak, like a sharp light source
> directly behind it. The rim must stay ON the animal's own edge; it must not
> bleed, feather, bloom or halo outward into the background, and there must be no
> soft glow of any kind around the silhouette. No glow, rays, embers, sparkles,
> or light effects extending beyond the creature silhouette; glowing details may
> appear only on the surfaces themselves. CRITICAL FRAMING: zoom out so the
> ENTIRE creature — the whole beak, the full crest, the complete neck and both
> shoulders — sits well inside the frame, small in the canvas, surrounded by a
> wide band of empty background on all four sides. Nothing may touch, run off, or
> be cropped by any edge of the image, especially the top and right edges. Plain
> flat light-gray studio background, completely empty, no drawn border, no frame,
> no panel edge, no letterboxing. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel shading
> with smooth gradients, polished game-asset look. No text, no lettering, no
> words, no numbers, no signage writing anywhere in the scene, no human
> characters, no UI elements.

### indominus (dinos/indominus.webp)

Reference: `assets/images/dinos/bruiser-carnivore.webp`. Rim: violet `#8e44ad`.
This is the file the release exists for: a player pulling a Mythic Indominus
currently sees the same red bruiser bust as a common-tier roll.

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the dinosaur to
> a cartoon Indominus rex — a large engineered hybrid theropod with pale
> bone-white hide, knobbly osteoderm ridges running along the skull and down the
> neck, a heavy elongated jaw with irregular oversized teeth, long clawed
> three-fingered forelimbs, and cold amber-red eyes with narrow slit pupils, with
> faint darker grey mottling breaking up the white. It must read as calm,
> intelligent and unnatural rather than raging. Render it as a specific species
> with individuating detail, but with clean unblemished hide: no scars, no
> chipped teeth, no battle damage. Add a hard specular rim light along the
> silhouette edge only — a crisp violet #8e44ad highlight sitting tight on the
> creature's outline, like a sharp light source directly behind it. The rim must
> stay ON the animal's own edge; it must not bleed, feather, bloom or halo
> outward into the background, and there must be no soft glow of any kind around
> the silhouette. No glow, rays, embers, sparkles, or light effects extending
> beyond the dinosaur silhouette; glowing details may appear only on the surfaces
> themselves. Plain flat light-gray studio background, completely empty, no drawn
> border, no frame, no panel edge, no letterboxing. Glossy cartoon mobile-game
> art style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset look.
> No text, no lettering, no words, no numbers, no signage writing anywhere in the
> scene, no human characters, no UI elements.

### indoraptor (dinos/indoraptor.webp)

Reference: `assets/images/dinos/swift-carnivore.webp`. Rim: violet `#8e44ad`.

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the dinosaur to
> a cartoon Indoraptor — a lean engineered raptor-form hybrid with glossy jet
> black hide, a single sharp gold stripe running from behind the eye down the
> neck and flank, a narrow elongated skull with a low brow, a high forward-set
> eye with a pale yellow iris and a slit pupil, hooked forelimb claws, and a
> low-slung sinuous predatory posture. It must read as sly and malicious rather
> than brutish. Render it as a specific species with individuating detail, but
> with clean unblemished hide: no scars, no chipped teeth, no battle damage. Add
> a hard specular rim light along the silhouette edge only — a crisp violet
> #8e44ad highlight sitting tight on the creature's outline, like a sharp light
> source directly behind it. The rim must stay ON the animal's own edge; it must
> not bleed, feather, bloom or halo outward into the background, and there must
> be no soft glow of any kind around the silhouette. The rim is the only thing
> separating a black animal from the background — keep it crisp and unbroken
> along the whole outline. No glow, rays, embers, sparkles, or light effects
> extending beyond the dinosaur silhouette; glowing details may appear only on
> the surfaces themselves. Plain flat light-gray studio background, completely
> empty, no drawn border, no frame, no panel edge, no letterboxing. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

### ultimasaurus (dinos/ultimasaurus.webp)

Reference: `assets/images/dinos/tank-carnivore.webp`. Rim: violet `#8e44ad`.
Carries the CRITICAL FRAMING block — this is the same design that cropped at the
bottom and right on `boss-founders_park`'s first attempt. Note this is the
*species* portrait, distinct from the chapter-7 boss portrait
`assets/images/battles/boss-founders_park-portrait.webp`, which stays scarred,
tagged and fitted at 24px; the two must not be confused or reused for each other.

> Keep the exact same head-and-shoulders three-quarter portrait camera angle and
> facing as the reference image: facing right with the snout pointing right, on a
> plain flat light-gray studio background with no scenery and no ground shadow.
> Change the dinosaur to a cartoon Ultimasaurus — a composite armoured apex
> hybrid with a tyrannosaur's broad heavy skull, a pair of forward-curving brow
> horns, overlapping ankylosaur-style armour plates running across the shoulders
> and down the back, blunt bony knuckles ridging the jawline, and hooked sickle
> claws on the forelimbs. Deep burnished bronze and obsidian plating, with thin
> molten-orange seams glowing between the plates — the glow must be painted only
> ON the plate surfaces themselves and must not spill off the animal. Render it
> as a specific species with individuating detail, but with clean unblemished
> plating: no scars, no chipped plates, no battle damage, no metal tag. Add a
> hard specular rim light along the silhouette edge only — a crisp violet #8e44ad
> highlight sitting tight on the creature's outline, like a sharp light source
> directly behind it. The rim must stay ON the animal's own edge; it must not
> bleed, feather, bloom or halo outward into the background, and there must be no
> soft glow of any kind around the silhouette. No glow, rays, embers, sparkles,
> or light effects extending beyond the creature silhouette. CRITICAL FRAMING:
> zoom out so the ENTIRE creature — the whole head, both horns, the full neck and
> both complete armoured shoulders — sits well inside the frame, small in the
> canvas, surrounded by a wide band of empty background on all four sides.
> Nothing may touch, run off, or be cropped by any edge of the image, especially
> the bottom and right edges. Plain flat light-gray studio background, completely
> empty, no drawn border, no frame, no panel edge, no letterboxing. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.
````

Re-run the prompts gate on its own — it can go green before a single raster exists:

Run: `npx vitest run tests/images.test.ts -t "documents a regeneration prompt for all 8 hero species portraits"`
Expected: PASS.

- [ ] **Step 4: Generate the eight portraits**

For each of the eight, in this order (`tyrannosaurus`, `spinoraptor`, `liopleurodon`, `mosasaurus`, `quetzalcoatlus`, `indominus`, `indoraptor`, `ultimasaurus`):

1. Upload the reference file named in the table above (`media_upload` on the committed `assets/images/dinos/<archetype>-<diet>.webp`).
2. `generate_image` with model `nano_banana_pro`, the uploaded reference attached in `medias` with role `image`, and the species' blockquote prompt copied **verbatim** from the section written in Step 3. Do not paraphrase — the no-glow clause, the rim-light clause and the CRITICAL FRAMING clause are each there because a specific past generation failed without them.
3. `remove_background` on the returned image.
4. Download the background-removed result to a scratch path outside the repo, e.g. `C:\Users\Claude\AppData\Local\Temp\claude\C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot\8bc02eaa-c64d-45c3-a2ce-1d421c8f5a01\scratchpad\<speciesId>-raw.png`.

Never write intermediates under `assets/` — vitest runs test files in parallel forks and a scratch file on a committed asset path can be observed, or deleted, by another test file mid-run.

If `fit-art.mjs` throws `Error: Invalid SVG image { code: 'InvalidArg' }` on a downloaded PNG in the next step, the file is not corrupt: it carries a C2PA `caBX` chunk whose payload contains the literal text `<svg`. Strip the chunk with the `stripCaBX` recipe in `docs/assets/prompts.md` ("Decode trap") and retry.

- [ ] **Step 5: Fit each to a 1024×1024 transparent cutout at 31px**

`cutout` is the mode — **not** the boss portraits' one-off 24px pass. Run from the repo root:

```bash
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/8bc02eaa-c64d-45c3-a2ce-1d421c8f5a01/scratchpad"
for s in tyrannosaurus spinoraptor liopleurodon mosasaurus quetzalcoatlus indominus indoraptor ultimasaurus; do
  node scripts/fit-art.mjs cutout "$SCRATCH/$s-raw.png" "assets/images/dinos/$s.webp"
done
```

Each run prints the source dimensions and writes WebP q95. All eight files must exist under `assets/images/dinos/` before Step 6.

- [ ] **Step 6: Review all eight by eye before committing**

The margin test cannot see a halo — a soft glow ringing the animal simply enlarges the alpha bounding box, and `fit-art.mjs cutout` then re-centres that larger box to the same 31px, passing every assertion. This step is the only gate on it. For each file, open it and confirm:

- The rim light is a **hard edge on the outline**, not a soft ring floating around it, and there is no pale halo on the transparent background.
- Legendaries are gold, mythics are violet. A mythic that came back gold is a regeneration, not a recolour.
- `liopleurodon` has four paddle flippers, a short thick neck and no hind legs — if it still has a theropod's legs or stance, the edit prompt was ignored; regenerate.
- `quetzalcoatlus` has a **toothless** beak and a crest — if it has teeth, regenerate.
- Every animal faces right, snout/beak pointing right. Two boss generations came back mirrored; flip in post if needed.
- Nothing is cropped by any edge, especially on `spinoraptor`, `quetzalcoatlus` and `ultimasaurus`.
- No text, numbers, tags or drawn border survived.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/images.test.ts`

Expected: PASS. Specifically, `it.each(SPECIES_ART_FILES)` must now register and pass **8** cases named `<speciesId> is a 1024×1024 transparent cutout at the 31px margin` — confirm the count, since a zero-case `it.each` is green too:

```bash
npx vitest run tests/images.test.ts -t "transparent cutout at the 31px margin" --reporter=verbose
```

- [ ] **Step 8: Full gate**

Run: `npm run typecheck && npx vitest run`

Expected: PASS, with no existing test moving. Nothing should: none of the eight hero species appears in any pinned art fixture — every `attachment://<archetype>-<diet>.webp` assertion in `tests/hatchery.test.ts`, `tests/battles-embeds.test.ts`, `tests/battles-module.test.ts`, `tests/park.test.ts` and `tests/showcase.test.ts` is built on `velociraptor`, `triceratops`, `compsognathus`, `othnielia` or `microceratus`. If one of those files goes red, a hero species leaked into a fixture and that assertion needs re-reading, not re-pinning.

`npm run typecheck` is the gate that `npm run build` and `npm test` cannot provide: `build` is `tsc` against `tsconfig.json`, which only `include`s `src`, and vitest transpiles without typechecking, so a type error in `tests/images.test.ts` passes both.

- [ ] **Step 9: Commit**

```powershell
git add assets/images/dinos/tyrannosaurus.webp assets/images/dinos/spinoraptor.webp assets/images/dinos/liopleurodon.webp assets/images/dinos/mosasaurus.webp assets/images/dinos/quetzalcoatlus.webp assets/images/dinos/indominus.webp assets/images/dinos/indoraptor.webp assets/images/dinos/ultimasaurus.webp docs/assets/prompts.md tests/images.test.ts

git commit -m @'
Ship per-species portraits for the eight rarest species

Give the five legendaries and the three mythics portraits of their own at
assets/images/dinos/<speciesId>.webp, resolved ahead of the shared archetype
art. Every legendary and mythic is a carnivore, so eight species previously
collapsed onto three images: a Mythic Indominus pull rendered the same red
bruiser bust as a common-tier roll.

Two of the three stand-ins were also anatomically wrong. Liopleurodon is a
short-necked marine pliosaur and Quetzalcoatlus a toothless azhdarchid
pterosaur; both shipped as toothy land theropods. Their prompts replace the
body plan outright rather than restyling the reference.

Each portrait is an image-edit of the exact archetype cutout it replaces,
which is the strongest available style lock, and carries a hard specular rim
light on the silhouette edge - gold for legendary, violet for mythic. A soft
outer glow is not interchangeable: background removal cuts on alpha, so a
glow is either eaten by the matte or survives as a halo.

Extend the cutout gate to cover them. expectTransparentCutout was reachable
for the dinos kind only through it.each over the eight archetype-diet keys,
so a per-species file inherited no dimension, corner-transparency or margin
checking at all. The new block enumerates the directory instead, fails on a
file that is neither an archetype pair nor a real species id, and asserts the
31px fit-art margin rather than the boss portraits 24px.
'@
```

---

### Task 17: Cover the species art override end to end

**Files:**
- Create: `tests/species-art.test.ts`
- Modify: none — this task adds tests only; the `dinoImage` helper and its five call sites landed earlier, and the eight rasters landed in the previous task
- Test: `tests/species-art.test.ts`

**Interfaces:**
- Consumes: `dinoImage(speciesId: string, archetype: string, diet: string): ImageRef | null` (`src/core/images.ts`); `dexViewPayload(ctx: Ctx, userId: string, speciesId: string): Payload` where `Payload = { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }` (`src/modules/dex/embeds.ts:69`); `revealPayload(species: Species): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files: AttachmentBuilder[]; attachments: never[] }` (`src/modules/hatchery/embeds.ts:30`); `getSpecies(id: string): Species` (`src/data/species/index.js`); `makeCtx(overrides?)` (`tests/harness.ts`); `getOrCreateUser(ctx, userId, displayName)` (`src/modules/park/service.ts`); the eight rasters committed by the previous task
- Produces: `tests/species-art.test.ts` — a test file, no exports

---

- [ ] **Step 1: Write the failing test**

Create `tests/species-art.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dexViewPayload } from '../src/modules/dex/embeds.js';
import { revealPayload } from '../src/modules/hatchery/embeds.js';
import { getSpecies } from '../src/data/species/index.js';
import { dinoImage } from '../src/core/images.js';

// dinoImage is a PASS-THROUGH spy (it calls the real implementation), so every
// assertion below reads the real committed rasters off disk. Nothing here stages
// or deletes a file under assets/images/: vitest runs test FILES in parallel
// forks, so a writeFileSync/rmSync on a committed asset path can be observed —
// or deleted — by another file mid-run. The spy exists for the two things a
// real-asset read cannot show on its own: which arguments each call site passes,
// and the null-degrade branch.
//
// This mocks dinoImage and deliberately NOT assetImage. dinoImage calls
// assetImage through its own module-internal binding, which a vi.mock of the
// assetImage EXPORT cannot intercept — importOriginal() hands back the real
// dinoImage, closed over the real assetImage. Mocking assetImage here would
// queue a mockImplementationOnce that nothing ever consumes, and the degrade
// tests below would silently assert nothing.
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return { ...actual, dinoImage: vi.fn(actual.dinoImage) };
});

// speciesId -> `${archetype}-${diet}`: the file each hero WOULD resolve to if the
// override were dropped. Hand-typed against src/data/species/*.ts. Eight species
// collapsed onto three images before the override shipped, which is the whole
// reason this file exists.
const HERO_FALLBACK: Record<string, string> = {
  tyrannosaurus: 'bruiser-carnivore',
  spinoraptor: 'bruiser-carnivore',
  liopleurodon: 'bruiser-carnivore',
  indominus: 'bruiser-carnivore',
  mosasaurus: 'tank-carnivore',
  ultimasaurus: 'tank-carnivore',
  quetzalcoatlus: 'swift-carnivore',
  indoraptor: 'swift-carnivore',
};
const HERO_IDS = Object.keys(HERO_FALLBACK);

// The species that DO appear in existing pinned art fixtures, none of which ships
// an override — which is why nothing existing moved when the heroes landed, and
// equally why the override would otherwise ship completely untested.
const NON_HERO: Array<[string, string]> = [
  ['velociraptor', 'swift-carnivore'],
  ['triceratops', 'tank-herbivore'],
  ['compsognathus', 'swift-carnivore'],
  ['othnielia', 'swift-herbivore'],
  ['microceratus', 'support-herbivore'],
];

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  // vitest.config.ts sets neither clearMocks nor restoreMocks, so mock.calls
  // would otherwise accumulate across every case in this file.
  vi.mocked(dinoImage).mockClear();
});

describe('/dex view carries the species art override', () => {
  it.each(HERO_IDS)('%s reaches the embed as its own portrait', (id) => {
    const payload = dexViewPayload(ctx, 'u1', id);
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${id}.webp`);
    // Attach-all-or-nothing: a thumbnail URL with no matching upload renders broken.
    expect(payload.files!.map((f) => f.name)).toEqual([`${id}.webp`]);
  });

  // The half that proves it is an OVERRIDE and not a replacement: 44 species ship
  // no file of their own and must still land on the archetype art, or "adding a
  // species is a data-only change" stops being true.
  it.each(NON_HERO)('%s still resolves the shared %s art', (id, key) => {
    const payload = dexViewPayload(ctx, 'u1', id);
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${key}.webp`);
    expect(payload.files!.map((f) => f.name)).toEqual([`${key}.webp`]);
  });

  // Without this, the hero cases above could pass on a call site that had simply
  // stopped resolving art at all — and the non-hero cases could pass on a call
  // site that passed the archetype key where the species id belongs, since that
  // key is itself a present file. Naming the fallback explicitly is what makes the
  // two directions independent.
  it.each(HERO_IDS)('%s no longer resolves the archetype art it used to share', (id) => {
    const url = dexViewPayload(ctx, 'u1', id).embeds[0].toJSON().thumbnail?.url;
    expect(url).not.toBe(`attachment://${HERO_FALLBACK[id]}.webp`);
  });

  it('passes the species id, archetype and diet — in that argument order', () => {
    dexViewPayload(ctx, 'u1', 'quetzalcoatlus');
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['quetzalcoatlus', 'swift', 'carnivore']]);
  });

  it('degrades to no thumbnail and no files key when neither file is present', () => {
    // Models a deploy with no dino art at all — every asset is individually
    // optional, and assetImage's null return is the contract dinoImage inherits
    // on BOTH arms: a species miss falling through to an archetype miss is null.
    vi.mocked(dinoImage).mockImplementationOnce(() => null);
    const payload = dexViewPayload(ctx, 'u1', 'tyrannosaurus');
    expect(payload.embeds[0].toJSON().thumbnail).toBeUndefined();
    // attach() is a total no-op on null — files must be undefined, never [].
    expect('files' in payload).toBe(false);
    expect(payload.files).toBeUndefined();
  });
});

describe('the hatch reveal carries the species art override', () => {
  it('a mythic hero hatches under its own portrait, beside its rarity crack', () => {
    const p = revealPayload(getSpecies('indominus'));   // mythic, bruiser/carnivore
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://mythic-crack.webp');
    expect(embed.thumbnail?.url).toBe('attachment://indominus.webp');
    // attach APPENDS and call order is upload order: crack first, portrait second.
    expect(p.files.map((f) => f.name)).toEqual(['mythic-crack.webp', 'indominus.webp']);
    // attachments: [] is load-bearing — discord.js pushes the new descriptors into
    // the array we pass, so the pre-hatch egg upload is dropped by i.update().
    expect(p.attachments).toEqual([]);
  });

  it('a legendary hero hatches under its own portrait', () => {
    const p = revealPayload(getSpecies('quetzalcoatlus'));   // legendary, swift/carnivore
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://legendary-crack.webp');
    expect(embed.thumbnail?.url).toBe('attachment://quetzalcoatlus.webp');
    expect(p.files.map((f) => f.name)).toEqual(['legendary-crack.webp', 'quetzalcoatlus.webp']);
  });

  it('a non-hero species still hatches under the shared archetype art', () => {
    const p = revealPayload(getSpecies('velociraptor'));   // rare, swift/carnivore
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://rare-crack.webp');
    expect(embed.thumbnail?.url).toBe('attachment://swift-carnivore.webp');
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.webp', 'swift-carnivore.webp']);
  });

  it('passes the species id, archetype and diet — in that argument order', () => {
    revealPayload(getSpecies('ultimasaurus'));
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['ultimasaurus', 'tank', 'carnivore']]);
  });

  it('still ships the crack when the portrait is missing', () => {
    // Two files on one payload, two independent attach calls: a miss on the
    // portrait must not drop the crack attach already appended to payload.files.
    vi.mocked(dinoImage).mockImplementationOnce(() => null);
    const p = revealPayload(getSpecies('indoraptor'));
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://mythic-crack.webp');
    expect(embed.thumbnail).toBeUndefined();
    expect(p.files.map((f) => f.name)).toEqual(['mythic-crack.webp']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

This task adds coverage for behaviour that already works, so the test passes the moment it is written — and a test nobody has watched fail is not yet a test. Break the two call sites deliberately, watch the file go red, then restore.

Temporarily edit both lines to pass the archetype key where the species id belongs — the exact mistake these cases exist to catch, and an edit that touches no imports so nothing else can fail for the wrong reason:

`src/modules/dex/embeds.ts:92`

```ts
  attach(embed, payload, 'thumbnail',
    dinoImage(`${e.species.archetype}-${e.species.diet}`, e.species.archetype, e.species.diet));
```

`src/modules/hatchery/embeds.ts:53`

```ts
  attach(embed, payload, 'thumbnail',
    dinoImage(`${species.archetype}-${species.diet}`, species.archetype, species.diet));
```

Run: `npx vitest run tests/species-art.test.ts`

Expected: FAIL — **20 failed, 8 passed**. The 8 hero portrait cases, the 8 "no longer resolves the archetype art" cases, both argument-order cases and both hero hatch cases go red; the 5 non-hero cases, the 2 degrade cases and the non-hero hatch case stay green, which is exactly right — a call site that passes the archetype key still resolves a present file for a non-hero species, and that is why the hero cases have to exist. First failure reads:

```
FAIL  tests/species-art.test.ts > /dex view carries the species art override > tyrannosaurus reaches the embed as its own portrait
AssertionError: expected 'attachment://bruiser-carnivore.webp' to be 'attachment://tyrannosaurus.webp'
```

and the argument-order case reads:

```
AssertionError: expected [ [ 'swift-carnivore', 'swift', 'carnivore' ] ] to deeply equal [ [ 'quetzalcoatlus', 'swift', 'carnivore' ] ]
```

Restore both files:

```bash
git checkout -- src/modules/dex/embeds.ts src/modules/hatchery/embeds.ts
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run tests/species-art.test.ts`

Expected: PASS, 28 cases (8 hero dex + 5 non-hero dex + 8 hero fallback-negation + 1 dex arg order + 1 dex degrade + 5 hatchery).

- [ ] **Step 4: Confirm the pre-existing hatchery degrade tests still intercept**

`tests/hatchery.test.ts:278-300` holds two degrade cases built on `vi.mocked(assetImage).mockImplementationOnce(...)` with a **queue** keyed on 1st-call/2nd-call identity. The reveal's second call is the archetype thumbnail, and if that call now goes through `dinoImage` while the mock still targets the `assetImage` export, the queued entry is never consumed — the thumbnail resolves for real and the case asserts nothing (or fails outright).

Run: `npx vitest run tests/hatchery.test.ts -t "revealPayload"`

Expected: PASS. If `revealPayload still ships the crack when the archetype art is missing` is red, or if it is green while `p.files` contains two names, the earlier task left that mock pointed at the wrong export — it needs the same `dinoImage` spy this file uses, for the same intra-module-binding reason documented in the mock block above. Fix it there; do not weaken the assertion.

- [ ] **Step 5: Full gate**

Run: `npm run typecheck && npx vitest run`

Expected: PASS. `npm run typecheck` is the only gate that sees this file at all — `npm run build` is `tsc` against `tsconfig.json`, which `include`s `src` only, and vitest transpiles without typechecking, so a type error in `tests/species-art.test.ts` passes both `build` and `test` clean. Run it before committing anything that touches `tests/`.

`tests/contract.test.ts` must still report 29 top-level commands: nothing in this task or the previous one touches a builder, which is what makes `npm run deploy-commands` unnecessary for this release.

- [ ] **Step 6: Commit**

```powershell
git add tests/species-art.test.ts

git commit -m @'
Cover the species art override end to end

None of the eight hero species appears in any existing pinned art fixture -
the pinned ones are velociraptor, triceratops, compsognathus, othnielia and
microceratus - so nothing existing moved when the portraits landed, and the
override would otherwise have shipped with no payload-level coverage at all.

Assert both directions through the real builders: a hero species reaches the
dex entry and the hatch reveal as attachment://<speciesId>.webp, and a
non-hero species still resolves attachment://<archetype>-<diet>.webp. The
second half is what keeps "adding a species is a data-only change" honest.

Name each hero fallback explicitly and assert the thumbnail is not it. Four
heroes share bruiser-carnivore, so a call site passing the archetype key
where the species id belongs still resolves a present file and would stay
green on the non-hero cases alone.

The spy targets dinoImage rather than assetImage on purpose. dinoImage
reaches assetImage through its own module-internal binding, so a mock of the
assetImage export cannot intercept it and would queue a once-implementation
that nothing consumes - leaving the degrade cases asserting nothing.
'@
```

---

### Task 18: Four utility emoji — `dw_guest`, `dw_season`, `dw_duel`, `dw_landmark` (53 → 57)

**Files:**
- Create: `assets/emojis/svg/dw_guest.svg`
- Create: `assets/emojis/svg/dw_season.svg`
- Create: `assets/emojis/svg/dw_duel.svg`
- Create: `assets/emojis/svg/dw_landmark.svg`
- Create (generated by `npm run build-emojis`, committed): `assets/emojis/png/dw_guest.png`, `assets/emojis/png/dw_season.png`, `assets/emojis/png/dw_duel.png`, `assets/emojis/png/dw_landmark.png`
- Modify: `src/core/emojis.ts:7-31` (the `EMOJI_FALLBACK` table)
- Modify: `docs/ops.md:64` (two `53` → `57` on one line)
- Modify: `docs/assets/prompts.md:1412` (`53` → `57`), and append a design-intent table after `:1447`
- Test: `tests/emojis.test.ts:37-53` (the hard-coded name list, 53 → 57)
- Test (fires with no edit): `tests/emoji-assets.test.ts`, `tests/docs-assets.test.ts`

**Interfaces:**
- Consumes: `EMOJI_FALLBACK: Record<string, string>` and `emojiTag(name: string): string` from `src/core/emojis.js`; `renderSvg(svg: Buffer, size: number): Buffer` from `src/core/render-svg.js` (called by `src/build-emojis.ts` with `EMOJI_SIZE = 128`).
- Produces: four new keys in `EMOJI_FALLBACK` — `dw_guest`, `dw_season`, `dw_duel`, `dw_landmark` — resolvable at runtime through `emojiTag('dw_guest')` etc. once `npm run deploy-emojis` has run and the bot has restarted. No new exported function, no signature change.

**Two traps this task must honour, stated up front:**

1. **The resvg gradient-ellipse trap.** `<ellipse fill="url(#gradient)">` with the default `objectBoundingBox` `gradientUnits` renders **solid black** in the bundled resvg build. `circle`, `rect`, `polygon` and `path` gradients are unaffected. All four files below therefore put every gradient on a `circle`, `rect`, `polygon` or `path`, and use `<ellipse>` (or `<rect>`) **only for flat, solid-fill gloss highlights** — the same construction all 53 existing files use. The alternative fix, if a future icon genuinely needs a gradient ellipse, is `gradientUnits="userSpaceOnUse"` with `y1 = cy - ry` and `y2 = cy + ry` — the ellipse's own pre-transform bbox — exactly as `assets/emojis/svg/dw_food.svg` does for its `<ellipse cx="27" cy="30" rx="18" ry="14">` (`y1="16" y2="44"`).
2. **The 2% pure-black ceiling.** `tests/emoji-assets.test.ts:96` fails any PNG whose fully-opaque pixels are more than `MAX_BLACK_SHARE = 0.02` pure `#000000`. That gate exists to catch trap 1, which fills a whole shape black. None of the four files below contains `#000000` in any fill or stroke: outlines are dark brown (`#6b430a`, `#7a5a10`), dark teal (`#0f4a63`), dark navy (`#1b3a63`), dark violet (`#33206b`), dark plum (`#2b2233`) and warm dark grey (`#3f3a32`).

**A third rule, from the repo `CLAUDE.md`, applies but costs nothing here:** never call `emojiTag` in a module-level constant (the map loads after `ClientReady`, so module init would freeze the unicode fallback permanently), and never pass a rarity tag to `ButtonBuilder.setEmoji` (`setEmoji` throws on `''` rather than degrading). This task adds no call sites at all, so neither can be violated — unlike banners, emoji have **no orphan gate**, so an emoji with no call site is legal. Wiring these four into embeds is deliberately left to the surfaces that want them.

**viewBox note:** all 53 committed SVGs use `viewBox="0 0 64 64"` and are rendered to a **128×128** PNG by `src/build-emojis.ts`, which passes `EMOJI_SIZE = 128` to `renderSvg`. `tests/emoji-assets.test.ts:64-65` asserts the **PNG** is 128×128, which the build guarantees regardless of viewBox. These four keep `0 0 64 64` so their stroke weights and coordinates read identically to their siblings when the set is viewed together.

- [ ] **Step 1: Write the failing test**

Replace the whole 53-name array in `tests/emojis.test.ts:37-53` with the 57-name version below. The four new names sort into place by JS default (UTF-16 code-unit) order: `dw_duel` after every `dw_dino_*` and before every `dw_event_*`; `dw_guest` between `dw_goat` and `dw_hunger`; `dw_landmark` between `dw_hunger` and `dw_lot_carnivore`; `dw_season` between `dw_royal_greens` and `dw_shard`.

```ts
  it('fallback table covers exactly the 57 spec names', () => {
    expect(Object.keys(EMOJI_FALLBACK).sort()).toEqual([
      'dw_alert', 'dw_cash', 'dw_chest',
      'dw_dino_common', 'dw_dino_epic', 'dw_dino_legendary', 'dw_dino_mythic', 'dw_dino_rare', 'dw_dino_uncommon',
      'dw_duel',
      'dw_event_amber_storm', 'dw_event_blood_moon', 'dw_event_bumper_harvest', 'dw_event_clear_skies',
      'dw_event_cold_snap', 'dw_event_fossil_rush', 'dw_event_heat_wave', 'dw_event_market_panic',
      'dw_event_migration_season',
      'dw_ferns', 'dw_fish', 'dw_food', 'dw_fruit_basket', 'dw_goat', 'dw_guest', 'dw_hunger',
      'dw_landmark',
      'dw_lot_carnivore', 'dw_lot_food_court', 'dw_lot_genelab', 'dw_lot_hatchery', 'dw_lot_herbivore', 'dw_lot_visitor',
      'dw_prime_steak', 'dw_quest',
      'dw_rarity_common', 'dw_rarity_epic', 'dw_rarity_legendary', 'dw_rarity_mythic', 'dw_rarity_rare', 'dw_rarity_uncommon',
      'dw_royal_greens', 'dw_season', 'dw_shard', 'dw_site_abyssal_trench', 'dw_site_amber_ridge', 'dw_site_coastal_dig',
      'dw_site_containment_site', 'dw_site_founders_park', 'dw_site_frozen_cliffs', 'dw_site_volcano_core',
      'dw_star', 'dw_streak',
      'dw_trait_care', 'dw_trait_combat', 'dw_trait_income', 'dw_trait_meta',
    ]);
  });
```

Add this alongside it, in the same `describe('emojiTag', ...)` block, so the four new fallbacks are pinned by value and not only by name:

```ts
  it('the four utility icons fall back to unicode when no map is loaded', () => {
    expect(emojiTag('dw_guest')).toBe('👥');
    expect(emojiTag('dw_season')).toBe('🏅');
    expect(emojiTag('dw_duel')).toBe('⚔️');
    expect(emojiTag('dw_landmark')).toBe('🗿');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emojis.test.ts -t "fallback table covers exactly the 57 spec names"`
Expected: FAIL — `AssertionError: expected [ 'dw_alert', 'dw_cash', …53 items ] to deeply equal [ 'dw_alert', 'dw_cash', …57 items ]`, with the diff showing `- 'dw_duel'`, `- 'dw_guest'`, `- 'dw_landmark'`, `- 'dw_season'` missing from the actual value.

Run: `npx vitest run tests/emojis.test.ts -t "the four utility icons fall back to unicode when no map is loaded"`
Expected: FAIL — `AssertionError: expected '' to be '👥'` (`emojiTag` returns `''` for a name absent from `EMOJI_FALLBACK`).

- [ ] **Step 3: Author the four SVGs**

Create `assets/emojis/svg/dw_guest.svg` — two park visitors, the near one teal, the far one gold, both drawn body-then-head so each head overlaps its own shoulders:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- Every gradient here sits on a circle or a path. Under the bundled resvg an
       objectBoundingBox gradient on an <ellipse> renders solid black, so the only
       ellipse in this file is the flat white gloss. -->
  <defs>
    <linearGradient id="gback" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd48a"/><stop offset="1" stop-color="#d1892b"/></linearGradient>
    <linearGradient id="gfront" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd6ea"/><stop offset="1" stop-color="#2f7fa8"/></linearGradient>
  </defs>
  <path d="M34 59 V50 a 12 13 0 0 1 24 0 V59 Z" fill="url(#gback)" stroke="#6b430a" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="46" cy="28" r="8" fill="url(#gback)" stroke="#6b430a" stroke-width="3"/>
  <path d="M6 59 V48 a 17 19 0 0 1 34 0 V59 Z" fill="url(#gfront)" stroke="#0f4a63" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="23" cy="20" r="10.5" fill="url(#gfront)" stroke="#0f4a63" stroke-width="3"/>
  <ellipse cx="19" cy="16" rx="4.5" ry="2.6" fill="#ffffff" opacity="0.4" transform="rotate(-25 19 16)"/>
</svg>
```

Create `assets/emojis/svg/dw_season.svg` — a ribboned medal whose face carries three stacked gold chevrons, the season ladder's rungs. Ribbon tails are drawn first so the medal disc overlaps them:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="gmedal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b79bf0"/><stop offset="1" stop-color="#5a34a8"/></linearGradient>
    <linearGradient id="gribbon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb2e8"/><stop offset="1" stop-color="#2f5fa8"/></linearGradient>
  </defs>
  <polygon points="22,42 11,60 21,56 26,61 32,46" fill="url(#gribbon)" stroke="#1b3a63" stroke-width="2.5" stroke-linejoin="round"/>
  <polygon points="42,42 53,60 43,56 38,61 32,46" fill="url(#gribbon)" stroke="#1b3a63" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="32" cy="28" r="23" fill="url(#gmedal)" stroke="#33206b" stroke-width="3"/>
  <polygon points="32,11 45,24 39,24 32,17 25,24 19,24" fill="#ffdf7e" stroke="#7a5a10" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="32,22 45,35 39,35 32,28 25,35 19,35" fill="#ffdf7e" stroke="#7a5a10" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="32,33 45,46 39,46 32,39 25,46 19,46" fill="#ffdf7e" stroke="#7a5a10" stroke-width="2" stroke-linejoin="round"/>
  <ellipse cx="20" cy="16" rx="7" ry="3.2" fill="#ffffff" opacity="0.3" transform="rotate(-25 20 16)"/>
</svg>
```

Create `assets/emojis/svg/dw_duel.svg` — a disc split blue/red for the two duellists with a gold clash bolt struck through it. The blue base is a plain `<circle>` and only the red half is an arc path, so a single arc is the whole risk surface:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="gblue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc0ea"/><stop offset="1" stop-color="#2f5fa8"/></linearGradient>
    <linearGradient id="gred" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0908a"/><stop offset="1" stop-color="#c0271a"/></linearGradient>
  </defs>
  <circle cx="32" cy="32" r="27" fill="url(#gblue)"/>
  <path d="M32 5 A 27 27 0 0 1 32 59 Z" fill="url(#gred)"/>
  <circle cx="32" cy="32" r="27" fill="none" stroke="#2b2233" stroke-width="3"/>
  <ellipse cx="20" cy="17" rx="8" ry="3.5" fill="#ffffff" opacity="0.3" transform="rotate(-25 20 17)"/>
  <polygon points="37,4 25,30 32,30 27,60 43,32 35,32 45,4" fill="#ffdf7e" stroke="#6b430a" stroke-width="2.5" stroke-linejoin="round"/>
</svg>
```

Create `assets/emojis/svg/dw_landmark.svg` — a stone obelisk with a gold capstone and plaque on a two-step plinth:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="gshaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcd6c8"/><stop offset="1" stop-color="#7d766a"/></linearGradient>
    <linearGradient id="gbase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9b2a2"/><stop offset="1" stop-color="#5f594e"/></linearGradient>
  </defs>
  <polygon points="32,3 41,20 23,20" fill="#ffdf7e" stroke="#7a5a10" stroke-width="2.5" stroke-linejoin="round"/>
  <polygon points="24,20 40,20 43,47 21,47" fill="url(#gshaft)" stroke="#3f3a32" stroke-width="3" stroke-linejoin="round"/>
  <rect x="16" y="47" width="32" height="7" rx="1.5" fill="url(#gbase)" stroke="#3f3a32" stroke-width="3"/>
  <rect x="9" y="54" width="46" height="7" rx="2" fill="url(#gbase)" stroke="#3f3a32" stroke-width="3"/>
  <rect x="28.5" y="27" width="7" height="14" rx="2" fill="#ffdf7e" stroke="#7a5a10" stroke-width="2"/>
  <rect x="26.5" y="24" width="3" height="16" rx="1.5" fill="#ffffff" opacity="0.3"/>
</svg>
```

- [ ] **Step 4: Render the PNGs and check nothing else moved**

Run: `npm run build-emojis`
Expected: `Rendered 57 emoji PNGs to assets/emojis/png/.`

Then run: `git status --porcelain assets/emojis/png`
Expected: exactly four lines, all untracked:

```
?? assets/emojis/png/dw_duel.png
?? assets/emojis/png/dw_guest.png
?? assets/emojis/png/dw_landmark.png
?? assets/emojis/png/dw_season.png
```

`build-emojis` re-renders **every** SVG in the directory, not only the new ones. If any of the 53 existing PNGs shows as ` M`, its bytes changed because the renderer moved (`@napi-rs/canvas` went 1.0.5 → 1.0.7 in PR #37, after these PNGs were last built), not because its SVG changed. Restore those and only those — `assets/emojis/manifest.json` hashes the exact PNG bytes, so shipping a byte-different-but-visually-identical PNG makes `deploy-emojis` delete and recreate that emoji with a new snowflake id, and every message already posted with the old `<:dw_cash:ID>` tag renders broken:

```bash
git checkout -- $(git diff --name-only assets/emojis/png)
```

- [ ] **Step 5: Add the four fallbacks**

In `src/core/emojis.ts`, insert one line into `EMOJI_FALLBACK` immediately after the `dw_event_migration_season: '🧬',` line and before the closing `};`:

```ts
  dw_guest: '👥', dw_season: '🏅', dw_duel: '⚔️', dw_landmark: '🗿',
```

`⚔️` also backs `dw_trait_combat`, and duplicate fallbacks are already normal in this table — `🏛️` backs both `dw_lot_visitor` and `dw_site_founders_park`, `🦕` backs four keys, `❄️`, `🔥` and `🧬` back two each. The fallback only has to read sensibly on its own surface, not be unique.

- [ ] **Step 6: Update the machine-checked doc counts**

`tests/docs-assets.test.ts:14-19` scrapes `/(\d+)\s+(?:custom |application )?emojis/g` from **both** `docs/ops.md` and `docs/assets/prompts.md` and asserts every hit equals the number of committed SVGs. There are three hits today, all `53`.

In `docs/ops.md:64`, replace both numerals on that one line:

```
   This uploads the 57 custom emojis to the bot's Discord application and writes `assets/emojis/manifest.json` (emoji name → sha256 of the uploaded PNG). **Commit that file right away.** If it goes missing, the next `deploy-emojis` run sees every hash as changed and deletes + recreates all 57 emojis with new snowflake IDs — every message already posted with an old `<:dw_cash:ID>` tag then renders as a broken emoji, silently and with no way to recover it by rerunning. This is the only irreversible live write in the deploy; run it once, after the code is built, before starting the bot.
```

In `docs/assets/prompts.md:1412`, replace the opening line of the `## Emoji icons` section:

```
The 57 application emojis in `assets/emojis/` are **not** generated — they are
```

Then append this table to the end of the `## Emoji icons` section — after the `dw_event_migration_season` row at `:1447`, before the `## Bot branding (animated avatar and banner)` heading. The count word is spelled out ("four") deliberately: a digit before "emojis" or "banners" would be picked up by one of the two `docs-assets` regexes and asserted against a file count it does not describe.

```markdown
**Utility icons** — four hand-authored icons for the attendance, season, duel and landmark surfaces:

| File | Design intent | Unicode fallback |
| --- | --- | --- |
| `dw_guest.svg` | Two park visitors on transparency, near figure teal and far figure gold, each a domed-shoulder torso path with its head circle drawn over it so the two shapes read as one silhouette; a single flat white gloss on the near head | 👥 |
| `dw_season.svg` | A violet medal disc on two blue ribbon tails, its face carrying three stacked gold chevrons — the season ladder's rungs. Ribbons are drawn first so the disc overlaps them | 🏅 |
| `dw_duel.svg` | A disc split blue on the left and red on the right for the two duellists, with a gold clash bolt struck through it overshooting the rim top and bottom. Distinct from `dw_event_amber_storm`'s amber bolt, which sits on a single-tone storm-blue badge behind a cloud | ⚔️ |
| `dw_landmark.svg` | A grey stone obelisk with a gold capstone and a gold plaque, standing on a two-step plinth — the prestige ladder's monument, matching the `park/landmark-a\|b\|c.webp` tile family | 🗿 |
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/emojis.test.ts tests/emoji-assets.test.ts tests/docs-assets.test.ts`
Expected: PASS. In particular `emoji-assets` now runs its `it.each` over 57 SVGs — each new one must clear the 128×128 check, the four transparent corners, the opaque-centre check, and `blackCount / opaqueCount < 0.02`. `svg files exactly match the fallback-table names` passes because the four SVGs and the four `EMOJI_FALLBACK` keys landed together.

- [ ] **Step 8: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass. `tests/contract.test.ts` must still report **29** commands — this task changes no builder, which is what keeps `deploy-commands` out of the release.

- [ ] **Step 9: Commit**

```bash
git add assets/emojis/svg/dw_guest.svg assets/emojis/svg/dw_season.svg assets/emojis/svg/dw_duel.svg assets/emojis/svg/dw_landmark.svg \
        assets/emojis/png/dw_guest.png assets/emojis/png/dw_season.png assets/emojis/png/dw_duel.png assets/emojis/png/dw_landmark.png \
        src/core/emojis.ts tests/emojis.test.ts docs/ops.md docs/assets/prompts.md
git commit -m "Add four utility emoji for guests, seasons, duels and landmarks

Hand-authored SVG rendered to committed 128px PNGs by build-emojis, taking
the set from 53 to 57. Every gradient sits on a circle, rect, polygon or
path: an objectBoundingBox gradient on an ellipse renders solid black under
the bundled resvg, so the only ellipses here are flat white gloss shapes.
No outline uses pure black, keeping each PNG under the 2% black ceiling
tests/emoji-assets.test.ts enforces.

Updates the emoji counts docs/ops.md and docs/assets/prompts.md quote, which
tests/docs-assets.test.ts checks against the committed SVG count."
```

---

### Task 19: The seventeen-module adversarial sweep

**Files:**
- Create: `docs/superpowers/plans/2026-08-18-sweep-findings.md`
- Modify: nothing. **This task runs a review; it edits no source, no test and no other doc.** The proof of that is a gate step below.
- Test: none added. `npx vitest run` is run only as an unchanged-baseline check.

**Interfaces:**
- Consumes: the whole tree at the branch head — all 17 modules under `src/modules/`, `src/core/`, and the 111 test files under `tests/`. Nothing from Task 18 is required; this task is independent of the art work and could run in parallel with it.
- Produces: `docs/superpowers/plans/2026-08-18-sweep-findings.md` — the sole input to Task 20. Every finding in it carries an `id` of the form `S<n>` (`S1`, `S2`, …), a `file:line`, a `Verdict:` line reading exactly `CONFIRMED` or `KILLED`, and for confirmed findings a `Class:` naming one of the eight dimensions and a `Gate:` line reading exactly `no` or `yes — <reason>`. Task 20 iterates the `CONFIRMED` findings in document order.

**The eight dimensions.** Fan out by defect class, not by module — these classes cut across modules, and every one is grounded in a defect this repo has actually shipped. Copied verbatim from the spec's **Hardening sweep** section:

1. **Stale customIds.** A durable Discord message holding a live button minted for a different state. This class charged 32× its own label on `park:landmark:buy`. Sweep every customId that omits the rung, page, tier or amount it acts on.
2. **Interaction lifecycle.** Reply-once, defer-before-`editReply`, ephemeral answers committed to public messages, and the acknowledge-before-render ordering both visiting surfaces depend on.
3. **Payload object sharing.** One `MessagePayload` reaching two send sites; presence or absence of an `attachments` key — mandatory for `fightFrames`, forbidden for `alertPayload`.
4. **Derived-vs-stored drift.** Escrow locks, quest progress, season points, attendance. Specifically: high-water marks that can move backwards, and read paths that write.
5. **`adminReset` / `adminFastForward` table coverage.** This repo has been bitten twice, on `breedings` and again on `trades`. Every table a feature reads must be covered by reset.
6. **Numeric edges.** `Math.max` over an empty array, seedless `reduce`, per-level array indexing past the end, anything that can put `NaN` into an embed.
7. **Transaction boundaries.** `track()` inside the action's own transaction; commit-before-present in the fight pipeline.
8. **Authorization.** Owner checks on customIds — and the inverse: `park:tour` and `top:visit` take a **target** id deliberately and must never gain one.

**Verification standard.** Every candidate finding is adversarially verified by **three independent refuters, and a majority kills it.** Each refuter is given the candidate and the surrounding code and is asked to prove the finding wrong — not to grade it. Two or three refuters agreeing the code is correct means the finding is `KILLED` and does not reach the document's confirmed list. The verify pass is stricter than the find pass on purpose: the triage decision for this release is **fix everything confirmed**, so a false positive is expensive — it would force a change to correct code, in a release whose whole point is that it carries no migration.

**Release gate.** If a confirmed defect requires a migration or a balance retune, **it becomes its own task and is named a release gate.** It does not silently expand into the art work, and it is not downgraded to keep the release moving. Name it in the document's `Gate:` line and in the summary table, and stop — do not begin the fix inside this task or inside Task 20.

**Already confirmed, and out of scope here.** The spec's pre-flight pass confirmed two defects with executable probes, both in guests: **F1** (`src/modules/guests/index.ts:35` — `/guests view` is a read path that writes, and can revoke `/trade`) and **F2** (`src/modules/park/attendance.ts:34` — `attendanceHighWater` banks phantom attendance from escaped dinos). Both are fixed by Tasks 1–2 of this plan. Do not re-report them. **F3** is latent with zero impact today (PR #36 added `attractions_built` to `STATS` mid-season, so `season_progress` rows minted 2026-08-14 to 2026-08-17 carry no baseline for it; no `SEASON_SOURCE` reads that stat) — record it in the document's **Latent** section so it is not rediscovered as a bug, and do not fix it.

- [ ] **Step 1: Enumerate the surfaces each dimension has to cover**

These are the enumerations, not the analysis. Run each and keep the output — the findings document cites counts from them so a later reader can tell a complete sweep from a partial one.

```bash
# Dimension 1 — every minted customId and every handler prefix.
grep -rn "setCustomId(" src/ | sort
grep -rn "prefix: '" src/modules/ | sort

# Dimension 2 — every acknowledgement call, per module.
grep -rn "i\.reply(\|i\.deferReply(\|i\.deferUpdate(\|i\.editReply(\|i\.followUp(\|i\.update(" src/modules/ | sort

# Dimension 3 — every payload builder and every send site that could share one object.
grep -rn "attachments" src/ | sort
grep -rn "files:" src/ | sort

# Dimension 4 — every high-water column and every writer reachable from a read path.
grep -rn "HighWater\|legacyRankBest\|questStreakBest\|badgeAt" src/ | sort

# Dimension 5 — every table in the schema, against the two admin functions.
grep -n "sqliteTable(" src/core/db/schema.ts | sort
grep -n "schema\." src/modules/admin/service.ts | sort

# Dimension 6 — indexed reads and reduces.
grep -rn "\.reduce(\|Math\.max(\.\.\.\|Math\.min(\.\.\." src/ | sort
grep -rn "levelValue\|\[level - 1\]\|\[lvl - 1\]" src/ | sort

# Dimension 7 — track() call sites against their enclosing transaction.
grep -rn "track(ctx" src/ | sort
grep -rn "db\.transaction(" src/ | sort

# Dimension 8 — owner checks.
grep -rn "i\.user\.id !==\|i\.user\.id ===" src/modules/ | sort
```

Expected: a non-empty result for every one of the nine greps. An empty result means the idiom moved and the enumeration is wrong, not that the dimension is clean — re-derive the pattern before continuing.

- [ ] **Step 2: Run the find pass, one dimension at a time across all 17 modules**

For each of the eight dimensions, read every surface the Step 1 enumeration produced for it and record every candidate defect with `file:line`. Do not filter for plausibility yet — the verify pass in Step 3 is what filters. A candidate needs three things written down before it moves on, and a candidate that cannot supply all three is not a candidate:

1. `file:line` of the defect.
2. A concrete failure scenario with **inputs**: the exact fixture state (which rows, which column values, which `setNow`), the exact interaction or call, and the exact wrong output or wrong stored value it produces. "Could be wrong under some conditions" is not a scenario.
3. Why the current tests miss it — name the test file and the line whose assertion is too weak, or state that no test covers the path at all.

The two pre-flight findings are the calibration bar for what a scenario looks like: F1 is *"8 herbivore species, one L1 paddock, `setNow(20h)`, no other action: stored rating **215 before `/guests view`, 137 after**"*, and F2 is *"12 species, `setNow(30 days)`, three `/guests build` dispatches and nothing else: high-water **300 → 317**"*. Both name the state, the action, and the two numbers.

- [ ] **Step 3: Run the verify pass — three independent refuters per candidate**

For each candidate from Step 2, obtain three independent refutations. Each refuter reads the candidate and the surrounding code cold and argues the code is **correct** — that the scenario is unreachable, that a guard upstream already prevents it, that the value is re-derived before use, or that the stated inputs cannot co-exist. Record each refuter's verdict.

- Two or three refuters say "not a defect" → `Verdict: KILLED`. Record it in the document's **Killed** section with the refutation that carried it, so the same candidate is not re-raised next sweep.
- Two or three refuters fail to refute → `Verdict: CONFIRMED`.

A confirmed finding must additionally survive an executable probe where one is cheap — a throwaway vitest file under the scratchpad that reproduces the stated numbers with `makeCtx`. Both pre-flight findings were reproduced this way, and the numbers in their write-ups came from the probes rather than from reading. Delete the probe afterwards; the durable version of it is the regression test Task 20 writes.

- [ ] **Step 4: Write the findings document**

Create `docs/superpowers/plans/2026-08-18-sweep-findings.md` with exactly this structure. The `Gate:` line is what Task 21 reads to decide whether the release shape changed.

```markdown
# Sweep findings — art coverage and hardening pass

Adversarial sweep over all 17 modules, fanned out by defect class rather than by
module. Every candidate was verified by three independent refuters; a majority
refutation kills it. The triage decision for this release is to fix everything
confirmed, which makes a false positive expensive, so the verify pass is stricter
than the find pass.

**Baseline:** `main` @ `23bb1cf` — 17 modules, 29 commands, 111 test files.
**Pre-flight findings F1 and F2 are fixed by tasks 1-2 and are not repeated here.**

## Summary

| id | class | file:line | gate |
|---|---|---|---|
| S1 | stale customId | src/modules/<module>/index.ts:<line> | no |

## Release gate

<Either: "No confirmed defect requires a migration or a balance retune. The
release shape is unchanged and task 21 proceeds as specified." — or a named gate
task per defect that does, with what it needs and why it cannot fold into the
art work.>

## Confirmed

### S1 — <one-line statement of the defect>

**Class:** <one of the eight dimensions>
**Location:** `src/modules/<module>/index.ts:<line>`
**Verdict:** CONFIRMED (refuters: 0 of 3 refuted)
**Gate:** no

**Failure scenario.** <Exact fixture state: which rows with which column values,
which setNow, which interaction or call. Then the exact wrong output or wrong
stored value, with both numbers.>

**Why current tests miss it.** <Named test file and line whose assertion is too
weak, and what it asserts instead — or a statement that no test reaches the path.>

**Refutation attempts.** <One line per refuter: what each argued and why it
failed to hold.>

## Killed

### K1 — <candidate statement>

**Location:** `src/<path>:<line>`
**Verdict:** KILLED (refuters: 2 of 3 refuted)
**Why it is not a defect.** <The refutation that carried it. Recorded so the same
candidate is not re-raised by the next sweep.>

## Latent

### L1 — `attractions_built` has no baseline on season rows minted 2026-08-14 to 2026-08-17

PR #36 added `attractions_built` to `STATS` mid-season, so `season_progress` rows
minted in that window carry no baseline for it and `pointsFrom` would credit the
whole lifetime counter. No `SEASON_SOURCE` reads that stat, so the impact today is
exactly zero. It becomes real only if a future season source uses a `StatId` added
after live rows existed. Recorded, not fixed.

## Coverage

<Per dimension: what was enumerated and how many surfaces were read, so a later
reader can tell a complete sweep from a partial one.>
```

- [ ] **Step 5: Prove this task changed no code**

Run: `git status --porcelain`
Expected: exactly one line — `?? docs/superpowers/plans/2026-08-18-sweep-findings.md`. Anything under `src/` or `tests/` means a fix leaked into the review task; move it to Task 20 and revert it here.

Run: `npm run typecheck && npx vitest run`
Expected: all pass, unchanged from the branch baseline. This is a no-op confirmation, not a gate on new work.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-08-18-sweep-findings.md
git commit -m "Record the findings of the seventeen-module hardening sweep

Fans out by defect class rather than by module across stale customIds,
interaction lifecycle, payload object sharing, derived-versus-stored drift,
admin reset and fast-forward table coverage, numeric edges, transaction
boundaries and authorization. Every candidate was verified by three
independent refuters with a majority refutation killing it, and killed
candidates are recorded alongside confirmed ones so the next sweep does not
re-raise them.

Changes no source and no test: the fixes land one commit each in the next
task, test first."
```

---

### Task 20: Fix every confirmed finding — one failing test, one fix, one commit each

**Files:**
- Modify: one source file per confirmed finding, at the `file:line` its entry in `docs/superpowers/plans/2026-08-18-sweep-findings.md` names.
- Modify: `docs/superpowers/plans/2026-08-18-sweep-findings.md` — each finding's entry gains a `**Status:** fixed by this commit` line, edited in the **same commit** as its fix. No commit sha is recorded: it cannot be known before the commit exists, and `git log --oneline -- docs/superpowers/plans/2026-08-18-sweep-findings.md` recovers it in one command.
- Test: one regression test per confirmed finding, added to the module's **existing** test file — `tests/park.test.ts`, `tests/guests.test.ts`, `tests/battles.test.ts`, `tests/trading.test.ts`, `tests/daily.test.ts`, `tests/duels.test.ts`, `tests/leaderboards.test.ts`, `tests/admin.test.ts` and so on. Create a new test file only when the finding is in a module that has none.

**Interfaces:**
- Consumes: `docs/superpowers/plans/2026-08-18-sweep-findings.md` from Task 19 — specifically each `CONFIRMED` entry's `Location:`, `Failure scenario.` (which supplies the regression test's fixture and its two numbers) and `Why current tests miss it.` (which supplies the test file to extend and the assertion to strengthen).
- Produces: no new exported symbol. Every fix is behavioural, inside an existing function, and no signature changes — a signature change would ripple into the art tasks, which is exactly what the release gate exists to surface instead.

**Procedure.** The findings are not known when this plan is written, so what is specified is the procedure, exactly:

1. **Work the confirmed list in document order** (`S1`, `S2`, …). Order does not encode severity; it encodes only that every finding is worked and none is skipped.
2. **Skip any finding whose `Gate:` line is not `no`.** A finding needing a migration or a balance retune is its own task, named a release gate in Task 19's document. It does not get fixed here, and it is not downgraded to keep the release moving. If any exists, stop at the end of this task and raise it before Task 21 runs.
3. **One finding, one commit.** Never batch two findings into one commit, even when they touch the same file: the regression test and the fix have to be reviewable and revertable as a pair.
4. **Test first, always.** Write the regression test from the finding's *Failure scenario* verbatim — same fixture rows, same `setNow`, same interaction — and assert the **correct** value. Run it and watch it fail **with the wrong value the finding predicted**. A test that fails for any other reason (a typo, a missing fixture row, a thrown error) is not yet the regression test: fix the test until its failure message reads as the finding's own numbers. A test nobody has watched fail in the way the finding describes is not yet a test.
5. **Assert on exact values, never substrings of numbers.** `toContain('5,000,000')` is satisfied by `'15,000,000'` just as happily. Pin the field value with `toBe`, or pin the stored column with `toBe`.
6. **Fix minimally.** Change the behaviour the finding names and nothing else. Do not refactor adjacent code, do not rename, do not "while I'm here". The comment at the fix site records the **why** — the failure the guard prevents — not the what.
7. **Never weaken an existing test to make the fix pass.** If an existing test now fails, either the fix is wrong or that test encoded the defect; if it encoded the defect, update it in the same commit and say so in the commit body.
8. **Run the full gate before every commit** — `npm run typecheck && npx vitest run` — not only the one test file. Several of these dimensions (payload sharing, high-water drift, reset coverage) have assertions spread across unrelated test files.
9. **`tests/contract.test.ts` must still report 29 commands after every commit.** A fix that changes a builder changes the release shape: it forces `npm run deploy-commands`, which Task 21 states is not run. Treat it as a gate and raise it rather than absorbing it.

- [ ] **Step 1: Read the confirmed list and check the gate**

Run: `grep -n "^### S\|^\*\*Gate:\*\*\|^## Release gate" docs/superpowers/plans/2026-08-18-sweep-findings.md`
Expected: one `### S<n>` heading and one `**Gate:**` line per confirmed finding. Every `Gate:` line reads `no`. If any reads `yes — …`, stop here, raise the gate task, and do not proceed to Task 21 until it is resolved.

- [ ] **Step 2: Worked template — the exact shape of one fix commit**

The shape below is taken from the **already-shipped** `park:landmark:buy` fix, which is in the tree today and is this repo's canonical example of a dimension-1 defect. It is here as the shape to copy, with real code from real files — **do not re-apply it**; that defect is already fixed. Substitute your finding's file, its scenario and its numbers.

The finding read: *`src/modules/park/index.ts` — the buy button's customId was `park:landmark:buy:<uid>`, carrying no tier, and the handler answered with `i.reply`. A `/park landmark` message is durable and its label is never re-derived, so one button labelled "Build Stone Marker" stayed live forever while `buyLandmark` re-derived `current + 1` on every click.*

**Step 2a — the failing regression test.** Added to the module's existing test file, `tests/landmarks.test.ts`, using that file's own fixture idiom (`makeCtx` + `getOrCreateUser` in `beforeEach`, and the file's local `click` helper that drives the real component handler):

```ts
// THE finding this branch exists for. Pre-fix the customId carried no tier and the handler
// answered with i.reply, so the original message kept its "Build Stone Marker" label and a
// live button forever while buyLandmark re-derived current+1 on every click: four clicks of
// that one button charged 5,000,000 + 10,000,000 + 20,000,000 + 40,000,000 = 75,000,000,
// 32x the label, with no refund path anywhere in the feature.
it('honours one button once: four clicks of the tier-1 button charge 5,000,000 in total', async () => {
  ctx.db.update(schema.users).set({ cash: 100_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
  for (let n = 0; n < 4; n++) await click('park:landmark:buy:u1:1');
  const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
  expect(row.landmarkTier).toBe(1);
  expect(row.cash).toBe(95_000_000);           // pre-fix: 25,000,000
});
```

Note the two properties every regression test here needs: the assertion is on the **stored column** with `toBe`, not a substring of rendered text, and the comment records the pre-fix number (`25,000,000`) so a later reader can tell what red looked like.

**Step 2b — watch it fail with the predicted number.**

Run: `npx vitest run tests/landmarks.test.ts -t "honours one button once"`
Expected: FAIL with `AssertionError: expected 25000000 to be 95000000` — the finding's own number, not a crash and not a different number.

**Step 2c — the minimal fix.** Two edits, both in the file the finding named. The customId gains the state it acts on, and the handler validates it — owner check first, then the rung, then any read or write:

```ts
// customId is park:landmark:buy:<userId>:<tier> — five parts, so the owner id sits
// at index 3 (not the outer destructure's `uid`, which caught 'buy' there) and the
// rung the button OFFERED at index 4.
//
// The tier is checked, not trusted, and that check is the actual guard against a
// stale button: a /park landmark message is never refreshed by anything else, so its
// label stays frozen on the rung it was minted for while buyLandmark re-derives
// current+1 fresh on every click. Four clicks of one button labelled "Build Stone
// Marker" charged 5,000,000, 10,000,000, 20,000,000 and 40,000,000 — 32x its own
// label, and there is no refund path. The i.update on success is a second layer
// only: another open message still holds a stale button.
const [, , , landmarkUid, tierStr] = parts;
if (i.user.id !== landmarkUid) { await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral }); return; }
// tierStr is CLIENT-supplied. Number('') is 0 and Number(undefined) is NaN, so a
// truncated or forged customId is rejected here rather than reaching buyLandmark.
const offered = Number(tierStr);
if (!Number.isInteger(offered) || offered < 1 || offered > MAX_LANDMARK_TIER) {
  await i.reply({ content: 'That landmark button is no longer valid — run `/park landmark` again.', flags: MessageFlags.Ephemeral });
  return;
}
```

**Step 2d — green, then the full gate.**

Run: `npx vitest run tests/landmarks.test.ts -t "honours one button once"`
Expected: PASS.

Run: `npm run typecheck && npx vitest run`
Expected: all pass, `tests/contract.test.ts` still at 29 commands.

**Step 2e — mark the finding fixed, in the same commit.** Add one line to that finding's entry in the findings document:

```markdown
**Status:** fixed by this commit
```

**Step 2f — commit, test and fix together.**

```bash
git add src/modules/park/index.ts src/modules/park/embeds.ts tests/landmarks.test.ts \
        docs/superpowers/plans/2026-08-18-sweep-findings.md
git commit -m "Carry the landmark tier in the buy button's customId

A /park landmark message is durable and its label is never re-derived, so a
button minted for tier 1 stayed live while buyLandmark re-derived current+1
on every click: four clicks of one button labelled Build Stone Marker charged
75,000,000 against a 5,000,000 label, with no refund path in the feature.

The customId now carries the rung it was minted for and the handler rejects
any offered tier that is no longer current+1, checked after the owner check
and before any read or write. Refreshing the clicked message with i.update is
a second layer only — another open message still holds a stale button, so the
tier check is what actually protects the purchase.

Regression test drives four clicks of the same tier-1 customId and pins the
resulting cash column exactly."
```

- [ ] **Step 3: Repeat Step 2's six sub-steps for each remaining confirmed finding**

One finding at a time, in document order. Each produces exactly one commit containing: the regression test, the source fix, and the `**Status:** fixed by this commit` line in the findings document. Do not move to the next finding until the current one's full gate is green.

- [ ] **Step 4: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Verify every confirmed finding is closed**

Run: `grep -c "^\*\*Status:\*\* fixed by this commit" docs/superpowers/plans/2026-08-18-sweep-findings.md`
Run: `grep -c "^\*\*Verdict:\*\* CONFIRMED" docs/superpowers/plans/2026-08-18-sweep-findings.md`
Expected: the two counts are equal. A shortfall means a finding was skipped; the only legitimate skip is a `Gate: yes` finding, which must not have been in the confirmed list to begin with.

Run: `git log --oneline main..HEAD -- src/ tests/ | wc -l`
Expected: at least one commit per confirmed finding. Two findings sharing a commit violates the one-finding-one-commit rule and makes the pair unrevertable.

---

### Task 21: Release — full verification gate, then the operator runbook

**Files:**
- Modify: `assets/emojis/manifest.json` — rewritten by `npm run deploy-emojis` in step 5 below, committed in step 6. This is the only file this task changes, and it is changed by a tool, not by hand.
- Test: none added. The gate is the existing suite.

**Interfaces:**
- Consumes: everything from tasks 1–20 — the two guests defect fixes, `dinoImage`, the asset gates, the six banners, the six attraction bands, the eight hero portraits, the four emoji from Task 18, and every fix from Task 20.
- Produces: a deployed release. No code artifact.

**`deploy-commands` is NOT run, and here is why.** No task in this plan changes a command builder. The proof is mechanical, not a promise: `tests/contract.test.ts` asserts the serialized builder body has exactly **29** entries and `tests/registry-load.test.ts` asserts 17 modules and 29 commands. Both are green in the gate below. `HELP_TOPICS` gained art on existing topics but **no new topic key** — adding a key would change `/help`'s builder choices and would force a redeploy; adding a field to an existing topic's value does not. Running `deploy-commands` anyway is not free: it re-PUTs the guild command set and, in a dev guild, is a live write.

**Assets can never be hot-added.** `assetImage` caches `existsSync` per path for the process lifetime, so a running bot that already resolved a path as missing will never see the file appear. New art always requires a restart. This is why step 7 is mandatory rather than advisory.

- [ ] **Step 1: The full verification gate**

Run: `npm run typecheck`
Expected: PASS with no output. This is the test-inclusive gate — `tsc --noEmit -p tsconfig.test.json`, which extends `tsconfig.json` and adds `tests` and `scripts` to `include`. `npm run build` covers only `src` and vitest transpiles without typechecking, so a type error in a test file passes both and only this catches it.

Run: `npx vitest run`
Expected: all pass. Specifically confirm in the output:
- `tests/contract.test.ts` — "every builder serializes" green, i.e. still 29 commands. **This is the proof that `deploy-commands` is unnecessary.**
- `tests/registry-load.test.ts` — 17 modules, 29 commands.
- `tests/images.test.ts` — the banner check fires in both directions (a wired call site with no committed file, and a committed banner with no call site), and every file under `assets/images/` is `.webp`.
- `tests/emoji-assets.test.ts` — 57 SVG/PNG pairs, each 128×128, transparent-cornered, opaque-centred and under the 2% pure-black ceiling.
- `tests/docs-assets.test.ts` — the emoji counts in `docs/ops.md` and `docs/assets/prompts.md` equal the committed SVG count, and the banner count in `docs/assets/prompts.md` equals the committed banner count.

Run: `npm run build`
Expected: PASS. The bot runs compiled `dist/`, so this must be green before anything is deployed.

Run: `git status --porcelain`
Expected: empty. Everything is committed before the operator runbook begins.

- [ ] **Step 2: Operator step 1 — render the emoji PNGs**

Run: `npm run build-emojis`
Expected: `Rendered 57 emoji PNGs to assets/emojis/png/.` and, from `git status --porcelain assets/emojis/png`, **no** modified files — Task 18 already committed all four new PNGs, so this is a confirmation that the committed bytes match what the current renderer produces.

**Why it sits first:** it must precede operator step 5 (`deploy-emojis`). `src/deploy-emojis.ts` reads only `assets/emojis/png/`, so an unrendered SVG does not exist to the deployer — a new emoji whose PNG was never written is silently absent from the upload, with no error.

- [ ] **Step 3: Operator step 2 — the gate, and the single-commit rule for art plus docs**

Already done in Step 1 above: `npm run typecheck`, the full suite, `npm run build`.

**Why it sits here:** art, PNGs, banner call sites **and** the updated doc counts have to be committed **together**. `tests/docs-assets.test.ts` fails otherwise — it scrapes the emoji and banner counts out of `docs/ops.md` and `docs/assets/prompts.md` and asserts them against the number of files actually committed, so a commit that adds a banner without touching the doc count is red, and so is the reverse.

- [ ] **Step 4: Operator step 3 — merge, pull on the host, rebuild there**

```bash
# on the host
git pull
npm ci && npm run build
```

Expected: clean install and a clean `tsc`.

**Why it sits here:** the bot runs compiled `dist/`, so the host needs its own build. Assets themselves are never compiled or copied — every path resolves from the process working directory at runtime, which is why the systemd unit sets `WorkingDirectory` to the repo root. A new banner forces a `src` change anyway (the orphan check in `tests/images.test.ts` demands a call site), and the new `ParkArt` attraction family certainly does, so there is always something to compile.

- [ ] **Step 5: Operator step 4 — back up the database**

Back up the live DB per standing practice, using the online-backup command rather than copying the file out from under a running process.

**Why it sits here:** before the first irreversible write and before the restart, and after the host build so a failed build never reaches this point. **No migration ships in this release** unless the Task 19 sweep forced one — if it did, that finding was named a release gate and is its own task, and this step is the one that matters most.

- [ ] **Step 6: Operator step 5 — deploy the emoji**

Run: `npm run deploy-emojis`
Expected: `Emojis synced: 4 created, 0 replaced, 53 unchanged (57 local).`

**Why it sits here — this is the one irreversible live write in the deploy.** `assets/emojis/manifest.json` hashes the exact PNG bytes, so a rerun only touches what changed; that is what makes the `53 unchanged` in the expected output the important half of the line. A non-zero `replaced` count means existing emoji were deleted and recreated with new snowflake ids, and every message already posted with an old `<:dw_cash:ID>` tag now renders broken. If that happens, stop and work out which PNG bytes moved before continuing.

- [ ] **Step 7: Operator step 6 — commit `manifest.json` immediately**

```bash
git add assets/emojis/manifest.json
git commit -m "Record the emoji manifest after deploying the four new icons"
git push
```

**Why it sits here, and why "immediately" is literal:** the manifest is written in a `finally` in `src/deploy-emojis.ts`, so it exists even after a partial or failed run and must be committed **even then** — a partial run's manifest is the only record of which emoji already uploaded. A lost manifest makes all 57 emojis look changed and delete-and-recreates every one, invalidating every emoji already rendered in every posted message, silently, with no way to recover it by rerunning.

- [ ] **Step 8: Operator step 7 — restart the bot**

```bash
sudo systemctl restart dino-world
```

Expected: the log line `Loaded 57 application emojis`.

**Why it sits here, and why it is mandatory — three independent reasons, any one of which alone would require it:**
1. Park rasters preload once at worker boot, so the six new attraction bands and the ground art are only picked up by a fresh worker.
2. `assetImage` caches per-path existence for the process lifetime, so a process that already resolved a new banner's path as missing will never see the file appear.
3. The emoji map is fetched once at `ClientReady`, so a process running through step 6 keeps the old ids.

Verify on the `Loaded 57 application emojis` line specifically — `Logged in as …` proves only that the gateway connected, and the emoji count is what proves step 6 landed and was picked up. Run exactly **one** bot process per token: duplicate instances produce 10062 on every command, which reads as a code bug and is not one.

- [ ] **Step 9: Operator step 8 — `test:live`, last**

Run: `npm run test:live`
Expected: `~59 ok, 0 failed. Cosmetic review: check <#TEST_CHANNEL_ID> in the dev guild.`

Needs all six of these set in `.env` — `scripts/test-live.ts:39` exits 1 naming the first missing one:

```
DISCORD_TOKEN
DISCORD_CLIENT_ID
DATABASE_PATH
OWNER_ID
DEV_GUILD_ID
TEST_CHANNEL_ID
```

**Why it sits last, and not anywhere else:** it parity-asserts `assets/emojis/manifest.json` against the live application-emoji list (`scripts/test-live.ts:69-73`), so running it before step 6 reports every new emoji as `manifest emoji 'dw_guest' missing on Discord` — a failure that means only "you ran this too early". It is REST-only — it never calls `client.login`, so it is safe to run while the bot is live — but it re-PUTs the dev guild's command set with **all modules forced on**, which makes it that guild's last command writer. Anything that wants a different command set in that guild has to run after it.

**This is the acceptance check for an art release.** Roughly 59 cases post their real embeds, components and attachments to `TEST_CHANNEL_ID`, and it is the only surface that puts human eyes on the new art. Walk the channel and confirm, specifically: each of the six new banners renders on its own embed rather than as a bare attachment card; the six attraction bands read against the lot plates on the park map rather than fighting them for attention; and all eight hero portraits show their rarity rim light with a hard specular edge and no halo or clipped glow — a degraded portrait is worse than the shared archetype art it replaced, and deleting the file restores the previous behaviour with no code change.

- [ ] **Step 10: Confirm the release is closed**

Run: `git status --porcelain`
Expected: empty — `manifest.json` was committed in Step 7.

Run: `git log --oneline -5`
Expected: the manifest commit at `HEAD`, on the merged branch, pushed.

No further operator steps. `deploy-commands` was not run and was not needed; `deploy-branding` is unrelated to this release and is not run.
