# Park progression

Fires on: the park's derived numbers and the data behind them — `src/modules/park/`'s
`service.ts`, `rating.ts`, `ranks.ts`, `attendance.ts`, `landmarks.ts` and `escapes.ts`,
everything under `src/modules/guests/`, the `src/data/` tables `paddocks.ts`,
`facilities.ts`, `progression.ts`, `landmarks.ts`, `attendance.ts` and `attractions.ts`,
`docs/gameplay.md`, and the suites `tests/rating.test.ts`, `tests/ranks.test.ts`,
`tests/attendance.test.ts`, `tests/guests.test.ts`, `tests/attractions-content.test.ts`,
`tests/landmarks.test.ts` and `tests/escapes.test.ts`.

## Headlines

- One facility of each kind per park — `buildLot` throws `DuplicateFacilityError`, whose `message` is the facility's display name. Paddocks are the deliberate exemption: more of one kind IS the capacity progression. §one-facility-per-kind
- `facilityLevel` resolves a kind to its HIGHEST-level row and is the single source for `capHours`, `facilityBonusPct` and `incubatorSlots`; never re-derive a facility level with your own query, or pre-existing duplicate rows on a live DB resolve to whichever the unordered SELECT returned first. §facilitylevel-resolves-highest-row
- `facilityLevel` returns 0 for an absent kind on purpose — `Math.max()` over an empty array is `-Infinity`, and a bare reduce would return `undefined` and poison `accruedIncome` with `NaN`. §facilitylevel-zero-for-absent-kind
- Read every per-level facility array through `levelValue`, which clamps a level ABOVE the array to its top entry: an unguarded index is invisible to `npm test` and `npm run typecheck` alike and renders the literal text "Collect NaN" on the Collect button. §level-value-clamp
- There is no cleanup migration and no demolish path anywhere in this codebase: a duplicate lot can only be removed by `adminReset`, so a burned slot is gone permanently against a cap of 10. §duplicate-lots-are-permanent
- §null-prototype-catalog-maps
- `buildLot` owns an explicit `Object.hasOwn` allowlist over `PADDOCKS`/`FACILITIES`; the menu handler's identical copy is DEFENCE IN DEPTH and never the only guard, because nearly every dispatch site calls `execute` directly rather than through `routeInteraction`. §buildlot-owns-the-kind-allowlist
- `upgradeLot(ctx, userId, lotId, expectedLevel)` takes the anchor as a REQUIRED fourth parameter, never defaulted, and its guard order is not-found, then stale, then maxLevel — reorder it and `/upgrade` stops reporting "No such lot." for an unknown id. §upgradelot-required-anchor
- Park rating is a 1000-point scale (`RATING_SCALE`): every star figure anywhere in the game or its docs is `rating / 100`, ceiling 10.0★. §rating-scale-1000
- `PARK_TARGET` (40) must never move for any reason — it is the denominator of the rating's park term, so raising it is a retroactive rating CUT landing on accounts that did nothing wrong; the same freeze, for the same reason, covers `COLLECTION_TARGET`, `ATTENDANCE_SPECIES_TARGET` and `ATTRACTION_DRAW_TARGET`. §park-target-frozen
- The park term has always been saturable on lot levels alone — `VC L5 + 9 paddocks L4` reaches `parkRaw` 41 with zero decor ever placed — so never balance against a mandatory-decor constraint that does not exist. §park-term-saturable-without-decor
- `TRADE_MIN_RATING` is checked against the LIVE, droppable `parkRating` at both `createTrade` and `acceptTrade`, so anything that lowers that column can silently revoke `/trade` and kill offers already pending in a recipient's inbox. §trade-gate-reads-droppable-rating
- `paddockFitBase` versus `paddockFit` is a REAL split, not a display-only clamp: `Math.min(1, comfort)` bounds the ceiling and not the sensitivity, so a hunger-80 dino at fit 1.05 still reads 0.84 where the correct pre-enrichment value is 0.80. §base-vs-enriched-fit-is-a-real-split
- `recomputeRating` stamps `ratingHighWater` and `attendanceHighWater` in ONE `UPDATE`; never add a second stamping helper, or the two drift apart and every existing call site has to be found again. §recompute-stamps-two-highwaters
- A pure read must never write, and a monotone high-water is stamped separately, only in a write context — `legacyRank` reads, `bumpLegacyBest` writes, because `visit.ts` calls the read for ANOTHER player's id. §legacy-high-water-write-split
- Legacy rank must NEVER be rebuilt on top of `user_stats`: migration 0006 backfilled only 6 of that table's 18 counters, so a counter-based rank would under-rank exactly the oldest, most invested players — the inversion the feature exists to prevent. §legacy-rank-not-user-stats
- The achievement term is only transitively complete: 7 of the 12 tracks sit on counters 0006 never backfilled, so 13.7% of the ceiling inherits the very gap `user_stats` was rejected to avoid. Do not "fix" it by re-deriving the rank from counters. §achievement-term-inherits-gap
- Attendance is derived at read time and stored never — a fifth progression axis with no stored value to drift. §attendance-derived-read-time
- `attendanceOf` is PURE and must never write, because it is read for OTHER players' parks: `/top`, a visit, another player's card. §attendance-of-is-pure
- Never filter `attendanceOf` on the stored `escapedAt` — its predicate is `escapeMoment(d, now) === null`, and the stored-column version let the monotone `attendanceHighWater` bank guests from dinos that were long gone. §attendance-predicate-is-time-aware
- `recomputeRating` must never be hoisted back above `/guests`' subcommand switch: it writes the live `parkRating`, so opening `/guests view` after a few hours of hunger drain could drop a park below the trade gate and kill a pending offer — a state change caused by reading a screen. §recompute-not-above-guests-switch
- Landmarks live on `users.landmarkTier` and not as a `DECOR` kind: a decor-shaped cosmetic would be worth +8.75 rating per tile to a park below saturation and exactly 0 to a maxed one, precisely backwards for a sink whose job is to matter most at the endgame. §landmark-users-column-not-decor
- `buyLandmark` takes no tier argument — the only legal purchase is always `landmarkTierOf(ctx, userId) + 1`, which is what REMOVES the refund path rather than merely deferring it. §landmark-monotone-ladder
- The top of the ladder is deliberately NOT pre-rejected: the click falls through to `LandmarkMaxedError`, whose text names `LANDMARKS[MAX_LANDMARK_TIER - 1].name` rather than a retyped literal. §landmark-top-rung-error-text

