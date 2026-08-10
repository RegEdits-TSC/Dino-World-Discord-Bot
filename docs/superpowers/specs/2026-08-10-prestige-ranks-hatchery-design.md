# Prestige, Legacy Ranks, and the Hatchery — design

Spec 2b, the second half of the Depth & Endgame roadmap entry. A cash sink large
enough to matter, an earned rank that recognises breadth rather than wealth, and
the Hatchery's last two levels.

Baseline: `main` at `3412026` — 2a (`ec9b03f`) plus four dependency commits.
94 test files, 1327 tests, typecheck clean. **Branch from `3412026`, not
`ec9b03f`**, or the first merge replays the dependency bumps.

## 1. Why

A maxed park earns **4,561,920 cash/day** and spends **264,480** of it — food plus
about 1.5 legendary eggs. **94.20% of endgame income has nowhere to go**, and the
entire purchasable contents of the game total **1,674,000**, which is 8.81 hours of
that income. 2a built the depth; it did not build anywhere for the money to land.

Two things must be true of whatever fills that gap, and they pull against each
other:

- **It cannot add power.** More income feeds the surplus it is meant to drain.
- **It cannot pay through habitat fit.** 2a's enrichment ladder caps at 1.10
  because past `fit × drainMult > 1.5` a dino sits at comfort 0 earning nothing
  while its 8-hour grace runs out. `tests/enrichment.test.ts` bounds that dead
  window at 30 minutes against a measured 25.4545, leaving **4.5455 minutes of
  headroom**; the trip point is a cap above 1.1111. A fourth rung at 1.15 measures
  45.217 minutes and fails the gate. The +0.05-for-5,000,000 prime tile that 2a's
  §15 sketched **cannot ship**.

So the sink pays in **status**, and status is what a rank is for. That makes 2b one
feature rather than three: a ladder you buy, a rank you earn, and — since the
Hatchery is the one facility whose ceiling is genuinely limiting — two more levels
of throughput.

### A correction to the 2a spec

2a states that Hatchery L4–L5 "moves maximum lot levels 38 → 40 … destroying the
current property that at least two decor pieces are mandatory for 10.0★", and gives
that as the reason the sink and the Hatchery had to ship together. **That property
does not exist.** `buildLot` blocks duplicate *facilities* only
(`src/modules/park/service.ts:77`) and exempts paddocks (`:72-76`), so with
`lotSlots` 10 a player can already build **VC L5 + 9 paddocks L4 = parkRaw 41**
against `PARK_TARGET` 40. The park term has always been saturable on lot levels
alone, with zero decor. 38 is the maximum of one particular build, not of the game.

Consequences: the stated dependency between the two items is void (they ship
together here because they are both endgame content, not because one gates the
other), and §17's decision to leave the decor-spam purchase alone gains a better
justification than the one 2a gave it.

### Roadmap context

| Part | Theme | Status |
| --- | --- | --- |
| 1a | The Living World | shipped 2026-08-07 |
| 1b | The Park Speaks First | shipped 2026-08-08 |
| 2a | Habitat Enrichment & The Dex | shipped 2026-08-09 |
| 2b | Prestige, Legacy Ranks, and the Hatchery | **this spec** |
| 3 | The Server Is A Park — exhibition duels, rich park visits | last, needs a crowd |

## 2. Design decisions

1. **The sink is a six-rung ladder, not one purchase.** 5M / 10M / 20M / 40M / 80M /
   160M, **315,000,000 total** — roughly 73 days of the reference park's surplus
   (315,000,000 / 4,297,440 per day) and about 48 days at the income-maximal enriched
   build, which drains it FASTER because it earns more, against a game whose entire existing
   purchasable content is 1,674,000. A single 5,000,000 item is **1.16 days of
   surplus**; it would not drain anything.
