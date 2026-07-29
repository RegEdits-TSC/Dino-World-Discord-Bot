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
- Registering a new module touches 4 sites: modules.json, `src/core/module-list.ts`
  (the `ALL_MODULES` array), tests/registry-load.test.ts (command count),
  tests/config.test.ts (expected modules). `src/index.ts` and
  `src/deploy-commands.ts` both import `ALL_MODULES` from that one list rather
  than declaring their own, so they no longer need a manual edit.
- Changing any command builder requires `npm run deploy-commands` and exactly
  one running bot instance per token. Example: `/sell`'s `dino` option now sets
  `.setAutocomplete(true)` — its autocomplete handler already existed but was
  dead because the builder never advertised the option as autocompleting to
  Discord — and that builder change needed the same one-time redeploy.
- The fakes in `tests/harness.ts` (`fakeCommand`/`fakeAutocomplete`/`fakeButton`)
  enforce the real interaction lifecycle — reply-once, and defer-before-
  editReply/followUp — throwing the same `InteractionAlreadyReplied`/
  `InteractionNotReplied` errors discord.js would, validate every reply payload
  against Discord's message limits, and back `getString`/`getInteger`/etc.
  option getters with the command's real builder JSON: a fixture option key or
  a getter called with the wrong type for that option throws instead of
  silently returning null or the wrong value. Synthetic command names the
  module registry doesn't know about (router tests use these) skip builder
  lookup entirely and fall back to the old permissive getters.
- `npm run test:live` (`scripts/test-live.ts`) posts the payload gallery — every
  case's real embeds, components, and images — to `TEST_CHANNEL_ID` for
  cosmetic review. It's REST-only: it deploys builders and posts messages over
  `discord.js`'s REST client, never logging in a second gateway session, so
  it's safe to run against the dev guild while the bot is live.
- Embed art ships from `assets/images/` via `assetImage` (`src/core/images.ts`);
  a missing file means the embed renders without the image — absent art is
  never an error. Generation prompts live in `docs/assets/prompts.md`.
- Passive notifications carry a `NotifyPayload` (`src/core/notify.ts`):
  `string | { content?, embeds?, files? }`. `Ctx.notify`'s third argument stays
  `message: string` on purpose — a string is a valid payload, so every call site
  keeps working and the `ctx.notifications` fake in `tests/harness.ts` is
  untouched. `deliverNotification` merges the `<@id>` ping through `withMention`
  on the CHANNEL path only; DMs go out unmentioned. `Sender` fakes are
  hand-rolled per test file (`tests/notify.test.ts`,
  `tests/notify-handlers.test.ts`, `tests/journeys.test.ts`), not in the harness
  — and only `npm run typecheck` catches a stale one.
- Two assets in one payload: the SECOND `assetImage` must APPEND
  (`payload.files = [...(payload.files ?? []), img.file]`), never re-assign — a
  plain assignment drops the first file and leaves a dangling `attachment://`
  URL that Discord renders as a broken image. Attachment names are basenames
  only (`src/core/images.ts:20-23`), so the two assets need distinct file names
  (`<site>-banner.png` vs `<site>-thumb.png` is safe). Live call sites:
  `/shop view`, `/expedition claim`, `/battle chapters`.
