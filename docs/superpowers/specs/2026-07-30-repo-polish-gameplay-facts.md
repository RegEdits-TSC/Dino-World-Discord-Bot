# Dino World — verified gameplay facts reference

A citation-backed inventory of every player-visible number, rule, and gate in the bot, for use as the sole factual basis of the public gameplay guide (`docs/gameplay.md`).

Extracted from source on 2026-07-30 against commit `a2a6276`. Every claim below carries a `path:line` citation. **Re-verify this document if any gameplay code changes** — the guide that depends on it inherits every error here.

**How to use this document:** do not state a game number in the guide unless it appears below. Items marked **(inferred)** are derived by reading code rather than read off a constant — restate them cautiously or omit them. Items in "Open questions and gaps" are **not** safe to publish.

---

## Currencies and starting state

There is no `/start` or `/register`. A park is created implicitly the first time you run **any** command — every module calls `getOrCreateUser` at the top of `execute` (`src/modules/park/service.ts:19-32`; e.g. `src/modules/shop/index.ts:35`, `src/modules/park/index.ts:76`). It is also created for you if someone offers **you** a trade (`src/modules/trading/index.ts:98`).

### New-player starting package

| Thing | Starting value | Source |
| --- | --- | --- |
| Cash | 500 | `src/core/db/schema.ts:10` |
| Shards | 0 | `src/core/db/schema.ts:11` |
| Battle energy | 10 (the cap) | `src/core/db/schema.ts:14` |
| Park name | "New Park" | `src/core/db/schema.ts:7` |
| Park rating | 0 (and best-ever 0) | `src/core/db/schema.ts:8-9` |
| Pantry | 10 Ferns + 10 Fish | `src/data/foods.ts:30`; `src/modules/park/service.ts:27-29` |
| Lot slots | 3 | `src/data/progression.ts:8` |
| Incubator slots | 1 | `src/modules/hatchery/service.ts:15-17` |
| Dinos / eggs / lots | none | (no seeding code) (inferred) |

An admin reset restores exactly this same package (`src/modules/admin/service.ts:62-70`).

### The four resources

| Resource | Nature | Notes | Source |
| --- | --- | --- | --- |
| **Cash** | Main currency | Earned from idle income, expedition claims, selling dinos, winning battles. Can never go negative — an unaffordable purchase is simply refused. | `src/core/economy.ts:23`; `src/core/db/schema.ts:19` |
| **Shards** | Premium currency | Earned only two ways: selling dinos, and first-time battle-stage clears. Spent on exactly one thing: a Mythic egg (500). | `src/modules/shop/shards.ts:26-28`; `src/modules/battles/service.ts:110`; `src/data/sell.ts:4` |
| **Food** | Inventory of 6 named items, not one number | Bought with cash, spent by feeding, dropped by expeditions and battles, tradeable. | `src/data/foods.ts:10-16`; `src/core/db/schema.ts:24-31` |
| **Battle energy** | Regenerating, not a currency | Cap 10, +1 every 10 minutes. Cannot be bought, gifted, or refilled by any item. | `src/data/battle/constants.ts:1-2`; `src/data/battle/energy.ts:7-18` (inferred: no purchase path exists) |

Non-negativity is enforced at the database level, not only in code: `cash`, `shards`, `energy` and every food row carry SQL `CHECK` constraints (`src/core/db/schema.ts:19-21, 30`).

### Where each balance is visible

| Balance | Where a player can see it | Source |
| --- | --- | --- |
| Cash | `/park view` dashboard, Cash field | `src/modules/park/embeds.ts:23` |
| Food | `/park view` dashboard, Food field (per-item, with counts) | `src/modules/park/embeds.ts:24`; `src/modules/park/index.ts:120-122` |
| Rating | `/park view` dashboard, Rating field (stars, one decimal) | `src/modules/park/embeds.ts:25` |
| Battle energy | `/battle chapters` Energy field, and the fight-result frame's Energy field | `src/modules/battles/embeds.ts:149`, `:112`, `:31-34` |
| **Shards** | **Nowhere.** The dashboard has exactly five fields (Cash, Food, Rating, Dinos, Lots) and no player-facing surface shows a shard total. The only shard total rendered anywhere is the owner-only `/admin inspect`. Players can only track shards from the per-sale confirmation text. | `src/modules/park/embeds.ts:22-31`; `src/modules/admin/index.ts:32`; `src/modules/shop/index.ts:162` |

**Do not tell readers to "check your shards on `/park view`."**

---

## Park, lots, and building

### Lot slots

You start with 3 lot slots and gain one more at each rating threshold, to a maximum of 8 (`src/data/progression.ts:8-9,19-21`).

| Slot | Unlocked at best-ever rating | Shown as | Source |
| --- | --- | --- | --- |
| 1–3 | from the start | — | `src/data/progression.ts:8` |
| 4 | 50 | 0.5★ | `src/data/progression.ts:9` |
| 5 | 100 | 1.0★ | `src/data/progression.ts:9` |
| 6 | 200 | 2.0★ | `src/data/progression.ts:9` |
| 7 | 300 | 3.0★ | `src/data/progression.ts:9` |
| 8 | 400 | 4.0★ | `src/data/progression.ts:9` |

Slots are gated on your **best-ever** rating high-water mark, which never falls, so slots can never be taken away (`src/modules/park/rating.ts:26-28`; `src/data/progression.ts:19-21`). Slots are unlocked, never purchased — no cash path to a slot exists (inferred; there is no such code).

Building is blocked once you have as many lots as your cap: *"All lots full. More slots unlock with park rating."* (`src/modules/park/service.ts:50`; `src/modules/park/index.ts:140`).

### Lot types and build costs

Every lot is built at level 1 with no decor (`src/core/db/schema.ts:39-40`).

| Lot | Type | Build cost | Max level | Source |
| --- | --- | --- | --- | --- |
| Herbivore Paddock | paddock | 2,000 | 4 | `src/data/paddocks.ts:3`; `src/modules/park/service.ts:73` |
| Carnivore Paddock | paddock | 2,000 | 4 | `src/data/paddocks.ts:4`; `src/modules/park/service.ts:73` |
| Visitor Center | facility | 5,000 | 5 | `src/data/facilities.ts:3-7` |
| Food Court | facility | 8,000 | 3 | `src/data/facilities.ts:15-18` |
| Hatchery Lab | facility | 10,000 | 3 | `src/data/facilities.ts:9-13` |

### Paddocks

Capacity is 2 dinos per level (`src/modules/park/dinos.ts:18`). Upgrade cost is build cost × 2.5^(current level), rounded (`src/modules/park/service.ts:75-76`).

| Level | Capacity | Cost to reach this level | Source |
| --- | --- | --- | --- |
| 1 | 2 | 2,000 (build) | `src/data/paddocks.ts:3` |
| 2 | 4 | 5,000 | `src/modules/park/service.ts:76` (inferred arithmetic) |
| 3 | 6 | 12,500 | `src/modules/park/service.ts:76` (inferred arithmetic) |
| 4 | 8 | 31,250 | `src/modules/park/service.ts:76` (inferred arithmetic) |

Dinos can only be assigned to paddocks, never facilities: *"Dinos can only go in paddocks."* (`src/modules/park/dinos.ts:24`). An escaped dino cannot be assigned (`src/modules/park/dinos.ts:32`). Assigning into a full paddock fails with *"That paddock is full."* (`src/modules/park/dinos.ts:36`).

### Facilities

**Visitor Center** — sets your idle-income cap window and adds income % (`src/data/facilities.ts:3-7`):

| Level | Income cap | Income bonus | Cost to reach |
| --- | --- | --- | --- |
| 1 | 8 h | +0% | 5,000 (build) |
| 2 | 12 h | +5% | 12,500 |
| 3 | 16 h | +10% | 31,000 |
| 4 | 20 h | +15% | 78,000 |
| 5 | 24 h | +20% | 500,000 |

**Food Court** — income only (`src/data/facilities.ts:15-18`):

| Level | Income bonus | Cost to reach |
| --- | --- | --- |
| 1 | +4% | 8,000 (build) |
| 2 | +8% | 20,000 |
| 3 | +12% | 200,000 |

**Hatchery Lab** — incubator slots only, **no income bonus** (`src/data/facilities.ts:9-13`):

| Level | Incubator slots | Cost to reach |
| --- | --- | --- |
| — (no Lab) | 1 | — (`src/modules/hatchery/service.ts:15-17`) |
| 1 | 1 | 10,000 (build) |
| 2 | 2 | 25,000 |
| 3 | 3 | 150,000 |

A level-1 Hatchery Lab therefore gives no more slots than having none; 3 is the maximum (inferred arithmetic from `src/data/facilities.ts:12`).

Facility income bonuses from **all** facility lots add together (`src/modules/park/service.ts:34-37`). Nothing stops you building two of the same facility; their bonuses stack. But `capHours` takes the **first** Visitor Center row it finds, not the highest-level one — a second, better Visitor Center adds its income % while leaving your cap at the older lot's level (`src/modules/park/service.ts:39-42`) (inferred consequence).

### Decor

Bought per paddock with `/decorate lot:<id> item:<decor>` (`src/modules/park/dinos.ts:53-63`). There are **eight** items:

| Decoration | Cash | Biome tag it carries | Source |
| --- | --- | --- | --- |
| Grass Tuft | 400 | plains | `src/data/decor.ts:6` |
| Palm Tree | 500 | forest | `src/data/decor.ts:3` |
| Fern Cluster | 500 | forest, swamp | `src/data/decor.ts:4` |
| Boulder | 500 | plains | `src/data/decor.ts:5` |
| Reed Bed | 600 | swamp | `src/data/decor.ts:10` |
| Tide Pool | 700 | coast | `src/data/decor.ts:7` |
| Ice Block | 700 | tundra | `src/data/decor.ts:8` |
| Lava Rock | 800 | volcanic | `src/data/decor.ts:9` |

- Decor can only be placed on paddocks, never facility lots (`src/modules/park/dinos.ts:54` → `ownedPaddock`, `:24`).
- Each purchase appends one item; duplicates are allowed and there is no removal path and no per-paddock limit (`src/modules/park/dinos.ts:59`) (inferred: no cap or removal code exists).
- Every decor item raises park rating, because the build-out term counts decor pieces alongside lot levels (`src/modules/park/rating.ts:19-20`).
- **Whether decor raises comfort is unresolved — see "Open questions and gaps". Do not state a comfort effect for decor.**

### Other park commands