2. **It lives on a `users` column, not in `lots.decor`.** `recomputeRating` sums
   `l.level + l.decor.length` (`src/modules/park/rating.ts:16`) — a flat length, no
   filter and no weight. A decor-shaped "cosmetic" item would therefore be worth
   **+8.75 rating per tile** to a player below saturation and **exactly 0** to a
   maxed park: power for the mid-game, nothing for the endgame, precisely inverted.
   *Also rejected on the same route:* `tests/data.test.ts:54` requires every `DECOR`
   entry to carry a biome tag, so "cosmetic = no biome" is currently illegal, and a
   real tag would feed `matchedKindCount`; `/decorate`'s item autocomplete has **2
   rows of headroom** against the 25-choice cap, ordered by declaration, so the most
   expensive item in the game would be first to truncate out of the list.
   *Rejected as a `lots` row:* it consumes a lot slot (worth 691,200 cash/day at the
   income-max build), takes `level` default 1 for another free 8.75 rating, and
   **crashes `upgradeLot`** — `PADDOCKS[lot.kind].buildCost`
   (`src/modules/park/service.ts:107`) is a TypeError for a kind in neither table,
   and `/upgrade`'s autocomplete filters by owner but not by type
   (`src/modules/park/index.ts:196-205`), so it would actively offer the crashing row.
   A `users` column is the only shape where power-freedom is **structural rather than
   remembered**: nothing in `rating.ts`, `clock.ts`, `lotSlots` or `matchedKindCount`
   reads it, so there is no line anyone can forget to filter.
3. **A monotone integer ladder needs no refund path.** 2a deferred the refund
   question here, on the grounds that a 5,000,000 misclick would be the most
   expensive irreversible mistake in the game. A ladder dissolves it: the only legal
   purchase is the *next* rung, so there is nothing to mis-buy. This is the second
   reason to prefer a column over a catalog of purchasable objects.
   **Corrected during the final review:** that reasoning is sound for `buyLandmark`
   and unsound for the *button*. A Discord message is durable and its label is never
   re-derived, so a customId of `park:landmark:buy:<uid>` with an `i.reply` handler
   left one "Build Stone Marker" button live forever while `buyLandmark` advanced
   underneath it — four clicks charged 5,000,000 / 10,000,000 / 20,000,000 /
   40,000,000, 32x the label, with no refund path to undo it. The rung now travels in
   the customId (`park:landmark:buy:<uid>:<tier>`) and is validated against the live
   tier after the owner check and before any read or write; `i.update` refreshing the
   clicked message is a second layer, not the guard, since other open messages still
   hold stale buttons. Any future button that spends money carries the same
   obligation.
4. **The rank is derived from breadth, and never from wealth.** `dexProgress` (42)
   + `earnedTierCount` (48) + `battle_progress.stars` (90) = 180 points. All three
   are monotone, ceilinged, readable in one query each, and — critically — complete
   for legacy accounts.
   *Rejected: the 18 `user_stats` counters as the basis*, which is what 2a assumed.
   Migration `0006_daily_loop.sql:37-58` backfilled only **6 of 18**; the other
   twelve, including `dinos_fed`, `eggs_hatched` and `battles_fought`, start at 0 for
   every pre-0006 account and are unrecoverable. A rank spanning them would
   **under-rank the oldest players** — the exact inversion the feature exists to
   prevent.
   *Rejected: `income_collected`*, the only `'sum'` stat, which grows at the rate
   this spec is trying to drain and would rank cash velocity.
   *Rejected: `ratingHighWater`*, which already gates lot slots, sites, chapters, the
   shop ceiling and the mythic unlock; coupling prestige to it re-imports every one
   of those consequences.
   *Rejected: `users.createdAt`*, which has zero readers, survives `adminReset`, and
   is the one signal `adminFastForward` cannot shift — so a high rank would have no
   QA path at all.
5. **Hatchery L4–L5 is real slot power, said out loud.** The sink adds no power;
   these levels do. That is deliberate: endgame legendary egg supply is about
   **6.43/day** (3.80 shop + 0.63 expedition + 2.00 breeding) against **3 slots/day**
   at L3, so incubator slots are the binding constraint and the only facility ceiling
   that is actually felt.
6. **`PARK_TARGET` does not move.** Raising it to compensate for anything is a
   retroactive rating cut that runs through `TRADE_MIN_RATING` 400, checked against
   the droppable stored `parkRating` at both trade creation *and* accept — so a drop
   also kills pending trades sitting in a recipient's inbox. The drop is maximised at
   exactly `parkRaw` 40: raising the target to 80 costs **−175 rating** there and
   revokes `/trade` for everyone in [400, 575). 2a already declined a change causing
   a 41.67–50 point drop for this reason; this would be 3.5× worse.
7. **The bounds guard ships before the level bump, as its own commit.**

## 3. Architecture

Three independent additions, sharing only the park dashboard:

```
users.landmarkTier ──→ src/data/landmarks.ts (LANDMARKS ladder)
   │                        │
   │                        ├─→ /park landmark  (view + buy)   park/index.ts
   │                        └─→ landmarkArt band → ParkSnapshot.landmarkTier?
   │                                                  └─→ draw.ts extra grid cell
   │
   └─→ dashboardPayload opt (field)

legacyRank(ctx, userId) ──→ src/modules/park/ranks.ts   [DERIVED, nothing stored]
   ├── dexProgress(ctx, userId).seen        src/modules/dex/service.ts
   ├── earnedTierCount(ctx, userId)         src/modules/daily/service.ts
   └── battle stars                          battle_progress
   └─→ dashboardPayload opt (field) + /dex list footer

FACILITIES.hatchery_lab maxLevel 3 → 5 ──→ incubatorSlots(lots)  hatchery/service.ts
   (behind a bounds guard that ships first)
```

`legacyRank` is a pure read over three existing tables, in the spirit of `locksFor`
and `questProgress`: nothing is stored, so nothing can drift, and `adminReset`
needs no new delete because all three underlying tables are already covered.

The landmark is the opposite kind of thing — a record of a purchase, so it is
stored, and `adminReset` must zero it.

## 4. The landmark ladder

`src/data/landmarks.ts`:

| Tier | Name | Cost | Art band |
| --- | --- | --- | --- |
| 1 | Stone Marker | 5,000,000 | a |
| 2 | Fossil Plinth | 10,000,000 | a |
| 3 | Bronze Sentinel | 20,000,000 | b |
| 4 | Amber Obelisk | 40,000,000 | b |
| 5 | Grand Rotunda | 80,000,000 | c |
| 6 | Titan Monument | 160,000,000 | c |

Total **315,000,000**. Three art bands rather than six so the monument visibly
grows twice without six generated rasters.

**Purchase rules.** `buyLandmark(ctx, userId)` charges the cost of tier
`current + 1` through `ctx.economy.apply` inside one transaction and increments the
column; it refuses at tier 6 and refuses on insufficient funds with the existing
`InsufficientFundsError`. There is no tier argument — the only legal purchase is the
next rung, which is what removes the misclick surface. Cost is quoted through one
source, per the standing rule that every price a surface displays and every price it
charges come from the same place — **as built, that source is `LandmarkDef.cost` read
off the single frozen table, not a `landmarkCostFor(tier)` wrapper.** The wrapper shipped
and then had no `src/` caller: no world event scales the ladder, so there is no
multiplier for a helper to centralise, and every surface needs the rung's *name* too and
therefore already holds the def. It was removed in the final review rather than given a
contrived caller.

**Surface.** `/park landmark` with no options: it shows the current tier, its name,
the next tier and its price, and a buy button. The button carries the owner id **and
the rung it offers** and is owner-locked before any read or write, following the `ach`
prefix precedent for ownership and the `hatch:crack:<eggId>` precedent for the state
— see §2.3's correction for why the tier is not optional.
Prices render through `toLocaleString('en-US')` — both existing decor surfaces print
raw (`${d.cost}`), which is tolerable at 400 and unreadable at 160,000,000.

**`/park`'s dispatch becomes a real switch.** Today it is one `=== 'rename'` check,
one `=== 'alerts'` check, then an unguarded fallthrough that *is* the view path, so a
deployed-but-unimplemented subcommand renders the dashboard and reports success.
2a documented that trap and 2b would walk straight into it. The new subcommand lands
behind an explicit switch whose default replies with an ephemeral error.

## 5. PNG visibility

The season wiring is the template, and the only one that has already paid for the
worker-boundary invariants.

- **`ParkSnapshot.landmarkTier?: number`** — optional, stamped only in
  `buildParkSnapshot`, exactly as `season` is. Optional is not a style choice: the
  snapshot is pinned `structuredClone`-able and two hand-built `ParkSnapshot`
  literals plus two `ParkArt` literals in the render tests break on a *required*
  field, and only `npm run typecheck` would catch it.
- **`ParkArt.landmarks: Record<'a'|'b'|'c', Image | null>`**, exhaustively
  null-initialised in `EMPTY_ART` like `dinoChips`, loaded inside `loadParkArt`'s
  existing single `Promise.all`. **Never a second top-level await in `worker.ts`**: a
  rejected worker module boot fires the client's error handler, which terminates and
  nulls the worker, so every later `/park view` silently loses its image and respawns
  another doomed one — permanently, for every player, until restart. A source regex
  test pins this.
