# Spec 6a — The Art Bank

**Date:** 2026-08-24
**Status:** design approved, ready for planning

## Why this exists

Access to the image generator that produced every asset under `assets/images/`
ends soon. Code does not expire; generated art does. Everything that must be
drawn before that deadline is in scope here, and everything that merely *uses*
what gets drawn is deliberately out of scope.

That asymmetry is the organising principle of this spec. It is why 6a commits
roughly 150 image files that no `src/` code references yet, and why that is a
feature rather than an oversight.

## Scope

6a ships **art, its regeneration prompts, its producers, and the guards that
prove it correct**. It changes **no file under `src/`**.

| Spec | Deadline-bound | Contains |
|---|---|---|
| **6a (this one)** | **yes** | Every image. Naming convention. `docs/assets/prompts.md`. `scripts/fit-art.mjs` producers. Test guards. |
| 6b | no | The runtime variant resolver: seed hashing, `assetImage` variant selection, call-site wiring |
| 6c | no | Park renderer wiring: `landmark-d/e/f` bands, any future decor rasters |
| 6d | no | Chapters and species as ordinary data specs — their art already banked |

### Non-goals

- No runtime variant selection. A banked `care-v2.webp` is unreachable by the
  bot until 6b ships. That is intended.
- No new species, chapter, or expedition-site **data**. Only their art.
- No decor art. The park renderer draws decor as five green dots
  (`src/core/render/draw.ts:142`) and every icon it does draw is hand-authored
  SVG, because `renderParkPng` is synchronous and SVG is the only format that
  decodes synchronously. Hand-authored SVG costs no credits and has no
  deadline, so it must not consume deadline-bound budget.
- No re-generation of already-shipped art. Base files are never touched.

## §1 Architecture

### Naming

Variants are `<name>-v2.webp`, `<name>-v3.webp`, `<name>-v4.webp`, sitting
beside an **untouched** `<name>.webp`.

The `v` is load-bearing. Verified against the repo: no existing filename under
`assets/` and no species id anywhere in `src/data/species/` contains a digit or
a `-v` suffix, so a `-vN` suffix can never be mistaken for part of a base name.
A bare `-2` would not have that guarantee for future ids.

Because base files never move, the eleven `expect(p.files.map((f) => f.name))
.toEqual([...])` pins across the suite are untouched by the naming scheme
itself. They are affected by species gap-fill for a different reason — see §4.

### Guard posture

Today's disk-enumerating guards assert **exact membership**: `SPECIES_ART_FILES`
must `toEqual` an eight-name list, every banner on disk must be referenced from
`src/`. That was correct when the asset set was small and fully wired.

A bank is by definition ahead of its wiring, so 6a rewrites each such guard to
prove **shape** rather than **membership**:

- correct dimensions for its family
- correct transparency and margin for its family
- a documented regeneration prompt
- a name that parses as a legal variant of a base that actually exists

A stray `dinos/t-rex.webp` must still fail. A legitimately banked
`dinos/apatosaurus.webp` must not.

### One new guard 6a must add

**A variant may only exist if its base exists.** `collectt-v2.webp` is a typo
that banks an unreachable file, and without this guard nothing notices until the
credits are spent and the generator is gone. The check is a directory walk per
kind: strip a trailing `-vN`, assert the remainder is a committed base file.

## §2 Inventory

| Group | Files | Format | Credits |
|---|---|---|---|
| Species gap fill (44) | `dinos/<id>.webp` | 1024² cutout, 31px | 132 |
| Hot banner variants (10 × v2–v4) | `banners/<name>-v{2,3,4}.webp` | 1536×1024 | 60 |
| Egg variants (6 × v2–v4) | `eggs/<rarity>-v{2,3,4}.webp` | 1024² cutout, 24px | 54 |
| Crack variants (6 × v2–v4) | `hatch/<rarity>-crack-v{2,3,4}.webp` | 1024² cutout, 31px | 54 |
| Site banner variants (7 × v2–v3) | `sites/<id>-banner-v{2,3}.webp` | 1536×1024 | 28 |
| Landmark bands 4–6 | `park/landmark-{d,e,f}.webp` | 270×150 band | 6 |
| Chapters 8–10 | banner + thumb + boss portrait × 3 | mixed | 21 |
| Future species (12) | `dinos/<id>.webp` | 1024² cutout, 31px | 36 |
| **Total** | **148 files** | | **391** |