| Command | Behaviour | Source |
| --- | --- | --- |
| `/park view` | Dashboard + rendered park map + Collect button. Settles your escapes first. | `src/modules/park/index.ts:104-126` |
| `/park view user:<other>` | Read-only view of another player's park — **no Collect button**. Fails with *"That player has no park yet."* if they've never played. **It runs `settleEscapes` on the target**, so a third party viewing your park can stamp your escapes even if you never run a command. | `src/modules/park/index.ts:84-102`, `:89`; `src/modules/park/escapes.ts:13-17` |
| `/park rename name:<text>` | Renames your park; max 60 characters. The name is the dashboard embed title and the left side of the park map header. | `src/modules/park/index.ts:73-74, 77-81`; `src/modules/park/embeds.ts:20` |
| `/dino list` | Paginated list, 10 per page, with Prev/Next. Shows per dino: comfort %, escape countdown (if within 12 h), "wrong habitat" flag, and lot / unassigned. | `src/modules/park/index.ts:43-64`; `src/core/paginate.ts:3` |
| `/build kind:<lot>` | Build on an empty slot. | `src/modules/park/index.ts:130-144` |
| `/upgrade lot:<id>` | Raise a lot one level; *"Already max level."* at cap. | `src/modules/park/index.ts:147-160` |

Pagination buttons (`/dino list`, `/eggs`, `/trade list`) are locked to the list owner — a non-owner clicking gets *"Not your list."* (`src/modules/park/index.ts:294`; `src/modules/hatchery/index.ts:83`; `src/modules/trading/index.ts:226`).

### The park map image

| Fact | Source |
| --- | --- |
| Grid is 3 tiles wide; each tile 270×150 px; the image grows taller as lots are added. | `src/core/render/draw.ts:8-21` |
| Top bar shows park name, star rating, cash, and dino count (escaped count in parentheses when any escaped). | `src/core/render/draw.ts:75-77, 153-161` |
| Each tile shows the lot icon, name, level, and up to 6 dino markers coloured by rarity; a 7th and beyond collapse into a "+N" counter. | `src/core/render/draw.ts:108-126` |
| A tile shows a siren marker if any dino in it has escaped, plus up to 5 small dots for its decor. | `src/core/render/draw.ts:127-132` |
| While you have fewer lots than your cap, a dashed empty tile labelled "+ /build" is drawn. | `src/core/render/draw.ts:135-140, 144` |
| Paddock tiles are sandy tan, facility tiles blue; each lot kind has its own icon. | `src/data/render-icons.ts:5-23` |
| If the map fails to render, the dashboard still replies as a text embed — the image is never required. | `src/modules/park/index.ts:124-126` |

Lots cannot be demolished, sold, or refunded — nothing in normal play removes a built lot (inferred: no such code path exists; only `src/modules/admin/service.ts:56` removes lots).

---

## Income and how dinos earn

### The hourly rate

Each earning dino pays its rarity's hourly rate multiplied by its comfort (`src/core/clock.ts:79`).

| Rarity | Income / hour | Source |
| --- | --- | --- |
| Common | 60 | `src/data/rarity.ts:4` |
| Uncommon | 150 | `src/data/rarity.ts:5` |
| Rare | 400 | `src/data/rarity.ts:6` |
| Epic | 1,100 | `src/data/rarity.ts:7` |
| Legendary | 3,000 | `src/data/rarity.ts:8` |
| Mythic | 9,000 | `src/data/rarity.ts:9` |

### What earns and what doesn't

| Rule | Source |
| --- | --- |
| Only dinos assigned to a paddock earn. Unassigned dinos earn nothing (0 comfort). | `src/core/clock.ts:27, 63` |
| A dino stops earning the moment its hunger hits 0, or the moment it escapes, whichever comes first. | `src/core/clock.ts:66-69` |
| Escapes are stamped at the *actual* escape instant, not the time you noticed, so income stops at the real moment. | `src/modules/park/escapes.ts:14-17` |
| Income accrues only within a cap window measured from your last collection: 8 h with no Visitor Center, else the Visitor Center's cap hours. Time past the cap earns nothing. | `src/core/clock.ts:59`; `src/modules/park/service.ts:39-42` |
| Collecting resets the cap window — the clock restarts from the moment you press Collect. | `src/modules/park/service.ts:114-126` |
| The dashboard shows an "Income capped" warning when you have pending income and more time has passed since your last collection than your cap allows. | `src/modules/park/index.ts:117`; `src/modules/park/embeds.ts:32-34` |
| The total is increased by the summed facility income bonus %, then rounded **down** to a whole number. | `src/core/clock.ts:81` |

### The overfeeding knee

Comfort is capped at hunger 100, so an overfed dino (hunger 125 or 150) sits at **full** comfort until hunger drains back under 100, and only then starts declining. The income integral is split piecewise at that crossing so overfed dinos are paid exactly, never over- or under-paid (`src/core/clock.ts:28-29, 71-78`).

> **Guide note.** A worked example is safer here than a formula. The exact integral is a trapezoid over comfort, split at the hunger-100 knee; restating it as a closed-form player-facing equation would be an approximation.

---

## Eggs, rarities, and hatching

### The six rarities

Ordered lowest to highest: Common, Uncommon, Rare, Epic, Legendary, Mythic (`src/data/types.ts:1`).

| Rarity | Incubation | Income/hr | Feed cost (**food units**) | Sell shards | Sell cash | Collection weight |
| --- | --- | --- | --- | --- | --- | --- |
| Common | 15 min | 60 | 5 | 1–3 | 50 | 1 |
| Uncommon | 1 h | 150 | 10 | 3–6 | 150 | 2 |
| Rare | 4 h | 400 | 20 | 8–15 | 500 | 4 |
| Epic | 12 h | 1,100 | 40 | 20–35 | 1,500 | 8 |
| Legendary | 24 h | 3,000 | 80 | 50–80 | 5,000 | 16 |
| Mythic | 48 h | 9,000 | 160 | — (cannot be sold) | — | 32 |

Sources: incubation / income / feed cost / sell shards `src/data/rarity.ts:4-9`; sell cash `src/data/sell.ts:5-7`; collection weight `src/data/progression.ts:3-5`.

> **Ambiguity to avoid.** The feed-cost column is **food units drawn from your pantry, not cash** (`src/modules/care/service.ts:28, 43`). Never print "feeding a Legendary costs 80 cash".

### Incubation

| Rule | Source |
| --- | --- |
| `/eggs` shows your egg inventory and incubator status, paginated 10 per page. | `src/modules/hatchery/index.ts:20-25`; `src/modules/hatchery/embeds.ts:61-81` |
| Incubator slot count: 1 with no Hatchery Lab; otherwise 1 / 2 / 3 by Lab level. | `src/modules/hatchery/service.ts:15-17`; `src/data/facilities.ts:12` |
| Starting incubation fails if all slots are in use: *"All incubator slots are full. Upgrade the Hatchery Lab for more."* | `src/modules/hatchery/service.ts:31-32` |
| An egg already incubating cannot be started again: *"That egg is already incubating."* | `src/modules/hatchery/service.ts:29` |
| A **finished but un-hatched** egg still occupies its slot — the slot only frees when the egg row is deleted at hatch. | `src/modules/hatchery/service.ts:20-23`; `:52` (inferred) |
| The ready time is stamped as start time + the rarity's fixed duration. Nothing speeds it up. | `src/modules/hatchery/service.ts:33-35` (inferred: no acceleration code) |
| There is no limit on how many un-incubated eggs you can hold; only simultaneous incubation is capped. | `src/modules/hatchery/service.ts:20-23, 31-32` (inferred) |

### Hatching

| Rule | Source |
| --- | --- |
| `/hatch` refuses if the egg is not yours, or `hatchesAt` is null / in the future: *"That egg is not ready to hatch."* | `src/modules/hatchery/index.ts:54-56`; `src/modules/hatchery/service.ts:44-46` |
| `/hatch` shows a trembling-egg card with a **"🔨 Crack it open!"** button. Pressing the button is what actually hatches. | `src/modules/hatchery/embeds.ts:13-28`; `src/modules/hatchery/index.ts:88-92` |
| Species is decided **at the moment of hatching**, not when the egg is obtained — unless the egg carries a pinned species. | `src/modules/hatchery/service.ts:47` |
| Within a rarity, every species is equally likely: a flat pick across that rarity's pool. No per-species weighting, no pity, no duplicate protection. | `src/core/rolls.ts:35-38` |
| A freshly hatched dino arrives at hunger 100, unassigned to any paddock, and earns nothing until assigned. | `src/modules/hatchery/service.ts:48-51`; `src/modules/hatchery/embeds.ts:40` |
| The reveal card shows the species' diet, biome tags, and income/hr. | `src/modules/hatchery/embeds.ts:35-39` |
| Hatching immediately recalculates park rating (a new species can raise it). | `src/modules/hatchery/service.ts:55` |
| A dino hatched from a **traded** egg is **not** flagged trade-acquired, so it sells for full shard value — hatching launders a traded egg. The new dino row takes the `viaTrade` column default of `false`. | `src/modules/hatchery/service.ts:48-53`; `src/core/db/schema.ts:52` |

### Where eggs come from

Eggs record their source: `expedition | shop | trade | admin | battle` (`src/core/db/schema.ts:63`).

| Source | Gives | Species pinned? | Source |
| --- | --- | --- | --- |
| Expedition claim | exactly 1 egg per claim, rarity by site odds | no | `src/modules/expeditions/service.ts:45, 54-56` |
| Shop (`/shop egg`) | 1 egg of the bought rarity | no | `src/modules/shop/service.ts:31-33` |
| `/mythic` (500 shards) | 1 Mythic egg | **yes** — you choose Indominus rex or Indoraptor at purchase | `src/modules/shop/shards.ts:65-67`; `src/modules/hatchery/index.ts:67-68` |
| Boss first clear | 1 trophy egg, once per boss | only Volcano Core's (pinned Tyrannosaurus) | `src/modules/battles/service.ts:139-144` |
| Trade | whatever was traded | inherits the egg's own pin | `src/modules/trading/service.ts:79-81` |

Boss trophy eggs (first clear only; repeat clears award no further eggs — `src/modules/battles/service.ts:100, 139`):

| Boss | Chapter | Egg rarity | Pinned species | Source |
| --- | --- | --- | --- | --- |
| Old Riptooth | Coastal Dig | Rare | none — rolls at hatch | `src/data/battle/chapters/coastal_dig.ts:37` |
| Ridgeback Alpha | Amber Ridge | Epic | none — rolls at hatch | `src/data/battle/chapters/amber_ridge.ts:36` |
| Stormwing | Frozen Cliffs | Legendary | none — rolls at hatch | `src/data/battle/chapters/frozen_cliffs.ts:36` |
| The Tyrant King | Volcano Core | Legendary | **Tyrannosaurus** | `src/data/battle/chapters/volcano_core.ts:37` |

