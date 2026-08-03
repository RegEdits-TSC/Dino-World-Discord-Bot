# Gene Lab — traits, breeding, and the shard economy

Sub-project 1 of a three-part endgame roadmap. Adds heritable traits to every
dino, a `/breed` pairing system behind a new Gene Lab facility, and `/splice` as
the game's first repeatable shard sink. Replaces the denormalized escrow lock
with a derived one.

## 1. Why

Dino World's endgame is thin in four specific ways:

| Gap | Evidence |
| --- | --- |
| Shard economy is degenerate | One sink: 500 shards for a Mythic egg. No screen shows a shard balance |
| Endgame cliff | Rating caps at 5.0★, the campaign ends at chapter 4, lots cap at 8 |
| Dinos are interchangeable | Same rarity means identical. `nickname` exists in the schema with no writer |
| No breeding | A dino park with no breeding. Eggs come only from shop, expedition, and battle |

The Gene Lab closes all four with one system. Traits make individual dinos
worth keeping, breeding makes them worth pairing, and splicing gives shards
somewhere to go — permanently, since a re-roll is repeatable and uncapped.

### Roadmap position

1. **Gene Lab** (this spec) — endgame depth
2. Daily loop — quests, streaks, achievements, paying into the sinks this spec
   creates
3. Content volume — chapters 5–8, new sites, new species; data-only per the
   repo conventions

Order matters: a daily quest that pays shards is worthless until shards buy
something.

### Scope decisions taken during design

- **Live data is disposable.** The bot runs on a dev guild only, so no
  backfill-fairness constraint applies. Migrations still add columns cleanly;
  `/admin reset` covers the rest.
- **Prestige is not in scope.** A park wipe for permanent multipliers is the
  third endgame layer, not the first, and carries real churn risk on a small
  player base.
- **A research tree is not in scope.** Account-wide permanent unlocks remain a
  candidate for a later round; traits deliver individuality, which a tree
  cannot.

## 2. Architecture

### New files

| Path | Purpose |
| --- | --- |
| `src/data/traits.ts` | `TRAITS` table: id, name, domain, polarity, modifier vector, unicode fallback. Pure data |
| `src/core/locks.ts` | Derived lock state, replacing the `locked` columns |
| `src/modules/genelab/index.ts` | `ModuleManifest` — `/breed`, `/splice`, autocomplete providers |
| `src/modules/genelab/service.ts` | `startBreeding`, `claimBreeding`, `splice`, `rollTraits`, `inheritTraits` |
| `src/modules/genelab/embeds.ts` | Payloads, art wiring via `attach` |

### Schema

One drizzle migration:

- `dinos.traits` — JSON `TraitId[]`, default `[]`
- `eggs.traits` — JSON `TraitId[]`, default `[]`
- new `breedings` table — `id, userId, parentA, parentB, rarity, speciesId,
  traits, viaTrade, startedAt, readyAt, claimedAt`
- **drop** `dinos.locked` and `eggs.locked`

`breedings.traits` and `breedings.speciesId` hold the rolled outcome so that
claiming is a pure transfer rather than a second roll — the roll happens once,
at claim time, and is then immutable.

### Where trait modifiers hook in

`ClockDino` (`src/core/clock.ts:10`) already carries species, paddock, and
decor for every income, comfort, and escape calculation in the game. Traits
ride on it as one more field, so **income and hunger-drain effects land in
`clock.ts` alone**. `toClockDinos` (`src/modules/park/service.ts:117`) is the
single mapper that populates it.

Combat effects hook `statsFor` (`src/data/battle/stats.ts:36`), which needs its
signature widened from `(speciesId, level)` to accept traits. Enemy and boss
combatants must **not** receive traits.

Feed-cost effects hook the feed path in the care module; battle-XP effects hook
wherever `dinos.battleXp` is written.

## 3. Traits

Traits roll **at hatch**, alongside the species roll, using `ctx.rng()`.

