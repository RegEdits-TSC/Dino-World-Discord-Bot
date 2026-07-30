# Gameplay Guide

![Dino World](../assets/images/sites/amber_ridge-banner.png)

How Dino World actually works — what everything costs, how long things take, and
what raises your rating. For the commands themselves, see the
[command reference](commands.md).

## 1. Getting started

There is no `/start` or `/register`. Your park is created automatically the
first time you run any command — there is nothing to set up first. It is also
created for you the moment someone offers you a trade, even if you have never
touched the bot yourself.

Every new park begins with the same starting package:

| Thing | Starting value |
| --- | --- |
| Cash | 500 |
| Battle energy | 10 (already at the cap) |
| Park name | "New Park" |
| Park rating | 0.0★ |
| Pantry | 10 Ferns, 10 Fish |
| Lot slots | 3 |
| Incubator slots | 1 |

You begin with no dinos, no eggs, and no built lots — the pantry above is the
only inventory you start with.

## 2. Currencies

Dino World runs on four resources. Cash, Food, and Rating appear on the
`/park view` dashboard — Food shown per-item with counts, not as a single
number. Battle energy is visible on `/battle chapters` and on the
fight-result screen, not on the dashboard. Shards are the odd one out — see
the note below.

| Currency | What it is | How you earn it | What it's for |
| --- | --- | --- | --- |
| Cash | Main currency, never goes negative | Idle income from your dinos, expedition claims, selling dinos, winning battles | Building and upgrading lots, decor, food, expedition fees, shop eggs, rescue fees |
| Shards | Premium currency | Selling dinos, and the first time you clear a battle stage | Exactly one thing: buying a Mythic egg (500 shards) |
| Food | Six named items, not a single number | Bought with cash, dropped by expeditions and battles, tradeable | Feeding your dinos to keep their hunger up |
| Battle energy | Regenerates on its own, not really a currency | Regenerates over time (capped at 10) | Entering battle stages; cannot be bought, gifted, or refilled by any item |

**There is no player-facing screen that shows your shard balance.** The park
dashboard has five fields — Cash, Food, Rating, Dinos, Lots — and none of them
is shards. The only place a shard total is ever displayed is in the
confirmation message you get right after selling a dino. Do not go looking for
a shard count on `/park view`; it isn't there.

## 3. Your park

### Lot slots

You start with 3 lot slots and unlock one more each time your best-ever rating
crosses a threshold, up to a maximum of 8. Slots are gated by your **best-ever**
rating, which never falls — so once a slot unlocks, it's yours for good, even
if your current rating later drops. There is no way to buy a slot with cash.

| Slots unlocked | Rating needed |
| --- | --- |
| 1–3 | from the start |
| 4 | 0.5★ |
| 5 | 1.0★ |
| 6 | 2.0★ |
| 7 | 3.0★ |
| 8 | 4.0★ |

### Lot types

Every lot starts at level 1 with no decor. There are two kinds of paddock and
three kinds of facility:

| Lot | Type | Build cost | Max level |
| --- | --- | --- | --- |
| Herbivore Paddock | paddock | 2,000 | 4 |
| Carnivore Paddock | paddock | 2,000 | 4 |
| Visitor Center | facility | 5,000 | 5 |
| Food Court | facility | 8,000 | 3 |
| Hatchery Lab | facility | 10,000 | 3 |

Dinos can only be assigned to paddocks — never to facilities. Each paddock
holds 2 dinos per level, and upgrading roughly multiplies the previous cost by
2.5:

| Paddock level | Capacity | Cost to reach this level |
| --- | --- | --- |
| 1 | 2 | 2,000 (build) |
| 2 | 4 | 5,000 |
| 3 | 6 | 12,500 |
| 4 | 8 | 31,250 |

The **Visitor Center** sets the time window your idle income accumulates over
before it caps, and adds a flat bonus to your income:

| Level | Income cap window | Income bonus | Cost to reach |
| --- | --- | --- | --- |
| 1 | 8 h | +0% | 5,000 (build) |
| 2 | 12 h | +5% | 12,500 |
| 3 | 16 h | +10% | 31,000 |
| 4 | 20 h | +15% | 78,000 |
| 5 | 24 h | +20% | 500,000 |

The **Food Court** adds only an income bonus:

| Level | Income bonus | Cost to reach |
| --- | --- | --- |
| 1 | +4% | 8,000 (build) |
| 2 | +8% | 20,000 |
| 3 | +12% | 200,000 |

The **Hatchery Lab** grants incubator slots and nothing else — no income
bonus. A level-1 Lab gives you the same single slot you already have without
one, so the real upgrades start at level 2:

| Hatchery Lab level | Incubator slots | Cost to reach |
| --- | --- | --- |
| none | 1 | — |
| 1 | 1 | 10,000 (build) |
| 2 | 2 | 25,000 |
| 3 | 3 | 150,000 |

If you build more than one of the same facility, their income bonuses stack —
there's nothing stopping you from doing that.

### Decor

Decor is bought per paddock with `/decorate`. There are eight items, each
tagged to a biome:

| Decoration | Cash | Biome tag |
| --- | --- | --- |
| Grass Tuft | 400 | plains |
| Palm Tree | 500 | forest |
| Fern Cluster | 500 | forest, swamp |
| Boulder | 500 | plains |
| Reed Bed | 600 | swamp |
| Tide Pool | 700 | coast |
| Ice Block | 700 | tundra |
| Lava Rock | 800 | volcanic |

Decor can only be placed on paddocks, not facilities. You can stack as many
pieces on a paddock as you like — there's no per-paddock limit and no way to
remove one once placed. Every piece of decor you own raises your park rating,
because the rating's build-out term counts decor pieces alongside lot levels.

### The park map

`/park view` doesn't just show numbers — it renders an image of your park as
a grid of tiles, one per lot, showing each lot's icon, name, level, and the
dinos assigned to it. If the image ever fails to render, the dashboard still
replies with the same information as plain text, so the map is never required
to play.

## 4. Income

An assigned dino earns cash automatically over time, at a rate set by its
rarity and scaled by its comfort:

| Rarity | Income per hour |
| --- | --- |
| Common | 60 |
| Uncommon | 150 |
| Rare | 400 |
| Epic | 1,100 |
| Legendary | 3,000 |
| Mythic | 9,000 |

Only dinos assigned to a paddock earn anything — an unassigned dino sits at
zero comfort and produces nothing. A dino stops earning the instant its
hunger reaches 0, or the instant it escapes, whichever happens first.

Comfort itself is driven by hunger: as a dino's hunger drains, its comfort —
and therefore its earning rate — declines with it, down to nothing once
hunger and comfort bottom out. Overfeeding a dino past full hunger doesn't
raise its earning rate any further; it's paid fairly for the time it actually
spends at full comfort, then for the time it spends declining, roughly like a
dino that was fed a normal amount — overfeeding buys time before hunger runs
out, not a higher payout.

Income only accumulates within a capped window measured from your last
collection — 8 hours by default, or longer with a higher-level Visitor
Center. Time beyond that cap earns nothing, so collecting regularly matters;
pressing Collect resets the window and starts the clock over. The dashboard
warns you when pending income has been sitting long enough to be capped. Once
totalled, your facility income bonuses are added on top and the result is
rounded down to a whole number of cash.

## 5. Eggs and hatching

The six rarities, from lowest to highest: Common, Uncommon, Rare, Epic,
Legendary, Mythic.

Each rarity has its own fixed incubation time:

| Rarity | Incubation time |
| --- | --- |
| Common | 15 min |
| Uncommon | 1 h |
| Rare | 4 h |
| Epic | 12 h |
| Legendary | 24 h |
| Mythic | 48 h |

You can only incubate as many eggs at once as you have incubator slots — 1 by
default, or up to 3 with a fully upgraded Hatchery Lab. There's no limit on
how many eggs you can simply hold in reserve; only simultaneous incubation is
capped. A finished egg does not free its slot on its own — it keeps occupying
that incubator slot until you actually hatch it, so a full bank of ready eggs
can block you from starting any new ones.

The species inside an egg isn't decided when you get the egg — it's rolled
the moment you hatch it (unless the egg's species was pinned when you got it,
as with a Mythic egg bought with shards). Within its rarity, every species has
an equal chance: a flat pick across that rarity's pool, with no weighting
toward rarer or more desirable species and no duplicate protection — you can
hatch the same species twice in a row.

A newly hatched dino arrives unassigned to any paddock, and it earns nothing
until you place it in one.

## 6. The roster

Dino World has 30 species split across six rarities: 8 Common, 7 Uncommon, 6
Rare, 4 Epic, 3 Legendary, and 2 Mythic. Diet determines which paddock a dino
can live in without its comfort being halved, so it's worth knowing before you
start hatching: 16 species are herbivores and 14 are carnivores.

| Species | Rarity | Diet |
| --- | --- | --- |
| Triceratops | Common | herbivore |
| Gallimimus | Common | herbivore |
| Dryosaurus | Common | herbivore |
| Compsognathus | Common | carnivore |
| Struthiomimus | Common | herbivore |
| Othnielia | Common | herbivore |
| Microceratus | Common | herbivore |
| Nasutoceratops | Common | herbivore |
| Stegosaurus | Uncommon | herbivore |
| Parasaurolophus | Uncommon | herbivore |
| Dilophosaurus | Uncommon | carnivore |
| Iguanodon | Uncommon | herbivore |
| Maiasaura | Uncommon | herbivore |
| Pachycephalosaurus | Uncommon | herbivore |
| Ouranosaurus | Uncommon | herbivore |
| Velociraptor | Rare | carnivore |
| Carnotaurus | Rare | carnivore |
| Baryonyx | Rare | carnivore |
| Allosaurus | Rare | carnivore |
| Ankylosaurus | Rare | herbivore |
| Ceratosaurus | Rare | carnivore |
| Brachiosaurus | Epic | herbivore |
| Spinosaurus | Epic | carnivore |
| Therizinosaurus | Epic | herbivore |
| Giganotosaurus | Epic | carnivore |
| Tyrannosaurus | Legendary | carnivore |
| Mosasaurus | Legendary | carnivore |
| Quetzalcoatlus | Legendary | carnivore |
| Indominus rex | Mythic | carnivore |
| Indoraptor | Mythic | carnivore |