No boss ever drops a Mythic egg (`src/data/battle/chapters/*.ts:36-37`; the design note at `src/data/battle/chapters/volcano_core.ts:4-5` states this is deliberate).

### Mythic eggs

| Rule | Source |
| --- | --- |
| `/mythic species:<name>` costs 500 shards and requires a best-ever rating of 400 (4.0★); below that: *"Reach 4★ park rating to unlock Mythic purchases."* | `src/data/sell.ts:4`; `src/data/progression.ts:16, 25`; `src/modules/shop/shards.ts:60` |
| The command replies ephemerally with a **"🌟 Confirm — 500 shards"** button; the purchase only happens on the button press. | `src/modules/hatchery/index.ts:73-76, 97-108` |
| You pick which Mythic you get; the species is locked in on purchase, not rolled at hatch. | `src/modules/hatchery/index.ts:15, 68`; `src/modules/shop/shards.ts:66` |
| A Mythic egg still incubates normally — 48 h, the longest in the game. | `src/data/rarity.ts:9` |
| Mythic eggs are never sold for cash in the shop: *"Mythic eggs are not sold in the shop."* | `src/modules/shop/service.ts:27`; `src/data/shop.ts:4` |
| Mythic eggs and Mythic dinos can never be traded. | `src/modules/trading/service.ts:42, 48` |
| Mythic dinos cannot be sold at all: *"Mythics cannot be sold."* | `src/modules/shop/shards.ts:21` |
| The only non-shard route to a Mythic egg is a Volcano Core expedition (0.2%). | `src/data/sites.ts:19` |

---

## Species roster

There are exactly 30 species: 8 Common, 7 Uncommon, 6 Rare, 4 Epic, 3 Legendary, 2 Mythic (`src/data/species/index.ts:33-40`). Total collection weight is 190 (inferred arithmetic from `src/data/progression.ts:3-5`).

Diet decides which paddock the dino can live in without halved comfort. Archetype multiplies its battle stats and decides whether it heals (`src/data/battle/stats.ts:17-22`).

| Species | Rarity | Diet | Archetype | Biome tag | Source (`src/data/species/…`) |
| --- | --- | --- | --- | --- | --- |
| Triceratops | Common | herbivore | tank | forest | `triceratops.ts:3-4` |
| Gallimimus | Common | herbivore | swift | plains | `gallimimus.ts:3-4` |
| Dryosaurus | Common | herbivore | support | forest | `dryosaurus.ts:3-4` |
| Compsognathus | Common | carnivore | swift | forest | `compsognathus.ts:3-4` |
| Struthiomimus | Common | herbivore | swift | plains | `struthiomimus.ts:3-4` |
| Othnielia | Common | herbivore | swift | forest | `othnielia.ts:3-4` |
| Microceratus | Common | herbivore | support | plains | `microceratus.ts:3-4` |
| Nasutoceratops | Common | herbivore | tank | plains | `nasutoceratops.ts:3-4` |
| Stegosaurus | Uncommon | herbivore | tank | forest | `stegosaurus.ts:3-4` |
| Parasaurolophus | Uncommon | herbivore | support | swamp | `parasaurolophus.ts:3-4` |
| Dilophosaurus | Uncommon | carnivore | swift | forest | `dilophosaurus.ts:3-4` |
| Iguanodon | Uncommon | herbivore | bruiser | plains | `iguanodon.ts:3-4` |
| Maiasaura | Uncommon | herbivore | support | plains | `maiasaura.ts:3-4` |
| Pachycephalosaurus | Uncommon | herbivore | bruiser | forest | `pachycephalosaurus.ts:3-4` |
| Ouranosaurus | Uncommon | herbivore | support | swamp | `ouranosaurus.ts:3-4` |
| Velociraptor | Rare | carnivore | swift | plains | `velociraptor.ts:3-4` |
| Carnotaurus | Rare | carnivore | swift | plains | `carnotaurus.ts:3-4` |
| Baryonyx | Rare | carnivore | swift | swamp | `baryonyx.ts:3-4` |
| Allosaurus | Rare | carnivore | bruiser | forest | `allosaurus.ts:3-4` |
| Ankylosaurus | Rare | herbivore | tank | forest | `ankylosaurus.ts:3-4` |
| Ceratosaurus | Rare | carnivore | bruiser | volcanic | `ceratosaurus.ts:3-4` |
| Brachiosaurus | Epic | herbivore | tank | plains | `brachiosaurus.ts:3-4` |
| Spinosaurus | Epic | carnivore | bruiser | swamp | `spinosaurus.ts:3-4` |
| Therizinosaurus | Epic | herbivore | support | forest | `therizinosaurus.ts:3-4` |
| Giganotosaurus | Epic | carnivore | bruiser | plains | `giganotosaurus.ts:3-4` |
| Tyrannosaurus | Legendary | carnivore | bruiser | plains | `tyrannosaurus.ts:3-4` |
| Mosasaurus | Legendary | carnivore | tank | coast | `mosasaurus.ts:3-4` |
| Quetzalcoatlus | Legendary | carnivore | swift | coast | `quetzalcoatlus.ts:3-4` |
| Indominus rex | Mythic | carnivore | bruiser | volcanic | `indominus.ts:3-4` |
| Indoraptor | Mythic | carnivore | swift | volcanic | `indoraptor.ts:3-4` |

Diet split: **16 herbivore, 14 carnivore** — recounted directly from the species
definitions, not from the table above. Biome-tag tally: forest 10, plains 11,
swamp 4, volcanic 3, coast 2, **tundra 0** (inferred arithmetic from the table
above; not independently recounted, so treat with the same caution).

> An earlier revision of this line said "17 herbivore, 13 carnivore." That was an
> arithmetic slip in this document's own summary — the per-species rows above were
> always right. The corrected split is confirmed by counting the `diet` field
> across all 30 species definitions. The lesson generalises: summary lines in this
> document are derived, while the cited per-item rows are extracted. When the two
> disagree, the rows win.

---

## Care: hunger, comfort, escapes

### Hunger

| Rule | Source |
| --- | --- |
| Hunger drains **linearly from its fed value to 0 over 48 hours** — about 2.08 points per hour — and never goes below 0. The rate is absolute, so a dino fed to 150 takes 72 h to reach 0. | `src/core/clock.ts:4, 15-18` (72 h figure inferred) |
| Feeding **sets** hunger to that food's fill value — a reset, not an addition. A dino at 90 fed Ferns (fills to 100) ends at 100; fed Royal Greens it ends at 150. | `src/modules/care/service.ts:44`; `src/data/foods.ts:11-16` |
| 150 is the highest hunger value obtainable, because the best food tier fills to 150. | `src/data/foods.ts:13` (inferred) |
| Only three things change hunger: feeding, being rescued, and the passive 48-hour drain. | `src/modules/care/service.ts:44, 91`; `src/core/clock.ts:15-18` (inferred: no other write site) |
| A freshly hatched dino starts at hunger 100 with `lastFedAt` set to the hatch moment. | `src/modules/hatchery/service.ts:50` |

> **Ambiguity to avoid.** 150 is a value at the *instant of feeding*; it drains immediately, and comfort clamps anything ≥ 100 down to 100. **Overfeeding buys time, never higher comfort or higher rating.** Do not write "keep dinos at 150 for max comfort." (`src/core/clock.ts:26-29`)

### Comfort and habitat fit

Comfort = (hunger, counted only up to 100, ÷ 100) × the paddock's habitat fit. A dino with no paddock has comfort 0 (`src/core/clock.ts:26-30`).

| Habitat fit | When | Source |
| --- | --- | --- |
| 0.5 | paddock diet ≠ species diet | `src/core/clock.ts:21` |
| 1.0 | correct diet **and** a decor entry matching one of the species' biome tags | `src/core/clock.ts:22-23` |
| 0.75 | correct diet, no matching decor | `src/core/clock.ts:23` |

**Caution: whether fit 1.0 is reachable in normal play is unresolved — see "Open questions and gaps."** The safe reading for the guide is that a correct-diet paddock gives 0.75 and a wrong-diet paddock gives 0.5.

### Escapes

| Rule | Source |
| --- | --- |
| A dino escapes when its comfort has been **below 0.25 for 8 straight hours** (a grace period). | `src/core/clock.ts:5-6, 33-47` |
| A dino not assigned to any paddock can **never** escape (it also earns nothing and sits at 0 comfort). | `src/core/clock.ts:34` |
| Escapes are settled lazily — the moment you (or someone viewing your park) run a command that touches your park. | `src/modules/park/escapes.ts:7-21`; `src/modules/park/index.ts:89, 105` |
| The escape is recorded at the time it actually happened, not the time it was noticed. | `src/modules/park/escapes.ts:14-17` |

Escape times after a feed, by fit and fill level (all derived from `src/core/clock.ts:33-40`; the 44 h, 32 h and 68 h rows are additionally pinned by `tests/clock.test.ts:36, 56, 102`):

| Habitat fit | Fed to 100 | Fed to 125 | Fed to 150 |
| --- | --- | --- | --- |
| 1.0 (correct diet + matching decor) | 44 h | 56 h (inferred) | 68 h |
| 0.75 (correct diet, no matching decor) | 40 h (inferred) | 52 h (inferred) | 64 h (inferred) |
| 0.5 (wrong diet) | 32 h | 44 h (inferred) | 56 h (inferred) |

### Warnings a player actually sees

| Signal | Trigger | Source |
| --- | --- | --- |
| "at risk" counter on the dashboard, and an escape countdown in `/dino list` | the computed escape instant is within **12 hours** | `src/core/clock.ts:8`; `src/modules/park/index.ts:50, 111-115` |
| "VERY HUNGRY" tag in the dino pickers, and the neglect artwork on Care replies | **36 hours** since the last feed | `src/core/autocomplete.ts:56, 62-63`; `src/modules/care/index.ts:24` |
| "N wrong habitat" counter on the dashboard; "wrong habitat" per dino in `/dino list` | assigned to a wrong-diet paddock | `src/modules/park/index.ts:53, 118-119` |
| ESCAPED marker instead of a countdown | the dino has already escaped | `src/modules/park/index.ts:49` |

> **Two ambiguities to avoid.**
> 1. The "at risk / 12 hours" warning is derived from a computed escape instant, which is `null` for an unassigned dino. An unassigned dino therefore never shows an escape warning (it also never escapes), and an already-escaped dino shows ESCAPED rather than a countdown. Do not present it as a universal safety net. (`src/core/clock.ts:33-34, 43-47`)
> 2. "VERY HUNGRY" is computed purely from **time since the last feed**, not from actual hunger. A dino fed Royal Greens is tagged VERY HUNGRY at 36 h even though its hunger is still 75 and it is 28 h from escaping. The label and the escape risk are **not** the same signal. (`src/core/autocomplete.ts:56, 62-63`)

