# Image generation prompts — egg, expedition site, and banner art

The volcano/frozen banners and volcano thumb were generated with ChatGPT image
generation; the remaining coastal/amber banners and the coastal/amber/frozen
thumbs were generated with Higgsfield Nano Banana Pro. The six egg rarities were
generated with Higgsfield Nano Banana Pro as a reference chain (see the Egg
rarities section). The 26 embed banners were generated with Higgsfield
Nano Banana Pro, `care_neglect` as a reference chain off `care` and
`battle_defeat` off `battle_victory`. The six hatch cracks were generated as
reference-chain edits of their own egg icons. These prompts are the source of
truth for regenerating or extending the set — keep them in sync with any new
assets.

Note on thumbs: some models render a "square cartoon game icon of …" prompt as
a rounded-rectangle app-icon tile with a border. To force a full-bleed square
(artwork to all four edges, no tile), phrase the thumb as a "close-up cartoon
scene filling the entire square frame edge to edge … NOT an app icon — no
rounded-rectangle tile, no border, no rounded corners" rather than "game icon".

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

\* Except the shipped `assets/images/sites/volcano_core-thumb.webp`, which is
**1254×1254** — a discrepancy from the original PNG's IHDR that predates the
WebP conversion, not something that conversion introduced. Not resized as
part of that pass; a future regeneration should target 1024×1024 to match the
other three site thumbs.

**Output format.** Every committed file under `assets/images/` is **WebP, quality 95**,
encoded through `@napi-rs/canvas`'s `canvas.toBuffer('image/webp', 95)`, and
indistinguishable from PNG at the sizes Discord renders. The conversion pass that
introduced it took the 40 files committed at the time from **63.4 MB of PNG to 8.9 MB
of WebP** — about 86% smaller in aggregate.
`scripts/fit-art.mjs` emits it directly, so both modes write the shipped format and no
separate conversion step is needed. Intermediates are exempt: a generator's output and
the `remove_background` result in the walkthroughs below are whatever the tool produced
(usually PNG), and only the final write is WebP. `assets/emojis/png/` is **not** WebP —
Discord's application-emoji upload expects PNG and `manifest.json` hashes those exact
bytes — and `assets/emojis/svg/` stays SVG because the park renderer decodes it
synchronously.

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

*Remedy:* drop the chunk before decoding. It is pure provenance metadata, is
read nowhere in this codebase, and would not survive re-encoding to WebP in any
case, so removing it is pixel-for-pixel content-neutral. Walk the chunk stream
and copy everything except `caBX`:

```js
// PNG = 8-byte signature, then [4B length][4B type][data][4B CRC] chunks.
function stripCaBX(buf) {
  const out = [buf.subarray(0, 8)];
  for (let p = 8; p + 8 <= buf.length; ) {
    const end = p + 12 + buf.readUInt32BE(p);
    if (buf.toString('latin1', p + 4, p + 8) !== 'caBX') out.push(buf.subarray(p, end));
    p = end;
  }
  return Buffer.concat(out);
}
img.src = stripCaBX(readFileSync(src));   // instead of readFileSync(src)
```

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

Site ids: `coastal_dig`, `amber_ridge`, `frozen_cliffs`, `volcano_core`.

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

**This 5-step pass is a one-off, NOT `scripts/fit-art.mjs`.** The committed
script's `cutout` mode implements a subset — alpha threshold, the 3-pass
luminance peel of step (2), then a whole-bbox fit at 0.94 (a 31px margin) — with
no largest-region step, no border flood, no 2px shave, and no egg-axis bias.
That is deliberate, and the two are not interchangeable:

| | margin on tight axis | centering | regions kept |
|---|---|---|---|
| `assets/images/eggs/` (this one-off pass) | 24px | egg axis — L/R margins are asymmetric on purpose (e.g. `common.webp` L74/R53) | 1 |
| `assets/images/battles/` (same pass, whole-bbox variant) | 24px | whole bbox | 1 |
| `assets/images/hatch/` (`fit-art.mjs cutout`) | 31px | whole bbox | all (see Hatch cracks) |
| `assets/images/dinos/` (`fit-art.mjs cutout`) | 31px | whole bbox | all (a clean portrait cutout lands at 1) |

