# Image generation prompts — egg + expedition site art

The volcano/frozen banners and volcano thumb were generated with ChatGPT image
generation; the remaining coastal/amber banners and the coastal/amber/frozen
thumbs were generated with Higgsfield Nano Banana Pro. The six egg rarities were
generated with Higgsfield Nano Banana Pro as a reference chain (see the Egg
rarities section). These prompts are the source of truth for regenerating or
extending the set — keep them in sync with any new assets.

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
| `assets/images/sites/<id>-banner.png` | 1536×1024 | `/expedition claim` full-width embed image |
| `assets/images/sites/<id>-thumb.png` | 1024×1024 | `/expedition start` + `status` embed thumbnail |

Banner = wide establishing shot of the site. Thumb = square icon-style
composition with one central landmark and a simple background (readable at
80px — do not just crop the banner).

Site ids: `coastal_dig`, `amber_ridge`, `frozen_cliffs`, `volcano_core`.

---

## Egg rarities

The six egg icons in `assets/images/eggs/` share one silhouette so they read as
a set; rarity is expressed only through shell color, pattern, and escalating
effects. Shell colors track the embed accent colors in
`src/modules/hatchery/embeds.ts`.

| File | Size | Use |
|---|---|---|
| `assets/images/eggs/<rarity>.png` | 1024×1024, transparent | hatch-reveal hero + shop/hatchery embed thumbnail |

`<rarity>` is one of `common`, `uncommon`, `rare`, `epic`, `legendary`,
`mythic`.

**Workflow (reference chain):** generate the common egg first on a plain flat
light-gray studio background, then generate the other five as image-edits of the
common egg (Nano Banana Pro, `medias` role `image`) so the silhouette stays
identical. Run each result through `remove_background`, then center on a
1024×1024 transparent canvas. Any glow/rays/embers that fall outside the shell
survive as floating islands on transparent — this matches the old floating egg
look on the Discord embed background.

**Common (reference egg):**

> A single large cartoon dinosaur egg standing upright, perfectly centered:
> smooth gray-white eggshell with scattered small brown speckles, one soft
> glossy highlight on the upper left of the shell. Plain flat light-gray studio
> background, no scenery. Centered composition, large readable shape filling
> most of the frame. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no characters, no UI
> elements.

**Reskin edits** (each generated with the common egg attached as the `image`
reference). Prompt frame:

> Keep the exact same cartoon dinosaur egg: same shape, same size, same
> position, same outline, same framing, same plain flat light-gray studio
> background. Change only the shell design: {RESKIN}. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

`{RESKIN}` per rarity:

- **uncommon:** moss-green eggshell (around #2ecc71) decorated with a simple
  pattern of small darker-green leaf shapes, subtle glossy highlight
- **rare:** ocean-blue eggshell (around #3498db) with a wavy water-sheen pattern
  wrapping the shell and a few small water droplets on the surface, glossy
  wet-look highlights
- **epic:** violet eggshell (around #9b59b6) with angular crystal facets
  embedded in the surface and a soft purple glow emanating from the facets, kept
  tight to the shell
- **legendary:** polished golden eggshell (around #f1c40f) engraved with elegant
  curved rune lines, radiating short golden rays of light kept close to the shell
- **mythic:** jet-black obsidian eggshell covered in jagged glowing orange lava
  cracks, faint orange embers rising just above the shell, dramatic inner glow
  through the cracks, kept tight to the shell (matches the `volcano_core` site
  obsidian-and-lava look)

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

Match the black-and-lava look of `assets/images/eggs/mythic.png` (obsidian
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