### What an escaped dino cannot — and can — do

| Action | Escaped dino? | Source |
| --- | --- | --- |
| Be fed | **No** — *"That dino has escaped — rescue it first."* | `src/modules/care/service.ts:26` |
| Be assigned to a paddock | **No** | `src/modules/park/dinos.ts:32` |
| Fight in a battle | **No** — named in the error; also filtered out of the fight picker entirely | `src/modules/battles/service.ts:57-58`; `src/modules/battles/index.ts:195-196` |
| Be offered in a trade | **No** — *"has escaped — rescue it first."* | `src/modules/trading/service.ts:41` |
| Earn income | **No** | `src/core/clock.ts:64-67` |
| Count toward the comfort term of park rating | **No** (excluded from the average) | `src/modules/park/rating.ts:21` |
| **Be sold** | **Yes.** `/sell` blocks only Mythics and trade-locked dinos; there is no escape check in either `previewSell` or `sellDino`. | `src/modules/shop/shards.ts:18-21, 53` |
| Be skipped by `/feed all` | Yes — skipped entirely | `src/modules/care/service.ts:56` |

### Rescue

| Rule | Source |
| --- | --- |
| `/rescue dino:<id>` costs cash equal to **4 hours of that dino's income rate**. | `src/data/care.ts:1`; `src/modules/care/service.ts:87` |
| Hunger is set to `min(100, round(50 ÷ habitat fit))` — i.e. 50 at fit 1.0, 67 at fit 0.75, 100 in a wrong-diet paddock. That returns the dino to roughly 50% comfort, not full. | `src/modules/care/service.ts:88` |
| Rescue clears the escaped flag and resets `lastFedAt` to the rescue moment, so the dino earns again immediately. | `src/modules/care/service.ts:91` |
| Cannot rescue a dino that has not escaped: *"That dino has not escaped."* | `src/modules/care/service.ts:80` |
| If you cannot afford the fee: *"Not enough cash for the recapture fee."* and nothing changes. | `src/modules/care/index.ts:125` |

Rescue fees by rarity (4 × income/hr; inferred arithmetic from `src/data/rarity.ts:4-9` and `src/data/care.ts:1`):

| Rarity | Rescue fee |
| --- | --- |
| Common | 240 |
| Uncommon | 600 |
| Rare | 1,600 |
| Epic | 4,400 |
| Legendary | 12,000 |
| Mythic | 36,000 |

### Wrong-habitat assignment

Assigning a dino to the wrong-diet paddock is not blocked outright. The bot warns first with *"&lt;Species&gt; is a &lt;diet&gt; — &lt;Paddock&gt; halves its comfort: it earns less and escapes sooner."* and offers **Assign anyway** / **Cancel** buttons (`src/modules/park/dinos.ts:13-16`; `src/modules/park/index.ts:195-202`). Confirming replies *"🦕 Assigned — wrong habitat, comfort halved."* (`src/modules/park/index.ts:286`).

**There is no cleanliness, hygiene, or cleaning mechanic anywhere in the game.** No such stat, command, or code path exists. Do not describe cleaning.

---

## Food

Six items, three tiers × two diets (`src/data/foods.ts:11-16`):

| Item | Diet | Tier | Cash / unit | Fills hunger to |
| --- | --- | --- | --- | --- |
| Ferns | herbivore | 1 | 10 | 100 |
| Fruit Basket | herbivore | 2 | 15 | 125 |
| Royal Greens | herbivore | 3 | 20 | 150 |
| Fish | carnivore | 1 | 12 | 100 |
| Goat | carnivore | 2 | 18 | 125 |
| Prime Steak | carnivore | 3 | 24 | 150 |

Carnivore food costs exactly 20% more per unit than the herbivore food of the same tier (inferred arithmetic from `src/data/foods.ts:11-16`).

### Buying food

| Rule | Source |
| --- | --- |
| `/shop food item:<food> units:<n>` — minimum 1 unit; total cost = units × unit price. | `src/modules/shop/index.ts:33`; `src/modules/shop/service.ts:38, 41` |
| The shop suggests bundles of 10 / 50 / 100, but any positive amount is allowed. | `src/data/shop.ts:6`; `src/modules/shop/index.ts:44` |
| No maximum is set on the units option — very large purchases are limited only by cash. | `src/modules/shop/index.ts:33` (inferred: no `setMaxValue`) |

### Feeding

| Rule | Source |
| --- | --- |
| Feeding costs **food units**, not cash — the unit count is the dino's rarity feed cost (5 / 10 / 20 / 40 / 80 / 160). | `src/data/rarity.ts:4-9`; `src/modules/care/service.ts:28, 43` |
| Leave the `food` option blank on `/feed one` and the game auto-picks the **cheapest (lowest-tier)** food of the right diet that you own enough of. | `src/modules/care/service.ts:16-18, 37` |
| Naming a food of the wrong diet is a **hard block**, not a penalty: *"Triceratops is a herbivore — it won't eat Fish."* | `src/modules/care/service.ts:33-34` |
| If you own no *large enough stack* of matching food, the feed is refused with a pointer to buy the tier-1 item of that diet. The message says *"You have no &lt;diet&gt; food"* even though the real condition is "no stack ≥ the rarity feed cost" — a player holding 30 Ferns feeding an Epic (40 units) is told they have none. | `src/modules/care/service.ts:16-18, 37-39` |
| An escaped dino cannot be fed. | `src/modules/care/service.ts:26` |
| The food picker shows, per item, how many you own and what hunger it fills, and marks an item "not enough" when you hold fewer units than that dino's feed cost. | `src/modules/care/index.ts:97-101` |
| The `/feed one` dino picker sorts your dinos **hungriest-first by actual decayed hunger** — different from the id order every other dino picker uses. | `src/modules/care/index.ts:112` |

### `/feed all`

| Rule | Source |
| --- | --- |
| Only feeds dinos whose **current (decayed)** hunger is below 100, skips escaped dinos entirely, and serves the hungriest first. | `src/modules/care/service.ts:54-57` |
| Keeps going when it runs out of matching food for one dino: that dino is reported as skipped and the rest still get fed. | `src/modules/care/service.ts:62-63`; `src/modules/care/index.ts:68-69` |

> **Ambiguity to avoid.** "Current hunger below 100" means the *live decayed* value, not the value it was fed to. A dino fed to 150 twenty hours ago sits at about 108 and will be **skipped** by `/feed all`, which surprises players expecting a top-up. (`src/modules/care/service.ts:55-56`; `src/core/clock.ts:15-18`)

Ties in `/feed all` ordering (two dinos at identical hunger) are not defined — the sort has no secondary key (`src/modules/care/service.ts:57`).

---

## Expeditions

Four dig sites (`src/data/sites.ts:11-20`). Expeditions use **no dinos at all** — the only thing `/expedition start` asks for is a site (`src/modules/expeditions/index.ts:35-36`), and the expedition record stores only the site, depart time, return time, loot and claim time (`src/core/db/schema.ts:82-91`).

| Site | Unlock rating | Shown as | Cost | Duration | Cash bonus | Food bonus |
| --- | --- | --- | --- | --- | --- | --- |
| Coastal Dig | 0 | 0.0★ | 200 | 15 min | 50–200 | 2–6 |
| Amber Ridge | 150 | 1.5★ | 1,000 | 1 h | 200–800 | 4–10 |
| Frozen Cliffs | 250 | 2.5★ | 4,000 | 4 h | 800–2,500 | 8–20 |
| Volcano Core | 400 | 4.0★ | 15,000 | 8 h | 3,000–9,000 | 20–50 |

Source: `src/data/sites.ts:12-19`; star display `src/modules/expeditions/index.ts:53`.

### Egg odds per site

Each site's weights sum to exactly 100, so they read directly as percentages (inferred arithmetic from `src/data/sites.ts:12-19`; the roll itself is `rollWeighted`, `src/core/rolls.ts:15-24`).

| Site | Common | Uncommon | Rare | Epic | Legendary | Mythic |
| --- | --- | --- | --- | --- | --- | --- |
| Coastal Dig | 70% | 30% | — | — | — | — |
| Amber Ridge | 45% | 40% | 15% | — | — | — |
| Frozen Cliffs | — | 40% | 40% | 20% | — | — |
| Volcano Core | — | — | 40% | 40% | 19.8% | 0.2% |

Volcano Core is the only site that can drop a Legendary or Mythic egg (`src/data/sites.ts:19`).

### Claiming

| Rule | Source |
| --- | --- |
| Every claim yields exactly three things: **1 egg, a cash bonus, and a stack of food.** All three are rolled at claim time. | `src/modules/expeditions/service.ts:45-51` |
| Cash and food amounts roll **inclusively** between the site's min and max, so both endpoints are reachable. | `src/core/rolls.ts:26-28` |
| The food diet is a **50/50 coin flip** decided at claim time, and it is always the **tier-1** item for that diet — Ferns or Fish. Higher tiers never drop from expeditions. An all-herbivore park will still be handed Fish half the time. | `src/modules/expeditions/service.ts:46, 50`; `src/data/foods.ts:19-21` |
| **Expeditions never pay shards.** The claim payout applies only cash and food. | `src/modules/expeditions/service.ts:53` |
| The claimed egg arrives with no species assigned and no incubation timer running — you still have to incubate and hatch it. | `src/modules/expeditions/service.ts:54-56` |
| The claim reply is an embed titled *"&lt;Site&gt; — returned!"* naming the egg rarity, the cash gained, and the food item + quantity. | `src/modules/expeditions/index.ts:72-76` |

### Constraints and error messages

| Rule | Message | Source |
| --- | --- | --- |
| One expedition out at a time | *"You already have an expedition out — claim it first."* | `src/modules/expeditions/service.ts:28` |
| Site must be unlocked | *"That site is not unlocked yet."* | `src/modules/expeditions/service.ts:27` |
| Cost charged up front, at departure | *"Not enough cash for that expedition."* on failure | `src/modules/expeditions/service.ts:32`; `src/modules/expeditions/index.ts:88` |
| Cannot claim early | *"Your expedition has not returned yet."* | `src/modules/expeditions/service.ts:43` |
| Cannot claim with nothing out | *"You have no expedition to claim."* | `src/modules/expeditions/service.ts:42` |
| Return time fixed at departure; nothing shortens it | — | `src/modules/expeditions/service.ts:30` |
| **No failure, risk, injury, or partial-loss outcome.** A returned expedition always pays its full loot. | — | `src/modules/expeditions/service.ts:40-51` (inferred: no such branch exists) |
| **No cancel or refund.** The subcommands are only `start`, `status`, `claim`. | — | `src/modules/expeditions/index.ts:35-38` (inferred) |

