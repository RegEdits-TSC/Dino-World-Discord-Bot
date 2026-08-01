# Image generation prompts — egg, expedition site, and banner art

The volcano/frozen banners and volcano thumb were generated with ChatGPT image
generation; the remaining coastal/amber banners and the coastal/amber/frozen
thumbs were generated with Higgsfield Nano Banana Pro. The six egg rarities were
generated with Higgsfield Nano Banana Pro as a reference chain (see the Egg
rarities section). The fifteen embed banners were generated with Higgsfield
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

---

## Embed banners

Fifteen wide banners for the surfaces that have no site or egg art of their own.
All generated with Higgsfield Nano Banana Pro at 3:2, then scaled to 1536×1024
(the generator emits 1264×848; scaling to full width leaves ~6px of vertical
excess, which is center-cropped).

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

---

## Battle bosses

Four boss portraits for the PvE campaign (`/battle`), used as `setThumbnail`
on frames F3/F4 of boss stages. Null-degrade everywhere: the campaign ships
fully playable with zero battle art.

| File | Size | Use |
|---|---|---|
| `assets/images/battles/boss-coastal_dig-portrait.webp` | 1024×1024, transparent | Old Riptooth (Baryonyx), Coastal Dig boss frames |
| `assets/images/battles/boss-amber_ridge-portrait.webp` | 1024×1024, transparent | Ridgeback Alpha (Allosaurus), Amber Ridge boss frames |
| `assets/images/battles/boss-frozen_cliffs-portrait.webp` | 1024×1024, transparent | Stormwing (Quetzalcoatlus), Frozen Cliffs boss frames |
| `assets/images/battles/boss-volcano_core-portrait.webp` | 1024×1024, transparent | The Tyrant King (Tyrannosaurus), Volcano Core boss frames |

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
margin the four committed portraits measure at.

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
`herbivore` or `carnivore`. `support-carnivore` has no species today and is
generated anyway — the guarantee is that adding a species never needs new art.

**Fidelity cost of the fixed set:** `archetype` is a combat concept, not a
body-plan one, so the guarantee above buys loose anatomical fidelity for
outliers. `swift-carnivore` covers both `velociraptor` and `quetzalcoatlus` —
a beaked pterosaur — and the shared portrait is a scaled toothy theropod, not
anything pterosaur-shaped. Accepted deliberately, not an oversight: a
per-species `silhouette` field was considered and declined, since it would
have traded eight images for roughly twelve plus a migration across all 30
species files, to fix fidelity for a handful of outliers like this one.

**Style: deliberately simpler than the four boss portraits.** Same house
glossy-cartoon treatment and the same head-and-shoulders three-quarter framing,
but flatter: clean archetype silhouettes, no scarring, no individuating damage,
no character detail. These land in the same thumbnail slot as the boss portraits
and sometimes in the same command — a boss must read as a named individual,
these must read as a *kind*.

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the dinosaur silhouette — off-silhouette glow survives background
removal as floating islands or a light halo on transparency. Emissive detail is
allowed only ON surfaces. Every prompt carries this rule verbatim.

**Facing right:** all four committed boss portraits face right, snout pointing
right, and one boss generation came back mirrored and had to be flipped in post
(see Battle bosses). The prompt frame below states the direction up front —
still check every generation against the reference before shipping it.

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

The 38 application emojis in `assets/emojis/` are **not** generated — they are
hand-authored SVG rendered by `npm run build-emojis`. That set includes the six
`dw_dino_<rarity>` chips and the six `dw_lot_*` icons the park renderer reads
as SVG at draw time, plus the four `dw_trait_<domain>` icons (income, care,
combat, meta) used inline wherever a dino's traits are listed. See the emoji
bullets in the repo `CLAUDE.md` for the pipeline and its two rendering gotchas.
