# Emoji pipeline

Fires on: everything under `assets/emojis/` — the hand-authored SVG, the rendered PNGs
and the deploy manifest — plus the code that builds, uploads and reads them
(`src/build-emojis.ts`, `src/deploy-emojis.ts`, `src/core/render-svg.ts`,
`src/core/emojis.ts`, `src/core/emoji-sync.ts`, `src/core/trait-display.ts`) and their
tests (`tests/emojis.test.ts`, `tests/emoji-assets.test.ts`, `tests/deploy-emojis.test.ts`).

## Headlines

- Custom app emojis are hand-authored SVG rendered to committed 128×128 transparent PNGs by `npm run build-emojis` and uploaded by `npm run deploy-emojis`, whose manifest tracks deployed hashes so reruns only touch what changed. §emoji-build-and-deploy-pipeline
- Runtime lookup falls back to unicode when the map isn't loaded, so a missing emoji is never an error. §emoji-runtime-lookup-degrades
- Two known emoji mistakes fail no test, because tests load no map — a green run is not evidence about either, and review is the only gate. §emoji-mistakes-invisible-to-tests
- `<ellipse fill="url(#gradient)">` with the default `objectBoundingBox` gradientUnits renders SOLID BLACK under resvg — use `gradientUnits="userSpaceOnUse"` with `y1`/`y2` set to the ellipse's own pre-transform bbox. §resvg-ellipse-gradient-units
- `tests/emoji-assets.test.ts` rejects any PNG whose opaque pixels are more than 2% pure `#000000`; if a future SVG legitimately needs more, raise the threshold deliberately rather than fighting the guard. §emoji-png-black-share-guard

## emoji-build-and-deploy-pipeline

Custom app emojis are hand-authored SVG in `assets/emojis/svg/`, rendered to
committed 128×128 transparent PNGs in `assets/emojis/png/` by
`npm run build-emojis` (`src/build-emojis.ts` + the `renderSvg` helper in
`src/core/render-svg.ts`, which decodes via `@napi-rs/canvas`'s bundled
resvg), and uploaded to Discord by `npm run deploy-emojis`
(`assets/emojis/manifest.json` tracks deployed hashes so reruns only touch
what changed).

Neither half of the bank is WebP, and both exceptions are recorded at
`§three-deliberate-non-webp` in `docs/conventions/art-asset-files.md`.

## emoji-runtime-lookup-degrades

Runtime lookup is `emojiTag` / `rarityEmoji`
(`src/core/emojis.ts`) — unicode fallback when the map isn't loaded, so a
missing emoji is never an error. This is the emoji instance of the guarantee stated in
full at `§art-missing-file-degrades` in `docs/conventions/art-resolver.md`, and it has
the one exception that whole family has: `ButtonBuilder.setEmoji` THROWS on the empty
string a rarity gem legitimately returns with no map loaded. The rule for that is
`§never-rarity-emoji-to-seticon` in `docs/conventions/embed-payload-builders.md`.

## emoji-mistakes-invisible-to-tests

**Neither of the two known emoji mistakes fails a test, because tests load no map.**
Stated once here, because both inherit the same one fact rather than each carrying its
own copy of it. Under a map-less run `emojiTag` returns its unicode fallback whether the
call was correct or not, so the suite cannot tell a frozen module-level constant, or a
tag that will render as literal text in an autocomplete label, from a call that works in
production. Both are stated where the code that commits them lives:
`§never-emojitag-in-module-constant` in
`docs/conventions/command-and-handler-surface.md`, and
`§never-emoji-tag-in-autocomplete-label` in
`docs/conventions/command-and-handler-surface.md`.
Review is the only gate on either; do not treat the suite as one.

The third emoji hazard is the exception in the other direction, and knowing which is
which matters: `ButtonBuilder.setEmoji` throws rather than degrading, so a test that
built such a button under a map-less run would fail loudly rather than pass blind. That
one is `§never-rarity-emoji-to-seticon` in
`docs/conventions/embed-payload-builders.md`.

## resvg-ellipse-gradient-units

Known resvg gotcha:
`<ellipse fill="url(#gradient)">` with the default `objectBoundingBox`
gradientUnits renders solid black — use `gradientUnits="userSpaceOnUse"`
with `y1`/`y2` set to the ellipse's own pre-transform bbox instead (same
stop colors/offsets, just a different coordinate system). `circle`/`rect`/
`polygon` gradients are unaffected. Worked example from `dw_food.svg`'s
`<ellipse cx="27" cy="30" rx="18" ry="14">`: `y1 = cy - ry = 30 - 14 = 16`,
`y2 = cy + ry = 30 + 14 = 44` — exactly the bbox `objectBoundingBox` would
have used.

## emoji-png-black-share-guard

`tests/emoji-assets.test.ts` rejects any PNG whose opaque pixels are more
than 2% pure `#000000` (`MAX_BLACK_SHARE`), calibrated against the currency trio, none of which
use pure black — if a future SVG legitimately needs pure black across more of the canvas than
that, raise the threshold deliberately rather than fighting the guard.