### Site unlocks are permanent

The gate compares against your **rating high-water mark** (highest ever reached), so letting your rating fall never re-locks a site (`src/data/progression.ts:18`; `src/modules/park/rating.ts:26`).

### Site browsing

`/expedition status` shows a countdown while digging and switches to *"✅ Back! Use /expedition claim."* once the timer is up; with nothing out it answers privately (`src/modules/expeditions/index.ts:64-69`). The `/expedition start` site picker shows **every** site — unlocked ones list cash cost and duration, locked ones are labelled *"LOCKED, needs ★X.X"* (`src/modules/expeditions/index.ts:50-53`). Locked sites remain selectable and fail with the not-unlocked message rather than being hidden (`src/core/autocomplete.ts:26-31`).

> **Correction applied.** Do **not** write "the maximum cash bonus is always smaller than the site's cost." At **Coastal Dig the maximum bonus (200) equals the cost (200)** — the best case there is break-even, not a loss (`src/data/sites.ts:12-13`). The weaker conclusion still holds: no site's cash bonus can exceed its fee, so an expedition never turns a raw cash profit — the egg and the food are the payoff (inferred arithmetic).

---

## Battle campaign

### Structure

Four chapters, played in order, each with exactly 5 stages whose 5th is the boss (`src/data/battle/chapters/index.ts:36`; `tests/battle-content.test.ts:22-31`).

| # | Chapter | Tagline | Source |
| --- | --- | --- | --- |
| 1 | Coastal Dig | "Sun, sand, and something hunting in the surf." | `src/data/battle/chapters/coastal_dig.ts:8-9` |
| 2 | Amber Ridge | "Sunset cliffs with teeth in the shadows." | `src/data/battle/chapters/amber_ridge.ts:7-8` |
| 3 | Frozen Cliffs | "The ice remembers what it buried." | `src/data/battle/chapters/frozen_cliffs.ts:7-8` |
| 4 | Volcano Core | "Only tyrants walk the caldera." | `src/data/battle/chapters/volcano_core.ts:8-9` |

### Unlocking

| Gate | Rule | Source |
| --- | --- | --- |
| Stage | Stage 1 of a chapter is always open; every later stage needs **at least 1 star** on the stage before it. | `src/data/battle/chapters/index.ts:46-53` |
| Chapter | Chapter 1 is always open. Every later chapter needs **both** a recorded first clear of the previous chapter's boss **and** a best-ever park rating ≥ the matching expedition site's unlock rating. | `src/data/battle/chapters/index.ts:55-63` |
| Rating half of the gate | Coastal Dig 0, Amber Ridge 150, Frozen Cliffs 250, Volcano Core 400 — the same numbers as the identically named expedition sites. | `src/data/sites.ts:12-19`; `src/data/battle/chapters/index.ts:62` |

Merely earning stars on a boss stage is not enough — a first clear must actually be recorded (`src/data/battle/chapters/index.ts:60-61`; `tests/battle-content.test.ts:173-174`).

### Stage tables

Columns: energy cost · enemy level · base cash · base food · base XP · first-clear shards. Cash/food/XP shown are the **1-star base**; star multipliers apply on top.

**Coastal Dig** (`src/data/battle/chapters/coastal_dig.ts:10-40`)

| # | Stage | ⚡ | Lv | Cash | Food | XP | Shards |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Tidepool Scrappers | 1 | 1 | 40 | — | 30 | 2 |
| 2 | Dune Grazers | 1 | 2 | 55 | 2 Ferns | 35 | 2 |
| 3 | Shorebreak Patrol | 1 | 2 | 70 | — | 40 | 2 |
| 4 | Riptide Hunters | 2 | 3 | 90 | 2 Fish | 50 | 3 |
| 5 | 👑 Old Riptooth's Cove | 3 | 3 | 150 | 3 Fish | 70 | 5 |

**Amber Ridge** (`src/data/battle/chapters/amber_ridge.ts:9-39`)

| # | Stage | ⚡ | Lv | Cash | Food | XP | Shards |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Ridge Runners | 1 | 3 | 90 | — | 50 | 3 |
| 2 | Amber Hollow | 1 | 4 | 110 | — | 60 | 3 |
| 3 | Sandstone Stampede | 1 | 4 | 130 | 2 Fruit Basket | 70 | 3 |
| 4 | Cliffside Ambush | 2 | 5 | 160 | — | 80 | 4 |
| 5 | 👑 The Alpha's Perch | 3 | 5 | 240 | 3 Goat | 95 | 7 |

**Frozen Cliffs** (`src/data/battle/chapters/frozen_cliffs.ts:9-39`)

| # | Stage | ⚡ | Lv | Cash | Food | XP | Shards |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Glacier Scouts | 1 | 5 | 150 | — | 75 | 4 |
| 2 | Icefall Pack | 1 | 6 | 180 | 2 Goat | 85 | 4 |
| 3 | Frozen Shelf | 1 | 6 | 210 | — | 95 | 4 |
| 4 | Aurora Hunt | 2 | 7 | 250 | — | 105 | 5 |
| 5 | 👑 Stormwing's Eyrie | 3 | 7 | 330 | 3 Royal Greens | 120 | 9 |

**Volcano Core** (`src/data/battle/chapters/volcano_core.ts:10-40`)

| # | Stage | ⚡ | Lv | Cash | Food | XP | Shards |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Ashfield Prowlers | 1 | 7 | 220 | — | 100 | 5 |
| 2 | Lava Tube Lurkers | 1 | 8 | 260 | — | 110 | 5 |
| 3 | Obsidian Wastes | 1 | 8 | 300 | 2 Prime Steak | 120 | 5 |
| 4 | Caldera Rim | 2 | 9 | 350 | — | 135 | 6 |
| 5 | 👑 Throne of the Tyrant | 3 | 9 | 400 | 4 Prime Steak | 150 | 12 |

Energy cost is set by stage position: stages 1–3 cost 1, stage 4 costs 2, every boss stage costs exactly 3 (`tests/battle-content.test.ts:65-70`). Clearing the entire campaign pays **93** first-clear shards in total (`tests/battle-content.test.ts:99-102`; inferred arithmetic confirms 14 + 20 + 26 + 33).

### Energy

| Rule | Source |
| --- | --- |
| Cap 10; +1 every 10 minutes. | `src/data/battle/constants.ts:1-2` |
| Regenerates in whole 10-minute ticks only; fractional progress is banked. At the cap the timestamp snaps to now, so a full pool never accrues hidden overflow. | `src/data/battle/energy.ts:12-16` |
| A full refill from empty takes 100 minutes. | `src/data/battle/constants.ts:1-2` (inferred arithmetic) |
| Energy is deducted whether you win or lose — the spend is written on every resolved attempt. | `src/modules/battles/service.ts:111, 116-117` |
| Insufficient energy is refused **before anything happens**, with a message naming what you need, what you have, and when the next point arrives. | `src/modules/battles/service.ts:65-68` |

### Squads

| Rule | Source |
| --- | --- |
| A squad is 1 to 3 dinos: *"Bring 1–3 dinos."* | `src/modules/battles/service.ts:46` |
| The same dino cannot be entered twice: *"Each dino can only fight once per squad."* | `src/modules/battles/service.ts:47` |
| You may only field dinos you own. | `src/modules/battles/service.ts:56` |
| An escaped dino cannot fight; it is also filtered out of the picker entirely, and a dino already chosen in another slot is not offered again. | `src/modules/battles/service.ts:57-58`; `src/modules/battles/index.ts:195-201` |
| Dinos **locked by a pending trade CAN still fight** — battling never consumes or transfers a dino. | `src/modules/battles/service.ts:51-53` |

### Enemy roster scaling

Enemy count matches your squad size. A normal stage fields the first N of its 3 authored enemies (rosters are authored weakest-first), so a solo dino faces only the weakest enemy. **Boss stages always field the boss** — with a squad of 1 or 2 you fight the first N−1 enemies *plus* the boss (`src/data/battle/chapters/index.ts:77-84`).

> **Ambiguity to avoid.** "Bring fewer dinos for an easier fight" is roughly neutral on normal stages but a **trap on boss stages**: a 1-dino squad fights the boss alone, with no filler enemies to absorb hits.

### Combat resolution

| Rule | Source |
| --- | --- |
| Turn order is by speed, highest first. On a speed tie your dinos act before the enemy; within a side the earlier squad slot acts first. | `src/data/battle/resolve.ts:22-25` |
| Every attacker targets the enemy with the **lowest current HP**. | `src/data/battle/resolve.ts:33-36` |
| Damage = attacker's attack × a random 0.85–1.15 swing, minus half the target's defence, floored at 1. | `src/data/battle/resolve.ts:37-39` |
| Every hit has a **10% chance to crit for 1.5×**, rolled after the damage swing. | `src/data/battle/resolve.ts:38, 40` |
| Support-archetype fighters heal after they attack: the lowest-HP living ally recovers 25% of the damage just dealt, never above max HP. **The pool includes the support itself** — a solo support heals itself, and in a squad it heals itself if it is the lowest-HP member. The heal is skipped entirely when the chosen target is already at full HP. | `src/data/battle/resolve.ts:48-57` |
| A fight runs at most **30 rounds**. | `src/data/battle/constants.ts:3`; `src/data/battle/resolve.ts:29` |
| You win only if **every** enemy is knocked out **and** at least one of your dinos is still standing. Running out of rounds with enemies alive is not a win. | `src/data/battle/resolve.ts:65-66` |

Neither the damage formula, the crit chance, nor the 30-round cap is surfaced to players anywhere in-game — they are engine-internal values (no in-game text found; inferred).

### Stats

Base stats by rarity (`src/data/battle/stats.ts:7-15`; roughly ×1.45 per tier):

| Rarity | HP | ATK | DEF | SPD |
| --- | --- | --- | --- | --- |
| Common | 60 | 12 | 6 | 10 |
| Uncommon | 87 | 17 | 9 | 15 |
| Rare | 126 | 25 | 13 | 22 |
| Epic | 183 | 36 | 19 | 32 |
| Legendary | 265 | 52 | 28 | 46 |
| Mythic | 384 | 75 | 41 | 67 |

Archetype multipliers (`src/data/battle/stats.ts:17-22`):