- Custom app emojis are hand-authored SVG in `assets/emojis/svg/`, rendered to
  committed 128×128 transparent PNGs in `assets/emojis/png/` by
  `npm run build-emojis` (`src/build-emojis.ts` + the `renderSvg` helper in
  `src/core/render-svg.ts`, which decodes via `@napi-rs/canvas`'s bundled
  resvg), and uploaded to Discord by `npm run deploy-emojis`
  (`assets/emojis/manifest.json` tracks deployed hashes so reruns only touch
  what changed). Runtime lookup is `emojiTag` / `rarityEmoji`
  (`src/core/emojis.ts`) — unicode fallback when the map isn't loaded, so a
  missing emoji is never an error. **Never call `emojiTag` in a module-level
  constant** (the map loads after client ready, so module init would freeze
  the fallback permanently), and **never put a custom emoji tag in an
  autocomplete label** (Discord renders it as literal text there). Neither
  mistake fails a test, because tests load no map. **Never pass a rarity tag
  (`rarityEmoji(...)`) to `ButtonBuilder.setEmoji`** — unlike every other call
  site, `setEmoji` throws rather than degrading: `resolvePartialEmoji('')`
  returns `null` and the builder rejects it, and the six rarity gems
  legitimately return `''` when no map is loaded. Today only `dw_cash` is
  passed to `setEmoji`, so this is currently safe, but it's a live hazard for
  future button work. Known resvg gotcha:
  `<ellipse fill="url(#gradient)">` with the default `objectBoundingBox`
  gradientUnits renders solid black — use `gradientUnits="userSpaceOnUse"`
  with `y1`/`y2` set to the ellipse's own pre-transform bbox instead (same
  stop colors/offsets, just a different coordinate system). `circle`/`rect`/
  `polygon` gradients are unaffected. Worked example from `dw_food.svg`'s
  `<ellipse cx="27" cy="30" rx="18" ry="14">`: `y1 = cy - ry = 30 - 14 = 16`,
  `y2 = cy + ry = 30 + 14 = 44` — exactly the bbox `objectBoundingBox` would
  have used. Separately: `tests/emoji-assets.test.ts` rejects any PNG whose opaque pixels are more
  than 2% pure `#000000` (`MAX_BLACK_SHARE`), calibrated against the currency trio, none of which
  use pure black — if a future SVG legitimately needs pure black across more of the canvas than
  that, raise the threshold deliberately rather than fighting the guard.
- `@napi-rs/canvas` decodes **PNG** buffers asynchronously — setting `Image.src`
  from PNG bytes and drawing in the same tick silently yields a blank canvas,
  with no error. Always `await img.decode()` before drawing a PNG. **SVG**
  buffers decode synchronously, which is why `renderSvg` needs no await and why
  every icon the park renderer draws (HUD coin, lot icons, rarity dino chips) is
  read from `assets/emojis/svg/*.svg` rather than a PNG. That asymmetry is what
  splits `src/core/render/art.ts` in two: `loadSvgImage` is synchronous, the
  three `assets/images/park/*.png` rasters are `await img.decode()`d inside
  `loadParkArt`, and `renderParkPng(snap, art = EMPTY_ART)` **stays
  synchronous** — never move a PNG decode into it. `worker.ts` top-level-awaits
  `loadParkArt().catch(() => EMPTY_ART)`: `loadParkArt` must never reject and
  the `.catch` is belt-and-braces, because a rejected worker module boot fires
  `client.ts`'s `error` handler, which terminates and nulls the worker — every
  later `/park view` then silently loses its image and respawns another doomed
  worker. Art never crosses `postMessage` (a canvas `Image` is not
  structured-cloneable), `drawImage(null)` throws so every art site needs its
  own non-null guard, and each `null` falls back to the flat fill / emoji glyph
  in `src/data/render-icons.ts` — that file is the live fallback path, not dead
  code.
- Food is typed (`src/data/foods.ts`, 3 tiers × 2 diets) and lives in the
  `food_inventory` table — `users.food` no longer exists. Feeding sets
  `hunger = fillTo` (up to 150): `comfortAt` clamps the hunger term at 100, and
  `accruedIncome` must stay piecewise across the hunger-100 crossing — a plain
  two-point trapezoid over-/under-pays overfed dinos. Autocomplete labels use
  `FoodDef.fallback` unicode, never `emojiTag`/`foodEmoji` (custom tags render
  as literal text in autocomplete).
- `migrateDb` (`src/core/db/index.ts`) brackets `migrate()` with
  `foreign_keys = OFF`/`ON`. This is load-bearing, not cleanup: drizzle runs each
  migration inside a transaction where `PRAGMA foreign_keys` is a no-op, so a
  table-recreate migration (SQLite column drop) would otherwise fail
  `DROP TABLE` against child rows on a **populated** DB (`createDb` sets FK on).
  Consequence for tests: an empty-DB migration test or a raw-SQL replay
  (`db.exec` per statement) passes even when the real migrator would fail — a
  migration test must seed a parent **and** a child row and run the real
  `migrateDb` (see the "production path" block in `tests/migration.test.ts`).