Consequences when reusing either pass on a new or regenerated asset:

- Running `fit-art.mjs cutout` on a regenerated **egg** or **boss portrait**
  yields a slightly smaller, whole-bbox-centred subject than the committed set —
  visible side by side in an embed thumbnail row. Either accept the shift for the
  whole family or redo the one-off pass; do not mix the two within one family.
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

**Thumb (1024×1024):**

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

**Thumb (1024×1024):**

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

**Thumb (1024×1024):**

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

**Thumb (1024×1024):**

> A square cartoon game icon of a single black obsidian volcano peak with
> glowing orange lava cracks and a small lava eruption at the top, simple dark
> ember-lit sky background. Centered composition, large readable shapes.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no characters, no UI elements.

## Abyssal Trench (`abyssal_trench`)

Generated at 2528×1696 (3:2, resolution `2k`), fitted to 1536×1024 for the
banner; the thumb is a centered square crop of the same source, resized to
1024×1024 (not a squash).

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
same upscaled source, resized to 1024×1024 (not a squash).

**Banner (1536×1024) and Thumb (1024×1024), same source:**

> A rain-slick dinosaur research compound at night behind heavy electrified fencing,
> tall floodlight towers cutting bright cones through drifting mist, a breached inner
> paddock gate hanging open with bent steel bars, yellow warning chevrons painted on
> wet concrete, puddles reflecting the lights, cold teal and sodium-amber palette,
> wide cinematic establishing shot. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel shading
> with smooth gradients, polished game-asset look. No text, no characters, no UI
> elements.

---

## Embed banners

26 wide banners for the surfaces that have no site or egg art of their
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
| `assets/images/banners/eggs_incubator.webp` | 1536×1024 | `/eggs` embed image |
| `assets/images/banners/sell.webp` | 1536×1024 | `/sell` confirmation prompt embed image |
| `assets/images/banners/gene_lab.webp` | 1536×1024 | `/breed` confirm/status/claim embed image |
| `assets/images/banners/gene_splice.webp` | 1536×1024 | `/splice` preview/result embed image |
| `assets/images/banners/daily.webp` | 1536×1024 | `/daily` hub embed image |
| `assets/images/banners/achievements.webp` | 1536×1024 | `/achievements` embed image |
| `assets/images/banners/event-clear_skies.webp` | 1536×1024 | `/world` hub embed image, Clear Skies |
| `assets/images/banners/event-amber_storm.webp` | 1536×1024 | `/world` hub embed image, Amber Storm |
| `assets/images/banners/event-fossil_rush.webp` | 1536×1024 | `/world` hub embed image, Fossil Rush |
| `assets/images/banners/event-heat_wave.webp` | 1536×1024 | `/world` hub embed image, Heat Wave |
| `assets/images/banners/event-cold_snap.webp` | 1536×1024 | `/world` hub embed image, Cold Snap |
| `assets/images/banners/event-bumper_harvest.webp` | 1536×1024 | `/world` hub embed image, Bumper Harvest |
| `assets/images/banners/event-market_panic.webp` | 1536×1024 | `/world` hub embed image, Market Panic |
| `assets/images/banners/event-blood_moon.webp` | 1536×1024 | `/world` hub embed image, Blood Moon |
| `assets/images/banners/event-migration_season.webp` | 1536×1024 | `/world` hub embed image, Migration Season |

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

---

## Battle bosses

Six boss portraits for the PvE campaign (`/battle`), used as `setThumbnail`
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

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the dinosaur silhouette — off-silhouette glow survives
background removal as floating islands or a light halo on transparency.
Emissive detail is allowed only ON surfaces (lava cracks, frost sheen, wet
scales). Every prompt carries this rule verbatim.

