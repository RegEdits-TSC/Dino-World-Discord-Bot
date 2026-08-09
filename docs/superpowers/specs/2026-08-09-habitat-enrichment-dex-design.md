# Habitat Enrichment & The Dex — design

Spec 2a of a two-part "Depth & Endgame" roadmap entry. Habitat decor stops being
a one-tile boolean and becomes a graded reward for composing a paddock well; the
species roster gets a permanent, per-player compendium.

Baseline: branch `park-speaks-first` (1b, PR #22 open), **1245 tests / 91 files**.
`main` is still at `6e359af`, so every `src/modules/park/alert-*.ts` line cited
here exists only on that branch.

## 1. Why

Spec 1a made the world move on its own clock; 1b made the park speak first. Both
added breadth. What a developed park lacks is a reason to keep making decisions,
and the numbers behind that are stark.

**The endgame has no cash sink.** A maxed park earns **4,561,920 cash/day**:

```
lotSlots(1000) = 3 + 7 thresholds all ≤ 950              = 10 lots
  − 4 facilities (VC L5, FC L3, HL L3, GL L3)            =  6 paddocks
paddockCapacity(4) = 2 × 4                               = 48 dino slots
facilityBonusPct = VC 20 + FC 12                         = 32%
capHours = FACILITIES.visitor_center.capHours[4]         = 24 h

48 × 3,000/hr × 24 h × 1.32                              = 4,561,920 / day
```

Everything purchasable in the game — four facilities to max, six paddocks to L4 —
totals **1,674,000**, which is **8.8 hours** of that income. Daily food for that
park is **84,480 (1.85%)**; with 1.5 legendary eggs a day the whole spend is
**264,480 = 5.80%**, leaving **94.20% unspent**. The most expensive single purchase
in the game (Visitor Center L4→L5, 500,000) is 2.6 hours of income.

**The rating ceiling arrives before the content does.** The top gate is 950 — lot
slot 10 (`LOT_SLOT_THRESHOLDS`, `src/data/progression.ts:15`) and
`containment_site` (`src/data/sites.ts:22`) — so the 950–1000 band unlocks
nothing. The collection term saturates at 190 of a possible 302 roster weight,
reachable with **ten** dinos (3 mythic + 5 legendary + 2 epic = 192).

**And decor — the system nominally about habitat quality — is a boolean.**
`paddockFit` (`src/core/clock.ts:46-50`) asks `decor.some(...)`, so **one matching
tile is worth exactly as much as forty**. A 400-cash grass tuft closes the whole
0.75 → 1.0 comfort gap for every plains species a player will ever own.

This spec fixes the third problem because it is the prerequisite for the first:
2b's prime decor sink needs a payment channel that scales, and none exists today —
past `parkRaw` 40 an extra decor piece buys literally nothing.

### Roadmap context

| Part | Theme | Status |
| --- | --- | --- |
| 1a | The Living World — global events, seasons, `/world` | shipped 2026-08-07 |
| 1b | The Park Speaks First — proactive alerts, notification buttons | PR #22 open |
| 2a | Habitat Enrichment & The Dex | **this spec** |
| 2b | Veteran ranks, the prime decor sink, Hatchery L4–L5 | next |
| 3 | The Server Is A Park — exhibition duels, rich park visits | last |

2a builds the channel; 2b spends it. The split falls there because the sink is
*blocked* on a graded comfort term, and because Hatchery L4–L5 moves maximum lot
levels 38 → 40 — saturating the park rating term on levels alone and destroying
the current property that at least two decor pieces are mandatory for 10.0★. That
interaction must be balanced against the sink's pricing, so both live in 2b.

**Set expectations honestly: 2a's own numbers are small.** The safe ceiling is
+10% (§4), which on the reference park is +456,192 cash/day into a surplus that is
already 94% unspent, plus 65 minutes on a 44-hour escape window. 2a's job is to
build a channel that scales and to make paddock composition a real decision; 2b's
5,000,000 prime tiles are what make the channel consequential.

## 2. Design decisions

1. **Enrichment is ADDITIVE ABOVE today's ceiling.** The three existing
   `paddockFit` values are preserved exactly — wrong diet 0.5, right diet with no
   match 0.75, right diet with one match 1.0 — and enrichment stacks only above
   the 1.0 case. This is what keeps every existing pinned integer intact: the
   maximum number of biome-*matching* decor slugs on any fixture in the entire
   suite is **one** (`tests/clock.test.ts:16`, `tests/dinos.test.ts:63`,
   `tests/park.test.ts:91`, `tests/stats-sites.test.ts:95`, `tests/tundra.test.ts:18`;
   everything else is `decor: []`, a retired slug, or non-`DECOR` keys such as
   `['statue','tree']` at `tests/park-snapshot.test.ts:17`).
   *Rejected: regrading the whole 0.5–1.0 band.* More faithful as a mechanic, but
   it is a retroactive nerf to every live park, and — decisively — it **breaks the
   trade gate**: `liveRating` reads the stored `parkRating`
   (`src/modules/trading/service.ts:18-20`, checked at `:66-67`) against
   `TRADE_MIN_RATING = 400`
   (`src/data/trade.ts:1`), a gate `docs/gameplay.md:804` names in writing as the
   one thing a park can *lose*. A fully-fed park's comfort term is `250 × fit`, so
   regrading drops live ratings by 41.67–50.00 points and every park in
   [400, 450) loses `/trade`.
   *Also rejected: a fourth weighted rating term.* `RATING_WEIGHTS` sums to 1.0
   (`src/data/progression.ts:6`), so a fourth weight is a uniform `×(1−w)` haircut
   on shipped content: at w=0.10 a mid-game 400 becomes 360 and **950 — lot slot 10
   and the Containment Site — becomes unreachable** without enrichment content that
   does not exist yet. It also fails its own purpose, because rating has zero
   mechanical consumers above 950, so the endgame player a prime tile targets has
   latched 950 already.
   *Also rejected: prime tiles worth multiple points toward `PARK_TARGET`.* No new
   weight, no haircut — but at the maxed build `parkRaw` from lot levels alone is
   `5+3+3+3 + 6×4 = 38` against a target of 40, so two tiles saturate the term and
   prime tiles would pay endgame players nothing.
2. **Enrichment counts DISTINCT matching kinds, not tiles.** `decorateLot`
   (`src/modules/park/dinos.ts:53-63`) appends with no dedupe, no per-lot cap and
   no removal path, so live parks already hold duplicates and `['grass_tuft',
   'grass_tuft']` is representable. Distinct kinds is dedupe-safe by construction
   and cannot be farmed: a raw-count ladder is defeated by 6 paddocks × 5 grass
   tufts = 12,000 cash, which is **3.8 minutes** of maxed-park income.
3. **The first rung requires STRICTLY MORE than one matching kind.** Three tests
   pin *one matching tile ⇒ exactly 1.0* — `tests/clock.test.ts:32` and
   `tests/tundra.test.ts:18` with `toBe(1.0)`, `tests/dinos.test.ts:65` with
   `toBeCloseTo(1.0)`. They fix the *location* of the boundary, not merely that 1.0
   is reachable, and a ladder whose first rung fires at one kind breaks all three.
4. **Rating is byte-identical to today, via a base/enriched split — not a clamp.**
   `paddockFitBase` returns today's three values and feeds rating; `paddockFit`
   applies enrichment and feeds income, escapes and display (§3). A
   `Math.min(1, comfort)` clamp was considered and **rejected as insufficient**:
   it bounds the ceiling but not the sensitivity, so a hunger-80 dino at fit 1.05
   still reads 0.84 instead of 0.80 and rating still rises. Since
   `ratingHighWater` is monotone (`src/modules/park/rating.ts:23`) and gates lot
   slots, sites, the shop ceiling and the mythic unlock, any rating gain is a
   **permanent, retroactive progression grant**. The clamp is also unfalsifiable —
   it can be added today with all 1245 tests still green — whereas the split is
   guarded by a test that fails when rating reads the enriched value.
5. **The decor catalog is equalized first.** Distinct-kind enrichment is only fair
   if every species can reach the top rung, and today four cannot reach even the
   first — see §5. A prerequisite, not polish.
6. **`species_seen` is a permanent record, backfilled from live inventory.** A dex
   whose checkmarks come from current inventory un-checks itself when a dino is
   sold or traded: a catalog with a mirror, not a collection.
7. **Nothing in 2a rewards dex progress.** The rating side is closed —
   collection saturates on ten species and `COLLECTION_TARGET` is frozen by
   deliberate design (`src/data/progression.ts:8-12`). Discovery count is instead a
   near-perfect input for 2b's veteran ranks: monotone, unfarmable, and a real
   measure of long-haul play.
8. **`/dex` is its own module.** Full five-site registration rather than two
   integers, because 2b's rank surface wants a home and `daily`'s
   two-commands-per-manifest shape is the only alternative.

## 3. Architecture

`paddockFit` is the root of the comfort chain, and its consumers use it in three
*different* directions — which is why the split matters:

```
paddockFitBase(species, paddock, decor)     ← today's 0.5 / 0.75 / 1.0, unchanged
  └── baseComfortAt  ──→ recomputeRating (mean over assigned)  park/rating.ts:20

paddockFit(species, paddock, decor)         ← base, then the enrichment rung
  ├── comfortAt      MULTIPLIES by it                          clock.ts:56
  │     ├── accruedIncome (per trapezoid segment)              clock.ts:107
  │     └── listDinos    (/dino list display)                  park/dinos.ts:82
  ├── comfortCrossing DIVIDES by it                            clock.ts:62-63
  │     └── escapeAt → escapeMoment → settleEscapes, the /park view at-risk
  │         badge, and both proactive alert predicates (park/alert-detect.ts)
  └── rescueDino      INVERTS it (50 / fit)                     care/service.ts:110
```

`baseComfortAt` exists solely so `recomputeRating` can be provably unaffected;
`recomputeRating` is its only caller, and that is stated at both ends. Because base
fit ≤ 1.0 and the hunger term ≤ 1.0, the existing unclamped mean stays safe
without a clamp.

**`rescueDino` gets no code change.** Its `50 / fit` divisor is what holds
post-rescue comfort at ~0.5 across the whole band — 0.5 → 100, 0.75 → 67,
1.0 → 50, 1.05 → 48, all landing at comfort ≈ 0.5. Clamping the divisor at 1.0
would over-restore to 0.525–0.55 and break the invariant its comment documents.
Only that comment changes, to record why the divisor must stay unclamped.

Two pure helpers land in `src/data/decor.ts`, beside the data they read:

- `enrichingKindsFor(species)` → the decor kinds whose `biomeTags` intersect the
  species' `biomeTags`. Used by the rung logic *and* by `/dex` (§7), which is the
  one place wave 1's halves compound.
- `enrichmentMult(matchedKinds)` → the rung multiplier from `ENRICHMENT_STEPS`.

`paddockFit` becomes:

```ts
const base = paddockFitBase(species, paddock, decor);
if (base < 1.0) return base;                       // wrong diet, or no match at all
return enrichmentMult(matchedKindCount(species, decor));   // distinct, Set-deduped
```

The helpers live in `src/data/decor.ts` rather than `clock.ts` so `/dex` can import
the lookup without pulling in the clock; the `Species` import is type-only, so no
runtime cycle appears.

`paddockFit` keeps its exact signature `(species, paddock, decor: string[])`. A new
parameter would break six test call sites and five `ClockDino` literals under
`npm run typecheck` **only** — invisible to `npm test`, which does not typecheck.

## 4. The mechanic

`ENRICHMENT_STEPS` maps distinct matched kinds to a multiplier. Two rungs, ceiling
**1.10**:

| Distinct matching kinds | fit | Note |
| --- | --- | --- |
| 0 | 0.75 | unchanged — right diet, nothing matching |
| 1 | **1.00** | unchanged — today's full credit, pinned by three tests |
| 2 | **1.05** | first rung |
| 3+ | **1.10** | cap (`ENRICHMENT_CAP_KINDS = 3`); further variety pays nothing |

`ENRICHMENT_STEPS` and `ENRICHMENT_CAP_KINDS` both live in `src/data/decor.ts`
beside the table they read.

Simulated effect (an exact `accruedIncome` replica, validated 864/864 against the
real function at the three reachable fits):

| fit | common, 8 h, no facilities | one legendary / 24 h | 48-legendary park / day | escapeAt (fed 100) |
| --- | --- | --- | --- | --- |
| 1.00 | 440 | 95,040 | 4,561,920 | 44.000 h |
| 1.05 | 462 | 99,792 | 4,790,016 (+228,096) | 44.571 h |
| 1.10 | 484 | 104,544 | 5,018,112 (+456,192) | 45.091 h |

Marginal cash/day per +0.05 on a 48-slot maxed park: **83,635 epic / 228,096
legendary / 684,288 mythic**. One rung is 2.70× that park's entire daily food bill.

**Why the ceiling is 1.10 and not higher — two hard walls:**

1. **The escape channel is asymptotically worthless.** The gain is
   `(25 − 25/fit)/100 × 48 h`, whose supremum as fit → ∞ is exactly **+12.0 h**.
   +4 h would need fit 1.50 and +6 h fit 2.00. At 1.05 a player buys 34 minutes on
   a 44-hour window; at 1.10, 65 minutes. Paying more multiplier buys almost
   nothing here, so the ceiling should be set by the income channel — where every
   0.05 lands entirely in an untouched surplus.
2. **Past a point, fit opens a dead window** in which a dino sits at comfort 0,
   earning nothing, while the 8-hour grace runs out. **Corrected 2026-08-09** — as
   originally written this wall claimed the boundary was a bare fit of 1.5
   ("`escapeAt < hungerZero` iff `12/fit < 8`, i.e. iff fit < 1.5, independent of
   `hungerAtFed`"), which was wrong twice: the inequality was inverted, and the
   boundary is not independent of the dino's *traits*. The real algebra, from
   `clock.ts`, is

   ```
   escapeAt − hungerZero = GRACE_MS − (ESCAPE_COMFORT / fit) · drainMs
   drainMs = HUNGER_DRAIN_MS / drainMult,  drainMult = modProduct(traits, 'drain')
   ```

   so the window opens iff **`fit · drainMult > 1.5`** — independent of `hungerAtFed`,
   but not of traits. Fit 1.5 is only the boundary at `drainMult = 1`. `grazer`
   (domain `income`) and `skittish` (domain `care`) each carry `drain: 1.20` in
   *different* domains, so one dino may legally hold both: `drainMult` 1.44,
   `drainMs` 33.33 h, boundary at fit **1.0417** — below both shipped rungs.
   Measured against the real `escapeAt`, that dino's dead window is −20 min (none) at
   fit 1.00, **+3.81 min at 1.05** and **+25.45 min at 1.10**. This spec is what makes
   the condition reachable at all: pre-enrichment fit topped out at 1.00, where no
   trait combination crosses the line. It ships knowingly — the window is bounded and
   small, and income stays monotone in enrichment — and the gate in §10 bounds the
   worst *reachable* window rather than comparing a step against 1.5, which passes
   while the condition it guards is already violated.

**Five properties are load-bearing.**

1. **It is a step function of stored state, never of elapsed time.**
   `comfortCrossing` (`clock.ts:60-67`) solves the escape instant algebraically by
   dividing by a *constant* fit. A time-varying enrichment forces a piecewise
   segment walk through `comfortCrossing`, `escapeAt`, `accruedIncome`, the
   `/park view` badge and both alert predicates — exactly the cost that made 1a
   refuse a piecewise hunger drain.
2. **Fit never drops below 0.5 and never exceeds the cap.** At fit 0 the
   `hungerThreshold >= hungerAtFed` branch (`clock.ts:64`) collapses `escapeAt` to
   `lastFedAt + GRACE_MS` — an instant 8-hour escape clock. The floor is
   structural: the 0.5 and 0.75 branches return before enrichment is consulted.
3. **Enrichment requires the correct diet.** A wrong-diet paddock short-circuits at
   0.5 before decor is examined, however enriched it is. Unchanged from today, and
   it keeps the diet decision primary.
4. **`comfortAt` stays cheap.** It runs once per trapezoid breakpoint per dino
   inside `accruedIncome`, and breakpoints already include the hunger-100 knee plus
   every UTC midnight crossed (`clock.ts:111-116`). `matchedKindCount` is a Set
   build over an already-loaded array — no DB read, no per-id work, consistent with
   the batch-per-user rule the escrow locks established.
5. **Enrichment pays a small neglect premium, knowingly.** For a low-hunger dino
   the escape clamp inside `accruedIncome` (`clock.ts:96-97`) moves with fit, so the
   earning window stretches too: a rescued dino at `hungerAtFed = 50` gains ×1.28
   at fit 1.25 against a linear ×1.25. At the shipped rungs the effect is under a
   percent, and `hungerAtFed < 100` is only reachable via `rescueDino`. Recorded so
   it is not rediscovered as a bug.

### Alert re-fire: a tolerance is required

Decorating moves a dino's escape instant *slightly* — 34 minutes at the first rung,
65 at the second — which leaves the dino **inside** the 12-hour heads-up window,
unlike feeding, which pushes it clear. `alreadySent` compares `firedForMs` rather
than row existence (`src/modules/park/alert-record.ts:34`), by design, so each move
earns one fresh DM. With decor that becomes up to **four escape DMs per hour per
user** during a decorating spree (`SWEEP_MS` is 15 minutes), and `/park alerts
state:off` is the only mitigation that exists today.

So `alreadySent` gains a tolerance: a stored instant within
`ALERT_INSTANT_EPSILON_MS` (2 h) of the new one counts as already warned. Two hours
is chosen to sit above the largest enrichment move (65 min) and below the smallest
move any *care* action produces — feeding pushes the instant by a day or more and
usually clear of the window entirely. Row-existence comparison is **not** an option:
it would suppress the legitimate re-entry case where a fed dino leaves the window
and later returns with a genuinely new instant, which is the exact bug 1b's
`firedForMs` comparison exists to prevent.

## 5. The decor catalog

**Today's catalog cannot support the mechanic.** Kinds per biome
(`src/data/decor.ts:3-14`):

| Biome | Kinds today | Species |
| --- | --- | --- |
| forest | palm_tree, fern | 10 |
| plains | boulder, grass_tuft | 11 |
| swamp | fern, reed_bed | 4 |
| marine | kelp_bed, hydrothermal_vent | 4 |
| containment | containment_fence, floodlight_rig | 5 |
| **coast** | **tide_pool** | 2 |
| **tundra** | **ice_block** | 2 |
| **volcanic** | **lava_rock** | 3 |

Reachable distinct matching kinds, computed across all 42 species × 12 entries:
**1 kind for 4 species** (`ceratosaurus`, `quetzalcoatlus`, `cryolophosaurus`,
`nanuqsaurus`), **2 for 34**, **3 for 4** (`archelon`, `mosasaurus`, `indominus`,
`indoraptor` — all multi-tag). So on today's table the first rung is unreachable
for four species and the cap for thirty-eight. `tests/roster.test.ts:40-47` guards
only "every biome tag is offered by ≥1 kind" and would not catch it. This is the
same class of content asymmetry as 1a's defect §8.3, where the tundra biome matched
zero species at all.

**2a therefore extends the catalog to three kinds per biome** — eleven new
single-tag entries, 12 → 23 — and gates the property rather than the count:

```
for every species in allSpecies():
  enrichingKindsFor(species).length >= ENRICHMENT_CAP_KINDS
```

New kinds are pure data. Decor has **no per-kind art** — the park renderer draws
`Math.min(lot.decorCount, 5)` generic markers (`src/core/render/draw.ts:140`) — so a
kind costs a row in `DECOR` and nothing in `assets/` or the emoji pipeline.

**`/decorate item` converts from `addChoices` to autocomplete.** The option is built
statically from `DECOR` (`src/modules/park/index.ts:281`) and Discord caps a choice
list at 25 — but the failure is worse than a cap: `addChoices` throws
`Invalid number value` on the 26th choice at **builder construction**, and
`parkModule` is a module-level const, so breaching it is a **bot-boot crash**, not a
degraded command. Eleven new kinds reach 23, leaving room for exactly one more —
and 2b ships a prime line. Converting here, while the file is open, removes the
ceiling permanently.

The provider follows the standing contract: `i.respond(...)` only, never
`getOrCreateUser`, read-only, degrading to an empty list on error, with
`src/modules/admin/index.ts:111` as the template. Its labels name the biomes each
kind serves — a decor purchase is **permanent**, since no removal path exists short
of `adminReset`, so the buying surface is where a mistake must be prevented. Custom
emoji tags stay out of those labels: Discord renders them as literal text in
autocomplete.

Adding an option flagged `.setAutocomplete(true)` requires a matching entry in
`AUTOCOMPLETE_OPTIONS` (`tests/contract.test.ts:12`), enforced bidirectionally at
`:58-66`. The builder change requires `npm run deploy-commands`, exactly one bot per
token.

## 6. Display

Enriched fit above 1.0 is a new regime for the one surface that renders comfort.

- **`/dino list`** prints `${Math.round(d.comfort * 100)}% comfort`
  (`src/modules/park/index.ts:51`) — verified to be the only comfort display in the
  codebase: `dashboardPayload` has no comfort field, `ParkSnapshot` has none,
  `alertPayload` has none, and no `/dino view` exists. Comfort clamps at 100% there
  and enrichment shows as its own value beside it, rather than inflating a number
  whose meaning is "is this animal all right". This also keeps
  `docs/gameplay.md:322-327`'s written statement that comfort does not exceed 100%
  true. `listDinos` (`park/dinos.ts:77-86`) returns the enrichment multiplier
  alongside `comfort`, derived from the same `ClockDino`; the clamp lives at the
  render site so the data stays raw.
- **`/park view`'s dashboard** is left alone. The at-risk badge
  (`park/index.ts:136-140`) needs no change either way: it reads `escapeAt`, which
  already reflects enrichment through `comfortCrossing`. An earlier draft of this
  section promised a per-paddock enrichment line here; it was **cut** (§15) rather
  than implemented, so `src/modules/park/embeds.ts` is untouched and `/dino list` is
  the single surface that renders the rung.
- **Park rating** is unchanged, through `baseComfortAt` (§3) — no clamp, no new
  display, nothing to reconcile.
- **The park PNG is deliberately untouched.** `tests/render-draw.test.ts:163-165`
  asserts byte-identical output across two calls and `:174` samples pixel (260,210)
  as clear background; the HUD has a ~476px budget with three chips in it; and
  `renderParkPng` must stay synchronous and clock-free. An enrichment glyph is the
  only change here that could cost the whole park image, for the least gained.

**A consequence worth stating because it is the absence of a problem.**
`recomputeRating` has 13 call sites and **none of them is `/park view` or
`collectIncome`** — `docs/gameplay.md:786-788` says so in writing. So under any
rating-changing design, nobody's number moves at deploy; each player's moves at
their next feed, build, assign, hatch, sell or trade, and two players can disagree
about whether a 400-rating trade gate is met with no discoverable cause. Because
rating is untouched here, that entire staggered-rollout failure mode does not exist
for this spec — which is a second, independent reason for decision 4.

## 7. `/dex`

A read-only compendium over `allSpecies()` — 42 species: 8 common, 9 uncommon,
9 rare, 8 epic, 5 legendary, 3 mythic.

- **`/dex list [rarity] [diet] [archetype] [page]`** — paged via `paginate` and
  `pageRow` (`src/core/paginate.ts`, `PAGE_SIZE = 10`, so 5 pages), copying
  `achievementsPayload` (`src/modules/daily/embeds.ts:92`) for shape. Each row shows
  the rarity gem, the name, and whether the reader has ever owned it. The `dex`
  component prefix is free.
- **`/dex view <species>`** — one species: rarity, diet, archetype, flavor,
  incubation time and income rate derived from `RARITY`, the archetype×diet artwork,
  first-owned date if any, and **the decor kinds that enrich it**, from
  `enrichingKindsFor`. A species option cannot use `addChoices` (42 > 25), so
  autocomplete is mandatory; the provider matches names over static data and needs
  no DB read at all.

Both surfaces read `species_seen` **once per invocation** and test membership in
memory — one query returning the reader's whole seen set, never a lookup per row.
This is the same batch-per-user rule the escrow locks established, and the reason
`locksFor` deliberately has no per-id `isLocked`.

Locked entries show the species **name** — the dex is a plannable checklist, not a
discovery puzzle. Hiding names would also turn a pure `allSpecies()` provider into a
DB read on every keystroke.

Art is the existing eight archetype×diet cutouts across all 42 entries. Per-species
art was considered and deliberately declined in earlier work; that stands, and it is
what keeps adding a species a data-only change.

**Registration cost — five sites**, per the standing checklist:

| Site | Change |
| --- | --- |
| `modules.json` | add `dex` |
| `src/core/module-list.ts` | add to `ALL_MODULES` |
| `tests/registry-load.test.ts:9,10` | 14 → 15 modules, 25 → 26 commands |
| `tests/config.test.ts:22` | add `dex: true` to the expected map |
| `tests/contract.test.ts:49` | 25 → 26 top-level commands |

Plus `AUTOCOMPLETE_OPTIONS` entries for `/dex view`'s species option and
`/decorate`'s converted item option. `src/index.ts` and `src/deploy-commands.ts`
both import `ALL_MODULES` and need no edit.

## 8. `species_seen`

```
species_seen(user_id TEXT NOT NULL REFERENCES users(discord_id),
             species_id TEXT NOT NULL,
             first_at_ms INTEGER NOT NULL,
             PRIMARY KEY (user_id, species_id))
```

Modeled on `alerts_sent` (`src/core/db/schema.ts:197-211`) and for the same reason:
it records that **a side effect happened**, not a value re-derivable at read time.
Escrow locks and quest progress are derived precisely because their inputs survive,
while ownership is destructive — `/sell` deletes the dino row, trading moves it,
`adminReset` deletes it, hatching deletes the egg. `tx_log` carries no species
column, so history cannot be mined from it either.

**Migration 0010** (`drizzle/meta/_journal.json` ends at `idx: 9`,
`0009_park_alerts`). It must be a plain `CREATE TABLE`, never a table recreate:
`drizzle-kit` will happily emit a `__new_users` / `DROP TABLE` recreate, which
passes every empty-DB test and **fails on a populated production database even with
`migrateDb`'s FK bracket**, because `PRAGMA foreign_keys` is a no-op inside
drizzle's per-migration transaction. Inspecting the emitted SQL is a named plan
step, not an assumption.

**Write sites — three, all already inside transactions:**

| Site | Why |
| --- | --- |
| `src/modules/hatchery/service.ts` `hatchEgg` | the only player-facing dino mint; sits beside the existing `track()` call |
| `src/modules/admin/service.ts` `adminGive` | the only other `insert(schema.dinos)` in the codebase |
| `src/modules/trading/service.ts` `moveItems` | otherwise a trade recipient is never credited for a species they now own |

`INSERT OR IGNORE` on the composite key makes every write idempotent, so
re-acquiring a species keeps the original `firstAt`.

**Backfill: from live inventory, once, at ship.** The alternatives were weighed and
rejected — shipping empty makes a 10★ park read 0/42, and granting credit by
`ratingHighWater` tier fabricates history. The accepted cost is that a species
deliberately sold before this ships reads as never owned. The backfill is a plain
`INSERT OR IGNORE ... SELECT DISTINCT` over `dinos`, run as an operator step after
the migration, never as migration SQL — so re-running it is safe and a failure does
not block boot.

**Never substitute the ever-owned set into `recomputeRating`'s `owned` map**
(`park/rating.ts:13`). That retroactively raises every veteran's rating and, through
monotone `ratingHighWater`, permanently unlocks slots, sites, shop tiers and the
mythic egg for nobody who earned them.

## 9. Admin

- **`adminReset` deletes `species_seen` rows.** The standing lesson — reset must
  cover every table the feature reads — is recorded three separate times in that
  function's own comments (breedings, then the daily-loop tables, then
  `alerts_sent`). This is not consent-style state like `alertsEnabled`, so it is
  deleted, not preserved.
- **`adminFastForward` leaves `first_at_ms` alone**, deliberately: a historical
  record with no timer semantics, where shifting would only misdate a discovery.
  Noted in the function's comment block so the omission reads as a decision rather
  than the miss `breedings.readyAt` currently is.
- **Enrichment itself stores nothing.** It derives from `lots.decor`, which reset
  already deletes and fast-forward has no reason to touch.

## 10. Testing

**New coverage:**

- `enrichmentMult` at every rung boundary, including the cap and one above it.
- **The boundary pin: one matching kind is still exactly 1.0.** This is what
  protects `clock.test.ts:32` / `tundra.test.ts:18` / `dinos.test.ts:65` from a
  later refactor that quietly moves the first rung down.
- `matchedKindCount` dedupes duplicate slugs, ignores unknown slugs, and counts two
  kinds sharing one biome tag as two.
- `paddockFit`: the three existing values unchanged, each rung, and a wrong-diet
  paddock still 0.5 however enriched.
- **The cap keeps the dead window small** — **corrected 2026-08-09**, since the gate
  as originally specified (`max(ENRICHMENT_STEPS) < 1.5`) cannot detect the case this
  spec actually crosses: the boundary is `fit · drainMult > 1.5` (§4 wall 2), and a
  grazer+skittish dino (`drainMult` 1.44) is already past it at both rungs. The gate
  instead derives `MAX_DRAIN_MULT` from the real `TRAITS` table — the product of the
  two largest per-domain `drain` maxima, a dino holding at most two traits and never
  two from one domain — measures the worst reachable window against the real
  `escapeAt` and the real hunger-zero instant, and bounds it by an explicit,
  commented tolerance. A raised cap or a new drain trait moves the gate on its own.
- **The catalog invariant** — every species in `allSpecies()` can reach the cap. A
  gate on the property, so a future kind cannot reintroduce the asymmetry §5 fixes.
  `tests/roster.test.ts:40-47` is extended from "≥1 kind per tag" to "≥ cap distinct
  kinds per tag".
- **A `DECOR` value pin.** `RARITY`, `FACILITIES` and `PADDOCKS` each have a
  `toEqual`-grade data test; `DECOR` has none, so a mistyped or omitted field on any
  entry ships green today.
- `enrichingKindsFor` returns exactly the intersecting kinds, and a multi-tag species
  gets the union.
- **Rating is unchanged by enrichment** — a fully enriched park and a
  single-matching-tile park score identically, and `lotSlots` / `shopCeiling` /
  `mythicUnlocked` are unchanged at saturation. This is the `baseComfortAt`
  regression test, and it must be *watched to fail* by pointing rating at the
  enriched `comfortAt` before it is trusted.
- Downstream exact values at fit 1.05: `comfortAt` = 1.05 at hunger ≥ 100,
  `escapeAt(H0=100)` = 44.5714 h against 44.0 today, `accruedIncome(…, 0, 8, 0, 12 h)`
  = 462 against 440 today. Income is also asserted across a UTC-midnight crossing so
  the piecewise sampling stays honest.
- `rescueDino` still restores exactly 67 hunger at fit 0.75 and 48 at fit 1.05 —
  the assertion that the divisor stayed **unclamped**.
- The `/dino list` row for an enriched dino, pinning the display clamp.
- **The alert tolerance**: decorating a dino already inside the 12-hour window earns
  **zero** extra heads-up DMs; a genuine instant move beyond the epsilon still earns
  exactly one, with the last-call tier left free (`recordEscapeSent` collapses in one
  direction only).
- `/dex list` paging, each filter, the empty result, and the ever-owned marks.
- `/dex view` for a known species, an unknown one, and one never owned; plus its
  autocomplete provider.
- The three `species_seen` write sites, `INSERT OR IGNORE` idempotency, the backfill,
  and the `adminReset` delete.
- **A real migration test** for 0010: scratch directory, journal filtered to
  `idx ≤ 9`, `foreign_keys = ON`, seeding a parent `users` row **and** a child
  `dinos` row, then running the real `migrateDb`. Anything less is a false green —
  `tests/migration.test.ts` says so in a comment at the recipe.
- One `test:live` gallery case per new surface: a `/dex list` page, a `/dex view`
  entry, and an enriched `/dino list` row.

**No existing pinned number moves**, given decision 3 — verified fixture by fixture
across `clock`, `tundra`, `dinos`, `care`, `park`, `stats-sites`, `rating`,
`world-income`, `alert-detect`, `alert-sweep`, `world-effects`, `render-draw` and
`scripts/test-live.ts`. What *is* wrong on disk and still passing is **comment
drift**: `tests/clock.test.ts:11-14,29-31`, `tests/tundra.test.ts:16-17`,
`tests/dinos.test.ts:51-58`, `tests/alert-detect.test.ts:90-98`,
`tests/alert-sweep.test.ts:18-22` and `scripts/test-live.ts:213` all describe fit in
terms that stop being complete. `tests/world-effects.test.ts:825-857` is a specific
trap: its comment implies it exercises full comfort, but it seeds `grass_tuft` on a
**forest** triceratops, so it runs at fit 0.75 with zero matching tiles.

**Two pins must stay neutral, and their failing is the alarm rather than the bug:**
`tests/rating.test.ts:54,91` assert 202 and 400 using *unassigned* dinos, so a leak
into the `assigned.length === 0 ? 0` branch fails them; and
`tests/world-effects.test.ts:863-873` greps `progression.ts` and `rating.ts` for
world imports, structurally forbidding an event-scaled enrichment bonus there.

Every balance number in §4 is simulated before it ships and recorded as a comment at
the constant, not in a commit message. Both prior specs made that rule mandatory
after hand-computed values shipped wrong.

## 11. Documentation

- **`docs/gameplay.md`'s escape-timing table is misleading today, and this spec
  fixes it.** Its "Correct-diet paddock" row (`:351-355`) publishes 40 h / 52 h /
  64 h — the **fit-0.75** figures, correct only for a correct-diet paddock carrying
  *no* matching decor. The table has no row at all for the decorated fit-1.0 case
  (44 h / 56 h / 68 h), which the bullet fifteen lines earlier describes as the
  normal outcome. Not false, but incomplete in a way that reads as false. Corrected,
  with the enrichment rows added.
- `:322-327` (the fit bullet and the "does not push comfort past 100%" sentence),
  `:769` and `:780` describe fit as a three-value boolean; all gain the rungs.
  `src/modules/help/index.ts:29` carries the same summary in-game.
- **`src/modules/daily/service.ts:66-67`** claims `dailyEarningCapacity` "needs a
  ceiling"; that comment is already false by 1.584× today (`facilityBonusPct` max 32
  plus `incomeMultAt` max 1.20 under Heat Wave) and enrichment widens it again.
  Corrected while in the area — practical impact is nil, since the target is clamped
  to `max(500, min(50_000, capacity/2))`.
