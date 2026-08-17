# Spec 4e — Park guests: attendance as a second progression axis

Dino World is a park simulator with no visitors. It ships a *Visitor Center*
facility, a park rating, a decor catalog and a landmark ladder — and nobody ever
walks through the gate. Income is abstract per-dino accrual. The genre's core
loop, *build an attraction → draw a crowd → be rewarded for it*, is the one
shape the game does not have.

This spec adds it, and deliberately adds it as a **gate rather than a faucet**.

- **Attendance** — guests per hour. Derived at read time, never stored, never
  integrated over time. A frozen-target function of roster variety, attractions
  and the Visitor Center.
- **`users.attendanceHighWater`** — one monotone integer, the same shape as
  `ratingHighWater`, gating a new build catalog.
- **Attractions** — a new table of **cash-priced** buildings whose rungs unlock
  on attendance. They raise attendance; they earn no currency.
- **Milestones** — one-time reward claims as the high-water climbs.
- **One new command**, `/guests`, in a new 17th module, and an eighth `/top`
  metric — the first board a collection-focused park can win.
- Migration **0017**: one new column and two new tables. No column drop, no
  CHECK addition, no table recreate.

Every balance figure in §9 is marked as measured or as pending the
implementation measurement pass. The 4d pass overturned four hand-computed
figures from its own spec; hand-computed values here are hypotheses.

---

## 1. Why guests, and why not the four alternatives

The campaign is walled. Chapters 1–7 ship, the boss of chapter 7 sits exactly on
`NPC_LEVEL_SANITY_CAP` with zero headroom, and the gate ladder is spent — rating
950 of a saturable 1000, then a star gate at 80 of a maximum 105. An eighth
chapter needs a new gate kind (an engine change) and cannot escalate difficulty,
so it would escalate on theme and reward alone, for the second chapter running.

**More species** is the cheapest possible ship — data-only, no engine, no new
art, since art is keyed on `archetype × diet` and fixed at 8 images. Rejected
because 4a did exactly this and the returns are visibly diminishing.

**More park depth** (a fifth facility kind, deeper paddocks, more decor tiers)
is constrained by `PARK_TARGET`, frozen at 40 and already saturable on lot
levels alone. Anything new there is powerless by construction for the parks that
would want it most.

**A ticket currency** was the design this spec started as, and §2 records why it
did not survive contact with the codebase.

Guests win because the game already contains every input the system needs and
uses none of them for this purpose: a Visitor Center that only moves income, a
species roster of 52 whose breadth nothing rewards, a decor catalog, a park
renderer with a grid, and a leaderboard module with seven metrics that all
reward the same build.

---

## 2. The pivot: a gate, not a currency

The first version of this design had attendance mint a **ticket** currency on
the existing Collect button, spent on attractions. It was rejected during the
recon pass, and the reasoning is recorded here because it is the most
transferable thing in this document.

**2.1 The stated justification for tickets was wrong.** The argument was that a
separate currency protects `accruedIncome` (`src/core/clock.ts:119-166`), whose
piecewise integration over the comfort knee, every UTC midnight and the world
event multiplier is the most load-bearing math in the repo. But a ticket
rectangle computed as `attendance × YIELD × min(elapsed, capHours)` lives
*outside* that function, which neither reads nor returns attendance. Tickets
never protected `accruedIncome`; they protected nothing.

**2.2 A currency forces attendance to be integrated, and integrating a set is
the expensive part.** `accruedIncome` is cheap because income is a **sum over
dinos**: each dino gets its own `dinoEnd` clamp and its own breakpoint list, and
the totals add. A distinct-species count is a **set cardinality** — not additive
over dinos — so it cannot be clamped per dino and summed. Integrating it exactly
needs a global breakpoint list with a set recomputation per segment. The
constraint is decomposability, not time-variance.

**2.3 Sampling attendance once at collect time is the exact anti-pattern this
codebase eliminated.** `clock.ts:158-160` says it verbatim: *"Sample the
multiplier at the segment's START instant — never at the request time. Reading
`eventMods(now).income` here is the bug this whole structure exists to
prevent."* A retroactive attendance sample is that bug, for a term that moves
**~10×** where the world multiplier moves 1.2×. The concrete exploit: bank a
full 24-hour window, hatch stockpiled eggs and assign them to jump distinct
species from 8 to 30, then click Collect and have the whole window pay at the
boosted rate.