Odds are **independent of rarity**. A Common can roll two strong traits. This
is deliberate: it makes cheap Commons worth breeding with, which keeps the Gene
Lab from being endgame-only content.

| Outcome | Chance |
| --- | --- |
| 0 traits | 55% |
| 1 trait | 35% |
| 2 traits | 10% |

### The domain rule

Traits belong to one of four domains, and **a dino can never hold two traits
from the same domain.**

This single structural rule does three jobs: it makes cancelling pairs like
*Prolific + Runt* impossible, it guarantees a two-trait dino is interesting on
two different axes, and it gives `/splice` an unambiguous re-roll rule.

### The pool

| Domain | Trait | Effect | Polarity |
| --- | --- | --- | --- |
| Income | Prolific | +15% income | + |
| Income | Runt | −10% income | − |
| Income | Grazer | +20% income, +20% hunger drain | ± |
| Care | Hardy | −25% hunger drain | + |
| Care | Thrifty | −25% feed cost | + |
| Care | Skittish | +20% hunger drain | − |
| Care | Gluttonous | +25% feed cost | − |
| Combat | Savage | +12% attack | + |
| Combat | Ironhide | +12% defence | + |
| Combat | Fleet | +12% speed | + |
| Combat | Glass Cannon | +25% attack, −15% HP | ± |
| Combat | Frail | −10% HP | − |
| Meta | Prodigy | +20% battle XP | + |
| Meta | Fertile | −25% breeding time | + |

Fourteen traits: eight positive, four negative, two mixed. Every effect is a
multiplier on a value the code already computes in exactly one place.

### Deliberate exclusions

- **No trait touches park rating directly.** `park/rating.ts` is untouched. Care
  traits move rating indirectly through comfort, which is correct and needs no
  code.
- **No trait affects paddock fit.** `paddockFit` caps at 1.0 and already carries
  a decor-biome bonus; a fit trait would couple the two silently.

## 4. Breeding

### The Gene Lab facility

A fourth facility kind. `FacilityDef` gains one optional field,
`breedingSlots?: number[]`, exactly as `hatchery_lab` carries `incubatorSlots`.
`facilityBonusPct` iterates `Object.keys(FACILITIES)`, so an
`incomeBonusPct: [0, 0, 0]` row makes the kind inert everywhere it is not
wanted.

| Gene Lab level | Breeding slots | Cost to reach |
| --- | --- | --- |
| 1 | 1 | 20,000 (build) |
| 2 | 2 | 60,000 |
| 3 | 3 | 250,000 |

This is the design's primary cash sink, and it **costs a lot slot**. Four
facility kinds now compete for a maximum of eight slots, so a player who wants
maximum paddock capacity cannot have everything. That is the first real build
tradeoff in the game.

`buildLot`'s comment at `src/modules/park/service.ts:64` states "3 facility
kinds" and must be updated. The existing `DuplicateFacilityError` applies
unchanged: one Gene Lab per park.

### Pairing rules

Both parents must be: owned by the caller, **the same rarity**, **the same
diet**, assigned to a paddock, not escaped, not locked, not the same dino, and
at **hunger ≥ 50** when breeding starts.

The hunger gate is deliberate — it wires the care loop into the endgame instead
of leaving feeding as a chore players outgrow.

**Mythics cannot breed at all**, matching their existing can't-sell and
can't-trade treatment.

### Flow

```
/breed start parent-a parent-b
  → validate, then confirm button
  → charge cash fee
  → insert breedings row, readyAt = now + duration(rarity)
  → both parents locked (derived; see §5)
  → timer fires → "Breeding complete" notification
/breed claim
  → egg lands in inventory (source: 'breeding'), NOT auto-incubated
  → parents unlock and enter cooldown
```

The timer and notification copy the expeditions module end to end: scheduler
registration, `timers` table row, notify handler, payload.

