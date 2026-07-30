# Art assets, round 3 — design

Date: 2026-07-30

## Goal

Three follow-ups left over from round 2, in one round because they touch the same
call sites and would otherwise conflict:

1. Give dinosaurs a face, without the art cost growing every time a species is added.
2. Stop shipping 62 MB of unoptimised art through Discord embeds.
3. Collapse the attach-and-degrade idiom that caused three separate attachment
   defects in round 2.

## Scope

In scope: 8 archetype×diet dino images, WebP conversion of `assets/images/`, and an
`attach` helper replacing the duplicated idiom.

Out of scope, deliberately:

- **Per-species art (30 portraits).** Rejected: the art cost would grow with every
  new species, forever. Archetype×diet is a fixed cost of 8 images, and adding a
  species stays a data-only change.
- **Park tile chips.** They render at 28px and must decode synchronously, so they are
  hand-authored SVG; generated raster cannot go there. The six rarity chips already
  work.
- **`/dino list` thumbnail.** The list shows many dinos, so any single thumbnail is
  arbitrary. It would need a featured-dino rule, which is not worth inventing here.
- **`assets/emojis/`.** Neither the PNGs nor the SVGs convert. See "What stays PNG".

## 1. Dino archetype art

### Why archetype, not species

`Species` already carries `archetype: 'bruiser' | 'tank' | 'swift' | 'support'` and
`diet: 'herbivore' | 'carnivore'`. Every species must declare both. Keying art on the
pair means **8 images, permanently** — a new species picks up existing art by
declaring fields it already has to declare, so adding one costs no art and stays a
data-only change. This mirrors the repo's existing goal for battle chapters, which
ship as data-only PRs.

Seven of the eight combinations are in use today across the 30 species:

| | herbivore | carnivore |
|---|---|---|
| **bruiser** | 2 | 6 |
| **tank** | 5 | 1 |
| **swift** | 3 | 7 |
| **support** | 6 | 0 |

`support-carnivore` has no species today and is generated anyway. Skipping it would
break the guarantee the moment someone adds one.

### Assets

`assets/images/dinos/<archetype>-<diet>.webp` × 8, 1024×1024, transparent.

Generated as image-edits off the same coastal reference the boss portraits used, so
the set coheres with existing art. Post-processed by `scripts/fit-art.mjs` (cutout
mode), same as the portraits.

**Style: deliberately simpler than the boss portraits.** Same house glossy-cartoon
treatment and head-and-shoulders three-quarter framing, but flatter — clean archetype
silhouettes with no scarring, no individuating damage, no character detail. These sit
in the same thumbnail slot as the four boss portraits and sometimes in the same
command; a boss must read as a named individual while these read as a *kind*. The
hard no-glow rule applies verbatim, as it does to every transparent asset in this
repo.

### `spriteRef` is deleted

`spriteRef: string` is removed from the `Species` interface in `src/data/types.ts`
and from all 30 species files. It has never been read by anything but its own type
declaration. Leaving a dead art field beside a live archetype-keyed one invites
exactly the confusion this design exists to prevent. The compiler enforces the
removal: `npm run typecheck` fails on any surviving reference.

### Surfaces

**Hatch reveal** (`revealPayload`, `src/modules/hatchery/embeds.ts`). Fills the empty
`setThumbnail` with the species' archetype image. The rarity crack art stays as
`setImage`, so the beat reads "your egg burst open, and here is what came out."

This payload already ships `files` plus an `attachments: []` allowlist that drops the
pre-hatch egg upload when delivered via `i.update`. It now carries two files, both
referenced by the embed, each degrading independently: with either asset missing the
other must still attach and the embed must still send.

**Non-boss battle stages** (`fightFrames`, `src/modules/battles/embeds.ts`). Boss
stages put the boss portrait in the thumbnail; non-boss stages leave it empty and list
enemies as plain text. Non-boss stages now take the archetype image of the **first
entry `rosterFor` returns**.

`rosterFor(stage, squadSize)` is already the single source of truth for which enemies
are fielded and in what order, shared by `runFight` and `fightFrames` — so no new
ordering rule is invented, and the frame cannot disagree with the fight. Boss stages
are untouched. The F1/F4 attachment contract established in round 2 governs the
change: files attach on frame 1 and frame 4, and each attaching frame uploads exactly
what it references.

## 2. WebP conversion

### Measurements

Taken on the committed assets with `@napi-rs/canvas`:

| Asset | PNG | WebP q100 | q95 | q90 |
|---|---|---|---|---|
| `banners/trading.png` | 2.564 MB | 1.947 MB | 0.398 MB | 0.285 MB |
| `battles/boss-volcano_core-portrait.png` | 1.007 MB | 0.886 MB | 0.175 MB | 0.129 MB |
| `eggs/mythic.png` | 0.820 MB | 0.695 MB | 0.105 MB | 0.068 MB |

q100 is not worth taking — roughly 24% for near-lossless. **q95 is the chosen
setting**: an 83–87% reduction, and on a 2× crop of the Tyrant King's jaw (hard black
outlines over a lava gradient, the worst case for ringing) it is visually
indistinguishable from the original. At the 80px thumbnail size Discord actually
renders, the question is moot.

Expected outcome: **62 MB → ~9 MB** on disk, and the worst-case embed payload
(`/expedition claim`, banner + thumb, currently 4.65 MB for `amber_ridge`) drops to
roughly 0.6 MB.