**2.4 The gate has none of these problems, structurally.** A high-water mark is
read at an instant and compared to a threshold. Nothing is integrated, so §2.2
and §2.3 both evaporate. A burst-assign raises a high-water — which is precisely
what `ratingHighWater` already does and is accepted design.

**2.5 The compounding loop closes itself.** Attractions raise attendance;
attendance unlocks attractions; attractions cost **cash**; attendance produces
**no cash**. The loop's output is not its own input, so it is bounded by a
finite catalog and by cash, with no tuned constant defending it. A ticket
economy had no such property — the spec would have owed a cap and a number to
defend it.

**2.6 What the pivot costs.** There is no *collect tickets* moment — no number
going up on a button every few hours. The milestone claims in §6 recover part of
it, but they land a handful of times across a whole progression rather than
every session. That is a real product cost, accepted deliberately.

Two facts about the endgame economy support pricing attractions in cash rather
than inventing a currency to dodge it: endgame surplus is **~94% unspent**
(≈4.29M/day income against ≈264k/day upkeep), and the implied cash value of a
ticket would have spanned **169 → 55,757 cash** across the progression — a 330×
spread, worse than the 126× spread that got `income_collected` excluded from
`SEASON_SOURCES` outright (`src/data/seasons.ts:28-31`). A currency with no
safe exchange rate and exactly one sink is a progress bar wearing a wallet's
clothes.

---

## 3. Attendance

```
speciesTerm    = min(1, distinctSpecies / ATTENDANCE_SPECIES_TARGET)
drawTotal      = Σ levelValue(ATTRACTIONS[row.kind].draw, row.level, 0)
attractionMult = 1 + min(1, drawTotal / ATTRACTION_DRAW_TARGET) × ATTRACTION_MAX_BONUS
vcMult         = levelValue(VC_ATTENDANCE_MULT, facilityLevel(lots, 'visitor_center'), 1)

attendance = round(ATTENDANCE_SCALE × speciesTerm × attractionMult × vcMult)
```

One mechanism per term, and every one of the three is clamped or table-resolved.
The attraction term is **additive in `draw`, then clamped** — that gives the
catalog real choice (kinds and levels differ in what they contribute) while
making the ceiling `ATTENDANCE_SCALE × 1 × (1 + ATTRACTION_MAX_BONUS) × max(VC)`
a closed-form expression a test can assert, rather than a number someone
maintains by hand.

Derived on every read, stored never — the same philosophy as escrow locks
(`src/core/locks.ts`), quest progress and world events. Nothing sweeps, nothing
drifts.

**3.1 The dino predicate is not new.** A dino attends iff
`d.paddock !== null && d.escapedAt === null`. That is **byte-identical** to
`recomputeRating`'s `assigned` filter (`src/modules/park/rating.ts:18`), and it
must stay a copy of that predicate rather than a fresh one. It reads the
**stored** `escapedAt` column, not the computed `escapeAt` instant; every
surface that renders attendance already calls `settleEscapes` first
(`snapshot.ts:33`, `visit.ts:68`, both collect sites), so the stored column is
fresh where it is displayed. `/top` and autocomplete providers do not settle,
and attendance shown there may lag by one escape — accepted, and noted in §11.

**3.2 The species target is FROZEN.** `ATTENDANCE_SPECIES_TARGET` is a written
literal and must **never** become a live count over `allSpecies()`. This is the
exact mirror of `COLLECTION_TARGET` (190), frozen because a live denominator
taxes every existing player each time a species ships. Here the hazard is in the
numerator: an unclamped live distinct-species count means every future species
raises everyone's attendance and retroactively cheapens every threshold already
set. The `min(1, …)` clamp is what makes new species *alternate paths* to the
same target rather than inflation.

**3.3 `ATTRACTION_DRAW_TARGET` is frozen for the same reason as the species
target**, and the two clamps are the only things standing between a growing
catalog and silent inflation of every threshold already shipped.

**3.4 Every table lookup goes through `levelValue`.** Both the per-kind `draw`
arrays and `VC_ATTENDANCE_MULT` resolve through `levelValue`
(`src/modules/park/service.ts:57`), never a raw index — `tsconfig` has `strict`
but **not** `noUncheckedIndexedAccess`, so an off-the-end read yields
`undefined`, and `undefined` poisons attendance with `NaN` invisibly to both
`npm test` and `npm run typecheck`. This is the defect class that once rendered
the literal text "Collect NaN". `levelValue`'s fallback is the identity for each
term: `0` draw for an unknown attraction kind, `1` for a park with no Visitor
Center, so a missing row degrades rather than throwing — the same tolerance
`matchedKindCount` gives a retired decor slug.

