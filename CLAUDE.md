# Dino World — repo conventions

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never
  `Date.now()`/`Math.random()`; tests inject both via `makeCtx`.
- DB access is synchronous drizzle/better-sqlite3 (`.get()`/`.all()`/`.run()`),
  never awaited.
- Slash commands live in `ModuleManifest`s (`src/core/modules.ts`). Commands
  may define `autocomplete?(ctx, i)`: providers only ever `i.respond(...)`
  (never `reply`/`defer`), never call `getOrCreateUser` (no row creation on
  keystrokes), and are read-only — the only permitted write is `settleEscapes`
  (guard on the user row existing first: it crashes for unknown users). Escrow
  no longer needs a sweep here: `locksFor` (`src/core/locks.ts`) is a pure read.
  `expireStale` survives in the `/trade accept|decline|cancel` provider only
  because that list's `status` filter is what hides a dead trade. Router-level
  errors degrade to an empty suggestion list.
- Registering a new module touches 5 sites: modules.json, `src/core/module-list.ts`
  (the `ALL_MODULES` array), tests/registry-load.test.ts (command count),
  tests/config.test.ts (expected modules), and `tests/contract.test.ts:49`
  (the top-level command count in "every builder serializes" — that same file
  also enforces a bidirectional autocomplete manifest, so any option flagged
  `.setAutocomplete(true)` needs a matching entry in `AUTOCOMPLETE_OPTIONS`
  there too). `src/index.ts` and `src/deploy-commands.ts` both import
  `ALL_MODULES` from that one list rather than declaring their own, so they no
  longer need a manual edit.
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
  **Always wire art with `attach(embed, payload, slot, assetImage(...))`** — it
  sets the embed slot and appends the file together, so the two can never drift
  apart (that drift shipped three attachment defects in round 2). A null ref is
  a total no-op: `payload.files` is not even created, so an art-free payload
  never ships an empty attachment array — `tests/hatchery.test.ts` and
  `tests/notify-handlers.test.ts` both assert `files` is `undefined`, not `[]`.
  `attach` APPENDS, so two calls on one payload both survive and **call order is
  upload order**: several tests pin `files.map((f) => f.name)` with `toEqual`,
  and three mock `assetImage` as a `mockImplementationOnce` queue keyed on
  1st-call/2nd-call identity, so never reorder the calls, never hoist the
  lookups above them, and never collect refs into an array first. A ternary that
  guards on *domain data* (`best ? assetImage(...) : null` in shop,
  `featured ? … : null` in hatchery) stays outside `attach` — it is not an
  asset miss. `tests/images.test.ts`'s "no source file hand-assigns an embed
  payload files array" guard bans the old `payload.files = [...]` idiom outright.
  `fightFrames` (`src/modules/battles/embeds.ts`) is the one exception: every ref
  it builds is dressed onto several embeds and the files are then split across two
  payloads by the F1/F4 contract — do not convert any of them, however many there
  are. Separately, `withParkImage` (`src/modules/park/embeds.ts`) still
  **appends** to `files` rather than assigning, so `park.png` can stack onto
  whatever a payload already carries without clobbering it. `dashboardPayload`
  (the Park tab, `src/modules/park/embeds.ts`) calls no `attach()` of its
  own, though — it ships no art beyond whatever `withParkImage` adds, at all
  three call sites that wrap it: `/park view` on your own park and
  `renderTab`'s `park` branch (both `src/modules/park/index.ts`), plus
  `visitPayload` (`src/modules/park/visit.ts`). The featured dino's
  thumbnail lives on the ANIMALS tab instead (`animalsPayload`), attached
  alongside the roster banner via two `attach()` calls of its own — a
  different builder for a different tab, never wrapped by `withParkImage`.
  `visitPayload` no longer hand-builds `components: []` the way an earlier
  version did: it calls `dashboardPayload(user, 0, { …, visit: true })`
  directly and takes ITS `components` (and, defensively, its `files`, though
  `dashboardPayload` never sets that key today) — `visit: true` already
  suppresses `park:collect` at the source (that button carries no user id,
  so a viewer clicking it on someone else's park card would collect the
  CLICKER's own income) while still minting the tab row, so there is neither
  a components array to hand-build nor a featured-dino upload to forward: a
  visited Park tab never carries one.
- Passive notifications carry a `NotifyPayload` (`src/core/notify.ts`):
  `string | { content?, embeds?, files?, components?, allowedMentions? }`.
  `Ctx.notify`'s third argument stays `message: string` on purpose — a string
  is a valid payload, so every call site keeps working and the
  `ctx.notifications` fake in `tests/harness.ts` is untouched. `deliverNotification`
  merges the `<@id>` ping through `withMention` on the CHANNEL path only; DMs go
  out unmentioned. **Channel notifications did not actually ping before this
  fix**: `src/index.ts` sets `allowedMentions: { parse: [] }` client-wide (so
  `/dino rename`/`/park rename` can't echo a user-supplied role mention into
  public content), and that default silently ate the `<@id>` on every
  channel-routed notification too. `withMention` now sets a per-message
  `allowedMentions: { users: [userId] }`, which REPLACES the client default for
  that one message (discord.js `MessagePayload` doesn't merge the two),
  restoring the ping without making anything else mentionable — the same fix
  landed on the trade-offer reply. `Sender` fakes are hand-rolled per test
  file, not in the harness, so a shape change has no single call site to grep
  — `grep -rl 'channelSend' tests/` is the reliable way to find every one
  (`tests/notify.test.ts`, `tests/notify-handlers.test.ts`,
  `tests/journeys.test.ts`, `tests/world-broadcast.test.ts`,
  `tests/alert-sweep.test.ts` — five today, and re-run the grep rather than
  trusting this count, since the next sweep-style test to land will add a
  sixth without anyone remembering to update this line) — and only
  `npm run typecheck` catches a stale one.
- Two assets in one payload: call `attach()` for both and the second can never
  clobber the first — appending is exactly what `attach` does, and hand-assigning
  `payload.files` (the idiom that shipped those defects) is banned outright by
  `tests/images.test.ts`. What `attach` cannot do for you is DEDUPE, and that
  hazard is still live: attachment names are basenames only — `assetImage`
  (`src/core/images.ts`) names the file `${name}.webp` with no `kind` prefix — so
  two refs on one payload must resolve to distinct names. Same-named uploads make
  `attachment://<name>.webp` ambiguous and one of the two embed slots renders the
  wrong picture. `<site>-banner.webp` vs `<site>-thumb.webp` is safe; naming the
  hatch cracks `hatch/<rarity>.webp` would NOT have been, against
  `eggs/<rarity>.webp` — hence `<rarity>-crack`. Two-asset payloads are routine
  now (shop, expeditions, hatchery, battles), so check the names, not the count.
- `fightFrames` picks its thumbnail once, up front: the boss portrait on a boss
  stage, else the archetype art of `rosterFor(stage, squad.length)[0]` — the same
  lead enemy the Enemies field opens with, so the frame can never disagree with
  the fight. A boss stage whose portrait is missing degrades to **no** thumbnail;
  it must never fall back to archetype art, because `rosterFor`'s lead entry on a
  1-dino squad IS the boss. One merged `thumb` ref feeds `dress()` (F1-F3), F4's
  `setThumbnail`, and both `files` arrays, so the F1/F4 upload contract holds
  without a second code path. `revealPayload` is the other archetype surface: it
  ships the rarity crack as `image` and the archetype as `thumbnail`, two files on
  one `i.update` payload, each degrading independently.
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
- `@napi-rs/canvas` decodes **raster** buffers asynchronously — PNG and WebP
  alike. Setting `Image.src` from raster bytes and drawing in the same tick
  silently yields a blank canvas, with no error. Always `await img.decode()`
  before drawing one. **SVG** buffers decode synchronously, which is why
  `renderSvg` needs no await and why every icon the park renderer draws (HUD
  coin, lot icons, rarity dino chips) is read from `assets/emojis/svg/*.svg`
  rather than a raster. That asymmetry is what splits `src/core/render/art.ts`
  in two: `loadSvgImage` is synchronous, the three `assets/images/park/*.webp`
  rasters are `await img.decode()`d inside `loadParkArt`, and
  `renderParkPng(snap, art = EMPTY_ART)` **stays synchronous** — never move a
  raster decode into it. `worker.ts` top-level-awaits
  `loadParkArt().catch(() => EMPTY_ART)`: `loadParkArt` must never reject and
  the `.catch` is belt-and-braces, because a rejected worker module boot fires
  `client.ts`'s `error` handler, which terminates and nulls the worker — every
  later `/park view` then silently loses its image and respawns another doomed
  worker. Art never crosses `postMessage` (a canvas `Image` is not
  structured-cloneable), `drawImage(null)` throws so every art site needs its
  own non-null guard, and each `null` falls back to the flat fill / emoji glyph
  in `src/data/render-icons.ts` — that file is the live fallback path, not dead
  code.
- Every file under `assets/images/` is **WebP q95** — `assetImage`
  (`src/core/images.ts`) is the only path builder for them and appends `.webp`,
  so flipping the format there propagates to every `attachment://` URL and every
  `files[].name`. `scripts/fit-art.mjs` emits the same format. Three things are
  deliberately NOT WebP: `assets/emojis/png/` (Discord's app-emoji upload expects
  PNG and `manifest.json` hashes those exact bytes), `assets/emojis/svg/` (the
  park renderer needs synchronous decode), and `park.png` — the `/park view`
  render OUTPUT buffer from `renderParkPng`, an in-memory PNG (`canvas.toBuffer
  ('image/png')`), not a committed asset. `tests/images.test.ts`'s "ships every
  file under assets/images as .webp" test guards that nothing under
  `assets/images/` regresses to another format.
- Food is typed (`src/data/foods.ts`, 3 tiers × 2 diets) and lives in the
  `food_inventory` table — `users.food` no longer exists. Feeding sets
  `hunger = fillTo` (up to 150): `comfortAt` clamps the hunger term at 100, and
  `accruedIncome` must stay piecewise across the hunger-100 crossing — a plain
  two-point trapezoid over-/under-pays overfed dinos. Autocomplete labels use
  `FoodDef.fallback` unicode, never `emojiTag`/`foodEmoji` (custom tags render
  as literal text in autocomplete).
- `migrateDb` (`src/core/db/index.ts`) brackets `migrate()` with
  `foreign_keys = OFF`/`ON`, toggled OUTSIDE the migration's own transaction, at the
  connection level, before `migrate()` even starts. This is load-bearing, not
  cleanup: drizzle wraps every migration in a transaction, so a `PRAGMA foreign_keys`
  statement embedded in the migration SQL itself is a no-op there — but a pragma set
  before that transaction begins stays in effect for its whole duration, which is
  why `migrateDb`'s outer bracket (and not a per-migration one) is what lets a
  table-recreate migration (SQLite column drop) run `DROP TABLE` against child rows
  on a **populated** DB (`createDb` sets FK on) without throwing.
  What the "seed a parent **and** a child row, then run the real `migrateDb`" recipe
  (the "production path" block in `tests/migration.test.ts`) actually proves is
  narrower than it sounds: a well-formed recreate PASSES that test, bracket and all —
  the recipe does not demonstrate that a recreate "would fail on production", because
  it demonstrably doesn't. What it catches is (1) a regression that removes or
  weakens the bracket, (2) a lesser raw-SQL replay or an empty-DB substitute standing
  in for the real migrator, either of which gives a false green on exactly that
  regression, and (3) a recreate that mishandles data — drops or resets a column —
  even though FK enforcement passes clean. The actual gate against an UNNECESSARY
  recreate, one drizzle-kit could have expressed as a plain `ALTER TABLE` instead, is
  reading the emitted SQL by eye; the populated-row test cannot do that job for you.
- Battles: `Ctx` carries `sleep(ms)` for the fight cinematic — real
  `setTimeout` in `src/index.ts`, instant stub in `tests/harness.ts` `makeCtx`
  and `scripts/test-live.ts`; every future Ctx construction site must provide
  it. The fight pipeline is **commit-before-present**: `runFight` commits every
  write (energy, rewards, progress, XP, boss egg) in ONE transaction before the
  first Discord edit, so a crash or Skip mid-cinematic loses animation frames
  only, never state — never move a write into the frame loop. Chapter ids in
  `src/data/battle/chapters/` MUST equal `EXPEDITION_SITES` keys: that single
  invariant derives the chapter banner asset (`sites/<chapterId>-banner`) and the
  theme unconditionally, and — for every chapter that does NOT set `starGate` —
  the `unlockRating` co-gate too. `tests/battle-content.test.ts` is the
  machine gate for all campaign data — including that every `bossId` appears in
  `docs/assets/prompts.md` — so a chapter reusing the existing rating-gate kind
  still ships as a data-only PR (new chapter file + index import + WebPs +
  prompt rows) with zero engine changes. That promise is no longer
  unconditional, though: chapter 7 (Founder's Park) needed a real engine change
  — `ChapterDef.starGate` plus a branch in `chapterUnlocked`
  (`src/data/battle/chapters/index.ts`) — because its own unlock condition is a
  campaign-wide star total, not a rating threshold, and the id-derived
  `unlockRating` co-gate had no way to express that. A future chapter that
  needs a genuinely new gate kind will cost an engine change again.
  `rosterFor(stage, squadSize)` (`src/data/battle/chapters/index.ts`) is the
  single source of truth for which enemies are fielded and which entry is the
  boss — `runFight` and `fightFrames` both call it rather than re-deriving the
  boss by matching `speciesId`, so the fight and its embed always agree on who
  actually fought; the content test pins the boss as the third authored enemy,
  which the small-squad slicing branch relies on. `fightFrames`
  (`src/modules/battles/embeds.ts`) attaches files on **frame 1 and frame 4
  only**, and each attaching frame uploads exactly the files its embed
  references. F2/F3 must carry no `files`/`attachments` key at all — F1's
  uploads survive and their `attachment://` URLs keep resolving. **F1 and F4 both
  send `attachments: []` unconditionally** (plus their own `files` when the art
  exists), because a payload carrying `files` (or an explicit `attachments` array)
  replaces the message's whole attachment set (discord.js `MessagePayload`): that
  is how F4 sheds the chapter banner it no longer references, how the no-art case
  avoids stranding F1's upload as a bare attachment card, and — on F1 — how a
  `battle:again` replay avoids inheriting the *previous* fight's outcome banner,
  since `presentFight` re-edits the message F4 last wrote and an F1 with neither
  key would leave that banner live under F1–F3. Both must stay unconditional: a
  deploy missing `assets/images/sites/` is exactly the case where F1 has no files
  of its own. Never dress F4 with
  the chapter banner again. `tests/battles-embeds.test.ts`'s frame-contract test
  is the machine gate; the skip button replays the same F4 payload via
  `i.update`, so both paths must stay identical. That replay is why F4's
  payload can reach two send sites — `presentFight`'s closing `editReply` and,
  if a Skip races it, the button handler's `i.update`
  (`src/modules/battles/index.ts:34-46`): discord.js's `MessagePayload` pushes
  into `options.attachments` and `create()` only shallow-copies it, so one
  payload object forwarded to both sends accumulates duplicate attachment ids
  on whichever resolves second. Invisible to `tests/battles-embeds.test.ts`,
  which builds `FramePayload`s directly and never constructs a
  `MessagePayload`. `finalPayload()` there is the fix and the pattern to copy
  for any future payload reused across two send sites: hand each call its own
  fresh `attachments: []`, never forward the same object twice. Those same two
  send sites also need ORDERING, not just unshared arrays: `entry.skipped` is
  only observable between frames, so a Skip landing while a beat frame's
  `editReply` is in flight cannot stop that PATCH, and a beat frame landing after
  F4 restores an embed pointing at a chapter banner F4 already dropped — a
  permanently broken image. `queueEdit` serializes every edit on a presentation
  behind the previous one and re-checks a guard before sending, so F4 is the last
  PATCH in either interleaving; the lock is free during `ctx.sleep`, so a Skip
  clicked between frames still answers instantly. Any future third writer to a
  presented message must go through the same queue.
  Embed art kinds are `eggs | sites | banners | battles | hatch | dinos`
  (`assetImage`, `src/core/images.ts`); `hatch/<rarity>-crack.webp` is the
  hatch-reveal image and its attachment name never collides with
  `eggs/<rarity>.webp`. `assets/images/dinos/<archetype>-<diet>.webp` is a fixed
  set of 8 (1024×1024 transparent cutouts, `fit-art.mjs cutout`, so a 31px
  margin against the boss portraits' 24px — deliberate, recorded in
  `docs/assets/prompts.md`): **art is keyed on archetype×diet, with a per-species file
  as an OPTIONAL override** — `dinoImage(speciesId, archetype, diet)`
  (`src/core/images.ts`) tries `dinos/<speciesId>.webp` first and falls back to
  `dinos/<archetype>-<diet>.webp`, so a species with no file of its own costs no art and
  adding a species stays a data-only change. All five dino-art call sites go through that
  helper (`park/embeds.ts`, `duels/embeds.ts`, `dex/embeds.ts`, `hatchery/embeds.ts`,
  `battles/embeds.ts`), never a bare `assetImage('dinos', …)`; `park/embeds.ts` needed
  `Featured` (`park/showcase.ts`) to carry `speciesId` for it, a typecheck-only break that
  `npm run build` and `npm test` both miss. Mocking `assetImage` can NOT intercept the two
  lookups inside `dinoImage` — that call is module-internal — so a test that needs a
  dino-art miss must mock `dinoImage` itself (`tests/hatchery.test.ts` and
  `tests/battles-embeds.test.ts` both do). `support-carnivore`
  shipped with zero species using it for exactly that reason; Archelon (uncommon,
  support archetype, carnivore diet) now does, and it needed no new art at all —
  proof the guarantee holds. That fixed cost has
  a fidelity price: `archetype` is a combat concept, not a body-plan one, so
  outliers share art loosely — `swift-carnivore` covers both `velociraptor` and
  `quetzalcoatlus` (a beaked pterosaur), rendered as a scaled toothy theropod.
  Accepted deliberately: a per-species `silhouette` field was considered and
  declined, since it would have traded 8 images for roughly 12 plus a migration
  across all 40 species files, to fix fidelity for a handful of outliers.
  Banners are
  1536×1024 (asserted in `tests/images.test.ts`) and transparent cutouts
  1024×1024; `node scripts/fit-art.mjs banner|ground|cutout <src> <dest>`
  produces the banners and the hatch cracks via `banner`/`cutout`, but NOT the
  eggs or the boss portraits — those came from a one-off pass with a tighter
  24px margin (vs the script's 31px) and, for the eggs, an egg-axis bias. The
  season ground rasters (`park/ground-wet|dry|cold.webp`) come from `ground`,
  cover-scaled to 1200×800 rather than banner's 1536×1024 — the park renderer's
  canvas never needs more than that. `docs/assets/prompts.md` carries the
  numbers and the two families' divergence; the cracks additionally keep
  multiple disconnected alpha regions on purpose (falling shell fragments), so
  the egg pass's "largest connected region" step must never be applied to them.
  `assets/images/battles/` ships committed boss portraits
  (`boss-<siteId>-portrait.webp`, 1024×1024 transparent cutouts pinned by
  `tests/images.test.ts`); `assetImage`'s null-degrade still holds, so the
  campaign stays fully playable if any of them is removed. Never stage a test
  fixture inside `assets/images/` — vitest runs test files in parallel forks,
  so a `writeFileSync`/`rmSync` on a committed asset path can be observed (or
  deleted) by another file mid-run; `tests/battles-embeds.test.ts` mocks
  `assetImage` instead.
  `tests/battle-balance.test.ts` asserts boss win rates under BOTH neutral mods and
  Blood Moon (`enemyHp` 1.15, the only event that touches combat). Under an event only
  the TRAITED floor (>=0.85) is asserted — requiring the untraited floor there too is
  unsatisfiable without flattening the late campaign. Compensating a boss for an event
  multiplier goes on `hpMult`, NEVER `atkMult`: on Containment Site (the chapter-6 boss),
  `atkMult` 1.05 lands neutral traited at 1.0000, breaching the finale ceiling as it then
  stood (a hardcoded `<=0.99` assertion that has since been replaced — see below),
  and on Abyssal Trench, `atkMult` 1.05 lands neutral untraited at 0.8650 — below
  Containment Site's 0.8800 — inverting the monotone ladder. Cutting attack removes the
  threat, while cutting HP keeps the boss hitting as hard and shortens exposure. HP is
  the exposure knob, attack is the threat knob. Chapters 5, 6 and 7's bosses must be
  re-tuned TOGETHER — the monotonicity assertion couples them, so fixing one alone breaks
  another. This retired the old "boss multipliers never fall below 1.0" convention;
  Abyssal Trench's `hpMult` is 0.82 deliberately. The monotone ladder itself is now
  checked at 3,000 seeds with a 0.01 tolerance, never the 400 seeds every other
  assertion in this file uses — at 400 seeds the ladder's own gaps between adjacent
  bosses are smaller than its sampling noise, so a real inversion can read as a clean
  pass. Tune a boss by measuring at 3,000 seeds, not 400.
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
- Escrow is DERIVED, never stored: `locksFor(ctx, userId)` (`src/core/locks.ts`)
  returns `{ dinos, eggs }` maps of id → `LockReason`, built from the pending,
  unexpired trades the user SENT (only the offer side is ever escrowed, and the
  offer belongs to `fromUser`) plus their unclaimed `breedings` rows. The
  `dinos.locked`/`eggs.locked` columns were dropped in migration 0005 — a stale
  lock is no longer representable, so **no caller ever has to sweep before reading
  one**. That retired 11 of the 14 `expireStale` calls; the 3 that survive
  (all in `src/modules/trading/index.ts`) exist only to flip `status` for
  `/trade list` display and history, and `expireStale` is no longer load-bearing
  for escrow at all.
  Two properties keep this design honest, and both must survive future work:
  (1) **batch-per-user, not per-row** — callers build one `Locks` and test
  membership; never add a per-id `isLocked(dinoId)`, it becomes an N+1 inside
  `/dino list` and every autocomplete provider. Pure formatters therefore take
  the lock as an ARGUMENT (`eggLabel(egg, now, locked)` in
  `src/core/autocomplete.ts`, `eggListPayload(..., locks)` in
  `src/modules/hatchery/embeds.ts`) and their callers build the map once.
  (2) **expiry is evaluated at read time** — a trade escrows iff
  `createdAt + TRADE_EXPIRY_MS > now`; nothing sweeps.
  Enforcement still lands only at paths that CONSUME an item, never at paths that
  merely use one: `sellDino`, `incubateEgg` and `hatchEgg` reject escrowed rows,
  while battling an escrowed dino stays legal (`src/modules/battles/service.ts`)
  because it neither consumes nor transfers. `verifySide`'s `forTradeId` is not an
  exploit: at accept time the offer side is escrowed BY THAT VERY TRADE, so
  `acceptTrade` waives that one lock and nothing else — a second pending trade or an
  unclaimed breeding still blocks the transfer. It must stay a trade id, never a
  blanket boolean: escrow carries two reasons now, and waiving both would let a
  breeding's parents be traded away mid-flight, which `src/core/db/schema.ts`'s
  `breedings` note relies on being impossible. That check reads back ONE reason per
  id, so `locksFor` resolves breedings after trades on purpose — the fail-safe
  overwrite direction. Never swap those two loops.
  `createTrade`'s `verifySide` refuses an incubating egg, so an escrowed *and*
  incubating row can only be legacy data — `hatchEgg`'s guard is unreachable through
  the public API and its test builds the state by inserting the pending trade row
  directly. One subtlety survives the rewrite: the `/trade offer` autocomplete builds
  locks for the resolved `ownerId`, NOT `i.user.id`, because the `want-*` options list
  the TARGET's inventory — a test pins this by escrowing the target's dino in a trade
  with a third user, so reading the wrong id fails it. Scaling note: `locksFor` runs two
  unindexed table filters per call, but filters in SQL (unlike `expireStale`, which
  still filters by user in JS); sub-millisecond at current scale.
- Provenance survives the hatch: `hatchEgg` inserts the dino with
  `viaTrade: egg.viaTrade`. `eggs.viaTrade` had no reader before this; the three
  readers of `dinos.viaTrade` are all in the shop module, so dropping it at the hatch
  boundary silently reopened the alt-to-main shard funnel. Breeding is the third
  boundary: `startBreeding` snapshots `parentA.viaTrade || parentB.viaTrade` onto the
  `breedings` row (both parents are guaranteed present there, and the flag is only ever
  set, never cleared), and `claimBreeding` reads that frozen column back verbatim —
  `startBreeding` is the column's sole writer. Deliberately NOT re-derived from a fresh
  read of the live parents at claim time: they're nullable by then (a parent can be sold
  or traded away between start and claim) and a second source would only give the two a
  way to disagree. Any future path that MINTS an item from an existing one has to carry
  it too.
- `adminReset` must delete from every table `locksFor` reads — `trades` and now
  `breedings` — not only the tables holding the player's own items. The parents are
  deleted moments earlier, so a surviving pending breeding holds a Gene Lab slot busy
  forever and leaves a claimable pairing whose parents no longer exist.
- Gene Lab: a dino holds 0–2 traits (`src/data/traits.ts`) and **never two from
  one domain** — `TraitDomain` is `income | care | combat | meta`, and both
  `pickTrait` (fresh rolls) and `spliceTrait` (re-rolls) exclude every domain
  already occupied by the dino's surviving traits before drawing, so the rule
  holds without any caller checking it. That's also what makes cancelling
  pairs like `prolific` + `runt` structurally impossible — they share the
  `income` domain. `hungerAt(hungerAtFed, lastFedAt, at, drainMs)`
  (`src/core/clock.ts`) takes `drainMs` as a **required** parameter on
  purpose: a default would let a call site silently keep the flat 48h global
  rate instead of a trait-adjusted one (Hardy drains 25% slower, Grazer and
  Skittish 20% faster), reintroducing exactly the bug the parameter exists to
  prevent. Every production call site passes `drainMsFor(d.traits)` — never
  the bare constant — including `startBreeding`'s hunger-≥50 gate
  (`src/modules/genelab/service.ts`), `/feed all`'s hungriest-first sort, and
  `comfortAt`. Breeding and splicing both hold a dino in escrow the same way
  trading does: `locksFor` (`src/core/locks.ts`, documented in full above)
  resolves a doubly-locked dino as `'breeding'` because it evaluates
  `breedings` after `trades` — the fail-safe direction, since a breeding lock
  can never be waived by a trade's `forTradeId` exemption. **Never swap those
  two loops.**
- One facility of each kind per park (`buildLot` throws `DuplicateFacilityError`,
  whose `message` is the facility's display name). Paddocks stay duplicable — more of
  one kind IS the capacity progression. `facilityLevel` (`src/modules/park/service.ts`)
  resolves a kind to its highest-level row and is the single source for `capHours`,
  `facilityBonusPct` and `incubatorSlots`, so pre-existing duplicate rows on a live DB
  resolve to the best facility rather than to whichever the unordered SELECT returned
  first. It returns 0 for an absent kind on purpose: `Math.max()` over an empty array
  is `-Infinity` and neither level table guards its index, so a bare reduce would
  return `undefined` and poison `accruedIncome` with `NaN`. There is no cleanup
  migration and no way to delete a duplicate lot short of `adminReset`.
- Daily loop: one substrate, `track(ctx, userId, stat, delta)` (`src/core/stats.ts`),
  upserts a lifetime `user_stats` counter. Every call site sits inside the action's own
  existing transaction (or, where there isn't one already, is atomic on its own) — a
  rolled-back action must never count, so never call `track` outside the write it's
  measuring. Quest progress is **derived, never stored**: a `daily_quests` row freezes
  `baseline` (the counter's value at roll time) and `target`; `questProgress`
  (`src/modules/daily/service.ts`) computes `clamp(current - baseline, 0, target)` at
  read time, same philosophy as the Gene Lab's derived escrow locks above — nothing
  sweeps, nothing drifts, a missing `user_stats` row reads 0 at both baseline and
  progress. The roller (`pickBoard`) enforces three hard rules when it draws the day's
  3 quests from `QUESTS` (`src/data/quests.ts`): (a) no two slots share a stat; (b) at
  most one churn-stat quest (`CHURN_STATS`: `eggs_incubated`, `dinos_sold`) per board;
  (c) at most one food-paying quest per board. The roll itself is deterministic — the
  local `hashSeed` (FNV-1a-style) turns `` `${userId}:${dayKey}` `` into a seed for
  `mulberry32` (`src/core/rolls.ts`), never `ctx.rng()` — so concurrent
  first-interactions land on the same board and the unique `(userId, dayKey, slot)`
  constraint backstops the race with `INSERT OR IGNORE`.
  Streak chests (`chestFor`, `src/data/quests.ts`) pay on **personal bests only**:
  `claimQuests` only grants one when the post-tick streak exceeds `questStreakBest`,
  which is monotonic — deliberately breaking and re-climbing a streak re-pays nothing
  until the old best is exceeded, and `nextChestAt` advertises the next milestone above
  `max(streak, best)` so the hub never suggests a replay is worth it. The quest-complete
  hint (`dailyRouterHooks.postDispatch`, `src/modules/daily/hooks.ts`) fires one combined
  followUp after any successful dispatch, with four exemptions: autocomplete never
  reaches it at all (the router's autocomplete branch returns before hooks run); the
  `/daily`/`/achievements` commands and the `daily`/`ach` component prefixes are
  exempted by name (`EXEMPT_COMMANDS`/`EXEMPT_PREFIXES`) so there's no hint about the
  screen the user is already looking at; and an interaction that never replied (the
  errored path) is skipped, since `followUp` on an unreplied interaction throws.
  `adminReset` and `adminFastForward` (`src/modules/admin/service.ts`) both had to grow
  to cover the new tables: reset deletes `user_stats`, `daily_quests`, and
  `achievement_claims` rows and zeroes `questStreak`/`questStreakBest`/
  `lastQuestClaimAt`, the same "reset must cover every table the feature reads" lesson
  the Gene Lab's `breedings` fix taught; fast-forward shifts `lastQuestClaimAt` with the
  other time columns (guarded to rows where it's `> 0`, since 0 is its "never claimed"
  sentinel and an unguarded shift would invent a claim history) but deliberately leaves
  `daily_quests.dayKey` alone — fast-forward can't move the UTC calendar, so today's
  board stays today's, and shifting only the claim anchor is what lets a streak gap or
  continuation be simulated.
- Bot profile branding lives in `assets/branding/` — **not** `assets/images/`, whose
  every file must be WebP (`tests/images.test.ts`). Discord takes GIF only for an
  animated avatar or banner, at 512×512 and 680×240; those dimensions are contract
  values asserted in `tests/branding.test.ts`, so `scripts/make-gif.ts`'s over-budget
  ladder lowers frame rate (12 → 10 → 8) and never the canvas. `npm run deploy-branding`
  is an operator step, not part of any build: Discord rate-limits profile edits to
  roughly 2/hour, hence `--avatar-only` / `--banner-only`. It asserts the returned
  asset hash starts with `a_` — Discord's own confirmation that it stored the
  animation rather than a single static frame, which is otherwise a silent failure.
  Regeneration prompts and the ffmpeg flag reasoning are in `docs/assets/prompts.md`.
- Park rating (`src/data/progression.ts`) is a 1000-point scale (`RATING_SCALE`):
  every star figure anywhere in the game or its docs is `rating / 100`, ceiling
  10.0★. Two constants in that file are frozen by deliberate design decisions,
  not values to keep in sync as content ships — do not "fix" either to track the
  roster. `COLLECTION_TARGET` (190) is the rarity-weight sum of the species
  roster the collection term shipped against; it must never become a live sum
  over `allSpecies()` — a live denominator would tax every existing player's
  rating each time a new species ships, and the collection term's
  `Math.min(1, ...)` clamp is precisely what lets new species act as alternate
  paths to the existing target instead of moving it. `NPC_LEVEL_SANITY_CAP`
  (12, enforced in `tests/battle-content.test.ts`) must never be raised to
  accommodate a new boss: simulation during the Abyssal Trench / Containment
  Site work showed a boss whose effective level (`npcLevel + levelBonus`)
  exceeded it was unwinnable, which is why both new bosses were tuned down on
  `hpMult` instead of pushed up on level — see those chapter files' own
  comments in `src/data/battle/chapters/` for the numbers and the reasoning.
  Founder's Park's boss lands exactly on that cap too (`npcLevel` 11 +
  `levelBonus` 1 = 12, zero headroom) — the same tuning tradeoff, one more
  data point against ever raising it.
- Living world: `worldEventFor(now)` / `eventMods(now)` (`src/core/world.ts`)
  are pure functions of a UTC timestamp — the day's event is DERIVED, never
  stored, same philosophy as escrow locks and quest progress above.
  `WORLD_SALT` (`0x2c0`) is XORed into the day index before seeding
  `mulberry32` specifically so UTC days 0–4 all resolve to Clear Skies
  (fully neutral mods): `makeCtx` defaults `nowMs` to 0 (`tests/harness.ts`),
  so essentially the **whole offline test suite** runs on day 0 — an eventful
  epoch would have silently multiplied pinned fixtures across a dozen
  unrelated test files. `scripts/test-live.ts` is the one exception: it calls
  `ctx.setNow(Date.now())` deliberately, so its gallery renders under
  whatever event is live on the real calendar day, not day 0.
  Never reorder `WORLD_EVENTS` or change the salt without re-running
  `tests/world.test.ts`. Seasons (`seasonFor`/`seasonDay`, same file) are a
  separate, purely cosmetic 30-day/3-season cycle (`SEASON_DAYS`) with no
  modifiers at all — deliberately, since that's what removes every
  season×event stacking question before it can come up.
  Income is the only effect integrated over time: `accruedIncome`
  (`src/core/clock.ts`) splits its accrual window at every UTC midnight it
  crosses and samples `incomeMultAt` at each resulting segment's START, never
  once at request time — so a day's slice of pending income is always paid
  at that day's own rate, and delaying `/park view`'s Collect can never
  retroactively earn a better multiplier for time that already passed.
  Hunger drain rate and battle energy regen were deliberately never wired to
  any event: both are either inverted (regen counts up over time, the
  opposite direction from a one-shot cost) or, like income, accumulate
  across an arbitrarily long window — scaling either would have forced the
  same piecewise segment-splitting machinery through `clock.ts`/`energy.ts`
  that `accruedIncome` needed, for two knobs that already had a one-shot
  alternative (Heat Wave/Cold Snap scale `feedCostFor` instead of drain rate;
  Blood Moon scales `energyCostFor` instead of regen). For the same reason
  `hungerAt` requires `drainMs` (see the Gene Lab bullet above),
  `feedCostFor` (`src/modules/care/service.ts`) and `energyCostFor`
  (`src/modules/battles/service.ts`) both take `now` as a REQUIRED
  parameter, never defaulted — a default would let a call site silently keep
  the unmodified rate/cost, reintroducing the exact bug the parameter exists
  to prevent.
  Every price or cost a world event can scale is quoted and charged through
  exactly one helper — `eggPriceAt` / `foodPriceAt` / `roundCharge`
  (`src/modules/shop/service.ts`), `sellCashAt` / `roundPayout`
  (`src/modules/shop/shards.ts`), `feedCostFor`, `energyCostFor` — never a
  raw table value re-multiplied inline at each call site. When this pattern
  was introduced, egg price, food price, and sell cash each had three
  separate read sites (a display quote, an autocomplete label, and the
  actual charge or payout) and stage energy cost had five (the `runFight`
  gate, its error text, and its debit all read one local `cost` computed
  once, plus the chapters embed and the stage autocomplete each call
  `energyCostFor` independently) that would otherwise have had to agree by
  hand. Route any future price/cost surface through the matching helper
  rather than re-deriving it.
  `EventMods.hatchTraitOdds` (`src/data/world-events.ts`) is a
  `[0-trait, 1-trait, 2-trait]` array of FRACTIONS summing to 1 — the same
  convention as `WILD_SLOT_ODDS`/`BRED_SLOT_ODDS` (`src/data/traits.ts`) —
  fed straight into `rollSlotCount`/`rollTraits` with no normalization.
  Writing it on a 0–100 scale (e.g. `[45, 40, 15]`) would put the entire
  cumulative weight under the first step and roll **zero** traits on every
  single Migration Season hatch — the opposite of the intended buff.
  The world broadcast timer (`src/modules/world/broadcast.ts`) enqueues with
  a sentinel `userId: '0'`, never a real Discord snowflake, purely because
  `Scheduler.enqueue` requires a `userId` even though the broadcast isn't
  per-player. That sentinel is necessary, not incidental: `adminReset`
  deletes timers BY `userId` and `adminFastForward` shifts them BY `userId`
  (`src/modules/admin/service.ts`), so if the sentinel could ever collide
  with a real player's id, resetting or fast-forwarding that one player
  would silently delete or shift the world broadcast timer for every server.
  `'0'` can never collide with a real snowflake — Discord IDs start far
  above that range.
  The season's cosmetic ground art is wired the same "id crosses, asset doesn't" way as the
  event system's own art: `buildParkSnapshot` (`src/modules/park/snapshot.ts`) is the only place
  with a `Ctx`, so it alone stamps `ParkSnapshot.season = seasonFor(ctx.now())` — an OPTIONAL
  field, so the handful of hand-built `ParkSnapshot` test fixtures that predate seasons keep
  compiling and keep resolving to the base ground, exactly like a snapshot built before this
  feature shipped would. `renderParkPng` (`src/core/render/draw.ts`) never calls `seasonFor`
  or reads a clock itself — it stays a pure function of its `(snapshot, art)` arguments, which is
  what the byte-identical-output pin in `tests/render-draw.test.ts` requires. `ParkArt.groundBySeason`
  (`src/core/render/art.ts`) is a `Record<Season, Image | null>`, exhaustively null-initialized in
  `EMPTY_ART` the same way `dinoChips` is: a lookup miss on a real `Season` value must never read
  back `undefined`, because `drawImage(undefined)` throws exactly like `drawImage(null)` does and
  costs the whole park image. The fallback chain in `groundImage` (`draw.ts`) is
  `groundBySeason[season] ?? ground ?? <flat fill>` — a missing or unloaded seasonal raster
  degrades to the base ground, never to a blank canvas, and a snapshot with no `season` at all
  (every pre-season fixture) skips the seasonal lookup entirely. The three rasters load inside
  `loadParkArt`'s existing `Promise.all` alongside the base ground and both plates, so they
  inherit the same never-rejects guarantee for free — no second `Promise.all`, no separate
  top-level await for `worker.ts` to guard.
- Proactive park alerts (escape warning + income cap) run on their own 15-minute sweep
  timer, `alert_sweep` (`SWEEP_MS`, `src/modules/park/alert-sweep.ts`) — separate from the
  30-second scheduler tick that drives the five passive notifications above. It enqueues
  with the same sentinel pattern as the world broadcast timer: `userId: '0'`, because
  `Scheduler.enqueue` requires one even though the sweep isn't per-player. That sentinel
  must never collide with a real snowflake for the same reason as the broadcast timer's:
  `adminReset` deletes timers BY `userId` and `adminFastForward` shifts them BY `userId`
  (`src/modules/admin/service.ts`), so a collision would let one player's reset or
  fast-forward silently kill or shift alerts for every server.
  `alerts_sent` (`schema.alertsSent`, read/written via `src/modules/park/alert-record.ts`)
  is deliberately NOT the same kind of thing as the derived escrow locks or derived quest
  progress documented above — it's a record of a SIDE EFFECT (a DM already sent for a
  specific instant), not a value re-derived at read time, because the underlying
  conditions aren't monotone: `incomeCapAlertFor`'s `pending` can drop to 0 and jump back
  up to a fresh capped payout the moment its owner feeds, so "has this exact instant
  already been warned about" has no answer without a row that says so. `alreadySent`
  compares `firedForMs` to the stored value, not mere row existence, so a moved instant
  (the player fed, reassigned, or spliced) earns exactly one fresh warning rather than
  being silently suppressed by an old record.
  Escape alerts have two tiers — heads-up at 12h out (`ESCAPE_WARN_MS`), last call at 1h
  out (`ESCAPE_LAST_CALL_MS`) — and `ESCAPE_TIERS` is ordered MOST URGENT FIRST on purpose:
  `recordEscapeSent` collapses every LESS urgent tier behind whichever one just fired,
  never a more urgent one. Firing last call also marks heads-up sent for that same instant
  (it logically already happened), but firing heads-up must leave last call free, since
  that's a genuinely later beat still to come. Reversing `ESCAPE_TIERS`' order breaks tier
  *selection* — every dino matches heads-up first and last call never fires at all — and
  reversing the collapse *direction* breaks it a second way: heads-up firing would
  pre-mark last call as sent (same `firedForMs`, since the dino hasn't been fed), so the
  real last-call DM at the 1-hour mark would find `alreadySent` already true and silently
  never go out.
  The sweep must never call `settleEscapes`: it reads `escapedAt` straight off the row via
  `toClockDinos`, never a settling call, so a dino crossing the escape threshold mid-sweep
  still gets its last-call DM before anything stamps it escaped. Calling `settleEscapes`
  here would race the alert against itself — `escapeAlertsFor` filters out any row with
  `escapedAt !== null`, so a sweep that settled first would silently swallow the very
  warning it exists to send — and it would also turn "escapes are only settled when a
  command touches your park" (the Escapes section of `docs/gameplay.md`) into a lie, since
  a background timer isn't a command anyone touched.
  `/park`'s dispatch used to be a trap for the next subcommand: before `/park landmark`
  shipped, there was no subcommand switch, only a chain of explicit `=== 'rename'` /
  `=== 'alerts'` checks with the view path as the fallthrough, so a brand-new
  subcommand nobody had written a branch for fell through unguarded and rendered the
  dashboard — reporting success for a command that did nothing. `execute`
  (`src/modules/park/index.ts`) now dispatches on a real `switch (i.options.getSubcommand())`
  with a `case` for `rename`, `alerts` and `landmark`, `case 'view': break;` to reach the
  dashboard path below the switch, and a `default` arm that replies
  `'Unknown /park subcommand.'` ephemerally and returns — so an unrecognised subcommand
  now errors visibly instead of silently doing nothing. The switch's own comment records
  why it exists. Any future `/park` subcommand MUST be added as its own `case`; there is
  no longer a fallthrough to lean on, and none should be reintroduced.
  The park COMPONENT handler had the same hole and got the same fix: its `action` chain is
  now a `switch` with a `default` arm that `deferUpdate()`s, because an unrecognised
  `park:*` action previously returned without acknowledging and Discord painted "This
  interaction failed" after 3 seconds. A stale id from an older deploy lands there. Any
  future park component action MUST be added as its own `case`.
  A payload reaching `deliverNotification` must never carry an `attachments` key — the
  inverse of the `i.update` rule the battles bullet above documents. `fightFrames`'s F1/F4
  sends need an explicit `attachments: []` on every call because two send sites reuse one
  `MessagePayload` object and each must shed the other's stale set. `alertPayload`
  (`src/modules/park/alert-embeds.ts`) is the same one-object-two-send-sites shape
  (`deliverNotification` tries `channelSend` then falls back to `dmSend` on failure) but
  needs the opposite fix — omit `attachments` entirely — because discord.js's
  `MessagePayload.create()` pushes resolved files into that array IN PLACE and only
  shallow-copies it, so a pre-set key on the shared object would carry a mutation from the
  first send attempt into the second.
- Habitat enrichment stacks decor on TOP of the existing diet split, never underneath it:
  `paddockFit`/`paddockFitBase` (`src/core/clock.ts`) both still return 0.5 off-diet and
  0.75 on-diet-with-no-match, byte-identical to pre-enrichment behaviour — enrichment only
  ever applies once a paddock has already reached fit 1.0 (correct diet, ≥1 matching decor
  kind). `matchedKindCount` (`src/data/decor.ts`) counts DISTINCT decor kinds whose
  `biomeTags` intersect the resident's, deduped via a `Set` since `decorateLot` appends
  with no dedupe; `ENRICHMENT_STEPS` (`[1.0, 1.05, 1.1]`, indexed by matched-kinds − 1) is
  deliberately 1.0 at index 0 — the rung only starts climbing at a SECOND distinct match,
  never the first. That boundary is load-bearing: three tests (`tests/clock.test.ts`,
  `tests/tundra.test.ts`, `tests/dinos.test.ts`) each independently pin "one matching tile
  ⇒ exactly 1.0", and it's the reason shipping enrichment moved no existing income or
  escape figure anywhere in the suite — every fixture that predates the feature used at
  most one matching decor kind.
  `paddockFitBase` (no enrichment) vs `paddockFit` (enrichment included) is a REAL split,
  not a display-only clamp: `recomputeRating` (`src/modules/park/rating.ts`) is
  `baseComfortAt`'s ONLY caller, specifically so `ratingHighWater` — monotone, and the gate
  behind lot slots, expedition sites, battle chapters, the shop ceiling and the Mythic
  unlock — can never move just because a paddock got decorated past its first match. A
  `Math.min(1, comfort)` clamp on the enriched value is NOT a substitute: it bounds the
  ceiling, not the sensitivity, so a hunger-80 dino at fit 1.05 would still read 0.84 there
  instead of the correct pre-enrichment 0.80. `/dino list`'s own `Math.min(1, d.comfort)`
  clamp (`dinoListPayload`, `src/modules/park/index.ts`) is a different, legitimate use of
  that same shape — it only bounds what's DISPLAYED, never what's computed or stored, and
  the rung is broken out as its own `enriched +N%` mark rather than folded into the percentage.
  The ladder stops at fit 1.10 for a real mechanical reason, not just balance: past a point
  `escapeAt` outruns `hungerZero` and a dino sits at comfort 0 — earning nothing — while its
  8h grace runs out. The boundary is **not** a bare fit of 1.5, and the earlier "`12/fit < 8`
  once fit ≥ 1.5" wording was wrong twice over (inverted inequality, and blind to traits).
  The real algebra, from `src/core/clock.ts`, is
  `escapeAt − hungerZero = GRACE_MS − (ESCAPE_COMFORT / fit) · drainMs`, and `drainMs` is
  `HUNGER_DRAIN_MS / drainMult`, so that dead window opens iff
  **`fit · drainMult > 1.5`** where `drainMult = modProduct(traits, 'drain')` — independent
  of `hungerAtFed`, but NOT of the dino's traits. `grazer` (domain `income`) and `skittish`
  (domain `care`) both carry `drain: 1.20` in DIFFERENT domains, so one dino can legally hold
  both: `drainMult` 1.44, `drainMs` 33.33h, boundary at fit **1.0417** — under both shipped
  rungs. Measured against the real `escapeAt`, a grazer+skittish dino's dead window is
  −20 min (i.e. none) at fit 1.00, **+3.81 min at 1.05 and +25.45 min at 1.10**. This branch
  is what made the condition reachable at all: before it, fit topped out at 1.00 and no trait
  combination could cross the line. It ships knowingly — the window is bounded and small, and
  income stays monotone in enrichment — but the OLD guard (`expect(step).toBeLessThan(1.5)`)
  was toothless, since it passed while the condition it existed to prevent was already
  violated. `tests/enrichment.test.ts` now derives `MAX_DRAIN_MULT` (1.44 today) from the real
  `TRAITS` table — the product of the two largest per-domain `drain` maxima, since a dino holds
  at most two traits and never two from one domain — and bounds the worst reachable dead window
  against an explicit tolerance, so raising the cap or shipping a third drain trait moves the
  gate on its own. Any future cap raise is a decision about how long a dino may earn nothing,
  not a balance question.
  The three-kinds-per-biome decor catalog (`src/data/decor.ts`, grown from 12 kinds to 23)
  is a precondition for the cap, not incidental content: `tests/roster.test.ts`'s "every
  species can reach the enrichment cap" test is the machine gate, and it would fail on the
  original 12-kind table, where coast, tundra and volcanic each offered only one kind.
  Never ship a species whose `biomeTags` aren't covered by at least `ENRICHMENT_CAP_KINDS`
  distinct decor kinds.
  `/dex view`'s `species` option and `/admin give`'s `dino-species` option both use
  `.setAutocomplete(true)` with free-text search rather than `addChoices(...allSpecies())`
  — not a style choice. Discord's option choices cap at 25; 52 species is well past it, and
  `addChoices` THROWS once called past that cap, at builder-construction time — i.e.
  module init, i.e. bot boot. Get this wrong and the bot never starts at all; it is a crash,
  never a degrade.
  `/dex list` is the one paginated surface that does NOT use the shared `pageRow`
  (`src/core/paginate.ts`): its list is FILTERED, and `pageRow`'s
  `<prefix>:<action>:<userId>:<page>` customId has nowhere to put that state, so paging
  through it silently returned the unfiltered page — wrong rows, wrong title suffix, wrong
  page count, no error. `dexPageRow` (`src/modules/dex/embeds.ts`) builds
  `dex:page:<uid>:<page>:<rarity|->:<diet|->:<archetype|->` instead — 59 of Discord's 100
  customId characters at worst — and `pageRow` stays untouched for its four other callers
  (`ach`, `hatch`, `park:dinos`, `trade:list`). Any future filtered list needs the same
  treatment; do not widen `pageRow`. Everything after the prefix is CLIENT-supplied, so
  `parseDexFilters` (`src/modules/dex/service.ts`) validates each slug against the real
  union and degrades an unrecognised one (including the `-` placeholder) to "no filter" —
  a raw slug reaching `dexRows` would match nothing and render an empty compendium. The
  command path reads its own options through that same parser rather than casting, so
  there is exactly one validated way into `DexFilters`.
  Alert tolerance had to widen for enrichment: `ALERT_INSTANT_EPSILON_MS`
  (`src/modules/park/alert-record.ts`, 2 hours) exists because a decor purchase moves a
  dino's `escapeAt` by only 34–65 minutes (one or two rungs) — comfortably inside the 12h
  heads-up window — so a bare `firedForMs` equality check would re-fire a fresh DM on every
  single decor purchase. Row EXISTENCE alone is not an alternative fix: it would also
  suppress the legitimate case where a fed dino's escape instant leaves the window and
  later genuinely re-enters it, which is exactly what comparing `firedForMs` (with
  tolerance, not just presence) exists to allow.
  `recordSpeciesSeen` (`src/core/species-seen.ts`) has exactly three write sites, each
  inside the transaction that mints or transfers the dino so a rollback can't leave a
  credit behind: `hatchEgg` (`src/modules/hatchery/service.ts`), a trade's receiving side
  (`src/modules/trading/service.ts`), and `/admin give` (`src/modules/admin/service.ts`).
  Eggs are deliberately NOT credited at any point, including a species-pinned Mythic egg
  bought with shards — the dex only credits a species once a DINO of it actually exists,
  never a promise of one.
  A fourth writer exists but runs exactly once, by hand: `npm run backfill-species-seen`
  (`scripts/backfill-species-seen.ts`), an operator step to be run AFTER migration 0010,
  never as migration SQL — a failure there would block boot. It credits every player for
  every species still in their inventory via `INSERT OR IGNORE` + `MIN(hatched_at_ms)`, so
  a real `recordSpeciesSeen` credit always wins and re-running it is safe. Worth knowing
  because **once it has run there is no trace that the table was seeded rather than
  accumulated**: `species_seen` looks identical either way, and a species a player sold or
  traded away before the backfill reads as never-seen — `tx_log` has no species column, so
  that history is genuinely gone, which is the accepted cost of backfilling from live
  inventory instead of shipping every dex empty.
  Standing hazard, now worse than before: retiring a decor `kind` from `DECOR`
  (`src/data/decor.ts`) silently drops every paddock relying on it — `matchedKindCount`
  treats an unknown slug as a non-match rather than throwing, the same tolerance
  `traitDefs` gives a retired trait id. Pre-enrichment this could only cost a dino its
  1.0 → 0.75 fall; now it can also cost a rung on top — a paddock sitting at fit 1.10 in
  reliance on a since-retired kind silently drops to 1.05 or 1.00 the next time anything
  reads it, with no error and no record of what changed.
- Landmarks (`src/data/landmarks.ts`) are the endgame cash sink, and deliberately live
  on `users.landmarkTier` rather than shipping as a `DECOR` kind, even though a
  cosmetic decor item would have reused an existing catalog. `recomputeRating`
  (`src/modules/park/rating.ts`) sums `l.level + l.decor.length` as a flat length with
  no filter or weight, so a decor-shaped cosmetic would be worth +8.75 rating per tile
  (0.35 park weight × 1000 `RATING_SCALE` ÷ 40 `PARK_TARGET`) to a park below
  saturation and exactly 0 to a maxed one — power for the mid-game, nothing for the
  endgame, precisely backwards for a sink whose whole job is to matter most at the
  endgame. A `users` column reads from nothing rating cares about (`rating.ts`,
  `clock.ts`, `lotSlots`, `matchedKindCount` all ignore it), so staying powerless is
  structural, not a rule someone has to remember to enforce.
  The ladder (`buyLandmark`, `src/modules/park/landmarks.ts`) is a monotone integer
  with no tier argument — the only legal purchase is always
  `landmarkTierOf(ctx, userId) + 1` — which is what removes the refund path rather
  than merely deferring it: with only one buyable rung at any moment, there is no
  wrong one to click.
  That argument holds for the FUNCTION and not for the SURFACE, and the difference
  cost real money before it was fixed. `park:landmark:buy:<uid>` carried no tier and
  its handler answered with `i.reply`, so an old `/park landmark` message kept its
  original label and a live button forever while `buyLandmark` re-derived `current + 1`
  on every click: four clicks of one button labelled "Build Stone Marker" charged
  5,000,000, then 10,000,000, then 20,000,000, then 40,000,000 — 32x its own label,
  against a feature that ships no refund path precisely because a monotone ladder was
  believed to have nothing to mis-buy. The customId is now
  `park:landmark:buy:<uid>:<tier>` (the `hatch:crack:<eggId>` /
  `dex:page:<uid>:<page>:<slugs>` precedent — 40 of Discord's 100 characters at a
  20-digit snowflake), and the handler validates the parsed tier as an integer rung and
  rejects anything that is no longer `current + 1`, in that order, after the owner check
  and before any read or write. The success path additionally answers with `i.update` of
  a freshly built `landmarkPayload`, so the message just used advances to the next rung —
  but that is a second layer only, never the guard: any OTHER open message still holds a
  stale button, which is why the tier check is what actually protects the purchase. The
  top of the ladder is deliberately NOT pre-rejected — at tier 6 no `offered` can equal
  `current + 1`, so the click falls through to `buyLandmark`'s `LandmarkMaxedError`,
  whose text names `LANDMARKS[MAX_LANDMARK_TIER - 1].name` rather than a retyped
  literal. Any future button that spends money needs the same treatment: the rung, page
  or amount it was minted for belongs in the customId, because a Discord message is
  durable and its label is not re-derived.
- Putting state in the customId (`park:landmark:buy:<uid>:<tier>`,
  `dex:page:<uid>:<page>:<slugs>`) only helps if the handler also proves the bot MINTED
  that id. A component interaction can be emitted straight at the gateway with any
  `custom_id`, anchored on any message the attacker can address, and `routeInteraction`
  (`src/core/router.ts`) dispatches on the customId PREFIX alone — it never checks that
  the message belongs to the module handling it. So a handler that merely *parses* its
  own segments is trusting the attacker's arithmetic. **A component handler must verify
  the clicked customId is actually present on the message that carries it**:
  `clickedIdIsOnMessage(i)` (`src/core/components.ts`) walks `Message#components` —
  Discord's own record of the buttons the bot put there, unforgeable by the client —
  and matches the whole id by exact equality, never a prefix. It fails CLOSED (no
  components, no authority) and recurses into v2 containers, because failing to look
  inside a nesting component would break a legitimate click rather than admit a forged
  one. `duel:accept|decline` is the first caller and the reason the rule exists: without
  it, any player could force a duel on any other and move their Elo, and a forged
  `duel:decline` could blank an unrelated bot message via `i.update`.
  **Message authorship is NOT a substitute** — the first fix bound the challenger
  segment to `Message#interactionMetadata.user.id`, which proves only that the anchoring
  message came from SOME interaction of that player's; a public `/park view`, a
  `/duel record`, or their genuine challenge card addressed to a THIRD player all
  satisfy it, and the original exploit reproduced unchanged against it. The button set
  is the check; `interactionMetadata` is not read anywhere in `src/` any more.
  **That check is now enforced once, for every component, by the router itself.**
  `routeInteraction` gates `comp.execute` on `clickedIdIsOnMessage(interaction)`, so a
  forged customId anchored on a message that does not carry that button is rejected
  before any handler runs. Four placement details are each load-bearing: it sits AFTER
  `findComponent`, inside `if (comp)` (hoisting it would make the router acknowledge
  every unclaimed customId prefix in existence, replacing the fully-silent no-op pinned
  since the router was written); it rejects with `await i.deferUpdate()` and a
  `logger.warn`, never a bare `return` (which paints "This interaction failed" after 3s
  on every rejected click, an innocent pager double-click included) and never a distinct
  text reply (an oracle telling an attacker the GUARD, not the handler, stopped him);
  it `return`s BEFORE `postDispatch`, because `deferUpdate()` sets `i.deferred = true`
  and `dailyRouterHooks.postDispatch` gates only on `!i.deferred && !i.replied`, so
  falling through would emit a real quest/season followUp for a forged click and burn
  the one-shot `notifiedAt` / `hintedRung` stamps; and it lives inside the existing
  `try`, so a `deferUpdate()` that throws on an expired interaction is caught rather
  than becoming an unhandled rejection. Module-level `clickedIdIsOnMessage` calls are
  DEFENCE IN DEPTH from here on — the duel one stays because callers that invoke
  `comp.execute` directly bypass the router entirely: `scripts/test-live.ts`, and four
  S1 regression fixtures in `tests/duels.test.ts` that dispatch the same way (via
  `duelsModule.components[0].execute`, not through the router) and therefore FAIL
  LOUDLY — not pass vacuously — if the duel handler's own call is deleted.
  Nearly every rejected click is a harmless repeat of the action that just ran — a
  repaint race bounded to milliseconds — with one exception worth knowing: `alertPayload`
  (`src/modules/park/alert-embeds.ts`) puts Feed all / Collect / Mute on ONE row and any
  one of them wipes all three, so a click rejected there can be a DIFFERENT real action
  the user wanted, not merely a repeat of the one that just ran.
  **This closes CROSS-MESSAGE anchoring only, and misreading that is the most likely way
  the guard causes harm.** It does NOT protect against stale-same-message replay — the
  class that already cost real money on `park:landmark:buy`, whose stale buttons sat on
  their own messages and would pass this guard cleanly. Every future button that spends
  money, turns a page or names a rung still needs that state in its customId and
  validated in its handler; the router guard relaxes none of that.
  Select menus are routed now, and the guard was extended in the same change, exactly as
  this paragraph called for while selects were still unrouted: they dispatch through their
  own `selects` array and `findSelect` on `ModuleRegistry` (never by widening
  `ComponentDef.execute` — see that type's own doc comment for why), and
  `routeInteraction` gates the select branch on `clickedIdIsOnMessage` too, with the same
  fail-closed `deferUpdate` + `logger.warn` rejection the button branch uses. That guard
  proves the bot minted THIS MENU on THIS MESSAGE and nothing about `i.values`, which ride
  outside the `custom_id` on a separate client-supplied channel —
  `submittedValuesAreOnMessage` (`src/core/components.ts`) is the sibling guard for that,
  checking the submission against the message's own minted option list. Modals remain
  UNROUTED, so the rest of this warning still holds for them: if they are ever routed,
  extend `clickedIdIsOnMessage`'s walk to follow `SectionComponent.accessory` and
  `LabelComponent.component`, both of which sit outside `.components`, in the same change.
  And if a button or select is ever minted onto a message the bot does not own, add an
  explicit greppable flag on `ComponentDef`/`SelectDef` — never a prefix exception list
  inside the router.
  The guard's tests are its only evidence, and that is not a figure of speech: 101
  `fakeButton` sites exist and only 11 dispatch through `routeInteraction` — the
  other 90 call `execute` directly, and `npm run test:live` bypasses the router by its
  own design — so both existing gates are blind to this seam and a simulated version of
  the guard ran the whole suite green. The nine cases live in `tests/router.test.ts`
  ("router component guard", plus the real-payload sweep that reads every minted id out
  of the builder JSON rather than hand-typing it) and `tests/harness.test.ts` (the
  `fakeButton` default `componentIds: [customId]`, now load-bearing for those 90 sites).
  Do NOT add `componentIds` to the 90 direct-execute sites: they test handler logic and
  the default already models the truth. Re-run the grep rather than trusting these
  figures — `grep -rc 'fakeButton(' tests/` minus the one declaration site in
  `tests/harness.ts` gives the total, and `grep -n 'fakeButton(' <file>` cross-referenced
  against the same file's `routeInteraction(` calls gives the router-dispatching count;
  a future test file adding either kind of site will move both numbers again.
  The duel handler pairs it with a second rule worth copying: a client-supplied INSTANT
  needs clamping from ABOVE as well as below. `expiresAtMs` was bounded only as
  "finite and in the future", and `challengeAlreadyResolved`
  (`src/modules/duels/service.ts`) derives its replay window's lower edge from it —
  `[expiresAtMs - TTL, expiresAtMs]`. Narrowing that window's UPPER edge to `ctx.now()`
  looks tighter and is the opposite: the window is then empty for any anchor past
  `now + TTL`, the guard returns false unconditionally, and one fixed customId replays
  forever (three replays turned 1 duel row into 4). The handler's
  `expiresAtMs <= ctx.now() + DUEL_CHALLENGE_TTL_MS` clamp is what makes the original
  bound sound: it forces `expiresAtMs - TTL <=` the click that wrote the first row, so a
  later click of the SAME id recomputes the SAME window and provably finds that row
  inside it. Only the clamp is load-bearing: relaxing it reopens the incrementing-anchor
  bypass the bound alone cannot see. The bound (`<= expiresAtMs` rather than
  `<= ctx.now()`) is defence-in-depth, not a second lock — under the clamp the two are
  provably equivalent, and reverting the bound to `ctx.now()` with the clamp still in
  place leaves all 88 duel tests green.
- Legacy rank (`legacyPoints`/`legacyRank`, `src/modules/park/ranks.ts`) is DERIVED,
  same philosophy as escrow locks and quest progress documented above, and must NEVER
  be rebuilt on top of `user_stats`. Migration `0006_daily_loop.sql` backfilled only 6
  of that table's 18 counters from existing history (`stages_first_cleared`,
  `lots_built`, `trades_completed`, `breedings_started`, `breedings_claimed`,
  `expeditions_claimed`); the other twelve — including `dinos_fed`, `eggs_hatched` and
  `battles_fought` — start at 0 for every pre-0006 account and are unrecoverable. A
  rank built on that table would under-rank exactly the oldest, most invested players,
  the inversion the feature exists to prevent. It sums three sources that are each
  already monotone and already complete for every account instead: species discovered
  (`dexProgress`, max 52), achievement tiers claimed (`earnedTierCount`, max 48), and
  battle stars (`battle_progress.stars`, max 105) — 205 points total, nothing spent,
  nothing stored.
  **"Already complete for every account" is true of two of those three, and only
  transitively true of the achievement term** — say so rather than repeating the clean
  version. `earnedTierCount` counts `achievement_claims`, which is the right thing to
  count and is never lost, but every `ACHIEVEMENTS` track (`src/data/achievements.ts`)
  is gated on a `user_stats` counter, and 7 of the 12 sit on counters `0006` did not
  backfill: `eggs_hatched`, `dinos_fed`, `income_collected`, `battles_fought`,
  `battles_won`, `splices_done`, `dinos_sold`. (The other five — `expeditions_claimed`,
  `stages_first_cleared`, `trades_completed`, `breedings_claimed`, `lots_built` — are
  covered; `breedings_started` is backfilled but has no track, which is why 6 backfilled
  counters cover only 5 tracks.) A pre-0006 account therefore cannot claim 28 of the 48
  achievement points out of history it actually lived — **13.7% of the 205 ceiling
  inherits exactly the gap `user_stats` was rejected to avoid.** The code is still right:
  the shortfall is re-earnable by playing, where a rank built ON `user_stats` would have
  been permanently unrecoverable, and the dex and battle-star terms are complete in the
  full sense. Do not "fix" this by re-deriving the rank from counters.
  `legacyRank` resolves `max(stored legacyRankBest, computed legacyPoints)`, never the
  stored value alone — the column is a safety net, so a missed write is harmless and
  only matters when the computed value DROPS. The write lives in a separate
  `bumpLegacyBest(ctx, userId)` and must NEVER be folded into `legacyRank`, because
  `src/modules/park/visit.ts` calls that for another player's id and would otherwise
  mutate the row of a user who took no action.
- `capHours`, `breedingSlots`, `incubatorSlots` and `facilityBonusPct`
  (`src/modules/park/service.ts`, `src/modules/hatchery/service.ts`) each resolve a
  facility's level through the shared `levelValue` helper, which clamps a level ABOVE its
  per-level array to the array's top entry instead of indexing off the end into
  `undefined`. This is the safe direction on purpose: neither `npm test` nor
  `npm run typecheck` can see the alternative failure (`tsconfig` has `strict` but not
  `noUncheckedIndexedAccess`), and the failure mode is silent rather than a crash — an
  unguarded `capHours` reading `undefined` past its array's end turns `from + undefined`
  into `NaN`, and the Collect button on `/park view` renders the literal text
  "Collect NaN". `facilityBonusPct` was the last holdout, on its own inline `?? 0`: it
  could not produce `NaN`, but an over-range level silently zeroed that facility's whole
  income contribution rather than clamping, so it now goes through `levelValue` too and
  the rule has no exceptions. Any future per-level facility array needs the same guard,
  never a raw index.
- `PARK_TARGET` (`src/data/progression.ts`, 40) must never move, for any reason,
  including to compensate for a new cash sink or a new content ceiling. It's the
  denominator of the rating's park term, so raising it is a retroactive rating CUT for
  every park already at or past today's cap — and since stored `parkRating` only
  updates on a rating-changing action (see "When it actually updates" in
  `docs/gameplay.md`), the cut lands on accounts that did nothing wrong. `TRADE_MIN_RATING`
  (400, `src/data/trade.ts`) is checked against that same droppable stored value at
  both `createTrade` and `acceptTrade` (`src/modules/trading/service.ts`), so a target
  raise can silently revoke `/trade` for players already sitting near the gate and can
  kill trades already pending in a recipient's inbox, not just future ones.
  Also worth correcting here: an earlier assumption — that at least two decor pieces
  were mandatory to reach a 10.0★ park — never actually held. `buildLot` blocks
  duplicate FACILITIES only and explicitly exempts paddocks (building more of one
  paddock kind IS the capacity progression), so `VC L5 + 9 paddocks L4` alone reaches
  `parkRaw` 41 against `PARK_TARGET` 40 with zero decor ever placed. The park term has
  always been saturable on lot levels alone; 38 was the ceiling of one particular
  build, never of the game.
- The landmark cell (`drawLandmark`, `src/core/render/draw.ts`) is drawn as one extra
  grid cell AFTER the build slot, so every tile that existed before landmarks shipped
  keeps the exact coordinates it already had — which is why adding it broke none of
  `tests/render-draw.test.ts`'s pinned pixel samples. A missing or unloaded art band
  degrades to a flat plinth fill rather than reaching `drawImage(null)`, which throws
  and would cost the whole park image.
- `/top`'s `scored()` (`src/modules/leaderboards/service.ts`) costs a FIXED number of
  `.select()` queries per metric, independent of roster size: 1 for cash/rating (the
  candidate scan alone), 2 for stars (+ `battle_progress`), 2 for collection
  (+ `dinos`), 4 for legacy (+ `species_seen`, `achievement_claims`,
  `battle_progress` via `starScores`), 3 for season (+ `season_progress` scoped to the
  CURRENT `seasonIndex`, + `user_stats` for the whole board) — one more each for a
  server-scoped board, which reads `user_guilds` first to resolve `memberIds` (season
  server-scoped is 4; a guild with zero registered members costs exactly 1 — the
  `user_guilds` read alone, since both of `seasonScores`' reads short-circuit on an
  empty `memberIds` array without touching the DB). Every one of those extra reads is
  ONE query per source TABLE, grouped in JS, never one per candidate — the batch-per-
  user rule `src/core/locks.ts` already established, widened to batch-per-board.
  `seasonScores` (the live board-wide twin of `seasonPoints`, never the badge
  high-water — the same `legacyScores`/`legacyRankBest` split below, drawn for the
  same reason) iterates `Object.keys(STATS)` when computing each row's deltas, NOT
  `Object.entries(row.baselines)` — the two agree today, but only the former survives
  a new `StatId` shipping after live rows already exist; the latter would silently
  under-report that player against their own `/season` hub, which reads baselines the
  same STATS-keyed way. A player with no `season_progress` row for the current index
  scores 0 and is deliberately NOT rolled from this read path — minting a baseline
  from `/top` would be one write per candidate on every board render.
  Deliberately not `GROUP BY`: nothing in `src/` has ever used `groupBy`/`count`/`sum`,
  every read here is `.all()` plus a JS reduce, and SQL `SUM()` over an empty row set
  returns NULL where `.reduce(…, 0)` returns 0 — silently turning a fresh account's
  score into `NaN` instead of a clean zero. `legacyScores` is the board-wide twin of
  `legacyPoints` (`src/modules/park/ranks.ts`) — deliberately, not of `legacyRank`'s
  `max(stored, computed)` high-water (`legacyRankBest`) — and the two must always agree
  for a given user — a board that disagrees with the rank on that player's own park card
  is worse than no board. The pairing with `legacyPoints` and not `legacyRankBest` is also
  deliberate: the board answers "who is ahead right now" (a live standing that can
  legitimately fall — see `adminReset`), the park-card title answers "what have you ever
  earned" (a monotone high-water mark that must never fall), and conflating the two would
  let a wiped or otherwise-dropped account keep outranking players who are actually ahead
  of it. Both intersect `species_seen` against the LIVE species roster
  (a retired species id contributes nothing to either), but neither filters
  `achievement_claims` the same way — that term is a plain row count with no roster
  check, which is what keeps the two in agreement rather than one silently diverging.
  `tests/leaderboards.test.ts` pins every one of those integers via a `select`-counting
  `Proxy`, at two roster sizes (3 and 30) and both scopes (global and server) — a
  rewrite that reads any table twice, or scopes the wrong one, fails a specific pinned
  number, not just an equality check.
- `/park` has an `autocomplete()` now — its first — serving `feature`'s `dino` option,
  so `'park feature': ['dino']` lives in `tests/contract.test.ts`'s
  `AUTOCOMPLETE_OPTIONS` manifest. `park:tour:<targetUserId>`
  (`src/modules/park/index.ts`) and `top:visit:<targetUserId>`
  (`src/modules/leaderboards/index.ts`) are the repo's first customIds whose id
  segment is a TARGET rather than an owner — visiting is public and read-only, so
  neither carries an ownership check and neither should ever grow one; turning either
  into an ownership check would make Next park / Visit work only for the player whose
  park happens to already be on screen.
  Both of those visiting surfaces render somebody else's park behind an interaction, and
  BOTH acknowledge before they render — `park:tour` with `deferUpdate` + `editReply`
  (a tour advances ONE message rather than accumulating one per hop; `deferReply` would
  post a new one), `top:visit` with `deferReply` + `editReply` (the board it sits on must
  survive the click). That ordering is not stylistic: `visitPayload` awaits `renderPark`,
  whose own `RENDER_TIMEOUT_MS` (`src/core/render/client.ts`) is 3000 — Discord's ENTIRE
  initial-response window — and renders serialize process-wide through one chain, so queue
  wait stacks on top of the timeout. Rendering first cost the interaction to 10062 and
  showed "This interaction failed" with no park, which is also the one case `visitPayload`'s
  own `catch { png = undefined }` text-only degrade can never be delivered for. The
  existence check stays AHEAD of the acknowledgement at all three surfaces (`park:tour`,
  `top:visit`, `/park view user:`), because "That player has no park yet" is an EPHEMERAL
  answer and either defer would have committed it to a public message.
  Player-typed free text that reaches a public embed DESCRIPTION or a bot-authored,
  non-ephemeral message's CONTENT is defanged, never rejected outright: `defangLinks`
  (`src/core/text.ts`) splits the `](` sequence, because both surfaces render
  `[text](url)` as a masked link with arbitrary visible text — 80 characters of motto is
  ample for `[Free Nitro](https://evil.tld)`. A TITLE does not render it — `dashboardPayload`'s
  `.setTitle(user.parkName)` (`src/modules/park/embeds.ts`) was never exposed. The
  client-wide `allowedMentions: { parse: [] }` kills mention injection and does nothing
  about markdown. Three call sites now defang BEFORE storing, and every confirmation
  echo agrees with what was stored — a half-closed vector (store defanged, echo raw) is
  worse than a documented open one: `setMotto` (`src/modules/park/showcase.ts`) returns
  what it wrote, so `/park motto`'s echo just reads that back; `renameDino`
  (`src/modules/park/dinos.ts`, whose nicknames reach public battle embeds) defangs what
  it stores but returns `void`, so `/dino rename`'s echo (`src/modules/park/index.ts`)
  re-defangs the trimmed input itself rather than trusting the raw option — the fourth
  `defangLinks` call, and the only one that isn't at a store site; `/park rename`
  (`src/modules/park/index.ts`, pre-existing code that writes `parkName` directly rather
  than through a service — left that way on purpose, not restructured into one) now
  defangs once and reuses that single value for both the write and the reply. That last
  one closes a real vector, not a theoretical one: `parkName` reaches `landmarkPayload`'s
  public embed DESCRIPTION on `/park landmark` (`src/modules/park/embeds.ts`), which
  replies non-ephemerally, so an un-defanged park name was a live masked link there. It
  runs AFTER the trim and BEFORE the length check at every store site — defanging only
  ever lengthens a string, so a guard that ran first would no longer govern what is
  actually stored, and a motto or nickname landing exactly at its cap after `](` is
  rejected rather than stored one character over. The design spec explicitly said no
  sanitisation should be added; that line is superseded (see its own note).
  One path stays open, by design rather than oversight: `/top`'s leaderboard embed
  description (`src/modules/leaderboards/index.ts`) interpolates `r.displayName`, sourced
  from `i.user.displayName` — Discord's own guild nickname / global display name, not
  text a player types into any of our commands — for every OTHER player on the board, so
  it is also cross-user. Closing it is out of scope here; `getOrCreateUser`
  (`src/modules/park/service.ts`) is where that column is written, at every call site,
  always from `i.user.displayName`.
  Separately, `tests/help.test.ts` scrapes `/park`'s subcommand list straight from the
  REAL builder JSON and fails until `HELP_TOPICS.park.body` (`src/modules/help/index.ts`)
  mentions every one of them — this caught two implementers by surprise on the showcase
  work (`/park motto`, `/park feature`) before each remembered to add a line. Adding a
  new HELP_TOPICS **key** changes the `/help` builder's own choices and forces
  `npm run deploy-commands`; adding a line to an EXISTING topic's body does not.
- The season track (`/season`, `src/modules/daily/season.ts` + `src/data/seasons.ts`)
  rides the SAME 30-day cycle `seasonFor`/`seasonDay` already drove — `seasonFor`'s own
  comment in `src/core/world.ts` now says it plainly: the cycle is no longer purely
  cosmetic, but **a season still carries NO modifiers of any kind**, so every
  season×event stacking question stays exactly as dead as it always was — a reward
  rung is not a multiplier. `SEASON_EPOCH` (`src/core/world.ts`, **690**) is a WRITTEN
  LITERAL, never derived at runtime: `seasonNumberFor`/`seasonNumberOf` compute the
  DISPLAY number as `seasonIndex - SEASON_EPOCH + 1`, so moving this constant
  retroactively renumbers every badge a player has already earned. 690 is a deliberate
  release decision, not the index in flight at ship time (689): it's the index of the
  season beginning 2026-09-04, one boundary AFTER ship day, so the season already
  running at ship time numbers as **Season 0** — a short launch season — and Season 1
  is a full 30 days for every player. The alternative (epoching at 689) was rejected for
  two reasons: Season 1 would then be a stub of at most 21 days against a measured
  28-day Gene-Lab-less clear time, so some players could provably never earn the first
  badge; and 689 goes stale the moment the calendar crosses 2026-09-04 with nothing able
  to detect it, silently renumbering every badge already earned. 690 needs no recompute
  regardless of actual ship date.
  Two migrations, not one: **0015** (`season_progress` + `season_claims`, both tables,
  no column drop) and **0016** (`season_progress.hinted_rung`, added in a later task for
  one-shot hint suppression — see below). Both apply on the same boot.
  `season_progress` rows are RETAINED per season rather than swept on rollover, unlike
  `rollDailyQuests`'s delete-every-other-key sweep — because `badgeAt` on a PAST row is
  the permanent record of that season's capstone, and a sweep would destroy the
  collection it exists to record. The flip side is a real trap: points must NEVER be
  derived for a past season's row. `user_stats` keeps growing after a season ends, so a
  delta computed against an old frozen baseline climbs forever — `currentRow`/
  `seasonView`/`seasonPoints` all read ONLY the row matching `seasonIndexFor(ctx.now())`,
  never an arbitrary past one, and that restriction is the whole reason it's safe to
  retain the rows at all.
  The capstone badge is stamped from `dailyRouterHooks.postDispatch` — a WRITE
  context — and NEVER from a read path: `visitPayload`, `topPlayers`/`seasonScores` and
  `/park view user:<other>` must all stay pure reads of `badgeAt`, the same
  `legacyRank`/`bumpLegacyBest` split `src/modules/park/ranks.ts` already established.
  `stampSeasonBadge` is guarded on `badgeAt IS NULL` (idempotent, stamped instant never
  moves) and runs BEFORE the hint-exemption `return`s in `postDispatch` — a player who
  crosses the capstone while running an exempt command like `/season` itself must still
  have it recorded, only the hint TEXT is suppressed for exempt commands/prefixes.
  Because `postDispatch`/`preDispatch` are ROUTER hooks, anything that calls a command's
  `execute` directly — `scripts/test-live.ts`'s `slash()`/`button()` helpers do exactly
  this, bypassing `routeInteraction` entirely — never triggers `rollSeason` or
  `stampSeasonBadge` on its own. `test-live.ts` already calls `rollDailyQuests` by hand
  for the same reason; any season-related gallery case needs `rollSeason(ctx, userId)`
  called by hand BEFORE the `/season` command runs (its `seasonView(ctx, ...)!` asserts
  non-null and throws if the row was never rolled) and `stampSeasonBadge(ctx, userId)`
  called by hand to put a badge on a park card — there is no router in this script to do
  it for you.
  The day-1 bankable pool — the five sources with no facility or cooldown gate at all
  (care 120 + sales 100 + splicing 90 + commerce 60 + collections 60 = **430**) — is the
  real guard against maxing the ladder in a single sitting: 430/800 = 0.5375, just over
  half the 800 capstone, with `tests/season-balance.test.ts` pinning both the exact sum
  and the `< 0.55` ratio ceiling. That ratio is the tightest static margin in the whole
  balance suite (0.0125 of headroom) — a future cap increase on ANY of those five
  sources, even by 10 points, breaches it.
  **Genuine finding, not a defect: 7 of the 9 source caps never bind for the moderate
  profile inside a 30-day season — only `splicing` and `collections` do.**
  `genelab`'s 180-point cap, for example, is unreachable by the moderate profile inside
  the season window at all: its raw score tops out at 150 (`floor(30 days) * 5`), and
  the cap only becomes binding at day 36, six days past the season's own horizon. That
  matches the file's own stated design — caps exist to contain the GRINDER, not the
  baseline player — so don't "fix" a cap that looks slack without checking whether it
  was ever meant to bind for anyone but a player deliberately maxing that one source.
  **Measured economy, superseding the design spec's hand-computed hypotheses** (task 15
  independently re-derived every figure from live `seasons.ts` content, no tuning): the
  moderate profile clears the 800 capstone on day **21** (808 points, not the spec's
  hypothesised day 21.4); a Gene-Lab-less profile clears on day **28** (821 points, not
  day 27.3) — real slack before the 30-day boundary is **2 days**, not 2.7, making it the
  tightest of the four balance gates; a player who only logs in for 10 days reaches
  **418** points, landing between rung 4 (350) and rung 5 (475).
  The rung-unlocked hint is a HUMAN RULING, not the plan's original design: the plan's
  prose said to persist "already hinted" but its own code snippet implemented no stamp,
  which would have re-fired the hint on every non-exempt dispatch for up to 30 days. The
  shipped design hints ONCE per newly-unlocked rung via `season_progress.hinted_rung`
  (migration 0016, default -1, a HIGH-WATER MARK compared with `>`, not an
  unlocked-and-unclaimed existence check) — mirrors the quest side's
  notifiedAt-after-send discipline exactly: stamped only after the combined followUp in
  `postDispatch` actually succeeds, never before, so an errored send leaves the hint
  owed rather than silently consuming it. Claiming a rung never lowers `hinted_rung`
  (`claimSeason` doesn't touch the column), so a claim quietly retires that rung's hint
  without re-arming it; only a FURTHER rung unlocking (`topReady` climbing past the
  stored value) fires again, and a new season's fresh row resets to -1 on its own.
  `season:claim:<uid>:<seasonIndex>` carries the season index in the customId — the
  `park:landmark:buy` stale-button lesson applied before it needed relearning, since a
  `/season` card left open across a rollover would otherwise pay this season's rungs
  against last season's ladder. Validated strictly after the owner check and before any
  read or write; `!Number.isInteger(offered)` is provably redundant (`seasonIndexFor`
  always returns an integer, so the bare `!==` alone rejects every non-integer target)
  but is kept deliberately as explicit boundary validation on client-supplied input.
  The season-ending nudge rides the EXISTING 15-minute `alert_sweep` timer as a new
  alert kind, firing only to players holding unclaimed unlocked rungs. `firedForMs` is
  anchored to the season's true END instant (`(index + 1) * SEASON_DAYS * DAY_MS`), not
  `now + daysLeft * DAY` — the pre-flight scan on this plan caught that the naive
  version drifts with time-of-day past the sweep's own epsilon and would have DM'd
  roughly every 2 hours for the last 3 days of a season instead of once. It inherits the
  sweep's existing `lots.length === 0` guard, so a player with season points but zero
  lots is never nudged — reachable in principle (60 shop purchases alone clears rung 1)
  but accepted rather than special-cased, since that player still sees the rung on
  `/season` itself.
- Park guests (`/guests`, migration 0017) adds attendance as a fifth progression axis:
  `attendanceFrom(distinctSpecies, drawTotal, vcLevel)` (`src/data/attendance.ts`) is
  derived at read time and stored never, same philosophy as escrow locks, quest progress
  and world events. Two constants are FROZEN, `COLLECTION_TARGET`'s rule applied twice
  over: `ATTENDANCE_SPECIES_TARGET` (40) and `ATTRACTION_DRAW_TARGET` (210) must never
  become live counts over `allSpecies()`/`ATTRACTIONS` — a live denominator taxes every
  existing park the moment new content ships, and the `min(1, …)` clamp on each is what
  makes a new species or a new attraction kind an ALTERNATE PATH to the same target
  rather than silent inflation of it. `attendanceOf` (`src/modules/park/attendance.ts`)
  is PURE and must never write, because it's read for OTHER players' parks (`/top`, a
  visit, another player's card); the monotone high-water is stamped separately, only in
  a write context, by `recomputeRating` (`src/modules/park/rating.ts`) — the same
  `legacyRank`/`bumpLegacyBest` split `src/modules/park/ranks.ts` already established.
  `recomputeRating` now stamps TWO high-waters in one `UPDATE` — `ratingHighWater` and
  `attendanceHighWater`, each independently `Math.max`ed against its stored value in the
  same call — so every existing rating-triggering action (assign, build, upgrade,
  decorate, feed, rescue, trade) moves attendance's high-water too, with no new call
  sites and no risk of the two drifting apart. `/guests view` and `/guests claim`
  (`src/modules/guests/embeds.ts`, via `attendanceOf` → `toClockDinos`) are two surfaces
  that render attendance without calling `settleEscapes` first, unlike the park card
  (own or visited), which always settles before rendering it. This is safe, not merely
  tolerated, because `attendanceOf`'s own dino predicate is TIME-AWARE: it filters on
  `escapeMoment(d, now) === null` (`src/modules/park/attendance.ts`), not the stored
  `escapedAt` column, so a live-escaped-but-unsettled dino stops counting toward the
  variety term the instant it crosses, with no settle call needed. The board-wide twin,
  `attendanceScores` (`src/modules/leaderboards/service.ts`), is DELIBERATELY LAXER — it
  matches `recomputeRating`'s `assigned` filter and checks only the stored `escapedAt`,
  so a board row can read higher than that player's own `/guests view` for a park no
  command has touched since an escape. That gap is bounded and self-correcting: it
  converges the next time anything settles the row, the same standing lag `/top`
  already accepts elsewhere on this board. Never filter `attendanceOf` on the stored
  column instead of `escapeMoment` — that was the pre-fix behaviour (defect F2), and it
  let `attendanceHighWater` — monotone, with no path back down — bank guests from dinos
  that were long gone, since neither `/guests build` nor `/build` nor `/upgrade` calls
  `settleEscapes` and nothing else had settled them.
- `recomputeRating` must never be hoisted back above `/guests`' subcommand switch
  (`src/modules/guests/index.ts`). It used to run unconditionally for every subcommand,
  to stamp the attendance high-water before anything read it — but it writes three
  columns in one `UPDATE`, and one of them is `parkRating`, the LIVE value, which falls
  freely as comfort decays. `liveRating` (`src/modules/trading/service.ts`) is a plain
  `SELECT` of that same column, checked against `TRADE_MIN_RATING` at both `createTrade`
  and `acceptTrade`, so opening `/guests view` after a few hours of hunger drain could
  have dropped a park below the trade gate and killed a pending offer — a state change
  caused by reading a screen. `view` is a pure read and deliberately never recomputes;
  `build` and `claim` still call it, because each reads the high-water as its own unlock
  gate and each mutates regardless, so the `parkRating` write riding along carries no
  surprise. The high-water still advances on every build, claim, feed, assign, upgrade
  and decorate, so nothing becomes unreachable.
- `/park view` renders one of four tabs — `park | animals | lots | prestige`
  (`ParkTab`, `src/modules/park/embeds.ts`) — swapped in place. `dashboardPayload` keeps
  its name and IS the Park tab; `animalsPayload`, `lotsPayload` and `prestigePayload` are
  the others. Two customId families: `park:tab:<uid>:<tab>` is owner-checked, and
  `park:vtab:<targetId>:<tab>` carries a TARGET and deliberately is not — the `park:tour`
  precedent. Never merge them into one shape with a flag.
  **Every tab switch sends an explicit `attachments: []`.** `landmarkPayload` and the
  guests view get away with the omit-idiom because they always `attach()` on every call,
  so their `files` key alone already replaces the message's whole attachment set
  (discord.js `MessagePayload` — see the `fightFrames` bullet above); an explicit
  `attachments: []` there would be redundant, not wrong. A tab switch can't rely on that
  shortcut: the Park tab's own payload carries no `files` key at all when `renderPark`
  fails (its `RENDER_TIMEOUT_MS` is 3000, Discord's whole initial-response window, so a
  slow render is a real case, not a theoretical one), and without `attachments: []` the
  PREVIOUS tab's uploads — worst case the Animals tab's roster banner plus a
  featured-dino thumbnail, two files — would survive as orphan attachment cards under the
  failed render's embed.
  The Park tab `deferUpdate()`s BEFORE rendering and then `editReply`s, for that same
  timeout reason — renders serialize process-wide, so rendering before acknowledging can
  lose the interaction to 10062. The other three tabs are synchronous and `i.update`
  directly.
  `settleEscapes` runs ONCE per interaction in `renderTab`, never per builder: it is
  write-bearing and `buildParkSnapshot` settles again internally.
  `bumpLegacyBest` fires once per `/park view` COMMAND invocation — coupled to the fact
  that the Park tab is always the first screen a fresh `/park view` renders, not to the
  Park tab itself. `renderTab`'s `park` branch (a `park:tab`/`park:vtab` click navigating
  to or back to that tab) never calls it; every tab builder and the whole visit path read
  the pure `legacyRank` instead, so a navigation click never mutates a row.
  **Collect must stay the first button of the first row** — `tests/park.test.ts:208-218`
  indexes `components[0].toJSON().components[0]` positionally.
  Routed surfaces (`park:goto:landmark`, `park:goto:guests`) reply EPHEMERALLY and never
  `i.update`: a routed payload mints components under a foreign prefix, and those handlers
  re-render their own message with no tab row, so updating in place would strand the
  player one click from losing navigation.
  Tabs are a UI win, not a performance win: `/park view` costs dozens of `SELECT`s against
  a schema with exactly one index (`daily_quests_user_day_slot`), so a tab switch re-pays
  the same unindexed scans. `user_id` indexes on `lots`/`dinos`/`attractions` are the
  higher-leverage change and were left out of this work deliberately.
- Select menus route through their own `selects?: SelectDef[]` on `ModuleManifest`
  (`src/core/modules.ts`) with their own `findSelect` and their own boot-time duplicate
  check — NEVER by widening `ComponentDef.execute`. That declaration uses method syntax,
  so its parameter is bivariant: widening it was measured to break exactly ONE call site
  under `npm run typecheck` and go green everywhere else, while letting a select reach any
  of the seventeen button handlers minted across this codebase's modules, every one of
  which opens with `i.customId.split(':')` and none of which reads `i.values`. A select and
  a button MAY share a prefix — separate namespaces — but two selects may not.
  `routeInteraction` gates selects on `clickedIdIsOnMessage` exactly as it gates buttons,
  with the same `deferUpdate` + `logger.warn` rejection. That guard proves the bot minted
  THIS MENU on THIS MESSAGE and **nothing about `i.values`**, which arrive on a separate
  client-supplied channel. `submittedValuesAreOnMessage` (`src/core/components.ts`) is the
  sibling guard for those, checking the submission against the message's own option list —
  kept separate because the router calls the first guard for buttons too, which have no
  values. It is ALL-OR-NOTHING: a partly valid submission is rejected rather than filtered,
  since a shortened values array is a selection the player never made. Only
  `submittedValuesAreOnMessage` needs a `Set` for this — `offered = new Set(menu.options.map
  (o => o.value))`, never an object keyed by value, since `__proto__` and `constructor` read
  back truthy from a plain object. `clickedIdIsOnMessage` carries no equivalent risk to guard
  against: it never indexes into anything by an attacker-supplied key, only walks
  `Message#components` and compares each candidate to `i.customId` with `===`.
  Nothing in the installed discord.js or discord-api-types claims Discord's gateway
  validates submitted values, selection counts, or clicks on a `disabled` component, so
  this repo assumes none of it is enforced. **Never close a select flow by disabling the
  menu** — neither guard reads `disabled`, so a disabled select is not a lock. Remove the
  component instead.
  Modals are still NOT routed. If they are ever added, extend `clickedIdIsOnMessage`'s walk
  to follow `SectionComponent.accessory` and `LabelComponent.component` in the same change —
  both sit outside `.components`.
  `tests/lib/discord-limits.ts` knows the select rules (25 options, 100-char label and
  value, alone in its row); `tests/contract.test.ts` structurally CANNOT catch a
  select-menu mistake, since it walks command options only.
