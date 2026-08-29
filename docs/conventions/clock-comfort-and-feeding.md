# Clock, comfort and feeding

Fires on: `src/core/clock.ts` and the data tables behind it — `src/data/decor.ts`,
`src/data/foods.ts` and `src/data/care.ts` — plus everything under `src/modules/care/`,
and the suites that pin those numbers: `tests/clock.test.ts`, `tests/enrichment.test.ts`,
`tests/care.test.ts`, `tests/tundra.test.ts`, `tests/dinos.test.ts` and
`tests/feed-skip.test.ts`.

## Headlines

- Food is typed (3 tiers x 2 diets) and lives in the `food_inventory` table — `users.food` no longer exists, so anything written against that column is written against nothing. §food-is-typed-in-its-own-table
- Food autocomplete labels use `FoodDef.fallback` unicode, never `emojiTag`/`foodEmoji` — a custom tag renders as literal text there and no test can see it. §food-autocomplete-uses-fallback-unicode
- `hungerAt(hungerAtFed, lastFedAt, at, drainMs)` takes `drainMs` as a REQUIRED parameter: a default would let a call site silently keep the flat 48h global rate instead of the trait-adjusted one, reintroducing the exact bug the parameter exists to prevent. §hungerat-drainms-required
- Feeding fills to 150 while `comfortAt` clamps the hunger term at 100, so `accruedIncome` must stay piecewise across that crossing — a plain two-point trapezoid over- or under-pays every overfed dino. §overfeeding-and-piecewise-income
- `accruedIncome` splits its window at every UTC midnight it crosses and samples `incomeMultAt` at each segment's START, never once at request time — sample once and delaying Collect retroactively earns a better multiplier for time that already passed. §income-integrated-across-midnights
- Never wire a world event to hunger drain rate or battle energy regen; scale the one-shot alternatives instead, or the segment-splitting machinery `accruedIncome` needed spreads into `clock.ts` and `energy.ts`. §no-events-on-integrated-knobs
- `feedCostFor` and `energyCostFor` take `now` as a REQUIRED parameter, never defaulted — a default lets a call site silently keep the unmodified rate or cost. §required-now-parameter-never-defaulted
- Enrichment stacks on TOP of the diet split: `paddockFit`/`paddockFitBase` still return 0.5 off-diet and 0.75 on-diet-with-no-match, byte-identically, and enrichment applies only once a paddock has already reached fit 1.0. §enrichment-stacks-above-diet-split
- `matchedKindCount` counts DISTINCT decor kinds through a `Set`, because `decorateLot` appends with no dedupe — drop the `Set` and buying one tile twice buys a rung. §matched-kind-count-dedupes
- `ENRICHMENT_STEPS` is deliberately 1.0 at index 0, so the rung starts climbing only at a SECOND distinct match; three test files independently pin "one matching tile means exactly 1.0". §enrichment-steps-index-zero-is-one
- The ladder stops at fit 1.10 for a mechanical reason, not a balance one: a dead window where a dino earns nothing while its 8h grace runs out opens iff `fit · drainMult > 1.5` — not at a bare fit of 1.5, and never independently of traits. §enrichment-cap-is-mechanical
- Keep `tests/enrichment.test.ts` deriving `MAX_DRAIN_MULT` from the real `TRAITS` table rather than pinning a literal; the guard it replaced passed while the condition it existed to prevent was already violated. §dead-window-gate-derives-from-traits-table
- Never retire a decor `kind` from `DECOR` without accounting for live paddocks: `matchedKindCount` treats an unknown slug as a non-match rather than throwing, so a paddock silently drops a rung, or falls 1.0 to 0.75, with no error and no record. §retiring-a-decor-kind-degrades-silently

## food-is-typed-in-its-own-table

Food is typed (`src/data/foods.ts`, 3 tiers × 2 diets) and lives in the
`food_inventory` table — `users.food` no longer exists.

## food-autocomplete-uses-fallback-unicode

Food autocomplete labels use `FoodDef.fallback` unicode, never `emojiTag`/`foodEmoji`.
This is one instance of a general rule, stated where the builders that commit it live:
`§never-emoji-tag-in-autocomplete-label` in
`docs/conventions/command-and-handler-surface.md`.

