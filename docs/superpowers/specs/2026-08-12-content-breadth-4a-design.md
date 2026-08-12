# Spec 4a — Content breadth: species span and trait domain parity

Two data tables grow. Nothing else changes: no migration, no new module, no
builder change, no art, no emoji, no engine change.

- **+10 species** (42 → 52), chosen so every non-containment biome spans
  common → epic.
- **+6 traits** (14 → 20), chosen so all four `TraitDomain`s hold exactly 5.
- `LEGACY_TIERS` untouched; the derived ceiling moves 180 → 190.

This is the first half of a two-part content push. 4b is chapter/site 7, which
is deliberately *not* here: it needs a new gate axis, two new committed images,
and balance simulation against a boss that cannot go up a level. See §11.

---

## 1. Why these two axes, and why not the third

The three content axes considered were species, traits and world events. Events
were cut, and the reason is worth recording because it is not obvious from the
outside: **a world event is by a wide margin the most expensive "data-only"
addition in this repo.**

`rollWeighted` (`src/core/rolls.ts:16-18`) computes its total over every entry
in `WORLD_EVENTS`, so the calm share is `W_clear / total`. The day-1 draw is
`0.323539` against a `4 / 12 = 0.3333` bar — it clears by **0.0098**. Any added
weight lowers that bar and day 1 stops resolving to Clear Skies, which breaks
the days-0–4 calm property that `WORLD_SALT` exists to guarantee and that
essentially the whole offline suite depends on (`makeCtx` defaults `nowMs` to 0).

Position does not save it: inserting at index 3 breaks days 0–4 identically and
only changes blast radius (445 of days 0–999 re-roll on append, 211 on insert@3).
Weight 0 preserves every day but cannot satisfy `tests/world-effects.test.ts`'s
requirement of a `DAY_OF` fixture day that actually resolves to the event, so the
staged-rollout idea is dead.

The two viable mitigations both cost real work — re-searching the salt to `0x3c1`
rewrites 9 of 10 pinned day fixtures across five test files, and raising
`clear_skies` to weight 5 keeps 6 of 10 but pushes the calm rate to 35.6%,
falsifying `docs/gameplay.md`'s "roughly one day in three" and the stated premise
of `tests/world.test.ts`'s independence test. On top of either, an event forces a
1536×1024 banner WebP, a hand-authored SVG, `npm run build-emojis`, a committed
PNG that must clear `MAX_BLACK_SHARE` (>2% pure `#000000` fails — and a storm or
moon motif is exactly the shape that trips it), and `npm run deploy-emojis`,
which is the one irreversible live write in the whole pipeline.

None of that is unreasonable work. It is simply not *this* spec's work, and
bundling it would have made a zero-risk change into a risky one.

**Species and traits, by contrast, cost nothing structural.** Species are free
subject to four conditions (§3); traits are free subject to one (§4).

## 2. The tycoon framing

This game is a park tycoon. That framing does not change the scope above, but it
decides two things inside it, and it is recorded here so a later reader does not
re-litigate them as arbitrary.

**It is why combat gets zero new traits.** `pickTrait`
(`src/data/traits.ts:86-88`) builds `TRAIT_IDS.filter((id) => !exclude.has(...))`
and indexes it uniformly, so **domain probability is nothing but domain size**.
Today that is income 3/14, care 4/14, combat 5/14, meta 2/14 — a player who never
opens `/battle` draws a dead trait **35.7%** of the time. Equalizing at 5 apiece
takes combat to 25.0% without removing anything or touching a line of engine code.

**It is why the new species lean herbivore at the bottom of the ladder.** Foods
are diet-typed (`src/data/foods.ts`, 3 tiers × 2 diets) and carnivore upkeep is
strictly costlier. The roster is already carnivore-heavy at 24:18, and an earlier
draft of §3's table pushed that to 31:21 with four of the five new commons
carnivorous — i.e. dearer upkeep concentrated in the exact tier new players live
in. The shipped table is 4 carnivore / 6 herbivore, which moves the roster to
28:24.

