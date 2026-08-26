# Image generation prompts — egg, expedition site, banner, boss, archetype, hero portrait, park, hatch crack, and branding art

The volcano/frozen banners and volcano thumb were generated with ChatGPT image
generation; the remaining coastal/amber banners and the coastal/amber/frozen
thumbs were generated with Higgsfield Nano Banana Pro. The three sites that
shipped later — Abyssal Trench, Containment Site, and Founder's Park — were
also generated with Higgsfield, each with its own model and pipeline (see each
site's own section below). The six egg rarities were generated with Higgsfield
Nano Banana Pro as a reference chain (see the Egg rarities section). The 33
embed banners were generated with Higgsfield Nano Banana Pro, `care_neglect`
as a reference chain off `care`, `battle_defeat` off `battle_victory`, and
`guests`, `dex`, `landmark`, and `season` each generated as a reference chain
off two existing banners (see Embed banners for each pairing). The six hatch
cracks were generated as reference-chain edits of their own egg icons. These
prompts are the source of truth for regenerating or extending the set — keep
them in sync with any new assets.

Note on thumbs: some models render a "square cartoon game icon of …" prompt as
a rounded-rectangle app-icon tile with a border. The remedy this file used to
recommend — phrasing the thumb as a "close-up cartoon scene filling the entire
square frame edge to edge … NOT an app icon — no rounded-rectangle tile, no
border, no rounded corners" — **was measured failing** on the
`continental_divide` thumb: that prompt carried the full negative clause
verbatim and still came back as a rounded-rectangle tile on a white ground.

Naming the thing appears to summon it. What works is to **never write "icon",
"tile", "app" or "game icon" anywhere in the prompt**, and to describe the
framing positively instead — as a crop of something bigger:

> The painting is a continuous scene that bleeds off all four edges of the
> square, like a cropped detail of a much larger canvas: the artwork must run
> right into every corner and every edge of the image with the subject cut off
> by the frame, filling the picture completely. Every corner of the square is
> painted scene. The background is solid painted sky and rock all the way to
> the boundary, never white, never blank, never a plain flat margin, and the
> composition has no surrounding frame, no border, no outline, no rounded
> corners, no drop shadow and no background panel of any kind.

That produced a correct full-bleed square on the first attempt. Note it still
carries "no border / no rounded corners" negatives — what changed is dropping
the words that name the unwanted artefact as a *kind of object*.

**Six thumb prompts below still break this rule, and they are recorded as run
rather than rewritten.** Four legacy ones — Coastal Dig, Amber Ridge, Frozen
Cliffs, Volcano Core — open with "A square cartoon game icon of …", the exact
pattern named above as the cause. Two more — Mainland Ferry and Ruined City —
carry the retired "NOT an app icon" clause and nevertheless came back correct.
Every one of the six is flagged where it sits. The rule stands; those six are a
record of what actually produced the committed file, not a counter-example to it,
and the honest reading is that the phrasing is a strong tilt rather than a
switch. Convert any of them before rerunning it.

## Shared style block

Every prompt below ends with this block so the set matches the existing egg
icons in `assets/images/eggs/` (glossy cartoon game style):

> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no characters, no UI elements.

## File targets

| File | Size | Use |
|---|---|---|
| `assets/images/sites/<id>-banner.webp` | 1536×1024 | `/expedition claim` full-width embed image |
| `assets/images/sites/<id>-thumb.webp` | 1024×1024* | `/expedition start` + `status` embed thumbnail |
| `assets/images/park/ground.webp` | 1200×800 (3:2) | `/park view` canvas backdrop, cover-scaled |
| `assets/images/park/ground-wet.webp` | 1200×800 (3:2) | `/park view` canvas backdrop for the wet season, selected by `ParkSnapshot.season` |
| `assets/images/park/ground-dry.webp` | 1200×800 (3:2) | `/park view` canvas backdrop for the dry season, selected by `ParkSnapshot.season` |
| `assets/images/park/ground-cold.webp` | 1200×800 (3:2) | `/park view` canvas backdrop for the cold season, selected by `ParkSnapshot.season` |
| `assets/images/park/plate-paddock.webp` | 270×150 | `/park view` paddock tile plate |
| `assets/images/park/plate-facility.webp` | 270×150 | `/park view` facility tile plate |
| `assets/images/park/landmark-a.webp` | 270×150 | `/park view` landmark cell art, prestige tiers 1–2 (Stone Marker, Fossil Plinth) |
| `assets/images/park/landmark-b.webp` | 270×150 | `/park view` landmark cell art, prestige tiers 3–4 (Bronze Sentinel, Amber Obelisk) |
| `assets/images/park/landmark-c.webp` | 270×150 | `/park view` landmark cell art, prestige tiers 5–6 (Grand Rotunda, Titan Monument) |
| `assets/images/park/landmark-d.webp` | 270×150 | banked landmark cell art, above Titan Monument — `drawLandmark` does not read this file yet; wiring a seventh+ tier to it is a later spec |
| `assets/images/park/landmark-e.webp` | 270×150 | banked landmark cell art, above Titan Monument — not yet wired, see `landmark-d` |
| `assets/images/park/landmark-f.webp` | 270×150 | banked landmark cell art, above Titan Monument — not yet wired, see `landmark-d` |
| `assets/images/park/attraction-picnic_lawn.webp` | 270×150 | `/park view` attraction cell art, `picnic_lawn` |
| `assets/images/park/attraction-gift_shop.webp` | 270×150 | `/park view` attraction cell art, `gift_shop` |
| `assets/images/park/attraction-viewing_platform.webp` | 270×150 | `/park view` attraction cell art, `viewing_platform` |
| `assets/images/park/attraction-amber_carousel.webp` | 270×150 | `/park view` attraction cell art, `amber_carousel` |
| `assets/images/park/attraction-sky_gondola.webp` | 270×150 | `/park view` attraction cell art, `sky_gondola` |
| `assets/images/park/attraction-grand_atrium.webp` | 270×150 | `/park view` attraction cell art, `grand_atrium` |

\* Except the shipped `assets/images/sites/volcano_core-thumb.webp`, which is
**1254×1254** — a discrepancy from the original PNG's IHDR that predates the
WebP conversion, not something that conversion introduced. Not resized as
part of that pass; a future regeneration should target 1024×1024 to match the
other six site thumbs (verified on disk: `coastal_dig`, `amber_ridge`,
`frozen_cliffs`, `abyssal_trench`, `containment_site`, and `founders_park`
all ship at 1024×1024 — `volcano_core` is the sole outlier).

**Output format.** Every committed file under `assets/images/` is **WebP, quality 95**,
encoded through `@napi-rs/canvas`'s `canvas.toBuffer('image/webp', 95)`, and
indistinguishable from PNG at the sizes Discord renders. The conversion pass that
introduced it took the 40 files committed at the time from **63.4 MB of PNG to 8.9 MB
of WebP** — about 86% smaller in aggregate.
`scripts/fit-art.mjs` emits it directly, so every mode writes the shipped format and no
separate conversion step is needed. Intermediates are exempt: a generator's output and
the `remove_background` result in the walkthroughs below are whatever the tool produced
(usually PNG), and only the final write is WebP. `assets/emojis/png/` is **not** WebP —
Discord's application-emoji upload expects PNG and `manifest.json` hashes those exact
bytes — and `assets/emojis/svg/` stays SVG because the park renderer decodes it
synchronously.

**Post-processing modes (`scripts/fit-art.mjs`).** Every mode writes WebP q95 and
takes whatever the generator emitted (usually PNG) as its source.

| Mode | Output | Fit | Used by |
|---|---|---|---|
| `node scripts/fit-art.mjs banner <src> <dest>` | 1536×1024 (3:2) | cover-scale, center-crop | `assets/images/sites/<id>-banner.webp`, `assets/images/banners/` |
| `node scripts/fit-art.mjs ground <src> <dest>` | 1200×800 (3:2) | cover-scale, center-crop | `assets/images/park/ground{,-wet,-dry,-cold}.webp` |
| `node scripts/fit-art.mjs band <src> <dest>` | 270×150 (1.8:1) | cover-scale, center-crop | `assets/images/park/attraction-<kind>.webp`, `assets/images/park/landmark-{a,b,c,d,e,f}.webp` — anything the park renderer draws 1:1 at `TILE_W`×`TILE_H` |
| `node scripts/fit-art.mjs square <src> <dest>` | 1024×1024 | cover-scale, center-crop | `assets/images/sites/<id>-thumb.webp` |
| `node scripts/fit-art.mjs cutout <src> <dest>` | 1024×1024 transparent | defringe, then whole-bbox fit at a 31px margin | `assets/images/hatch/`, `assets/images/dinos/` |
| `node scripts/fit-art.mjs portrait <src> <dest>` | 1024×1024 transparent | largest region only, border flood, 2px shave, whole-bbox fit at a 24px margin (`--axis=egg` re-centres on the egg's own axis instead) | `assets/images/eggs/` (with `--axis=egg`), `assets/images/battles/` |

`cutout` and `portrait` are not interchangeable — see the divergence table and
the consequences list in the Egg rarities section for the numbers and what
goes wrong if either is run on the other's family.

`square` shares their output size and nothing else: it is a COVER mode, opaque,
with no background removal, no defringe and no margin — the `banner` arithmetic
at 1:1. It is the producer for a site thumb generated as its own square
composition, and it reproduces the centred-square-crop hand pass the older site
thumbs were made with. Do not reach for `cutout` because both write 1024×1024.

`band` exists because 270×150 is 1.8:1 and no generator offers that aspect ratio:
generate at 16:9 and let the mode crop. It is the `ground` mode's arithmetic with
different constants, nothing more. It is **not** a complete recipe for the two
tile plates — those need a bounding-box crop first, described under Park map —
and it is **not** interchangeable with `cutout`, which fits a transparent
subject rather than cover-cropping an opaque frame.

**Decode trap: Content Credentials (C2PA) in a source PNG.** *Symptom:*
`scripts/fit-art.mjs` — or any other pass that hands a freshly generated PNG to
`@napi-rs/canvas` — throws

```
Error: Invalid SVG image
  { code: 'InvalidArg' }
```

on a file that opens fine in every viewer and whose chunk CRCs all validate. The
file is neither corrupt nor an SVG. *Cause:* it carries a `caBX` chunk — an
ancillary, private, safe-to-copy PNG chunk holding an embedded C2PA
content-credentials (JUMBF) manifest, which several current generators and
editors attach by default — and that manifest's payload contains the literal
text `<svg`. `@napi-rs/canvas`'s format sniffer scans the buffer for that
substring instead of trusting only the leading magic bytes, concludes the whole
file is SVG, and fails parsing it as one. Hence the misleading error, which
names a format the file has nothing to do with.

*Remedy:* `scripts/fit-art.mjs` now strips the chunk before decoding — see
`stripCaBX` in `scripts/lib/art-pipeline.mjs`, called before every `img.decode()`
in that script. No hand-patching is needed. `tests/art-pipeline.test.ts` covers
it directly: it removes only the `caBX` chunk(s) and leaves every other chunk
byte-identical, is a no-op on a PNG that carries none, and returns a non-PNG
buffer (WebP, JPEG) untouched rather than mangling it. The chunk is pure
provenance metadata, is read nowhere in this codebase, and would not survive
re-encoding to WebP in any case, so removing it is pixel-for-pixel
content-neutral.

Three of the 40 files in the WebP conversion pass were affected
(`sites/frozen_cliffs-banner`, `sites/volcano_core-banner`,
`sites/volcano_core-thumb`). The strip was checked, not assumed: their chunk
streams were byte-identical to the originals once `caBX` was removed, their
alpha channels matched exactly, and their WebP encoding error landed in the same
band as files that never needed stripping (mean absolute error 1.45–2.21 against
1.15–1.43 for the untouched controls — the q95 encode, not the strip). Any
newly generated PNG can carry the chunk, so
expect this again — searching a source file's bytes for the four-character
chunk type `caBX` identifies it before the decode does.

Banner = wide establishing shot of the site. Thumb = square icon-style
composition with one central landmark and a simple background (readable at
80px — do not just crop the banner).

Site ids: `coastal_dig`, `amber_ridge`, `frozen_cliffs`, `volcano_core`,
`abyssal_trench`, `containment_site`, `founders_park` — the last three shipped
later and have their own sections below with their own generation notes.
Three more — `mainland_ferry`, `ruined_city`, `continental_divide` — are
banked ahead of their chapter data; see "Chapters 8–10 (banked, unshipped)"
below.

## Art variants (`-vN`)

A surface with more than one committed face carries `<base>-v2.webp`,
`<base>-v3.webp`, … beside an untouched `<base>.webp`. **How many faces a base
carries varies by family and by base**, and most bases carry none at all: the
per-family sections below state what each set ships, and
`ls assets/images/<kind> | grep -- '-v'` answers it for any one family. Never
assume a uniform count — nothing in the codebase hardcodes one, and the resolver
derives it (see below). The base file is never renamed, moved or regenerated.

**One committed base has been edited in place, deliberately, and it is the only
one.** `assets/images/hatch/common-crack.webp` shipped with un-removed studio
backdrop smeared across its crack opening (see "Backdrop in the crack gaps"),
which is a defect in the file rather than a different take on it. It was repaired
by `scripts/clear-backdrop.mjs` — same filename, same subject, same composition,
no regeneration and no generator credit spent. That is the bar for touching a
base at all: a measured defect in a shipped file, repaired by a tracked pass,
recorded here. Wanting a better picture is not that bar; that is what a variant
is for.

The `v` is load-bearing: no committed filename and no species id contains a digit
or a `-v` suffix, so `-vN` can never be read as part of a base name. A bare `-2`
would carry no such guarantee for a future id.

**Every variant is generated as an image-edit of its own base**, with the base
attached as the media reference — never from another variant, and never from a
bare prompt. This is the same reference-chain discipline the egg rarities and the
dino archetypes use, and for the same reason: a variant that drifts off its base
reads as a different asset rather than another view of the same one.

**The resolver is live.** `assetImage(kind, name, seed?)` (`src/core/images.ts`)
takes an optional `seed` — any string already in scope at the call site, an egg's
row id or a viewer's Discord id — and resolves it to one of the base's committed
faces; omitting it returns the base file, unchanged, forever. Nothing here
hardcodes how many faces a base has: `variantCount` scans `-v2`, `-v3`, … and
stops at the first gap, so shipping a face costs no code edit. It is not inert,
though, and this is the part to plan for: a seed's draw is fixed and only
`floor(draw * (count + 1))` moves, so adding a face re-partitions that draw and
**half of the base's seeds land on a different face** — exactly half, provably, at
every count. The step that gives a variant-free base its FIRST face is the same
rule, not a gentler one; it differs only in having no other variant to move
between, so its moving half simply leaves the base file, which is the whole point
of shipping it. Two real seeds that did move: `banners/dino_roster` seed `u1` goes
`-v3` to `-v4` when a fourth variant lands, and `sites/coastal_dig-banner` seed
`u2` goes `-v2` to `-v3` when a third does. Which half moves is not knowable by
eye, so **every committed `-vN` pin in `tests/` for that base has to be re-derived
from the real `assetImage` in the same change that ships the file** — half of them
staying put is not something you can find out without checking all of them. See the
art-variants bullet in `CLAUDE.md` for which surfaces are seeded on what, and why.

Two guards cover the committed files, and the resolver now **depends** on both
rather than merely agreeing with them: `tests/asset-variants.test.ts` proves every
variant has a committed base and that numbering starts at 2 with no gaps — a gap
would make a face unreachable, since the scan stops there, and an orphan would
make a resolved name miss and the embed silently ship without its image — and the
disk-registered dimension checks in `tests/images.test.ts` hold every variant to
its family's size and transparency contract.

**A variant takes its base's own `fit-art.mjs` mode, never a different one.**
The two cutout modes are not interchangeable (see the divergence table in Egg
rarities), so the wrong mode on a variant ships a margin that silently
disagrees with its own base's siblings:

| Family | Mode |
|---|---|
| `assets/images/banners/<name>-vN.webp` | `banner` |
| `assets/images/sites/<id>-banner-vN.webp` | `banner` |
| `assets/images/eggs/<rarity>-vN.webp` | `portrait --axis=egg` |
| `assets/images/hatch/<rarity>-crack-vN.webp` | `cutout` |
| `assets/images/dinos/<key>-vN.webp` | `cutout` |
| `assets/images/battles/boss-<id>-portrait-vN.webp` | `portrait` (no flag) |

---

## Egg rarities

The six egg icons in `assets/images/eggs/` share one silhouette — an upright egg
sitting in a low woven twig-and-leaf nest — so they read as a set; rarity is
expressed only through shell design and subtle per-rarity nest dressing. Shell
colors track the embed accent colors in `src/modules/hatchery/embeds.ts` (mythic
is the exception: obsidian-and-lava to match the `volcano_core` site art).

| File | Size | Use |
|---|---|---|
| `assets/images/eggs/<rarity>.webp` | 1024×1024, transparent | hatch-reveal hero + shop/hatchery embed thumbnail |

`<rarity>` is one of `common`, `uncommon`, `rare`, `epic`, `legendary`,
`mythic`.

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the egg/nest silhouette — off-silhouette glow survives background
removal as floating islands or a light halo on transparency. Emissive detail is
allowed only ON surfaces (crystal facets, engraved runes, lava cracks). Every
prompt carries this rule verbatim.

**Workflow (reference chain):** generate the common egg-in-nest first on a plain
flat light-gray studio background, framed so the egg and nest fill almost the
whole square with a small even margin. Then generate the other five as
image-edits of the approved common (Nano Banana Pro, `medias` role `image`) so
the egg silhouette and nest base stay identical — all five edit from the common
directly, never from each other.

**Post-processing** (each of the six): `remove_background`, then a defringe +
fit pass onto a 1024×1024 transparent canvas. The studio background is light
gray — nearly the tone of the white/gold shells — so the cutout keeps a light
rim the egg's dark outline should have been. The pass: (1) keep only the largest
connected region; (2) luminance-peel light boundary pixels inward until the edge
reaches each egg's dark cartoon outline; (3) flood inward from the border through
transparent + desaturated-light pixels to strip any near-white matte residue
clinging to the outer nest edge (saturated art blocks the flood; interior
highlights are walled off by the dark outlines); (4) shave 2px; (5) fit and
center on the **egg's own axis** (top ~45% of the silhouette), not the whole
bbox, so asymmetric nest dressing doesn't push the egg off-center. Verify: all
border pixels transparent, exactly one connected region.

**This 5-step pass is now `scripts/fit-art.mjs portrait`** (add `--axis=egg` for
step (5)'s egg-axis variant; omit it for the whole-bbox battles variant).

**Order note — settled, no longer an open question.** The implementation does not
run steps (1)-(5) in the order just described: `fit-art.mjs` runs the alpha
threshold and luminance peel (steps (2)-(3), shared with `cutout`) *before* the
largest-region step (1), then border-floods and shaves — largest-region last, not
first. The hazard that ordering carries is real in principle: a peel that severs
a thin bridge before the largest-region step runs would delete real subject
matter as a spurious second region, where the documented order would have peeled
a stray island that never reached the largest-region step at all. On a synthetic
subject built to trigger it — two saturated parts joined by a 4px pale
desaturated bridge — the two orderings genuinely diverge, and the CLI exits 0
either way, so the failure would be silent.

It does not fire on this art. **Both orderings were run over all 24 raw
background-removed sources this repository's `portrait` pass has ever seen** —
the four original committed egg/battle files (byte-identical) and the 21 raw
files the bank added, 18 egg variants and 3 boss portraits — and produce an
identical opaque mask on every one: same pixel area, same bounding box, 21 of 21
with zero mismatches. Nothing is owed here. Re-run the comparison only if the
peel constants change, and expect a difference only on art whose silhouette is
held together by a pale, low-contrast bridge.

`cutout` remains a deliberately different, looser pass — alpha threshold, the 3-pass
luminance peel of step (2), then a whole-bbox fit at 0.94 (a 31px margin) — with
no largest-region step, no border flood, no 2px shave, and no egg-axis bias,
because the hatch cracks it processes must keep every disconnected shell
fragment. The two remain not interchangeable:

| | margin on tight axis | centering | regions kept |
|---|---|---|---|
| `assets/images/eggs/` (`fit-art.mjs portrait --axis=egg`) | 24px | egg axis — L/R margins are asymmetric on purpose (e.g. `common.webp` L74/R53) | 1 |
| `assets/images/battles/` (`fit-art.mjs portrait`, no flag) | 24px | whole bbox | 1 |
| `assets/images/hatch/` (`fit-art.mjs cutout`) | 31px | whole bbox | all (see Hatch cracks) |
| `assets/images/dinos/` (`fit-art.mjs cutout`) | 31px | whole bbox | all (a clean portrait cutout lands at 1) |

Consequences when reusing either pass on a new or regenerated asset:

- Running `fit-art.mjs cutout` on a regenerated **egg** or **boss portrait**
  yields a slightly smaller, whole-bbox-centred subject than the committed set —
  visible side by side in an embed thumbnail row. Either accept the shift for the
  whole family or run `portrait`; do not mix the two within one family.
- Steps (1) and the "exactly one connected region" verification assume a single
  silhouette. They must **not** be applied to the hatch cracks, whose falling
  shell fragments are legitimately disconnected — see the Hatch cracks section.

**Common (reference egg):**

> A single large cartoon dinosaur egg standing upright, sitting in a low woven
> nest of brown twigs with two or three green leaves tucked in, perfectly
> centered. The egg and its nest together fill almost the entire square frame,
> edge to edge, with only a small even margin of background around them. Smooth
> gray-white eggshell with scattered small brown speckles, one soft glossy
> highlight on the upper left of the shell. The nest is a low ring around the
> base, covering only the very bottom of the egg. Plain flat light-gray studio
> background, no scenery, no ground shadow. No glow, rays, embers, sparkles, or
> light effects extending beyond the egg or the nest; glowing details may appear
> only on the surfaces themselves. Glossy cartoon mobile-game art style, bold
> dark outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

**Reskin edits** (each generated with the common egg attached as the `image`
reference). Prompt frame:

> Keep the exact same cartoon dinosaur egg and the exact same woven twig nest:
> same shape, same size, same position, same outline, same framing, same plain
> flat light-gray studio background. Change only the egg shell design and add
> small nest decorations: {SHELL}. {NEST}. No glow, rays, embers, sparkles, or
> light effects extending beyond the egg or the nest; glowing details may appear
> only on the surfaces themselves. Glossy cartoon mobile-game art style, bold
> dark outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

`{SHELL}` / `{NEST}` per rarity:

- **uncommon** — SHELL: moss-green eggshell (around #2ecc71) decorated with a
  simple pattern of small darker-green leaf shapes, subtle glossy highlight.
  NEST: weave a few extra fresh green leaves and tiny white flowers into the
  twigs.
- **rare** — SHELL: ocean-blue eggshell (around #3498db) with a wavy water-sheen
  pattern wrapping the shell and a few small water droplets on the surface,
  glossy wet-look highlights. NEST: tuck a few smooth blue pebbles and small
  seashells between the twigs.
- **epic** — SHELL: violet eggshell (around #9b59b6) with angular crystal facets
  embedded in the surface, the facets catching bright glossy highlights on the
  shell surface (add "no glowing aura or halo around the egg; the outline
  against the background must be crisp" — the model tends to add a purple glow).
  NEST: place a few small violet amethyst crystal shards among the twigs.
- **legendary** — SHELL: polished golden eggshell (around #f1c40f) engraved with
  elegant curved rune lines, the engraving gleaming on the shell surface only,
  no rays of light. NEST: weave a thin gold ribbon and a few tiny gold trinkets
  through the twigs.
- **mythic** — SHELL: jet-black obsidian eggshell covered in jagged glowing
  orange lava cracks, dramatic inner glow visible only through the cracks, no
  floating embers (matches the `volcano_core` site obsidian-and-lava look).
  NEST: charred dark twigs with a few ember-orange glowing tips. Do not add
  pebbles or loose objects — the model repeatedly scattered them on the ground
  outside the nest, where they become floating islands after matting.

### Variants (`-v2`, `-v3`, `-v4`)

Each rarity carries three variants beside its untouched base, for eighteen files
in total. Every one is an image-edit of **its own committed egg**, never of
another variant or another rarity, so the silhouette and nest read as
recognisably the same egg. Post-processed exactly like the base:
`remove_background`, then `node scripts/fit-art.mjs portrait --axis=egg` —
**never `cutout`**, which fits the whole bbox at a 31px margin, symmetric and
nest-centred, and would ship a variant that silently disagrees with its own
base's egg-axis 24px margin (see the divergence table above).

What varies is the **shell's pattern and surface detail** (speckling, banding,
mottling, sheen) and the **nest dressing**. What must never vary is the
**rarity's colour identity** — the shell palette is what tells a player what
they are holding, and `mythic` in particular stays obsidian-and-lava to match
`volcano_core`; none of its three variants add pebbles or loose objects, for
the same floating-island reason the base prompt excludes them.

Reskin edits follow the same prompt frame as the base reskins above, with a
distinct `{SHELL}` / `{NEST}` pair per variant:

- **common** — v2 SHELL: gray-white eggshell with larger oval brown speckles
  clustered toward the top of the shell, thinning out near the base. NEST: tuck
  a single small brown feather into the twigs alongside the leaves.
  v3 SHELL: gray-white eggshell with fine brown speckling arranged in soft
  freckled bands wrapping horizontally around the shell. NEST: add two small
  dry acorns resting in the twigs.
  v4 SHELL: gray-white eggshell with tiny dark-brown speckles clustered into a
  few small patches instead of an even scatter. NEST: weave one dry brown twig
  fork into the rim in place of one of the leaves.
- **uncommon** — v2 SHELL: moss-green eggshell (around #2ecc71) with a pattern
  of thin darker-green vine-like stripes curling around the shell instead of
  leaf shapes, subtle glossy highlight. NEST: weave a few fresh green leaves
  into the twigs and tuck in a single small pale-yellow wildflower.
  v3 SHELL: moss-green eggshell with small darker-green dappled spots
  scattered evenly across the surface, subtle glossy highlight. NEST: weave a
  few fresh green leaves and tiny white flowers into the twigs, and add one
  small curled fern frond among them.
  v4 SHELL: moss-green eggshell with a marbled swirl pattern of darker green
  woven through the surface, subtle glossy highlight. NEST: weave a few fresh
  green leaves and tiny white flowers into the twigs, with one small green
  vine tendril looping around the base of the nest.
- **rare** — v2 SHELL: ocean-blue eggshell (around #3498db) with a fine
  fish-scale pattern of overlapping pale-blue curves covering the surface,
  glossy wet-look highlights. NEST: tuck a smooth blue pebble and a single
  small pearlescent seashell spiral among the twigs.
  v3 SHELL: ocean-blue eggshell scattered with small round water-bubble
  droplets of varying sizes clustered near the top, glossy wet-look
  highlights. NEST: tuck a few smooth blue pebbles and a small pale coral
  fragment between the twigs.
  v4 SHELL: ocean-blue eggshell with horizontal wavy stripe bands of deeper
  blue wrapping the shell, glossy wet-look highlights. NEST: tuck a smooth
  blue pebble and a tiny cartoon starfish among the twigs.
- **epic** — v2 SHELL: violet eggshell (around #9b59b6) with a few large
  angular crystal facets clustered near the top of the shell and smoother
  violet surface below, the facets catching bright glossy highlights on the
  shell surface; no glowing aura or halo around the egg, the outline against
  the background must be crisp. NEST: place one small violet amethyst crystal
  shard tucked deeper into the twigs.
  v3 SHELL: violet eggshell covered edge to edge in a fine cracked-glass
  mosaic of tiny angular facets, the facets catching bright glossy highlights
  on the shell surface; no glowing aura or halo around the egg, the outline
  against the background must be crisp. NEST: place a couple of small violet
  amethyst crystal shards among the twigs.
  v4 SHELL: violet eggshell with spiraling bands of angular crystal facets
  winding around the shell from top to base, the facets catching bright
  glossy highlights on the shell surface; no glowing aura or halo around the
  egg, the outline against the background must be crisp. NEST: place a single
  larger violet amethyst crystal shard leaning against the nest rim.
- **legendary** — v2 SHELL: polished golden eggshell (around #f1c40f) engraved
  with a radiating sunburst pattern of straight gold lines spreading from the
  top of the shell, the engraving gleaming on the shell surface only, no rays
  of light. NEST: weave a thin gold ribbon through the twigs, tied in a small
  bow.
  v3 SHELL: polished golden eggshell engraved with a fine lattice of
  interlocking filigree lines covering the whole surface, the engraving
  gleaming on the shell surface only, no rays of light. NEST: weave a thin
  gold ribbon and a single small gold coin trinket through the twigs.
  v4 SHELL: polished golden eggshell engraved with bold zigzag chevron bands
  wrapping around the shell, the engraving gleaming on the shell surface only,
  no rays of light. NEST: weave a thin gold ribbon and a tiny gold star
  trinket through the twigs.
- **mythic** — v2 SHELL: jet-black obsidian eggshell with a few wide jagged
  lava cracks concentrated near the top of the shell, each crack glowing
  bright molten orange from within, no floating embers. NEST: charred dark
  twigs with a few ember-orange glowing tips, no pebbles or loose objects.
  v3 SHELL: jet-black obsidian eggshell covered in a dense network of fine
  spiderweb-thin glowing orange lava cracks spreading evenly across the whole
  surface, no floating embers. NEST: charred dark twigs with a few
  ember-orange glowing tips, no pebbles or loose objects.
  v4 SHELL: jet-black obsidian eggshell with glowing orange lava cracks
  forming a spiral pattern winding from the top of the shell down to the
  base, no floating embers. NEST: charred dark twigs with a few ember-orange
  glowing tips, no pebbles or loose objects.

Measured margins after post-processing — the tight-axis figure this family
lives or dies on, since the automated guard (`tests/images.test.ts`) checks
`min(top, bottom)` against 24px ± 1 on every file registered from disk, but a
31px reading (the `cutout` mode's whole-bbox margin) is the diagnostic to
watch for by hand on any future regeneration:

| Rarity | file | L | R | T | B |
|---|---|---|---|---|---|
| common | base | 74 | 53 | 24 | 24 |
| common | v2 | 14 | 110 | 24 | 24 |
| common | v3 | 73 | 54 | 24 | 24 |
| common | v4 | 72 | 59 | 24 | 24 |
| uncommon | base | 32 | 55 | 24 | 24 |
| uncommon | v2 | 30 | 49 | 24 | 24 |
| uncommon | v3 | 31 | 50 | 24 | 24 |
| uncommon | v4 | 38 | 61 | 24 | 24 |
| rare | base | 73 | 54 | 24 | 24 |
| rare | v2 | 73 | 53 | 24 | 24 |
| rare | v3 | 73 | 78 | 24 | 24 |
| rare | v4 | 73 | 56 | 24 | 24 |
| epic | base | 73 | 54 | 24 | 24 |
| epic | v2 | 73 | 78 | 24 | 24 |
| epic | v3 | 73 | 55 | 24 | 24 |
| epic | v4 | 67 | 58 | 24 | 24 |
| legendary | base | 74 | 53 | 24 | 24 |
| legendary | v2 | 72 | 48 | 24 | 24 |
| legendary | v3 | 73 | 78 | 24 | 24 |
| legendary | v4 | 73 | 50 | 24 | 24 |
| mythic | base | 73 | 79 | 24 | 24 |
| mythic | v2 | 73 | 79 | 24 | 24 |
| mythic | v3 | 74 | 78 | 24 | 24 |
| mythic | v4 | 73 | 78 | 24 | 24 |

Every one of the 24 files (six bases, eighteen variants) lands at T=24 B=24
exactly. L/R stay asymmetric and vary per file on purpose — the egg-axis fit
centres on the egg's own silhouette, not the whole nest bbox, so a variant
whose nest dressing sits further to one side (`common-v2`'s feather, for
example, at L=14 R=110) shifts the horizontal margin without moving the
vertical one. Re-measure with `scripts/measure-margins.mjs` if any of these is
ever regenerated; a 31/31 symmetric reading means `cutout` was used by mistake.

## Coastal Dig (`coastal_dig`)

**Banner (1536×1024):**

> A wide cartoon landscape of a sunny paleontology dig site on a tropical
> beach: golden sand with a shallow excavation pit, a huge dinosaur ribcage
> fossil half-buried in the sand, small wooden stakes and rope marking the dig
> square, a leaning palm tree on one side, turquoise ocean waves and a few
> white clouds behind. Bright cheerful daylight. Glossy cartoon mobile-game
> art style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset
> look. No text, no characters, no UI elements.

**Thumb (1024×1024)** — legacy prompt, recorded as run. It opens with the exact
"square cartoon game icon" phrasing the note on thumbs at the top of this file
identifies as the cause of rounded-rectangle app-icon output; convert it to the
positive full-bleed paragraph quoted there before rerunning it:

> A square cartoon game icon of a single large dinosaur skull fossil sitting
> in golden beach sand with a small palm leaf beside it, simple turquoise sky
> background. Centered composition, large readable shapes. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

## Amber Ridge (`amber_ridge`)

**Banner (1536×1024):**

> A wide cartoon landscape of a rocky ridge at golden sunset: layered
> honey-orange sandstone cliffs, large chunks of glowing amber embedded in the
> rock face with insects silhouetted inside, scattered amber pebbles glinting
> on a dirt path, warm orange sky with a low sun. Glossy cartoon mobile-game
> art style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset
> look. No text, no characters, no UI elements.

**Thumb (1024×1024)** — legacy prompt, recorded as run. It opens with the exact
"square cartoon game icon" phrasing the note on thumbs at the top of this file
identifies as the cause of rounded-rectangle app-icon output; convert it to the
positive full-bleed paragraph quoted there before rerunning it:

> A square cartoon game icon of one large glowing amber gemstone with a
> mosquito silhouette inside, resting on orange sandstone rocks, simple warm
> sunset background. Centered composition, large readable shapes. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

## Frozen Cliffs (`frozen_cliffs`)

**Banner (1536×1024):**

> A wide cartoon landscape of towering ice-blue glacier cliffs under a pale
> arctic sky with faint green aurora ribbons: snow drifts, jagged ice
> formations, and a large translucent block of ice in the foreground with a
> complete dinosaur skeleton frozen inside, cool blue tones with icy sparkle
> highlights. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no characters, no UI
> elements.

**Thumb (1024×1024)** — legacy prompt, recorded as run. It opens with the exact
"square cartoon game icon" phrasing the note on thumbs at the top of this file
identifies as the cause of rounded-rectangle app-icon output; convert it to the
positive full-bleed paragraph quoted there before rerunning it:

> A square cartoon game icon of a single translucent ice block with a dinosaur
> skeleton silhouette frozen inside, sitting on snow, simple pale-blue arctic
> sky background. Centered composition, large readable shapes. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

## Volcano Core (`volcano_core`)

Match the black-and-lava look of `assets/images/eggs/mythic.webp` (obsidian
shell with glowing orange cracks).

**Banner (1536×1024):**

> A wide cartoon landscape of a menacing volcano interior: jagged black
> obsidian rock with glowing orange lava cracks, rivers of bright lava flowing
> between dark stone ledges, floating embers and a dark smoky sky lit from
> below by orange glow, a large dark cave mouth at the center. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**Thumb (1024×1024)** — legacy prompt, recorded as run. It opens with the exact
"square cartoon game icon" phrasing the note on thumbs at the top of this file
identifies as the cause of rounded-rectangle app-icon output; convert it to the
positive full-bleed paragraph quoted there before rerunning it:

> A square cartoon game icon of a single black obsidian volcano peak with
> glowing orange lava cracks and a small lava eruption at the top, simple dark
> ember-lit sky background. Centered composition, large readable shapes.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no characters, no UI elements.

## Abyssal Trench (`abyssal_trench`)

Generated at 2528×1696 (3:2, resolution `2k`), fitted to 1536×1024 for the
banner; the thumb is a centered square crop of the same source, resized to
1024×1024 (not a squash). That crop was a hand pass at the time. It is now
`node scripts/fit-art.mjs square <src> <dest>`, which does exactly the same
cover-scale and centre-crop — run the mode on any regeneration.

**Banner (1536×1024) and Thumb (1024×1024), same source:**

> A deep-ocean abyssal trench, dominated by deep blue and blue-black water filling
> the whole frame edge to edge with no letterboxing and no black bars. Steep dark
> basalt walls on both sides falling away into a narrow black chasm, drifting
> marine snow and pale cyan particulate suspended in the water, a small cluster of
> dim amber hydrothermal vents low in the scene venting dark mineral smoke, tall
> kelp-like tube worms clinging to the rock, a distant submersible's pale lamp beam
> raking across the far wall. Cold blue palette overall, the amber vents small and
> secondary, never lava-like. Wide cinematic establishing shot filling the entire
> canvas. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no characters, no UI elements.

Note for future regeneration: the first attempt at 1k came back letterboxed with
baked-in black bars, and its orange vent chimneys read as lava, colliding with
Volcano Core's identity. The "filling the whole frame edge to edge with no
letterboxing", the explicit blue dominance, and "never lava-like" are the three
clauses that fixed it.

## Containment Site (`containment_site`)

Generated at 1264×848, upscaled to 3216×2160 (`bytedance_image_upscale`, 2k),
fitted to 1536×1024 for the banner; the thumb is a centered square crop of the
same upscaled source, resized to 1024×1024 (not a squash) — a hand pass then,
`node scripts/fit-art.mjs square` now.

**Banner (1536×1024) and Thumb (1024×1024), same source:**

> A rain-slick dinosaur research compound at night behind heavy electrified fencing,
> tall floodlight towers cutting bright cones through drifting mist, a breached inner
> paddock gate hanging open with bent steel bars, yellow warning chevrons painted on
> wet concrete, puddles reflecting the lights, cold teal and sodium-amber palette,
> wide cinematic establishing shot. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel shading
> with smooth gradients, polished game-asset look. No text, no characters, no UI
> elements.

## Founder's Park (`founders_park`)

Generated at 1264×848 (3:2, `nano_banana_2`, routed by the service to
`nano_banana_flash`), fitted to 1536×1024 for the banner via
`node scripts/fit-art.mjs banner`; the thumb is a centered square crop of the
same source, resized to 1024×1024 with `drawImage` (not a squash), same recipe
as the Abyssal Trench and Containment Site thumbs above. This was a hand pass
because no `fit-art.mjs` mode produced a site thumb when it was written; the
`square` mode this bank added is that pass, so a regeneration runs
`node scripts/fit-art.mjs square <src> <dest>` rather than repeating it by hand.

**Banner (1536×1024) and Thumb (1024×1024), same source:**

> A ruined dinosaur park main entrance at golden hour, a cracked stone archway
> standing over rusted turnstiles half-swallowed by creeping vines and tall
> ferns, a toppled weathered wooden signboard lying face-up in long grass with
> a completely blank peeling surface, buckled paving stones across an
> abandoned visitor plaza, enormous dinosaur silhouettes moving in the warm
> haze beyond the open gate, long amber light and drifting dust motes, warm
> gold and deep green palette, a sense of a place reclaimed. Wide cinematic
> establishing shot filling the entire canvas edge to edge with no
> letterboxing. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. CRITICAL: absolutely no writing
> anywhere in the image — no letters, no words, no numbers, no carved
> inscriptions, no painted signage, no symbols, no logos. Every sign, plaque
> and surface is blank and wordless. No human characters, no UI elements.

Note for future regeneration: the first attempt rendered a legible "WELCOME"
across the toppled signboard despite the prompt already asking for a blank
surface — the plain "blank peeling surface" phrase was not enough on its own.
The explicit CRITICAL no-writing block (no letters/words/numbers/inscriptions/
signage/symbols/logos, every sign and surface blank and wordless) is what
fixed it; keep that block verbatim on any future regeneration of this scene.

### Variants (`-v2`, `-v3`)

Each of the seven sites carries two variants beside its untouched base, for
fourteen files in total. Every one is an image-edit of **its own committed
banner** (uploaded via `media_upload`, referenced with role
`image_references`), never of another variant or another site's banner,
generated at `3:2` (`resolution: 2k`) and post-processed with
`node scripts/fit-art.mjs banner <src> <dest>` — no `remove_background`, since
this family ships full-bleed opaque scenes, not cutouts, the same rule the ten
hot-banner variant sets above follow.

What varies is the vantage point, the weather and the time of day — a
different view of the same location. What must never vary is the site's
colour identity, which is how a player recognises where they are:
`volcano_core`'s two variants both restate "the palette stays black obsidian
rock with glowing orange lava throughout, never any other color dominating
the scene" verbatim from its own identity rule, and `abyssal_trench`'s two
both restate "Cold blue palette dominates overall; the amber vents stay small
and secondary, never lava-like, never orange-dominant anywhere in the frame" —
the same clause that fixed that site's own first generation, carried forward
into every variant edit rather than assumed to survive on its own.

Every prompt carries the expanded no-text clause ("No text, no lettering, no
words, no numbers, no signage writing anywhere in the scene") uniformly. The
two `founders_park` variants additionally carry the CRITICAL no-writing block
from that site's own base prompt, since both keep the toppled signboard in
frame. The `volcano_core` and `abyssal_trench` variants also carry a no-glow-
beyond-silhouette clause naming their own emissive surfaces (lava and rock;
vents and creatures) — the same hard no-glow rule the egg family states in
general terms, restated here against the specific surfaces each scene adds.

Each prompt follows the same edit-instruction shape as the hot-banner variants
above: "Keep the exact same scene: [the base's own held-constant objects,
named individually]. Change only the vantage point and the weather/time of
day: [the one specific change]."

- **coastal_dig** — v2: higher elevated dune view, soft pastel dawn, calm
  glassy water. v3: lower ground-level view close to the dig stakes, a
  gathering tropical storm with choppier waves and foam.
- **amber_ridge** — v2: pulled back to a wider view, bright clear midday sun.
  v3: closer lower angle near the rock face, damp rain-darkened stone, cool
  violet-blue dusk.
- **frozen_cliffs** — v2: wider elevated view, deep polar night sky with
  brighter, more vivid aurora. v3: closer lower angle, gentle falling snow,
  flat overcast sky with no aurora.
- **volcano_core** — v2: higher rocky-ledge view looking down into the
  caldera. v3: lower ground-level view close to a lava river, a small
  eruption burst at the distant cave mouth.
- **abyssal_trench** — v2: higher vantage looking down the chasm, a shaft of
  pale cyan light. v3: closer lower angle near the vent cluster, a second
  submersible lamp beam crossing in the background.
- **containment_site** — v2: wider elevated view, heavier rain streaking
  through the floodlight beams, deeper teal-black night. v3: lower
  ground-level view close to the bent steel bars, pale dawn breaking through
  the mist instead of full night.
- **founders_park** — v2: pulled back to a wider view, bright clean midday
  light instead of golden hour. v3: closer lower angle near the vines and the
  toppled signboard, cool pale morning mist instead of warm amber haze.

All 14 generated images were accepted on the first attempt — zero
regenerations, zero colour-identity drift on `volcano_core`/`abyssal_trench`,
zero text leaks anywhere in the set.

---

## Chapters 8–10 (banked, unshipped)

Speculative art for three campaign chapters that do not exist in `src/data/`
today and may never ship. Banked because the generator access that produced
every asset under `assets/images/` was expiring and could not be revisited
later — worthless if these chapters never ship, and unobtainable afterward if
they do. **Nothing in `src/` reads any of these nine files yet.** Chapter ids
double as expedition-site ids per the campaign's chapter-id ≡ site-id
invariant, so each also forces an expedition site whenever (if ever) the
chapter is actually written.

The arc escalates outward from the park in three beats — the mainland, the
city, then wilderness the breach never reaches — and chapter 10's banner
deliberately carries no human wreckage at all: that absence is the argument
of the arc, distinguishing it from every biome site documented above.

**Pipeline.** Banners were generated at 2528×1696 (3:2, `nano_banana_pro`
routed by the service to `nano_banana_2`, `resolution: 2k`) and fitted to
1536×1024 with `node scripts/fit-art.mjs banner`. Thumbs were generated
SEPARATELY as their own close-up square compositions — not cropped from the
banner, per the "do not just crop the banner" rule stated earlier in this
document — at 2048×2048 (1:1, `resolution: 2k`) and fitted to 1024×1024 with
`node scripts/fit-art.mjs square`, the cover-scale mode this bank added
specifically because no producer existed for a generated site thumb before
now (it reproduces the centred-square-crop hand pass the last three site
thumbs used). Boss portraits were generated as image-edits of the committed
`assets/images/battles/boss-coastal_dig-portrait.webp` (uploaded via
`media_upload`, referenced with role `image_references` — `prompts.md` says
plain `image` elsewhere in this document; that is stale for this model),
background-removed, and fitted with `node scripts/fit-art.mjs portrait` —
the whole-bbox 24px-margin variant, no `--axis=egg` — matching the seven
committed boss portraits rather than `fit-art.mjs cutout`'s 31px.

Unlike the archetype and species portraits, a boss must read as a **named
individual** — scarring, chipped teeth, individuating damage — so every boss
prompt below asks for exactly that, the same framing the seven shipped boss
prompts use. Every prompt in this section carries the escalated no-text
clause ("No text, no lettering, no words, no numbers, no signage writing
anywhere in the scene"); banners and thumbs additionally carry the Founder's
Park CRITICAL no-writing block verbatim, since a ferry terminal, city
signage and open wilderness (nothing to write on, kept anyway for
consistency) are exactly the kind of surface that has rendered spurious
lettering before.

### Mainland Ferry (`mainland_ferry`)

The harbour the breach reaches the mainland through.

**Banner (1536×1024):**

> A wide cartoon landscape of a mainland ferry terminal breach: a large car
> ferry listing at a steep angle, half-beached against a cracked concrete
> pier at dusk, its loading ramp buckled and twisted, tall gantry cranes
> standing dark and idle behind it, harsh floodlights on tall poles raking
> long white beams across choppy dark water, scattered shipping containers
> tipped on the dock, a deep orange-purple dusk sky reflecting on the water's
> surface. Wide cinematic establishing shot filling the entire canvas edge to
> edge with no letterboxing. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene.
> CRITICAL: absolutely no writing anywhere in the image — no letters, no
> words, no numbers, no carved inscriptions, no painted signage, no symbols,
> no logos. Every sign, plaque and surface is blank and wordless. No human
> characters, no UI elements.

**Thumb (1024×1024):**

> A close-up cartoon scene filling the entire square frame edge to edge of a
> single rusted ferry ramp gate, buckled and half-lowered, mooring cables
> snapped and coiled on wet concrete beside it, a hazy dusk-orange sky and
> dark water glimpsed behind. Centered composition, one large readable
> landmark, simple background. Glossy cartoon mobile-game art style, bold
> dark outlines, vibrant saturated colors, strong glossy highlights, clean
> cel shading with smooth gradients, polished game-asset look. NOT an app
> icon — no rounded-rectangle tile, no border, no rounded corners. No text,
> no lettering, no words, no numbers, no signage writing anywhere in the
> scene. CRITICAL: absolutely no writing anywhere in the image — no letters,
> no words, no numbers, no carved inscriptions, no painted signage, no
> symbols, no logos. Every sign, plaque and surface is blank and wordless. No
> human characters, no UI elements.

**These two thumb prompts still carry the retired "NOT an app icon" clause**, and
that is deliberate rather than an oversight: both came back as correct full-bleed
squares WITH it, so they are recorded as run. But the same clause is what failed
on the `continental_divide` thumb one section later — see the note on thumbs at
the top of this file — so on any regeneration, strip every mention of "app icon",
"tile", "icon" and "game icon" and use the positive full-bleed paragraph quoted
there instead. Do not read these two prompts as evidence that the clause works.

**Boss — `boss-mainland_ferry`, the Harbormaster:** a barnacle-crusted
semiaquatic apex that took the terminal, hide scarred by mooring cable,
framed against wet steel. Generated as an image-edit of the coastal_dig
reference portrait.

> Keep the exact same head-and-shoulders boss portrait: same pose, same
> framing, same plain flat light-gray studio background, facing right with
> the snout pointing right, matching the reference portrait's profile
> direction. Change the dinosaur to a fierce cartoon semiaquatic apex
> predator called the Harbormaster: a barnacle-crusted hide over broad wet
> gray-green scales, thick ropy scarring cut deep across the neck and jaw
> where mooring cable dragged against it over years, a few small barnacle
> clusters clinging to the brow and jawline, a cold metallic-wet glossy sheen
> like rain on dockyard steel, one chipped and broken tooth visible in a
> snarling jaw, a pale watchful eye. Individuating damage and scarring are
> wanted here — this is a named individual, not a species type. CRITICAL
> FRAMING: zoom out so the ENTIRE creature — the broad head, the thick
> scarred neck, and both shoulders — sits well inside the frame, small in
> the canvas, surrounded by a wide band of empty background on all four
> sides. Nothing may touch, run off, or be cropped by any edge of the image,
> especially the left and bottom edges. No glow, rays, embers, sparkles, or
> light effects extending beyond the creature silhouette; glowing details
> may appear only on the surfaces themselves. Glossy cartoon mobile-game art
> style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset
> look. No drawn border, no frame, no panel edge, no letterboxing. No text,
> no numbers, no lettering, no signage writing, no human characters, no UI
> elements.

### Ruined City (`ruined_city`)

Downtown, long reclaimed.

**Banner (1536×1024):**

> A wide cartoon landscape of a downtown city canyon long reclaimed by
> nature: a collapsed elevated overpass with its broken slab ends dangling
> in mid-air, a tall glass office tower with shattered windows and thick
> vines cascading down its face, a large earthen nesting mound built inside
> a cracked plaza fountain surrounded by wild grass pushing through the
> pavement, hazy golden haze and a low sun glowing between silhouetted
> skyscrapers, birds circling high above. Wide cinematic establishing shot
> filling the entire canvas edge to edge with no letterboxing. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no lettering, no words, no numbers, no
> signage writing anywhere in the scene. CRITICAL: absolutely no writing
> anywhere in the image — no letters, no words, no numbers, no carved
> inscriptions, no painted signage, no symbols, no logos. Every sign, plaque
> and surface is blank and wordless. No human characters, no UI elements.

**Thumb (1024×1024):**

> A close-up cartoon scene filling the entire square frame edge to edge of a
> single moss-covered nesting mound built inside a cracked stone plaza
> fountain, thick vines climbing the fountain's rim, wild grass pushing
> through the stone, a hazy glass skyscraper silhouette glimpsed behind
> through golden haze. Centered composition, one large readable landmark,
> simple background. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. NOT an app icon —
> no rounded-rectangle tile, no border, no rounded corners. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene.
> CRITICAL: absolutely no writing anywhere in the image — no letters, no
> words, no numbers, no carved inscriptions, no painted signage, no symbols,
> no logos. Every sign, plaque and surface is blank and wordless. No human
> characters, no UI elements.

**Same caveat as the Mainland Ferry thumb above:** the "NOT an app icon" clause
is recorded because it is what ran, not because it is what to run again. Convert
it to the positive full-bleed paragraph on any regeneration.

**Boss — `boss-ruined_city`, the Tower Nester:** a large flier whose
wingspan reads against skyline, perched crest-forward on a broken cornice.
Generated as an image-edit of the coastal_dig reference portrait.

> Keep the exact same head-and-shoulders boss portrait: same pose, same
> framing, same plain flat light-gray studio background, facing right with
> the beak pointing right, matching the reference portrait's profile
> direction. Change the dinosaur to a fierce cartoon apex flier called the
> Tower Nester: a tall crest sweeping back from the skull, a long hooked
> beak with chipped notches along the edge from old fights, mottled
> slate-gray and rust-orange plumage, a torn ragged edge along the folded
> wing shoulder from a healed old wound, sharp watchful eyes, snarling with
> territorial menace. Individuating damage and scarring are wanted here —
> this is a named individual, not a species type. CRITICAL FRAMING: zoom out
> so the ENTIRE creature — the tall crest, the long beak, and the folded
> wing shoulder — sits well inside the frame, small in the canvas,
> surrounded by a wide band of empty background on all four sides. Nothing
> may touch, run off, or be cropped by any edge of the image, especially the
> top and side edges. No glow, rays, embers, sparkles, or light effects
> extending beyond the creature silhouette; glowing details may appear only
> on the surfaces themselves. Glossy cartoon mobile-game art style, bold
> dark outlines, vibrant saturated colors, strong glossy highlights, clean
> cel shading with smooth gradients, polished game-asset look. No drawn
> border, no frame, no panel edge, no letterboxing. No text, no numbers, no
> lettering, no signage writing, no human characters, no UI elements.

### Continental Divide (`continental_divide`)

High open wilderness past any human structure, no ruins at all.

**Both of this chapter's scenes were regenerated once, and the reason is worth
reading before touching them.** The first pass followed a brief that said
"migrating herd silhouettes" without saying *of what*, and leaned hard on the
absence of human structures. It produced a pastoral alpine meadow with **bison**
on the ridge, and a thumb that was the Matterhorn with **goats** — no dinosaurs
anywhere in either, in a dinosaur game. Nothing in the checklist caught it: no
text, no humans, correct dimensions, and a defensible reading of the brief.

Two lessons, both in the prompts below. **Name the animals.** An absence
("no human structures") does not imply a presence; the model fills the gap with
generic wildlife, and every scene in this document that contains creatures now
says explicitly that every one of them is a dinosaur, with the plausible
mammals named as exclusions. **And never write "icon" or "tile"** — see the note
on thumbs at the top of this file.

**Banner (1536×1024):**

> A wide establishing shot of a vast high-altitude mountain pass at storm-break
> dawn, deep in wild country far beyond any human structure. A herd of enormous
> long-necked sauropod DINOSAURS — huge four-legged brachiosaur-like giants with
> towering necks and long tails — walks in dark silhouette along a distant
> ridgeline, dwarfed by the peaks yet unmistakably colossal. In the mid-ground,
> more dinosaurs graze a windswept alpine valley: hadrosaurs and horned
> ceratopsians in scattered groups. Jagged snow-streaked granite peaks rise on
> both sides, torn cloud and shafts of cold light breaking between them, a
> glacial river threading the valley floor far below. The mood is awe, scale and
> untamed wilderness — the world after the fences failed, belonging entirely to
> dinosaurs. Absolutely no buildings, no roads, no fences, no vehicles, no ruins,
> no wreckage and no human structures of any kind anywhere in the scene. No
> mammals, no goats, no cattle, no bison, no deer, no birds — every animal in the
> image is a dinosaur. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look.

**Thumb (1024×1024):**

> A full-bleed square painting, cropped in close, of the head and towering neck
> of a single colossal long-necked sauropod DINOSAUR rising in the foreground
> against a jagged snow-capped mountain pass at storm-break dawn. Its skin is
> weathered slate-green with a pale underside; it is seen from slightly below so
> it reads as enormous. Behind it two smaller sauropod necks rise along the
> distant ridge, and shafts of cold light break through torn cloud between
> granite peaks. Simple uncluttered background so the animal reads instantly at
> small size. The mood is awe and untamed scale, wilderness that belongs to
> dinosaurs. The painting is a continuous scene that bleeds off all four edges of
> the square, like a cropped detail of a much larger canvas: the artwork must run
> right into every corner and every edge of the image with the subject cut off by
> the frame, filling the picture completely. Every corner of the square is
> painted scene. The background is solid painted sky and rock all the way to the
> boundary, never white, never blank, never a plain flat margin, and the
> composition has no surrounding frame, no border, no outline, no rounded
> corners, no drop shadow and no background panel of any kind. Absolutely no
> buildings, no roads, no fences, no vehicles, no ruins and no human structures.
> No mammals, no goats, no cattle, no bison, no deer, every animal is a dinosaur.
> No text, no lettering, no words, no numbers, no signage writing anywhere in the
> scene, no human characters, no UI elements. Glossy cartoon mobile-game art
> style, bold dark outlines, vibrant saturated colors, strong glossy highlights,
> clean cel shading with smooth gradients, polished game-asset look.

Post-processed with `node scripts/fit-art.mjs banner` and
`node scripts/fit-art.mjs square` respectively.

**Boss — `boss-continental_divide`, the Divide Alpha:** the apex of a
wild-born generation, the first that never saw a fence. Generated as an
image-edit of the coastal_dig reference portrait.

> Keep the exact same head-and-shoulders boss portrait: same pose, same
> framing, same plain flat light-gray studio background, facing right with
> the snout pointing right, matching the reference portrait's profile
> direction. Change the dinosaur to a fierce cartoon apex predator called
> the Divide Alpha, the largest and oldest of a wild-born generation that
> never saw a fence: a heavy weathered hide in deep slate and burnt-umber
> tones, a broad battle-worn brow ridge, several parallel claw-rake scars
> across the cheek and neck from rival combat, one notched and broken horn
> tip, a wind-roughened natural texture to the hide with no tag, no collar,
> and no trace of any human marking anywhere, snarling with primal
> dominance. Individuating damage and scarring are wanted here — this is a
> named individual, not a species type. CRITICAL FRAMING: zoom out so the
> ENTIRE creature — the broad brow ridge, the horn, and both complete
> shoulders — sits well inside the frame, small in the canvas, surrounded by
> a wide band of empty background on all four sides. Nothing may touch, run
> off, or be cropped by any edge of the image, especially the top and
> bottom edges. No glow, rays, embers, sparkles, or light effects extending
> beyond the creature silhouette; glowing details may appear only on the
> surfaces themselves. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No drawn border,
> no frame, no panel edge, no letterboxing. No text, no numbers, no
> lettering, no signage writing, no human characters, no UI elements.

Deliberately no tag or collar on the Divide Alpha, unlike Asset 47 and
Ultimasaurus — this boss carries no trace of the park at all, the same
argument its banner makes.

**Measured margins**
(`scripts/measure-margins.mjs`):
`boss-mainland_ferry` L24/R24/T69/B69, `boss-ruined_city` L24/R24/T82/B82,
`boss-continental_divide` L24/R24/T131/B131 — the house invariant
`min(L,R,T,B) === 24`, symmetric on both axes, holds for all three, matching
the seven committed boss portraits.

Two of the five generation retries in this batch failed with no error detail
from the service (not a content or style rejection — a bare `failed` status);
resubmitting the identical request succeeded both times, and neither retry
was charged.

---

## Embed banners

33 wide banners for the surfaces that have no site or egg art of their
own. All generated with Higgsfield Nano Banana Pro at 3:2, then scaled to
1536×1024 (the generator emits 1264×848; scaling to full width leaves ~6px of
vertical excess, which is center-cropped).

| File | Size | Use |
|---|---|---|
| `assets/images/banners/trading.webp` | 1536×1024 | `/trade list` embed image |
| `assets/images/banners/leaderboards.webp` | 1536×1024 | `/top` embed image |
| `assets/images/banners/help.webp` | 1536×1024 | `/help` overview embed image |
| `assets/images/banners/care.webp` | 1536×1024 | care embed, dinos fed |
| `assets/images/banners/care_neglect.webp` | 1536×1024 | care embed, a dino is very hungry |
| `assets/images/banners/shop_food_market.webp` | 1536×1024 | `/shop view` food market embed image |
| `assets/images/banners/battle_victory.webp` | 1536×1024 | `/battle fight` F4 image, win |
| `assets/images/banners/battle_defeat.webp` | 1536×1024 | `/battle fight` F4 image, loss |
| `assets/images/banners/collect.webp` | 1536×1024 | `park:collect` reply embed image |
| `assets/images/banners/rescue.webp` | 1536×1024 | `/rescue` success embed image |
| `assets/images/banners/dino_roster.webp` | 1536×1024 | `/dino list` embed image |
| `assets/images/banners/eggs_incubator.webp` | 1536×1024 | `/eggs` embed image, `/help topic:eggs` |
| `assets/images/banners/sell.webp` | 1536×1024 | `/sell` confirmation prompt embed image |
| `assets/images/banners/gene_lab.webp` | 1536×1024 | `/breed` confirm/status/claim embed image |
| `assets/images/banners/gene_splice.webp` | 1536×1024 | `/splice` preview/result embed image |
| `assets/images/banners/daily.webp` | 1536×1024 | `/daily` hub + `daily:claim` embed image, `/help topic:daily` |
| `assets/images/banners/achievements.webp` | 1536×1024 | `/achievements` + `ach:claimall` embed image |
| `assets/images/banners/guests.webp` | 1536×1024 | `/guests view`, `/guests build`, `/guests claim` and `/help topic:guests` embed image |
| `assets/images/banners/dex.webp` | 1536×1024 | `/dex list` embed image |
| `assets/images/banners/landmark.webp` | 1536×1024 | `/park landmark` embed image |
| `assets/images/banners/season.webp` | 1536×1024 | `/season` hub + `season:claim` embed image, and the season-ending alert DM |
| `assets/images/banners/duel.webp` | 1536×1024 | `/duel challenge`, `/duel record` and the duel result embed image, `/help topic:duel` |
| `assets/images/banners/battles.webp` | 1536×1024 | `/help topic:battles` embed image |
| `assets/images/banners/event-clear_skies.webp` | 1536×1024 | `/world` hub embed image, Clear Skies |
| `assets/images/banners/event-amber_storm.webp` | 1536×1024 | `/world` hub embed image, Amber Storm |
| `assets/images/banners/event-fossil_rush.webp` | 1536×1024 | `/world` hub embed image, Fossil Rush |
| `assets/images/banners/event-heat_wave.webp` | 1536×1024 | `/world` hub embed image, Heat Wave |
| `assets/images/banners/event-cold_snap.webp` | 1536×1024 | `/world` hub embed image, Cold Snap |
| `assets/images/banners/event-bumper_harvest.webp` | 1536×1024 | `/world` hub embed image, Bumper Harvest |
| `assets/images/banners/event-market_panic.webp` | 1536×1024 | `/world` hub embed image, Market Panic |
| `assets/images/banners/event-blood_moon.webp` | 1536×1024 | `/world` hub embed image, Blood Moon |
| `assets/images/banners/event-migration_season.webp` | 1536×1024 | `/world` hub embed image, Migration Season |
| `assets/images/banners/lots.webp` | 1536×1024 | `/park view` Lots tab embed image |

These are the only prompts in this file whose subject is dinosaurs rather than
scenery, so they drop the shared block's "no characters" clause and forbid only
human ones. The rest of the shared style block applies unchanged, with one
exception: `care_neglect.webp` also drops "vibrant saturated colors, strong
glossy highlights", because the whole point of that variant is muted,
desaturated, overcast — keeping the clause would fight the prompt.

**Trading (`trading.webp`):**

> A wide cartoon scene of a lively prehistoric trading post in a lush dinosaur
> park: a wooden market stall stacked with open crates of red meat and glossy
> dinosaur eggs, a pile of gold coins and a small treasure chest on the
> counter, colorful hanging cloth awning, two friendly cartoon dinosaurs facing
> each other across the stall mid-trade — a green long-necked sauropod on the
> left offering an egg, a small orange theropod on the right holding a pouch of
> coins — leafy jungle ferns and a dirt path behind them, warm cheerful
> afternoon daylight. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no human characters, no
> UI elements.

**Leaderboards (`leaderboards.webp`):**

> A wide cartoon scene of a dinosaur park awards ceremony: a three-tier stone
> podium in the center marked with first, second and third place steps, a huge
> gleaming golden trophy cup standing on the tallest step, colorful triangular
> bunting flags strung overhead, a small crowd of cheerful cartoon dinosaurs of
> different colors gathered around the podium celebrating with raised heads,
> lush green park grounds and palm trees behind, bright sunny daylight with
> confetti in the air. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no human
> characters, no UI elements.

The model renders "1st / 2nd / 3rd" on the podium steps despite the no-text
clause. That is kept deliberately — the numerals are correct and reinforce what
the embed is for. Regenerating may or may not reproduce them.

**Help (`help.webp`):**

> A wide cartoon scene of the grand entrance gates to a dinosaur park at golden
> hour: two tall carved wooden gate posts topped with a large arching timber
> crossbeam and a dinosaur skull emblem at its center, the heavy gates swung
> open, a warm dirt path leading through them toward a lush valley of ferns,
> palms and distant misty green hills where a long-necked sauropod grazes far
> away, flaming torches on the gate posts, warm golden sunset light and soft
> god rays. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no human characters, no UI
> elements.

**Care (`care.webp`):**

> A wide cartoon scene of a dinosaur park feeding station on a sunny morning: a
> sturdy wooden feeding trough in the center heaped high with fresh green ferns
> and leafy branches, a stack of hay bales and a wooden water barrel beside it,
> a happy well-fed green long-necked sauropod leaning down to eat from the
> trough with its eyes closed contentedly, a wooden fence and lush jungle
> foliage behind, bright warm morning sunlight, cheerful and abundant. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no human characters, no UI elements.

**Care — neglected (`care_neglect.webp`):**

Generated with `care.webp` attached as the `image` reference so the two read as
the same place at two different moments. Regenerate it the same way, or the
pair stops matching and the swap looks like a scene change rather than a
warning.

> Keep the exact same cartoon feeding station scene: same wooden trough in the
> same position, same hay bales and water barrel, same wooden fence, same
> jungle foliage, same camera framing and composition. Change only the mood to
> neglected and hungry: the trough is now completely empty and bare with only a
> few dry brown scraps in it, the water barrel is tipped and empty, the hay is
> sparse and yellowed, and the long-necked sauropod now stands with its head
> drooping low and sad hungry eyes, looking thinner and duller in color.
> Overcast grey daylight with muted desaturated colors and long dull shadows
> instead of warm sunshine. Glossy cartoon mobile-game art style, bold dark
> outlines, clean cel shading with smooth gradients, polished game-asset look.
> No text, no human characters, no UI elements.

### shop_food_market (banners/shop_food_market.webp)

Jurassic-park gift-shop food market stall, wooden counter with two clearly split
display sides: left side lush greens — fern bundles, fruit baskets, crowned
premium lettuce; right side butcher/fishmonger — fresh fish on ice, hanging meat
leg, marbled steak. Warm tropical daylight, painted-illustration style matching
the existing site banners, no text, no people, 3:2 (scaled and center-cropped
to 1536×1024 like the other banners).

**Battle victory (`battle_victory.webp`):**

> A wide cartoon scene of a dinosaur park arena after a won battle: a proud
> victorious green cartoon dinosaur standing tall on a rocky outcrop with its
> head raised, banners and pennants flying on tall poles behind it, scattered
> broken wooden barricades on the sand floor, warm golden late-afternoon light
> breaking through dust in the air, triumphant and bright. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no human characters, no UI elements.

**Battle defeat (`battle_defeat.webp`):**

Generated with `battle_victory.webp` attached as the `image` reference, the same
`care` / `care_neglect` pairing — regenerate it the same way or the two moods
stop reading as one arena.

> Keep the exact same cartoon arena scene: same rocky outcrop, same banner
> poles, same barricades, same camera framing and composition. Change only the
> mood to defeat: the dinosaur now stands with its head lowered and shoulders
> dropped, the banners are torn and drooping, dust hangs heavy. Overcast grey
> light with muted desaturated colors and long dull shadows instead of golden
> sun. Glossy cartoon mobile-game art style, bold dark outlines, clean cel
> shading with smooth gradients, polished game-asset look. No text, no human
> characters, no UI elements.

**Collect (`collect.webp`):**

> A wide cartoon scene of a dinosaur park ticket booth at closing time: an
> open cash box on a wooden counter overflowing with gold coins and banknotes,
> stacks of coins beside it, a small blank chalkboard sign and a coil of
> ticket stubs, lush ferns and a park path behind, warm cheerful afternoon
> daylight. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no lettering, no words, no
> numbers, no signage writing anywhere in the scene, no human characters, no
> UI elements.

A first attempt with a plain "small chalkboard sign" and a bare "No text"
clause rendered a carved "PARK ENTRANCE" sign and a hanging "CLOSED" sign in
legible lettering. The "blank" chalkboard and the expanded no-text clause
above are load-bearing — regenerating from a shorter version risks
reproducing the signage text.

**Rescue (`rescue.webp`):**

> A wide cartoon scene of a dinosaur recapture in a park at dusk: a broken
> section of tall wire perimeter fence with the gap being closed by a wooden
> barricade, a small worried green cartoon dinosaur being coaxed back toward
> the enclosure along a rope-marked path, a parked park jeep with its headlamp
> on and a net beside it, jungle treeline and deep blue evening sky behind.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no human characters, no UI elements.

**Dino roster (`dino_roster.webp`):**

> A wide cartoon scene of a dinosaur park roster board area: a row of five
> different friendly cartoon dinosaurs of assorted colors and sizes standing
> side by side along a wooden fence line as if lined up for a headcount, a
> long-necked sauropod, a horned ceratopsian, a plated stegosaur, a small
> theropod and a crested hadrosaur, lush ferns and palms behind, bright
> cheerful morning daylight. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene,
> no human characters, no UI elements.

**Eggs incubator (`eggs_incubator.webp`):**

> A wide cartoon scene of a dinosaur park hatchery incubation room: a curved
> bank of warm glass incubator domes on a steel bench, each holding a single
> speckled egg nested in straw, soft amber heat lamps overhead, coiled hoses
> and a temperature dial on the wall, dark room lit warmly from the domes
> themselves. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no lettering, no
> words, no numbers, no signage writing anywhere in the scene, no human
> characters, no UI elements.

**Sell (`sell.webp`):**

> A wide cartoon scene of a prehistoric park buyer's stall: a heavy wooden
> counter with a brass weighing scale, an open ledger, a leather coin pouch
> spilling gold, and an empty transport crate with its lid propped open and
> straw inside, a dirt path and jungle ferns behind, warm late-afternoon
> daylight. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no lettering, no words, no
> numbers, no signage writing anywhere in the scene, no human characters, no
> UI elements.

These three prompts started from the shared block's plain "No text" clause
(matching the rest of this section), but carried the `collect.webp` fix
proactively — a roster board, an incubation room with a dial, and a buyer's
stall with a ledger are exactly the kind of scene a model will happily letter.
All three generated clean on the first attempt with the strengthened clause,
so no regeneration was needed.

**Daily (`daily.webp`) and Achievements (`achievements.webp`):** generated
with Higgsfield Nano Banana Pro at 3:2, then
`node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024 WebP q95 — same
pipeline as the rest of this section.

> **daily.webp:** A wide cartoon scene of a dinosaur park quest board beside a
> well-trodden path: a warm timber signpost holding a chalkboard-style board
> with three blank scroll-shaped tags hanging from little hooks, a lit
> lantern and a small hourglass resting on the ledge below it, a friendly
> cartoon dinosaur pausing to look up at the board with its head tilted, lush
> ferns and a dirt path behind, soft early-morning daylight. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

> **achievements.webp:** A wide cartoon scene of a dinosaur park trophy
> alcove: a long wooden shelf lined with a row of gleaming bronze, silver,
> gold, and platinum medals hanging on ribbons, a tall ornate trophy cup on a
> pedestal at the center, warm spotlight beams falling from above, a proud
> cartoon dinosaur standing beside the shelf with its head held high, polished
> stone floor and soft draped banners behind, warm celebratory lighting.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no lettering, no words, no numbers, no
> signage writing anywhere in the scene, no human characters, no UI elements.

**Guests (`guests.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. Generated with
`help.webp` **and** `leaderboards.webp` attached as `image` references: the
first carries the warm park-entrance vocabulary, the second is the only
existing banner with a crowd of cartoon dinosaurs and bunting, and the guests
plaza has to read as the same park as both.

**The no-human clause is doubled on this one prompt, and that is load-bearing.**
Every banner in this section forbids human characters, but a scene whose whole
subject is *visitors* is the one that will render people anyway; a single human
figure makes the banner unusable beside the other 32, and no test can see it.
Keep "no human characters, no people, no human visitors of any kind" verbatim on
any regeneration. The visitors are cartoon dinosaurs, the same way `trading.webp`
staffs its market stall.

> A wide cartoon scene of a busy dinosaur park visitor plaza on a bright open
> day: a paved central concourse running back from a timber entrance arch with
> turnstile gates, a striped gift-shop awning on the left and a picnic lawn
> with chequered blankets and benches on the right, a raised timber viewing
> platform on stilts behind them, a cable gondola strung between two pylons
> overhead, colourful bunting and balloons tied to the lamp posts, a crowd of
> small friendly cartoon dinosaurs of assorted colours strolling the concourse
> in ones and twos, lush palms and ferns beyond the fence line, warm cheerful
> midday daylight. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no lettering, no words,
> no numbers, no signage writing anywhere in the scene, no human characters, no
> people, no human visitors of any kind, no UI elements.

**Dex (`dex.webp`):** generated with model `nano_banana_pro` (the API silently
routes this to `nano_banana_2`) at aspect ratio `3:2`, source output 1264×848,
then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024 WebP q95 —
same pipeline as the rest of this section. Generated with `sell.webp` **and**
`daily.webp` attached as `image` references: `sell.webp` is the closest existing
composition (a warm timber bench of ledger, scale and props) and `daily.webp` is
the banner that already solved this prompt's hardest problem.

**The lettering risk here is the highest in this section**, because the subject
is an open book on a desk pinned with index cards — three surfaces a model will
happily letter. Two defences are load-bearing together, and neither is enough
alone: the objects are described as *blank* and *unlettered* in the positive
part of the prompt (the `daily.webp` "three blank scroll-shaped tags" trick, and
the `collect.webp` "blank chalkboard" fix before it), and the negative clause is
extended with "no handwriting" beyond the usual expanded form. `collect.webp`
rendered a carved "PARK ENTRANCE" sign past a plain "No text" clause; assume the
same of any regeneration that drops either defence.

> A wide cartoon scene of a dinosaur park field-study desk: a heavy
> leather-bound field guide lying open at the centre of a worn timber bench, its
> blank unlettered pages carrying only hand-painted dinosaur portraits and empty
> ruled lines, a brass magnifying glass resting across one page, a corkboard
> behind it pinned with amber specimens, pressed ferns and small blank index
> cards, a short stack of closed volumes and a cup of ink brushes beside the
> guide, a lit brass desk lamp casting warm light from the upper left, jungle
> foliage visible through a window beyond. Glossy cartoon mobile-game art style,
> bold dark outlines, vibrant saturated colors, strong glossy highlights, clean
> cel shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no handwriting, no signage writing anywhere
> in the scene, no human characters, no UI elements.

**Landmark (`landmark.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. Generated with
`help.webp` **and** `leaderboards.webp` attached as `image` references:
`help.webp` carries the carved-monument register and the golden-hour god rays,
`leaderboards.webp` is the only existing banner built around a ceremonial plaza.

**Do not confuse this with `park/landmark-{a,b,c}` further down this file.**
Those three are 270×150 map tiles that `drawLandmark` paints a tier name over
with no scrim, which is why each of them carries a hard contrast requirement and
an explicit dark kerb band baked into the composition. This is a 1536×1024 embed
image with no text drawn over it anywhere, so none of that applies — copying the
"BOTTOM FIFTH is a solid dark slate kerb band" clause across would darken a fifth
of the banner for nothing.

**No inscriptions is the load-bearing clause.** A monument is the single object a
model is most likely to letter — a dedication plaque on the plinth reads as
deliberate and survives casual review. The negative clause names plaques,
dedication inscriptions and carved writing explicitly, on top of the expanded
no-text form used elsewhere in this section, and the column banners are
specified as plain and colored rather than left open to interpretation.

> A wide cartoon scene of a dinosaur park monument plaza at golden hour: a broad
> paved circle ringed by low stone kerbs and clipped hedges, a tall tiered
> pale-stone monument rising at its centre banded with glowing amber inlay and
> topped with a gleaming verdigris-bronze dinosaur silhouette, a shallow
> reflecting pool in front of it catching the light, flanking marble columns hung
> with plain colored banners, a small friendly cartoon dinosaur standing at the
> plaza edge for scale, lush park greenery and distant misty green hills behind,
> warm golden evening light with long soft shadows and gentle god rays. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no plaques, no
> dedication inscriptions or carved writing anywhere on the monument or its base,
> no signage writing anywhere in the scene, no human characters, no UI elements.

**Season (`season.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. The three cloth hangings
stand in for the wet / dry / cold cycle deliberately: the season track rides
the same 30-day rotation the park ground art already renders, so the banner
has to read as "this season" rather than as a generic festival. Generated with
`leaderboards.webp` **and** `achievements.webp` attached as `image`
references: the first carries the ceremonial-plaza bunting and pennant
vocabulary, the second the medal-on-ribbon vocabulary, and the season banner
combines both into one scene.

> **season.webp:** A wide cartoon scene of a dinosaur park season festival
> ground: a tall carved timber totem post in the center hung with a large
> gleaming gold medal on a deep purple ribbon, a row of four wooden reward
> posts stepping up in height beside it, each topped with a small prize — a
> plump coin sack, a glowing crystal shard, a bundle of fresh ferns, a
> speckled egg in straw — strings of colorful triangular pennants running
> between the posts, three large painted cloth hangings behind them showing a
> rain-soaked paddock, a sun-baked golden plain, and a frost-dusted ridge, a
> cheerful cartoon dinosaur looking up at the medal with its head raised, warm
> late-afternoon light with petals drifting through the air. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

A first attempt rendered a plain dollar sign on the coin sack — not signage,
but the same class of stray glyph the `collect.webp` note above warns about.
The prompt above is the intended, load-bearing version; the fix that actually
shipped strengthened "a plump coin sack" to "a plump coin sack with no
markings or symbols on it" and added "no dollar signs, no currency symbols" to
the negative clause. Regenerating from the shorter version risks reproducing
the glyph.

**Duel (`duel.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. The empty benches and
the "sporting rather than violent" clause are deliberate and should survive
any regeneration: `battle_victory.webp` and `battle_defeat.webp` already own
the campaign arena, and a duel stakes nothing but a rating, so this has to
read as an exhibition ground rather than a second war pit.

> **duel.webp:** A wide cartoon scene of a dinosaur park exhibition duelling
> ring at midday: a circular raked sand arena ringed by a low timber fence and
> rows of empty tiered wooden benches, two cartoon dinosaurs squared off across
> the sand facing each other mid-stare — a stocky horned ceratopsian on the
> left digging in a front foot, a lean green theropod on the right crouched low
> with its tail raised — a pair of crossed wooden practice poles planted at the
> ring's edge and a rolled coil of rope beside them, a curl of dust drifting
> between the two, lush palms and a clear blue sky behind, bright even daylight,
> friendly and sporting rather than violent. Glossy cartoon mobile-game art
> style, bold dark outlines, vibrant saturated colors, strong glossy highlights,
> clean cel shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene, no
> human characters, no UI elements.

**Battles (`battles.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. Two constraints on any
regeneration. It must read as the campaign as a WHOLE — a route with stages
still ahead of it, hence the receding chain of cairns and the tiered ridges —
because it replaces a borrow of `sites/coastal_dig-banner`, i.e. the tutorial
site standing in for all seven chapters. And it must not converge on
`battle_victory.webp` / `battle_defeat.webp`, which are single-moment arena
scenes: this is the road to the arena, not the arena.

> **battles.webp:** A wide cartoon scene of the campaign trail leading out of a
> dinosaur park: a rocky canyon pass opening onto a chain of stacked stone
> waypoint cairns marching away into the distance, each cairn topped with a
> small carved dinosaur skull, a heavy timber gate standing open at the near end
> with two crossed wooden shields lashed to its posts, a broad armored
> spike-tailed dinosaur planted at the trailhead in a braced ready stance,
> tiered ridges rising behind one another toward a smoking volcano on the far
> horizon, dramatic late-afternoon light with long shadows and dust hanging in
> the air. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no lettering, no words, no
> numbers, no signage writing anywhere in the scene, no human characters, no UI
> elements.

**Gene Lab (`gene_lab.webp`) and Gene Splice (`gene_splice.webp`):** generated
with model `nano_banana_pro` (the API silently routes this to `nano_banana_2`)
at aspect ratio `3:2`, source output 1264×848, then
`node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024 WebP q95 — same
pipeline as the rest of this section. These two use a painterly key-art phrasing
rather than the shared cartoon style block above; that is deliberate, not a
drift to fix on regeneration — the Gene Lab surfaces are the one part of the
game leaning into a moodier lab aesthetic rather than the bright park-cartoon
look everywhere else.

> **gene_lab.webp:** A bright prehistoric genetics laboratory interior. Tall
> glass incubation tanks glowing warm amber, each holding a dinosaur embryo
> suspended in fluid. Brass fittings, dark timber workbenches, coiled copper
> tubing and analogue dials. Warm cinematic lighting with soft god-rays from
> high windows. Wide establishing shot, painterly digital illustration, rich
> saturated colour, game key art. No text, no lettering, no people.

> **gene_splice.webp:** Extreme close-up of a glowing DNA double helix being
> rewritten inside a crystal vial. One strand segment detaching and a new
> segment sliding into place, trailing violet and gold light. Dark laboratory
> background thrown far out of focus into warm bokeh. Dramatic rim lighting,
> volumetric glow, painterly digital illustration, game key art. No text, no
> lettering, no people.

**World event banners** (`event-<id>.webp`, one per `WORLD_EVENTS` entry in
`src/data/world-events.ts`): generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
1264×848, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. The nine are
deliberately **one park under nine conditions, not nine different places**:
each opens on the same fenced paddocks, timber visitor pavilion and winding
dirt path, and varies only the weather or event. That constraint is what
makes them read as a set on the `/world` hub bulletin rather than nine
unrelated scenes. Every prompt shares the opening "A wide establishing
cartoon view over a lush dinosaur park valley…" and ends with the shared
style block plus the expanded no-text clause used elsewhere in this section.

> **event-clear_skies.webp:** A wide establishing cartoon view over a lush
> dinosaur park valley: the same fenced paddocks, timber visitor pavilion and
> winding dirt path as the rest of the bulletin, under a calm clear day with
> bright even sunlight, a deep blue sky scattered with soft white clouds,
> everything settled and nothing unusual happening. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

> **event-amber_storm.webp:** A wide establishing cartoon view over the same
> lush dinosaur park valley — fenced paddocks, timber visitor pavilion and
> winding dirt path — now lashed by sheets of golden-amber rain slanting
> across the valley, wind bending the ferns hard, canvas dig tarps flapping
> loose, dark churning ochre storm clouds overhead. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

> **event-fossil_rush.webp:** A wide establishing cartoon view over the same
> lush dinosaur park valley — fenced paddocks, timber visitor pavilion and
> winding dirt path — where a collapsed hillside has exposed pale curved
> fossil ribs, a horned skull and vertebrae in layered ochre rock, open
> excavation pits, crates and loose scree scattered around the dig. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no lettering, no words, no numbers, no
> signage writing anywhere in the scene, no human characters, no UI elements.

> **event-heat_wave.webp:** A wide establishing cartoon view over the same
> lush dinosaur park valley — fenced paddocks, timber visitor pavilion and
> winding dirt path — the grass scorched yellow-brown, the ground cracked
> and dusty with visible heat shimmer, dinosaurs crowding into palm shade
> panting, a bleached white-hot sky overhead. Glossy cartoon mobile-game art
> style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset
> look. No text, no lettering, no words, no numbers, no signage writing
> anywhere in the scene, no human characters, no UI elements.

> **event-cold_snap.webp:** A wide establishing cartoon view over the same
> lush dinosaur park valley — fenced paddocks, timber visitor pavilion and
> winding dirt path — every fern and fence rail rimed in frost, frozen
> puddles, stiff silver-green grass, breath vapour in the cold air, a low
> pale winter sun in a washed lilac-blue sky. Glossy cartoon mobile-game art
> style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset
> look. No text, no lettering, no words, no numbers, no signage writing
> anywhere in the scene, no human characters, no UI elements.

> **event-bumper_harvest.webp:** A wide establishing cartoon view over the
> same lush dinosaur park valley — fenced paddocks, timber visitor pavilion
> and winding dirt path — crates spilling glossy greens, fruit and bundled
> hay, stacked barrels and baskets, a laden cart, warm golden late-afternoon
> light over the abundance. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene,
> no human characters, no UI elements.

> **event-market_panic.webp:** A wide establishing cartoon view over the
> same lush dinosaur park valley — fenced paddocks, timber visitor pavilion
> and winding dirt path — market stalls abandoned with sagging awnings,
> crates and cages of unsold goods, gold coins spilled across the dirt, an
> overturned strongbox, flat grey-blue overcast light over the scene. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no lettering, no words, no numbers, no
> signage writing anywhere in the scene, no human characters, no UI elements.

> **event-blood_moon.webp:** A wide establishing cartoon view over the same
> lush dinosaur park valley — fenced paddocks, timber visitor pavilion and
> winding dirt path — under deep night beneath an enormous crimson moon,
> agitated carnivores pressing at the fences with glowing eyes, orange torch
> flames and low mist drifting across the ground. Dark and moody but never
> pure black. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no lettering, no
> words, no numbers, no signage writing anywhere in the scene, no human
> characters, no UI elements.

> **event-migration_season.webp:** A wide establishing cartoon view over the
> same lush dinosaur park valley — fenced paddocks, timber visitor pavilion
> and winding dirt path — the sky filled with pterosaurs wheeling in long
> ribbons, a herd of sauropods crossing the far ridgeline, dust rising off
> the ground, warm golden-hour light over the valley. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no lettering, no words, no numbers, no
> signage writing anywhere in the scene, no human characters, no UI elements.

**Lots (`lots.webp`):** generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source output
2528×1696, then `node scripts/fit-art.mjs banner <src> <dest>` to 1536×1024
WebP q95 — same pipeline as the rest of this section. Generated from a
text-only prompt with no image references, unlike most recent entries in
this section: two referenced variants were attempted, with `landmark.webp`
and `guests.webp` attached — one came back flagged by the safety filter as a
false positive, and the other was not needed once the text-only pair below
proved good — so the shipped image uses no references.

Two candidates were generated from the same prompt; the brighter,
higher-contrast one was chosen. The other skewed orange-purple and read
muddier at embed size.

**The load-bearing negative clause here is construction signage.** A build
site is the scene a model is most likely to letter: site hoardings, safety
signs, notice boards, blueprints with numerals, measurement graduations,
painted numbers on machinery. The prompt names each of those explicitly on
top of the usual no-text form, and requires any board, sign, flag or panel
that appears to be blank or plain-coloured.

The prompt's own "same warm storybook style as the reference images" clause
is vestigial — no references were in fact attached to the shipped
generation. Kept verbatim below rather than tidied out, so a future
regeneration knows the shipped image came from this exact prompt run without
references.

> A wide cartoon scene of a dinosaur park under construction at golden hour,
> painted in the same warm storybook style as the reference images: in the
> foreground a broad dirt build site with surveyor stakes trailing bright
> ribbon, neat stacks of timber and pale stone blocks, a cement mixer and a
> small yellow crane; in the midground two fenced enclosure plots
> part-finished, their heavy timber posts and wire mesh going up, one already
> turfed green with a shallow watering pool; behind them the half-built shell
> of a visitor pavilion in scaffolding, its curved roof beams exposed against
> the sky, canvas tarps lashed to the frame; distant rolling hills and a few
> conifers on the horizon, warm low sun throwing long soft shadows and dusty
> golden light across the whole scene. Friendly, optimistic, hand-painted
> look with soft rounded forms and rich saturated colour. Wide establishing
> composition with clear depth, nothing centred on a single subject.
>
> Absolutely no text of any kind anywhere in the image: no site hoardings, no
> safety signage, no notice boards, no banners with writing, no blueprints or
> plans with visible drawing or numerals, no measurement markings or ruler
> graduations, no painted numbers on machinery, no lettering on crates or
> tarps, no logos, no watermarks, no signatures, no captions, no letters or
> characters of any script. Any board, sign, plan, flag or panel that appears
> must be blank or plain coloured. No people, no human figures.

### Variants (`-v2`, `-v3`, `-v4`)

The ten most-seen banners each carry three variants beside their untouched
base, for thirty files in total: `care`, `collect`, `dino_roster`,
`eggs_incubator`, `shop_food_market`, `sell`, `gene_lab`, `battle_victory`,
`battle_defeat`, `daily`. Every one is an image-edit of **its own committed
banner**, never another banner or another variant, generated with the base
`.webp` attached as the `image_references` medium. Post-processed exactly
like the base: `node scripts/fit-art.mjs banner <src> <dest>` — **no
`remove_background` step**, since this family ships full-bleed opaque scenes,
not cutouts.

What varies is camera angle, time of day, weather and staging — a different
view of the same scene. What must never vary is the subject and its purpose:
`battle_victory` must still read as a win, `care` as feeding, `sell` as a
transaction, and a player must recognise the command from the picture alone
without reading the embed text. The two mood pairs this section documents
above (`care`/`care_neglect`, `battle_victory`/`battle_defeat`) are pairs of
BASE files, not of variants — only `care`, `battle_victory` and
`battle_defeat` were varied here, and each variant was held to its own base's
mood: every `care` variant stays a cheerful, well-fed scene, every
`battle_victory` variant stays triumphant, every `battle_defeat` variant
stays downcast. A cheerful `battle_defeat` variant would have broken the pair
exactly as a cheerful base would have.

Every one of the thirty prompts carries the expanded no-text clause used
elsewhere in this section ("No text, no lettering, no words, no numbers, no
signage writing anywhere in the scene") **and** the `collect.webp`/Founder's
Park CRITICAL block ("CRITICAL: absolutely no writing anywhere in the image —
no letters, no words, no numbers, no carved inscriptions, no painted
signage, no symbols, no logos. Every sign, plaque and surface is blank and
wordless."), applied uniformly rather than only on the banners judged
highest-risk — cheap insurance against the class of failure `collect.webp`'s
own note above documents. Each prompt also names the specific signable prop
it's most likely to letter and states in the positive that it stays blank:
the chalkboard sign on `collect`, the ledger pages on `sell`, the scroll tags
and board on `daily`, the temperature dial and analogue dials on
`eggs_incubator`/`gene_lab`, the banners and pennants on `battle_victory`/
`battle_defeat`, and price tags/labels on `shop_food_market`. **The result
was a clean sweep: all 30 generated accepted on the first attempt, zero
regenerations, zero text leaks** — the first time this section has reported a
0% leak rate on a signage-adjacent batch this size. Recorded here for
whoever generates banners next: applying both defences everywhere, not just
where a scene "looks risky," is what bought that number.

Each prompt follows the same edit-instruction shape as the `care_neglect` /
`battle_defeat` base pairing above: "Keep the exact same scene: [the base's
own held-constant objects, named individually]. Change only the camera angle
and the time of day: [the one specific change]." Held-constant naming, not a
bare "keep it the same," is what keeps the model from drifting the subject
across three sequential edits of one reference.

- **care** — v2: low three-quarter angle close to the ground, warm golden
  late-afternoon light. v3: pulled back to a wide elevated angle showing the
  whole feeding station, bright midday sun. v4: dusk under a soft blue sky,
  lit lanterns along the fence posts.
- **collect** — v2: camera low and close along the counter so the coins loom
  large, soft early-morning light with mist on the path. v3: pulled back to a
  wide elevated angle showing more of the path, bright midday sun. v4: golden
  dusk with a lit lantern beside the cash box.
- **dino_roster** — v2: lower angle looking slightly up along the row for a
  heroic head-count view, warm golden late-afternoon light. v3: wider
  elevated angle showing more of the fence line, soft bright high daylight.
  v4: dusk, lit lanterns along the fence posts, the lineup settling for the
  evening.
- **eggs_incubator** — v2: camera low and close along the row so the nearest
  dome looms large, a warmer amber-orange heat-lamp glow. v3: pulled back to
  a wide elevated angle, a cooler blue-white ambient light mixed with the
  amber. v4: viewed from the opposite end of the bench, one dome in sharp
  foreground focus with the rest blurred, deep late-night dark.
- **shop_food_market** — v2: camera low and close along the counter so the
  baskets and fish loom large, warm golden late-afternoon light. v3: pulled
  back to a wide elevated angle showing the whole stall and awning, bright
  clear midday sun. v4: viewed from the opposite side of the stall (meat side
  foreground), dusk with a lit lantern over the counter.
- **sell** — v2: camera low and close along the counter so the scale and coin
  pouch loom large, warm early-morning light. v3: pulled back to a wide
  elevated angle showing the whole stall and the path behind, bright overhead
  midday sun. v4: dusk, a lit lantern beside the ledger.
- **gene_lab** — v2: lower angle looking up the row of glowing tanks, a
  deeper blue-violet night-shift light mixed with the amber glow. v3: pulled
  back to a wide establishing angle showing more of the workbenches, brighter
  daylight through the high windows. v4: viewed from the opposite end of the
  room, one tank in sharp foreground focus, warm late-evening god-rays.
- **battle_victory** — v2: lower angle looking up at the dinosaur for a more
  heroic pose, bright midday sun. v3: pulled back to a wide elevated angle
  showing more of the arena, warm sunset light. v4: side three-quarter angle,
  the pennants snapping in a stronger breeze.
- **battle_defeat** — v2: lower angle looking up at the lowered head for a
  somber close view, heavier overcast with a light drizzle beginning. v3:
  pulled back to a wide elevated angle showing more of the arena, dim
  late-afternoon overcast light. v4: side three-quarter angle, thick dust and
  mist hanging low, the torn pennants hanging limp.
- **daily** — v2: camera low and close so the lit lantern and hourglass loom
  large, warm golden late-afternoon light. v3: pulled back to a wide elevated
  angle showing more of the path, bright clear midday sun. v4: dusk under a
  soft blue sky, the lantern now lit.

`gene_lab`'s three variants carry forward a carved hieroglyph-style stone
panel visible in the top corners of the committed `gene_lab.webp` base — an
element the base's own prompt in this file never asked for, so it must have
been a model addition on that original generation that shipped anyway. It is
inherited, not introduced: the variant prompts instruct the model to "keep
the exact same laboratory," and the panel is part of that scene now.
Regenerating a `gene_lab` variant will very likely keep reproducing it; that
is expected, not a defect to chase, unless the base itself is ever
regenerated to remove it first.

---

## Battle bosses

Seven boss portraits for the PvE campaign (`/battle`), used as `setThumbnail`
on frames F3/F4 of boss stages. Null-degrade everywhere: the campaign ships
fully playable with zero battle art.

| File | Size | Use |
|---|---|---|
| `assets/images/battles/boss-coastal_dig-portrait.webp` | 1024×1024, transparent | Old Riptooth (Baryonyx), Coastal Dig boss frames |
| `assets/images/battles/boss-amber_ridge-portrait.webp` | 1024×1024, transparent | Ridgeback Alpha (Allosaurus), Amber Ridge boss frames |
| `assets/images/battles/boss-frozen_cliffs-portrait.webp` | 1024×1024, transparent | Stormwing (Quetzalcoatlus), Frozen Cliffs boss frames |
| `assets/images/battles/boss-volcano_core-portrait.webp` | 1024×1024, transparent | The Tyrant King (Tyrannosaurus), Volcano Core boss frames |
| `assets/images/battles/boss-abyssal_trench-portrait.webp` | 1024×1024, transparent | The Trench Sovereign (Mosasaurus), Abyssal Trench boss frames |
| `assets/images/battles/boss-containment_site-portrait.webp` | 1024×1024, transparent | Asset 47 (Spinoraptor), Containment Site boss frames |
| `assets/images/battles/boss-founders_park-portrait.webp` | 1024×1024, transparent | Ultimasaurus (The Last Asset), Founder's Park boss frames |

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the dinosaur silhouette — off-silhouette glow survives
background removal as floating islands or a light halo on transparency.
Emissive detail is allowed only ON surfaces (lava cracks, frost sheen, wet
scales). Every prompt carries this rule verbatim.

**Workflow (reference chain):** generate the coastal portrait first on a
plain flat light-gray studio background, head-and-shoulders three-quarter
framing filling the square with a small even margin. Generate the next three
— `amber_ridge`, `frozen_cliffs`, and `volcano_core` — as image-edits of the
approved coastal portrait (Nano Banana Pro, `medias` role `image`) so pose,
framing, and rendering read as a set — all three edit from the coastal
portrait directly, never from each other. The remaining three —
`abyssal_trench`, `containment_site`, and `founders_park`, all shipped later
— are generated as standalone prompts instead, not image-edits of the
coastal reference (see their own bullets below). Post-process each with
`remove_background`, then `node scripts/fit-art.mjs portrait <src> <dest>` —
the whole-bbox variant (there is no egg axis to bias toward, so omit
`--axis=egg`, which applies only to the eggs): 24px margin on a 1024×1024
transparent canvas — the margin all seven committed portraits measure at.

**boss-coastal_dig — Old Riptooth (reference portrait):**

> A fierce cartoon Baryonyx boss portrait, head and shoulders in three-quarter
> view, long crocodile-like snout with a jagged toothy snarl, teal-and-sand
> scales with a wet glossy sea-spray sheen and a ragged old scar across the
> snout. The dinosaur fills almost the entire square frame with a small even
> margin. Plain flat light-gray studio background, no scenery, no ground
> shadow. No glow, rays, embers, sparkles, or light effects extending beyond
> the dinosaur silhouette; glowing details may appear only on the surfaces
> themselves. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no human characters,
> no UI elements.

**Portrait edits** (each generated with the coastal portrait attached as the
`image` reference). Prompt frame:

> Keep the exact same head-and-shoulders boss portrait: same pose, same
> framing, same plain flat light-gray studio background. Change the dinosaur
> to {BOSS}. No glow, rays, embers, sparkles, or light effects extending
> beyond the dinosaur silhouette; glowing details may appear only on the
> surfaces themselves. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no human
> characters, no UI elements.

`{BOSS}` per portrait:

- **boss-amber_ridge — Ridgeback Alpha:** a battle-scarred cartoon
  Allosaurus with honey-orange and sandstone-brown scales, twin brow horns,
  an amber-gold eye, and warm sunset-toned glossy highlights.
- **boss-frozen_cliffs — Stormwing:** a towering cartoon Quetzalcoatlus with
  pale ice-blue and white plumage, a long crested head, frost sheen gleaming
  on the beak surface, and one folded wing shoulder visible. The first
  generation attempt drifted off-model against the other three bosses in that
  reference-chain batch (coastal_dig, amber_ridge, volcano_core) — thin
  light blue-grey outlines and washed-out fills instead of matching bold
  near-black linework and saturated color — so the icy palette is not enough
  on its own; insert this before the no-glow sentence: "Every outline on the
  dinosaur — crest, beak, feather edges, wing, neck — must be drawn in bold,
  thick, near-black ink, the same weight and darkness as a classic
  comic-book cel-shaded character; do not lighten, thin, or recolor the
  outlines to blue-grey just because the subject is icy — the linework stays
  bold and near-black regardless of the pale color underneath, exactly like
  the outline weight on the reference portrait. The color fills stay vibrant
  and richly saturated, not washed out, pastel, or desaturated by the cold
  palette — deep ice-blue and clean white, with strong glossy highlights and
  clean cel-shaded gradients, not a flat muted look."

  The regeneration above (correct on outline weight and saturation) still
  came back facing left, mirrored against the other three bosses in that same
  batch, which all face right — snout/beak pointing right — matching the
  coastal_dig reference. Rather than risk losing the now-approved
  outline/saturation fix on a third generation, the committed
  `boss-frozen_cliffs-portrait.webp` is that same approved asset horizontally
  flipped in post (alpha-preserving, 1024×1024 dimensions unchanged) to
  restore right-facing orientation. A future regeneration from this prompt is
  not guaranteed to land right-facing either — check orientation against the
  other six committed portraits before shipping,
  and either add an explicit "facing right, mirroring the reference
  portrait's profile direction" clause to the prompt or re-apply the same
  horizontal-flip post-process.
- **boss-volcano_core — The Tyrant King:** a colossal cartoon Tyrannosaurus
  with jet-black obsidian-dark scales veined by glowing orange lava-crack
  markings on the scale surfaces only, an ember-orange eye, and a roaring
  open jaw.

**boss-abyssal_trench — The Trench Sovereign (Mosasaurus):** generated as a
standalone prompt (not an image-edit of the coastal reference), background
removed, fitted to a 24px margin. The generated source faced left — this
prompt states no facing direction, and with no reference image attached
there was nothing to inherit the house right-facing convention from — so the
committed file is that same generation horizontally flipped in post to face
right, matching every other boss portrait. A future regeneration from this
prompt is not guaranteed to land right-facing either; check orientation
against the other bosses before shipping, and either flip in post again or
add an explicit "facing right" clause to the prompt.

> A fierce cartoon Mosasaurus boss portrait, head and shoulders in three-quarter
> view, massive blunt reptilian skull with a jagged toothy snarl, deep-blue scales
> over a pale cream underbelly, wet glossy sheen with seawater sheeting off the hide,
> pale cyan bioluminescent speckling along the jawline, one old pale scar across the
> brow. The complete head and shoulders sit fully inside the image with an even
> margin of empty background on all four sides, nothing touching or cropped by any
> edge. Plain flat light-gray studio background, completely empty, no scenery, no
> ground shadow, no drawn border, no frame, no panel edge, no letterboxing. No glow,
> rays, embers, sparkles, or light effects extending beyond the creature silhouette;
> glowing details may appear only on the surfaces themselves. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset look. No
> text, no numbers, no lettering, no human characters, no UI elements.

**boss-containment_site — Asset 47 (Spinoraptor):** generated as a standalone
prompt (not an image-edit of the coastal reference), background removed,
fitted to a 24px margin.

> A fierce cartoon hybrid dinosaur boss portrait, head and shoulders in three-quarter
> view, a raptor's narrow toothy skull with a tall spined sail rising behind the
> shoulders, charcoal-black and acid-yellow banded scales with a wet glossy sheen,
> old surgical scarring along the jaw, a small blank unmarked metal tag clipped to
> the neck, snarling with intelligent menace. The complete head, neck and sail sit
> fully inside the image with an even margin of empty background on all four sides,
> nothing touching or cropped by any edge. Plain flat light-gray studio background,
> completely empty, no scenery, no ground shadow, no drawn border, no frame, no panel
> edge, no letterboxing. No glow, rays, embers, sparkles, or light effects extending
> beyond the creature silhouette; glowing details may appear only on the surfaces
> themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no numbers, no lettering, no human
> characters, no UI elements.

**Two prompt clauses worth keeping for any future portrait.** The first pass
of both portraits above failed for reasons the existing prompt frame did not
cover, and these two clauses are what fixed them:

- **"no drawn border, no frame, no panel edge"** — the first Mosasaurus came
  back with a painted rectangular border around the whole image. On a
  portrait destined for background removal that is fatal: the frame survives
  matting, and a largest-connected-region step can keep the frame and discard
  the animal.
- **"no text, no numbers, no lettering"** — the first Spinoraptor rendered a
  legible "#042" on its neck tag, which both violates the no-text house rule
  and contradicts the boss's name, Asset 47.

**boss-founders_park — Ultimasaurus, "The Last Asset":** generated as a
standalone prompt (not an image-edit of the coastal reference), background
removed, fitted to a **24px margin** — the same margin as the other six
portraits (`assets/images/battles/`), and deliberately not `fit-art.mjs
cutout`'s 31px (see the divergence table in Egg rarities above).

> A fierce cartoon hybrid dinosaur boss portrait, head and shoulders in
> three-quarter view, a massive armored apex predator with a broad heavy
> skull, thick bony plating across the brow and cheeks, blunt horns ridging
> the jawline, overlapping armor scutes running down the neck and shoulders,
> deep slate-gray and burnished bronze banded hide with a wet glossy sheen,
> old battle scarring across the plates, a small blank unmarked metal tag
> clipped to the neck, snarling with cold engineered menace. CRITICAL
> FRAMING: zoom out so the ENTIRE creature — the whole head, the full neck,
> and both complete shoulders — sits well inside the frame, small in the
> canvas, surrounded by a wide band of empty background on all four sides.
> Nothing may touch, run off, or be cropped by any edge of the image,
> especially the bottom and right edges. Plain flat light-gray studio
> background, completely empty, no scenery, no ground shadow, no drawn
> border, no frame, no panel edge, no letterboxing. No glow, rays, embers,
> sparkles, or light effects extending beyond the creature silhouette.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no numbers, no lettering, no
> human characters, no UI elements.

Note for future regeneration: the first attempt cropped the creature at both
the bottom and right edges of the canvas — the existing prompt frame's
generic "fills almost the entire square frame" language was not enough to
stop it here, since this design (armor plating across broad shoulders) reads
larger in frame than the reference poses. The CRITICAL FRAMING block above
(zoom out, whole creature inside the frame, explicit "especially the bottom
and right edges") is what fixed it. The shipped portrait's alpha bounding box
still touches the bottom of its own source canvas before fitting — that is
expected, matches the shipped `boss-containment_site-portrait.webp` (also cut
flat at the bottom), and is not something to "fix" by re-cropping.

## Dino archetypes

Eight generic dinosaur portraits keyed on `archetype × diet`, used as
`setThumbnail` on the `hatch:crack` reveal and on every frame of a **non-boss**
battle stage (the lead enemy `rosterFor` fields). Keying on the pair rather than
on the species fixes the art cost at eight files forever: a new species picks up
existing art by declaring fields it already has to declare. Null-degrade
everywhere, like every other family here.

| File | Size | Use |
|---|---|---|
| `assets/images/dinos/bruiser-herbivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/bruiser-carnivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/tank-herbivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/tank-carnivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/swift-herbivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/swift-carnivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/support-herbivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/support-carnivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |

`<archetype>` is one of `bruiser`, `tank`, `swift`, `support`; `<diet>` is
`herbivore` or `carnivore`. `support-carnivore` shipped with no species using
it and was generated anyway — the guarantee is that adding a species never
needs new art. Archelon (uncommon, support archetype, carnivore diet) now
uses it, and needed no new art at all.

**Fidelity cost of the fixed set:** `archetype` is a combat concept, not a
body-plan one, so the guarantee above buys loose anatomical fidelity for
outliers. `swift-carnivore` covers both `velociraptor` and `quetzalcoatlus` —
a beaked pterosaur — and the shared portrait is a scaled toothy theropod, not
anything pterosaur-shaped. Accepted deliberately, not an oversight: a
per-species `silhouette` field was considered and declined, since it would
have traded eight images for roughly twelve plus a migration across all 52
species files, to fix fidelity for a handful of outliers like this one.

**Style: deliberately simpler than the seven boss portraits.** Same house
glossy-cartoon treatment and the same head-and-shoulders three-quarter framing,
but flatter: clean archetype silhouettes, no scarring, no individuating damage,
no character detail. These land in the same thumbnail slot as the boss portraits
and sometimes in the same command — a boss must read as a named individual,
these must read as a *kind*.

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the dinosaur silhouette — off-silhouette glow survives background
removal as floating islands or a light halo on transparency. Emissive detail is
allowed only ON surfaces. Every prompt carries this rule verbatim.

**Facing right:** all seven committed boss portraits face right, snout pointing
right, and two boss generations came back mirrored and had to be flipped in
post (Frozen Cliffs and Abyssal Trench — see Battle bosses). The prompt frame
below states the direction up front — still check every generation against
the reference before shipping it.

**Workflow (reference chain):** all eight are generated as image-edits of the
committed `assets/images/battles/boss-coastal_dig-portrait.webp` (Nano Banana
Pro, `medias` role `image`) — every one edits from that portrait directly, never
from another dino, so the set matches the bosses' pose, framing, and rendering.
That portrait is already background-removed, which is why the prompt frame
re-states the plain flat light-gray studio background. Post-process each with
`remove_background`, then
`node scripts/fit-art.mjs cutout <src> assets/images/dinos/<archetype>-<diet>.webp`.

**Margin divergence, accepted deliberately:** `fit-art.mjs cutout` fits at 31px
(0.94); the boss portraits sit at 24px from the one-off pass described in Egg
rarities. The two families never appear in the same embed — a boss stage
suppresses the archetype art and shows the portrait instead — so the difference
is only ever visible across successive frames of one fight. That is not worth a
second one-off pass or a `--fit` flag; it is recorded in the divergence table in
Egg rarities so it is a choice, not a third undocumented margin.

**Prompt frame** (each generated with `boss-coastal_dig-portrait` attached as the
`image` reference):

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the dinosaur to
> {DINO}. Render it as a generic species type rather than a named individual:
> clean unblemished hide, no scars, no chipped teeth, no torn frills, no battle
> damage, no distinguishing marks, and flatter, calmer detail than a boss
> portrait — a simple readable silhouette. No glow, rays, embers, sparkles, or
> light effects extending beyond the dinosaur silhouette; glowing details may
> appear only on the surfaces themselves. Glossy cartoon mobile-game art style,
> bold dark outlines, vibrant saturated colors, strong glossy highlights, clean
> cel shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene, no
> human characters, no UI elements.

`{DINO}` per file:

- **`bruiser-carnivore.webp`:** a heavy-set cartoon theropod predator with a
  sturdy thick-boned head, a thick muscular neck, short sturdy forelimbs, a
  closed jaw with teeth mostly hidden, smooth low-texture scales, and
  crimson-and-charcoal coloring.
- **`bruiser-herbivore.webp`:** a stocky cartoon plant-eating dinosaur with a
  sturdy thick-boned head, broad shoulders, a blunt beaked snout, a heavy jaw,
  and olive-green scales with a sandy underside.
- **`tank-carnivore.webp`:** a heavily built cartoon carnivore with a broad
  blunt snout, a thick armored-looking jawline, deep-blue and slate scales, a
  pale underside, and a smooth glossy sheen.
- **`tank-herbivore.webp`:** a heavily built, thick-necked cartoon herbivore
  with a sturdy blunt-featured head, tough thick hide, powerful shoulders,
  small watchful eyes, and earthy brown and moss-green coloring.
- **`swift-carnivore.webp`:** a lean, fast-built cartoon carnivore with an
  alert forward-set eye, a closed jaw with teeth mostly hidden, a slender
  agile build, and teal-and-amber striped scales.
- **`swift-herbivore.webp`:** a slender, quick-footed cartoon herbivore with a
  small beaked head, a large alert eye, a light nimble build, and pale tan
  plumage with a warm cream underside.
- **`support-herbivore.webp`:** a gentle cartoon herbivore with a blunt grazing
  beak, calm watchful eyes, a rounded approachable face, and warm honey-yellow
  and turquoise scales.
- **`support-carnivore.webp`:** a compact cartoon carnivore with an alert slim
  head, a sharp predatory bite, wide watchful eyes, and violet-and-teal scales
  that read as a clever pack helper rather than a brute.

## Hero species portraits

Eight per-species portraits for the rarest species in the roster — the five
legendaries and the three mythics — resolved by `dinoImage`
(`src/core/images.ts`) ahead of the archetype art, and used at every surface
that shows one dino: the `/dex view` entry thumbnail, the `hatch:crack` reveal
thumbnail, the featured dino on the park card, the duel lead, and the non-boss
battle thumbnail.

| File | Size | Use |
|---|---|---|
| `assets/images/dinos/tyrannosaurus.webp` | 1024×1024, transparent | per-species override for `dinos/bruiser-carnivore.webp` |
| `assets/images/dinos/spinoraptor.webp` | 1024×1024, transparent | per-species override for `dinos/bruiser-carnivore.webp` |
| `assets/images/dinos/liopleurodon.webp` | 1024×1024, transparent | per-species override for `dinos/bruiser-carnivore.webp` |
| `assets/images/dinos/indominus.webp` | 1024×1024, transparent | per-species override for `dinos/bruiser-carnivore.webp` |
| `assets/images/dinos/mosasaurus.webp` | 1024×1024, transparent | per-species override for `dinos/tank-carnivore.webp` |
| `assets/images/dinos/ultimasaurus.webp` | 1024×1024, transparent | per-species override for `dinos/tank-carnivore.webp` |
| `assets/images/dinos/quetzalcoatlus.webp` | 1024×1024, transparent | per-species override for `dinos/swift-carnivore.webp` |
| `assets/images/dinos/indoraptor.webp` | 1024×1024, transparent | per-species override for `dinos/swift-carnivore.webp` |

**Override, never replacement.** `dinoImage(speciesId, archetype, diet)` tries
`dinos/<speciesId>.webp` first and falls back to `dinos/<archetype>-<diet>.webp`,
so a species with no file of its own keeps the shared archetype art and adding a
species stays a data-only change. That sentence used to read "the other 44
species keep the shared archetype art", which was true when these eight were the
only per-species files in the repo and is not any more: the Species portraits
section below shipped 43 of those 44, leaving `deinosuchus` the sole species
still resolving to archetype art. The mechanism is what matters and has not
changed — the count moves every time a portrait lands, so do not write one here. Deleting any one of these eight files restores that species'
archetype art with no code change and no error — the same null-degrade every
family here relies on.

**Rim light: a HARD SPECULAR EDGE on the silhouette, never a soft outer glow.**
This is the one prompt constraint that can silently produce an asset *worse* than
the stand-in it replaces. `remove_background` cuts on alpha: a soft outer glow is
either eaten whole by the matte, leaving a portrait that reads as flatter than
the archetype art beside it, or it survives as a pale halo ringing the animal on
transparency — which reads as a rendering fault at 80px thumbnail size, in both
Discord themes. The rim must sit ON the creature's own edge pixels, crisp, with
no bloom, no feathering and no falloff into the background.

- **Legendary rim: warm gold `#f1c40f`** — `tyrannosaurus`, `spinoraptor`,
  `liopleurodon`, `mosasaurus`, `quetzalcoatlus`. This is exactly
  `RARITY_COLOR.legendary` (`src/modules/hatchery/embeds.ts`), so the rim and the
  reveal embed's side bar agree.
- **Mythic rim: violet `#8e44ad`** — `indominus`, `indoraptor`, `ultimasaurus`.
  Violet deliberately does **not** match `RARITY_COLOR.mythic` (`0xe74c3c`, red).
  A red rim on Indominus' pale bone hide and on Indoraptor's black-and-gold reads
  as blood or damage; violet reads as engineered, which is what the mythic tier
  is. Do not "correct" this to the embed color.

**Hard no-glow rule** (inherited verbatim from Dino archetypes, and it is not in
tension with the rim light above — a rim is on-silhouette, a glow is off-it): no
glow, rays, embers, sparkles, or light effects may extend beyond the dinosaur
silhouette. Emissive detail is allowed only ON surfaces. Every prompt below
carries both rules.

**Margin: 31px — `node scripts/fit-art.mjs cutout`, never `portrait`'s 24px.**
These render beside the archetype art in the same embeds, so they
must match that family, not `assets/images/battles/`. The divergence between the
two families is recorded in the table in Egg rarities; this set sits on the
`fit-art.mjs` side of it. `tests/images.test.ts` asserts the fitted margin to
±1px per file.

**Facing right:** like all seven boss portraits and all eight archetype cutouts,
snout pointing right. Two boss generations came back mirrored and had to be
flipped in post — check every generation against its reference before shipping.

**Workflow (reference chain):** each hero portrait is generated as an image-edit
of **the archetype cutout that species currently shares** (Nano Banana Pro,
`medias` role `image`) — the strongest available style lock, because the stand-in
is precisely the image the new file replaces, so pose, camera, scale in frame and
rendering all carry over for free. Post-process each with `remove_background`,
then
`node scripts/fit-art.mjs cutout <src> assets/images/dinos/<speciesId>.webp`.

| Target | Reference attached as `image` |
|---|---|
| `dinos/tyrannosaurus.webp` | `assets/images/dinos/bruiser-carnivore.webp` |
| `dinos/spinoraptor.webp` | `assets/images/dinos/bruiser-carnivore.webp` |
| `dinos/liopleurodon.webp` | `assets/images/dinos/bruiser-carnivore.webp` |
| `dinos/indominus.webp` | `assets/images/dinos/bruiser-carnivore.webp` |
| `dinos/mosasaurus.webp` | `assets/images/dinos/tank-carnivore.webp` |
| `dinos/ultimasaurus.webp` | `assets/images/dinos/tank-carnivore.webp` |
| `dinos/quetzalcoatlus.webp` | `assets/images/dinos/swift-carnivore.webp` |
| `dinos/indoraptor.webp` | `assets/images/dinos/swift-carnivore.webp` |

**Species, not individual, and not a kind either.** The archetype set reads as a
*kind* (clean, unblemished, flat); the boss portraits read as a named
*individual* (scarred, chipped, damaged). These sit between: individuating
species detail — a real skull shape, real coloring, real body plan — but no
scars, no chipped teeth, no torn frills, no battle damage. Scarring stays
reserved for `assets/images/battles/`.

**Two stand-ins are anatomically wrong, and correcting them is a large part of
why this set exists.** `liopleurodon` is a short-necked marine pliosaur currently
rendered as a heavy toothy land theropod, and `quetzalcoatlus` is a toothless
azhdarchid pterosaur currently rendered as a lean toothy land theropod. Their
prompts below say so explicitly and instruct the model to replace the entire body
plan rather than restyle the reference — an edit prompt that only adds color to a
theropod will happily keep the theropod.

**Silhouettes that grow past the reference: `spinoraptor`'s sail,
`quetzalcoatlus`' crest and neck, `ultimasaurus`' shoulder plating.** These three
read larger in frame than the archetype poses they edit from, and that is exactly
how `boss-founders_park` came back cropped at the bottom and right edges on its
first attempt. All three prompts below therefore carry the CRITICAL FRAMING block
from Battle bosses. If a generation still touches an edge, regenerate rather than
re-cropping.

### tyrannosaurus (dinos/tyrannosaurus.webp)

Reference: `assets/images/dinos/bruiser-carnivore.webp`. Rim: gold `#f1c40f`.

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the dinosaur to
> a massive cartoon Tyrannosaurus rex with a deep boxy skull, heavy brow ridges
> over small forward-set eyes, thick jaw muscles, banded teeth showing at the lip
> line, a powerfully corded neck, tiny two-fingered forelimbs, and coarse pebbled
> hide in deep crimson over charcoal with a paler bone-white throat. Render it as
> a specific species with individuating detail, but with clean unblemished hide:
> no scars, no chipped teeth, no battle damage. Add a hard specular rim light
> along the silhouette edge only — a crisp warm gold #f1c40f highlight sitting
> tight on the creature's outline, like a sharp light source directly behind it.
> The rim must stay ON the animal's own edge; it must not bleed, feather, bloom
> or halo outward into the background, and there must be no soft glow of any kind
> around the silhouette. No glow, rays, embers, sparkles, or light effects
> extending beyond the dinosaur silhouette; glowing details may appear only on
> the surfaces themselves. Plain flat light-gray studio background, completely
> empty, no drawn border, no frame, no panel edge, no letterboxing. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

### spinoraptor (dinos/spinoraptor.webp)

Reference: `assets/images/dinos/bruiser-carnivore.webp`. Rim: gold `#f1c40f`.
Carries the CRITICAL FRAMING block — the sail runs well above the reference's
shoulder line.

> Keep the exact same head-and-shoulders three-quarter portrait camera angle and
> facing as the reference image: facing right with the snout pointing right, on a
> plain flat light-gray studio background with no scenery and no ground shadow.
> Change the dinosaur to a cartoon hybrid theropod — a raptor's narrow alert head
> and sickle-clawed forelimbs carried on a heavy spinosaur frame, with a long
> crocodilian snout of interlocking conical teeth, a high forward-set eye, and a
> tall ridged skin sail rising from the shoulders and back — coloured in olive
> and rust striping with the sail membrane in warm translucent amber. Render it
> as a specific species with individuating detail, but with clean unblemished
> hide: no scars, no chipped teeth, no torn sail, no battle damage. Add a hard
> specular rim light along the silhouette edge only — a crisp warm gold #f1c40f
> highlight sitting tight on the creature's outline, including the top edge of
> the sail, like a sharp light source directly behind it. The rim must stay ON
> the animal's own edge; it must not bleed, feather, bloom or halo outward into
> the background, and there must be no soft glow of any kind around the
> silhouette. No glow, rays, embers, sparkles, or light effects extending beyond
> the dinosaur silhouette; glowing details may appear only on the surfaces
> themselves. CRITICAL FRAMING: zoom out so the ENTIRE creature — the whole head,
> the full neck, the complete sail and both shoulders — sits well inside the
> frame, small in the canvas, surrounded by a wide band of empty background on
> all four sides. Nothing may touch, run off, or be cropped by any edge of the
> image, especially the top and bottom edges. Plain flat light-gray studio
> background, completely empty, no drawn border, no frame, no panel edge, no
> letterboxing. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no lettering, no words, no
> numbers, no signage writing anywhere in the scene, no human characters, no UI
> elements.

### liopleurodon (dinos/liopleurodon.webp)

Reference: `assets/images/dinos/bruiser-carnivore.webp`. Rim: gold `#f1c40f`.
**Anatomy correction — the reference is the wrong animal.** Liopleurodon is a
short-necked marine pliosaur: four broad paddle flippers, no hind legs, no
upright bipedal stance, no theropod skull. The stand-in is a land theropod, so
the prompt replaces the body plan outright rather than restyling it.

> Keep only the camera angle, the scale in frame, the small even margin and the
> facing of the reference image — head and forequarters in three-quarter view,
> facing right with the snout pointing right, on a plain flat light-gray studio
> background with no scenery and no ground shadow. The animal in the reference is
> a land theropod and is the WRONG animal: replace the entire body plan. Do not
> keep the hind legs, do not keep the upright bipedal stance, do not keep the
> theropod skull. Draw instead a cartoon Liopleurodon — a short-necked marine
> pliosaur with an enormous elongated crocodile-like skull that is nearly a
> quarter of its whole body, a jaw of long interlocking fangs, a thick short
> muscular neck running straight into a broad torpedo-shaped body, and four wide
> flat paddle flippers with no toes and no claws, the leading front flipper
> sweeping into frame. Smooth wet rubbery hide with no scales and no feathers,
> countershaded deep marine blue over a pale silver belly, with a wet glossy
> sheen. Render it as a specific species with individuating detail, but with
> clean unblemished hide: no scars, no chipped teeth, no battle damage. Add a
> hard specular rim light along the silhouette edge only — a crisp warm gold
> #f1c40f highlight sitting tight on the creature's outline, like a sharp light
> source directly behind it. The rim must stay ON the animal's own edge; it must
> not bleed, feather, bloom or halo outward into the background, and there must
> be no soft glow of any kind around the silhouette. No water, no waves, no
> spray, no bubbles, no underwater caustics — the background stays an empty flat
> studio gray. No glow, rays, embers, sparkles, or light effects extending beyond
> the creature silhouette; glowing details may appear only on the surfaces
> themselves. Plain flat light-gray studio background, completely empty, no drawn
> border, no frame, no panel edge, no letterboxing. Glossy cartoon mobile-game
> art style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset look.
> No text, no lettering, no words, no numbers, no signage writing anywhere in the
> scene, no human characters, no UI elements.

### mosasaurus (dinos/mosasaurus.webp)

Reference: `assets/images/dinos/tank-carnivore.webp`. Rim: gold `#f1c40f`. The
stand-in's broad blunt snout is already the right general read, so this is a
restyle rather than a body-plan replacement — but the flippers are new and must
be stated.

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the animal to a
> cartoon Mosasaurus — a huge marine lizard with a long streamlined body, a broad
> wedge-shaped skull, a heavy lower jaw and a double row of conical teeth, a
> forked flicking tongue, small high-set eyes, keeled scales ridging the back of
> the neck, and short broad paddle flippers rather than clawed legs, with the
> leading flipper visible at the lower edge of the portrait. Slate and deep teal
> countershading over a cream belly, with a wet glossy sheen. Render it as a
> specific species with individuating detail, but with clean unblemished hide: no
> scars, no chipped teeth, no battle damage. Add a hard specular rim light along
> the silhouette edge only — a crisp warm gold #f1c40f highlight sitting tight on
> the creature's outline, like a sharp light source directly behind it. The rim
> must stay ON the animal's own edge; it must not bleed, feather, bloom or halo
> outward into the background, and there must be no soft glow of any kind around
> the silhouette. No water, no waves, no spray, no bubbles, no underwater
> caustics — the background stays an empty flat studio gray. No glow, rays,
> embers, sparkles, or light effects extending beyond the creature silhouette;
> glowing details may appear only on the surfaces themselves. Plain flat
> light-gray studio background, completely empty, no drawn border, no frame, no
> panel edge, no letterboxing. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel shading
> with smooth gradients, polished game-asset look. No text, no lettering, no
> words, no numbers, no signage writing anywhere in the scene, no human
> characters, no UI elements.

### quetzalcoatlus (dinos/quetzalcoatlus.webp)

Reference: `assets/images/dinos/swift-carnivore.webp`. Rim: gold `#f1c40f`.
**Anatomy correction — the reference is the wrong animal.** Quetzalcoatlus is a
toothless azhdarchid pterosaur; the stand-in is a lean toothy theropod, and
`## Dino archetypes` above already records that mismatch as an accepted cost of
the fixed set. This file is what pays it off. Carries the CRITICAL FRAMING block
— the crest and the long neck both run past the reference's silhouette.

> Keep only the camera angle, the scale in frame, the small even margin and the
> facing of the reference image — head-and-shoulders three-quarter view, facing
> right with the beak pointing right, on a plain flat light-gray studio
> background with no scenery and no ground shadow. The animal in the reference is
> a toothy land theropod and is the WRONG animal: replace the entire body plan.
> Draw instead a cartoon Quetzalcoatlus, a giant azhdarchid pterosaur — a long
> straight spear-like beak that is completely TOOTHLESS with smooth clean jaw
> edges, a tall backswept blade-shaped head crest, a very long stiff upright
> neck, a small compact body covered in short fuzzy pycnofibres rather than
> scales, and a membranous wing folded at the shoulder with the wing finger
> visible as a long spar. No teeth anywhere, no scaly theropod snout, no clawed
> theropod forelimbs, no feathered wings. Pale bone-white and slate colouring
> with a warm coral crest and a dark eye stripe. Render it as a specific species
> with individuating detail, but with clean unblemished hide: no scars, no torn
> wing membrane, no battle damage. Add a hard specular rim light along the
> silhouette edge only — a crisp warm gold #f1c40f highlight sitting tight on the
> creature's outline, including the crest and the beak, like a sharp light source
> directly behind it. The rim must stay ON the animal's own edge; it must not
> bleed, feather, bloom or halo outward into the background, and there must be no
> soft glow of any kind around the silhouette. No glow, rays, embers, sparkles,
> or light effects extending beyond the creature silhouette; glowing details may
> appear only on the surfaces themselves. CRITICAL FRAMING: zoom out so the
> ENTIRE creature — the whole beak, the full crest, the complete neck and both
> shoulders — sits well inside the frame, small in the canvas, surrounded by a
> wide band of empty background on all four sides. Nothing may touch, run off, or
> be cropped by any edge of the image, especially the top and right edges. Plain
> flat light-gray studio background, completely empty, no drawn border, no frame,
> no panel edge, no letterboxing. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel shading
> with smooth gradients, polished game-asset look. No text, no lettering, no
> words, no numbers, no signage writing anywhere in the scene, no human
> characters, no UI elements.

### indominus (dinos/indominus.webp)

Reference: `assets/images/dinos/bruiser-carnivore.webp`. Rim: violet `#8e44ad`.
This is the file the release exists for: a player pulling a Mythic Indominus
currently sees the same red bruiser bust as a common-tier roll.

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the dinosaur to
> a cartoon Indominus rex — a large engineered hybrid theropod with pale
> bone-white hide, knobbly osteoderm ridges running along the skull and down the
> neck, a heavy elongated jaw with irregular oversized teeth, long clawed
> three-fingered forelimbs, and cold amber-red eyes with narrow slit pupils, with
> faint darker grey mottling breaking up the white. It must read as calm,
> intelligent and unnatural rather than raging. Render it as a specific species
> with individuating detail, but with clean unblemished hide: no scars, no
> chipped teeth, no battle damage. Add a hard specular rim light along the
> silhouette edge only — a crisp violet #8e44ad highlight sitting tight on the
> creature's outline, like a sharp light source directly behind it. The rim must
> stay ON the animal's own edge; it must not bleed, feather, bloom or halo
> outward into the background, and there must be no soft glow of any kind around
> the silhouette. No glow, rays, embers, sparkles, or light effects extending
> beyond the dinosaur silhouette; glowing details may appear only on the surfaces
> themselves. Plain flat light-gray studio background, completely empty, no drawn
> border, no frame, no panel edge, no letterboxing. Glossy cartoon mobile-game
> art style, bold dark outlines, vibrant saturated colors, strong glossy
> highlights, clean cel shading with smooth gradients, polished game-asset look.
> No text, no lettering, no words, no numbers, no signage writing anywhere in the
> scene, no human characters, no UI elements.

### indoraptor (dinos/indoraptor.webp)

Reference: `assets/images/dinos/swift-carnivore.webp`. Rim: violet `#8e44ad`.

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the dinosaur to
> a cartoon Indoraptor — a lean engineered raptor-form hybrid with glossy jet
> black hide, a single sharp gold stripe running from behind the eye down the
> neck and flank, a narrow elongated skull with a low brow, a high forward-set
> eye with a pale yellow iris and a slit pupil, hooked forelimb claws, and a
> low-slung sinuous predatory posture. It must read as sly and malicious rather
> than brutish. Render it as a specific species with individuating detail, but
> with clean unblemished hide: no scars, no chipped teeth, no battle damage. Add
> a hard specular rim light along the silhouette edge only — a crisp violet
> #8e44ad highlight sitting tight on the creature's outline, like a sharp light
> source directly behind it. The rim must stay ON the animal's own edge; it must
> not bleed, feather, bloom or halo outward into the background, and there must
> be no soft glow of any kind around the silhouette. The rim is the only thing
> separating a black animal from the background — keep it crisp and unbroken
> along the whole outline. No glow, rays, embers, sparkles, or light effects
> extending beyond the dinosaur silhouette; glowing details may appear only on
> the surfaces themselves. Plain flat light-gray studio background, completely
> empty, no drawn border, no frame, no panel edge, no letterboxing. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

### ultimasaurus (dinos/ultimasaurus.webp)

Reference: `assets/images/dinos/tank-carnivore.webp`. Rim: violet `#8e44ad`.
Carries the CRITICAL FRAMING block — this is the same design that cropped at the
bottom and right on `boss-founders_park`'s first attempt. Note this is the
*species* portrait, distinct from the chapter-7 boss portrait
`assets/images/battles/boss-founders_park-portrait.webp`, which stays scarred,
tagged and fitted at 24px; the two must not be confused or reused for each other.

> Keep the exact same head-and-shoulders three-quarter portrait camera angle and
> facing as the reference image: facing right with the snout pointing right, on a
> plain flat light-gray studio background with no scenery and no ground shadow.
> Change the dinosaur to a cartoon Ultimasaurus — a composite armoured apex
> hybrid with a tyrannosaur's broad heavy skull, a pair of forward-curving brow
> horns, overlapping ankylosaur-style armour plates running across the shoulders
> and down the back, blunt bony knuckles ridging the jawline, and hooked sickle
> claws on the forelimbs. Deep burnished bronze and obsidian plating, with thin
> molten-orange seams glowing between the plates — the glow must be painted only
> ON the plate surfaces themselves and must not spill off the animal. Render it
> as a specific species with individuating detail, but with clean unblemished
> plating: no scars, no chipped plates, no battle damage, no metal tag. Add a
> hard specular rim light along the silhouette edge only — a crisp violet #8e44ad
> highlight sitting tight on the creature's outline, like a sharp light source
> directly behind it. The rim must stay ON the animal's own edge; it must not
> bleed, feather, bloom or halo outward into the background, and there must be no
> soft glow of any kind around the silhouette. No glow, rays, embers, sparkles,
> or light effects extending beyond the creature silhouette. CRITICAL FRAMING:
> zoom out so the ENTIRE creature — the whole head, both horns, the full neck and
> both complete armoured shoulders — sits well inside the frame, small in the
> canvas, surrounded by a wide band of empty background on all four sides.
> Nothing may touch, run off, or be cropped by any edge of the image, especially
> the bottom and right edges. Plain flat light-gray studio background, completely
> empty, no drawn border, no frame, no panel edge, no letterboxing. Glossy
> cartoon mobile-game art style, bold dark outlines, vibrant saturated colors,
> strong glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no human characters, no UI elements.

## Species portraits

44 per-species portraits attempted and **43 shipped** — every species that shared
archetype-only art before this pass, less `deinosuchus`, which is a deliberate
gap documented below — one `dinos/<speciesId>.webp` each, 1024×1024 transparent, resolved
by `dinoImage(speciesId, archetype, diet)` (`src/core/images.ts`) ahead of the
shared `dinos/<archetype>-<diet>.webp` fallback. Same override-not-replacement
guarantee as Hero species portraits above: deleting any one file here restores
that species' archetype art with no code change and no error.

**Workflow (reference chain):** each portrait is an image-edit of the
archetype cutout that species currently falls back to (`nano_banana_pro`
requested; the account was served `nano_banana_2` for every generation in this
batch — served-model routing has moved before, so treat this as a record of
what actually ran, not a promise for a future run). `medias` role is
**`image_references`**, verified against `models_explore` on 2026-08-25 —
the Hero species portraits workflow note above says `image`, which is stale
for this model as of that date. Post-process each with `remove_background`,
then `node scripts/fit-art.mjs cutout <src> assets/images/dinos/<speciesId>.webp`
— **`cutout`, never `portrait`**: this set renders beside the archetype
cutouts at the 31px margin, not beside the 24px boss-portrait family.

**Shared prompt template** — substitute `{SPECIES}` and `{FEATURES}` per row
in the table below:

> Keep the exact same head-and-shoulders three-quarter portrait framing as the reference image: same camera angle, same scale in frame, same small even margin, facing right with the snout pointing right, on a plain flat light-gray studio background with no scenery and no ground shadow. Change the dinosaur to {SPECIES}: {FEATURES}. Render it as a species type rather than a named individual: clean unblemished hide, no scars, no chipped teeth, no battle damage. Show only the head, neck and the top of the shoulders - no arms, no hands, no torso. No glow, rays, embers, sparkles, or light effects extending beyond the dinosaur silhouette; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no lettering, no words, no numbers, no signage writing anywhere in the scene, no human characters, no UI elements.

**The clause that earned its place** (same finding as Hero species portraits
above, independently reconfirmed here): *"Show only the head, neck and the
top of the shoulders - no arms, no hands, no torso."* Without it, an
image-edit off a reference that itself shows forelimbs inherits them —
`bruiser-carnivore.webp` is the one archetype cutout of the eight with a
clawed hand actually visible in frame. The clause alone was not sufficient
this round: four of the first twelve generations in this batch (allosaurus,
ceratosaurus, nanuqsaurus, sinosaurus — all `bruiser-carnivore`) still came
back with a hand or claw visible. A second, more literal sentence was added
and carried into every remaining generation in the batch as a precaution:

> Crop the frame tight at the base of the neck and the very top of the shoulders so that no forelimb, hand, finger, or claw is visible anywhere in the image.

That sentence cleared three of the four. **`sinosaurus` was not fixed by it**
and shipped with a bent forelimb visible at the lower left, which review
caught after the batch had already been committed. What finally cleared it
was harder still — an explicit crop instruction plus an enumeration of the
parts being excluded, rather than a single negative clause:

> CROP AT THE CHEST: show only the head, the neck, and the very top of the shoulders. The image must contain NO forelimbs of any kind - no arms, no upper arms, no elbows, no forearms, no wrists, no hands, no claws, no fingers - and no chest, no belly, no torso below the shoulder line. The lower edge of the picture cuts straight across the base of the neck.

Prefer that wording for any future `bruiser-carnivore` edit. The lesson is
that a negative clause ("no arms") competes with what the reference image
actually shows, while naming the crop line gives the model something
positive to satisfy.

It sits immediately after the "no arms, no hands, no torso" sentence and
before the no-glow sentence. `deinosuchus` (`bruiser-carnivore`) is the one
species this batch could not clear and is the one deliberate gap in the 44:
its first generation carried an unrelated duplicate-image ghosting artifact;
its second, with the sentence above added, came back with a hand again; its
third, with both an anti-hand and an explicit anti-ghosting sentence, came
back worse — a blurred band across the bottom of the frame with a hand still
visible inside it. It ships on the shared `dinos/bruiser-carnivore.webp`
fallback rather than a fourth generation on one file.

**CRITICAL FRAMING block**, for any species whose silhouette grows past the
reference — used for 17 of the 44 rows below, wherever the Framing column is
not `—`:

> CRITICAL FRAMING: zoom out so the ENTIRE creature - {PARTS} - sits well inside the frame, small in the canvas, surrounded by a wide band of empty background on all four sides. Nothing may touch, run off, or be cropped by any edge of the image, especially the {THREATENED} edges.

It sits after the no-glow sentence and before the "Glossy cartoon mobile-game
art style" sentence.

**A shoulder running off the left or bottom edge is house style, not a
defect** — the same rule the archetype cutouts and the Containment Site boss
portrait are already held to; do not regenerate for this alone.

**Provenance of the first three rows:** triceratops, velociraptor and
giganotosaurus were generated as a pilot, one per reference family, before
the anti-forelimb crop sentence above existed — triceratops needed the
CRITICAL FRAMING block (its frill grows past the reference), the other two
did not. Their `{FEATURES}` text below is reconstructed from the committed
files rather than a preserved original prompt; regenerating from it will not
reproduce those three files pixel-for-pixel, but will reproduce the same
species, coloring and framing.

| Species | File | Reference | `{SPECIES}` | `{FEATURES}` | Framing (parts / threatened edges) |
|---|---|---|---|---|---|
| triceratops | dinos/triceratops.webp | tank-herbivore | a Triceratops | two long brow horns and a shorter nose horn, a broad bony frill rimmed with small triangular points, a hooked beak, a slate-gray-blue face and neck with a warm tan-brown frill and horns | the whole head and the complete frill with all of its rim points / top and left |
| velociraptor | dinos/velociraptor.webp | swift-carnivore | a Velociraptor | a slender toothy snout, a feathered crest along the back of the head and neck, a keen yellow eye, two-tone rust-orange mottled hide fading to a pale cream throat and underside | — |
| giganotosaurus | dinos/giganotosaurus.webp | bruiser-carnivore | a Giganotosaurus | a boxy apex-predator skull with banded teeth showing at the lip line and heavy brow ridges, two-tone olive-green hide with dark charcoal-green mottling and a pale cream throat and jaw | — |
| allosaurus | dinos/allosaurus.webp | bruiser-carnivore | an Allosaurus | a boxy skull with low twin bony ridges above the eyes and a deep S-curved neck, coarse pebbled hide in burnt-orange and rust with dark umber-brown striping and a pale cream throat | — |
| ceratosaurus | dinos/ceratosaurus.webp | bruiser-carnivore | a Ceratosaurus | a single blade-like nasal horn above the snout, small bony ridges over the eyes, and a row of small bumpy osteoderms down the neck, teal-green hide with dark charcoal mottling and a pale yellow-cream underside | — |
| deinosuchus | *(not shipped — see above)* | bruiser-carnivore | a Deinosuchus | a giant prehistoric crocodilian with a broad flat armor-plated snout, heavy overlapping bony scutes, small eyes set high on the head and massive conical teeth, swamp-green plated hide with dark olive-black banding and a pale khaki throat | — |
| nanuqsaurus | dinos/nanuqsaurus.webp | bruiser-carnivore | a Nanuqsaurus | a small Arctic tyrannosaur with a compact deep skull, thick brow ridges and a short snout, white-and-frost-blue mottled hide with a pale icy gray-blue underside | — |
| sinosaurus | dinos/sinosaurus.webp | bruiser-carnivore | a Sinosaurus | a mid-sized theropod head with a pair of thin bony crests running lengthwise along the top of the snout, a long narrow jaw with prominent teeth, an alert forward-set eye, and deep forest-green scales with a pale sage throat | — (regenerated with the CROP AT THE CHEST wording above — the plain no-arms clause did not clear its forelimb) |
| spinosaurus | dinos/spinosaurus.webp | bruiser-carnivore | a Spinosaurus | a long crocodile-like snout lined with conical teeth and a tall sail of skin rising from the back of the neck and shoulders, sandy ochre-tan hide with a dark maroon-red sail membrane and a pale cream throat | the whole head, the full neck and the complete tall sail rising off the shoulders / top and left |
| tylosaurus | dinos/tylosaurus.webp | bruiser-carnivore | a Tylosaurus | a giant mosasaur with a long paddle-shaped snout, rows of conical teeth and smooth streamlined skin, countershaded steel-gray-blue back and a pale silvery-white throat and jaw | — |
| iguanodon | dinos/iguanodon.webp | bruiser-herbivore | an Iguanodon | a long horse-like skull with a toothless beak-like tip and a broad muscular cheek pouch, warm olive-brown hide with a pale sandy-tan underside and faint darker striping | — |
| pachycephalosaurus | dinos/pachycephalosaurus.webp | bruiser-herbivore | a Pachycephalosaurus | a tall thick dome of solid bone on top of the skull ringed by small bony knobs and spikes along the brow and snout, rust-red domed skull with dark charcoal knobs and a warm tan face and throat | the whole domed skull and every brow spike / top |
| archelon | dinos/archelon.webp | support-carnivore | an Archelon | a giant prehistoric sea turtle with a toothless hooked beak, smooth rubbery hide and a leathery ridged shell edge just visible at the back of the shoulders, deep olive-green shell tone with a pale cream-yellow beak and throat | — |
| dryosaurus | dinos/dryosaurus.webp | support-herbivore | a Dryosaurus | a small nimble early ornithopod with a short beaked snout, large round eyes and a slender neck, two-tone leaf-green back with a pale creamy-white throat and faint darker green speckling | — |
| maiasaura | dinos/maiasaura.webp | support-herbivore | a Maiasaura | a duck-billed hadrosaur with a small bony ridge above the eyes and a broad flat duck-like beak, warm caramel-brown back with a pale honey-tan underside and faint darker brown speckling | — |
| massospondylus | dinos/massospondylus.webp | support-herbivore | a Massospondylus | an early long-necked sauropodomorph with a small blunt head, a slender elongated neck and tiny leaf-shaped teeth just visible at the jaw line, dusty lilac-mauve back with a pale lavender-cream throat | — |
| microceratus | dinos/microceratus.webp | support-herbivore | a Microceratus | a tiny early ceratopsian with a small bony frill shelf at the back of the skull and a sharp parrot-like beak, no horns yet, mottled moss-green hide with a pale beige belly and a small tan frill | — |
| ouranosaurus | dinos/ouranosaurus.webp | support-herbivore | an Ouranosaurus | a duck-billed iguanodontian with a low sail of skin running along the neck and back supported by tall spines and a pair of small bony bumps above the eyes, warm terracotta-orange sail with dusky purple-brown webbing and a pale cream throat | the whole head, neck and the complete low sail running along the back / top and left |
| parasaurolophus | dinos/parasaurolophus.webp | support-herbivore | a Parasaurolophus | a long tubular crest sweeping back from the top of the skull well past the shoulders, and a duck-like beak, two-tone sky-blue crest fading to a warm honey-tan face and throat | the whole head and the complete backswept crest / top and left |
| stegoceratops | dinos/stegoceratops.webp | support-herbivore | a Stegoceratops | a hybrid ceratopsian with a broad spiked frill, a pair of long brow horns and a short nose horn, deep violet-plum frill with golden-tan horns and a pale lilac face | the whole head, the spiked frill and both brow horns / top and left |
| therizinosaurus | dinos/therizinosaurus.webp | support-herbivore | a Therizinosaurus | a small toothless beaked head on an unusually long slender neck with light feather-down fuzz along the back of the neck, two-tone slate-teal feathered neck with a warm rust-orange head and beak | the whole head and the complete long slender neck / left and top |
| baryonyx | dinos/baryonyx.webp | swift-carnivore | a Baryonyx | a fish-eating spinosaurid with a long narrow crocodile-like snout lined with many small conical teeth and a low bony crest above the eyes, river-green hide with dark olive banding and a pale sandy-cream throat | — |
| carnotaurus | dinos/carnotaurus.webp | swift-carnivore | a Carnotaurus | a pair of short thick bull-like horns above the eyes, an unusually short deep skull and rough pebbled hide, two-tone crimson-red hide with dark charcoal-black horns and a pale ash-gray throat | — |
| compsognathus | dinos/compsognathus.webp | swift-carnivore | a Compsognathus | a tiny agile theropod with a slender delicate skull, large eyes, fine sharp teeth and a light downy fuzz along the neck, two-tone emerald-green hide with fine dark speckling and a pale cream throat | — |
| cryolophosaurus | dinos/cryolophosaurus.webp | swift-carnivore | a Cryolophosaurus | a distinctive crest sweeping up and forward crosswise over the top of the skull like a pompadour, icy blue-gray crest with a deep navy face and a pale frost-white throat | the whole head and the complete crosswise crest / top |
| dilophosaurus | dinos/dilophosaurus.webp | swift-carnivore | a Dilophosaurus | twin thin rounded crests running parallel along the top of the skull, two-tone teal-turquoise crests with a warm golden-yellow face and a pale cream throat | the whole head and both parallel crests / top |
| elasmosaurus | dinos/elasmosaurus.webp | swift-carnivore | an Elasmosaurus | a plesiosaur with an extremely long slender neck and a small narrow head lined with fine needle-like teeth, deep ocean-blue back with a pale silvery-white throat and smooth wet-looking hide | the small head and the complete extremely long neck / left and bottom |
| hesperornis | dinos/hesperornis.webp | swift-carnivore | a Hesperornis | a flightless diving bird with a long slender tooth-lined beak, a sleek streamlined head and a small crest of feathers at the back of the skull, two-tone charcoal-black head with a pale white throat like a loon | the whole head and the complete long slender beak / right |
| pteranodon | dinos/pteranodon.webp | swift-carnivore | a Pteranodon | a pterosaur with a long toothless beak and a tall backward-sweeping bony crest off the back of the skull, warm tan-orange crest and beak with a pale cream head and throat | the whole head, the backward-sweeping crest and the long beak / top and right |
| scorpios_rex | dinos/scorpios_rex.webp | swift-carnivore | a Scorpios rex | a sharp scorpion-like ridged brow, small hooked spines running down the back of the neck and a narrow jaw with curved teeth, two-tone amber-yellow hide with dark scorpion-black banding and a pale bone-white throat | — |
| gallimimus | dinos/gallimimus.webp | swift-herbivore | a Gallimimus | an ostrich-like omnivore with a small toothless beaked head, large round eyes and a slender neck, warm sandy-tan back with a pale cream throat and faint darker tan speckling | — |
| leaellynasaura | dinos/leaellynasaura.webp | swift-herbivore | a Leaellynasaura | a small polar ornithopod with unusually large eyes and a short blunt beak, two-tone rust-red back with a pale cream underside | — |
| lesothosaurus | dinos/lesothosaurus.webp | swift-herbivore | a Lesothosaurus | a small primitive ornithischian with a short triangular skull, small leaf-shaped cheek teeth and a narrow beak tip, dusty olive-tan back with a pale sandy-cream throat | — |
| othnielia | dinos/othnielia.webp | swift-herbivore | an Othnielia | a small fast bipedal ornithopod with a slender pointed skull, large eyes and a narrow beak, two-tone honey-gold back with a pale ivory throat and faint darker speckling | — |
| struthiomimus | dinos/struthiomimus.webp | swift-herbivore | a Struthiomimus | an ostrich-mimic with a toothless beaked head, a long slender neck and large eyes, two-tone slate-gray-blue back with a pale cream throat | — |
| kronosaurus | dinos/kronosaurus.webp | tank-carnivore | a Kronosaurus | a giant short-necked pliosaur with a massive elongated jaw lined with huge conical teeth and small eyes set high on smooth hide, deep steel-blue back with a pale silvery-white throat and jaw | — |
| ankylodocus | dinos/ankylodocus.webp | tank-herbivore | an Ankylodocus | a hybrid sauropod-ankylosaur with a long neck ending in a small blunt head crowned with bony armor knobs and a low crest at the back of the skull, two-tone moss-green armor plating with a pale stone-gray throat | the whole head, the complete long neck and the crown of armor knobs and crest / top and left |
| ankylosaurus | dinos/ankylosaurus.webp | tank-herbivore | an Ankylosaurus | a heavily armored broad low triangular skull covered in bony plates, small horn-like knobs at the back corners of the skull and a beaked mouth, warm olive-brown armor with a pale tan underside and dark bronze plate edges | — |
| brachiosaurus | dinos/brachiosaurus.webp | tank-herbivore | a Brachiosaurus | a giant sauropod with an extremely long neck and a small blunt head topped by a raised bony nasal crest, two-tone slate-blue back with a pale dove-gray throat | the small head, the complete extremely long neck and the raised nasal crest / top and left |
| henodus | dinos/henodus.webp | tank-herbivore | a Henodus | an armored placodont, a flat turtle-like marine reptile with a broad flat toothless beak and a low armored plate shell edge visible at the shoulders, sandy-beige armor plating with a pale cream beak and throat | — |
| nasutoceratops | dinos/nasutoceratops.webp | tank-herbivore | a Nasutoceratops | a broad frill, unusually long forward-curving brow horns and an oversized bulbous nose, deep burgundy-red frill with warm tan horns and a pale rose-tan face | the whole head, the wide frill and both long forward-curving horns / top and left |
| pachyrhinosaurus | dinos/pachyrhinosaurus.webp | tank-herbivore | a Pachyrhinosaurus | a thick flat bony boss over the nose instead of a horn and a wide frill edged with small hooked spikes, two-tone slate-gray frill with a pale bone-tan boss and face | the whole head, the wide spiked frill and the nasal boss / top and left |
| stegosaurus | dinos/stegosaurus.webp | tank-herbivore | a Stegosaurus | a row of tall triangular bony plates running from the back of the head down the neck, with small bumpy osteoderms on the cheeks, warm olive-green plates with dark umber-brown edges and a pale sage-cream throat | the whole head, neck and the complete row of tall back plates / top and left |
| thescelosaurus | dinos/thescelosaurus.webp | tank-herbivore | a Thescelosaurus | a sturdy small-bodied ornithopod with a blunt short beaked snout, small cheek teeth and a thick sturdy build, two-tone forest-green back with a pale cream underside | — |

### Banked species (not yet in the roster)

Twelve more portraits, generated the same way as the 44 above but for species
that do not exist in `src/data/species/` yet — `assets/images/dinos/<id>.webp`
ships ahead of the data so that adding each species later is a data-only
change. Each id is allowlisted individually as `BANKED_SPECIES_ART` in
`tests/images.test.ts`, separately from `SPECIES_IDS` (which is derived from
`allSpecies()`), so a typo here still fails the stray-file guard rather than
silently passing.

**When one of these species ships as real data:** move its row into the main
table above and delete its id from `BANKED_SPECIES_ART` in
`tests/images.test.ts` — the companion test there
("no banked id has since shipped as species data") turns red until that
deletion happens, which is the intended nudge.

**Workflow and shared prompt template:** identical to the 44 above — same
reference-chain image-edit off the archetype cutout, same `image_references`
role, same `remove_background` + `cutout` (31px) post-processing pipeline.

One prompt change from the original 44: the **CROP AT THE CHEST** wording
(the strongest anti-forelimb clause found while regenerating `sinosaurus`,
quoted above) was used for **all twelve** of these, not only the
`bruiser-carnivore` edits — the original 44 only reached for it after the
weaker "no arms, no hands, no torso" sentence alone let four `bruiser-carnivore`
generations through with a visible forelimb. Both sentences appear in every
one of these twelve prompts, back to back, with the CROP AT THE CHEST sentence
second:

> Show only the head, neck and the top of the shoulders - no arms, no hands, no torso. CROP AT THE CHEST: show only the head, the neck, and the very top of the shoulders. The image must contain NO forelimbs of any kind - no arms, no upper arms, no elbows, no forearms, no wrists, no hands, no claws, no fingers - and no chest, no belly, no torso below the shoulder line. The lower edge of the picture cuts straight across the base of the neck.

It worked cleanly this round: all twelve generations, including the three
edited from `bruiser-carnivore` (`concavenator`, `herrerasaurus`,
`suchomimus` — the one archetype reference that itself shows a clawed hand),
cleared inspection with no forelimb visible and needed zero regenerations.

`concavenator`'s real diagnostic feature — a tall squared hump over the
hips — sits well below this crop's shoulder line and cannot be shown here at
all; its `{FEATURES}` text instead describes the hump's leading edge just
beginning to rise at the base of the neck, the furthest down the body the
crop line permits, rather than asking the model to render torso it must also
refuse.

Seven of these twelve needed the CRITICAL FRAMING block (same wording and
placement as documented above) for a silhouette that grows past the
archetype reference: `amargasaurus` (paired neck spines), `apatosaurus`
(extremely long neck), `corythosaurus` (rounded head crest), `dimorphodon`
(beak and both folded wings), `nodosaurus` (paired shoulder spikes),
`sinoceratops` (frill and nose horn), `styracosaurus` (frill and radiating
spikes). The other five — `concavenator`, `herrerasaurus`, `suchomimus`,
`troodon`, `utahraptor` — stayed within the reference's existing silhouette
and needed no framing block.

| Species | File | Reference | `{SPECIES}` | `{FEATURES}` | Framing (parts / threatened edges) |
|---|---|---|---|---|---|
| amargasaurus | dinos/amargasaurus.webp *(banked)* | tank-herbivore | an Amargasaurus | a long slender sauropod neck with two parallel rows of very tall slender bony spines running down its top like a spiny sail, and a small blunt head with a squared snout and tiny peg-like teeth, dusty amber-gold neck and head skin with a deep burgundy-red spine sail and a pale cream throat | the small head, the complete long neck and every one of the tall paired neck spines / top and left |
| apatosaurus | dinos/apatosaurus.webp *(banked)* | tank-herbivore | an Apatosaurus | a small elongated horse-like head with blunt peg-shaped teeth at the jaw tip and a bulging nostril set high on the snout, carried on an extremely long slender neck, dusty sage-green neck and head with a pale ivory-cream throat and faint darker green mottling | the small head and the complete extremely long neck / top and left |
| concavenator | dinos/concavenator.webp *(banked)* | bruiser-carnivore | a Concavenator | a tall narrow carcharodontosaurid skull with a deep snout and prominent serrated teeth, a shallow bony ridge above each eye, and the leading edge of a tall bony hump just beginning to rise where the neck meets the shoulders, two-tone burnt-sienna hide with dark umber-brown banding and a pale tan throat | — |
| corythosaurus | dinos/corythosaurus.webp *(banked)* | support-herbivore | a Corythosaurus | a broad flat duck-like beak and a tall rounded dinner-plate-shaped crest rising vertically off the top of the skull, two-tone dusty rose-pink crest fading to a warm honey-tan face and throat | the whole head and the complete rounded crest / top and left |
| dimorphodon | dinos/dimorphodon.webp *(banked)* | swift-carnivore | a Dimorphodon | a deep puffin-like beak with a large hooked tip and big round eyes, and the tops of two leathery folded wing membranes just visible rising from the shoulders, mottled slate-gray head with a warm rust-orange beak and a pale cream throat | the whole head, the deep beak and both folded wings rising from the shoulders / top, left and right |
| herrerasaurus | dinos/herrerasaurus.webp *(banked)* | bruiser-carnivore | a Herrerasaurus | a long narrow primitive theropod skull with a slight kink partway down the jaw, sharp recurved teeth and a shallow bony ridge above the eye, two-tone dusty clay-brown hide with dark rust-red mottling and a pale sandy-tan throat | — |
| nodosaurus | dinos/nodosaurus.webp *(banked)* | tank-herbivore | a Nodosaurus | a low broad triangular skull covered in small bony armor plates, a beaked mouth and rows of hard oval osteoderms studding the neck, with a pair of long lateral spikes projecting outward from the top of the shoulders, warm olive-drab armor plating with dark bronze-brown plate edges and a pale tan underside | the whole head, the armored neck and both long shoulder spikes / left and right |
| sinoceratops | dinos/sinoceratops.webp *(banked)* | tank-herbivore | a Sinoceratops | a single short thick nose horn, small blunt brow horns, and a broad frill rimmed with a row of forward-curling hooked horns, two-tone rust-orange frill with warm golden-tan horns and a pale amber face | the whole head, the wide hooked frill and the nose horn / top and left |
| styracosaurus | dinos/styracosaurus.webp *(banked)* | tank-herbivore | a Styracosaurus | one long straight nose horn and a frill ringed with a crown of very long straight spikes radiating outward, two-tone deep coral-red frill with warm bronze-tan spikes and a pale peach face | the whole head, the nose horn and every one of the long radiating frill spikes / top and left |
| suchomimus | dinos/suchomimus.webp *(banked)* | bruiser-carnivore | a Suchomimus | a very long narrow crocodile-like snout lined with many small conical teeth and a shallow bony ridge running along the back of the neck, sandy khaki-tan hide with dark olive-brown banding and a pale cream throat | — |
| troodon | dinos/troodon.webp *(banked)* | swift-carnivore | a Troodon | unusually large forward-facing eyes for keen binocular vision, a slender delicate snout lined with fine serrated teeth, and a smooth narrow skull, two-tone dusky teal-gray hide with dark charcoal speckling and a pale silver-cream throat | — |
| utahraptor | dinos/utahraptor.webp *(banked)* | swift-carnivore | a Utahraptor | a long slender toothy snout, a low feathered crest along the back of the head and neck, and a heavier more robust skull than a typical raptor, two-tone deep slate-blue hide with dark charcoal-blue banding and a pale frost-gray throat | — |

## Park map

Three opaque rasters drawn by the park renderer (`src/core/render/draw.ts`)
through `loadParkArt` (`src/core/render/art.ts`) — never through `assetImage`,
which returns Discord attachments; these are decoded into canvas `Image`s and
never leave the renderer. All three are optional: a missing or undecodable file
degrades that one element back to the flat fill it replaced.

**Workflow (reference chain):** generate the ground first at 3:2. Generate the
paddock plate as an image-edit of the approved ground so the two materials share
a light direction, then the facility plate as an image-edit of the approved
paddock plate so the two plates match shape for shape. No background removal —
these are opaque. Post-process each with a cover-crop fit to the size in the
File targets table.

Both plate generations came back as a plate *object* centered on a plain
light studio backdrop with a visible margin on all four sides (not filling
the 16:9 frame edge to edge, unlike the ground). Because the raw
generation's aspect ratio (16:9) is already close to the tile's (270:150 =
1.8:1), a cover-crop fit alone barely trims anything and that studio
margin survives almost unchanged into the shipped tile as a stray border
outside the plate's own frame. Crop tight to the plate object's own bounding
box first, then cover-fit that crop to 270×150 — do not cover-fit the raw
generation directly. `fit-art.mjs band` performs that second step only, so a
plate regeneration still needs the bounding-box crop by hand before the mode is
run. Art that already fills its frame edge to edge — the landmark bands, the
attraction bands — goes straight through `band` with no pre-crop.

**Contrast requirement (hard gate, not a style preference):** `drawTile`
(`draw.ts`) paints the lot name and `Lv N` in the tile's fixed palette text
color (`PADDOCK_PALETTE.text` / `FACILITY_PALETTE.text`,
`src/data/render-icons.ts`) directly on top of the plate — the plate never
gets a scrim or an outline behind the text. That means the plate's *center*
luminance is the only lever for legibility, and it must independently clear
WCAG AA (4.5:1) against the fixed text color, at both the lot-name band
(`fillText(name, x+54, y+34)`, 18px) and the `Lv N` band
(`fillText(`Lv ${level}`, x+54, y+54)`, 13px) — sample the actual committed
file (`assets/images/park/plate-paddock.webp` /
`assets/images/park/plate-facility.webp`) at those exact tile-local offsets,
not the raw generation, and not by eye. Treat ~6:1 as the target, matching the flat-fill baseline it replaces
(`PADDOCK_PALETTE.fill` / `FACILITY_PALETTE.fill`) — 4.5:1 is a floor, not a
goal, because the plate's own gradient means different bands (and different
real lot names) sample slightly different pixels.

A first pass at both plates (kept the sandy-tan / blue-gray descriptions but
without an explicit lightness call-out) shipped with center tones close to
the flat-fill's *hue* but darker and more saturated than its *luminance* —
plausible as materials, but the paddock only cleared 4.79:1–6.29:1 (down
from the 6.30:1 flat-fill baseline) and the facility failed outright at
3.10:1–3.64:1 (against a 5.49:1 baseline and the 4.5:1 floor). Text colors
were never the problem; the surface under them was measurably darker than
the flat fill it replaced. The fix is a prompt that explicitly separates
border richness from center lightness — keep the frame saturated and dark
enough to read as its material, but call out the center as *pale and
desaturated*, lighter in value than the border, in similar terms to how
"calm and untextured" was used to fix center busyness. The versions below
are the ones that hit target (paddock 9.91:1 both bands; facility
9.56:1–9.59:1 both bands).

**park/ground** — deliberately not a seamless tile: diffusion models do not
reliably close tile edges, and a single cover-scaled backdrop has no seams to
close.

> A top-down view of lush jungle-park ground filling the whole frame: mown
> green grass with subtle mowing bands, a few scattered fern fronds and small
> pebbles, faint dirt patches worn into the turf, no single focal point and
> nothing large enough to dominate the frame. Even flat lighting, no strong
> cast shadows. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**park/ground-{wet,dry,cold}** — three season variants of the ground above,
selected by `ParkArt.groundBySeason[snapshot.season]` in
`src/core/render/draw.ts`, falling back to the base `ground` art (and,
failing that, the flat fill) whenever a season's raster is missing or a
snapshot names none. Generated with model `nano_banana_pro` (the API
silently routes this to `nano_banana_2`) at aspect ratio `3:2`, source
output 1264×848, then
`node scripts/fit-art.mjs ground <src> <dest>` to 1200×800 WebP q95 —
`fit-art.mjs`'s new `ground` mode, sized for the park canvas rather than the
1536×1024 `banner` mode. Each keeps the same "top-down view of lush
jungle-park ground filling the whole frame … no single focal point …
even flat lighting, no strong cast shadows" framing as the base ground and
varies only the season, and each ends with the shared style block plus the
expanded no-text clause used elsewhere in this file (a stricter ending than
the base ground prompt above, which predates that clause).

> **ground-wet.webp:** A top-down view of lush jungle-park ground filling the
> whole frame, soaked deep vivid rain-soaked green with glossy puddles and
> dark damp dirt patches worn into the turf, no single focal point and
> nothing large enough to dominate the frame. Even flat lighting, no strong
> cast shadows. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no lettering, no
> words, no numbers, no signage writing anywhere in the scene, no human
> characters, no UI elements.

> **ground-dry.webp:** A top-down view of lush jungle-park ground filling the
> whole frame, sun-bleached straw-gold and pale olive grass with hairline
> cracks and dusty pale dirt patches worn into the turf, no single focal
> point and nothing large enough to dominate the frame. Even flat lighting,
> no strong cast shadows. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene,
> no human characters, no UI elements.

> **ground-cold.webp:** A top-down view of lush jungle-park ground filling
> the whole frame, stiff silver-green grass dusted with frost and thin snow
> patches, pale frozen dirt patches worn into the turf, no single focal
> point and nothing large enough to dominate the frame. Even flat lighting,
> no strong cast shadows. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> lettering, no words, no numbers, no signage writing anywhere in the scene,
> no human characters, no UI elements.

**park/plate-paddock** (generated with the ground attached as the `image`
reference):

> A single rectangular game-UI plate for a dinosaur paddock: a pale, light,
> desaturated sandy-beige enclosure floor — a soft warm khaki sand tone,
> much lighter and less saturated than raw dirt, similar in lightness to
> pale straw or light sand, not deep tan or brown soil — framed by a rich,
> saturated, rough-hewn wooden fence border on all four sides with visible
> wood grain and warm brown tones, corner posts. The center floor area must
> be noticeably lighter in value than the wooden border, a calm flat
> untextured pale tone with no shadow gradient and no detail so dark text
> can sit on it legibly. Even flat lighting, no cast shadows. Glossy cartoon
> mobile-game art style, bold dark outlines, clean cel shading with smooth
> gradients, polished game-asset look. No text, no characters, no UI
> elements.

An earlier version of this prompt (a warm sandy-tan floor with no explicit
lightness call-out against the border) rendered a calm, untextured center
that still measured only 4.79:1–6.29:1 against `PADDOCK_PALETTE.text` — below
the ~6:1 target and, at the name band, only barely above the 4.5:1 floor. The
version above, which explicitly asks for a pale/desaturated center distinct
from a richer border, measured 9.91:1 at both text bands.

**park/plate-facility** (generated with the paddock plate attached as the
`image` reference):

> Keep the exact same rectangular plate shape, same size, same border
> thickness, same flat lighting. Change the material to a cool steel and
> glass facility floor with riveted metal edging instead of wood — the
> border/frame is a richly-colored, saturated medium steel-blue-gray with
> clear rivet and panel detail, kept dark and rich like real brushed metal.
> The center floor area must be pale, light, and desaturated — a soft very
> light sky-blue-gray, noticeably lighter in value than the metal border,
> similar in lightness to a pale overcast sky, not a deep or saturated blue.
> The center is completely flat and untextured, one single smooth pale tone
> with no diagonal glare streaks, no reflections, no shine lines, no grid or
> panel divider lines, no vents, no hatches, no consoles, no rivets in the
> center, nothing but flat pale color so dark text can sit on it legibly.
> Glossy cartoon mobile-game art style, bold dark outlines, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

Two earlier versions of this prompt failed for two different reasons, both
caught by rendering real tile text over the plate rather than judging the
raw generation alone:

- A first pass ("cool blue-gray steel and glass … calm untextured center")
  rendered diagonal glare streaks and grid panel-divider lines across the
  center — plausible as "glass", but they crossed straight through the lot
  name and visibly hurt legibility next to the paddock plate's clean center.
- A second pass that explicitly forbade the glare/grid ("center glass floor
  area must be completely flat, plain, and untextured … no diagonal glare
  streaks, no reflections … exactly as calm and empty as the center of the
  wooden paddock reference plate") fixed the busyness — the center was
  genuinely flat — but was still too dark and saturated: it measured only
  3.10:1–3.64:1 against `FACILITY_PALETTE.text`, well under the 4.5:1 floor,
  against a 5.49:1 flat-fill baseline. Calm is necessary but not sufficient;
  the center also has to be *pale*.

The version above, which keeps the border rich but asks for a center
"noticeably lighter in value than the metal border … similar in lightness to
a pale overcast sky", measured 9.56:1–9.59:1 at both text bands while keeping
the border dark and rivet-detailed. A future regeneration from either
earlier prompt is not guaranteed to avoid its respective failure again — use
the version above, and re-verify both busyness (by eye) and contrast (by
measurement, against the offsets and floor described above) before shipping.

**park/landmark-{a,b,c}** — the prestige monument cell (`drawLandmark`,
`draw.ts`), one raster per `LandmarkBand` (`src/data/landmarks.ts`): band `a`
covers tiers 1–2 (Stone Marker, Fossil Plinth), band `b` tiers 3–4 (Bronze
Sentinel, Amber Obelisk), band `c` tiers 5–6 (Grand Rotunda, Titan Monument) —
three bands rather than six rasters, so the monument visibly grows twice.
Generated with model `nano_banana_pro` (the API silently routes this to
`nano_banana_2`) at aspect ratio `16:9`, source output 1376×768, cover-scaled
and center-cropped to 270×150 WebP q95. These three predate `fit-art.mjs`'s
`band` mode and were fitted with a one-off pass; `band` now does exactly that
cover-and-crop at exactly that size, so a regeneration runs
`node scripts/fit-art.mjs band <src> assets/images/park/landmark-a.webp`
rather than repeating the one-off.

**Contrast requirement (hard gate, not a style preference):** same reasoning
as the two plates above — `drawLandmark` paints the tier name in
`#f5e6b8` directly over the art with no scrim, at tile-local `(14, 134)`
(`fillText(name, x+14, y+TILE_H-16)`, 18px), so the label band at the bottom
of the art must independently clear legibility. Measured worst-pixel contrast
in the 200×18 label band (roughly tile-local y+118 to y+136) at tile-local
(14, 118) against `#f5e6b8`: **band a 7.06:1, band b 10.23:1, band c
11.09:1** — all above the ~6:1 target the plates set.

`scripts/check-band-contrast.mjs` reproduces
this measurement on demand, taking the glyph box from `drawLandmark`'s own
constants rather than estimating it. Re-run it against any regenerated band:

```
node scripts/check-band-contrast.mjs assets/images/park/landmark-*.webp
```

It reports the mean over the text box and the worst 24px-wide window inside
it — the second number is the one that matters, since a band can average dark
and still wash out under a single word. All six committed bands clear AAA
(7:1) by that measure: **a 8.01, b 13.04, c 12.93, d 9.03, e 10.13, f 7.28**.
Those figures read slightly higher than the worst-*pixel* numbers above
because a 24px window averages across the stroke rather than sampling the
single brightest pixel; both methods agree on the verdict, and neither is a
substitute for the other. **Sample the real glyph box, not the lower third of
the band** — a window taller than the text takes in bright upper scenery and
will fail bands that are demonstrably fine, including the committed ones.

**park/landmark-a — Stone Marker / Fossil Plinth:**

> Wide landscape ground-level view inside a dinosaur park, filling the ENTIRE
> frame edge to edge with no border, no plain background margin and no
> framing device: a modest carved grey standing stone marker with a small
> fossil bone motif inlaid on its face stands at the centre on short green
> turf, low hedges and a few ferns behind it. The BOTTOM FIFTH of the frame
> is a solid dark slate kerb band running the full width, clearly darker than
> everything above it, calm and untextured with no detail, so pale cream text
> can sit on it legibly. Even flat lighting, no cast shadows. Glossy cartoon
> mobile-game art style, bold dark outlines, clean cel shading with smooth
> gradients, polished game-asset look. No text, no characters, no UI
> elements.

**park/landmark-b — Bronze Sentinel / Amber Obelisk:**

> Wide landscape ground-level view inside a dinosaur park, filling the ENTIRE
> frame edge to edge with no border, no plain background margin and no
> framing device: a tall verdigris-bronze dinosaur statue on a dark stone
> pedestal stands centre-left, a glowing translucent amber obelisk with warm
> gold highlights stands centre-right, paved plaza and low greenery behind
> them. The BOTTOM FIFTH of the frame is a solid dark slate kerb band running
> the full width, clearly darker than everything above it, calm and
> untextured with no detail, so pale cream text can sit on it legibly. Even
> flat lighting, no cast shadows. Glossy cartoon mobile-game art style, bold
> dark outlines, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**park/landmark-c — Grand Rotunda / Titan Monument:**

> A single rectangular game-UI tile for a dinosaur park: a grand domed
> rotunda of pale marble columns with a colossal mounted dinosaur skeleton
> displayed at its centre, gold trim on the dome, banners between the
> columns. The LOWER THIRD of the image must be a deep, dark
> marble-and-shadow band, clearly darker than the upper area, calm and
> untextured with no detail, so pale cream text can sit on it legibly.
> Glossy cartoon mobile-game art style, bold dark outlines, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

**Lesson — describe full scenes, not single objects.** A first attempt
described bands a and b as a single OBJECT (a monument on a plain
background) rather than a scene; the model returned a portrait-framed tile
object centred on a pale background, and band a measured **1.14:1** in the
label band — illegible. Applying this file's documented crop-tight-to-the-
object fix (the one that worked for the two plates above) made it WORSE, not
better — band a fell to 2.06:1 and band b to 4.31:1 — because cover-scaling a
portrait crop into a landscape tile keeps the bright monument body and
discards the dark base band that a tighter object crop had already cropped
away. The fix was rewriting the prompts as full-bleed SCENES with an
explicit dark ground band baked into the composition (the versions above),
which is why band c — already scene-framed, not object-framed, on the first
attempt — passed with no rework needed. Also worth recording: band a's MEAN
contrast in the failed first pass was a healthy 5.53:1 while its WORST pixel
was 1.14:1 — judging by eye, or by an average rather than the worst pixel, on
the final WebP would have shipped an illegible label.

**park/landmark-{d,e,f} — banked bands above Titan Monument.** The ladder in
`src/data/landmarks.ts` names only six tiers (Stone Marker through Titan
Monument), and `drawLandmark` still resolves every one of them to bands
`a`/`b`/`c` — these three are banked ahead of that wiring, read by nothing yet.
Same pipeline as a-c: model `nano_banana_pro` (routed to `nano_banana_2`) at
aspect ratio `16:9`, `resolution: 2k`, cover-scaled and center-cropped to
270×150 with `node scripts/fit-art.mjs band <src> <dest>`. No background
removal — opaque, same as a-c.

**Workflow (reference chain):** each of the three is an independent image-edit
of the already-committed `landmark-c.webp` (uploaded via `media_upload`,
referenced with role `image_references`) — never chained off one another — so
all three share light direction, outline weight and the "wide landscape
ground-level view … filling the ENTIRE frame" composition band c already
established, while each escalates its own monument independently rather than
compounding drift across three sequential edits the way a chain would.

Bands d/e/f read as the **upper end** of the prestige ladder — grander and
more monumental than a/b/c, continuing the escalation from a's modest
standing stone, through b's statue-and-obelisk pair, to c's domed rotunda: d
is an open colonnade plaza, e a domed observatory, f a summit ziggurat.

**Contrast requirement (hard gate, not a style preference):** same reasoning
and sample region as bands a-c above — tile-local (14, 118), the 200×18 label
band, worst pixel against `#f5e6b8`. Measured: **band d 7.72:1, band e
9.90:1, band f 6.93:1** — all above the ~6:1 target the other three bands
settled on.

**park/landmark-d — Grand Colonnade:**

> Keep the same wide landscape ground-level view inside a dinosaur park,
> filling the ENTIRE frame edge to edge with no border, no plain background
> margin and no framing device, and the same solid dark slate kerb band
> running the full width across the BOTTOM FIFTH of the frame, calm and
> untextured with no detail, clearly darker than everything above it, so pale
> cream text can sit on it legibly. Replace the monument with an even grander
> scene: a monumental open-air colonnade of tall pale marble columns lines
> both sides of a wide paved plaza, twin gilded obelisks rise at the center
> flanking a complete dinosaur skeleton mounted on a raised stone dais, rows
> of tall banners hang between the columns, manicured hedges frame the plaza
> edges. Even flat lighting, no cast shadows. Glossy cartoon mobile-game art
> style, bold dark outlines, clean cel shading with smooth gradients, polished
> game-asset look. No text, no lettering, no words, no numbers, no signage
> writing anywhere in the scene, no characters, no UI elements. CRITICAL:
> absolutely no writing anywhere in the image — no letters, no words, no
> numbers, no carved inscriptions, no painted signage, no symbols, no logos.
> Every sign, plaque and surface is blank and wordless.

**park/landmark-e — Amber Observatory:**

Passed on the THIRD generation; recorded in full because the first two each
failed the contrast gate a different way, and neither failure was visible at
a glance.

> Keep the same wide landscape ground-level view inside a dinosaur park,
> filling the ENTIRE frame edge to edge with no border, no plain background
> margin and no framing device. Replace the monument with an even grander
> scene: a vast glass-and-gold domed observatory rises at the center, its
> curved glass panels showing a fully articulated dinosaur skeleton suspended
> mid-stride inside, tall bronze support ribs frame the dome, warm amber
> crystal accents line the dome's base with their glow confined strictly to
> the crystal surfaces themselves and never spreading past them. The BOTTOM
> QUARTER of the frame, running the full width edge to edge, is a single
> solid dark slate kerb band — a perfectly flat, completely uniform dark tone
> with no grass, no paving, no fountains, no pale stone, no light-colored
> object of any kind crossing into it anywhere — clearly darker than
> everything above it, calm and untextured with no detail, so pale cream text
> can sit on it legibly anywhere across its full width and its full height.
> Even flat lighting, no cast shadows. Glossy cartoon mobile-game art style,
> bold dark outlines, clean cel shading with smooth gradients, polished
> game-asset look. No glow, rays, embers, or sparkles extending beyond the
> crystal surfaces themselves. No text, no lettering, no words, no numbers, no
> signage writing anywhere in the scene, no characters, no UI elements.
> CRITICAL: absolutely no writing anywhere in the image — no letters, no
> words, no numbers, no carved inscriptions, no painted signage, no symbols,
> no logos. Every sign, plaque and surface is blank and wordless.

Note for future regeneration — two failure rounds, neither obvious on a
glance at full size. The FIRST attempt used the same "BOTTOM FIFTH … dark
slate kerb band" clause that worked cleanly for bands d and f, but its own
scene also asked for "a wide paved forecourt with ornamental fountains on
either side" — the fountains sat pale stone right inside the sampled label
band and measured **1.22:1**, the worst failure this family has produced.
Dropping the fountains for the SECOND attempt fixed that specific prop but
not the underlying issue: with no foreground object left to blame, the dark
band's own upper edge still landed lower than the stated "BOTTOM FIFTH"
promised — a strip of grass and paving crossed into the sampled y 118–136
region, and the second attempt still measured **1.25:1**, functionally
identical to the first. This is the same "a fractional band height renders
shorter in practice than the fraction says" finding the attraction bands'
Lesson records above, showing up a third time in a third family. The THIRD
attempt (the version above) fixed it by widening the stated fraction from
"BOTTOM FIFTH" to "BOTTOM QUARTER" and by naming the specific intruders
explicitly ("no grass, no paving, no fountains, no pale stone"), landing at
**9.90:1**. Judging by eye caught none of this — all three attempts read as
"a dark band at the bottom" at a glance; only sampling the actual label
rectangle and taking the worst pixel, never the mean, surfaced either
failure.

**park/landmark-f — Eternal Ziggurat:**

> Keep the same wide landscape ground-level view inside a dinosaur park,
> filling the ENTIRE frame edge to edge with no border, no plain background
> margin and no framing device, and the same solid dark slate kerb band
> running the full width across the BOTTOM FIFTH of the frame, calm and
> untextured with no detail, clearly darker than everything above it, so pale
> cream text can sit on it legibly. Replace the monument with the grandest
> scene yet: a colossal stepped golden ziggurat rises at the center, tiered
> stone platforms lined with lit torches and banners climbing toward a
> towering bronze-and-gold dinosaur statue at its summit silhouetted against
> the sky, a broad ceremonial staircase of pale stone leads up to it, flanking
> rows of tall stone pillars line the approach. Even flat lighting, no cast
> shadows. Glossy cartoon mobile-game art style, bold dark outlines, clean cel
> shading with smooth gradients, polished game-asset look. No glow, rays,
> embers, or sparkles extending beyond the torch flames themselves. No text,
> no lettering, no words, no numbers, no signage writing anywhere in the
> scene, no characters, no UI elements. CRITICAL: absolutely no writing
> anywhere in the image — no letters, no words, no numbers, no carved
> inscriptions, no painted signage, no symbols, no logos. Every sign, plaque
> and surface is blank and wordless.

**park/attraction-{picnic_lawn,gift_shop,viewing_platform,amber_carousel,sky_gondola,grand_atrium}**
— the guest attraction cell (`drawAttraction`, `draw.ts`), one raster per
`ATTRACTIONS` kind (`src/data/attractions.ts`). The basename after
`attraction-` is the catalog slug **verbatim, underscores and all**:
`attraction-gift-shop.webp` against the slug `gift_shop` is not a near miss,
it is a silent flat-fill degrade that looks exactly like art nobody has
shipped yet, which is why `tests/park-art-assets.test.ts` enumerates this
directory and requires set equality with `Object.keys(ATTRACTIONS)` rather
than trusting a hand-typed list alone. Generated with model
`nano_banana_pro` (the API silently routes this to `nano_banana_2`) at
aspect ratio `16:9`, source output 1376×768, then
`node scripts/fit-art.mjs band <src> assets/images/park/attraction-<kind>.webp`
— cover-scaled and center-cropped to 270×150 WebP q95. The three landmark
bands above predate that mode and were fitted by a one-off pass; this family
is the reason the mode exists, and nothing at 270×150 should be hand-fitted
again.

**Workflow (reference chain):** each is an image-edit of a committed landmark
band, never of another attraction and never from a bare text prompt, so the
two families share light direction, outline weight, ground treatment and
palette temperature — they sit in the same grid, on the same ground raster,
one cell apart. `picnic_lawn`, `gift_shop` and `viewing_platform` reference
`landmark-a` (the modest ground-level scene); `amber_carousel` and
`sky_gondola` reference `landmark-b` (the mid-scale monument pair);
`grand_atrium` references `landmark-c` (the only grand architectural
interior in either family). The catalog's unlock order is also its power
order, so the set escalates the same way the landmark bands do: turf and
trestle tables, then a kiosk, then built timber, then a fairground ride,
then engineering, then architecture.

**No guest figures in any of the six.** The shared style block's "no
characters" clause applies unchanged: a crowd is unreadable at 270×150, and
attendance is a number on the card, not something the tile depicts.

**Contrast requirement (hard gate, not a style preference) — the dark band
sits at the TOP here, not the bottom.** `drawAttraction` paints the kind
name in `#eaf4fb` at tile-local `(14, 34)` (18px) and `Lv N` at `(14, 54)`
(13px), both directly over the art with no scrim — the mirror image of
`drawLandmark`, which paints its single line at `(14, TILE_H - 16)`.
Copying a landmark prompt's "BOTTOM FIFTH … dark kerb band" clause verbatim
therefore puts the dark band where no text is and strands both labels over
open sky. Sample the committed WebP over the label rectangle x 14–250,
y 14–58 and take the **worst** pixel, never the mean: band a of the landmark
pass measured a healthy 5.53:1 mean against a 1.14:1 worst, and judging by
average would have shipped an illegible label. The flat `#2d4a63` fill these
rasters replace measures 8.29:1 against `#eaf4fb`; treat ~6:1 as the target,
matching what the plates and the landmark bands settled on, with 4.5:1 as a
floor rather than a goal.

**park/attraction-picnic_lawn — Picnic Lawn:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a mown green picnic lawn scene occupying only the
> LOWER HALF of the frame, with two long wooden trestle tables and benches
> at the centre, a red-and-white checked blanket spread on the grass beside
> a wicker hamper, and a single SHORT furled cream parasol on a low pole
> that stays entirely below the vertical centre of the frame, low hedges
> and a few ferns visible only near the bottom edge — nothing pale or
> light-coloured may cross into the top half. The TOP HALF of the frame,
> from the very top edge down to the exact vertical centre, is rendered as
> a single perfectly flat, completely uniform solid dark green colour
> swatch — absolutely no leaf shapes, no grain, no highlights, no darker or
> lighter patches, no texture of any kind, no visible sky — with a single
> hard straight horizontal lower edge, clearly darker than everything below
> it, so pale text can sit on it legibly anywhere in that band. Even flat
> lighting, no cast shadows. Glossy cartoon mobile-game art style, bold
> dark outlines, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**park/attraction-gift_shop — Gift Shop:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a small timber-and-glass souvenir kiosk occupying only
> the LOWER HALF of the frame, its window shelves stacked with plush toy
> dinosaurs, painted eggs and souvenir mugs, a paved forecourt with potted
> ferns at the very bottom edge. The TOP HALF of the frame, from the very
> top edge down to the exact vertical centre, is rendered as a single
> perfectly flat, completely uniform solid dark green colour swatch —
> absolutely no leaf shapes, no grain, no highlights, no darker or lighter
> patches, no texture of any kind, no scalloped trim, no striped awning —
> with a single hard straight horizontal lower edge, clearly darker than
> everything below it, so pale text can sit on it legibly anywhere in that
> band; any striped awning or scalloped edge must sit entirely below the
> vertical centre of the frame. Even flat lighting, no cast shadows. Glossy
> cartoon mobile-game art style, bold dark outlines, clean cel shading with
> smooth gradients, polished game-asset look. No text, no characters, no UI
> elements.

**park/attraction-viewing_platform — Viewing Platform:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a raised wooden observation deck occupying only the
> LOWER HALF of the frame, built on sturdy support posts with a plank
> staircase leading up to it, a waist-high safety railing along its edge
> and a brass viewing telescope mounted on a post at the railing, a jungle
> valley glimpsed only near the bottom edge. The TOP HALF of the frame,
> from the very top edge down to the exact vertical centre, is a solid flat
> dark timber roof-beam band running the full width with a single hard
> straight horizontal lower edge — no gradient fade, no visible sky or
> foliage crossing it — clearly darker than everything below it, so pale
> text can sit on it legibly anywhere in that band. Even flat lighting, no
> cast shadows. Glossy cartoon mobile-game art style, bold dark outlines,
> clean cel shading with smooth gradients, polished game-asset look. No
> text, no characters, no UI elements.

**park/attraction-amber_carousel — Amber Carousel:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a fairground carousel occupying only the LOWER HALF of
> the frame, carved dinosaur mounts on polished brass poles, glowing
> translucent amber panels casting warm gold light, low hedges visible only
> near the bottom edge. The TOP HALF of the frame, from the very top edge
> down to the exact vertical centre, is a solid flat deep maroon canopy
> band running the full width with a single hard straight horizontal lower
> edge — no scalloped trim, no gradient fade, no texture crossing it —
> clearly darker than everything below it, so pale text can sit on it
> legibly anywhere in that band; the scalloped canopy trim must sit
> entirely below the vertical centre of the frame. Even flat lighting, no
> cast shadows. Glossy cartoon mobile-game art style, bold dark outlines,
> clean cel shading with smooth gradients, polished game-asset look. No
> text, no characters, no UI elements.

**park/attraction-sky_gondola — Sky Gondola:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a cable-car station occupying only the LOWER HALF of
> the frame, two rounded gondola cabins hanging from a taut steel cable, a
> lattice pylon tower, a jungle valley glimpsed only near the bottom edge.
> The TOP HALF of the frame, from the very top edge down to the exact
> vertical centre, is a solid flat dark slate storm-sky band running the
> full width with a single hard straight horizontal lower edge — no
> gradient fade, no visible cable, cabin or pylon crossing it — clearly
> darker than everything below it, so pale text can sit on it legibly
> anywhere in that band. Even flat lighting, no cast shadows. Glossy
> cartoon mobile-game art style, bold dark outlines, clean cel shading with
> smooth gradients, polished game-asset look. No text, no characters, no UI
> elements.

**park/attraction-grand_atrium — Grand Atrium:**

> Wide landscape ground-level view inside a dinosaur park, filling the
> ENTIRE frame edge to edge with no border, no plain background margin and
> no framing device: a vast domed glass atrium, small and low, occupying
> only the LOWER 40% of the frame, tall palms and tree ferns visible
> through its panes with a small mounted dinosaur skeleton on a plinth
> inside, a paved approach at the very bottom edge. There must be a clear
> gap of plain green foliage or ground between the top of the dome and the
> middle of the frame — the dome's curved roofline must not approach the
> vertical centre. The TOP 60% of the frame, from the very top edge down
> well past the vertical centre, is rendered as a single perfectly flat,
> completely uniform VERY DARK matte brown-black colour swatch, almost
> black — absolutely no gold trim line, no gradient, no lighter patch, no
> highlight of any kind, no glass or dome detail, no texture of any kind —
> with a single hard straight horizontal lower edge, clearly and
> dramatically darker than everything below it, so pale text can sit on it
> legibly anywhere in that band. Even flat lighting, no cast shadows.
> Glossy cartoon mobile-game art style, bold dark outlines, clean cel
> shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

**Lesson — a fractional band height ("TOP THIRD") renders shorter in
practice than the fraction says, and the failure only shows up at the
worst pixel.** The first attempt at all six used the same "TOP THIRD"
phrasing that the shared style guidance above suggests by analogy with the
landmark bottom-fifth band, sized to nominally cover 256 of the 768 source
pixels. Measured worst-pixel contrast on that pass was **1.00–1.66:1
across all six** — a near-total failure — because the model's actual dark
region ended well short of even that fraction (as little as 28px of 150
committed pixels, versus roughly 50px needed to clear the label
rectangle's y 14–58), the same optimistic-fraction gap the landmark pass's
own Lesson above records for portrait-framed objects. Widening the
fraction to "TOP HALF" (or "TOP 60%" for grand_atrium) with an explicit
hard straight lower edge and "no gradient/scallop/texture crossing it"
fixed four of six outright (viewing_platform 12.70:1, amber_carousel
12.99:1, sky_gondola 9.49:1 on the first retry; grand_atrium eventually
16.24:1 after two more rounds). The remaining two failure modes were
narrower and easy to miss by eye at full size: picnic_lawn's furled
parasol finial and grand_atrium's mounted skeleton's skull were each tall
enough to poke a pale, near-text-coloured pixel just across the band
boundary — invisible at a glance, decisive at the worst-pixel sample.
Both needed the foreground element explicitly bounded ("stays entirely
below the vertical centre," "nothing pale may cross into the top half")
before they cleared. picnic_lawn and gift_shop separately needed the band
material itself re-described as "a single perfectly flat, completely
uniform … colour swatch" rather than a scene element ("tree-canopy",
"shop-awning") — describing the band AS an object again let the model add
leaf/grain texture with occasional lighter flecks, the same object-vs-flat-
color trap the landmark Lesson names for composition, recurring here for
material instead. Total: six kinds, twenty generation calls across five
rounds, eighteen of which produced usable output — the other two were the
SAME kind (viewing_platform) hitting an unrelated NSFW false positive once
in round one and once in round two, each cleared by an immediate retry of
the identical prompt. By round: round one, six initial submissions plus
the first viewing_platform retry (seven calls); round two, six TOP-HALF
rewrites plus the second viewing_platform retry (seven calls); round
three, two calls fixing picnic_lawn and grand_atrium; round four, three
calls fixing picnic_lawn, gift_shop and grand_atrium again; round five,
one call fixing grand_atrium alone — before all six cleared the ~6:1
target with margin.

## Hatch cracks

Six mid-burst variants of the egg icons, shown on the `hatch:crack` reveal so
the player sees the same egg they were shown a second earlier, now open.

| File | Size | Use |
|---|---|---|
| `assets/images/hatch/<rarity>-crack.webp` | 1024×1024, transparent | `hatch:crack` reveal embed image |

`<rarity>` is one of `common`, `uncommon`, `rare`, `epic`, `legendary`,
`mythic`.

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the egg/nest silhouette — off-silhouette glow survives background
removal as floating islands or a light halo on transparency. Emissive detail is
allowed only ON surfaces. Every prompt carries this rule verbatim.

**Workflow (reference chain):** each crack is generated with its OWN
`assets/images/eggs/<rarity>.webp` attached as the `image` reference (Nano Banana
Pro, `medias` role `image`) — never from another crack — so the shell design and
nest match the egg the player was just shown. Post-process each with
`remove_background`, then `node scripts/fit-art.mjs cutout <src> <dest>` — whole
bbox, 31px margin (see the table in Egg rarities; the eggs themselves sit at
24px, so a crack is very slightly smaller than the egg it follows).

**Multiple disconnected regions are intentional here — never reduce a crack to
one region.** The prompt asks for shell fragments falling away from the egg, and
a fragment that has cleared the nest silhouette is its own opaque island. Five of
the six committed cracks carry 4–6 fragments (`common` and `uncommon` 6,
`legendary` and `rare` 5, `epic` 4; only `mythic` happens to land at 1). Step (1)
of the Egg rarities pass — "keep only the largest connected region" — and its
"exactly one connected region" verification are therefore **not** part of this
family's post-processing: applying either would silently delete the fragments and
leave a plain open egg, and `fit-art.mjs cutout` correctly keeps every region.
`tests/images.test.ts`'s "keeps its falling shell fragments" case is the real
guard against that loss: it registers **every** committed hatch file from disk,
bases and variants alike, and fails any one of them that drops below two
fragments. `mythic-crack` — genuinely a single region — is exempt by name; its
three variants are not. Two details of that guard are load-bearing if it is ever
rewritten. It counts regions **over 40px**, never the raw region total: the
backdrop repair below leaves tens of single-pixel matte specks behind on the
files it touched, so `common-crack` raw-counts 68 regions against its 6 real
fragments, and a raw count would pass a file that had lost every fragment it
owns. And it is **per file**, not across the set — the version it replaced
asserted only that at least ONE of the six bases had more than one region, which
four of them could fail while it stayed green, and which never opened a single
variant. It is still not a substitute for review: after regenerating, confirm by
eye that the crack you touched kept its own fragments. What still applies from
the egg pass is the *defringe* half — the light studio rim must be peeled, and
all border pixels must end transparent.

### Backdrop in the crack gaps — the defect this family is most prone to

**Symptom.** A pale opaque smear across the crack opening, where the embed should
show through. It survives every other check: the file is 1024×1024, its corners
are transparent, its margin is 31px, and it has plenty of disconnected regions.
It is only visible against a non-white background, which is why it shipped in
`common-crack` — one of the original six — and went unnoticed until someone
looked at the set over a coloured ground.

**Cause, measured at each stage rather than inferred.** The generator draws the
egg on a light-grey studio backdrop, and that backdrop is visible *through the
gaps between shell pieces* — the V between the two upper halves, the zigzag
between upper and lower. `remove_background` does not clear it, because a region
enclosed by subject reads as foreground: on `mythic-crack-v2`, **7040 backdrop px
went in and 6791 came out**, a 3.5% reduction. `fit-art.mjs cutout` cannot clear
it either — its luminance peel only removes pixels already adjacent to
transparency, three passes deep, so it cannot reach into a blob tens of thousands
of pixels across.

**Prevention, for a new or regenerated crack.** Ask for the gaps explicitly:

> Everything visible through the gaps between the shell pieces is deep black
> shadow — the empty inside of the egg — never the background, never a light or
> grey area.

**Repair, for art already committed.** `scripts/clear-backdrop.mjs` floods from
each backdrop seed through connected pale, desaturated pixels and stops at the
art's own dark outlines, then zeroes the alpha. Run it with `--preview` first and
*look at the mask*: it renders what would be cleared in magenta over a dimmed
copy. Seven files were repaired this way — the four `common-crack` files
(46k–53k px each), `mythic-crack-v2` (2.9k), and `rare-crack-v2`/`-v3` (a few
hundred each) — all to zero, with every shell fragment intact. Region counts
*rose* afterwards, because the backdrop had been bridging pieces that are meant
to be separate.

**It took two passes, and the reason is worth carrying.** The first pass and the
first guard both gated "pale" on `alpha >= 100`, so both were blind to
PARTIAL-alpha residue. Four of the seven files still carried a visible pale ghost
in the crack gap at alpha 10–99 — up to 1669px on `common-crack-v3` — and the
guard reported them clean, which is worse than no guard, because it also tells
the next reader the file was checked. The opacity gate is 25 in both the repair
and the detector now, and all seven files were re-run at that gate. If either
number is ever moved, move it in both — they are the same predicate.

**The guard.** `tests/images.test.ts` asserts that the LARGEST interior backdrop
region on every hatch file and every egg file is under 300px, using
`tests/lib/backdrop.ts`. Largest, never the total — summing counts hairline
anti-aliasing seams until a clean file trips the threshold. Read that file's
header before reusing the detector on another family; it documents three
false-positive classes, and only the first is excluded automatically:

1. **Art cut flat by the frame.** The house style ends the art at the canvas edge
   with no outline, so a pale throat there has backdrop's exact local signature.
   The detector's `atCrop` flag excludes these. Measured on `dinos/gallimimus.webp`:
   74,957px flagged unfiltered, of which a single 74,803px blob is `atCrop` and
   drops out, leaving 154px.
2. **Hairline anti-aliasing seams.** Interior, so `atCrop` cannot help; they are
   told apart by SHAPE — many slivers of 1–3px width rather than one contiguous
   region. `hatch/epic-crack-v2.webp` carries 172px in its largest such blob and
   is perfectly good art.
3. **Pale art meeting an interior HOLE through the silhouette** — an open mouth,
   a gap between a limb and the body. `atCrop` cannot help here either, because
   the hole is nowhere near the frame. Two live examples: `dinos/tank-carnivore.webp`
   reads its entire 69,304px chest as interior (box (305,488)–(623,949)), and
   `battles/boss-founders_park-portrait.webp` reads 376px of the pale shine
   inside its open jaw, over the 300 threshold.

Class 3 is why the guard covers **eggs and hatch and nothing else**. Both are the
same egg-in-a-nest composition with no cut edge and no hole through the subject,
and both measure clean with enormous margin — all 24 eggs at 0px, the worst hatch
file at 172px against 300. The dino portraits and the boss portraits are exactly
the composition class 3 describes, and `boss-founders_park-portrait.webp` is the
proof: extending the guard to `battles/` would fail on a correct picture. Do not
widen the threshold to admit it — widen the family only when the family measures
clean.

**Prompt (identical for all six; only the attached reference changes):**

> Keep the exact same cartoon dinosaur egg and the exact same woven twig nest:
> same shell design, same colors, same size, same position, same framing, same
> plain flat light-gray studio background. Change only the state: the shell is
> now split wide open across the upper half, jagged shell fragments falling
> away and resting in the nest, the interior dark and empty. No glow, rays,
> embers, sparkles, or light effects extending beyond the egg or the nest;
> glowing details may appear only on the surfaces themselves. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

### Variants (`-v2`, `-v3`, `-v4`)

Each rarity carries three variants beside its untouched base, for eighteen files
in total. Every one is an image-edit of **its own committed crack**, never of
another variant or another rarity, so the shell design and nest stay recognisably
the same egg. Post-processed exactly like the base: `remove_background`, then
`node scripts/fit-art.mjs cutout` at 31px — **never `portrait`**, which keeps only
the largest region and would delete every fragment.

What varies is the **fracture pattern and the scatter of the falling fragments**:
where the shell splits, how many pieces clear the nest, and where they land.
What must never vary is the **rarity's colour identity** — the shell palette is
what carries the rarity read, and `mythic` in particular stays obsidian-and-lava
to match `volcano_core`.

Append to the base prompt above, in place of nothing else:

> Vary only the break: {FRACTURE} Keep the shell colours, the speckling, the nest
> and the framing exactly as the reference.

**Provenance of the `{FRACTURE}` list below — read this before regenerating.**
The exact strings used at generation time were not recorded. Every entry here is
**reconstructed by eye from the committed file**, the same disclosure the three
pilot species rows carry in the Species portraits section: regenerating from
these will not reproduce the eighteen files pixel-for-pixel, but will reproduce
the same break, the same fragment count and the same scatter. Each description is
written as an instruction relative to that rarity's own committed BASE crack,
which is what the edit was chained off. Where a description says "the base's two
caps", look at the base file — the two upper shell pieces the split leaves
hanging above the bowl.

Across all six rarities the three variants follow one shape, which is the thing
to preserve if any single entry reads oddly: **v2 breaks the same way as the base
but throws more debris outward, v3 is the widest and most airborne of the three,
and v4 is the heaviest and lowest — fewer pieces in the air, bigger pieces on the
ground.** Fragment counts follow it too (see the table below): v3 is the peak on
five of the six rarities.

- **common** — v2: the same two caps, but the right-hand cap tips lower and
  closer to the bowl's rim, and the rim's teeth are taller and sharper. Throw
  several more chips outward so two or three land on the ground clear of the
  nest, one at the left and a larger flake at the lower right.
  v3: hold both caps higher and further apart than the base, with a spray of
  small shards suspended in the gap between them and around their edges. Cut the
  bowl's rim into a deep jagged crown with several tall notches, and scatter
  chips widely to both sides, several of them clearing the nest onto the ground.
  v4: bring the two caps closer together so the gap between them is narrow, and
  make the bowl's rim a shallower, more even zigzag. Almost nothing in the air —
  the fragments are larger and rest low, in the nest and on the ground beside it
  at the left and right.
- **uncommon** — v2: the same two caps, with the fine shards between them fanned
  up and out to the right past the nest's edge, and two or three flakes landed on
  the ground on each side.
  v3: caps higher and wider apart with more small shards in flight around them,
  the bowl's rim cut into deep notches, and chips scattered all the way around
  the nest.
  v4: a single wide sweeping crescent of shell above the egg, tilted to the
  left — the base's two caps merged into one piece, with no second cap at all.
  Nothing in the air. The bowl's rim is a broad, blunt-toothed wave with one
  chunk broken out of its right side, and the fragments are large and resting on
  the ground at the left and right of the nest.
- **rare** — v2: the same two caps, with one small shard suspended in the gap
  between them, and the bowl's rim taller and more sharply peaked. A large
  fragment leans against the nest at the right and a flat chip lies on the ground
  at the lower left.
  v3: both caps lifted higher and further apart, with a burst of small shards
  scattered between them and off to the right, and a few more floating to the
  left of the egg. The bowl's rim is a tall jagged crown.
  v4: only one cap remains, a crescent tipped over the upper left; the second is
  gone. The bowl's rim is a wide, deeply V-notched crown, and the fragments are
  large, low and still — resting on the ground to the left and right of the nest
  rather than in the air.
- **epic** — v2: break the base's single domed lid into pieces. Keep the wide
  arc on the left, then a gap, then a loose cluster of three or four separate
  crystal chunks, then the small piece at the right. Throw more chips outward,
  with a large flat shard on the ground at the right and two more at the lower
  left.
  v3: keep the lid as one wide arc as in the base but hang more crystal points
  from its underside, and let chips fall in a curtain down both sides of the
  egg, dense with small shards all around the nest.
  v4: a single narrower crescent lid tipped to the right, the rest of it gone.
  Open the bowl's rim wider, and make the fragments chunky and low — heavy
  pieces on the ground at the left and right rather than small chips in the air.
- **legendary** — v2: crack the base's domed cap across itself into blocky
  plates, so fault lines run over the lid without separating it. Add more
  flakes, two flat ones on the ground at the lower left and a larger one at the
  lower right.
  v3: keep the cap's shape but break one shard off its right edge, and scatter
  the flakes further down both sides onto the ground.
  v4: split the cap into two separate pieces — a taller half tipped to the left
  and a smaller half tipped to the right, with a clear gap between them. The
  bowl's rim is a shallower ridge, and flat gold flakes lie strewn on the ground
  to the left and right of the nest.
- **mythic** — v2: keep the base's single tilted cap and add the fragments the
  base does not have: several chunky obsidian shards floating clear of the shell
  at the left and right, one flake resting on the ground at the lower left, and
  a small chip up near the top right.
  v3: the same cap, with the fragments spread into a wider halo to the left and
  right and more small pieces gathered around the base of the nest. The lava
  glow inside the open shell is brighter than the base's.
  v4: split the cap into two — a larger piece over the left and a separate
  rounded piece at the upper right. More chunks, and heavier ones, in and around
  the nest and on the ground to the right.

Measured fragment counts, **as committed today** — `scripts/count-regions.mjs`'s
`significant` column, i.e. opaque regions over 40px:

| Rarity | base | v2 | v3 | v4 |
|---|---|---|---|---|
| common | 6 | 6 | 15 | 5 |
| uncommon | 6 | 12 | 17 | 6 |
| rare | 5 | 8 | 12 | 5 |
| epic | 4 | 9 | 11 | 3 |
| legendary | 5 | 9 | 10 | 5 |
| mythic | 1 | 7 | 10 | 6 |

**Read `significant`, not `regions`.** `count-regions.mjs` prints the raw region
total first, and on the seven files the backdrop repair rewrote that total is
dominated by matte dust the repair leaves behind — `common-crack` reads 68
regions, `common-crack-v4` 188, against the 6 and 5 real fragments above. Every
other file's two columns agree exactly. This table is the second column on every
row; comparing a regenerated file's `regions=` against it will look like a
catastrophic change that did not happen.

The seven repaired files were re-measured afterwards. The repair severs pale
bridges the backdrop had been forming between pieces meant to be separate, so
fragment counts **rose**: the `common` row went 3 → 6, 4 → 6, 8 → 15 and 3 → 5
across base and variants, while `mythic-crack-v2` (7), `rare-crack-v2` (8) and
`rare-crack-v3` (12) were unchanged. Nothing was lost — every fragment survived.
One caution if a future repair is ever measured mid-flight: between the two
passes the `common` counts read higher still (7, 8, 17, 6), because
partial-alpha residue blobs of over 40px were themselves being counted as
fragments until the second pass cleared them. A count that rises after a repair
is not automatically good news; look at the picture.

Every variant lands above one fragment, so no variant lost its shell pieces. Note
the `mythic` row reads oddly on purpose: its **base** is the one committed crack
that genuinely sits at a single region, and all three of its variants carry more
fragments than it does. That is fine — more fragments is the intended look, and
the base is the outlier, not the variants.

Re-measure with `scripts/count-regions.mjs` (a 4-connected flood fill over the
alpha channel) if any of these is ever regenerated. A `significant` count of
**1** on a non-`mythic-crack` file means the fragments were lost and the file
must be regenerated rather than shipped — which is exactly what
`tests/images.test.ts` asserts per file, so a regeneration that loses them fails
the suite rather than waiting to be noticed.

## Emoji icons

The 57 application emojis in `assets/emojis/` are **not** generated — they are
hand-authored SVG rendered by `npm run build-emojis`. That set includes the six
`dw_dino_<rarity>` chips and the six `dw_lot_*` icons the park renderer reads
as SVG at draw time, plus the four `dw_trait_<domain>` icons (income, care,
combat, meta) used inline wherever a dino's traits are listed. See the emoji
bullets in the repo `CLAUDE.md` for the pipeline and its two rendering gotchas.

**Daily loop trio** — used inline on the `/daily` hub and reward embeds:

| File | Design intent | Unicode fallback |
| --- | --- | --- |
| `dw_quest.svg` | A dartboard-style target (gold outer ring, cream middle ring, red bullseye) with a dart stuck dead center, gold-brown palette matching `dw_cash`/`dw_star` | 🎯 |
| `dw_streak.svg` | A two-tone stylized flame — a red-orange outer silhouette with a brighter yellow-orange inner flame layered on top | 🔥 |
| `dw_chest.svg` | A wooden treasure chest: domed lid and body in a warm wood-brown gradient, gold trim bands across the seam and down the front, a small gold lock plate at the seam | 🎁 |

**Endgame site markers** — used inline in expedition embed titles for the endgame sites:

| File | Design intent | Unicode fallback |
| --- | --- | --- |
| `dw_site_abyssal_trench.svg` | A deep-sea submersible, side-on, floating on transparency: a rounded blue-to-navy gradient hull (stadium shape), a small conning tower on top, a pointed tail fin at the rear, one large pale-cyan porthole toward the front, and a small amber lamp at the nose with a short amber light cone reaching forward, dark navy (`#0b2233`) outlines throughout — a trench is negative space, so the site is represented by the vehicle you'd find exploring one, the same way Coastal Dig is represented by a shell rather than a hole in the sand | 🌊 |
| `dw_site_containment_site.svg` | A short fence — four vertical slate posts crossed by two horizontal rails, no enclosing frame — with a yellow warning triangle mounted centered over it bearing a dark exclamation mark, dark slate (`#1b2530`) outlines throughout | 🧪 |
| `dw_site_founders_park.svg` | A stone archway gate: two upright stone pillars and a stone lintel (`#c4bcac`-to-`#6f6960` gradient) framing a warm gold-to-rust sunset sky (`#f0b458`-to-`#8c4a2f` gradient) in the opening, with a jagged dark-green overgrowth silhouette rising through the gap and a dark ground band underfoot — the ruined park's own entrance arch stands in for the site, the same way Coastal Dig is represented by a shell rather than a hole in the sand | 🏛️ |

**World event bulletin** — nine event emoji, one per `WORLD_EVENTS` entry (`src/data/world-events.ts`), used inline on the `/world` hub and event headlines; all nine share the same circular-badge footprint (a stroked r=27 background circle) so the set reads as one bulletin:

| File | Design intent | Unicode fallback |
| --- | --- | --- |
| `dw_event_clear_skies.svg` | A sky-blue badge with a small gold sun disc and eight radiating rays | ☀️ |
| `dw_event_amber_storm.svg` | A dark storm-blue badge with a gray cloud cluster and an amber lightning bolt striking through it | 🌩️ |
| `dw_event_fossil_rush.svg` | A tan badge with a cream dog-bone shape — a shaft with four rounded knob ends | 🦴 |
| `dw_event_heat_wave.svg` | A hot orange-red badge with a two-tone layered flame and a faint heat-shimmer wave beneath it | 🔥 |
| `dw_event_cold_snap.svg` | An icy blue-white badge with a white six-armed snowflake, each tip carrying a small branch tick | ❄️ |
| `dw_event_bumper_harvest.svg` | A golden badge with three fanned wheat stalks converging at the base, each topped with a grain-head ellipse | 🌾 |
| `dw_event_market_panic.svg` | A dusty-red alarm badge with three descending cream bars and a dark diagonal arrow cutting down through them | 📉 |
| `dw_event_blood_moon.svg` | A near-black night-sky badge with a red crescent moon — a dark occluding circle overlapping a red disc — and a scatter of small white stars | 🩸 |
| `dw_event_migration_season.svg` | A blue-violet badge with a wide double-helix strand, evoking both wandering bloodlines and the trait odds the event reshuffles | 🧬 |

**Utility icons** — four hand-authored icons for the attendance, season, duel and landmark surfaces:

| File | Design intent | Unicode fallback |
| --- | --- | --- |
| `dw_guest.svg` | Two park visitors on transparency, near figure teal and far figure gold, each a domed-shoulder torso path with its head circle drawn over it so the two shapes read as one silhouette; a single flat white gloss on the near head | 👥 |
| `dw_season.svg` | A violet medal disc on two blue ribbon tails, its face carrying three stacked gold chevrons — the season ladder's rungs. Ribbons are drawn first so the disc overlaps them | 🏅 |
| `dw_duel.svg` | A disc split blue on the left and red on the right for the two duellists, with a gold clash bolt struck through it overshooting the rim top and bottom. Distinct from `dw_event_amber_storm`'s amber bolt, which sits on a single-tone storm-blue badge behind a cloud | ⚔️ |
| `dw_landmark.svg` | A grey stone obelisk with a gold capstone and a gold plaque, standing on a two-step plinth — the prestige ladder's monument, matching the `park/landmark-a\|b\|c.webp` tile family | 🗿 |

## Bot branding (animated avatar and banner)

The bot's Discord profile art (`assets/branding/`) is generated with Higgsfield
Nano Banana Pro for the two stills and Seedance 2.0 for the two motion clips,
then encoded to looping GIF by `scripts/make-gif.ts` (ffmpeg, via
`npm run make-gif`) and applied with `npm run deploy-branding`
(`src/deploy-branding.ts`). `assets/branding/` is a deliberately separate tree
from `assets/images/` — see the branding bullet in the repo `CLAUDE.md` for why.

### File targets

| File | Size | Use |
|---|---|---|
| `assets/branding/icon.png` | 1024×1024 | Developer Portal App Icon (static-only field, distinct from the bot user's avatar) |
| `assets/branding/banner-still.png` | 1360×480 | static fallback / future App Directory cover |
| `assets/branding/avatar.gif` | 512×512, GIF89a, loop forever | bot avatar (animated) |
| `assets/branding/banner.gif` | 680×240, GIF89a, loop forever | bot profile banner (animated) |

Discord's hard ceiling is 10 MB per file (`BRANDING.discordMaxBytes`); the
encoder budgets **8 MB** (`BRANDING.maxBytes`) and fails loudly rather than
shipping something Discord would reject at upload. Both committed GIFs land
well under that: `avatar.gif` is 6.21 MB (50 frames, 10 fps), `banner.gif` is
1.72 MB (61 frames, 12 fps).

### Stills (`nano_banana_pro`)

The avatar still is generated with the shipped
`assets/images/dinos/bruiser-carnivore.webp` cutout uploaded as a real
reference (`media_upload` → presigned PUT → `media_confirm` → `media_id`),
Nano Banana Pro `medias` role **`image`** — not `image_references`.
`models_explore(action: "get", model_id: "nano_banana_pro")` declares the
model's only accepted role as `image`; the generated avatar visibly picked up
the reference character, confirming it. The banner still carries no reference.

**Avatar still**, `aspect_ratio: "1:1"`, reference = `bruiser-carnivore.webp`:

> Keep the exact character from the reference image — same crimson-red T-rex, charcoal dorsal ridge, cream underbelly, amber-orange eye, same bold dark outlines and glossy cel shading. Head-and-shoulders close-up, three-quarter view facing right, head filling the center of a square frame. Volcanic setting: dark basalt rock, molten lava-orange rim light along the jaw and crest, embers floating upward, deep charcoal-to-ember-red radial background, soft heat haze. Head fully inside the central circle; only embers and glow in the corners. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no UI elements.

**Banner still**, `aspect_ratio: "21:9"`, no reference:

> A single continuous panoramic dinosaur park landscape at golden-hour sunset, one unbroken scene with one continuous horizon line. Toward the left of frame it is quiet and open: warm sky, soft clouds, distant birds, a low canopy silhouette, no focal subject. Through the middle of the scene, a lush valley with a winding dirt path, palms and ferns, and a wooden park gate with lit torches. Toward the right, sauropods grazing beside a lake, a pterosaur gliding, and a smoking volcano cone on the far horizon with a faint ember glow. Generous empty sky above and open ground below so the image can be cropped to a short wide strip. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. NOT a triptych, NOT a diptych — no panel divisions, no vertical seams, no borders, no split-screen, no collage. No text, no UI elements.

A first attempt phrased the composition as "Left third quiet … Center: … Right
third: …" — the same "third" shorthand this file uses elsewhere for two-image
edits. The model read it literally and rendered a three-panel triptych with
hard vertical seams and independent horizons at the 1/3 and 2/3 marks, not one
continuous scene; content and palette were correct, only the framing was
wrong. The fix, above, drops "thirds" language for "toward the left / through
the middle / toward the right" of *one* continuous horizon, and adds an
explicit ban on panel/seam/collage composition. Regenerating from the
literal-thirds phrasing will reproduce the triptych.

**Post-processing:** `icon.png` is a direct copy of the approved avatar still
(already 1024×1024 — Nano Banana Pro's square output at this aspect, no
re-encode needed). `banner-still.png` is built from the banner still (1584×672
native at `21:9`) with `-vf "crop=1584:560,scale=1360:480:flags=lanczos"` — a
56px top/bottom trim to the 2.83:1 centre crop, then Lanczos-scaled to the
1360×480 contract size.

### Motion (`seedance_2_0`)

Both clips loop by construction: `medias` sets `start_image` **and**
`end_image` to the same stills `job_id`, so the clip is constrained to end
where it began, and stage-1 output chains natively by id — no re-upload
between stages.

| | aspect | resolution / mode | duration | audio | cost |
|---|---|---|---|---|---|
| avatar | `1:1` | 720p / std | 5 s | off | 22.5 credits |
| banner | `21:9` | 720p / std | 5 s | off | 22.5 credits |

Banner resolution is **720p**, not the 1080p originally planned: the delivered
banner asset is 680×240, and 21:9 at 720p is already 1280×548 — more than
double the delivered size — so 1080p would have been discarded at encode for
no benefit. Both delivered clips also came back larger than the resolution
requested (avatar: 960×960 against a 720×720 request; banner: 1470×630 against
a 1344×576 request) — `job_status` echoes the *requested* dimensions, not the
delivered ones; trust a probe of the downloaded file over the echo.

`use_unlim: true` was **rejected** for both clips ("Unlimited generations
aren't supported for seedance_2_0"), even though `models_explore` shows the
model itself declaring `supports_unlim: true` — the account-level `unlim`
allowance was simply unavailable at generation time. No credits are spent on a
rejection; both clips ran on credits only after that was reported and
approved, 22.5 each.

**Avatar motion**, unchanged from the first attempt — approved as-is:

> Subtle ambient loop. The T-rex breathes slowly once, blinks once, slight jaw shift. Embers drift upward, lava glow flickers. Camera locked — no zoom, no pan, no push-in. Nothing enters or leaves frame. Ends exactly as it began.

**Banner motion**, accepted version after one reroll:

> Subtle ambient loop, five seconds, ending in exactly the same state it began. Torch flames flicker, palm fronds sway gently in a light breeze, water ripples softly, volcano smoke curls upward. Every animal stays fully inside the frame the entire time and returns to its exact starting position and pose by the end: the pterosaur hovers and banks in place in the upper left sky without ever crossing or leaving the frame edge, and the sauropods shift their weight gently in place without lowering or raising their heads. Nothing enters the frame, nothing leaves the frame, nothing appears, nothing disappears. Camera locked — no pan, no zoom, no parallax, no drift. The final frame must match the first frame exactly.

The first banner clip used the shorter prompt ("Subtle ambient loop. Torch
flames flicker, fronds sway … one pterosaur glides across the sky, a distant
sauropod dips its head to drink and lifts it … Ends exactly as it began.").
Camera lock and framing were correct, but comparing first and last frame
showed the pterosaur had left the frame entirely by the last frame — it would
pop back into existence at the loop point — and the sauropod ended head-down
at the water when it started head-up, so it would snap upright on restart.
"Ends exactly as it began" states the intent but gives the model nothing to
hold each individual subject to — it is not sufficient on its own. The fix
names every animal, pins each to staying fully in frame, and states its
required starting *and* ending pose explicitly. Regenerating from the shorter
prompt is not guaranteed to avoid the same drift.

One operational note: the first `generate_video` call with the accepted
banner prompt above did not start a job at all — the tool intercepted it with
a preset-recommendation notice (it guessed the prompt matched a Higgsfield
preset) and asked for confirmation before generating literally. Nothing is
charged for that call. Resending the identical prompt with
`declined_preset_id` set to the offered preset id starts the job with the
literal prompt, which is what actually ran.

Total spend across the whole pipeline: 2 (avatar still) + 2 (banner still,
rejected triptych) + 2 (banner still, accepted reroll) + 22.5 (avatar clip) +
22.5 (banner clip, rejected loop-seam) + 22.5 (banner clip, accepted reroll) =
**73.5 credits**.

### Encode (`scripts/make-gif.ts`)

Filter chain (`buildFilter` in `scripts/make-gif.ts`):

```
fps=<fps>,[crop=in_w:in_w/<cropAspect>,]scale=<width>:<height>:flags=lanczos,split[a][b];
[b]palettegen=stats_mode=diff[p];[a][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle
```

with `-loop 0`. Why these flags, since they are the whole reason the file fits
in budget:

- `palettegen=stats_mode=diff` spends the 256-colour palette on pixels that
  actually change between frames, instead of averaging over the whole static
  scene — an ambient loop is mostly static, so this is where most of the
  palette budget goes.
- `paletteuse=diff_mode=rectangle` leaves unchanged regions byte-identical
  frame to frame, which is where nearly all of the actual file-size
  compression comes from on a loop like this.
- `dither=bayer` (ordered dithering) instead of the default Floyd-Steinberg
  error diffusion: error diffusion re-dithers the static background
  differently on every single frame, which both destroys the redundancy
  `diff_mode=rectangle` is counting on and visibly shimmers on flat gradients
  (the volcano backdrop, the sky). Ordered dithering is stable frame to frame.

**Budget and frame-rate ladder:** the encoder budgets 8 MB (`BRANDING.maxBytes`)
against Discord's 10 MB hard ceiling (`BRANDING.discordMaxBytes`). Over budget,
it steps frame rate down the ladder `12 → 10 → 8` (`nextStep`,
`BRANDING.fpsFloor = 8`) and re-encodes, logging each attempt; it hard-fails
below 8 fps rather than shipping something over budget — that failure is a
signal about the *clip* (the motion is broader than "subtle ambient" calls
for), not the encoder, and the fix is a reroll. Dimensions never move on this
ladder — 512×512 and 680×240 are contract values `tests/branding.test.ts`
asserts exactly, and a ladder that shrank the canvas instead would make the
committed asset's size depend on how much the clip happened to move.

The ladder never actually fired for either committed file — both cleared 8 MB
on the first rung. `banner.gif` shipped at its first-attempt 12 fps (1.72 MB).
`avatar.gif` was deliberately re-encoded from 12 fps (7.33 MB) down to 10 fps
(6.21 MB) after review — a size-on-disk choice, not the ladder engaging (7.33
MB was already under the 8 MB budget): the avatar renders at ~40 px in a
Discord chat list, where 10 fps and 12 fps are visually indistinguishable.

Both GIFs are reproducible from a regenerated `avatar.mp4` / `banner.mp4` (the
Higgsfield clip downloads — not committed to the repo) with:

```
npm run make-gif -- avatar.mp4 assets/branding/avatar.gif --width 512 --height 512 --fps 10
npm run make-gif -- banner.mp4 assets/branding/banner.gif --width 680 --height 240 --fps 12 --crop-aspect 2.8333
```

The banner's `--crop-aspect 2.8333` trims the source clip's native `21:9`
(2.33:1) down to the 680:240 (2.83:1) target before scaling — the same crop
ratio the banner still was composed with dead headroom for. The avatar needs
no crop: its source clip is already `1:1`.