- Battles: `Ctx` carries `sleep(ms)` for the fight cinematic — real
  `setTimeout` in `src/index.ts`, instant stub in `tests/harness.ts` `makeCtx`
  and `scripts/test-live.ts`; every future Ctx construction site must provide
  it. The fight pipeline is **commit-before-present**: `runFight` commits every
  write (energy, rewards, progress, XP, boss egg) in ONE transaction before the
  first Discord edit, so a crash or Skip mid-cinematic loses animation frames
  only, never state — never move a write into the frame loop. Chapter ids in
  `src/data/battle/chapters/` MUST equal `EXPEDITION_SITES` keys: that single
  invariant derives the chapter banner asset (`sites/<chapterId>-banner`), the
  `unlockRating` co-gate, and the theme. `tests/battle-content.test.ts` is the
  machine gate for all campaign data — including that every `bossId` appears in
  `docs/assets/prompts.md` — so future chapters ship as data-only PRs (new
  chapter file + index import + PNGs + prompt rows) with zero engine changes.
  `rosterFor(stage, squadSize)` (`src/data/battle/chapters/index.ts`) is the
  single source of truth for which enemies are fielded and which entry is the
  boss — `runFight` and `fightFrames` both call it rather than re-deriving the
  boss by matching `speciesId`, so the fight and its embed always agree on who
  actually fought; the content test pins the boss as the third authored enemy,
  which the small-squad slicing branch relies on. `fightFrames`
  (`src/modules/battles/embeds.ts`) attaches files on **frame 1 and frame 4
  only**, and each attaching frame uploads exactly the files its embed
  references. F2/F3 must carry no `files`/`attachments` key at all — F1's
  uploads survive and their `attachment://` URLs keep resolving. F4 is the
  opposite: it always sends `attachments: []` plus its own `files`, because a
  payload carrying `files` (or an explicit `attachments` array) replaces the
  message's whole attachment set (discord.js `MessagePayload`), which is how F4
  sheds the chapter banner it no longer references and how the no-art case
  avoids stranding F1's upload as a bare attachment card. Never dress F4 with
  the chapter banner again. `tests/battles-embeds.test.ts`'s frame-contract test
  is the machine gate; the skip button replays the same F4 payload via
  `i.update`, so both paths must stay identical.
  Embed art kinds are `eggs | sites | banners | battles | hatch` (`assetImage`,
  `src/core/images.ts`); `hatch/<rarity>-crack.png` is the hatch-reveal image and
  its attachment name never collides with `eggs/<rarity>.png`. Generated art is
  fitted by `node scripts/fit-art.mjs banner|cutout <src> <dest>` — banners are
  1536×1024 (asserted in `tests/images.test.ts`), transparent cutouts 1024×1024.
  `assets/images/battles/` ships committed boss portraits
  (`boss-<siteId>-portrait.png`, 1024×1024 transparent cutouts pinned by
  `tests/images.test.ts`); `assetImage`'s null-degrade still holds, so the
  campaign stays fully playable if any of them is removed. Never stage a test
  fixture inside `assets/images/` — vitest runs test files in parallel forks,
  so a `writeFileSync`/`rmSync` on a committed asset path can be observed (or
  deleted) by another file mid-run; `tests/battles-embeds.test.ts` mocks
  `assetImage` instead.
- `npm run build` does not typecheck tests: `build` is `tsc` against
  `tsconfig.json`, which only `include`s `src`, and `npm test` (vitest)
  transpiles without typechecking. The test-inclusive gate is
  `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`, which extends
  `tsconfig.json` and adds `tests` and `scripts` to `include`) — a type error
  in a test file passes both `build` and `test` clean; run `typecheck` before
  every commit that touches `tests/` or `scripts/`.
- `HELP_TOPICS` (`src/modules/help/index.ts`) stores a LAZY art descriptor
  (`art?: { kind, name }`), never a built `ImageRef` — `assetImage` returns a
  fresh `AttachmentBuilder` per call and the map is module-level (same class of
  mistake as calling `emojiTag` in a module constant). The `park` topic has no
  descriptor: it defers and renders the reader's own map, degrading to a
  text-only embed when `buildParkSnapshot`/`renderPark` throws. Adding or
  removing a topic KEY changes the `/help` builder choices and forces
  `npm run deploy-commands`; adding a field to the value type does not.