- `docs/commands.md` gains `/dex list` and `/dex view`, and notes `/decorate`'s
  autocomplete.
- Repo `CLAUDE.md` gains: the rung boundary and why it starts at two kinds; the
  base/enriched split and that `recomputeRating` is `baseComfortAt`'s only caller;
  the 1.5 cliff; the catalog invariant and its gate; the `addChoices` 26th-choice
  boot crash; the alert epsilon; the three `species_seen` write sites; and the
  standing hazard that **retiring a decor kind silently drops every paddock that
  relied on it**, since `DECOR[kind]?.biomeTags` degrades a missing slug to "no
  match" — now costing a rung as well as the old 1.0 → 0.75 fall.

## 12. Size

Roughly **16–19 tasks**, in four groups that can be reviewed independently:

| Group | Work | Tasks |
| --- | --- | --- |
| Enrichment | the `paddockFitBase`/`paddockFit` split, the rungs, the two pure helpers, the display, and the income/escape coverage | 5–6 |
| Catalog | eleven new decor kinds, the reachability gate, the `DECOR` value pin, and the `/decorate` autocomplete conversion | 3–4 |
| Alerts | the `alreadySent` tolerance and its tests | 1–2 |
| `/dex` + `species_seen` | the module, both commands, the autocomplete provider, schema, migration 0010, three write sites, the backfill, `adminReset`, and the migration test | 6–7 |

