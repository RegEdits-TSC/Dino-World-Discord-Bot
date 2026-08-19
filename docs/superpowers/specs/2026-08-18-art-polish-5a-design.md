# Spec 5a — Art coverage and hardening pass

**Date:** 2026-08-18
**Status:** Design approved, plan not yet written
**Baseline:** `fd61ebe` on `main` — 17 modules, 29 commands, 111 test files (~1794 tests), 53 custom emoji

## Summary

Fill every user-visible surface that currently ships bare text or borrows another
feature's art, give the six guest attractions real art on the park map, give the
eight rarest species portraits of their own, and run a full adversarial sweep of
all 17 modules fixing every confirmed defect.

No new commands. No new gameplay systems. No migration — unless the sweep forces
one, which is an explicit release gate — see **Hardening sweep**.

## Motivation

An exhaustive inventory of every payload-building function in `src/modules/**`
found the wiring clean — zero orphaned banner files, zero dangling `assetImage`
references — and the gap entirely in missing assets.

**Ten public surfaces ship neither an image nor a thumbnail:**

| Surface | Builder |
|---|---|
| `/park landmark` | `src/modules/park/embeds.ts:125` |
| `/duel challenge` | `src/modules/duels/embeds.ts:66` |
| `/duel record` | `src/modules/duels/embeds.ts:92` |
| `/guests view` | `src/modules/guests/embeds.ts:64` |
| `/guests build` | `src/modules/guests/embeds.ts:113` |
| `/guests claim` | `src/modules/guests/embeds.ts:140` |
| `/dex list` | `src/modules/dex/embeds.ts:47` |
| `/help topic:daily` | `src/modules/help/index.ts:90` |
| `/help topic:guests` | `src/modules/help/index.ts:98` |
| `/help topic:duel` | `src/modules/help/index.ts:104` |

Three ephemeral claim payloads are also bare: `daily:claim`
(`src/modules/daily/embeds.ts:64`), `ach:claimall` (`:112`), `season:claim`
(`src/modules/daily/season-embeds.ts:51`).

Neither of the two "ships no art" comments in the codebase records a design
decision. `src/modules/dex/embeds.ts:44` says *"this spec has no art"*;
`src/modules/guests/embeds.ts:13` says *"this module ships no art"*. Both are
statements of what a past release did not do.

**Four surfaces borrow another feature's art:**

| Surface | Borrows | Belongs to |
|---|---|---|
| `/season` (`daily/season-embeds.ts:47`) | `banners/daily` | the `/daily` quest hub |
| Season-ending DM (`park/alert-embeds.ts:68`) | `banners/collect` | the income Collect button |
| `/help topic:battles` (`help/index.ts:74`) | `sites/coastal_dig-banner` | expedition site 1 |
| `/help topic:eggs` (`help/index.ts:36`) | `eggs/rare` | the rare-rarity egg |

The battles one is the worst: it is the identical string used by
`/help topic:expeditions` (`help/index.ts:43`), so two help topics render the
same picture. A DM titled "Season ending soon" currently ships Collect-income art.

**The park map draws attractions as a flat fill and a text label.** Lots get a
plate raster, an icon and rarity chips; the landmark gets a full art band; the
six attractions get neither. `src/core/render/draw.ts:178` records why — *"No art
family ships with this task"*.

**The eight rarest species resolve to three images.** Art is keyed on
archetype×diet, and every legendary and mythic species is a carnivore:

| Art file | Stands in for |
|---|---|
| `dinos/bruiser-carnivore.webp` | tyrannosaurus, spinoraptor, **liopleurodon** (a marine reptile), **indominus** (mythic) |
| `dinos/swift-carnivore.webp` | **quetzalcoatlus** (a pterosaur), indoraptor (mythic) |
| `dinos/tank-carnivore.webp` | mosasaurus, ultimasaurus (mythic) |

A player pulling a Mythic Indominus sees the same red *Tyrannosaurus* bust as a
common-tier bruiser roll.

## Scope