Worth recording but explicitly **not** fixed here: `archetype`
(`bruiser | tank | swift | support`, `src/data/types.ts:3`) is a combat concept
that also serves as the art key and a `/dex list` filter, so the most prominent
mechanical field on a species reads RPG rather than tycoon. Changing it is an
`Archetype` union change: a typecheck failure in `ARCHETYPE_MULT`
(`src/data/battle/stats.ts:18-23`), another in `tests/images.test.ts`'s
`satisfies Record<Archetype, 0>`, two new 1024×1024 cutouts with `prompts.md`
rows, and a mandatory `deploy-commands` for `/dex list`'s `archetype` option.

## 3. The 10 species

### The rule

Every non-containment biome holds at least one species at **common, uncommon,
rare and epic**. Containment stays epic-and-up: that is the chapter-6 lab
fiction and is correct as it stands.

Today's matrix, and the ten cells that fill it:

| biome | C | U | R | E | L | M | needs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| plains | 4 | 2 | 2 | 2 | 1 | – | — |
| forest | 4 | 3 | 2 | 1 | – | – | — |
| containment | – | – | – | 3 | 1 | 3 | — (by design) |
| marine | – | 1 | 2 | 1 | 2 | – | C |
| swamp | – | 2 | 1 | 1 | – | – | C |
| coast | – | 1 | – | – | 2 | – | C, R, E |
| volcanic | – | – | 1 | – | – | 2 | C, U, E |
| tundra | – | 1 | 1 | – | – | – | C, E |

The gap this closes is sharper than "tundra is thin": **all 8 commons are forest
or plains**, so six biomes are unreachable from a starter egg, and with them
17 of the 23 decor kinds — enrichment only ever matches a resident's own
`biomeTags`, and only `fern`'s second `forest` tag reaches across the line.

### The table

| # | id | name | rarity | diet | archetype | biome |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `henodus` | Henodus | common | herbivore | tank | marine |
| 2 | `thescelosaurus` | Thescelosaurus | common | herbivore | tank | swamp |
| 3 | `hesperornis` | Hesperornis | common | carnivore | swift | coast |
| 4 | `lesothosaurus` | Lesothosaurus | common | herbivore | swift | volcanic |
| 5 | `leaellynasaura` | Leaellynasaura | common | herbivore | swift | tundra |
| 6 | `massospondylus` | Massospondylus | uncommon | herbivore | support | volcanic |
| 7 | `pteranodon` | Pteranodon | rare | carnivore | swift | coast |
| 8 | `deinosuchus` | Deinosuchus | epic | carnivore | bruiser | coast |
| 9 | `sinosaurus` | Sinosaurus | epic | carnivore | bruiser | volcanic |
| 10 | `pachyrhinosaurus` | Pachyrhinosaurus | epic | herbivore | tank | tundra |