| Rarity | Breeding time | Cooldown after claim | Cash fee |
| --- | --- | --- | --- |
| Common | 30 min | 30 min | 200 |
| Uncommon | 2 h | 2 h | 800 |
| Rare | 6 h | 6 h | 3,000 |
| Epic | 18 h | 18 h | 10,000 |
| Legendary | 36 h | 36 h | 40,000 |

Fees are 33–40% of the equivalent `/shop egg` price (500 / 2,000 / 8,000 /
30,000 / 120,000). Breeding is *intended* to beat the shop on cash-per-egg: it
is throttled by requiring two matching dinos, a lot slot, and real elapsed
time, where the shop is instant and needs nothing but cash.

The arithmetic, at the 10% upgrade rate:

- **Rare → Epic**: 10 expected breeds × 3,000 = 30,000 gross, minus 9 spare
  Rares sold back at 500 = 4,500, **net 25,500** against the shop's 30,000. A
  deliberate 15% discount. Cash-neutral parity would be a fee of 3,450.
- **Epic → Legendary**: 10 × 10,000 − 9 × 1,500 = **net 86,500** against the
  shop's 120,000, a 27.9% discount — and the shop only offers a Legendary egg
  on **9.87%** of days, so breeding is the practical Legendary route. That is
  the intended shape.
- **Legendary → Mythic must stay impossible.** 10 × 40,000 − 9 × 5,000 =
  355,000 net, which is 2.2 hours of a maxed park's income, against 500 shards
  = 8.3 days of capped supply. Allowing it would destroy the shard economy
  outright. The same reasoning is already recorded in
  `src/data/battle/chapters/volcano_core.ts:4-5`, which pins the finale trophy
  egg to Legendary for exactly this reason.

The byproduct that would break parity is **shards, not cash**: nine spare Rares
sold carry 9 × 11.5 = 103.5 shards of expected value. The rolling daily shard
cap is what clips that, and it is the reason breeding is not a shard printer.

**Cooldown needs no column.** It derives from the most recent claimed
`breedings` row containing that dino — the same principle as the lock rework:
one source of truth rather than a second denormalized cache.

A breeding parent **can still battle**, consistent with the existing rule that
locked dinos may fight, since battling neither consumes nor transfers a dino.

### Inheritance

Rolled once, at claim, through `ctx.rng()`:

- **Trait pool** = the union of both parents' traits.
- **Slot count** beats a wild hatch: 25% / 45% / 30% for 0 / 1 / 2 traits,
  against the wild 55 / 35 / 10. That gap is the entire reason to breed.
- **Each slot**: 70% drawn from the parent pool, 30% mutation from the full
  pool. The domain rule still applies. An empty parent pool means every roll is
  a mutation.
- **Rarity**: 10% chance to upgrade one tier. The upgrade **caps at Legendary**,
  so a Legendary pair has no upgrade roll and breeding can never mint a Mythic.
- **Species**: if both parents are the same species, the egg is pinned to it.
  Otherwise species rolls at hatch as normal. This gives same-species pairing a
  purpose without requiring it.
- **Provenance**: `egg.viaTrade = parentA.viaTrade || parentB.viaTrade`. See §7.

## 5. The lock rework

### The problem

`dinos.locked` and `eggs.locked` are booleans. `createTrade` is the only writer
of `true`. A trade expires on a *timestamp*, but the lock is a *stored boolean*,
so every reader must first call `expireStale` to flush stale locks. That sweep
count has grown 0 → 6 → 14 across three PRs, and the repo's own conventions
carry a standing note: if it needs to grow again, derive lock state from the
trades table and drop the column rather than add a fifteenth call site.

Breeding needs the fifteenth call site.

### The replacement

Drop both columns. Add `src/core/locks.ts`:

```ts
export type LockReason =
  | { kind: 'trade'; tradeId: number }
  | { kind: 'breeding'; breedingId: number };

export function lockedDinos(ctx: Ctx, userId: string): Map<number, LockReason>;
export function lockedEggs(ctx: Ctx, userId: string): Map<number, LockReason>;
```