**3.5 What attendance must NOT read.**

| Excluded | Why |
|---|---|
| `users.landmarkTier` | Reading it converts a deliberately powerless cosmetic sink into a power ladder — the exact inversion `src/data/landmarks.ts` was designed to prevent. Machine-gated: `tests/landmarks.test.ts:51-55` is a closed allowlist of files that may mention the identifier, failing in **both** directions. |
| hunger / comfort | Continuous in time. Attendance is a gate, and a gate that moves every millisecond has no stable threshold. |
| world events, season | Reopens every stacking question 4d closed. A season carries no modifiers, deliberately. |
| `parkRating` | Attendance would then be a re-skin of rating rather than a second axis. |

**3.6 Attendance is a genuinely different axis, and this is the whole point.**
All 5 legendary and all 3 mythic species are carnivores, so the cash-maximal
64-slot build holds exactly **5 distinct species**, while a diversity build
holds **49** — roughly **10×** on attendance against **~2.4×** the other way on
cash (measured: 6,690,816/day cash-maximal versus 2,731,386/day for the
49-species build). The richest park by cash is deliberately not the best park by
attendance.

---

## 4. Storage — migration 0017

All additive. No column drop, no CHECK addition, therefore **no table
recreate** and none of the `foreign_keys` bracket hazard.

| Change | Shape |
|---|---|
| `users.attendance_high_water` | plain `ALTER TABLE … ADD`, integer, default 0, **no CHECK constraint** |
| `attractions` | `id`, `userId` → users, `kind`, `level`, `builtAt` |
| `attendance_claims` | `userId` → users, `milestone`, `claimedAt`; unique on `(userId, milestone)` |

**4.1 No CHECK, deliberately.** SQLite's `ALTER TABLE` grammar has no
`ADD CONSTRAINT` clause, so *no tool* can add a CHECK to an existing table
without a full recreate. `drizzle/0003_tricky_zuras.sql` is the proof: its only
schema delta versus 0002 is the `energy_nonneg` CHECK — the column lists in the
two snapshots are byte-identical — and drizzle-kit still emitted
`CREATE __new_users` → copy → `DROP TABLE users` → rename. That recreate would
be far heavier today (23 columns and 18 FK child columns across 16 tables,
versus 13 columns when 0003 ran). `users.duelRating` is the shipped precedent
for declining a CHECK (`src/core/db/schema.ts:45-46`). A high-water mark is
monotone and never decremented, so there is no underflow to guard.

**4.2 `adminReset` must delete both tables and zero the column.** There is no
every-table assertion anywhere in the suite — every `adminReset` check in
`tests/admin.test.ts` is hand-written per feature, and the closest thing to a
rule is a comment. The repo has shipped this defect four separate times
(`breedings`, then `user_stats`/`daily_quests`/`achievement_claims`, then
`season_progress`/`season_claims`, then `alerts_sent`/`species_seen`). A
surviving `attractions` row after a wipe leaves a fresh account with permanent
attendance and unlocked catalog rungs against a park with no dinos and no lots.

**4.3 `adminFastForward` shifts nothing here, and that is a recorded decision.**
`builtAt` is history, not a due-time — the `species_seen.first_at_ms` precedent
(`src/modules/admin/service.ts:142`). A high-water is a balance, like cash. If a
future attraction gains a build or upgrade **cooldown**, that timestamp *must*
shift, which is the omission that once made fast-forwarded breedings look stuck.

---

## 5. Attractions

A catalog in `src/data/attractions.ts`: six kinds, three levels each, each with
its own per-level `draw` array, priced in **cash**, each rung gated on
`attendanceHighWater` the way
`lotSlots(highWater)` gates lot slots (`src/data/progression.ts:25-27`).

Attractions live in their own table with their own slot pool rather than as a
third `lots.type`. `lots.type` carries no SQL CHECK, so widening the enum would
have needed no migration at all — but `recomputeRating` sums
`l.level + l.decor.length` over **all** lots with no type filter
(`src/modules/park/rating.ts:16`), so attractions-as-lots would silently gain
rating power on a backwards curve: worth ~8.75 rating to a mid-game park and
exactly 0 to a saturated one. That is the argument that kept landmarks off the
decor catalog, and the separate table makes the power-freedom **structural**
rather than a filter someone must remember.