**In:** 20 rasters, 4 emoji, the wiring for all of them, a full 17-module
adversarial sweep, and a fix plus regression test for every confirmed defect —
including the two the pre-flight already confirmed in guests (F1 and F2 under
**Hardening sweep**), neither of which needs a migration.

**Out, deliberately:**

- `/admin inspect` (`src/modules/admin/index.ts:18`) stays bare — an operator tool.
- The 44 non-hero species keep archetype art. Species art is an *override*, not a
  replacement; see **Architecture A**.
- No new `HELP_TOPICS` key. Adding a key changes the `/help` builder's choices and
  would force `deploy-commands`; adding art to an existing topic does not.
- No new slash command, option, or builder change of any kind.

## Asset manifest

### 6 banners — 1536×1024, `assets/images/banners/`

| File | Surfaces closed |
|---|---|
| `guests.webp` | `/guests view`, `/guests build`, `/guests claim`, `/help topic:guests` |
| `season.webp` | `/season`, the season-ending DM, `season:claim` |
| `duel.webp` | `/duel challenge`, `/duel record`, `/duel ghost` result, `/help topic:duel` |
| `dex.webp` | `/dex list` |
| `landmark.webp` | `/park landmark` |
| `battles.webp` | `/help topic:battles` |

### 3 rewires — no new assets

- `/help topic:daily` → `banners/daily`.
- `/help topic:eggs` → `banners/eggs_incubator`, dropping the `eggs/rare` borrow.
- `daily:claim` → `banners/daily`; `ach:claimall` → `banners/achievements`.

### 6 attraction art bands — 270×150, `assets/images/park/attraction-<kind>.webp`

`picnic_lawn`, `gift_shop`, `viewing_platform`, `amber_carousel`, `sky_gondola`,
`grand_atrium`. 270×150 is the existing tile size, matching
`park/landmark-a|b|c.webp`.

### 8 hero species portraits — 1024² transparent cutout, `assets/images/dinos/<speciesId>.webp`

Legendary (gold rim light): `tyrannosaurus`, `spinoraptor`, `liopleurodon`,
`mosasaurus`, `quetzalcoatlus`.
Mythic (violet rim light): `indominus`, `indoraptor`, `ultimasaurus`.

### 4 emoji — hand-authored SVG in `assets/emojis/svg/`

`dw_guest`, `dw_season`, `dw_duel`, `dw_landmark`. 53 → 57.

## Architecture

### A. Species art override

One helper in `src/core/images.ts`:

```ts
// Species art is an OPTIONAL override. A species with no committed file falls back
// to its archetype×diet art, so adding a species stays a data-only change.
export function dinoImage(speciesId: string, archetype: string, diet: string): ImageRef | null {
  return assetImage('dinos', speciesId) ?? assetImage('dinos', `${archetype}-${diet}`);
}
```

No `SpeciesDef` field, no species-file edits, no migration. `assetImage` caches
`existsSync` per path (`src/core/images.ts:8-13`), so the extra lookup costs one
Map hit after the first call.

Five call sites swap to it:

| Site | Note |
|---|---|
| `src/modules/park/embeds.ts:103` | featured dino thumbnail on the park card |
| `src/modules/duels/embeds.ts:57` | duel lead |
| `src/modules/dex/embeds.ts:92` | `/dex view` entry |
| `src/modules/hatchery/embeds.ts:53` | hatch reveal |
| `src/modules/battles/embeds.ts:70` | lead enemy — see below |

The battles site keeps its exact shape:
`portrait ?? (lead ? dinoImage(lead) : null)`. `lead` is already `null` on boss
stages (`battles/embeds.ts:69`), so the rule that a boss with a missing portrait
degrades to **no** thumbnail rather than to archetype art is untouched. That site
also keeps its deliberate raw-`assetImage` shape — `fightFrames` is the one place
in the repo where `attach()` is banned, because its refs are dressed onto several
embeds and split across two payloads by the F1/F4 contract.

### B. Attraction art family

