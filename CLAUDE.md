# Dino World — repo conventions

The eight rules below are always in play. Everything else lives in `docs/conventions/`, one
doc per topic, injected when you touch a file that doc covers. The index under **Topics** is
there for the turns that come before any file is opened — planning, scoping, choosing where a
change goes — because nothing can be injected until something is touched.

## Always true

- **ESM NodeNext.** Every relative import carries a `.js` extension; without one `tsc` fails
  the build outright (TS2835 under `moduleResolution: nodenext`).
- **Time and randomness are injected.** Time comes from `ctx.now()`, randomness from
  `ctx.rng()` — never `Date.now()`/`Math.random()`: tests inject both via `makeCtx`, so a
  direct call is behaviour no test can pin. Every seeded carve-out in this repo names this rule.
- **DB access is synchronous** drizzle/better-sqlite3 (`.get()`/`.all()`/`.run()`), never
  awaited — and several check-then-write guards are sound only because no suspension point can
  open between the read and the write. Adding an `await` there reopens those races silently.
- **A builder change needs `npm run deploy-commands`.** Until it runs, Discord still advertises
  the old option set: that is how `/sell`'s `dino` autocomplete handler sat dead behind a
  builder that never advertised the option as autocompleting.
- **Run exactly one bot process per token.** Two gateway sessions on one token race for every
  interaction; `npm run test:live` is REST-only precisely so it never opens a second one while
  the bot is live.
- **Past 25 choices an option uses `.setAutocomplete(true)`, never `addChoices`.** Discord caps
  choices at 25 and `addChoices` THROWS once called past it — at builder-construction time, i.e.
  module init, i.e. boot: the bot never starts. A crash, never a degrade. The species roster is
  at 52 against that cap and only grows, so this is reachable from a species data file nobody
  would think to attach a builder rule to — which is why it is up here and not in a topic doc.
- **A customId carries the rung, page or amount it was minted for, and the handler validates
  it.** A Discord message is durable and its label is not re-derived: `park:landmark:buy:<uid>`
  omitted the tier it was buying, so four clicks of one button labelled "Build Stone Marker"
  charged 32x its own label. Parsing your own segments is not proof on its own —
  `routeInteraction` dispatches on the customId PREFIX alone.
- **`npm run build` does not typecheck tests.** `build` is `tsc` against `tsconfig.json`, which
  `include`s only `src`, and `npm test` (vitest) transpiles without typechecking — so a type
  error in `tests/` or `scripts/` passes both clean. `npm run typecheck`
  (`tsc --noEmit -p tsconfig.test.json`) is the gate; run it before every commit touching those.

## Topics

One doc per topic under `docs/conventions/`, each loaded automatically when a file it covers is
read or edited. Read one directly when you are planning against it rather than editing it.

- **`admin-ledger`** — `/admin ledger`'s ephemeral flag, its zero-movement filter and its own
  pager customId. Fires on `src/modules/admin/ledger.ts` and `index.ts`.
- **`admin-service`** — reversal confirmations, the reset marker and the boundary cut on it,
  the queued DM note. Fires on `src/modules/admin/service.ts`, `guard.ts`, `drizzle/**`.
- **`art-asset-files`** — WebP q95, variant numbering, cutout/banner dimensions, prompt rows.
  Fires on `assets/images/**`, `scripts/fit-art.mjs`, `docs/assets/prompts.md`.
- **`art-resolver`** — `assetImage`, `dinoImage`, `pickVariant`, `hashSeed`: seeded versus
  unseeded picks. Fires on `src/core/images.ts`, `src/core/rolls.ts`.
- **`battle-content-and-balance`** — chapter ids, `rosterFor`, boss tuning knobs, the seed count
  to tune at. Fires on `src/data/battle/**`, `src/data/sites.ts`, `tests/battle-*.test.ts`.
- **`bot-profile-branding`** — the animated avatar/banner pipeline and its contract dimensions.
  Fires on `assets/branding/**`, `scripts/make-gif.ts`, `src/deploy-branding.ts`.
