# Park PNG renderer

Fires on: everything under `src/core/render/` — the worker, its client, the art loader
and `draw.ts` — plus `src/data/render-icons.ts`, `src/modules/park/snapshot.ts`, the
`assets/images/park/` rasters and `assets/fonts/`, and the render tests
(`tests/render-*.test.ts`, `tests/park-view-image.test.ts`, `tests/park-snapshot.test.ts`,
`tests/park-art-assets.test.ts`).

## Headlines

- `@napi-rs/canvas` decodes RASTER buffers asynchronously, so always `await img.decode()` before drawing one — setting `Image.src` and drawing in the same tick silently yields a blank canvas, with no error. §raster-decode-must-be-awaited
- SVG buffers decode SYNCHRONOUSLY, which is why `renderSvg` needs no await and why every icon the park renderer draws is read from `assets/emojis/svg/*.svg` rather than a raster. §svg-decodes-synchronously
- `renderParkPng(snap, art = EMPTY_ART)` stays synchronous — never move a raster decode into it. §renderparkpng-stays-synchronous
- `loadParkArt` must never reject: a rejected worker module boot fires the `error` handler, which terminates and nulls the worker, so every later `/park view` silently loses its image and respawns another doomed worker. §loadparkart-never-rejects
- Art never crosses `postMessage` — a canvas `Image` is not structured-cloneable. §art-never-crosses-postmessage
- `drawImage(null)` THROWS, so every art site needs its own non-null guard and its own fallback; `src/data/render-icons.ts` is the live fallback path, not dead code. §drawimage-null-needs-guard
- `renderParkPng` never calls `seasonFor` or reads a clock itself: it stays a pure function of its `(snapshot, art)` arguments, which is what the byte-identical-output pin in `tests/render-draw.test.ts` requires. §render-park-png-stays-pure
- `ParkArt.groundBySeason` is exhaustively null-initialized in `EMPTY_ART`, because a lookup miss must never read back `undefined` — `drawImage(undefined)` throws exactly like `drawImage(null)` and costs the whole park image. §ground-by-season-exhaustive-null-init
- `groundImage`'s fallback chain is `groundBySeason[season] ?? ground ?? <flat fill>`, so a missing seasonal raster degrades to the base ground and never to a blank canvas. §ground-image-fallback-chain
- The three seasonal rasters load inside `loadParkArt`'s EXISTING `Promise.all`, inheriting the never-rejects guarantee for free — no second `Promise.all`, no separate top-level await for `worker.ts` to guard. §seasonal-rasters-in-existing-promise-all
- The landmark cell is drawn as one extra grid cell AFTER the build slot, so every tile that existed before landmarks kept its exact coordinates. §landmark-cell-appended-last
- A missing or unloaded landmark art band degrades to a flat plinth fill rather than reaching `drawImage(null)`. §landmark-art-degrades-flat
- `buildParkSnapshot` is the only place with a `Ctx`, so it alone stamps `ParkSnapshot.season` — an OPTIONAL field, so hand-built fixtures that predate seasons keep compiling and keep resolving to the base ground. §season-stamped-only-in-snapshot

## raster-decode-must-be-awaited

`@napi-rs/canvas` decodes **raster** buffers asynchronously — PNG and WebP
alike. Setting `Image.src` from raster bytes and drawing in the same tick
silently yields a blank canvas, with no error. Always `await img.decode()`
before drawing one.

## svg-decodes-synchronously

**SVG** buffers decode synchronously, which is why
`renderSvg` needs no await and why every icon the park renderer draws (HUD
coin, lot icons, rarity dino chips) is read from `assets/emojis/svg/*.svg`
rather than a raster.

## renderparkpng-stays-synchronous

That asymmetry is what splits `src/core/render/art.ts`
in two: `loadSvgImage` is synchronous, the three `assets/images/park/*.webp`
rasters are `await img.decode()`d inside `loadParkArt`, and
`renderParkPng(snap, art = EMPTY_ART)` **stays synchronous** — never move a
raster decode into it.