- `ParkArt.attractions: Record<string, Image | null>` — the `lotIcons` shape
  (`src/core/render/art.ts:19`), **not** the exhaustively-keyed `landmarks` /
  `dinoChips` shape. Attraction slugs are not a closed union:
  `src/data/attractions.ts:2` types `kind` as `string`, `src/core/db/schema.ts:314`
  carries no SQL CHECK, and `src/core/render/draw.ts:181-184` promises tolerance of
  a retired slug — machine-gated at `tests/render-draw.test.ts:334-336`, which
  renders `attractions: [{ kind: 'retired_kind', level: 1 }]` and requires no throw.
  An exhaustive `Record<AttractionKind, …>` would break that promise.
- **The draw site guards `if (img)`, never `if (img !== null)`** — the guard must
  cover `undefined` as well as `null`. `tsconfig.json` sets `strict` but not
  `noUncheckedIndexedAccess`, so indexing a `Record<string, Image | null>` with a
  `string` *types* as `Image | null` while *returning* `undefined` for a miss.
  `drawImage(undefined)` throws the identical `TypeError` as `drawImage(null)`, and
  a throw is not a degrade: it fails the render request, rejects in
  `src/core/render/client.ts`, and costs the user the entire park image. Neither
  `npm run build` nor `npm test` can see this. Pattern to copy:
  `src/core/render/draw.ts:119-121`.
- The six rasters join the **existing** `Promise.all` in `loadParkArt`
  (`src/core/render/art.ts:87`) **through the existing `raster()` helper** (`:84`),
  which wraps `readFileSync` and `await img.decode()` in one `try` so a missing or
  corrupt file resolves to `null`. That is what makes every member non-rejecting,
  and it is why the never-rejects guarantee is inherited rather than re-established.
  A hand-rolled read that bypasses the helper breaks `worker.ts`'s top-level await,
  which terminates and nulls the worker — every later `/park view` then loses its
  image and respawns another doomed worker. Measured cost of the extra six: none
  (27 ms before, 27 ms after — the reads are synchronous, only `decode()` overlaps),
  and about +1.2 MB resident at tile size.
- **The `Promise.all` destructure goes from 9 members to 15, and a swapped pair is
  silent and green.** `tests/render-park-art.test.ts:114-127` documents this exact
  defect class for `groundBySeason` and records the only test shape that catches
  it: the reference image must be read off disk **by expected filename**, never
  sourced from `loadParkArt`'s own output, or the assertion is tautological against
  the very swap it exists to detect.
- `drawAttraction` (`src/core/render/draw.ts:185`) gains an `img` parameter — it
  takes no `art` argument today, so the call site at `:242-243` changes too. **When
  `img` is null it draws exactly what it draws today** — same flat `#2d4a63` rrect,
  same 3px `#7fb3d9` stroke, same label coordinates. `tests/render-draw.test.ts`
  renders with `EMPTY_ART`, so this keeps every pinned pixel sample byte-identical.
  Four further invariants when it gains art:
  - `save()` / `clip()` / `restore()` around the blit is **mandatory**
    (`draw.ts:106-107`): an opaque rectangular raster squares off the rounded
    corners, and a leaked clip corrupts the up-to-six sibling attraction cells drawn
    in the same loop.
  - `drawImage(img, x, y, TILE_W, TILE_H)` — 1:1 to the tile, no offset, as
    `drawTile` (`:109`) and `drawLandmark` (`:164`) do.
  - Keep `attractionFor(kind)?.name ?? kind`. Do **not** copy `drawLandmark`'s
    `landmarkFor(tier)!` non-null assertion (`:170-172`) — a landmark tier cannot be
    retired, an attraction slug can.
  - Moving the labels to `y + TILE_H - 16` the way `drawLandmark` does is
    pinned-pixel-safe but is a design decision, not a copy-paste.
- `renderParkPng` stays synchronous. Raster decode is asynchronous under
  `@napi-rs/canvas` and must never move into it.
- Attraction cells still append after the landmark cell, so no tile index moves.

### C. Banner wiring