## hungerat-drainms-required

`hungerAt(hungerAtFed, lastFedAt, at, drainMs)`
(`src/core/clock.ts`) takes `drainMs` as a **required** parameter on
purpose: a default would let a call site silently keep the flat 48h global
rate instead of a trait-adjusted one (Hardy drains 25% slower, Grazer and
Skittish 20% faster), reintroducing exactly the bug the parameter exists to
prevent. Every production call site passes `drainMsFor(d.traits)` — never
the bare constant — including `startBreeding`'s hunger-≥50 gate
(`src/modules/genelab/service.ts`), `/feed all`'s hungriest-first sort, and
`comfortAt`. Those multipliers come off the trait table, where a dino never holds
two traits from one domain —
`§trait-domains-never-doubled` in `docs/conventions/escrow-and-item-moves.md`.

The shape generalises beyond this signature, and is stated once here rather than three
times: a parameter that exists to force fresh state into a call site never gains a
default, because the default is the old bug wearing the new signature — the call
compiles, every test passes, and the value used is exactly the one the parameter was
added to stop it using. `feedCostFor` and `energyCostFor` take `now` under the same rule,
below. `upgradeLot`'s `expectedLevel` is the third instance —
`§upgradelot-required-anchor` in `docs/conventions/park-progression.md`.

## overfeeding-and-piecewise-income

Feeding sets `hunger = fillTo` (up to 150): `comfortAt` clamps the hunger term at 100,
and `accruedIncome` must stay piecewise across the hunger-100 crossing — a plain
two-point trapezoid over-/under-pays overfed dinos.

This and the UTC-midnight split immediately below are two halves of one invariant on one
function, stated apart only because their causes are unrelated, and a rewrite of
`accruedIncome` has to satisfy both at once. Neither is sufficient on its own: an
implementation that splits at midnight but samples the hunger term twice per day still
mis-pays an overfed dino, and one that integrates the hunger crossing correctly but
samples `incomeMultAt` once still pays yesterday's income at today's rate. The hunger
term this clamp bounds is `hungerAt`'s output, so the value being clamped already carries
the trait-adjusted drain rate above.

## income-integrated-across-midnights

Of everything a world event can scale, income is the only effect integrated over time:
`accruedIncome` (`src/core/clock.ts`) splits its accrual window at every UTC midnight it
crosses and samples `incomeMultAt` at each resulting segment's START, never
once at request time — so a day's slice of pending income is always paid
at that day's own rate, and delaying `/park view`'s Collect can never
retroactively earn a better multiplier for time that already passed.

That is the second, independent reason this function must integrate piecewise; the
hunger-100 crossing above is the first.

## no-events-on-integrated-knobs

Hunger drain rate and battle energy regen were deliberately never wired to
any event: both are either inverted (regen counts up over time, the
opposite direction from a one-shot cost) or, like income, accumulate
across an arbitrarily long window — scaling either would have forced the
same piecewise segment-splitting machinery through `clock.ts`/`energy.ts`
that `accruedIncome` needed, for two knobs that already had a one-shot
alternative (Heat Wave/Cold Snap scale `feedCostFor` instead of drain rate;
Blood Moon scales `energyCostFor` instead of regen).

## required-now-parameter-never-defaulted

`feedCostFor` (`src/modules/care/service.ts`) and `energyCostFor`
(`src/modules/battles/service.ts`) both take `now` as a REQUIRED
parameter, never defaulted — a default would let a call site silently keep
the unmodified rate/cost, reintroducing the exact bug the parameter exists
to prevent. It is the same rule `hungerAt`'s `drainMs` follows, for the same reason,
and the general form is stated in full there. What is specific to these two is that the
event their `now` exists to see is the one-shot alternative chosen precisely so that
neither `clock.ts` nor `energy.ts` had to learn to integrate.

## enrichment-stacks-above-diet-split