Two properties carry the design:

**Batch-per-user, not per-row.** Callers fetch one map and test membership. A
per-id `isLocked(dinoId)` would be an N+1 inside `/dino list` and inside every
autocomplete handler; this shape makes that impossible by construction.

**Expiry stops being a correctness problem.** A dino is trade-locked if and only
if a row exists with `status = 'pending' AND createdAt + 24h > now`. The
predicate is evaluated at read time, so a stale lock cannot exist and there is
nothing to sweep. `expireStale` survives only to flip `status` for display and
history; it is no longer load-bearing, and the bug class chased across four
surfaces in PR #9 stops being reachable.

**It is also faster.** `expireStale` filters by user in JS, so every call scans
all pending trades globally — including at keystroke-rate autocomplete sites,
and including dead trades between two players who both quit. The derived query
filters by user in SQL.

### Migration hazard — and one that does *not* apply

Dropping a SQLite column is a table recreate. The obvious worry is
`migrateDb`'s `foreign_keys = OFF` / `ON` bracket, which exists because
`DROP TABLE` fails against child rows on a populated database.

**That hazard does not apply here.** `dinos` and `eggs` are FK *children only* —
nothing in the schema references `dinos.id` or `eggs.id`. The bracket exists
for recreating a **parent** table, and both historical cases
(`drizzle/0001_diet_food_types.sql`, `drizzle/0003_tricky_zuras.sql`) recreate
`users`, which parents seven tables. Recreating a leaf table cannot trigger it.

The real risk for this migration is **row preservation in the
`INSERT … SELECT`** — silently dropping or mis-mapping dino and egg rows. The
migration test must therefore seed populated `dinos` and `eggs` tables, run the
real `migrateDb`, and assert row counts and column values survive. An empty-DB
test proves nothing about that.

### Scope honesty

This touches roughly fourteen existing call sites plus their tests and delivers
no player-visible feature on its own. It is included anyway because breeding
doubles the lock surface, and doing it afterwards means reworking twice as much
code. It should land as its own reviewable slice.

## 6. Commands and presentation

| Command | Notes |
| --- | --- |
| `/breed start` | Autocomplete: `parent-a`, `parent-b`. Confirm button before charging |
| `/breed status` | Active pairings and countdowns |
| `/breed claim` | Collects finished eggs |
| `/splice` | Autocomplete: `dino`, `slot`. Confirm button showing cost and stakes |
| `/dino rename` | Joins the existing `/dino` group; revives the dead `nickname` column |

### Splice

`/splice` re-rolls one trait slot for shards.

- On a 0-trait dino it **adds** a trait, drawn from the full pool — it can hand
  you a Runt.
- On a 1- or 2-trait dino the player picks the slot; the replacement draws from
  any domain the *other* trait is not using.

Splice is a genuine gamble, which is what makes it a repeatable sink rather
than a one-time purchase.

**Price: a flat 15 shards, with no per-dino escalation.**

**`SHARD_DAILY_CAP` rises from 40 to 60** (`src/data/sell.ts:2`, a single
constant read only by `src/modules/shop/shards.ts`). This is required, not
incidental: at 40/day a 15-shard splice starves the existing Mythic sink.

| Splices/day | Shards left | Days to a 500-shard Mythic |
| --- | --- | --- |
| 0 (today, cap 40) | 40 | 12.5 |
| 1 (cap 40) | 25 | 20.0 |
| 2 (cap 40) | 10 | 50.0 |
| 2 (cap 60) | 30 | 16.7 |

At cap 60 a player affords 4 splices/day. Perfecting both slots on one dino is
roughly 22 rolls — about 5.5 days at full cap — which is a healthy endgame
chase rather than a degenerate one, and it needs no per-dino counter or decay
rule. Deliberately no escalation: the extra state is not worth what it buys.