`src/modules/guests/embeds.ts:16` gains `files?: AttachmentBuilder[]` on its
`Payload` type. **`src/modules/dex/embeds.ts:12` does not** — it already declares
that field, because `dexViewPayload` has attached an archetype thumbnail since the
dex shipped. What dex needs is the stale comment at `:42-46` rewritten, and that
comment sits above `dexListPayload`, not above the interface.

The guests comment is wrong in a second way worth fixing while it is being
rewritten: it claims the type "matches `dex/embeds.ts`'s `Payload` shape", which
has not been true since dex gained its thumbnail.

Every new slot goes through `attach()`. Hand-assigning `payload.files` is banned
outright by `tests/images.test.ts`.

`alertPayload` (`src/modules/park/alert-embeds.ts:68`) swaps its season arm from
`collect` to `season` and **still ships no `attachments` key**. That payload
object reaches two send sites — `deliverNotification` tries `channelSend` then
falls back to `dmSend` — and `MessagePayload.create()` pushes resolved files into
`attachments` in place while only shallow-copying it, so a pre-set key would carry
a mutation from the first attempt into the second. This is the exact inverse of
the `fightFrames` rule, where `attachments: []` is mandatory and unconditional.

**`guests:claim` needs its own explicit `attachments` decision.**
`src/modules/guests/index.ts:112` re-renders with `await i.update(guestsPayload(…))`,
and an `i.update` carrying `files` replaces the message's whole attachment set. The
module has never shipped art, so no test in `tests/guests.test.ts` asserts anything
about `files` or `attachments` on that path — there is no equivalent of the
`fightFrames` frame contract to inherit. Since both the pre-claim and post-claim
renders go through the same builder and reference the same banner, the update
re-attaches it and the set is replaced with an identical one; the decision is to
let `attach()` supply `files` on every render and never set `attachments` by hand.
This must be asserted, not assumed.

### D. Cross-kind name collision gate

`attach` appends and can never clobber, but it cannot **dedupe**, and attachment
names are basenames only — `assetImage` names the file `${name}.webp` with no
`kind` prefix. Two refs on one payload resolving to the same basename make
`attachment://<name>.webp` ambiguous and one embed slot renders the wrong picture.

Species art introduces a second naming family inside `dinos/`, so a test asserting
no two asset basenames collide across all six kinds ships with this work rather
than after a collision reaches production.

## Asset pipeline

Style consistency is the governing constraint: 26 banners and 8 cutouts already
exist in one look, and anything generated from a fresh text prompt will drift.
Every new raster is generated **image-to-image against an existing asset**.

| Family | Model | Reference | Post |
|---|---|---|---|
| 6 banners | `nano_banana_pro`, 3:2 | 2–3 existing banners of similar mood | `fit-art.mjs banner` |
| 6 attraction bands | `nano_banana_pro`, 16:9 | `park/landmark-a…c.webp` | new `fit-art.mjs band` mode |
| 8 hero portraits | `nano_banana_pro` + `remove_background` | the archetype cutout that species currently shares | `fit-art.mjs cutout` |

1536×1024 is exactly 3:2, so banners need no crop. 270×150 is 1.8:1 with no
matching aspect ratio — generate 16:9 and cover-scale. The new `band` mode is the
existing `ground` mode with different constants (`ground` cover-scales to
1200×800).

Hero portraits reference their own current stand-in, which is the strongest
available style lock: the Indominus prompt starts from the exact red bruiser bust
it replaces.

`seedream_v5_pro` is **not** used despite its built-in `remove_bg` parameter —
a different model family, and one saved call does not justify style drift across a
set that must sit beside 8 existing images.

**Margin is 31px (`fit-art.mjs cutout`), not the 24px the boss portraits used.**
Hero portraits render beside archetype art in the same embeds and must match that
set, not the boss set.

**The rarity rim light must be a hard specular edge on the silhouette, not a soft
outer glow.** Background removal cuts on alpha; a soft glow is either eaten or
leaves a halo. This is the one prompt constraint that can silently produce an
asset worse than the current stand-in, so every hero portrait is reviewed by eye
before commit.