Habitat enrichment stacks decor on TOP of the existing diet split, never underneath it:
`paddockFit`/`paddockFitBase` (`src/core/clock.ts`) both still return 0.5 off-diet and
0.75 on-diet-with-no-match, byte-identical to pre-enrichment behaviour — enrichment only
ever applies once a paddock has already reached fit 1.0 (correct diet, ≥1 matching decor
kind).

Which of the two a caller takes is itself load-bearing, and the rating path must take the
base one: `§base-vs-enriched-fit-is-a-real-split` in
`docs/conventions/park-progression.md`.

## matched-kind-count-dedupes

`matchedKindCount` (`src/data/decor.ts`) counts DISTINCT decor kinds whose
`biomeTags` intersect the resident's, deduped via a `Set` since `decorateLot` appends
with no dedupe. Without the `Set`, buying the same tile twice climbs a rung nobody
earned.

## enrichment-steps-index-zero-is-one

`ENRICHMENT_STEPS` (`[1.0, 1.05, 1.1]`, indexed by matched-kinds − 1) is
deliberately 1.0 at index 0 — the rung only starts climbing at a SECOND distinct match,
never the first. That boundary is load-bearing: three tests (`tests/clock.test.ts`,
`tests/tundra.test.ts`, `tests/dinos.test.ts`) each independently pin "one matching tile
⇒ exactly 1.0".

## enrichment-cap-is-mechanical

The ladder stops at fit 1.10 for a real mechanical reason, not just balance: past a point
`escapeAt` outruns `hungerZero` and a dino sits at comfort 0 — earning nothing — while its
8h grace runs out. The boundary is **not** a bare fit of 1.5, and the earlier "`12/fit < 8`
once fit ≥ 1.5" wording was wrong twice over (inverted inequality, and blind to traits).
The real algebra, from `src/core/clock.ts`, is
`escapeAt − hungerZero = GRACE_MS − (ESCAPE_COMFORT / fit) · drainMs`, and `drainMs` is
`HUNGER_DRAIN_MS / drainMult`, so that dead window opens iff
**`fit · drainMult > 1.5`** where `drainMult = modProduct(traits, 'drain')` — independent
of `hungerAtFed`, but NOT of the dino's traits. `grazer` (domain `income`) and `skittish`
(domain `care`) both carry `drain: 1.20` in DIFFERENT domains, so one dino can legally hold
both: `drainMult` 1.44, `drainMs` 33.33h, boundary at fit **1.0417** — under both shipped
rungs. Measured against the real `escapeAt`, a grazer+skittish dino's dead window is
−20 min (i.e. none) at fit 1.00, **+3.81 min at 1.05 and +25.45 min at 1.10**. This branch
is what made the condition reachable at all: before it, fit topped out at 1.00 and no trait
combination could cross the line. It ships knowingly — the window is bounded and small, and
income stays monotone in enrichment.

Any future cap raise is a decision about how long a dino may earn nothing,
not a balance question.

## dead-window-gate-derives-from-traits-table

The OLD guard (`expect(step).toBeLessThan(1.5)`)
was toothless, since it passed while the condition it existed to prevent was already
violated. `tests/enrichment.test.ts` now derives `MAX_DRAIN_MULT` (1.44 today) from the real
`TRAITS` table — the product of the two largest per-domain `drain` maxima, since a dino holds
at most two traits and never two from one domain — and bounds the worst reachable dead window
against an explicit tolerance, so raising the cap or shipping a third drain trait moves the
gate on its own.

## retiring-a-decor-kind-degrades-silently

Standing hazard, now worse than before: retiring a decor `kind` from `DECOR`
(`src/data/decor.ts`) silently drops every paddock relying on it — `matchedKindCount`
treats an unknown slug as a non-match rather than throwing, the same tolerance
`traitDefs` gives a retired trait id. Pre-enrichment this could only cost a dino its
1.0 → 0.75 fall; now it can also cost a rung on top — a paddock sitting at fit 1.10 in
reliance on a since-retired kind silently drops to 1.05 or 1.00 the next time anything
reads it, with no error and no record of what changed.

A retirement can also break the catalog's coverage guarantee, which is what makes the top
rung reachable for every species at all: `§decor-catalog-covers-every-biome` in
`docs/conventions/species-and-dex.md`.
