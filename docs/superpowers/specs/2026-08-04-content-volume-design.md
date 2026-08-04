# Content volume — chapters and sites 5-6, the 10★ rescale, ten species

Sub-project 3 of the endgame roadmap, after the Gene Lab (PR #11) and the daily
loop (PR #12). Those two added depth; this one adds runway. A player who has
cleared Volcano Core and hit 4★ has nothing left to unlock.

## Goal

Extend the progression curve past its current ceiling: two expedition sites, two
battle chapters, ten species, and the rating headroom to gate them on.

## Non-goals

- Chapters 7-8. This round proves the rescale on live data first.
- New mechanics. No new module, no new command, no schema change beyond a
  data-only migration.
- Raising `LEVEL_CAP`. Player power stays capped at level 10; see "Rejected".
- Species art. `assets/images/dinos/` is keyed on archetype × diet, and all
  eight combinations already ship. Ten species cost zero image files.

## The two problems this round has to solve

**Headroom.** Rating is `round(500 × (0.40·collection + 0.35·park +
0.25·comfort))`, so it caps at 500. The top gate is already 400 — Volcano Core,
the Mythic unlock, and the last lot slot all sit there. Two new sites cannot be
gated inside the remaining 100 points.

**Dilution.** `collection = ownedWeight / TOTAL_SPECIES_WEIGHT`, where the
denominator is a live sum over `allSpecies()` (`src/modules/park/rating.ts:12`).
Every species that ships shrinks every existing player's rating. Ten species
would take the denominator from 190 to 296 — a 36% cut to the collection term,
up to 72 points of rating lost for owning exactly what you owned yesterday.
`ratingHighWater` is monotonic so unlocks survive, but live `parkRating` gates
trading, and displayed ratings would visibly fall as a *reward* for new content.

## Part 1 — the rescale

`src/data/progression.ts` and one line of `src/modules/park/rating.ts`.

```ts
export const COLLECTION_TARGET = 190;   // frozen; today's exact rarity-weight sum
```

```ts
const collection = Math.min(1, ownedWeight / COLLECTION_TARGET);
const rating = Math.round(1000 * (
  RATING_WEIGHTS.collection * collection + RATING_WEIGHTS.park * park
  + RATING_WEIGHTS.comfort * comfort));
```

`TOTAL_SPECIES_WEIGHT` is deleted. The `Math.min(1, …)` clamp is new and
load-bearing: owned weight can now exceed the target, which is the entire point
— new species become *substitutable paths* to the same denominator instead of a
tax on everyone who already collected. Same pattern as `PARK_TARGET = 40`.

Frozen at 190, today's ratings are unchanged before the ×2. Nobody loses a point
for a species shipping, this round or in chapter 7.

Every gate doubles, then the new ones append:

| Constant | Old | New |
|---|---|---|
| rating scale | 500 (5★) | **1000 (10★)** |
| `EXPEDITION_SITES.unlockRating` | 0 / 150 / 250 / 400 | 0 / 300 / 500 / 800 |
| — new sites | — | **880 / 950** |
| `LOT_SLOT_THRESHOLDS` | 50,100,200,300,400 | **100,200,400,600,800,880,950** |
| `SHOP_CEILING.atLeast` | 350 / 200 / 100 / 0 | 700 / 400 / 200 / 0 |
| `MYTHIC_UNLOCK_RATING` | 400 | 800 |
| `TRADE_MIN_RATING` (`src/data/trade.ts`) | 200 | 400 |

Lot slots go 3→10 rather than 3→8, so the two new gates carry a park-side reward
and not only a content unlock.

Every display site already divides by 100 (`park/embeds.ts:26`,
`admin/index.ts:33`, `leaderboards/index.ts:16`, `expeditions/index.ts:52`,
`render/draw.ts:156`), so 10★ falls out with no formatting change. Only
hardcoded prose moves — see Part 5.

### Migration 0007

`drizzle/0006_daily_loop.sql` exists; the rescale is **0007**. It is a data-only
`UPDATE` with no schema diff, so plain `drizzle-kit generate` emits nothing.
Generate it with the purpose-built flag, never by hand:

```
npx drizzle-kit generate --custom --name rating_rescale
```

That emits `drizzle/0007_rating_rescale.sql`, `drizzle/meta/0007_snapshot.json`,
and the `_journal.json` entry together. Replace the placeholder line with:

```sql
UPDATE users SET park_rating = park_rating * 2, rating_high_water = rating_high_water * 2;
```

Hand-editing the journal or the snapshot is banned (the daily-loop plan's own
rule) — the snapshot is what the *next* `generate` diffs against.

The column that must not be missed is `ratingHighWater`: it gates lot slots
(`park/service.ts:79`), site and chapter unlocks, the shop ceiling, and Mythic,
and it never recovers on its own. `parkRating` self-heals on the next
`recomputeRating`, so a missed doubling there is transient.

## Part 2 — Abyssal Trench and Containment Site

Chapter ids equal `EXPEDITION_SITES` keys, per the standing invariant that
derives the banner asset, the `unlockRating` co-gate, and the theme.

### Sites (`src/data/sites.ts`)

| | unlock | duration | cost | egg odds | bonus cash | bonus food |
|---|---|---|---|---|---|---|
| `abyssal_trench` | 880 | 12h | 40,000 | rare 25 / epic 45 / legendary 29 / mythic 1 | 8,000-20,000 | 40-90 |
| `containment_site` | 950 | 24h | 100,000 | epic 35 / legendary 63 / mythic 2 | 20,000-50,000 | 80-180 |

Both keep the Volcano Core shape where the dig costs more cash than it returns —
the egg is the payoff, not the cash.

### Chapters (`src/data/battle/chapters/`)

Five stages each, energy `1,1,1,2,3`. All rewards clear the per-position
monotonicity test against Volcano Core (`220-400` cash, `100-150` xp,
`5,5,5,6,12` shards):

| | cash | xp | shards | npcLevel |
|---|---|---|---|---|
| Abyssal Trench | 460 / 520 / 580 / 650 / 750 | 165 / 180 / 195 / 215 / 240 | 6,6,6,7,**14** | 10,10,11,11,11 |
| Containment Site | 850 / 950 / 1050 / 1200 / 1400 | 260 / 280 / 300 / 330 / 370 | 7,7,7,8,**16** | 11,11,12,12,11 |

Campaign first-clear shards 93 → **177**, still far under the 500-shard Mythic
price (margin 323).

**`NPC_LEVEL_SANITY_CAP` stays 12.** The original design raised it to 14; a
simulation pass of 4,000 fights through the real `resolveBattle` showed why that
was wrong — see "Rejected". That constant is the machine gate for this whole
class of defect and must not be loosened to accommodate content.

Enemy rosters are weakest-first, boss authored as `enemies[2]`:

- Trench: `elasmosaurus`, `tylosaurus`, `kronosaurus`, `liopleurodon`,
  `mosasaurus`
- Containment: `scorpios_rex`, `ankylodocus`, `stegoceratops`, `spinoraptor`

Indominus and Indoraptor are never fielded as enemies. Mythic base stats
(hp 384) against a level-10 player ceiling is precisely the wall that broke the
first draft of this finale.

### Bosses

| | `boss-abyssal_trench` | `boss-containment_site` |
|---|---|---|
| title | The Trench Sovereign | Asset 47 |
| species | `mosasaurus` (legendary, tank) | `spinoraptor` (legendary, bruiser) |
| stage npcLevel / levelBonus | 11 / 1 → level 12 | 11 / 1 → level 12 |
| hpMult / atkMult | 2.8 / 1.25 | 3.0 / 1.2 |
| trophy egg | legendary, pinned `mosasaurus` | legendary, pinned `spinoraptor` |

Both bosses are **legendary-base**, so both stay clearable by a strong legendary
squad — the precedent Volcano Core set at ~99%. Escalation comes from
multipliers and roster tier, not from a rarity the player cannot realistically
field three of. The boss-egg ramp becomes
`rare, epic, legendary, legendary, legendary, legendary`; no boss ever drops
mythic, so the 500-shard purchase keeps its value.

Exact multipliers are **provisional until simulated**. Before the numbers are
pinned, the implementation must run `resolveBattle` over seeded rng against two
reference squads and land both bosses inside these bands:

| reference squad | required win rate |
|---|---|
| 3 × level-10 legendary bruiser, one combat trait (Savage) | **85-99%** |
| 3 × level-10 legendary bruiser, no traits | **≥ 40%** |

Volcano Core's finale sits at ~99% untraited, so the bands make each new boss
harder than the last without leaving the reach of the squad a 950-rating player
actually fields. If a multiplier has to move to hit the band, move `atkMult`
first — it dominates the outcome. Simulations do not go in the repo; the
committed artifact is the win-rate band test (Part 6).

## Part 3 — ten species, two biomes, four decor

Data-only files in `src/data/species/` plus the `ALL` array in `index.ts`.

| id | rarity | diet | archetype | biomeTags |
|---|---|---|---|---|
| `archelon` | uncommon | carnivore | **support** | marine, coast |
| `elasmosaurus` | rare | carnivore | swift | marine |
| `tylosaurus` | rare | carnivore | bruiser | marine |
| `kronosaurus` | epic | carnivore | tank | marine |
| `ankylodocus` | epic | herbivore | tank | containment |
| `scorpios_rex` | epic | carnivore | swift | containment |
| `stegoceratops` | epic | herbivore | support | containment |
| `liopleurodon` | legendary | carnivore | bruiser | marine |
| `spinoraptor` | legendary | carnivore | bruiser | containment |
| `ultimasaurus` | mythic | carnivore | tank | containment |

Roster 30 → 40; distribution becomes
`common 8, uncommon 8, rare 8, epic 8, legendary 5, mythic 3`; live weight sum
190 → 296 against the frozen 190 target.

Archelon is deliberate: `support-carnivore` art has shipped since Round 3 with
zero species using it. That claim in `CLAUDE.md:248-255` and
`docs/assets/prompts.md:721-731` dies with this round.

Diet goes 16/14 to 18/22 herbivore/carnivore. Accepted: a deep trench and a
predator lab are not herbivore habitats. It shifts endgame demand toward the
meat food tiers, which the typed-food economy already supports.

### Biomes

Two new tags, `marine` and **`containment`** — not `facility`. Species cards
render `Biome: <tags>` (`hatchery/embeds.ts:37`), and "Biome: facility" would
read as a lot type in a bot where Visitor Center and Gene Lab are facilities and
decor cannot be placed on them. `containment` also matches the site and the
fence decor. Biome tags are never persisted (only decor kind slugs are,
`schema.ts:43`), so this rename costs nothing now and is awkward later.

Four decor kinds (`src/data/decor.ts`), priced above the existing 400-800 band
because they gate endgame comfort:

| kind | name | biomeTags | cost |
|---|---|---|---|
| `kelp_bed` | Kelp Bed | marine | 900 |
| `hydrothermal_vent` | Hydrothermal Vent | marine | 1,100 |
| `containment_fence` | Containment Fence | containment | 1,000 |
| `floodlight_rig` | Floodlight Rig | containment | 1,200 |

Without these, nine of the ten new species could never exceed `paddockFit` 0.75.

**Retags are additive, never replacing**: `mosasaurus` →
`['coast','marine']`, `indominus`/`indoraptor` → `['volcanic','containment']`.
A replacing retag would silently drop comfort for every player whose paddock is
decorated with tide pools or lava rock.

The dead `tundra` tag on `ice_block` stays dead. Out of scope, and noted here so
the next round does not rediscover it.

## Part 4 — assets: ten files, not six

Six WebP images:

| file | spec | pass |
|---|---|---|
| `sites/{abyssal_trench,containment_site}-banner.webp` | 1536×1024, opaque, q95 | `node scripts/fit-art.mjs banner` |
| `sites/{abyssal_trench,containment_site}-thumb.webp` | 1024×1024, opaque, q95 | square crop |
| `battles/boss-{abyssal_trench,containment_site}-portrait.webp` | 1024×1024, transparent, **24px** margin on the tight axis | the one-off pass at `prompts.md:628-633` |

The portraits do **not** go through `scripts/fit-art.mjs cutout` — that fits to
31px and would ship them visibly smaller than the four existing bosses.
`prompts.md:628-633` already prescribes the correct pass verbatim: one-off
defringe, largest connected region, fit and centre on the whole silhouette bbox
at 24px. Copy the battles-specific no-glow wording from `prompts.md:617-621`;
off-silhouette glow survives matting as floating islands.

Four emoji files, which the first draft missed entirely.
`tests/emoji-assets.test.ts:129` iterates `Object.keys(EXPEDITION_SITES)` and
demands a committed SVG per site:

- `assets/emojis/svg/dw_site_abyssal_trench.svg`, `dw_site_containment_site.svg`
- their 128×128 PNG siblings from `npm run build-emojis`
- `EMOJI_FALLBACK` entries in `src/core/emojis.ts` (`🌊` and `🧪`) —
  `siteMarker` renders `''` without them
- the SVGs must clear `MAX_BLACK_SHARE` (2% pure `#000000`), which a dark
  abyssal palette is the likeliest family yet to trip, and must avoid the resvg
  `<ellipse fill="url(#grad)">` trap documented in `CLAUDE.md`

Prompt rows go in `docs/assets/prompts.md` for all six images plus the two
emoji; the `bossId`-appears-in-prompts assertion in
`tests/battle-content.test.ts` is a hard gate.

## Part 5 — copy and docs

Six runtime strings hardcode the old scale. None would fail a build:

| file | old | new |
|---|---|---|
| `trading/service.ts:66,67,106` | 2★ | 4★ |
| `shop/shards.ts:63` | 4★ | 8★ |
| `help/index.ts:37` (and :43, :69) | 4★ | 8★ |
| `hatchery/index.ts:73` | `(needs 4★)` | `(needs 8★)` |

Docs, all with exact replacements: `docs/gameplay.md` lot-slot table (58-70),
decor table (143-155), roster section (239-276), expedition table (414-448),
campaign section (457-472), shard total (530-532), boss table (557-568), shop
ceiling (599-604), trading gate (669), rating math and the 5.0★ ceiling
(709-720), best-ever paragraph (740-746), Gene Lab lot cap (876-879), quest
table (1009); `docs/commands.md:33`; `README.md:12,21,25`; `CLAUDE.md:248-255`;
`docs/assets/prompts.md:721-731`.

Three emoji counts are machine-checked by `tests/docs-assets.test.ts:13-18`,
which scrapes `/(\d+)\s+(?:custom |application )?emojis/`: `docs/ops.md:64`
(twice) and `docs/assets/prompts.md:1002`, all 41 → **43**.

`docs/superpowers/specs/` and `plans/` are dated historical records. Leave them.

## Part 6 — tests

### Breaks that must be retuned deliberately

- `tests/roster.test.ts:4` `EXPECTED` map; `:9`/`:10` count 30 → 40
- `tests/battle-content.test.ts`: chapter-id array (`:16`), `seen.size`/
  `STAGES.size` 20 → 30 (`:35,36`), shard total 93 → 177 (`:101`) and the
  `margin today: 407` comment → 323, boss `eggRarity` and `bossId` arrays
  (`:108-111`), amber_ridge gate literals 149/150 → 299/300 (`:169-170`)
- `tests/rating.test.ts`: six assertions — `lotSlots(50)`→3, `lotSlots(400)`→6,
  `lotSlots(999)`→10, `shopCeiling(250)`→`'rare'`, `shopCeiling(400)`→`'epic'`,
  `mythicUnlocked(400)`→false; test title `3→8` becomes `3→10`
- `tests/expeditions.test.ts:26` `listSites(400).length` → `listSites(950)` = 6
- `tests/autocomplete-expeditions.test.ts`: fixture `ratingHighWater: 150` → 300,
  the id list grows to six, locked labels `★2.5`/`★4.0` → `★5.0`/`★8.0`,
  LOCKED count 3 → 5
- `tests/journeys.test.ts`: seed `:358` → 300 **and** the hardcoded literals at
  `:477`/`:479`, plus the chapter-2 lock assertions at `:458-459`
- `tests/migration.test.ts:139`: `rating_high_water` reads 420, not 210 —
  `migrateDb` always runs the full folder. Write it as `210 * 2` with a comment
  naming the rescale. The new 0007 test's staging filters become
  `/^000[0-6].*\.sql$/` and `idx <= 6`
- `TRADE_MIN_RATING` fixtures across 9 files (`trading`, `autocomplete-trading`,
  `autocomplete-shop`, `autocomplete-hatchery`, `hatchery`, `shop`,
  `stats-sites`, `journeys`, `admin`): seed from the imported constant, the
  `tests/daily-roll.test.ts:138` idiom, rather than rewriting 200 → 400 by hand
- `MYTHIC_UNLOCK_RATING` fixtures: `shards.test.ts:77` → 800 and `:84` → 799
  (799 keeps the boundary honest), `stats-sites.test.ts:250`,
  `hatchery.test.ts:386`, `hatchery.test.ts:545` → 800, and `:544`'s `'4★'`
  → `'8★'`
- `tests/emojis.test.ts:37-51`: the pinned sorted name array 41 → 43

### Deliberately unchanged

No module or command is added, so the 5-site registration checklist does not
apply and none of its counts move: `tests/contract.test.ts:49` stays at 24
commands, `tests/registry-load.test.ts:9` at 13 modules,
`tests/config.test.ts:22` unchanged, and `AUTOCOMPLETE_OPTIONS` gains nothing —
`/decorate` and `/mythic` change their *choice lists*, not their option shape.
The whole registration suite stays green while the deployed builders drift,
which is exactly why the redeploy in Part 7 is an explicit step rather than a
test failure someone will notice.

### New guards this round must add

1. **Migration 0007 through the real `migrateDb`** — seed a 0006-era row with a
   known 500-scale rating, assert both columns doubled. That path reads the real
   journal, so a missing entry fails loudly.
2. **Boss win-rate bands** — run `resolveBattle` over seeded rng for every boss
   stage against defined reference squads and assert a band. No test today would
   fail on a 0%-win boss, which is exactly how the first draft got this far.
3. **Biome↔decor coverage** — every `biomeTag` on every species appears in at
   least one `DECOR` entry's `biomeTags`. One-directional only: the reverse
   assertion fails immediately on `ice_block`'s orphan `tundra`.
4. **Achievement tier reachability** — `tiers[3] <= STAGES.size` and
   `tiers[3] <= BASE_LOT_SLOTS_FALLBACK + LOT_SLOT_THRESHOLDS.length`.
5. **Stage autocomplete truncation** — a user with all 30 stages unlocked and
   1-starred sees the newest chapter's stages on an empty query.
6. **Cutout margin** (optional but cheap) — extend the boss-portrait case in
   `tests/images.test.ts` to assert 24±1px on `assets/images/battles/` and 31±1px
   on `hatch/` and `dinos/`. The divergence is documented in three places and
   enforced in none.

### Two fixes the audit surfaced that ride along

**Stage autocomplete truncation.** `respondRanked` hard-slices at
`MAX_CHOICES = 25` (`src/core/autocomplete.ts:26-30`). Six chapters × 5 stages =
30, so a maxed player's empty-query picker silently drops all five Containment
stages. The fix is in the provider (`battles/index.ts:174`): emit chapters
frontier-first — newest unlocked chapter down toward chapter 1 — so the slice
sheds old, already-cleared content that is trivially recovered by typing. Do not
filter on stars: chapter unlocks need only a 1-star clear, so "skip fully
3-starred chapters" bounds nothing. Do not raise `MAX_CHOICES`; 25 is Discord's
cap.

**Achievement tiers** (`src/data/achievements.ts`). `stages_first_cleared`
`[5,10,15,20]` → `[5,10,20,30]`, so Platinum still means campaign completion.
`lots_built` `[3,6,10,15]` → `[3,5,8,10]`: max lots today is 8 and lots are only
removable via `adminReset` (which wipes `user_stats`), so Gold and Platinum are
*currently unreachable* — a live dead-tier bug worth 7,500 cash and 25 shards.
The new threshold list raises the ceiling to 10, which fixes Gold incidentally;
retuning the ladder fixes Platinum without a second live capacity change.

## Part 7 — operator steps

1. `npm run build-emojis`, commit the two PNGs
2. `npm run deploy-emojis` — 41 → 43; commit `assets/emojis/manifest.json`
   immediately (note it is already dirty from the Gene Lab round)
3. `npm run deploy-commands` — **mandatory this round.** `/decorate item`
   enumerates `DECOR` via `addChoices` (`park/index.ts:262`), so 4 new decor
   change the body 8 → 12; `/mythic species` enumerates mythic species
   (`hatchery/index.ts:74`), 2 → 3, and its description string changes.
   Exactly one bot instance per token.
4. `npm run test:live` — first fix `scripts/test-live.ts:77,105,197`, which seed
   `parkRating: 200`. Under a 400 gate `createTrade` throws at `:106` outside any
   try/catch and the whole gallery aborts before posting.
5. Six Higgsfield generations plus two hand-authored SVGs.

## Risks

**The rescale is one-way in practice.** `ratingHighWater` is monotonic, so any
player who crosses a doubled threshold keeps it. Reverting the scale without a
matching halving migration would strand every player above their real progress.

**950 is 95% of maximum.** Reaching it needs `ownedWeight >= 190`, park 40 raw,
and comfort near 1.0 at the moment of a recompute. Deliberate — it is the last
gate in the game — but if live data shows it stalling, lower the gate rather
than inflating the terms.

**Boss numbers are provisional.** They ship only once the win-rate band test
exists and passes.

## Rejected

**Raising `LEVEL_CAP` past 10.** Simulated against the original mythic-base
finale, the ceiling squad won 0.1% at cap 11, 4.7% at 12, 26% at 13, 96.5% at
14 — while a full legendary squad stayed at 0.0% even at cap 16. Raising the cap
converts the finale into an "own three mythics" gate; mythics are unbreedable
(`upgradeRarity` caps at legendary), unbuyable for cash, and 0.2% on the best
expedition roll, so that is 3 × 500 shards against a 60/day sell cap. It also
invalidates the `LEVEL_XP` table and its tests for no gameplay gain.

**A mythic-base final boss.** Indominus at level 14 with ×3.0 HP / ×1.3 atk
measured 0.0-0.1% against the strongest legal squad; even stripped of escorts it
was 84%. `atkMult × level` dominates — hp 3.0/atk 1.0 wins 10.1% while hp
2.0/atk 1.3 wins 3.6% — so trimming HP alone would not have saved it.

**Raising `NPC_LEVEL_SANITY_CAP` to 14.** It is the only automated check on boss
level. If a future chapter genuinely needs level 13+ NPCs, raise `LEVEL_CAP`
first and derive the sanity cap from it.

**Staying on the 5★ scale** (new gates at 440/480). Cheapest option, no
migration, no copy churn — but it burns the last headroom and forces this same
conversation at chapter 7 with more live data.

**Campaign-gated expedition sites.** Unlimited runway with no rescale, but it
walls a non-battling player out of new expedition content and splits site gating
into two concepts.

**Raising `COLLECTION_TARGET` to ~240** alongside the new roster. Keeps
"collect them all" pressure, but costs existing players up to 84 points of the
new scale for shipping content they asked for.