The 4 emoji are hand-authored SVG, never generated — the park renderer needs
synchronous decode, which is why `assets/emojis/svg/` exists as a separate family
from every raster. Two known traps apply: `<ellipse fill="url(#gradient)">`
renders solid black under resvg unless `gradientUnits="userSpaceOnUse"` with
`y1`/`y2` set to the ellipse's own pre-transform bbox, and
`tests/emoji-assets.test.ts` rejects any PNG whose opaque pixels are more than 2%
pure `#000000`.

**The 270×150 rasters must be committed at 270×150, not at generator-native size.**
`drawImage(img, x, y, TILE_W, TILE_H)` passes an explicit destination size, so a
1024² source is non-uniformly squashed — aspect 1.0 stretched to 1.8 — and never
throws. `scripts/fit-art.mjs:23` covers only `banner` (1536×1024) and `ground`
(1200×800) and exits 2 on anything else, which is why this release adds a `band`
mode rather than repeating a one-off. The existing 270×150 assets were each a
separate hand pass: the three landmark bands at `docs/assets/prompts.md:1285-1291`,
and the two plates at `:1113-1121`, which crop to the object's own bounding box
**first** and only then cover-fit — the note there warns explicitly against
cover-fitting a raw generation.

Every new asset gets a row in `docs/assets/prompts.md`. Nothing enforces this
globally — only bosses, the 8 dino archetypes, two Gene Lab banners and the nine
park rasters are machine-checked — so undocumented art ships green and
unreproducible. The `band` mode gets its own row too.

Budget: 632 Higgsfield credits available, roughly 150 expected.

## Hardening sweep

**Runs first, before any asset is generated.** A finding that needs a migration or
a balance retune changes the shape of the release; discovering it after 20 assets
are committed wastes the art work.

Fanned out by defect class rather than by module, because these classes cut across
modules. Each dimension is grounded in a defect this repo has actually shipped:

1. **Stale customIds.** A durable Discord message holding a live button minted for
   a different state. This class charged 32× its own label on
   `park:landmark:buy`. Sweep every customId that omits the rung, page, tier or
   amount it acts on.
2. **Interaction lifecycle.** Reply-once, defer-before-`editReply`, ephemeral
   answers committed to public messages, and the acknowledge-before-render
   ordering both visiting surfaces depend on.
3. **Payload object sharing.** One `MessagePayload` reaching two send sites;
   presence or absence of an `attachments` key — mandatory for `fightFrames`,
   forbidden for `alertPayload`.
4. **Derived-vs-stored drift.** Escrow locks, quest progress, season points,
   attendance. Specifically: high-water marks that can move backwards, and read
   paths that write.
5. **`adminReset` / `adminFastForward` table coverage.** This repo has been bitten
   twice, on `breedings` and again on `trades`. Every table a feature reads must be
   covered by reset.
6. **Numeric edges.** `Math.max` over an empty array, seedless `reduce`, per-level
   array indexing past the end, anything that can put `NaN` into an embed.
7. **Transaction boundaries.** `track()` inside the action's own transaction;
   commit-before-present in the fight pipeline.
8. **Authorization.** Owner checks on customIds — and the inverse: `park:tour` and
   `top:visit` take a **target** id deliberately and must never gain one.

**Every finding is adversarially verified by three independent refuters, majority
kills it.** Fixing everything found makes a false positive expensive — it would
force a change to correct code — so the verify pass is stricter than the find pass.

Fixes are test-first: a failing regression test, then the fix.

**Release gate.** If a confirmed defect requires a migration or a balance retune,
it becomes its own task and is named a release gate. It does not silently expand
into the art work, and it is not downgraded to keep the release moving.

### Findings already confirmed by the pre-flight pass

A four-lens pre-flight over render plumbing, test gates, the two newest features
and the operator pipeline ran before this spec was finalised. It confirmed two
defects, both in guests, both reproduced with executable probes. Neither needs a
migration, so the release gate above is not tripped. The season track probed
clean.

