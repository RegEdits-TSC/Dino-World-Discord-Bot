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
adversarial sweep, and a fix plus regression test for every confirmed defect.

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

- `ParkArt.attractions: Record<string, Image | null>`, keyed exhaustively from
  `Object.keys(ATTRACTIONS)` and null-initialised in `EMPTY_ART` — the same
  discipline `landmarks` and `dinoChips` already follow. The draw site reads
  `art.attractions[kind] ?? null`, so an unknown kind can never reach
  `drawImage(undefined)`, which throws exactly as `drawImage(null)` does and costs
  the whole park image.
- The six rasters join the **existing** `Promise.all` in `loadParkArt`
  (`src/core/render/art.ts:87`). No second await, so the never-rejects guarantee
  `worker.ts`'s top-level await depends on is inherited rather than re-established.
- `drawAttraction` (`src/core/render/draw.ts:185`) gains an `img` parameter. **When
  `img` is null it draws exactly what it draws today** — same flat fill, same
  label, same coordinates. `tests/render-draw.test.ts` renders with `EMPTY_ART`, so
  this keeps every pinned pixel sample byte-identical. The art path mirrors
  `drawLandmark` (`:160`).
- `renderParkPng` stays synchronous. Raster decode is asynchronous under
  `@napi-rs/canvas` and must never move into it.
- Attraction cells still append after the landmark cell, so no tile index moves.

### C. Banner wiring

`guests/embeds.ts` and `dex/embeds.ts` `Payload` types gain
`files?: AttachmentBuilder[]`. Both carry a comment asserting they never will;
those comments are rewritten, not deleted.

Every new slot goes through `attach()`. Hand-assigning `payload.files` is banned
outright by `tests/images.test.ts`.

`alertPayload` (`src/modules/park/alert-embeds.ts:68`) swaps its season arm from
`collect` to `season` and **still ships no `attachments` key**. That payload
object reaches two send sites — `deliverNotification` tries `channelSend` then
falls back to `dmSend` — and `MessagePayload.create()` pushes resolved files into
`attachments` in place while only shallow-copying it, so a pre-set key would carry
a mutation from the first attempt into the second. This is the exact inverse of
the `fightFrames` rule, where `attachments: []` is mandatory and unconditional.

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

Every new asset gets a row in `docs/assets/prompts.md`.

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

## Testing

**Existing gates that fire with no new code:**

- `tests/images.test.ts` scrapes every `assetImage('banners', …)` call and demands
  a committed file, so a banner cannot be wired without shipping the asset. It also
  asserts every file under `assets/images/` is WebP, banners are 1536×1024, and
  cutouts are 1024².
- `tests/emoji-assets.test.ts` covers the 4 new SVG/PNG pairs — dimensions,
  transparency, the pure-black ceiling.
- `tests/render-draw.test.ts` pins exact pixel samples, rendering with `EMPTY_ART`.

**New tests:**

1. No two asset basenames collide across all six kinds (**Architecture D**).
2. Attraction bands are 270×150.
3. Every committed `dinos/<name>.webp` is either a real `archetype-diet` pair or a
   real species id — guards the silent failure where a typo'd filename never loads
   and the fallback masks it permanently.
4. `dinoImage` returns the species file when present and the archetype file when
   not. Mocks `assetImage`; test fixtures are never staged inside
   `assets/images/`, because vitest runs test files in parallel forks and a write
   or delete on a committed asset path can be observed by another file mid-run.
5. An attraction cell renders differently with art than without, and the
   without-art path is byte-identical to today.
6. One regression test per confirmed sweep defect, written failing first.

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

1. `npm run build-emojis` — renders the 4 new SVGs to committed 128² PNGs. Local,
   reversible.
2. `npm run typecheck`, full suite, `npm run build`.
3. Merge, pull on host, `npm run build` — the bot runs compiled `dist/`.
4. `npm run deploy-emojis` — **the one irreversible live write.**
   `assets/emojis/manifest.json` hashes the exact PNG bytes, so a rerun only
   touches what changed.
5. Restart the bot — after step 4, so the emoji map loaded at client ready contains
   the new ids. Verify on the `Loaded 57 application emojis` line. The restart is
   also what clears the asset-existence cache.
6. `npm run test:live` — posts the full payload gallery to `TEST_CHANNEL_ID`.
   REST-only, no second gateway session, safe while the bot is live. **This is the
   acceptance check for an art release:** every new banner, band and portrait is
   seen, not merely asserted to exist.

DB backup before deploying, per standing practice. No migration ships unless the
sweep forces one.

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
