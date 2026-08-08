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
  are. Separately, `withParkImage` (`src/modules/park/embeds.ts`) *assigns*
  `files`, so it drops anything `attach` added to the payload it wraps. It has
  three call sites, harmless today for two different reasons: both `/park view`
  branches (own park, and the read-only other-user view) in
  `src/modules/park/index.ts` wrap `dashboardPayload`'s output, and
  `dashboardPayload` (`src/modules/park/embeds.ts`) never calls `attach()` at
  all, so there is nothing to drop; `/help topic:park`
  (`src/modules/help/index.ts`) wraps the shared help-topic payload, which
  *does* call `attach()`, but only when `HELP_TOPICS[topic].art` is set, and
  `HELP_TOPICS.park` declares no `art` — give that topic art and the banner
  vanishes silently under `withParkImage`.
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
  chapter file + index import + WebPs + prompt rows) with zero engine changes.
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
  `docs/assets/prompts.md`): **art is keyed on archetype×diet, never on species**,
  which is what keeps adding a species a data-only change. `support-carnivore`
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
  `/park`'s dispatch is a trap for the next subcommand: there is no subcommand switch,
  only one explicit `i.options.getSubcommand() === 'rename'` check, then (since `/park
  alerts` shipped) one explicit `=== 'alerts'` check, and everything else — including a
  brand-new subcommand nobody wrote a branch for — falls through unguarded to the view
  path below and renders the dashboard successfully. A forgotten branch for a future
  subcommand doesn't error; it silently does nothing and reports success.
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