Budget available: **552 credits**. Headroom after plan: **161**.

Note `unlim.available` is `false` on this account — there is no free-generation
allowance. Every image spends credits.

### The 44 species lacking own art

allosaurus, ankylodocus, ankylosaurus, archelon, baryonyx, brachiosaurus,
carnotaurus, ceratosaurus, compsognathus, cryolophosaurus, deinosuchus,
dilophosaurus, dryosaurus, elasmosaurus, gallimimus, giganotosaurus, henodus,
hesperornis, iguanodon, kronosaurus, leaellynasaura, lesothosaurus, maiasaura,
massospondylus, microceratus, nanuqsaurus, nasutoceratops, othnielia,
ouranosaurus, pachycephalosaurus, pachyrhinosaurus, parasaurolophus,
pteranodon, scorpios_rex, sinosaurus, spinosaurus, stegoceratops, stegosaurus,
struthiomimus, therizinosaurus, thescelosaurus, triceratops, tylosaurus,
velociraptor.

### The 10 hot banners

`care`, `collect`, `dino_roster`, `eggs_incubator`, `shop_food_market`, `sell`,
`gene_lab`, `battle_victory`, `battle_defeat`, `daily`.

Chosen by exposure — how often a player actually sees the surface. Banners like
`help`, `leaderboards` and `achievements` are deliberately excluded: spending
credits to put three faces on a screen seen a handful of times ever buys less
than deepening the hatch reveal, which is hit constantly.

### The 12 banked future species

apatosaurus, suchomimus, utahraptor, styracosaurus, corythosaurus, troodon,
concavenator, sinoceratops, amargasaurus, dimorphodon, nodosaurus,
herrerasaurus.

None exists in `src/data/species/` today. Their art is banked so that adding
them in 6d stays a data-only change.

### Chapters 8–10

Ids are chosen to satisfy the chapter-id ≡ site-id invariant, so each also
forces an expedition site when 6d ships it.

**8 — Mainland Ferry (`mainland_ferry`).** The harbour the breach reaches the
mainland through. Banner: a listing car ferry half-beached against a concrete
pier at dusk, ramp buckled, gantry cranes behind, floodlights raking the water.
Boss — *the Harbormaster*: a barnacle-crusted semiaquatic apex that took the
terminal, hide scarred by mooring cable, framed against wet steel.

**9 — Ruined City (`ruined_city`).** Banner: a downtown canyon reclaimed —
collapsed overpass, vines down a glass tower, a nesting mound built in a plaza
fountain, haze and low sun between buildings. Boss — *the Tower Nester*: a large
flier whose wingspan reads against skyline, perched crest-forward on a broken
cornice.

**10 — Continental Divide (`continental_divide`).** Banner: high open
wilderness past any human structure — a mountain pass, migrating herd
silhouettes on a far ridge, enormous scale, no ruins at all. Boss — *the Divide
Alpha*: the apex of a wild-born generation, the first that never saw a fence.

The arc escalates outward in three beats: they reach the mainland, they take the
city, the city stops mattering. Chapter 10's banner deliberately carries no
human wreckage — that absence is the argument of the arc, and it is what
distinguishes these three from seven biome sites.

## §3 Generation pipeline

### Model

`nano_banana_pro` at `resolution: 2k`. It offers `3:2` (banners), `1:1`
(cutouts) and `16:9` (crop source for 270×150 bands) — every aspect this bank
needs.

### Reference chains

**Every family generates as a reference-chain edit, never from a bare prompt.**
This is what keeps the bank matching the shipped set instead of drifting into a
second house style. The recipes are already recorded in `docs/assets/prompts.md`
and must be reused verbatim:

| Family | Image reference |
|---|---|
| Species portraits | the archetype×diet portrait that species falls back to today |
| Egg variants | the committed egg of that rarity |
| Crack variants | the committed crack of that rarity |
| Banner variants | the committed base banner |
| Site banner variants | the committed base site banner |
| New chapter banners/thumbs | one generated 3:2 source per chapter; thumb is a centre crop of it |
| New boss portraits | `battles/boss-coastal_dig-portrait.webp` |

Rules carried verbatim into every prompt, all recorded in `prompts.md`:

- the shared glossy-cartoon style block
- the hard no-glow rule (no glow, rays, embers or sparkles beyond the
  silhouette — off-silhouette glow survives background removal as floating
  islands or a halo)
- facing right, snout right, for every portrait — two shipped bosses came back
  mirrored and needed flipping in post, so every generation is checked against
  the reference before shipping
- the "NOT an app icon — no rounded-rectangle tile, no border, no rounded
  corners" phrasing for thumbs
- the Founder's Park no-writing block, which exists because a prompt already
  asking for a blank surface still rendered a legible "WELCOME"

### Post-processing

| Family | Producer |
|---|---|
| banners, site banners | `fit-art.mjs banner` → 1536×1024 |
| landmark bands | `fit-art.mjs band` → 270×150 |
| cracks, species portraits | `remove_background` → `fit-art.mjs cutout` (31px) |
| boss portraits | `remove_background` → `fit-art.mjs portrait` (24px, **new**) |
| eggs | `remove_background` → `fit-art.mjs portrait --axis=egg` (24px, **new**) |
| site thumbs | centre square crop to 1024×1024 |

Every final write is WebP q95.

### Batch mechanics

`generate_image_batch` accepts ≤12 jobs; `jobs_wait` ≤12; one
`show_generation_by_ids` for ≤60. The bank runs as roughly 13 batches of 12.

### Pilot before batch

Each family generates **three images first**, which are compared against the
family's shipped reference before the rest is batched. A style miss caught at
image three costs 6 credits; caught at image 54 it costs 108.

### Spend order

Certain value before speculative value. If anything cuts the runway short, this
ordering determines what survives.

| Order | Group | Credits | Rationale |
|---|---|---|---|
| 1 | Species gap fill | 132 | Highest certain value — 52 species share 8 pictures today |
| 2 | Crack + egg variants | 108 | The hatch reveal is the emotional peak and is hit constantly |
| 3 | Hot banner variants | 60 | Certain value, most-seen surfaces |
| 4 | Site banner variants | 28 | Certain value, lower frequency |
| 5 | Landmark bands d–f | 6 | Cheap; finishes an incomplete set |
| 6 | Chapters 8–10 | 21 | **Speculative** — worthless if those chapters never ship |
| 7 | Future species | 36 | **Speculative**, same reason |

Speculative work is last deliberately. If generation goes badly, the bank loses
art for content that does not exist rather than art for 44 species that do.

## §4 Guards

Findings below come from a six-dimension reconnaissance sweep with adversarial
verification of each claim: 94 confirmed, 29 refuted.

### A. Species gap-fill re-resolves existing test fixtures

Five test files pin archetype-fallback filenames for species that are about to
gain their own portrait — `velociraptor` → `swift-carnivore.webp`,
`triceratops` → `tank-herbivore.webp`, `compsognathus` → `swift-carnivore.webp`:

- `tests/species-art.test.ts:77`
- `tests/hatchery.test.ts:271`
- `tests/battles-embeds.test.ts:91`
- `tests/battles-module.test.ts:59`
- `tests/park-tabs.test.ts:118`

None mocks `dinoImage`, so all go red.

The deeper consequence, which must be written into the repo's own notes:
**after 6a, `dinoImage`'s fallback arm is unreachable for every one of the 52
real species.** It remains reachable — and remains the guarantee that adding a
species is a data-only change — only for species with no committed file, which
after 6a means future ones. Fixtures asserting the fallback must therefore
re-aim onto a synthetic id. Precedent exists in `tests/images.test.ts`:
`dinoImage('no-such-species', 'bruiser', 'carnivore')`.

### B. Guards that break

| Guard | Why |
|---|---|
| `tests/images.test.ts:486` | `SPECIES_ART_FILES.toEqual(HERO_SPECIES)` — disk scrape filtered to real species ids, 8 → 52 |
| `tests/images.test.ts:505` | asserts `assetImage('dinos', s.id)` is **null** for all 44 non-hero species |
| `tests/images.test.ts:594` | stray check — the 12 banked ids are not in `SPECIES_IDS` |
| `tests/images.test.ts:169` | banner orphan guard — every non-`event-` banner must be referenced from `src/` |
| `tests/docs-assets.test.ts:29` | every `<N> banners` figure in `prompts.md` must equal `readdirSync('assets/images/banners').length`, **unfiltered** |