## loadparkart-never-rejects

`worker.ts` top-level-awaits
`loadParkArt().catch(() => EMPTY_ART)`: `loadParkArt` must never reject and
the `.catch` is belt-and-braces, because a rejected worker module boot fires
`client.ts`'s `error` handler, which terminates and nulls the worker — every
later `/park view` then silently loses its image and respawns another doomed
worker.

## art-never-crosses-postmessage

Art never crosses `postMessage` (a canvas `Image` is not
structured-cloneable).

## drawimage-null-needs-guard

`drawImage(null)` throws, so every art site needs its
own non-null guard, and each `null` falls back to the flat fill / emoji glyph
in `src/data/render-icons.ts` — that file is the live fallback path, not dead
code.

This is the canvas half of the repo-wide guarantee that absent art is never an error,
stated in full at `§art-missing-file-degrades` in `docs/conventions/art-resolver.md`. The
halves differ in what they cost. A resolver degrades for free: it returns a null ref and
the payload simply carries no file. A draw site does not — the throw is the default
behaviour, so degrading here is something each site has to be WRITTEN to do, and a site
that forgets costs the whole park image rather than one picture on it.

Every draw site in `draw.ts` is therefore an instance of this rule with its own fallback,
and the two worth knowing by name are the seasonal ground (§ground-image-fallback-chain,
whose chain ends in a flat fill) and the landmark plinth (§landmark-art-degrades-flat).
`EMPTY_ART`'s exhaustive null-initialisation (§ground-by-season-exhaustive-null-init) is
the same rule applied one level up, to the lookup rather than the draw: `undefined`
throws exactly as `null` does, so a `Record` keyed on a real union must have every key
present and explicitly null.

## render-park-png-stays-pure

`renderParkPng` (`src/core/render/draw.ts`) never calls `seasonFor`
or reads a clock itself — it stays a pure function of its `(snapshot, art)` arguments, which is
what the byte-identical-output pin in `tests/render-draw.test.ts` requires.

## ground-by-season-exhaustive-null-init

`ParkArt.groundBySeason`
(`src/core/render/art.ts`) is a `Record<Season, Image | null>`, exhaustively null-initialized in
`EMPTY_ART` the same way `dinoChips` is: a lookup miss on a real `Season` value must never read
back `undefined`, because `drawImage(undefined)` throws exactly like `drawImage(null)` does and
costs the whole park image.

## ground-image-fallback-chain

The fallback chain in `groundImage` (`draw.ts`) is
`groundBySeason[season] ?? ground ?? <flat fill>` — a missing or unloaded seasonal raster
degrades to the base ground, never to a blank canvas, and a snapshot with no `season` at all
(every pre-season fixture) skips the seasonal lookup entirely.

## seasonal-rasters-in-existing-promise-all

The three rasters load inside
`loadParkArt`'s existing `Promise.all` alongside the base ground and both plates, so they
inherit the same never-rejects guarantee for free — no second `Promise.all`, no separate
top-level await for `worker.ts` to guard.

## landmark-cell-appended-last

The landmark cell (`drawLandmark`, `src/core/render/draw.ts`) is drawn as one extra
grid cell AFTER the build slot, so every tile that existed before landmarks shipped
keeps the exact coordinates it already had — which is why adding it broke none of
`tests/render-draw.test.ts`'s pinned pixel samples.

## landmark-art-degrades-flat

A missing or unloaded art band
degrades to a flat plinth fill rather than reaching `drawImage(null)`, which throws
and would cost the whole park image.

## season-stamped-only-in-snapshot

The season's cosmetic ground art is wired the same "id crosses, asset doesn't" way as the
event system's own art: `buildParkSnapshot` (`src/modules/park/snapshot.ts`) is the only place
with a `Ctx`, so it alone stamps `ParkSnapshot.season = seasonFor(ctx.now())` — an OPTIONAL
field, so the handful of hand-built `ParkSnapshot` test fixtures that predate seasons keep
compiling and keep resolving to the base ground, exactly like a snapshot built before this
feature shipped would.