All real taxa, per the roster's existing convention. Each carries a one-line
`flavor` written as exhibit copy — what a visitor sees — matching the register
of the shipped entries (`archelon.ts`: *"A sea turtle the size of a car, and
just as unbothered."*).

Two notes on the picks. **Henodus** is a Triassic placodont whose flat,
denticle-lined jaw is read by several authors as filter-feeding or herbivory;
it is one of the few defensible marine herbivores of the Triassic, and marine
is otherwise a forced carnivore cell — all six marine species today are
carnivores. **Massospondylus** takes `support`, the thinnest archetype at 8,
rather than a fifth `swift`.

### The four conditions that keep this free

1. **Every species reuses one of the eight live biome tags.** A new tag would
   demand ≥3 new decor kinds (`tests/roster.test.ts` enforces per-tag coverage
   against `ENRICHMENT_CAP_KINDS`), taking `DECOR` to 26 — and `/decorate item`'s
   provider hands `Object.values(DECOR)` to `respondRanked`, which **slices at
   `MAX_CHOICES = 25` rather than erroring** (`src/core/autocomplete.ts`). The
   empty-query picker would start silently losing its tail.
2. **No mythic.** `mythicSpeciesChoices()` is evaluated at module scope and
   spread into `.addChoices(...)` (`src/modules/hatchery/index.ts:17,74`), so any
   mythic changes the `/mythic` builder and forces `deploy-commands` — and a 26th
   would throw at module init, i.e. a boot crash. `CLAUDE.md` documents this
   hazard but names only `/dex view` and `/admin give` as the surfaces that dodged
   it; `/mythic` did not, and no test pins its choice count.
3. **No legendary.** It is the most dilution-sensitive tier this spec could
   legally add to, at −16.7% per addition — mythic's 3 species dilute harder
   still at −25.0%, but condition 2 already rules it out — and
   `tests/dex.test.ts` asserts legendary+support is exactly `[]`.
4. **Append to `ALL`, never insert.** `ALL`'s order is the dex's paging order.
   The rank fixtures are *not* what protects it, and believing they are is the
   trap: `legacyPoints` adds `dexProgress(...).seen`, a plain count of the
   live-roster intersection, so `allSpecies().slice(0, 15)` / `.slice(0, 35)`
   (`tests/park.test.ts:320,332-333`) score 15 and 35 whichever species land in
   the window — an insertion leaves every rank title green. The one genuinely
   order-sensitive assertion in the suite is `tests/dex.test.ts:101`, which
   requires `'Triceratops'` on page 1 of the unfiltered list: `dexRows`
   preserves `ALL` order, `PAGE_SIZE` is 10, and triceratops is `ALL[0]`, so a
   ten-species *head* insertion would push it to page 2. Everything else that
   looks order-shaped is a roster-size pin already listed in §7. Treat append as
   a near-unguarded convention backed by one weak positional pin. It is at least
   the established pattern: `cryolophosaurus, nanuqsaurus` already sit on their
   own trailing line in `src/data/species/index.ts`, outside the rarity grouping
   above them, for exactly this reason.

### The registration trap

Adding the import is **not** enough. `REGISTRY` is built from `ALL`
(`src/data/species/index.ts:57`), so an imported-but-unlisted species typechecks
clean and is a **total no-op** — `tsconfig.json` has `strict` but not
`noUnusedLocals`, and no test reads the species directory. Both edits, every time.

## 4. The 6 traits

### The rule

All four domains hold exactly 5. Since `pickTrait` picks uniformly from a
domain-filtered pool, equal domain sizes make domain probability exactly uniform
**by construction** — 25% on the first draw, 33.3% each on the second among the
three surviving domains. This is the property a two-stage weighted draw would
have bought, obtained as data, with no engine change.

income +2, care +1, meta +3, combat +0.

### The table

Every mod key is one already read by a consumer. No new `TraitMods` key, no new
`TraitDomain`, so `HELP_TOPICS.genelab`'s enumerated key list is unchanged, and
the four per-domain emoji already exist — **no `deploy-emojis`**.

| id | name | domain | polarity | mods | blurb |
| --- | --- | --- | --- | --- | --- |
| `crowd_pleaser` | Crowd-Pleaser | income | positive | `income: 1.25` | +25% income |
| `docile` | Docile | income | positive | `income: 1.10, drain: 0.90` | +10% income, −10% hunger drain |
| `voracious` | Voracious | care | mixed | `feed: 0.70, drain: 1.20` | −30% feed cost, +20% hunger drain |
| `broody` | Broody | meta | positive | `breedTime: 0.60` | −40% breeding time |
| `matriarch` | Matriarch | meta | mixed | `breedTime: 0.70, income: 0.90` | −30% breeding time, −10% income |
| `dull` | Dull | meta | negative | `xp: 0.85` | −15% battle XP |

Meta's only two keys are `xp` and `breedTime`. Its five traits therefore come out
three breeding-facing (`fertile`, `broody`, `matriarch`) against two
battle-facing (`prodigy`, `dull`) — the tycoon lean, arrived at by which keys
exist rather than by preference.

`matriarch` carrying `income` from the `meta` domain follows `grazer`, which
already carries `drain` from `income`. Domain governs the exclusion rule, not the
key set. Because `matriarch`'s income leg is below 1, it cannot raise the income
ceiling; it lowers the floor instead, to `runt × matriarch = 0.81`.

### Why no trait slows breeding

The obvious meta negative — a trait that *lengthens* breeding — cannot be built
under recombine-only, and the reason is worth writing down because it is
invisible from the trait table. `breedTime`'s sole consumer takes the **minimum**
of the two parents' products (`src/modules/genelab/service.ts:119`, whose comment
reads *"Fertile is a parent-side trait, so take the better of the two"*). A value
**below** 1 therefore applies in full from one side, while a value **above** 1
applies only when **both** parents carry it — and since a dino holds at most one
meta trait, that requires deliberately pairing two of them. `min(1.25, 1) = 1`
in every other case.