**F1 — `/guests view` is a read path that writes, and can revoke `/trade`.**
`src/modules/guests/index.ts:35` calls `recomputeRating` for every subcommand
including `view`. Its comment justifies this in terms of the monotone attendance
high-water, but `src/modules/park/rating.ts:38-40` writes three columns in one
`UPDATE`, including **`parkRating`** — the live value, which falls freely as
comfort decays. `liveRating()` (`src/modules/trading/service.ts:20-22`) is a plain
`SELECT users.park_rating` checked against `TRADE_MIN_RATING` (400) at both
`createTrade` and `acceptTrade`.

Measured — 8 herbivore species, one L1 paddock, `setNow(20h)`, no other action:
stored rating **215 before `/guests view`, 137 after**. A 0.78★ drop caused by
reading a screen. At the gate boundary this kills a pending offer and leaves the
counterparty's escrowed dino locked for nothing.

`/park view` deliberately never recomputes, and `docs/gameplay.md:889` documents
that invariant explicitly.

**Fix: restrict `recomputeRating` to the `build` and `claim` arms** — the two that
genuinely mutate, and which already call it via
`src/modules/guests/service.ts:49,69`. `view` becomes a pure read. No doc change
is needed, because the documented behaviour is the correct one. `attendanceHighWater`
still advances on every build, claim, feed, assign, upgrade and decorate, so
nothing becomes unreachable.

Existing tests miss it because `tests/guests.test.ts:314` asserts only that
`attendanceHighWater` moves up and never looks at `parkRating`, and every guests
fixture runs at `nowMs = 0` with `lastFedAt: 0`, where the recompute is a no-op.

**F2 — `attendanceHighWater` banks phantom attendance from escaped dinos.**
`src/modules/park/attendance.ts:34` filters on the **stored** `escapedAt` column
with no time term, and neither `/guests build` nor `/build`/`/upgrade` calls
`settleEscapes`. `ratingHighWater` is immune to the same shape because
`baseComfortAt` is time-aware — a starving dino contributes near-zero comfort.
Attendance has no such protection, and the high-water is monotone.

Measured — 12 species, `setNow(30 days)`, three `/guests build` dispatches and
nothing else: high-water **300 → 317**, counting dinos that were all long past
`escapeAt`; a subsequent `settleEscapes()` marks all 12 escaped and live
attendance falls to 0. At endgame scale (40 species, L5 Visitor Center, full
attraction catalog) the same mechanism reaches 1920 and crosses two milestones
worth 37,000,000 cash, 65 shards and a legendary egg — claimed by a park with no
living dinos, from a state that never simultaneously existed.
`claimMilestone` (`src/modules/guests/service.ts:115`) gates on exactly this
column, and there is no path back down.

**Fix: make `attendanceOf` time-aware** — filter on live escape state rather than
the stored column, the same way `baseComfortAt` already does. `attendanceOf` must
stay **pure**: it is read for other players' parks via `/top` and visits, so this
is a filter change and never a settling call.

Existing tests miss it because `tests/attendance.test.ts:79` seeds `escapedAt`
explicitly — the already-settled case — and `:127` runs at `nowMs = 0`. No test in
`tests/guests.test.ts` advances the clock.

**F3 — latent, zero impact today, recorded so it is not rediscovered as a bug.**
PR #36 added `attractions_built` to `STATS` mid-season, so `season_progress` rows
minted between 2026-08-14 and 2026-08-17 carry no baseline for it and `pointsFrom`
would credit the whole lifetime counter. No `SEASON_SOURCE` reads that stat, so
the impact is exactly zero. It becomes real only if a future season source uses a
`StatId` added after live rows existed.

## Testing

**Existing gates that fire with no new code:**

- `tests/images.test.ts:75-81` fails on a wired banner with no committed file, and
  `:165-170` fails on a committed banner with no call site (the orphan check).
  `:341-347` requires every file under `assets/images/` to be `.webp`.
- `tests/emoji-assets.test.ts:61-97` covers the 4 new SVG/PNG pairs — 128×128,
  transparent corners, an opaque centre, and the 2% pure-black ceiling.