Constraints on the catalog module:

- **No `emojiTag` in any module-level constant.** The emoji map loads after
  client ready, so module init would freeze the unicode fallback permanently.
  `DECOR`, `FACILITIES` and `LANDMARKS` all avoid this; a new catalog is exactly
  where it slips.
- **Any purchase button carries what it buys.** The customId is
  `guests:build:<uid>:<kind>:<level>`, validated after the owner check and
  before any read or write. This is the `park:landmark:buy` lesson, where a
  customId omitting the tier let one button labelled "Build Stone Marker" charge
  5M, then 10M, then 20M, then 40M — 32× its own label.
- **The slot pool is finite and gated on a quantity attractions cannot buy.**
  Attendance gates slots; attractions raise attendance; but the catalog is
  finite and every rung costs cash, so the ceiling is
  `Σ levelValue(draw, maxLevel) × slots` — computable in a test rather than
  asserted as a magic constant.

---

## 6. Milestones

Crossing an `attendanceHighWater` threshold unlocks a one-time claim paying
eggs, food and modest shards. Claims are **explicit**, recorded in
`attendance_claims`, matching `/season` and `/achievements` rather than
auto-paying — a read path must never mint. The unique `(userId, milestone)`
constraint is the idempotency backstop.

Milestones are what stop attendance from being a number that only goes up. They
are also what make the diversity build pay for itself before the leaderboard
does.

---

## 7. One new stat

Add exactly one `StatId`: **`attractions_built`**.

Without it the feature is invisible to the entire retention loop — quests,
achievements, the season ladder and `/top season` are driven exclusively by
`track()` into `user_stats`. The cost is named and real: it moves
`tests/stats.test.ts:8`'s pinned `toHaveLength(18)` to 19, and interacts with
`tests/season.test.ts:59` ("freezes EVERY StatId") and
`tests/season-content.test.ts`'s `FINITE_STATS` list. Per the standing rule,
`track()` sits **inside** the build's own transaction — a rolled-back build must
never count.

No season source and no quest is added in this spec. The counter exists so a
later content drop can reference it without a migration.

---

## 8. Surface

**8.1 `/guests`** is the 17th module and takes commands from 28 to **29**.
Subcommands: `view` (attendance, its three terms broken out, the catalog and
what the next rung needs), `build`, and `claim` for milestones.

**8.2 The park card** gains an attendance field. Note it becomes **public**:
`visitPayload` forwards `dashboardPayload`'s embeds wholesale and rebuilds only
`components`. That is intended here — attendance is a prestige number, unlike
shards, which are deliberately invisible to avoid a public wealth display. No
test pins the dashboard field count, so this decision is recorded rather than
enforced.

**8.3 An eighth `/top` metric.** This is the point of the feature as much as the
catalog is: it is the first board a 49-species collection park can win and a
5-species cash-maximal park cannot. `tests/leaderboards.test.ts` pins the exact
`.select()` count per metric through a counting Proxy at two roster sizes and
both scopes, plus an ordered seven-metric equality that becomes eight. The
attendance read must be `memberIds`-scoped with an `[]` short-circuit, or the
zero-member guild case fails.

**8.4 The park PNG.** Attraction cells append **after** the landmark cell, with
the count driven by data so that zero attractions renders byte-identically to
today. Anywhere earlier moves two independently-written pixel pins
(`tests/render-draw.test.ts:241`, `tests/render-park-art.test.ts:179`). There
must be **no unconditional build slot** for attractions — that changes the
shared fixture's row count. The new `ParkSnapshot` field is **optional**: a
required one fails only `npm run typecheck`, not `build` or `test`, and six
`as never` casts in the render tests would not error at all. Anything
attraction-derived that appears on the PNG is computed in `buildParkSnapshot`,
never inside `renderParkPng`, which is contractually clock-free and pure in its
two arguments. Any new art family in `ParkArt` is exhaustively null-initialised
in `EMPTY_ART` and guarded at every draw site — `drawImage(null)` throws and
costs the whole park image.

---

## 9. Balance

Measured, from the shipped tables:

| Anchor | Value |
|---|---|
| `incomePerHr` by rarity | 60 / 150 / 400 / 1,100 / 3,000 / 9,000 |
| Whole 10-lot park build | **4,299,000** cash (≈1 day of reference surplus) |
| Landmark ladder, all six rungs | **315,000,000** cash (47–73 days) |
| Endgame income | 4,561,920/day reference; 6,690,816/day income-maximal |
| Endgame upkeep | ≈264,480/day — **~94% of income is unspent** |
| Season track, whole 30 days | 60,000 cash and 110 shards total |