## one-facility-per-kind

One facility of each kind per park (`buildLot` throws `DuplicateFacilityError`,
whose `message` is the facility's display name). Paddocks stay duplicable — more of
one kind IS the capacity progression. This is the home of the paddock exemption; the two
other places that lean on it — `§park-term-saturable-without-decor` below, and
`§buildyes-lotcount-anchor` in `docs/conventions/park-surface.md` — point here rather
than restating it.

## facilitylevel-resolves-highest-row

`facilityLevel` (`src/modules/park/service.ts`)
resolves a kind to its highest-level row and is the single source for `capHours`,
`facilityBonusPct` and `incubatorSlots`, so pre-existing duplicate rows on a live DB
resolve to the best facility rather than to whichever the unordered SELECT returned
first.

## facilitylevel-zero-for-absent-kind

`facilityLevel` returns 0 for an absent kind on purpose: `Math.max()` over an empty array
is `-Infinity` and neither level table guards its index, so a bare reduce would
return `undefined` and poison `accruedIncome` with `NaN` — the same silent failure
`§level-value-clamp` documents in full, guarded at the other end of the same lookup.

## level-value-clamp

`capHours`, `breedingSlots`, `incubatorSlots` and `facilityBonusPct`
(`src/modules/park/service.ts`, `src/modules/hatchery/service.ts`) each resolve a
facility's level through the shared `levelValue` helper, which clamps a level ABOVE its
per-level array to the array's top entry instead of indexing off the end into
`undefined`. This is the safe direction on purpose: neither `npm test` nor
`npm run typecheck` can see the alternative failure (`tsconfig` has `strict` but not
`noUncheckedIndexedAccess`), and the failure mode is silent rather than a crash — an
unguarded `capHours` reading `undefined` past its array's end turns `from + undefined`
into `NaN`, and the Collect button on `/park view` renders the literal text
"Collect NaN". An inline `?? 0` is not an acceptable substitute even where `NaN` is
impossible: `facilityBonusPct` was the last holdout on one, and an over-range level
there silently zeroed that facility's whole income contribution rather than clamping.
It goes through `levelValue` too now and the rule has no exceptions. Any future
per-level facility array needs the same guard, never a raw index.

## duplicate-lots-are-permanent

There is no cleanup migration and no way to delete a duplicate lot short of
`adminReset` — no demolish path exists anywhere in this codebase — and `lotSlots` caps
at 10, so a slot spent on a duplicate is gone permanently. That is what makes a
duplicate build a real loss rather than a refundable one, and it is the reason
`§buildyes-lotcount-anchor` (`docs/conventions/park-surface.md`) is not a minor concern.

## null-prototype-catalog-maps

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

## buildlot-owns-the-kind-allowlist

`buildLot` now owns an explicit
`if (!Object.hasOwn(PADDOCKS, kind) && !Object.hasOwn(FACILITIES, kind)) throw new UnknownKindError(kind)`.
The menu handler's identical allowlist is DEFENCE IN DEPTH, never the only guard — it
earns its place because nearly every `fakeButton` site, and every case in
`scripts/test-live.ts`, calls `execute` directly rather than through `routeInteraction`
(see the no-counts note under `router-guard-test-evidence` in
`docs/conventions/router-and-registry.md`).

## upgradelot-required-anchor

`upgradeLot(ctx, userId, lotId, expectedLevel)` takes the anchor as a REQUIRED fourth
parameter — never defaulted, the same rule as `hungerAt(…, drainMs)`, `feedCostFor(now)`
and `energyCostFor(now)` — and throws `StaleLevelError(expected, actual)`. Its guard order
is not-found, then stale, then maxLevel, so `/upgrade`'s `lotRow?.level ?? -1` sentinel
still reports 'No such lot.' for an unknown id. The caller's side of this — that the
anchor passed must be the CLIENT-SUPPLIED one — is
`§caller-passes-client-supplied-anchor` in `docs/conventions/park-surface.md`.

## rating-scale-1000

Park rating (`src/data/progression.ts`) is a 1000-point scale (`RATING_SCALE`):
every star figure anywhere in the game or its docs is `rating / 100`, ceiling
10.0★.

## park-target-frozen

`PARK_TARGET` (`src/data/progression.ts`, 40) must never move, for any reason,
including to compensate for a new cash sink or a new content ceiling. It's the
denominator of the rating's park term, so raising it is a retroactive rating CUT for
every park already at or past today's cap — and since stored `parkRating` only
updates on a rating-changing action (see "When it actually updates" in
`docs/gameplay.md`), the cut lands on accounts that did nothing wrong.

**This is the home of the frozen-denominator rule, and four constants share it.** The
argument is one sentence, stated here once: a denominator that became a LIVE count over
the content it measures would retroactively tax every existing player the moment new
content shipped, and each term's `Math.min(1, …)` clamp is precisely what makes a new
species, a new attraction kind or a new lot an ALTERNATE PATH to the existing target
rather than silent inflation of it.

| Constant | Value | Denominates | Full statement |
| --- | --- | --- | --- |
| `PARK_TARGET` | 40 | the rating's park term, over lot levels and decor | here |
| `COLLECTION_TARGET` | 190 | the rating's collection term — the rarity-weight sum of the roster it shipped against, never a live sum over `allSpecies()` | `docs/conventions/species-and-dex.md` |
| `ATTENDANCE_SPECIES_TARGET` | 40 | attendance's variety term, never a live count over `allSpecies()` | `docs/conventions/species-and-dex.md` |
| `ATTRACTION_DRAW_TARGET` | 210 | attendance's draw term, never a live count over `ATTRACTIONS` | `docs/conventions/species-and-dex.md` |

Two other frozen constants are deliberately NOT in this table and must not be folded
into it — their reasoning is specific and a table cannot carry it:
`NPC_LEVEL_SANITY_CAP` (`docs/conventions/battle-content-and-balance.md`) and
`SEASON_EPOCH` (`docs/conventions/season-track.md`).

## park-term-saturable-without-decor

Worth correcting here: an earlier assumption — that at least two decor pieces
were mandatory to reach a 10.0★ park — never actually held. Paddocks are exempt from
the duplicate check (`§one-facility-per-kind`), so `VC L5 + 9 paddocks L4` alone reaches
`parkRaw` 41 against `PARK_TARGET` 40 with zero decor ever placed. The park term has
always been saturable on lot levels alone; 38 was the ceiling of one particular
build, never of the game.

## trade-gate-reads-droppable-rating

`TRADE_MIN_RATING`
(400, `src/data/trade.ts`) is checked against the same droppable stored `parkRating` at
both `createTrade` and `acceptTrade` (`src/modules/trading/service.ts`) — the LIVE
value, which falls freely as comfort decays, not the monotone `ratingHighWater`. So a
`PARK_TARGET` raise can silently revoke `/trade` for players already sitting near the
gate and can kill trades already pending in a recipient's inbox, not just future ones —
and so can anything else that writes that column on a read path, which is what
`§recompute-not-above-guests-switch` exists to prevent.

## base-vs-enriched-fit-is-a-real-split

`paddockFitBase` (no enrichment) vs `paddockFit` (enrichment included) is a REAL split,
not a display-only clamp: `recomputeRating` (`src/modules/park/rating.ts`) is
`baseComfortAt`'s ONLY caller, specifically so `ratingHighWater` — monotone, and the gate
behind lot slots, expedition sites, battle chapters, the shop ceiling and the Mythic
unlock — can never move just because a paddock got decorated past its first match. A
`Math.min(1, comfort)` clamp on the enriched value is NOT a substitute: it bounds the
ceiling, not the sensitivity, so a hunger-80 dino at fit 1.05 would still read 0.84 there
instead of the correct pre-enrichment 0.80. The legitimate use of that same shape — a
clamp on what is DISPLAYED and nothing else — is
`§display-only-comfort-clamp-is-legitimate` in `docs/conventions/park-surface.md`.

## recompute-stamps-two-highwaters

`recomputeRating` stamps TWO high-waters in one `UPDATE` — `ratingHighWater` and
`attendanceHighWater`, each independently `Math.max`ed against its stored value in the
same call — so every existing rating-triggering action (assign, build, upgrade,
decorate, feed, rescue, trade) moves attendance's high-water too, with no new call
sites and no risk of the two drifting apart.

## legacy-high-water-write-split

**A pure read must never write; a monotone high-water is stamped separately, only in a
write context.** This is the home of that rule and the pattern is named after its first
instance. `legacyRank` resolves `max(stored legacyRankBest, computed legacyPoints)`,
never the
stored value alone — the column is a safety net, so a missed write is harmless and
only matters when the computed value DROPS. The write lives in a separate
`bumpLegacyBest(ctx, userId)` and must NEVER be folded into `legacyRank`, because
`src/modules/park/visit.ts` calls that for another player's id and would otherwise
mutate the row of a user who took no action.

Five other sites follow the same split and each names only what is unique to it:
`§attendance-of-is-pure` and `§recompute-not-above-guests-switch` below,
`§bump-legacy-best-once-per-command` in `docs/conventions/park-surface.md`, the season
capstone badge stamped only from `postDispatch` (`docs/conventions/season-track.md`),
and `legacyScores`' pairing with `legacyPoints` rather than the high-water
(`docs/conventions/leaderboards.md`).

## legacy-rank-not-user-stats

Legacy rank (`legacyPoints`/`legacyRank`, `src/modules/park/ranks.ts`) is DERIVED —
the derived-never-stored rule, stated in full in
`docs/conventions/schema-and-migrations.md` — and must NEVER
be rebuilt on top of `user_stats`. Migration `0006_daily_loop.sql` backfilled only 6
of that table's 18 counters from existing history (`stages_first_cleared`,
`lots_built`, `trades_completed`, `breedings_started`, `breedings_claimed`,
`expeditions_claimed`); the other twelve — including `dinos_fed`, `eggs_hatched` and
`battles_fought` — start at 0 for every pre-0006 account and are unrecoverable. A
rank built on that table would under-rank exactly the oldest, most invested players,
the inversion the feature exists to prevent. It sums three sources that are each
already monotone and already complete for every account instead: species discovered
(`dexProgress`, max 52), achievement tiers claimed (`earnedTierCount`, max 48), and
battle stars (`battle_progress.stars`, max 105) — 205 points total, nothing spent,
nothing stored.