- **Draw it as an extra grid cell after the last lot**, following the build-slot
  pattern. This breaks **zero** pinned pixel assertions: the seven hardcoded samples
  across two render test files all read `(10, 240)`, six pixels inside the bottom pad
  of the 1-row 882×254 canvas, and every existing tile keeps its coordinates. Do not
  grow the canvas by a band and do not touch the HUD — a fourth HUD chip does not fit
  even as a single letter (54.14px of slack at the realistic escape-text case against
  46px of chip chrome plus 13.20px for `"V"`), and the coin's scan box is recomputed
  from the `0.46` start constant and the chip order, so any reflow fails it.
- Each art site needs its **own** non-null guard: `drawImage(null)` and
  `drawImage(undefined)` both throw, the worker protocol converts that to
  `{ok:false}`, and all three consumers swallow it into a text-only embed with no log.
  A missing raster degrades to the flat fill, never to a lost park image.
- `renderParkPng` stays synchronous and clock-free. The byte-identity test cannot
  actually detect a clock read — it compares two calls microseconds apart — so this
  is an invariant held by discipline. Anything time-dependent is derived in
  `buildParkSnapshot`.

Art: three WebPs at `assets/images/park/landmark-a|b|c.webp`, generated to the
existing park-raster convention. `tests/docs-assets.test.ts` checks a **hand-typed**
list of six park rasters, so a seventh passes silently — the three new entries and
their prompt rows go in by hand.

## 6. Legacy ranks

`src/modules/park/ranks.ts` exports `legacyPoints(ctx, userId)` and
`legacyRank(ctx, userId)`.

```
points = dexProgress(ctx, userId).seen        // 0-42,  42 species
       + earnedTierCount(ctx, userId)          // 0-48,  12 tracks x 4 tiers
       + battleStars(ctx, userId)              // 0-90,  6 chapters x 5 stages x 3
                                               // ceiling 180
```

| Rank | Title | Points | % of 180 |
| --- | --- | --- | --- |
| — | (unranked) | 0–14 | — |
| 1 | Groundskeeper | 15 | 8.3% |
| 2 | Keeper | 35 | 19.4% |
| 3 | Curator | 65 | 36.1% |
| 4 | Warden | 100 | 55.6% |
| 5 | Conservator | 140 | 77.8% |
| 6 | Director | 170 | 94.4% |

Front-loaded so rank 1 arrives early and Director is genuinely rare. Below 15 points
the rank field is **omitted entirely**, matching how `earnedTiers` omits at zero.

**Three queries, batched.** Each input is one query returning either a scalar or a
Set; none is per-id. Added to `/park view`, a path that already issues about twenty.

**Naming.** The word `ranks` is already taken: `/help` has a `ranks` topic about the
leaderboards, and `playerRank` and `/top`'s "Your rank: #N" both mean leaderboard
position. This axis is **Legacy**, and its tiers are titles rather than numbers, so
neither term collides. No `HELP_TOPICS` key is added — adding one changes the
deployed builder choices, and the axis is documented in prose instead.

**Displayed in exactly two places.** `dashboardPayload`'s conditional-field pattern,
passed the **target's** id on the read-only other-user branch rather than the
viewer's; and `/dex list`'s existing footer, which already reads
`N/42 seen · Page p/q`. Not the PNG HUD (no room). Not `/top`, whose `scored()`
computes its metric per user in JS and runs the full scan twice per invocation — a
rank board would be 2N queries.

## 7. Hatchery L4–L5, behind a guard that ships first

**The guard is a separate, earlier commit.** `incubatorSlots![level - 1]`
(`src/modules/hatchery/service.ts:22`) is an unguarded index, and
`incubatingCount >= undefined` evaluates to `false` — so bumping `maxLevel` to 5
while leaving `incubatorSlots` at `[1,2,3]` yields **unlimited simultaneous
incubation, silently**. `tsconfig.json` has `strict` but not
`noUncheckedIndexedAccess`, so `npm run typecheck` cannot catch it, and the existing
`toEqual([1,2,3])` pin still passes with the array left stale.

`capHours` and `breedingSlots` have the identical hole. `capHours` is the worst:
`Math.min(to, from + NaN)` poisons `accruedIncome` forever and renders a literal
**"Collect NaN"** button. All three get bounds guards, and `tests/data.test.ts` gains
the length assertions it has for `incomeBonusPct` and `upgradeCosts` but not for
these. That commit lands first, with a test that fails before it.

Then the data change:

```
hatchery_lab: maxLevel 5,
  incomeBonusPct: [0, 0, 0, 0, 0],
  incubatorSlots: [1, 2, 3, 4, 5],
  upgradeCosts:   [25_000, 150_000, 375_000, 2_250_000],
```