- `tests/render-draw.test.ts` pins exact pixel samples, rendering with `EMPTY_ART`.
  Verified: none of its pinned samples land inside an attraction cell, and its
  byte-identical pins use a fixture declaring no attractions, so `drawAttraction`
  never runs in them.

**Hard-coded lists that must be edited — none of these fail informatively, and
several are the only thing standing between a mistake and a green run:**

| Site | Edit |
|---|---|
| `tests/images.test.ts:181-188` | one `it.each` case per new banner, 1536×1024 |
| `tests/park-art-assets.test.ts:29-33` | hand-typed list; the 6 attraction bands are **not** auto-covered |
| `tests/emojis.test.ts:37-53` | the literal 53-name list becomes 57 |
| `tests/help.test.ts:37-57` | hard-coded topic list; a topic gaining `art` fails until added |
| `tests/docs-assets.test.ts:26-30` | `docs/assets/prompts.md` "26 embed banners" → 32 |
| `tests/docs-assets.test.ts:14-19` | `docs/ops.md:64` "53 custom emojis" → 57 |
| `tests/docs-assets.test.ts:32-40` | hard-coded park raster list |
| `tests/render-draw.test.ts:141-149` | the suite's only exhaustive `ParkArt` literal — a new required field is a **typecheck** break, invisible to `build` and `test` |
| `tests/render-art.test.ts:81-87` | enumerates `ParkArt` fields explicitly; a new family is silently untested unless added |

**New tests:**

1. No two asset basenames collide across all six kinds (**Architecture D**).
2. Attraction bands are 270×150 — and a **directory-enumerating** test, the inverse
   of the banner orphan check, so a raster named `gift-shop.webp` against the slug
   `gift_shop` fails instead of silently null-degrading to an imageless embed.
3. Every committed `dinos/<name>.webp` is either a real `archetype-diet` pair or a
   real species id, **and** every per-species file passes `expectTransparentCutout`
   at 1024² with the 31px margin. Today that helper is invoked only via
   `it.each(DINO_ART_KEYS)` — an 8-name type union — so per-species files inherit
   **no** dimension, transparency or margin checking at all.
4. `dinoImage` returns the species file when present and the archetype file when
   not. Mocks `assetImage`; test fixtures are never staged inside
   `assets/images/`, because vitest runs test files in parallel forks and a write
   or delete on a committed asset path can be observed by another file mid-run.
5. An attraction cell renders differently with art than without, and the
   without-art path is byte-identical to today. The difference assertion must
   compare against the real raster read off disk by expected filename, never
   against `loadParkArt`'s own output — `tests/render-park-art.test.ts:114-127`
   records why the tautological version cannot catch a swapped pair, and
   `:153-158` records that a bare "differs from the flat fill" check already let a
   removed `drawImage` through undetected.
6. **One payload test per hero species reaching a real embed.** None of the 8
   chosen species appears in any existing pinned fixture — the pinned ones are
   velociraptor, triceratops, compsognathus, othnielia and microceratus — so
   nothing existing moves, which also means the override ships entirely untested
   unless this is added deliberately.
7. One regression test per confirmed sweep defect, written failing first.

`tests/contract.test.ts` holding at 29 commands is the proof that no builder
changed, which is what makes `deploy-commands` unnecessary. If that number moves,
the claim in **Scope** is wrong.

`npm run typecheck` is the gate before commit — `build` only includes `src`, and
vitest transpiles without typechecking.

## Operator steps

`deploy-commands` is **not** required. No builder changes, proven by the contract
test count.

**Assets can never be hot-added.** `assetImage` caches `existsSync` per path for
the process lifetime, so a running bot that already resolved a path as missing will
never see the file appear. New art always requires a restart.

1. `npm run build-emojis` — renders the 4 new SVGs to committed 128² PNGs. Must
   precede step 5: `src/deploy-emojis.ts` reads only `assets/emojis/png/`, so an
   unrendered SVG does not exist to the deployer.
2. `npm run typecheck`, full suite, `npm run build`. Commit art, PNGs, banner call
   sites **and** the updated doc counts together — `tests/docs-assets.test.ts`
   fails otherwise.