### What converts

Everything under `assets/images/`: 13 banners, 8 site images, 6 eggs, 6 hatch cracks,
4 boss portraits, 3 park rasters, plus the 8 new dino images.

Alpha survives the round trip — verified by re-decoding a converted transparent asset
and confirming corner alpha is still 0.

### What stays PNG, and why

`assets/emojis/png/` is untouched. Discord's application-emoji upload expects PNG, and
the manifest hashes committed in PR #5 are SHA-256 of those exact PNG bytes.
Converting them would invalidate the manifest and force a redeploy of all 33 emojis
for no benefit. `assets/emojis/svg/` is likewise untouched — the park renderer reads
lot icons and dino chips from there as SVG precisely because SVG decodes
synchronously.

### Code changes

- `assetImage` builds `${name}.webp` instead of `${name}.png`, and its `kind` union
  gains `'dinos'`. `attachment://` URLs derive from the same filename, so every embed
  reference follows automatically.
- `src/core/render/art.ts` loads the three park rasters by name; extensions change.
  Verified safe: `@napi-rs/canvas` decodes WebP and draws real pixel content, not the
  silent blank canvas that PNG's async decode produces when mishandled.
- `scripts/fit-art.mjs` emits WebP, so regeneration produces the shipped format
  directly.
- `docs/assets/prompts.md` file-target tables list `.png` paths throughout; updated,
  since that file is the regeneration source of truth.

No PNG originals are kept in the tree. Git history holds them, and `prompts.md` plus
`fit-art.mjs` reproduce any asset from its prompt. Keeping both formats would create a
second thing to drift.

## 3. The `attach` helper

In `src/core/images.ts`, beside `assetImage`:

```ts
export function attach(
  embed: EmbedBuilder,
  payload: { files?: AttachmentBuilder[] },
  slot: 'image' | 'thumbnail',
  ref: ImageRef | null,
): void
```

A null `ref` is a no-op. Otherwise it sets the slot **and** appends the file, in one
statement.

Of the 30 `assetImage` call sites outside `images.ts`, **27 convert**: 23 assign a
fresh `files` array and 4 append to an existing one. Append semantics cover both,
because appending to an absent array is the same as assigning. The 4 appends are
`battles/embeds.ts:163`, `expeditions/index.ts:83`, `hatchery/embeds.ts:80` and
`shop/index.ts:57`. The remaining 3 are all in `fightFrames` — see the exceptions
below.

The point is not brevity. Round 2 produced three separate bare-attachment or
cleared-attachment defects, each one a call site where "set the slot" and "attach the
file" had drifted apart. Behind this helper they **cannot** drift, because a caller
cannot do one without the other. The invariant becomes structural rather than a
convention repeated 30 times.

**Three deliberate exceptions, all in `fightFrames`** (`src/modules/battles/embeds.ts`
lines 46-48 — the chapter banner, the boss portrait, and the outcome banner). Those
three resolve up front and are then distributed across frames by the F1/F4 upload
contract, with an `attachments: []` allowlist the helper has no business encoding.
Three honest exceptions beat bending the helper to cover them — and the fact that the
call-site classification isolates exactly these three is evidence the helper's shape
is right for the other 27.

## Testing

Existing coverage carries most of the risk: 623 tests already assert `attachment://`
URLs and `files[].name` at nearly every call site, so a bad refactor fails loudly.

New coverage:

- `attach` directly — null is a no-op, image versus thumbnail, append-to-existing.
- Both new dino surfaces, including independent degrade when only one of the two
  assets on a payload is present.
- A guard that every file under `assets/images/**` is `.webp` and that every
  `assetImage` consumer resolves, so a half-finished conversion cannot ship green.
- `spriteRef` removal needs no test — the compiler enforces it.

Gates per wave: `npm run typecheck`, `npm test`, `npm run build`, and — for waves 2
and 3 — `npm run test:live`.

## Risks

1. **Discord's WebP rendering is the one thing the suite cannot prove.** Every offline
   test passes regardless of what Discord does with the format. `npm run test:live` is
   a required gate on wave 2, not an optional one.
2. **The WebP switch is wide and shallow** — ~48 assets and every art call site at
   once. Mitigated by `assetImage` centralising the extension, so it is one edit plus
   a rename, and by landing the dedupe first so there is one helper to change rather
   than 30 sites.
3. **"Simpler than bosses" could overshoot** and make the archetype art look
   unfinished. The 8 images get reviewed before they are wired to any surface.
4. **Two files on the hatch reveal** repeats the shape that caused round 2's
   attachment defects. Covered by independent-degrade tests and by the `attach`
   helper landing first.

## Sequencing

Three waves, each independently shippable and green:

1. **Dedupe** — pure refactor, no assets, no behaviour change. Lands first so wave 2
   edits one helper instead of 30 call sites.
2. **WebP** — convert assets, flip `assetImage`, update `fit-art.mjs` and
   `docs/assets/prompts.md`. Gated on `test:live`.
3. **Dino art** — generate 8, delete `spriteRef`, wire the hatch reveal and non-boss
   battle stages. Gated on `test:live`.

## Operator steps

- `npm run test:live` after waves 2 and 3. This is the only verification of WebP
  rendering and of the new thumbnail slots.
- `npm run deploy-emojis` is **not** needed — no emoji changes.
- `npm run deploy-commands` is **not** needed — no command builder changes.