| Archetype | HP | ATK | DEF | SPD |
| --- | --- | --- | --- | --- |
| Bruiser | 1.0 | 1.3 | 0.85 | 1.0 |
| Tank | 1.35 | 0.8 | 1.4 | 0.75 |
| Swift | 0.85 | 1.1 | 0.85 | 1.45 |
| Support | 1.0 | 0.85 | 1.0 | 1.1 |

Final stat = base × archetype multiplier × (1 + 0.08 × (level − 1)), floored (`src/data/battle/stats.ts:40-46`). Hunger, comfort, habitat, and park facilities have **no effect** on battle power — fight stats come only from species rarity, archetype, and battle level (`src/data/battle/stats.ts:36-47`) (inferred: no other input).

### Battle level and XP

Level runs 1 to a cap of 10 (`src/data/battle/constants.ts:4`). Cumulative XP thresholds (`src/data/battle/stats.ts:26`):

| Level | Cumulative XP |
| --- | --- |
| 2 | 100 |
| 3 | 250 |
| 4 | 450 |
| 5 | 700 |
| 6 | 1,000 |
| 7 | 1,400 |
| 8 | 1,900 |
| 9 | 2,500 |
| 10 | 3,200 |

Each level adds +8% to HP, attack, defence and speed (`src/data/battle/stats.ts:40`). Battles are the only source of battle XP anywhere in the game (`src/modules/battles/service.ts:136`) (inferred: no other write to `battleXp`).

### Stars and rewards

Star rating (`src/data/battle/resolve.ts:110-115`), **evaluated in this order**:

1. Loss → **0 stars**.
2. Win with **zero** knockouts → **3 stars**.
3. Otherwise, win with at most 1 knockout **or** finished in ≤ 12 rounds → **2 stars**.
4. Any other win → **1 star**.

> **Ambiguity to avoid.** Because the zero-knockout check runs first, a fast (≤ 12-round) win with 2+ knockouts is **2 stars**, and a slow win with 2+ knockouts is **1 star**. "At most 1 knockout" is only ever evaluated after 3 stars is ruled out.

Reward scaling:

| Reward | Loss | 1★ | 2★ | 3★ | Source |
| --- | --- | --- | --- | --- | --- |
| Cash | 0 | ×1 | ×1.25 | ×1.5 | `src/data/battle/constants.ts:5`; `src/modules/battles/service.ts:106` |
| Food | 0 | ×1 | ×1.25 | ×1.5 | `src/data/battle/constants.ts:5`; `src/modules/battles/service.ts:107-109` |
| XP | **×0.25** (consolation) | ×1 | ×1.25 | ×1.5 | `src/data/battle/constants.ts:6`; `src/modules/battles/service.ts:103` |
| First-clear shards | 0 | full | full | full — **not scaled by stars** | `src/modules/battles/service.ts:100, 110` |

Rounding differs by reward type (`src/modules/battles/service.ts:103-109`):
- **Cash and food**: `Math.round` on the whole product. A stage paying 2 food gives **3** units at 2 stars (2 × 1.25 = 2.5 rounds up) and 3 units at 3 stars.
- **XP**: `Math.round` on the total, then a floored even split across the squad, with any remainder handed to **squad slot 1**. A solo dino keeps the whole XP payout.

First-clear shards are paid once, the first time you win a stage. A 1-star first win pays the same shards as a 3-star one (`src/modules/battles/service.ts:100, 110`).

Your record for a stage keeps your **best** star rating ever earned — a worse rerun never lowers it — and counts every attempt (`src/modules/battles/service.ts:124-129`).

### Bosses

Bosses are the same species with **2.5× HP, 1.2× attack**, and a level bonus on top of the stage's enemy level (`src/modules/battles/service.ts:88-92`).

| Boss | Chapter | Species | Level bonus | Effective level | Source |
| --- | --- | --- | --- | --- | --- |
| Old Riptooth | Coastal Dig | Baryonyx | +1 | 4 | `src/data/battle/chapters/coastal_dig.ts:32, 36-37` |
| Ridgeback Alpha | Amber Ridge | Allosaurus | +1 | 6 | `src/data/battle/chapters/amber_ridge.ts:31, 35-36` |
| Stormwing | Frozen Cliffs | Quetzalcoatlus | +2 | 9 | `src/data/battle/chapters/frozen_cliffs.ts:31, 35-36` |
| The Tyrant King | Volcano Core | Tyrannosaurus | +2 | **11** | `src/data/battle/chapters/volcano_core.ts:32, 36-37` |

The Volcano Core boss therefore fights at level 11, above the player level cap of 10 — the cap in `battleLevel` applies only to player dinos, not to `statsFor` (`src/data/battle/stats.ts:28-34, 36-46`) (inferred). No UI communicates this to players (inferred: none found).

### The fight presentation

| Rule | Source |
| --- | --- |
| The fight plays back as a **4-frame cinematic with 2.5 seconds between frames**, with a **Skip** button that jumps straight to the result. | `src/data/battle/constants.ts:7`; `src/modules/battles/index.ts:74-77, 98-104` |
| **All rewards are banked before the cinematic starts** — skipping the replay, or the replay failing, never costs you the payout. | `src/modules/battles/service.ts:31-33, 115-145`; `src/modules/battles/index.ts:107-110` |
| The **"⚔️ Fight again"** button re-runs the exact same squad against the same stage through the full pipeline, including a fresh energy charge. | `src/modules/battles/index.ts:227-239` |
| After a bot restart, a pre-restart "Fight again" button reports *"That battle expired — start a new one with /battle fight."* | `src/modules/battles/index.ts:58, 228-229` |
| The result frame shows stars, round count, the reward lines, and a live **Energy** field with a relative timestamp for the next +1. | `src/modules/battles/embeds.ts:106-113, 31-34` |

### `/battle chapters`

A Prev/Next chapter browser (`src/modules/battles/embeds.ts:134-165`). Each page shows the chapter title and tagline, per-stage star glyphs (`⭐`/`☆`) or a `🔒` lock, a `👑` crown on the boss stage, each stage's energy cost, and a live **Energy** field. Locked chapters read *"🔒 Locked — beat the previous chapter's boss and raise your park rating."*

---

## Shop and selling

### Egg prices

| Rarity | Shop price | Source |
| --- | --- | --- |
| Common | 500 | `src/data/shop.ts:4` |
| Uncommon | 2,000 | `src/data/shop.ts:4` |
| Rare | 8,000 | `src/data/shop.ts:4` |
| Epic | 30,000 | `src/data/shop.ts:4` |
| Legendary | 120,000 | `src/data/shop.ts:4` |
| Mythic | never sold for cash | `src/modules/shop/service.ts:27` |

### The daily rotation

| Rule | Source |
| --- | --- |
| The shop draws up to **3** rarities from the pool at or below your rarity ceiling — **with Legendary filtered out of that draw pool**. | `src/modules/shop/service.ts:16, 20-21` |
| Legendary is added separately on a **10% daily roll**, and only once your ceiling reaches Legendary. So a Legendary day shows **four** eggs, not three. | `src/modules/shop/service.ts:19, 22`; `src/data/shop.ts:7` |
| While your ceiling is Uncommon there are only 2 rarities to draw from, so you see 2. | `src/modules/shop/service.ts:16, 21` (inferred arithmetic) |
| The rotation is seeded purely by `floor(now / 86,400,000)`, so it changes once every 24 hours and is identical for every player with the same ceiling. | `src/modules/shop/service.ts:17-18` (inferred) |
| Trying to buy a rarity outside today's rotation: *"A &lt;rarity&gt; egg isn't in today's rotation — see /shop view."* | `src/modules/shop/index.ts:62` |

Rarity ceiling by **best-ever** rating (`src/data/progression.ts:10-15, 22-24`):

| Best-ever rating | Shown as | Highest buyable rarity |
| --- | --- | --- |
| 0–99 | below 1.0★ | Uncommon |
| 100–199 | 1.0★ | Rare |
| 200–349 | 2.0★ | Epic |
| 350+ | 3.5★ | Legendary |

`/shop view` also lists the full food market (all six items with unit cost and fill value) and every decor item with its cost (`src/modules/shop/index.ts:41-49`).

### Selling dinos

| Rule | Source |
| --- | --- |
| `/sell dino:<id>` shows a **confirm preview** with the cash value and the shard range, plus a "Confirm sale" button. The dino is permanently deleted on confirmation. | `src/modules/shop/index.ts:122-136, 156-164`; `src/modules/shop/shards.ts:35` |
| Cash is a flat amount by rarity: 50 / 150 / 500 / 1,500 / 5,000. | `src/data/sell.ts:5-7` |
| Shards are a random roll by rarity: 1–3 / 3–6 / 8–15 / 20–35 / 50–80, inclusive at both ends. | `src/data/rarity.ts:4-9`; `src/core/rolls.ts:26-33` |
| Mythics cannot be sold at all. | `src/modules/shop/shards.ts:21` |
| A dino locked by a pending trade cannot be sold: *"That dino is locked (in a pending trade)."* | `src/modules/shop/shards.ts:19` |
| A dino received **through a trade** pays **0 shards** — it still pays full cash value. | `src/modules/shop/shards.ts:26`; `src/modules/trading/service.ts:77` |
| **Escaped dinos can still be sold** — there is no escape check on either the preview or the sale. | `src/modules/shop/shards.ts:15-21, 41-55` |
| Selling recomputes park rating. | `src/modules/shop/shards.ts:37` |

### The shard cap

| Rule | Source |
| --- | --- |
| Selling earns at most **40 shards per 24-hour window**. Sales past the cap still pay cash; the rolled shards above the cap are lost, and the reply appends *"(shard cap reached)"*. | `src/data/sell.ts:2-3`; `src/modules/shop/shards.ts:27-28, 38`; `src/modules/shop/index.ts:161` |
| The window is **not** a calendar day. It is re-evaluated only when you sell: any sale occurring ≥ 24 h after the stored window start resets the window to that moment — **including a sale that pays zero shards** (a trade-acquired dino, or a sale after the cap was hit). | `src/modules/shop/shards.ts:23-25, 32-34` |
| The window never rolls forward on its own — a player who stops selling keeps a stale window until their next sale. | `src/modules/shop/shards.ts:23-25` (inferred) |
| **Shards from first-time battle clears bypass this cap entirely.** `runFight` credits them through `economy.apply` and never reads or writes the shard-window columns; only `sellDino` touches them. | `src/modules/battles/service.ts:110, 119-120`; contrast `src/modules/shop/shards.ts:24-28, 32-34` |

### Cash sinks, summarised

