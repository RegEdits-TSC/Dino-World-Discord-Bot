# Dino World — repo conventions

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never
  `Date.now()`/`Math.random()`; tests inject both via `makeCtx`.
- DB access is synchronous drizzle/better-sqlite3 (`.get()`/`.all()`/`.run()`),
  never awaited.
- Slash commands live in `ModuleManifest`s (`src/core/modules.ts`). Commands
  may define `autocomplete?(ctx, i)`: providers only ever `i.respond(...)`
  (never `reply`/`defer`), never call `getOrCreateUser` (no row creation on
  keystrokes), and are read-only — the only permitted writes are
  `settleEscapes` (guard on the user row existing first: it crashes for
  unknown users) and `expireStale`. Router-level errors degrade to an empty
  suggestion list.
- Registering a new module touches 5 sites: modules.json, src/index.ts,
  src/deploy-commands.ts, tests/registry-load.test.ts (command count),
  tests/config.test.ts (expected modules).
- Changing any command builder requires `npm run deploy-commands` and exactly
  one running bot instance per token.
- Embed art ships from `assets/images/` via `assetImage` (`src/core/images.ts`);
  a missing file means the embed renders without the image — absent art is
  never an error. Generation prompts live in `docs/assets/prompts.md`.
- Emoji art is hand-authored SVG in `assets/emojis/svg/`, rendered to committed
  128×128 transparent PNGs in `assets/emojis/png/` by `npm run build-emojis`
  (`src/build-emojis.ts` + the `renderSvg` helper in `src/core/render-svg.ts`,
  which decodes via `@napi-rs/canvas`'s bundled resvg). Known resvg gotcha:
  `<ellipse fill="url(#gradient)">` with the default `objectBoundingBox`
  gradientUnits renders solid black — use `gradientUnits="userSpaceOnUse"`
  with `y1`/`y2` set to the ellipse's own pre-transform bbox instead (same
  stop colors/offsets, just a different coordinate system). `circle`/`rect`/
  `polygon` gradients are unaffected.