An earlier draft of this table shipped exactly that trait. Its advertised "+25%
breeding time" would have been inert in ordinary play: a player-visible false
statement, with no test able to catch it, since G-4 checks a mod's *direction*
and never whether its value is reachable. The table's own opening claim — "every
mod key is one already read by a consumer" — was true of it, and does not cover
this.

`matriarch` replaces it, paying its cost in `income` — a key that always applies.

The three effective meta levers are therefore `xp↑`, `xp↓` and `breedTime↓`.
**Never ship a `breedTime` value above 1.**

### The one condition that keeps this free

**Every new `drain` value stays ≤ 1.20.** `MAX_DRAIN_MULT` is derived in
`tests/enrichment.test.ts` as the product of the **top two per-domain** `drain`
maxima (`tests/enrichment.test.ts:140-151`; a dino holds at most two traits,
never two from one domain). Today that is `income 1.20 × care 1.20 = 1.44`.

A dead window — a stretch in which a dino sits at comfort 0, earning nothing,
while its 8-hour grace runs out — *opens* at `fit · drainMult > 1.5`, and both
shipped enrichment rungs are already past that knowingly: `1.10 × 1.44 = 1.584`,
a measured **+25.45 min**, pinned at `tests/enrichment.test.ts:213`. The gate
that would actually go red is the 30-minute `MAX_DEAD_WINDOW_MS` bound
(`:161`, asserted at `:208`), which bounds `fit · drainMult` at 1.6 — i.e.
`mult ≤ 1.45455` at the shipped 1.10 fit cap, **about 1% of headroom** over
today's 1.44.

`voracious` at `drain: 1.20` ties the care maximum rather than raising it;
`docile` at `0.90` cannot raise the income maximum. `MAX_DRAIN_MULT` therefore
**does not move**, and no existing escape or income figure changes.

For a future author, two separate things are true and they are easy to conflate.
Against the dead-window bound, `1.21` is the only legal value above 1.20 and
`1.22` fails. But `tests/enrichment.test.ts:181` pins `MAX_DRAIN_MULT` to `1.44`
by **equality**, so any new drain trait that moves the two-domain product — the
"legal" 1.21 included — fails that line loudly first, and deliberately.

### The insertion hazard, stated correctly

There are exactly two seeded trait fixtures in the suite (a third,
in `tests/genelab.test.ts`, draws from the *parent* pool and is pool-size
independent). For a **single** insertion into today's 14-entry array, recon
established that indices 0–7 break one fixture, 10–14 break the other, and
**indices 8–9 leave both green** while every draw share silently moves.

That table does not transfer to this spec, and the reasoning that it does is
wrong: 4a makes **six** insertions, and after the two income additions the care
block ends at index 9 — the care trait lands squarely in the window. Multi-insert
index arithmetic is not worth doing.

The correct response is not to pick safe indices. It is §5's domain-parity test,
which pins the property we actually care about instead of the position that
happens to produce it. Both seeded fixtures must additionally be re-derived and
re-pinned **deliberately**, with the new expected values computed from the real
tables — never adjusted until green.

## 5. Guards

Four new tests. Each pins a property the suite does not currently cover, and
each was identified by recon as a live silent hole rather than invented for
symmetry.

**G-1 · Domain draw parity.** Over a seeded sweep of `pickTrait` with an empty
exclusion set, every `TraitDomain`'s share sits within tolerance of 25%; with one
domain excluded, every survivor sits within tolerance of 33.3%. Nothing in the
suite asserts per-domain or per-trait draw frequency anywhere today, which is
precisely why the 8–9 window is silent. This is the test that makes §4 a rule
rather than a coincidence.

Both numbers must be chosen in the plan, not left to the implementer: **20,000
draws from a seeded `mulberry32`, tolerance ±1 percentage point.** The bound has
to discriminate the failure it exists to catch — a single domain going 5/20 → 4/20
or 6/20 moves that share by 5 points, so ±1 catches it with wide margin, while
the sampling error at N = 20,000 is well under a third of a point. A loose
tolerance on a large N cannot tell 5/20 from 4/20, and a tight one on a small N
is merely flaky; neither is a test.