### The reveal

Traits on a bred egg are rolled at claim and stored on `eggs.traits`, but never
displayed until `/hatch`. At hatch:

```ts
traits = egg.source === 'breeding' ? egg.traits : rollTraits(ctx.rng)
```

Discriminating on `egg.source` rather than `egg.traits.length` is load-bearing:
a bred egg legitimately inherits zero traits 25% of the time (the bred slot
odds are 25/45/30 for 0/1/2 traits), so a length check would silently re-roll
those on wild odds instead of keeping the stored — empty — inheritance. Bred
eggs use their stored inheritance; wild eggs roll fresh. `/hatch` now reveals
species *and* traits in one press, which improves the existing reveal rather
than adding a second one.

### Autocomplete

Providers only ever call `i.respond(...)`, never `getOrCreateUser`, and stay
read-only. The lock rework helps directly: `lockedDinos()` is a plain read, so
`/breed start`'s pickers filter out locked and cooling-down dinos with no write
and no sweep — cleaner than the `expireStale`-in-autocomplete exception the
trading module needs today.

Trait names appear in autocomplete labels, so `TRAITS` entries carry a
`fallback` unicode alongside the custom-emoji id, exactly as `FoodDef.fallback`
does: Discord renders custom emoji tags as literal text in autocomplete.

### Art

No new asset kind. `assetImage`'s kinds are enumerated in tests, so adding one
has a cost and no benefit here.

| Asset | Path | Notes |
| --- | --- | --- |
| Gene Lab banner | `assets/images/banners/gene_lab.webp` | 1536×1024, existing `banners` kind |
| Splice banner | `assets/images/banners/gene_splice.webp` | Distinct basename; attachment names are basenames only |
| Park map icon | `assets/emojis/svg/dw_gene_lab.svg` | The park renderer needs SVG for synchronous decode; a raster renders blank |
| Trait domain emojis | `assets/emojis/svg/dw_trait_*.svg` | Four, one per domain |

Prompts go into `docs/assets/prompts.md` in the same pass. All wiring uses
`attach(embed, payload, slot, assetImage(...))`; hand-assigning `payload.files`
is banned by `tests/images.test.ts`.

Emoji lookup happens at render time, never in a module-level constant — the
emoji map loads after client ready, so a module constant would freeze the
unicode fallback permanently. No trait emoji is passed to
`ButtonBuilder.setEmoji`.

### Also updated

- A `genelab` topic in `HELP_TOPICS`, which changes `/help`'s builder choices
- `src/data/render-icons.ts` gains a `gene_lab` fallback glyph — that file is
  the live fallback path, not dead code
- `docs/gameplay.md` — the new Gene Lab section, the shard cap moving from 40
  to 60 in §11, the shard-sink list in §2, and the `paddockFit` documentation
  gap below
- `docs/commands.md` — the new command rows, and `:81`'s hard-coded "across
  nine topics" for `/help`
- `CLAUDE.md` — the module-registration checklist, which says four sites and is
  actually five

`npm run deploy-commands` is mandatory for this release: new builders, plus
`/dino` and `/help` both gain choices. Exactly one running bot instance per
token.

### Module registration checklist

`ModuleManifest` has **three required fields**, no optionals:
`{ name, commands, components }`. A module with no buttons must still write
`components: []`.

`ModuleRegistry` enforces two uniqueness invariants at construction time — it
*throws*, it is not a test: no duplicate command name and no duplicate
component prefix across enabled modules. One module may register multiple
prefixes (hatchery registers both `hatch` and `mythic`), so Gene Lab uses
`breed` and `splice` as separate prefixes rather than one wide switch.

CLAUDE.md documents a four-site registration checklist. It is **five**:

| # | Site | Change |
| --- | --- | --- |
| 1 | `modules.json` | add `genelab` |
| 2 | `src/core/module-list.ts` | add to `ALL_MODULES` |
| 3 | `tests/registry-load.test.ts` | 11 → 12 modules, 20 → 22 commands |
| 4 | `tests/config.test.ts` | expected-modules object gains a key |
| 5 | `tests/contract.test.ts:46` | `expect(body).toHaveLength(20)` → 22 |

Site 5 is the one CLAUDE.md omits; the repo conventions should be corrected in
this round. `tests/contract.test.ts` also enforces a **bidirectional**
autocomplete manifest: any option flagged `.setAutocomplete(true)` must appear
in `AUTOCOMPLETE_OPTIONS` keyed `'command'` or `'command sub'`, and vice versa.
This is the guard that would have caught the dead `/sell` autocomplete.

Conditionally, `scripts/test-live.ts` lists its gallery cases by hand, so
`/breed` and `/splice` will not appear in the live sweep unless added there.

### Documentation defect found during design

`paddockFit` (`src/core/clock.ts:20`) returns **1.0** when a paddock's decor
biome matches the species' `biomeTags`. `docs/gameplay.md` §7 documents only
0.75 and 0.5 and never mentions the decor-to-comfort bonus at all. The code is
correct; the documentation is incomplete. Fixed in this round.

## 7. Correctness hazards

### Provenance must survive breeding

A dino received via trade carries `viaTrade: true` so it sells for zero shards.
That guard closes an alt-to-main shard funnel and already had to be re-closed
once, at the hatch boundary, in PR #8.

Breeding reopens it: receive a dino via trade, breed it, sell the offspring for
full shards.

**Rule:** `egg.viaTrade = parentA.viaTrade || parentB.viaTrade`, riding through
the hatch on the existing path. Required behavior with a dedicated regression
test.

### Per-dino drain and the income knee

`accruedIncome` is piecewise across the hunger-100 knee. Both the knee
(`src/core/clock.ts:75`) and `hungerZero` (`src/core/clock.ts:68`) are computed
from the global `HUNGER_DRAIN_MS`. Once drain becomes per-dino, **every one of
those expressions must use the dino's modified rate.** Missing one silently
over- or under-pays a Hardy or Skittish dino across the knee.

A two-point test cannot see this. The regression test must straddle the knee
with a drain multiplier other than 1.0.

### The drain change breaks nothing that `npm test` can see

`hungerAt(hungerAtFed, lastFedAt, at)` is the **only** clock function needing a
signature change — every other one (`comfortAt`, `escapeAt`, `escapeMoment`,
`accruedIncome`, and the private `comfortCrossing`) already receives the whole
`ClockDino`, so a trait multiplier carried as a field reaches them with their
signatures untouched. Only their bodies change.

Its call sites: `src/core/clock.ts:29`, `src/modules/care/index.ts:110` (two
calls on one line), `src/modules/care/service.ts:55`, plus three in
`tests/clock.test.ts`.

The awkward one is `src/modules/care/index.ts:110` — an **autocomplete**
handler working on raw `schema.dinos` rows with no `ClockDino`, no lot, and no
paddock in scope. It must source the multiplier from the row itself or from the
`getSpecies(d.speciesId)` already computed a line above.
`src/modules/care/service.ts:55` is easy by comparison: it maps `dinos` with an
index into a parallel `clockDinos` array, which already carries the new field.

**The breakage is typecheck-only.** `npm test` (vitest) transpiles without
typechecking and `npm run build` only includes `src`, so a stale call site or a
`ClockDino` literal missing the new field passes both gates clean. At runtime
the absent multiplier propagates `NaN` through
`hungerAt → comfortAt → accruedIncome`, and `Math.floor(NaN)` at
`src/core/clock.ts:81` **pays NaN cash, silently**. `npm run typecheck` is the
only gate that catches it, and `ClockDino` is constructed in exactly one place
in `src/` (`src/modules/park/service.ts:117`) but in dozens of test fixtures.

### Traits must not reach enemies