375,000 is the ×2.5 interior step; 2,250,000 is a ×6.0 wall, the multiple this
facility's own curve already uses. Two steps total 2,625,000 — **13.81 hours** of
reference income, so it is content rather than drainage, which is the sink's job.

Throughput this buys, at 24-hour legendary incubation: 3/day at L3, 4/day at L4,
5/day at L5, against ~6.43/day of egg supply.

**`/upgrade` starts quoting its price.** It currently quotes none anywhere — the
autocomplete label is `🏗️ #N Name (lvl N)`, success is `⬆️ Name is now level N.`,
failure is a bare `'Not enough cash.'` — and 2b puts the two most expensive upgrade
steps in the game behind that. One exported `upgradeCostFor(kind, level)` feeds the
label and the failure message. It moves two pinned label assertions in
`tests/autocomplete-park.test.ts` and needs no redeploy, since autocomplete labels
are not builder data.

## 8. Data model and migration

```
ALTER TABLE users ADD landmark_tier integer DEFAULT 0 NOT NULL;
```

Migration **0011**, additive, so no table recreate and the `migrateDb` foreign-key
bracket is not stressed. The migration test copies the recipe the file's own comment
demands: scratch directory, journal filtered to `idx <= 10`, `foreign_keys = ON`, a
seeded parent `users` row **and** a child `dinos` row, then the real `migrateDb`. An
empty-database test or a raw SQL replay passes even where the real migrator would
fail on production.

Nothing else is stored. Legacy rank adds no column and no table.

## 9. Admin

- **`adminReset` zeroes `landmarkTier`**, in the same `users` update as `cash`,
  `parkRating` and the quest columns. The lesson is recorded four separate times in
  that one function; this is progress, not consent, so it resets.
- **`adminFastForward` needs no change** — `landmarkTier` carries no timer semantics.
  Noted in its comment block so the omission reads as a decision.
- Legacy rank needs neither, since all three of its inputs already reset.

## 10. Testing

- `landmarkCostFor` at every tier boundary, at 0, and above the top.
- `buyLandmark`: charges the next tier's cost, increments by exactly one, refuses at
  tier 6, refuses on insufficient funds, and — the regression that matters — leaves
  the tier unchanged when the charge throws, since both live in one transaction.
- `/park landmark` renders the current and next tier with grouped digits; the buy
  button is owner-locked and a foreign click is rejected before any read.
- **`/park`'s switch**: an unrecognised subcommand replies with an error rather than
  rendering the dashboard. This is the trap 2a documented and nothing has ever tested.
- `legacyPoints` sums its three inputs; `legacyRank` at every threshold boundary and
  one point either side; the field is omitted below 15; the ceiling is 180 and is
  asserted against the three sources' own maxima rather than a literal, so new
  content moves it.
- The dashboard shows the **target's** rank on the other-user branch, not the
  viewer's — seeded with two players at different ranks so a swapped id fails.
- **Bounds guards**: `incubatorSlots`, `capHours` and `breedingSlots` each resolve
  sanely for a level above their array, with a test written to fail first. Plus the
  three length assertions.
- Hatchery L4 and L5 grant 4 and 5 slots, and the fourth concurrent incubation is
  refused at L3 but allowed at L4.
- `upgradeCostFor` matches `FACILITIES` for every kind and level, and the quoted
  price equals the amount actually charged.
- Migration 0011 through the real migrator, per §8.
- Renderer: a snapshot with `landmarkTier` set draws the extra cell; one without it
  produces output **byte-identical** to today's; a null art band degrades to the flat
  fill rather than throwing. The existing `(10, 240)` samples must still pass
  untouched — if one moves, the cell was placed wrong.
- `test:live` gallery: a landmark-bearing park at a high tier (seeded on the P1
  fixture, which builds 2 lots and so renders the 1-row 882×254 canvas the new cell
  must fit), `/park landmark`, and a dashboard showing a Legacy rank.

Every assertion in this spec is written to fail before its implementation. That is
not a platitude here: 2a's execution found twelve test specifications across two
plans that could not fail, and the mitigation that worked was mutating each
assertion — break the thing under test, watch it go red, revert — so every task
carries that instruction.

## 11. Documentation