**G-2 · `ALL` and `allSpecies()` agree in length.** One line. `REGISTRY` is a
`Map`, so a duplicated `id` is **deduped for `getSpecies` but not for
`speciesByRarity`**, which filters the raw array. `rollSpeciesInRarity` can
therefore return the shadowed object while `hatchEgg` stores only `species.id` —
and every later read (`toClockDinos` → paddock fit and biome, `statsFor` →
archetype multipliers, `dexEntry`, `collectionScore`, `assetImage`) resolves that
id back through `getSpecies` to the *other* object. A copy-pasted species file
with an un-renamed id ships a dino whose diet, biome, art and battle stats
disagree with the species that was actually rolled, with no error anywhere.
Nothing in the suite reads `ALL` directly today.

**G-3 · Biome × rarity span.** Every non-containment biome holds ≥1 species at
common, uncommon, rare and epic. Turns this spec's thesis into a machine-checked
rule that survives the next roster edit instead of decaying quietly.

**G-4 · Polarity agrees with mods.** `polarity` is decorative today — its only
functional reader is a sweep asserting both labels appear — so a trait labelled
`positive` carrying `drain: 1.5` is mislabeled on every surface with nothing to
catch it. Assert that `positive` carries no adverse mod, `negative` no beneficial
one, and `mixed` at least one of each.

Direction is per-key, and the map must be **exhaustive over `keyof TraitMods`**:
`income`, `xp`, `hp`, `atk`, `def`, `spd` are beneficial above 1; `drain`,
`feed`, `breedTime` below 1. Type it as `Record<keyof TraitMods, 1 | -1>`, not
`Partial`, so a future mod key is a `npm run typecheck` failure rather than a
silent vacuous pass.

That exhaustiveness is not pedantry. `TraitMods` has **nine** keys and five of
the fourteen shipped traits carry *only* the four combat ones — written with a
five-key map, G-4 is red on `main` before any 4a data lands, because
`glass_cannon` (`mixed`, `{ atk: 1.25, hp: 0.85 }`) would have zero classified
mods and could not satisfy "at least one of each", while `savage`, `ironhide`,
`fleet` and `frail` would pass vacuously.

## 6. Balance effects, quantified

Every number below is a consequence, not a choice. They are listed so review can
move them rather than discover them.

**Per-tier hatch dilution.** `rollSpeciesInRarity` is a flat pick, so each
incumbent loses `k / (n + k)` of its share:

| tier | before | after | each incumbent |
| --- | --- | --- | --- |
| common | 8 | 13 | **−38.5%** |
| uncommon | 9 | 10 | −10.0% |
| rare | 9 | 10 | −10.0% |
| epic | 8 | 11 | **−27.3%** |
| legendary | 5 | 5 | — |
| mythic | 3 | 3 | — |

This dilutes *which* species you roll, not the tier's payout: income and sell
value are keyed on rarity alone, so no common out-earns another. Two things do
vary inside a tier. Combat power is rarity × archetype (`statsFor`), untouched
here since the new species reuse existing archetypes. **Upkeep is diet-keyed**,
per §2: carnivore food costs +20% cash at every tier, so the common pool moving
from 1-in-8 carnivore to 2-in-13 raises the expected cash cost of one common feed
by about **0.6%**. The dominant cost is still dex completion time, a legacy-rank
input.

All deliberately accepted — variety is the point — and §2's 4-carnivore /
6-herbivore split is what holds that upkeep move to a fraction of a percent
instead of the earlier draft's 5-in-13.

The draw consumes exactly one `rng()` call regardless of pool size, so **no
downstream seeded fixture shifts** from roster growth alone.

**Rating is untouched.** The collection term is already saturated: roster
rarity-weight is `8·1 + 9·2 + 9·4 + 8·8 + 5·16 + 3·32 = 302` against a frozen
`COLLECTION_TARGET` of 190, under a `Math.min(1, …)` clamp, and this spec takes
it to `13·1 + 10·2 + 10·4 + 11·8 + 5·16 + 3·32 = **337**`. New species are
alternate paths to a target already reachable, never a tax. `COLLECTION_TARGET`
must not be recomputed — see §10. (`tests/rating.test.ts:95` carries the 302 in a
comment and needs the new figure; its `toBe(400)` at `:108` is unaffected, since
that fixture seeds 192 weight and saturates the 190 target either way.)

**Trait draw shares.** Per-trait `1/14 = 7.14%` → `1/20 = 5.00%` (**−30%**).
Per-domain: income 21.4% → 25.0%, care 28.6% → 25.0%, combat **35.7% → 25.0%**,
meta **14.3% → 25.0%**.