One migration, one `deploy-commands`, no `deploy-emojis`, no art.

## 13. Ops checklist

1. `npm run typecheck` — the only gate that typechecks tests and scripts, and the
   only thing that would catch a changed `paddockFit` signature.
2. `npm test` offline.
3. `npm run deploy-commands` — 25 → 26 commands; `/decorate`'s option becomes
   autocompleting. Exactly one bot process per token.
4. Restart the bot — migration 0010 applies at boot.
5. Run the `species_seen` backfill once, after the migration.
6. `npm run test:live` — the gallery gains the dex and enrichment cases.

No `deploy-emojis`: this spec adds no emoji, and no art of any kind.

## 14. Invariants for future work

- **Never make enrichment vary with elapsed time.** `comfortCrossing` solves the
  escape instant by dividing by a constant fit; a time-varying term forces a segment
  walk through five call sites.
- **Never let the first rung fire at one matching kind.** Three tests pin one tile ⇒
  exactly 1.0, and that boundary is the reason no existing integer moved.
- **Never let rating read the enriched fit.** `recomputeRating` uses
  `baseComfortAt`; a `Math.min` clamp is not a substitute, because it bounds the
  ceiling and not the sensitivity, and monotone `ratingHighWater` makes any gain a
  permanent unlock.
- **Never raise the cap without re-measuring the dead window.** The boundary is
  `fit · drainMult > 1.5`, not fit 1.5 (§4 wall 2 as corrected): with
  `MAX_DRAIN_MULT` 1.44 the crossing already happens at fit 1.0417, so both shipped
  rungs sit above it with a +3.81 min / +25.45 min window in which a dino earns
  nothing while its grace runs. What must stay true is that the worst *reachable*
  window stays small — `tests/enrichment.test.ts` bounds it — never that some step
  value stays under 1.5.