## achievement-term-inherits-gap

**"Already complete for every account" is true of two of those three, and only
transitively true of the achievement term** — say so rather than repeating the clean
version. `earnedTierCount` counts `achievement_claims`, which is the right thing to
count and is never lost, but every `ACHIEVEMENTS` track (`src/data/achievements.ts`)
is gated on a `user_stats` counter, and 7 of the 12 sit on counters `0006` did not
backfill: `eggs_hatched`, `dinos_fed`, `income_collected`, `battles_fought`,
`battles_won`, `splices_done`, `dinos_sold`. (The other five — `expeditions_claimed`,
`stages_first_cleared`, `trades_completed`, `breedings_claimed`, `lots_built` — are
covered; `breedings_started` is backfilled but has no track, which is why 6 backfilled
counters cover only 5 tracks.) A pre-0006 account therefore cannot claim 28 of the 48
achievement points out of history it actually lived — **13.7% of the 205 ceiling
inherits exactly the gap `user_stats` was rejected to avoid.** The code is still right:
the shortfall is re-earnable by playing, where a rank built ON `user_stats` would have
been permanently unrecoverable, and the dex and battle-star terms are complete in the
full sense. Do not "fix" this by re-deriving the rank from counters.

## attendance-derived-read-time

Park guests (`/guests`, migration 0017) adds attendance as a fifth progression axis:
`attendanceFrom(distinctSpecies, drawTotal, vcLevel)` (`src/data/attendance.ts`) is
derived at read time and stored never — the derived-never-stored rule, stated in full in
`docs/conventions/schema-and-migrations.md`. The two frozen denominators it depends on
are tabulated at `§park-target-frozen` above.