**One multiplier ceiling moves**, and one floor, because a dino holds at most one
trait per domain:

- Best income trait `1.20` (grazer) → `1.25` (crowd_pleaser): the income ceiling
  rises **4.2%**.
- Worst income multiplier `0.90` (runt alone) → `runt × matriarch = 0.81`: the
  income floor falls **10%**.

The **feed ceiling does not move**: `thrifty` and `gluttonous` are both `care`,
so today's worst feed multiplier is `gluttonous` at 1.25 acting alone, and no new
trait outside `care` carries a `feed` key. `voracious` at 0.70 lowers the best
case from `thrifty`'s 0.75.

An earlier draft made `crowd_pleaser` `{ income: 1.35, feed: 1.30 }` and called it
`mixed`. It was not: feed is a rounding error against income at every rarity — at
common, 7 ferns is +20 cash against +504 income over a 24-hour collection (4.0%),
and at legendary the drawback is worth 2.3% of the benefit, shrinking as rarity
rises. It also put both legs outside the shipped table's entire ±25% band. G-4
would have granted it `mixed` regardless, since G-4 checks a mod's direction and
never its magnitude — a label the guard can always be made to sign.

Nothing in the codebase bounds the magnitude of any mod value except `drain`, so
these numbers are the spec's responsibility, not a test's.

**Polarity mix** across the trait table moves 8/4/2 → **11/5/4**
positive/negative/mixed. The six additions are 3 positive, 1 negative, 2 mixed.

## 7. Touch list

**Species, per addition:** a new `src/data/species/<id>.ts`; an import line **and**
an `ALL` entry in `src/data/species/index.ts` (both — see §3).

**Traits:** the `TraitId` union and the `TRAITS` table, both in
`src/data/traits.ts`. The `Record<TraitId, TraitDef>` makes that pair a
**typecheck-only** gate — `npm run typecheck`, never `npm test`.

**Tests that break loudly, all expected:**

- `tests/roster.test.ts` — the per-tier `EXPECTED` map and the roster size, twice.
- `tests/dex.test.ts` — roster-size pins, two exact footer strings, and the count
  pins for tank (9 → 12), herbivore (18 → 24) and rare+carnivore (8 → 9). Mythic
  (3) is unchanged.
- `tests/dex.test.ts` page strings — the roster crosses **51**, so unfiltered
  paging goes 5 → 6 pages. These live at more sites than the obvious ones, across
  three separate `describe` blocks. Two filtered views also cross a page boundary
  for the first time: **common 8 → 13** and **epic 8 → 11** each gain a second
  page, and the herbivore filter goes 18 → 24, i.e. 2 → 3 pages. A filter that
  previously rendered no page row now renders one.
- `tests/traits.test.ts` — the trait count, 14 → 20.
- `tests/hatchery.test.ts` and `tests/genelab.test.ts` — the two seeded trait
  fixtures, re-derived per §4.
- `tests/ranks.test.ts` — `expect(legacyMaxPoints()).toBe(180)` → `190`. This is
  the **only** gate on the legacy ceiling; the assertion above it is tautological
  and the one below it is `toBeLessThanOrEqual`, which growth can never fail.

**Stale but silent — the same files, plus two more.** None of these breaks. All
of them print a superseded figure, several of them in green:

- `tests/roster.test.ts:8` and `tests/traits.test.ts:9` are test **names** —
  `'has exactly 42 species with unique ids'`, `'has 14 traits across 4 domains'` —
  so left alone they report in green while the assertion two lines below reads 52
  and 20. The "twice" in the loud list above counts assertions only.
- `tests/dex.test.ts:28-29` (rare 9 → 10, its carnivores 8 → 9) and `:200`
  ("18 of 42 species — two pages" → 24 of 52, three pages).
- `tests/ranks.test.ts:22` (the `// 42 + 48 + 90` on the assertion line), `:71`
  ("above 42") and `:74` ("all 180 possible points" → 190).
- `tests/ranks.test.ts:69` needs **rewriting, not renumbering**. It reads
  "together only 90, short of Warden (100)"; after this spec, species + claims is
  `52 + 48 = 100` — *exactly* Warden. Those two sources alone now reach rank 4,
  so the sentence's reasoning inverts rather than its number sliding.