- **`clock-comfort-and-feeding`** — hunger drain, comfort, enrichment rungs, feed costs. Fires
  on `src/core/clock.ts`, `src/data/decor.ts`, `src/data/foods.ts`, `src/modules/care/**`.
- **`command-and-handler-surface`** — builders, the five registration sites, the autocomplete
  provider contract, component prefixes. Fires on every `src/modules/*/index.ts`.
- **`daily-quests-and-stats`** — `track`, derived quest progress, board rolling, streak chests.
  Fires on `src/modules/daily/service.ts`, `src/data/quests.ts`, `src/core/stats.ts`.
- **`economy-core`** — compensating rows, terminal reversals, `SIDE_EFFECTS`. Fires on
  `src/core/economy.ts`, `src/data/tx-reasons.ts`.
- **`embed-payload-builders`** — `attach`, attachment-name collisions, payloads reused across
  two sends, pagers and select limits. Fires on every `src/modules/*/embeds.ts`.
- **`emoji-pipeline`** — SVG source, PNG build, upload manifest, the resvg gradient trap. Fires
  on `assets/emojis/**`, `src/core/emojis.ts`, `src/build-emojis.ts`.
- **`escrow-and-item-moves`** — `locksFor`, provenance across mints, trait domains, one helper
  per scalable price. Fires on `src/core/locks.ts`, trading, shop, hatchery, genelab.
- **`fights-and-duels`** — commit-before-present, the F1/F4 frame contract, `queueEdit`, the
  duel replay clamp. Fires on `src/modules/battles/**`, `src/modules/duels/**`.
- **`help-topics`** — lazy art descriptors, the park topic's deferred render, the gate that
  makes a body name every subcommand. Fires on `src/modules/help/index.ts`.
- **`leaderboards`** — `scored()`'s fixed query counts, the legacy and season twins, why no
  `GROUP BY`. Fires on `src/modules/leaderboards/**`.
- **`notify-and-runtime`** — `NotifyPayload`, the mention rules, `ctx.sleep`. Fires on
  `src/core/notify.ts`, `src/core/context.ts`, `src/index.ts`.
- **`park-png-renderer`** — sync versus async decode, `EMPTY_ART`, the worker's never-reject
  boot. Fires on `src/core/render/**`, `src/modules/park/snapshot.ts`, `assets/images/park/**`.
- **`park-progression`** — rating, ranks, attendance, lots and landmarks: frozen denominators
  and the pure-read rule. Fires on `src/modules/park/rating.ts` and its neighbours, `guests/**`.
- **`park-surface`** — `/park`'s tabs, the confirm flow's staleness anchors, defanging
  player-typed text. Fires on `src/modules/park/index.ts`, `embeds.ts`, `src/core/text.ts`.
- **`prose-and-specs`** — never write a count into prose; specs are dated records, corrected in
  conventions rather than amended. Fires on `CLAUDE.md`, `README.md`, `docs/**`, `.claude/**`.
- **`router-and-registry`** — the two component guards, prefix dispatch, select namespaces,
  what stays unrouted. Fires on `src/core/router.ts`, `components.ts`, `modules.ts`.
- **`schema-and-migrations`** — the FK bracket around `migrate()`, which reads are indexed and
  which deliberately are not. Fires on `src/core/db/**`, `drizzle/**`.
- **`season-track`** — `SEASON_EPOCH`, retained rows, the hint high-water, measured balance.
  Fires on `src/modules/daily/season.ts`, `src/data/seasons.ts`, `src/core/world.ts`.
- **`species-and-dex`** — the roster, the frozen targets beside it, the dex that credits it.
  Fires on `src/data/species/**`, `src/data/progression.ts`, `src/modules/dex/**`.
- **`test-harness-and-gates`** — what the fakes enforce, what `test:live` is, which gate sees
  which files. Fires on `tests/harness.ts`, `scripts/test-live.ts`, the tsconfigs.
- **`timers-and-alerts`** — sweep cadence, sentinel user ids, escape tiers, side-effect records.
  Fires on `src/modules/park/alert-*.ts`, `src/core/scheduler.ts`, `world/broadcast.ts`.