`statsFor` serves both player dinos and enemy/boss combatants. Widening its
signature must not let traits apply to enemies. It has 2 production call sites
and 12 test call sites.

## 8. Testing

New: `tests/traits.test.ts`, `tests/genelab.test.ts`, `tests/locks.test.ts`.

Updated: `registry-load` (11 → 12 modules, 20 → 22 commands), `config` (module
list), `contract` (`toHaveLength(20)` → 22, plus the bidirectional autocomplete
manifest), `migration` (populated `dinos` and `eggs`, real `migrateDb`,
asserting row counts and column values survive the recreate), `images`,
`emoji-assets`, plus every trading, sell, hatchery, clock, and battle test the
lock and signature changes touch.

Every roll goes through `ctx.rng()`; tests inject a fixed generator. Pinned
cases:

- 0-trait parents produce all mutations
- the domain rule holds across many seeds
- a Legendary pair can never produce a Mythic
- a Mythic cannot breed
- hunger below 50 is refused
- claiming before ready is refused
- splice on a 0-trait dino adds one
- splice can produce a worse trait than it replaced
- splice never collides with the other slot's domain
- `eggs.traits` survives incubation into the hatched dino
- `viaTrade` propagates from either parent
- income is correct across the hunger-100 knee with a non-1.0 drain multiplier

New behavior gets a test that would have failed before the change; the two
hazards in §7 get regression tests that pin the fix.

## 9. Rollout

1. `migrate`
2. `npm run build-emojis`
3. `npm run deploy-emojis`
4. `npm run deploy-commands`
5. `npm run typecheck` — `tsconfig.test.json`; `npm run build` and `npm test`
   both pass on a type error in test files
6. `npm run test:live` gallery review

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Lock rework regresses escrow | Mutation-proven tests at every migrated site; lands as its own reviewable slice |
| Breeding undercuts `/shop egg` | Throttled by two matching dinos, a lot slot, and elapsed time |
| Per-dino drain breaks the income knee | Knee-straddling regression test (§7) |
| Fourth facility squeezes lot slots | Intended: the first real build tradeoff. Raising the 8-slot cap is the escape hatch if it proves too tight |
| Trait effects sprawl across modules | Every effect is a multiplier on a value computed in exactly one place; `src/data/traits.ts` is the only place magnitudes live |
| Per-dino drain ships a silent NaN | `npm run typecheck` before every commit; §7 |
| Migration loses rows | Populated-table migration test, §5 |

## 11. Found during design, out of scope

Recorded so they are not lost, and deliberately **not** fixed in this round:

- **The daily shop rotation is not a uniform shuffle.**
  `src/modules/shop/service.ts:21` uses
  `[...base].sort(() => rng() - 0.5)`, and a comparator returning random values
  does not shuffle uniformly. Replaying the real function over 100,000
  consecutive day indices gives offer rates of uncommon 90.49%, rare 71.85%,
  common 68.90%, epic 68.76% — not the 75% each a fair 3-of-4 draw would give.
  Any future pricing that assumes "Epic is available three days in four" should
  use 68.8% until this is fixed.
- **`assets/images/sites/volcano_core-thumb.webp` is 1254×1254**, not
  1024×1024. Site thumbs have no dimension gate — only a presence check — so
  nothing catches it.
- **Nothing machine-enforces that a new `assetImage` kind gets a test.** The six
  kinds are covered by four hand-written per-kind blocks, not a data-driven
  enumeration. A new kind with no test and no committed files would
  null-degrade everywhere and the suite would stay green. This spec avoids a
  new kind, so it is not exposed here.
- **`docs/commands.md:81` hard-codes "across nine topics"** for `/help`, which
  goes stale the moment the `genelab` topic is added. Fixed in this round; noted
  because the count is hand-maintained and will drift again.
- **CLAUDE.md's module-registration checklist says four sites; it is five.**
  Corrected in this round (see §6).