- `tests/park.test.ts:314` ("caps at allSpecies().length (42…)" → 52) and
  `tests/rating.test.ts:95` ("302 points of rarity weight" → 337). Neither file
  is named anywhere else in this spec.

**Docs, none of them machine-checked** — nothing in `tests/` reads
`docs/gameplay.md`:

- `docs/gameplay.md` — the 42-row roster mirror (the largest hand-maintained
  mirror of a data table in the repo); the species counts (`:291`); the
  legacy-points sentence "up to 42 … 180 points in total" (`:898`); and in
  §15 Traits, **four separate sites** that hardcode the trait roster: the prose
  "The 14 traits are grouped into four domains" (`:1053`), the
  `| Domain | Traits |` table (`:1062-1067`) — where Income gains Crowd-Pleaser
  and Docile, Care gains Voracious, Meta gains Broody, Matriarch and Dull, and
  **Combat gains none, so exactly three of its four rows change** — the
  `### The 14 traits` heading (`:1069`), and the 14-row effect table
  (`:1071-1086`, → 20 rows) with its polarity breakdown at `:1091`. The domain
  table is a second, separately-headed table that "the trait table" does not
  denote; left stale it publishes "Meta: Prodigy, Fertile" directly above a
  20-row table.
- `docs/gameplay.md:1173` — "shorter of the two parents' times — Fertile on just
  one side is enough" should also state that a *slowing* trait would need both
  parents, so no future author re-derives the inert trait §4 rejected.
- `README.md` — "42 species", twice.
- `scripts/test-live.ts` — "35 of 42" in the P5 case title (`:323`) and "(of 42)"
  in its fixture comment (`:239`). The fixture itself (`allSpecies().slice(0, 35)`,
  `:245`) is safe under §3's append rule and still lands on Keeper. Doubly
  unguarded: `tsconfig.test.json` includes `scripts`, but typecheck cannot see a
  string literal, and it is not a vitest file — and §9 step 4 publishes that
  title to the review channel.
- `src/modules/park/ranks.ts` — the comment stating the 180 ceiling and the
  threshold percentages, which become 190 and 7.9 / 18.4 / 34.2 / 52.6 / 73.7 /
  **89.5%**.
- `src/modules/dex/index.ts:29` ("42 species exceeds Discord's 25-choice cap"),
  `src/core/species-seen.ts:22` ("the dex renders 42 rows"), and `CLAUDE.md:679,777`.
  Each claim stays true; each number goes stale.

The roster count is mirrored by hand in README, `docs/gameplay.md`, `CLAUDE.md`,
two source comments and one `test:live` case title. `rg -n '\b42\b'` is the only
sweep that finds all of them.

**Not touched:** any migration (`species_id` is plain `text` with no FK; trait ids
live in a JSON column), any art (`assets/images/dinos/` is keyed archetype × diet
and all 8 pairs already ship), `docs/assets/prompts.md`, any command builder, and
all five module-registration sites.

## 8. The legacy ladder

`legacyMaxPoints()` is derived from three content tables — species +
achievement tiers + battle stars = 180 today — while `LEGACY_TIERS` thresholds
are absolute integers. Ten species take the ceiling to **190**; traits do not
touch it. Director stays at 170, sliding from 94.4% of the ceiling to **89.5%**.

**Decision: leave `LEGACY_TIERS` absolute and bump only the test.**

The comment at `src/modules/park/ranks.ts:26-28` asks for the opposite — that new
content move the thresholds — and that instruction is not safe to follow. Nothing
persists an earned rank: `src/core/db/schema.ts` has no rank, points or
high-water column, and `legacyRank` recomputes from three live tables on every
call. Raising Warden from 100 to 110 renders a player sitting at 105 as "Curator"
on their next `/park view` — no notice, no migration, no failing test — and
`docs/gameplay.md` promises in as many words that **"nothing can ever be lost —
it's simply recalculated from what you've already done."**

Leaving the thresholds alone makes ranks marginally easier and harms nobody. The
debt is real and cumulative: each future content spec slides Director further. The
option that would discharge it is a monotone `users.legacyRankBest`, written the
way `users.ratingHighWater` already is, after which thresholds could be retuned
freely and the doc's promise would be structurally true. That is a migration and
belongs to whichever spec decides the ladder needs retuning — not this one.