- **`world-events`** — the derived daily event, `WORLD_SALT`, odds written as fractions. Fires
  on `src/core/world.ts`, `src/data/world-events.ts`, `src/modules/world/index.ts`.
- **`fallback`** — no doc claims this file yet. Fires on anything under `src/`, `scripts/` or
  `tests/` that no topic above has claimed.

<!-- UNMIGRATED: everything below moves to docs/conventions/ and this marker
     is deleted by the final task. Nothing may be added below this line. -->

- `expireStale` survives in the `/trade accept|decline|cancel` autocomplete provider
  only because that list's `status` filter is what hides a dead trade.
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
- `fightFrames` (`src/modules/battles/embeds.ts`) is the one exception to the rule that
  every embed image is wired through `attach` (`§always-use-attach` in
  `docs/conventions/embed-payload-builders.md`): every ref
  it builds is dressed onto several embeds and the files are then split across two
  payloads by the F1/F4 contract — do not convert any of them, however many there are.
- How many filename pins the suite holds against a base art name is a figure to derive,
  never one to write into prose:
  `grep -rho '[A-Za-z0-9_-]*\.webp' tests/ | sort | uniq -c` if you actually need it. The
  next pin to land makes a written count wrong, silently — the same reason
  `§router-guard-test-evidence` in `docs/conventions/router-and-registry.md` carries no
  counts. The resolver default that makes such a pin valid at all is
  `§unseeded-returns-base` in `docs/conventions/art-resolver.md`.
- **Audit art call sites with `grep -rn 'assetImage(' src/`, never by kind literal.**
  `src/modules/help/index.ts` calls `assetImage(t.art.kind, t.art.name, i.user.id)` — the
  kind is a VARIABLE read off `HELP_TOPICS`, the only such call site in `src/`, and it is
  invisible to an `assetImage('sites'` / `assetImage('banners'` grep. Every enumeration on
  this feature — the plan, three reconnaissance passes, two implementers — grepped for the
  literal and every one of them missed it; that one line serves every art-bearing help
  topic and it shipped unseeded until a reviewer read the file.
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
  (`src/modules/battles/index.ts:34-46`). Those same two
  send sites also need ORDERING, not just unshared arrays: `entry.skipped` is
  only observable between frames, so a Skip landing while a beat frame's
  `editReply` is in flight cannot stop that PATCH, and a beat frame landing after
  F4 restores an embed pointing at a chapter banner F4 already dropped — a
  permanently broken image. `queueEdit` serializes every edit on a presentation
  behind the previous one and re-checks a guard before sending, so F4 is the last
  PATCH in either interleaving; the lock is free during `ctx.sleep`, so a Skip
  clicked between frames still answers instantly. Any future third writer to a
  presented message must go through the same queue.
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
- Dino art is keyed on archetype×diet, with a per-species file as an optional override
  (`§dino-art-archetype-diet-with-species-override` in `docs/conventions/art-resolver.md`),
  so a species with no file of its own costs no art. `support-carnivore`
  shipped with zero species using it for exactly that reason; Archelon (uncommon,
  support archetype, carnivore diet) now does, and it needed no new art at all —
  proof the guarantee holds. That fixed cost has
  a fidelity price: `archetype` is a combat concept, not a body-plan one, so
  outliers share art loosely — `swift-carnivore` covers both `velociraptor` and
  `quetzalcoatlus` (a beaked pterosaur), rendered as a scaled toothy theropod.
  Accepted deliberately: a per-species `silhouette` field was considered and
  declined, since it would have traded 8 images for roughly 12 plus a migration
  across all 40 species files, to fix fidelity for a handful of outliers.
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
  table filters per call, but filters in SQL (unlike `expireStale`, which still filters by
  user in JS). Both were unindexed until migration 0018, which added `trades_status_from`
  and `breedings_user_claimed` to cover exactly those two reads — the trades index leads
  with `status` rather than the user because `expireStale` filters on `status` alone and
  has no user scope to narrow it.
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
  shared `hashSeed` (FNV-1a, `src/core/rolls.ts` since the art-variant resolver became
  its second caller) turns `` `${userId}:${dayKey}` `` into a seed for
  `mulberry32` (same file), never `ctx.rng()` — so concurrent
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
- Two constants in `src/data/progression.ts` are frozen by deliberate design decisions,
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
  Everything after a `/dex list` pager customId's prefix is CLIENT-supplied, so
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
- `tx_log.reverses_id` is deliberately NOT a DB-level foreign key. The table is
  append-only — nothing in `src/` UPDATEs or DELETEs a ledger row, and a reversal is a
  compensating row rather than an edit (`§reversal-is-a-compensating-row` in
  `docs/conventions/economy-core.md`) — so nothing can ever dangle: the constraint would
  buy nothing and costs drizzle type inference.