| Sink | Range | Source |
| --- | --- | --- |
| Expedition fees | 200 / 1,000 / 4,000 / 15,000 | `src/data/sites.ts:12-19` |
| Shop eggs | 500 / 2,000 / 8,000 / 30,000 / 120,000 | `src/data/shop.ts:4` |
| Food | 10–24 per unit | `src/data/foods.ts:11-16` |
| Decorations | 400–800 | `src/data/decor.ts:3-10` |
| Lot builds | 2,000 (paddock) / 5,000 / 8,000 / 10,000 | `src/data/paddocks.ts:3-4`; `src/data/facilities.ts:7, 13, 18` |
| Lot upgrades | 5,000–500,000 | `src/data/facilities.ts:7, 13, 18`; `src/modules/park/service.ts:75-76` |
| Rescue fees | 240–36,000 | `src/data/care.ts:1`; `src/data/rarity.ts:4-9` |

---

## Trading

One command with five subcommands: `/trade offer`, `/trade list`, `/trade accept`, `/trade decline`, `/trade cancel` (`src/modules/trading/index.ts:70-89`).

### What an offer contains

A trade offer names one other player and sets both sides at once — what you give and what you want back, each in four categories: dinos, eggs, cash, and **one** food item plus quantity (`src/modules/trading/index.ts:71-82`). Dinos, eggs, cash and food can be traded; **shards cannot** — a trade side has no shard field at all (`src/core/db/schema.ts:93`).

### Gates and limits

| Rule | Value | Source |
| --- | --- | --- |
| Minimum park rating, **both** players | 200 (2.0★), checked on **current** rating — the one gate that does not use the high-water mark | `src/data/trade.ts:1`; `src/modules/trading/service.ts:55-56, 96-97` |
| Re-checked on accept | yes | `src/modules/trading/service.ts:96-97` |
| Trades you may **start** | 3 per rolling 24 hours; every trade you sent in that window counts, including declined, cancelled and expired ones | `src/data/trade.ts:2`; `src/modules/trading/service.ts:57-60` |
| Items per side | at most 5, counting dinos + eggs + food **stacks**. Cash does not count. | `src/data/trade.ts:3`; `src/modules/trading/validate.ts:3-5` |
| A food stack counts as one item regardless of unit count | yes | `src/modules/trading/validate.ts:4` |
| Offer expiry | 24 hours after creation | `src/data/trade.ts:4`; `src/modules/trading/service.ts:89` |

> **Ambiguity to avoid.** The trade-cap window and the offer-expiry window are the **same 24-hour constant**, and the daily counter uses a strict "created within the last 24 h" comparison against every trade you sent. It is **not** a fixed daily boundary that resets at a set time. (`src/data/trade.ts:2, 4`; `src/modules/trading/service.ts:57-60`)

### What cannot be traded

| Restriction | Message | Source |
| --- | --- | --- |
| Yourself | *"You cannot trade with yourself."* | `src/modules/trading/service.ts:54` |
| A bot | *"You cannot trade with a bot."* (checked in the command layer, not the service) | `src/modules/trading/index.ts:97` |
| Mythic dinos | *"Mythics cannot be traded."* | `src/modules/trading/service.ts:42` |
| Mythic eggs | *"Mythic eggs cannot be traded."* | `src/modules/trading/service.ts:48` |
| Escaped dinos | *"Dino #N has escaped — rescue it first."* | `src/modules/trading/service.ts:41` |
| Incubating eggs | *"Egg #N is incubating — it cannot be traded."* | `src/modules/trading/service.ts:49` |
| Items already in another pending trade | *"…is already in a pending trade."* | `src/modules/trading/service.ts:40, 47` |

### Locking

The dinos and eggs **you offer** are locked as soon as you send the offer (`src/modules/trading/service.ts:67-68`). Only the offerer's items are ever locked (`src/modules/trading/service.ts:126`).

> **Ambiguity to avoid.** "Locked items cannot be sold or re-offered" is exact for **dinos**. For **eggs** it is overstated: the lock is honoured by `/sell` and `/trade`, but **ignored by `/incubate` and `/hatch`** — neither reads the `locked` flag. An offerer can hatch an egg they have already escrowed; the egg row is then deleted and the recipient's accept fails ownership re-verification, leaving the trade pending for the sender to cancel. (`src/modules/hatchery/service.ts:25-32, 41-46`; `src/modules/trading/service.ts:44-47, 94`; `src/modules/shop/shards.ts:19`)

### Resolution

| Rule | Source |
| --- | --- |
| Only the recipient can accept or decline; only the sender can cancel. | `src/modules/trading/service.ts:88, 134, 141` |
| Accepting re-checks that both sides still own everything and can still pay. If something changed, the accept fails but the offer stays **open**, so the sender can still cancel it. | `src/modules/trading/service.ts:90-95` |
| Declining, cancelling, or expiring closes the trade and unlocks the offered items. Nothing changes hands. | `src/modules/trading/service.ts:119-129` |
| Traded dinos arrive **unassigned** from any paddock — you must place them in a lot before they earn. | `src/modules/trading/service.ts:76-78` |
| Dinos and eggs obtained through a trade are flagged `viaTrade` and sell for **0 shards** (full cash value still applies). | `src/modules/trading/service.ts:73-81`; `src/modules/shop/shards.ts:26` |
| Cash and food net out exactly between the two players — a trade never creates currency. | `src/modules/trading/service.ts:101-110` |
| Both players' park ratings are recalculated the moment a trade is accepted. | `src/modules/trading/service.ts:114-115` |
| Expired offers are cleaned up lazily — marked expired and unlocked the next time either player runs a `/trade` command or uses trade autocomplete. | `src/modules/trading/service.ts:145-150`; `src/modules/trading/index.ts:92, 99, 165` |
| `/trade list` is paginated 10 per page, owner-locked. | `src/modules/trading/index.ts:60-61, 226`; `src/core/paginate.ts:3` |

Offering a trade to someone who has never played **creates a park account for them** (`src/modules/trading/index.ts:98`) — a side effect, not documented intent.

---

## Rating, ranks, and leaderboards

### The formula

**Park rating = round( 500 × (0.40 × Collection + 0.35 × Park + 0.25 × Comfort) )** (`src/modules/park/rating.ts:24-25`; weights `src/data/progression.ts:6`).

It is stored as stars × 100 and displayed to one decimal, so a stored 340 shows as "3.4" (`src/modules/park/embeds.ts:25`). Because all three components are capped at 1 and the weights sum to 100%, the maximum is 500 = 5.0★ (inferred; not declared as a constant anywhere).

| Component | Weight | Definition | Source |
| --- | --- | --- | --- |
| Collection | 40% | Summed rarity weight of the **distinct** species you own ÷ the summed rarity weight of all 30 species (190). Duplicates add nothing. | `src/modules/park/rating.ts:16-18`; `src/data/progression.ts:3-5` |
| Park | 35% | (sum of all lot levels + total decor pieces placed) ÷ 40, capped at 1. 40 combined levels-plus-decor maxes it. | `src/modules/park/rating.ts:19-20`; `src/data/progression.ts:7` |
| Comfort | 25% | Average comfort of dinos that are **assigned to a paddock and not escaped**. 0 if you have no assigned dinos. | `src/modules/park/rating.ts:21-23` |

> **Ambiguity to avoid.** Unassigned and escaped dinos are **excluded from the comfort average** — they do not drag it down, they simply contribute nothing. But both still count toward the **collection** term. Parking a rare species unassigned still raises your rating. (`src/modules/park/rating.ts:16-23`)

### When rating is recalculated

Rating is recomputed on: hatch, sell, assign, unassign, decorate, build, upgrade, feed, rescue, and completing a trade (`src/modules/hatchery/service.ts:55`; `src/modules/shop/shards.ts:37`; `src/modules/park/dinos.ts:42, 50, 62`; `src/modules/park/service.ts:64, 84`; `src/modules/care/service.ts:47, 72, 94`; `src/modules/trading/service.ts:114-115`).

> **Correction that matters more than the list.** Rating is **not** recomputed by `/park view`, by collecting income, by settling escapes, or by the passage of time. The number on your dashboard, on `/top`, and on the trade gate is frozen at whatever it was after your last rating-changing action — even though the comfort term (25% of the score) decays continuously. **Do not write "your rating drops as your dinos get hungry"**; it drops the next time you do something that triggers a recompute. (`src/modules/park/embeds.ts:25` reads the stored `user.parkRating`; `src/modules/park/index.ts:104-126` calls `settleEscapes` only; `src/modules/park/rating.ts:14, 27-28`)

Battle stars and first clears do **not** feed park rating: `runFight` never calls `recomputeRating` (it does not import it), and the formula has only the three terms above. The one indirect link is a boss trophy **egg** — hatching it can add a new distinct species and raise the collection term. (`src/modules/battles/service.ts:1-13, 115-145`; `src/modules/park/rating.ts:16-25`)

### High-water vs current rating

Alongside your current rating the game stores a **best-ever** rating that never decreases (`src/modules/park/rating.ts:26-28`).

| Gate | Uses | Source |
| --- | --- | --- |
| Lot slots | best-ever | `src/data/progression.ts:19-21`; `src/modules/park/service.ts:50` |
| Expedition site unlocks | best-ever | `src/data/progression.ts:18`; `src/modules/expeditions/service.ts:27` |
| Shop egg ceiling | best-ever | `src/data/progression.ts:22-24`; `src/modules/shop/index.ts:39` |
| Mythic purchases (400) | best-ever | `src/data/progression.ts:25`; `src/modules/shop/shards.ts:60` |
| Battle chapter rating half-gate | best-ever | `src/data/battle/chapters/index.ts:62`; `src/modules/battles/service.ts:41` |
| **Trading (200)** | **current** — the only gate that can be lost | `src/modules/trading/service.ts:16-17, 55-56` |

### Leaderboards

| Rule | Source |
| --- | --- |
| `/top` has exactly three metrics: **rating**, **cash**, **collection**. | `src/modules/leaderboards/index.ts:23-24` |
| Scope is **server** or **global**. Left blank it defaults to server inside a guild and global in DMs. | `src/modules/leaderboards/index.ts:25-26, 30` |
| Shows the **top 10**. No page, limit, or "show more" control is exposed. | `src/modules/leaderboards/service.ts:52-56` |
| Server scope ranks only players who have used the bot in that server; global ranks every registered player. | `src/modules/leaderboards/service.ts:20-32` |
| You count as a member of a server the moment you use any bot command or button there. | `src/core/router.ts:9-19, 39` |
| Rating board ranks by stored current park rating (one decimal); cash by current cash; collection by summed rarity weight of distinct species. | `src/modules/leaderboards/service.ts:43-47`; `src/modules/leaderboards/index.ts:16` |
| All boards sort highest first. **There is no tiebreak rule** — tied players' relative order is unspecified. | `src/modules/leaderboards/service.ts:48` |
| If you are not in the visible top 10, a footer shows your own rank and value. | `src/modules/leaderboards/index.ts:38-41` |
| A board rating can briefly lag reality if that player has an unsettled escape; it catches up the next time they interact with the bot. | `src/modules/leaderboards/service.ts:37-40` |