## attendance-of-is-pure

`attendanceOf` (`src/modules/park/attendance.ts`)
is PURE and must never write, because it's read for OTHER players' parks (`/top`, a
visit, another player's card); the monotone high-water is stamped separately, only in
a write context, by `recomputeRating` (`src/modules/park/rating.ts`) —
`§legacy-high-water-write-split` above.

## attendance-predicate-is-time-aware

`/guests view` and `/guests claim`
(`src/modules/guests/embeds.ts`, via `attendanceOf` → `toClockDinos`) are two surfaces
that render attendance without calling `settleEscapes` first, unlike the park card
(own or visited), which always settles before rendering it. This is safe, not merely
tolerated, because `attendanceOf`'s own dino predicate is TIME-AWARE: it filters on
`escapeMoment(d, now) === null` (`src/modules/park/attendance.ts`), not the stored
`escapedAt` column, so a live-escaped-but-unsettled dino stops counting toward the
variety term the instant it crosses, with no settle call needed.

Never filter `attendanceOf` on the stored
column instead of `escapeMoment` — that was the pre-fix behaviour (defect F2), and it
let `attendanceHighWater` — monotone, with no path back down — bank guests from dinos
that were long gone, since neither `/guests build` nor `/build` nor `/upgrade` calls
`settleEscapes` and nothing else had settled them.

## recompute-not-above-guests-switch

`recomputeRating` must never be hoisted back above `/guests`' subcommand switch
(`src/modules/guests/index.ts`). It used to run unconditionally for every subcommand,
to stamp the attendance high-water before anything read it — but it writes three
columns in one `UPDATE`, and one of them is `parkRating`, the LIVE value, which falls
freely as comfort decays. `liveRating` (`src/modules/trading/service.ts`) is a plain
`SELECT` of that same column, checked against `TRADE_MIN_RATING` at both `createTrade`
and `acceptTrade`, so opening `/guests view` after a few hours of hunger drain could
have dropped a park below the trade gate and killed a pending offer — a state change
caused by reading a screen. That consequence is unique to this site and is why the
general rule (`§legacy-high-water-write-split`) is not enough on its own here.
`view` is a pure read and deliberately never recomputes;
`build` and `claim` still call it, because each reads the high-water as its own unlock
gate and each mutates regardless, so the `parkRating` write riding along carries no
surprise. The high-water still advances on every build, claim, feed, assign, upgrade
and decorate, so nothing becomes unreachable.

## landmark-users-column-not-decor

Landmarks (`src/data/landmarks.ts`) are the endgame cash sink, and deliberately live
on `users.landmarkTier` rather than shipping as a `DECOR` kind, even though a
cosmetic decor item would have reused an existing catalog. `recomputeRating`
(`src/modules/park/rating.ts`) sums `l.level + l.decor.length` as a flat length with
no filter or weight, so a decor-shaped cosmetic would be worth +8.75 rating per tile
(0.35 park weight × 1000 `RATING_SCALE` ÷ 40 `PARK_TARGET`) to a park below
saturation and exactly 0 to a maxed one — power for the mid-game, nothing for the
endgame, precisely backwards for a sink whose whole job is to matter most at the
endgame. A `users` column reads from nothing rating cares about (`rating.ts`,
`clock.ts`, `lotSlots`, `matchedKindCount` all ignore it), so staying powerless is
structural, not a rule someone has to remember to enforce.

## landmark-monotone-ladder

The ladder (`buyLandmark`, `src/modules/park/landmarks.ts`) is a monotone integer
with no tier argument — the only legal purchase is always
`landmarkTierOf(ctx, userId) + 1` — which is what removes the refund path rather
than merely deferring it: with only one buyable rung at any moment, there is no
wrong one to click. That argument holds for the FUNCTION and not for the SURFACE; the
button that spends the money needs its rung in the customId, which is
`§money-button-carries-its-rung` in
`docs/conventions/command-and-handler-surface.md`.

## landmark-top-rung-error-text

The top of the ladder is deliberately NOT pre-rejected — at tier 6 no offered tier
can equal `current + 1`, so the click falls through to `buyLandmark`'s
`LandmarkMaxedError`, whose text names `LANDMARKS[MAX_LANDMARK_TIER - 1].name`
rather than a retyped literal.