- Specs in this repo are dated records of a decision as it was made, so a spec proven
  wrong after implementation is deliberately NOT corrected in place. The worked example is
  `docs/superpowers/specs/2026-08-27-operator-refunds-design.md` §3 case 6, whose
  reset-boundary mechanism is false and shipped as unreachable dead code: the correction
  lives at `§spec-createdAt-boundary-is-false` in `docs/conventions/admin-service.md`, and
  a reader who finds the spec's mechanism should implement from there instead.
- The duel handler pairs the customId guards with a second rule worth copying: a
  client-supplied INSTANT
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
- One text-injection path into a public surface stays open, by design rather than
  oversight: `/top`'s leaderboard embed
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
- Two constants behind park attendance are FROZEN, `COLLECTION_TARGET`'s rule applied
  twice over: `ATTENDANCE_SPECIES_TARGET` (40) and `ATTRACTION_DRAW_TARGET` (210)
  (`src/data/attendance.ts`) must never
  become live counts over `allSpecies()`/`ATTRACTIONS` — a live denominator taxes every
  existing park the moment new content ships, and the `min(1, …)` clamp on each is what
  makes a new species or a new attraction kind an ALTERNATE PATH to the same target
  rather than silent inflation of it.
- `attendanceScores` (`src/modules/leaderboards/service.ts`), the board-wide twin of
  `attendanceOf` (`src/modules/park/attendance.ts`), is DELIBERATELY LAXER — it
  matches `recomputeRating`'s `assigned` filter and checks only the stored `escapedAt`,
  so a board row can read higher than that player's own `/guests view` for a park no
  command has touched since an escape. That gap is bounded and self-correcting: it
  converges the next time anything settles the row, the same standing lag `/top`
  already accepts elsewhere on this board.
- Migration 0018's read indexes are not a blanket `user_id` sweep and must not become
  one. Every composite
  primary key in this schema already leads with `user_id`, so those tables need nothing —
  the only two that gained an index (`season_progress`, `user_guilds`) did so because their
  hot read filters the key's *non-leftmost* column, which the key cannot serve. `tx_log`
  used to have no filtered read anywhere in `src/` at all; operator refunds
  (`docs/conventions/admin-ledger.md`) gave it its first, and the rule survives with one
  carve-out. The reads are: by `id`, which the
  primary key already serves; by `reverses_id`, the double-reversal guard inside
  `EconomyService.reverse`; and two per-player reads, `/admin ledger`'s scan by `user_id` and
  `adminReverse`'s reset-boundary lookup, which filters `(user_id, reason)` — worth knowing
  before revisiting this decision, since the composite is the shape an index would have to
  serve. `tx_log_reverses` (migration 0019) is
  **PARTIAL** — `where reverses_id is not null`, the same shape as `timers_due` — so an
  ordinary charge, on what will become the largest table in the schema, never enters the
  index and pays essentially nothing for it, while the guard stays logarithmic. `user_id`
  stays deliberately UNINDEXED and should: it would charge write cost on every economy
  transaction in the game to serve a command an operator runs a few times a month. See the
  per-index comments in `src/core/db/schema.ts` for which read each one serves.