**Workflow (reference chain):** generate the coastal portrait first on a
plain flat light-gray studio background, head-and-shoulders three-quarter
framing filling the square with a small even margin. Generate the other three
as image-edits of the approved coastal portrait (Nano Banana Pro, `medias`
role `image`) so pose, framing, and rendering read as a set — all three edit
from the coastal portrait directly, never from each other. Post-process each
with `remove_background` plus the one-off defringe + fit pass described in the Egg
rarities section (not `scripts/fit-art.mjs`, which fits to 31px), with one
difference: portraits fit and center on the **whole silhouette bbox** (there is
no egg axis to bias toward), 24px margin on a 1024×1024 transparent canvas — the
margin all six committed portraits measure at.

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
  generation attempt drifted off-model against the other three bosses — thin
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
  came back facing left, mirrored against the other three bosses, which all
  face right — snout/beak pointing right — matching the coastal_dig
  reference. Rather than risk losing the now-approved outline/saturation fix
  on a third generation, the committed `boss-frozen_cliffs-portrait.webp` is
  that same approved asset horizontally flipped in post (alpha-preserving,
  1024×1024 dimensions unchanged) to restore right-facing orientation. A
  future regeneration from this prompt is not guaranteed to land right-facing
  either — check orientation against the other three bosses before shipping,
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
have traded eight images for roughly twelve plus a migration across all 40
species files, to fix fidelity for a handful of outliers like this one.

**Style: deliberately simpler than the six boss portraits.** Same house
glossy-cartoon treatment and the same head-and-shoulders three-quarter framing,
but flatter: clean archetype silhouettes, no scarring, no individuating damage,
no character detail. These land in the same thumbnail slot as the boss portraits
and sometimes in the same command — a boss must read as a named individual,
these must read as a *kind*.

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the dinosaur silhouette — off-silhouette glow survives background
removal as floating islands or a light halo on transparency. Emissive detail is
allowed only ON surfaces. Every prompt carries this rule verbatim.

**Facing right:** all six committed boss portraits face right, snout pointing
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
generation directly.

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
the six committed cracks have 3–6 regions (`uncommon` 6, `legendary` and `rare` 5,
`epic` 4, `common` 3; only `mythic` happens to land at 1). Step (1) of the Egg
rarities pass — "keep only the largest connected region" — and its "exactly one
connected region" verification are therefore **not** part of this family's
post-processing: applying either would silently delete the fragments and leave a
plain open egg, and `fit-art.mjs cutout` correctly keeps every region. No test
catches that loss (`tests/images.test.ts` checks size and corner transparency
only), so it is a review-by-eye property: after regenerating, confirm the falling
fragments survived. What still applies from that pass is the *defringe* half —
the light studio rim must be peeled, and all border pixels must end transparent.

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

## Emoji icons

The 52 application emojis in `assets/emojis/` are **not** generated — they are
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

**Endgame site markers** — used inline in expedition embed titles for the two endgame sites:

| File | Design intent | Unicode fallback |
| --- | --- | --- |
| `dw_site_abyssal_trench.svg` | A deep-sea submersible, side-on, floating on transparency: a rounded blue-to-navy gradient hull (stadium shape), a small conning tower on top, a pointed tail fin at the rear, one large pale-cyan porthole toward the front, and a small amber lamp at the nose with a short amber light cone reaching forward, dark navy (`#0b2233`) outlines throughout — a trench is negative space, so the site is represented by the vehicle you'd find exploring one, the same way Coastal Dig is represented by a shell rather than a hole in the sand | 🌊 |
| `dw_site_containment_site.svg` | A short fence — four vertical slate posts crossed by two horizontal rails, no enclosing frame — with a yellow warning triangle mounted centered over it bearing a dark exclamation mark, dark slate (`#1b2530`) outlines throughout | 🧪 |

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