- `docs/gameplay.md` gains a Landmarks section and a Legacy Ranks section — both are
  prominent enough that `commands.md` alone (2a's precedent for `/dex`) is too thin.
- It also carries a false line to fix: "**Every piece of decor you own raises your
  park rating**". That has never been true past `parkRaw` 40, and §1's correction
  makes the ceiling easier to reach than the doc implies. The "maximum of 40" line
  stays accurate, since `PARK_TARGET` does not move.
- `docs/commands.md` gains `/park landmark` and notes that `/upgrade` now quotes a
  price.
- `docs/assets/prompts.md` gains three rows for the landmark rasters.
- `CLAUDE.md` gains: why the sink is a `users` column and not decor (the flat
  `decor.length` in `rating.ts`); that a monotone ladder is what removes the refund
  question; that Legacy rank is derived and must never read `user_stats`, with the
  0006 partial-backfill reason; the three bounds guards and why `typecheck` cannot
  catch that class of bug; that `PARK_TARGET` must not move, with the trade-gate
  arithmetic; and that the park term is saturable on lot levels alone, correcting the
  2a entry.

## 12. Size

Roughly **19–22 tasks** in five groups that review independently:

| Group | Work | Tasks |
| --- | --- | --- |
| Guards | the three bounds guards, their length assertions, `upgradeCostFor` and `/upgrade`'s quoting | 3 |
| Hatchery | the data change, slot coverage, docs | 2 |
| Landmark | migration 0011, the ladder data, `buyLandmark`, `/park landmark`, the dispatch switch, `adminReset` | 6–7 |
| PNG | snapshot field, `ParkArt` band, the draw call and its guard, three rasters | 4–5 |
| Ranks | `ranks.ts`, the dashboard field, the `/dex` footer | 3 |
| Docs + gallery | `gameplay.md`, `commands.md`, `prompts.md`, `CLAUDE.md`, `test:live` | 2 |

One migration, one `deploy-commands` (the `/park` builder gains a subcommand), three
new WebPs, no emoji.

## 13. Ops checklist

1. `npm run typecheck` — the only gate covering `tests/` and `scripts/`, and it will
   **not** catch an out-of-bounds facility array index.
2. `npm test`.
3. `npm run deploy-commands` — `/park` gains the `landmark` subcommand. Command count
   stays 26. Exactly one bot process per token.
4. Restart — migration 0011 applies at boot.
5. `npm run test:live` — confirm the landmark cell renders on the P1 park.

No `deploy-emojis`: the landmark art is WebP through `loadParkArt`, deliberately not
an SVG. An SVG icon would drag in the whole app-emoji contract — the SVG directory is
asserted to equal `EMOJI_FALLBACK`'s 52 keys exactly, plus a committed 128×128 PNG,
the pixel checks, three doc count edits, and an irreversible `deploy-emojis`.

## 14. Invariants for future work

- **Never let the landmark tier reach `parkRaw`, `paddockFit`, `lotSlots` or any
  income path.** Its power-freedom is structural because no such code reads the
  column; the moment one does, it becomes a remembered filter.
- **Never move `PARK_TARGET`.** The drop is maximised at exactly the saturating
  build and revokes `/trade` through the droppable `parkRating`, at both creation and
  accept.
- **Never derive Legacy rank from `user_stats`.** Migration 0006 backfilled 6 of 18
  counters; the rest under-rank the oldest accounts.
- **Never raise `ENRICHMENT_STEPS`' cap to make a purchase pay.** The dead-window
  gate has 4.5 minutes of headroom and the trip point is 1.1111.
- **Never add a second top-level await to `worker.ts`.** A rejected boot costs every
  player their park image until restart.
- **Never index a facility level array without a bounds guard.** `typecheck` cannot
  see it; `capHours` degrades to a literal "Collect NaN" button.

## 15. Out of scope

- **The 17,600-cash decor-spam purchase of the whole park term** — 1 paddock plus 39
  grass tufts. Closing it is a retroactive rating nerf running through the `/trade`
  gate, with no removal path so affected players cannot self-correct. 2a deferred it
  here; it stays open, now on the firmer ground that §1's correction shows the term is
  saturable on lot levels anyway, so the exploit is not the only free path to 350
  points.
- **A daily-loop footprint for the sink.** `decorateLot` calls no `track()` and there
  is no decor stat, so neither does this. A `landmarks_bought` counter would need a
  new `StatId` and quest-content review for one purchase every few weeks.
- **A `/help` topic for either feature.** Adding a `HELP_TOPICS` key changes deployed
  builder choices; prose in `gameplay.md` covers it.
- **Six landmark rasters.** Three bands give two visible growth steps for half the
  art.
- **A rank on `/top` or the PNG HUD.** Both are covered above: 2N queries and no
  pixels respectively.
- **Anything from Part 3** — exhibition duels, rich park visits, wider leaderboards.