There are **no named star tiers** in the code — no "3-star park" labels. The game only ever displays a numeric rating like "3.4"; star thresholds appear solely inside gate constants and error messages. Any tier naming in the guide would be invented.

---

## Notifications

### The three notification kinds

| Kind | Trigger | Timing | Source |
| --- | --- | --- | --- |
| **Egg ready** | queued when you start incubating | fires when the egg finishes | `src/modules/hatchery/service.ts:37`; `src/core/notify.ts:54-67` |
| **Expedition returned** | queued when you start the expedition | fires when it returns | `src/modules/expeditions/service.ts:36`; `src/core/notify.ts:69-83` |
| **Trade** | immediate, not timer-driven | recipient is notified of a new offer; the sender is notified on accept and on decline | `src/modules/trading/index.ts:132-133, 145, 151` |

**Cancelling a trade you sent notifies nobody** — there is no notify call on the cancel path (`src/modules/trading/index.ts:152-154`).

There are **no** hunger or escape notifications. The scheduler registers only the egg-hatch and expedition-return handlers (`src/index.ts:29-30`), and escapes are settled lazily, so a player who never runs a command is never told a dino escaped.

### Content

| Notification | Contents | Source |
| --- | --- | --- |
| Egg ready | *"🥚 Egg ready"* — names the rarity, shows the egg art, gives the exact `/hatch egg:<id>` command | `src/core/notify.ts:59-64` |
| Expedition returned | *"🧭 &lt;Site&gt; — your expedition has returned!"* — shows the site banner, points at `/expedition claim` | `src/core/notify.ts:75-80` |
| Either | skipped entirely if you already hatched the egg / already claimed the expedition | `src/core/notify.ts:58, 73` |

### Delivery

| Rule | Source |
| --- | --- |
| **Channel first, DM second.** If the origin server has a notification channel set, the message posts there and pings you; otherwise it is sent as a DM with no ping. | `src/core/notify.ts:28-40` |
| Channel notifications always include an `@mention`; DM notifications never do. | `src/core/notify.ts:22-26` |
| If the configured channel cannot be posted to (deleted, no permission), the bot silently falls back to a DM. If the DM also fails, the notification is dropped with no error to you. | `src/core/notify.ts:33-40` |
| The channel used is the one configured in the server where you ran the command that started the timer — **not** wherever you happen to be when it fires. | `src/core/notify.ts:30-32` |
| If you started the incubation or expedition in a DM, the notification always arrives by DM. | `src/core/notify.ts:30` (inferred) |
| Trade notifications follow the same channel-then-DM rule. | `src/modules/trading/index.ts:132` |

### Timing and recovery

| Rule | Source |
| --- | --- |
| The bot checks for due notifications every **30 seconds**, plus once immediately at startup — so a notification can arrive up to about half a minute after the timer is technically up. | `src/index.ts:32, 41` |
| **Missed notifications are recovered after downtime.** Timers are persisted database rows and the scheduler queries every unhandled timer whose fire time has passed, on each tick and at boot. An egg or expedition that came due while the bot was offline still notifies when it comes back — late, not never. | `src/core/scheduler.ts:21-25, 33-34`; `src/index.ts:32, 41` |

### `/settings channel`

| Rule | Source |
| --- | --- |
| Sets the server's notification channel for hatch and expedition pings. | `src/modules/settings/index.ts:11-17` |
| Requires the **Manage Server** permission. | `src/modules/settings/index.ts:10` |
| Only accepts a normal guild text channel. | `src/modules/settings/index.ts:12` |
| Only works inside a server: *"Use this in a server."* | `src/modules/settings/index.ts:14` |
| The confirmation is private (ephemeral). | `src/modules/settings/index.ts:18` |
| Running it again simply replaces the previous channel for that server. | `src/modules/settings/index.ts:16-17` |
| There is **no way to clear or unset** the channel — the option is required and the settings table stores nothing else. | `src/modules/settings/index.ts:12`; `src/core/db/schema.ts:133-136` |
| There is **no per-player notification preference at all** — no DM opt-out, no way to force DMs when a channel is configured, no per-type toggle. The only stored setting is one channel id per server. | `src/core/db/schema.ts:133-136` |

---

## `/help` as a player surface

`/help` with no topic prints an overview containing a six-step "first 10 minutes" walkthrough plus a jump link to every topic (`src/modules/help/index.ts:105-114`). There are **nine** topics (`src/modules/help/index.ts:12-73`):

`getting-started` · `park` · `eggs` · `expeditions` · `shop` · `care` · `trading` · `ranks` · `battles`

The `park` topic renders the reader's **own** park map, degrading to a text-only embed if the render fails (`src/modules/help/index.ts:92-101`).

The in-game first-10-minutes walkthrough reads (`src/modules/help/index.ts:14-21`):

1. `/park view` — see your park and the Collect button.
2. `/expedition start site:coastal_dig` — send a dig crew (15 min).
3. `/expedition claim` when it returns — you get an egg + cash + food.
4. `/incubate egg:<id>`, then `/hatch egg:<id>` when ready.
5. `/build kind:herbivore_paddock`, then `/dino assign` — unassigned dinos earn nothing.
6. `/feed all` regularly — hungry dinos get uncomfortable and eventually escape.

> **Caution.** The `park` help topic currently states *"decor boosts comfort for matching biomes"* (`src/modules/help/index.ts:27`) and the `care` topic states premium food keeps dinos fed longer (`src/modules/help/index.ts:52`). The first of those is exactly the claim flagged as unresolved below — do not treat the in-game help text as a source of truth for it.

---

## Open questions and gaps

Nothing in this section is safe to publish as fact.

### 1. The decor comfort bonus appears unreachable in normal play — needs a maintainer decision

Habitat fit reaches 1.0 only when a **stored decor string equals one of the species' biome tags** (`src/core/clock.ts:22`). But `/decorate` stores the decor **kind** (`palm_tree`, `boulder`, `grass_tuft`, …) at `src/modules/park/dinos.ts:59`, while species biome tags are **biome names** (`forest`, `plains`, `swamp`, `volcanic`, `coast`) at `src/data/species/*.ts:4`. The two vocabularies do not overlap. On that reading, the best achievable fit in real play is 0.75, and buying decor gives no comfort benefit at all — only park rating.

The `DecorDef` type does carry a `biomeTags` field (`src/data/decor.ts:1-10`) that no code reads. The unit tests pass biome strings directly into `paddockFit` (`tests/clock.test.ts:25`), so they never exercise the real `/decorate` path. The in-game `/help` text claims decor boosts comfort (`src/modules/help/index.ts:27`).

**I could not determine whether this is intentional design or a bug. The guide must not state either a comfort benefit or the absence of one until a maintainer decides.** All escape-time rows in the fit-1.0 column of the Care section are affected by this.

### 2. Ice Block has no possible beneficiary

Ice Block (700 cash) carries the `tundra` biome tag (`src/data/decor.ts:8`), and **no species in the roster has a tundra tag** (tally in the Species roster section). Even if the decor/biome match worked, Ice Block would match nothing.

### 3. Shop rotation timezone

The daily seed is `floor(now / 86,400,000)`, which is UTC-midnight-aligned (`src/modules/shop/service.ts:17`), but nothing in the source states a timezone. Any "resets at UTC midnight" phrasing is an inference, not a stated rule.

### 4. Daily rotation shuffle is biased

`dailyEggOffers` uses `sort(() => rng() - 0.5)` (`src/modules/shop/service.ts:21`), which is a biased shuffle rather than a uniform one. I did **not** compute the resulting per-rarity appearance frequencies, so the guide must not claim "each eligible rarity appears equally often".

### 5. Mythic egg from a Volcano Core expedition

A Mythic egg from an expedition has no pinned species (`src/modules/expeditions/service.ts:55`), so at hatch it should roll evenly between Indominus rex and Indoraptor (`src/core/rolls.ts:35-38`). That follows from the code paths but is not stated or tested anywhere directly.

### 6. Absence-of-evidence claims

Each of the following is "I found no code that does this," not a positive rule. State them only if the maintainer is comfortable:

- No pity timer, duplicate protection, or luck modifier anywhere in the roll path (`src/core/rolls.ts`).
- No cap on total eggs held, and no egg-expiry mechanic.
- No expedition failure, risk, injury, or partial-loot mechanic; no dormant or disabled version of one.
- No expedition cancel/abort/refund path — only `start`, `status`, `claim`.
- No expedition expiry: an unclaimed returned expedition appears to sit indefinitely. I did not exhaustively audit the scheduler for a cleanup job.
- No refund or partial refund for any build, upgrade, or decor purchase.
- No demolition or sale of a built lot in normal play.
- No lot-slot purchase path — slots are purely rating-gated.
- No dedicated "list all sites" command; the only browsing surfaces are the `/expedition start` picker and the `expeditions` help topic.

### 7. Untested Mythic-specific numbers

The Mythic rescue fee (36,000) and Mythic feed cost (160 units) are arithmetic from the rarity table. I found no place that displays or pins those Mythic-specific figures, and no test covers them.

### 8. Escape settlement vs. the income cap window over long absences

`settleEscapes` stamps the actual escape instant (`src/modules/park/escapes.ts:14-17`), but I did not trace every ordering case for a player who does not collect for weeks. The interaction of a long-past escape with the cap window is not fully verified.

### 9. Two-Visitor-Center behaviour is untested

`capHours` takes the first Visitor Center row it finds (`src/modules/park/service.ts:39-42`), not the highest-level one. I confirmed this by reading, but found no test pinning it, and it is an unusual enough situation that it may not be intended behaviour.

### 10. Enemy archetypes are not surfaced

Each stage's enemy species is authored in the chapter files, and each species' archetype (which changes its stats and whether it heals) is fixed. I verified the four boss species' archetypes (Baryonyx swift, Allosaurus bruiser, Quetzalcoatlus swift, Tyrannosaurus bruiser) but did not check whether any UI communicates an ordinary enemy's archetype to players.

### 11. Trade-locked egg hatch is a real hole, not a documented rule

`incubateEgg` and `hatchEgg` ignore the `locked` flag (`src/modules/hatchery/service.ts:25-32, 41-46`), so an offerer can hatch an escrowed egg and strand the trade. This is confirmed behaviour, but it reads as a bug rather than a designed rule — flag it to the maintainer before describing it to players.