The last is the least obvious and the easiest to miss: the banner count is 33
today and becomes 63, and every prose mention of it in `prompts.md` must move in
the same commit or the suite goes red.

For `tests/images.test.ts:594`, the adaptation is an explicit hand-typed
allowlist of the 12 banked ids rather than a relaxation. A misspelled filename
still fails, because it appears in neither `SPECIES_IDS` nor the allowlist — so
the guard keeps the full protective value it has today.

### C. Silent gaps — new art escaping all checking

More dangerous than the breakages, because nothing goes red:

- Variants in `eggs/`, `hatch/`, `sites/` and `banners/` receive **zero**
  dimension or transparency checking. Every `it.each` is keyed to `RARITIES`,
  to `CAMPAIGN`, or to the `src/` scrape — never to disk.
- **`eggs/` has no dimension, corner-transparency or margin check at all**
  today, for any file.
- The three new boss portraits receive zero checking: `PORTRAIT_BOSS_IDS`
  derives from `CAMPAIGN`, which will not contain those chapters until 6d.
- `landmark-d/e/f` escape the hand-typed 270×150 list at
  `tests/park-art-assets.test.ts:33` and the hand-typed prompts-coverage list at
  `tests/docs-assets.test.ts:33`.

6a closes each of these by registering cases **from disk** for the families it
extends, so a banked file is checked exactly as a wired one is.

### D. Producer gaps — real deliverables, not prose

**1. The caBX strip is documented and not implemented.**
`scripts/fit-art.mjs:48-53` carries a six-line comment explaining the
C2PA/`caBX` decode trap, and line 55 then decodes with a bare
`img.src = readFileSync(src)`. Roughly 150 freshly generated PNGs are about to
pass through it. This must be implemented, not documented again.

**2. The 24px pass exists only as prose.** `docs/assets/prompts.md:172`
describes a five-step one-off pass — largest-connected-region, luminance-peel,
24px whole-bbox fit — implemented nowhere. `fit-art.mjs cutout` is 31px and
keeps all regions.

6a adds a **`portrait` mode** to `scripts/fit-art.mjs` implementing that pass,
making the shipped set reproducible for the first time and giving the egg
variants and the three new boss portraits a real producer.

**The 24px families are two recipes, not one.** The divergence table in
`prompts.md` records `eggs/` as *24px egg-axis, 1 region* and `battles/` as
*24px whole-bbox, 1 region* — they share a margin and differ in which axis the
fit is measured against. `portrait` therefore takes an `--axis` flag: default
whole-bbox for boss portraits, `--axis=egg` for the egg family. Collapsing the
two into one whole-bbox pass would silently reframe every regenerated egg
against the shipped six.

**The two cutout modes must never be confused.** `cutout` keeps **every** opaque
region, which the hatch cracks require — their falling shell fragments are
disconnected alpha regions on purpose, and `tests/images.test.ts:353` asserts
it. `portrait` keeps only the largest, which a single subject on a studio
background requires. Applying `portrait` to a crack silently deletes its
shell fragments, and no guard as it stands today would catch that on a variant.

## Deliverables

1. 148 image files under `assets/images/`.
2. `scripts/fit-art.mjs`: caBX strip implemented; new `portrait` mode with its
   `--axis` flag.
3. `docs/assets/prompts.md`: a regeneration entry for every new file; every
   count updated; the two cutout modes and their divergence documented.
4. Test guards adapted per §4 A–C.
5. A note in the repo's `CLAUDE.md` recording that `dinoImage`'s fallback arm is
   now reachable only for future species.

## Verification

- `npm test` green.
- `npm run typecheck` green — required, since this touches `tests/` and
  `scripts/`, and neither `npm run build` nor `npm test` typechecks those.
- Every new file carries a `prompts.md` entry.
- Every variant's base file exists.
- Credit spend recorded against the 391 estimate.

## Risks

- **List prices are optimistic.** Generations fail, return mirrored, or miss the
  style. The 161-credit headroom absorbs this; the spend order determines what
  is dropped if it does not.
- **Speculative art may never be used.** 57 credits ride on chapters 8–10 and
  12 species shipping in 6d. Accepted: they cannot be obtained later.
- **A large unwired asset set is only as auditable as its guards.** That is why
  §4 C is in scope rather than deferred to 6b — a bank nobody can check is a
  liability, not an asset.