`legacyMaxPoints()` has **zero call sites in `src/`**, and no surface displays
points-out-of-max, so the drift has no runtime symptom at all. That is exactly
why it is written down here.

## 9. Shipping

No migration. No `deploy-commands` — no builder changes, since no mythic ships
and no option's choices are fed by a content table this spec touches. No
`deploy-emojis` — trait emoji is per-domain and all four exist. No new art.

1. `npm run typecheck` — the `TraitId` union / `TRAITS` table pair is a
   typecheck-only gate and `npm test` will not see a mismatch.
2. `npm test`.
3. `npm run build`, then **restart the single bot instance**. Unconditional: the
   bot runs compiled `dist/`, so a `src/data/` edit is invisible to the live
   process until it does. Exactly one process per token.
4. `npm run test:live` — the gallery gains no new case, but the dex and hatch
   surfaces render against the wider roster.

## 10. Invariants for future work

- **Never recompute `COLLECTION_TARGET` from the live roster.** A live
  denominator taxes every existing player's rating each time a species ships.
  Its comment is already stale — it cites "the 30-species roster this shipped
  with" against 42 — and someone tidying that comment is one step from tidying
  the constant.
- **Never add a species without adding it to `ALL`.** The import alone
  typechecks clean and does nothing.
- **Never insert into `ALL`.** Append. Only one weak positional pin guards it
  (`tests/dex.test.ts:101`, page-1 contents); the rank fixtures are count-based
  and would not catch an insertion.
- **Never ship a `breedTime` value above 1.** `Math.min` across both parents
  discards it in every pairing with a neutral partner, so the trait advertises an
  effect it does not have. §4 carries the full derivation.
- **Never break 5/5/5/5 domain parity without deciding to.** Domain probability
  equals domain size, so any future single-trait addition shifts every domain's
  draw share. G-1 catches it only if its tolerance stays tight — parity is a
  property of the data, not something the engine maintains.
- **Never let a `drain` mod exceed 1.20 without re-deriving `MAX_DRAIN_MULT`.**
  Headroom is ~1%; 1.21 is the only legal value above.
- **Never read a green suite as evidence that trait draw odds are unchanged.**
  That is G-1's whole reason for existing.
- **Never widen `EventMods.hatchTraitOdds` from its fixed 3-tuple.** A world
  event cannot currently widen the trait-slot count, and that is what keeps
  `MAX_DRAIN_MULT`'s two-domain derivation sound. Loosening it to `number[]`
  would silently make the enrichment dead-window gate under-count — exactly the
  "fix" a future author makes while adding a fourth odds bucket.
- **A retired species is a crash, not a degrade.** `matchedKindCount` tolerates
  an unknown decor slug and `traitDefs` drops a retired trait id, both
  deliberately — but `getSpecies` **throws**, and collection scoring calls it
  unguarded. There is no FK and no migration to catch it.

## 11. Out of scope

- **World events** — §1. Their own spec, whenever one is written.
- **Chapter/site 7** — spec 4b. Its gate is the interesting part: sites gate on
  `unlockRating`, chapter ids must equal site ids, and the ladder
  (`0 → 300 → 500 → 800 → 880 → 950`) is exhausted against a `RATING_SCALE` of
  1000 that is fully saturable. There is no 7th rung, so chapter 7 must gate on
  something else — battle stars, already a legacy-rank input, is the natural
  candidate. `NPC_LEVEL_SANITY_CAP` (12) is likewise spent, so its boss tunes on
  `hpMult` as chapters 5 and 6 already did.
- **A new mod key, `EventMods` field, `TraitDomain`, biome tag, or `Archetype`** —
  each converts a table append into an engine change; costs are in §2 and §3.
- **Legendary or mythic species** — §3, conditions 2 and 3.
- **Retuning `LEGACY_TIERS`, or persisting rank** — §8.
- **A `/help` topic change** — adding a `HELP_TOPICS` key changes deployed
  builder choices. Nothing here adds a topic; `HELP_TOPICS.genelab`'s enumerated
  `TraitMods` key list stays accurate because no new key ships.
- **Rebalancing `pickTrait` into a weighted two-stage draw** — §4 obtains uniform
  domain odds as data instead, and G-1 pins it.