- **Never clamp `rescueDino`'s `50 / fit` divisor.** The division is what holds
  post-rescue comfort at ~0.5 across the band.
- **Never add a decor kind without checking the catalog invariant** — the test
  enforces it, and the fix is a new kind, never a lowered cap.
- **Never let `DECOR` exceed 25 static choices anywhere.** `addChoices` throws at
  the 26th during module init, which is a boot crash. `/decorate` is autocompleting
  after this spec; any future static choice list over `DECOR` reintroduces the
  hazard.
- **Never re-derive `species_seen` from live inventory.** It records a side effect;
  live inventory is destructive and cannot answer the question.
- **Never feed the ever-owned set into the rating collection term.**

## 15. Out of scope

- **Veteran ranks, the prime decor sink, Hatchery L4–L5** — 2b. The sink needs 2a's
  channel; Hatchery L4–L5 must be balanced against the sink's pricing because it
  moves maximum lot levels 38 → 40 and saturates the park rating term on levels
  alone. For 2b's benefit, the simulated floor is recorded here: at a +0.05 grant the
  worst case is eight mythics in an L4 paddock earning +114,048/day, so a 30-day
  payback floor is **3,421,440** and the recommended price is **5,000,000** — a 42×
  jump over the 120,000 legendary egg, and unreachable mid-game by construction
  (a no-facility epic paddock repays it in 1,420 days). Below ~3.4 M a prime tile is
  a rebate, not a price. Note also that *every* finite price is a faucet at some
  horizon, since the buff is permanent and the payback linear.