3. Merge, pull on host, `npm ci && npm run build` — the bot runs compiled `dist/`.
   Assets themselves are never compiled or copied; every path resolves from cwd at
   runtime. But a new banner forces a src change anyway (the orphan check demands a
   call site), and the new `ParkArt` family certainly does.
4. Back up the DB, per standing practice. No migration ships unless the sweep
   forces one.
5. `npm run deploy-emojis` — **the one irreversible live write.**
   `assets/emojis/manifest.json` hashes the exact PNG bytes, so a rerun only
   touches what changed.
6. **Commit `manifest.json` immediately, even after a partial or failed run** — it
   is written in a `finally`. A lost manifest makes all 57 emojis look changed and
   delete-and-recreates every one, which invalidates every emoji already rendered
   in every posted message.
7. Restart the bot. Mandatory, and for three independent reasons: park rasters
   preload once at worker boot, `assetImage` caches per-path existence for the
   process lifetime, and the emoji map is fetched once at `ClientReady`. Verify on
   the `Loaded 57 application emojis` line.
8. `npm run test:live` — **last.** It parity-asserts `manifest.json` against the
   live emoji list, so running it before step 5 reports every new emoji as missing.
   Needs all six of `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_PATH`,
   `OWNER_ID`, `DEV_GUILD_ID`, `TEST_CHANNEL_ID`. REST-only, no `client.login`, so
   it is safe while the bot is live — but it re-PUTs the dev guild's command set
   with all modules forced on, so it is that guild's last command writer.
   **This is the acceptance check for an art release:** ~59 cases post their real
   embeds, components and attachments, and it is the only surface that puts human
   eyes on new art.

## Risks

- **"Fix everything found" can hold the release hostage.** Mitigated by running the
  sweep first and by the release gate in **Hardening sweep**, which makes an expansion visible rather
  than silent.
- **The rim light can degrade a hero portrait below its current stand-in.** A
  halo or a clipped glow is worse than the shared archetype art. Mitigated by the
  hard-specular-edge constraint and by eyeballing all 8 before commit.
- **Six new photographic cells on the park map may fight the lot plates for
  attention.** The map already carries one art band; this takes it to seven. Judged
  at `test:live` against a real park, and reversible — deleting the rasters restores
  today's flat fill with no code change, because the null-art path is preserved
  exactly.

## Decision log

| Decision | Choice | Reason |
|---|---|---|
| Release shape | Art-led polish pass | Highest visible payoff, no migration, no balance retune |
| Species art depth | 8 hero species only, as an override | Preserves "adding a species is data-only"; fixes the collision where it is worst |
| Attraction cell | Full art band, matching the landmark | Attractions are the guest-facing spectacle; the landmark proves the pattern degrades safely |
| Hero treatment | Same pipeline + baked rarity rim light | One visual set; a mythic reads as mythic at 80px thumbnail size |
| Banner scope | All 14 gaps — 6 new banners + 3 rewires | Banners cover several surfaces each, so full coverage costs 6 assets |
| Emoji scope | 4 utility icons | Attractions need no icon once they have art bands |
| Sweep depth | All 17 modules | Chosen over auditing only the two newest features |
| Sweep triage | Fix everything confirmed | With a named release gate for migration- or balance-class findings |
| Generation model | `nano_banana_pro`, image-to-image | Matches the existing corpus; style lock beats one saved call |
| F1 fix | Restrict `recomputeRating` to `build`/`claim` | Makes `view` a pure read, matching `/park view` and the behaviour `docs/gameplay.md:889` already documents; needs no doc change |
| F2 fix | Make `attendanceOf` time-aware | Mirrors why `baseComfortAt` made `ratingHighWater` immune; keeps `attendanceOf` pure, which it must be — it is read for other players' parks |
| Attraction raster home | `assets/images/park/` | Sits with the other tile rasters and needs no widening of `assetImage`'s kind union; its gate is hand-typed, so the files must be added to it explicitly |