Attractions sit between the park build and the landmark ladder: a full catalog
costing roughly **10–20 days of surplus** (≈43M–86M). Milestone shard payouts
stay well under the season track's 110-per-season ceiling.

**Pending the implementation measurement pass**, and to be derived by simulation
against the real tables rather than by hand: `ATTENDANCE_SCALE`,
`ATTENDANCE_SPECIES_TARGET` (working value 40, intended to saturate near a
diversity build and not near a casual one), `ATTRACTION_DRAW_TARGET`,
`ATTRACTION_MAX_BONUS`, the `VC_ATTENDANCE_MULT` array, each kind's per-level
`draw` array, the slot thresholds, every catalog price, and every milestone
threshold and payout.

---

## 10. Registration and test gates

Registering the module touches **six sites, not the five CLAUDE.md names** — a
`HELP_TOPICS` key is builder data (`src/modules/help/index.ts` feeds
`Object.keys(HELP_TOPICS)` into `.addChoices(...)`), so adding one changes the
`/help` builder and forces `npm run deploy-commands`:

1. `modules.json` — the key must equal `ModuleManifest.name` **exactly**; a
   mismatch silently disables the module in production and passes the entire
   suite.
2. `src/core/module-list.ts` — import plus `ALL_MODULES` entry.
3. `tests/registry-load.test.ts` — 16 → 17 modules and 28 → 29 commands.
4. `tests/config.test.ts` — `guests: true` in an exact `toEqual`.
5. `tests/contract.test.ts:52` — 28 → 29. **CLAUDE.md's `:49` is stale.** Plus
   an `AUTOCOMPLETE_OPTIONS` entry for any option setting `.setAutocomplete(true)`;
   the manifest is bidirectional.
6. `src/modules/help/index.ts` — the `HELP_TOPICS` key.

Also required, none covered by a test: `docs/ops.md`'s written-out module count,
its module bullet list, its per-module smoke-check list and its hardcoded "28
commands deployed"; `README.md`'s written-out help-topic count.

New tests this spec owes:

- attendance is byte-identical for a park with zero attractions before and after
  the migration;
- the species term clamps, and adding a species to the roster fixture does not
  move a saturated park's attendance;
- an over-range attraction level clamps through `levelValue` rather than
  producing `NaN`;
- `adminReset` leaves no `attractions` or `attendance_claims` rows and a zeroed
  high-water;
- a stale `guests:build` customId for a rung that is no longer offered is
  rejected before any write;
- milestone claims are idempotent under a repeated click;
- zero attractions renders a byte-identical park PNG;
- a journey case in `tests/journeys.test.ts` covering build → attendance rise →
  milestone claim.

`scripts/test-live.ts` calls `execute` directly and never routes, so any
`/guests` gallery case must call whatever a router hook would have called, by
hand, following the three existing precedents.

---

## 11. Accepted risks

- **Attendance on `/top` and in autocomplete may lag by one escape**, since
  neither path calls `settleEscapes`. Settling there would turn "escapes are
  only settled when a command touches your park" into a lie and would let a
  board render mutate other players' rows.
- **An escrowed dino still attends.** `locksFor` covers dinos and eggs, and a
  dino in a pending trade or an unclaimed breeding remains paddocked with
  `escapedAt === null`. This matches the battles precedent — battling an
  escrowed dino is legal because it neither consumes nor transfers — but it does
  mean a trade in flight moves a progression axis.
- **Attendance is world-event-blind** where cash is not. Deliberate: attendance
  is a gate, and a gate that moves with the calendar has no stable threshold.
- **Retiring an attraction `kind` silently drops every park relying on it**,
  the same standing hazard `DECOR` already carries. A retired kind reads as a
  non-match rather than throwing, so a park's attendance falls with no error and
  no record of what changed. Because `attendanceHighWater` is monotone, unlocked
  rungs survive — which is the safe direction.

---

## 12. Out of scope

No new chapter, site or species. No change to `accruedIncome`, `recomputeRating`,
`PARK_TARGET`, `COLLECTION_TARGET`, or any existing balance figure. No ticket
currency and no conversion between attendance and cash in either direction — §2
records why no fixed rate can be safe. No season source and no quest referencing
`attractions_built`; the counter ships unused on purpose.