- **Any reward for dex completion** — the rating side is closed by a frozen
  `COLLECTION_TARGET`, and discovery count is 2b's rank input instead.
- **An enrichment glyph on the park PNG** — the one change here that could cost the
  whole park image, for the least gained.
- **A `/park view` dashboard enrichment line** — promised by §6 in an earlier draft and
  **cut during implementation** (recorded 2026-08-09). `/dino list` already names the
  rung per dino, which is where the rung is actionable, and the dashboard aggregates
  per-park figures rather than per-paddock ones. Nothing in code or docs claims the
  line exists, so this is a scope cut, not a defect; `src/modules/park/embeds.ts` was
  never touched by this spec.
- **Per-species artwork** — declined by earlier design and still declined; the
  archetype×diet keying is what keeps a new species a data-only change.
- **A decor removal or refund path.** Decor is append-only today. Enrichment makes
  tile choice matter more, which is answered here by naming biomes in the
  autocomplete labels and listing enriching kinds on `/dex view`, not by a refund
  mechanic. When 2b prices a tile at 5,000,000, revisit it there.
- **The decor-spam rating purchase.** One paddock (2,000) plus 39 grass tufts
  (15,600) buys the entire 350-point park term for **17,600 cash**, since
  `parkRaw = 40 = PARK_TARGET`. Live on `main`, independent of enrichment, and
  closing it would be a retroactive rating nerf to every park that used it —
  which, through the trade gate at 400, can take `/trade` away. Left alone
  deliberately; 2b is where the park term gets revisited.
- **Hatch-speed effects.** `incubationMs` has exactly one reader and no modifier
  path; a hatch-speed bonus is a new mechanism, not a table entry.
