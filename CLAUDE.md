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
- `HELP_TOPICS` (`src/modules/help/index.ts`) stores a LAZY art descriptor
  (`art?: { kind, name }`), never a built `ImageRef` — `assetImage` returns a
  fresh `AttachmentBuilder` per call and the map is module-level (same class of
  mistake as calling `emojiTag` in a module constant). The `park` topic has no
  descriptor: it defers and renders the reader's own map, degrading to a
  text-only embed when `buildParkSnapshot`/`renderPark` throws. Adding or
  removing a topic KEY changes the `/help` builder choices and forces
  `npm run deploy-commands`; adding a field to the value type does not.
- Daily loop: one substrate, `track(ctx, userId, stat, delta)` (`src/core/stats.ts`),
  upserts a lifetime `user_stats` counter. Every call site sits inside the action's own
  existing transaction (or, where there isn't one already, is atomic on its own) — a
  rolled-back action must never count, so never call `track` outside the write it's
  measuring. Quest progress is **derived, never stored**: a `daily_quests` row freezes
  `baseline` (the counter's value at roll time) and `target`; `questProgress`
  (`src/modules/daily/service.ts`) computes `clamp(current - baseline, 0, target)` at
  read time, the same philosophy as escrow locks (`§escrow-derived-never-stored` in
  `docs/conventions/escrow-and-item-moves.md`) — nothing
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
- Living world: `worldEventFor(now)` / `eventMods(now)` (`src/core/world.ts`)
  are pure functions of a UTC timestamp — the day's event is DERIVED, never
  stored, the same philosophy as quest progress above and as escrow locks
  (`§escrow-derived-never-stored` in `docs/conventions/escrow-and-item-moves.md`).
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
  `EventMods.hatchTraitOdds` (`src/data/world-events.ts`) is a
  `[0-trait, 1-trait, 2-trait]` array of FRACTIONS summing to 1 — the same
  convention as `WILD_SLOT_ODDS`/`BRED_SLOT_ODDS` (`src/data/traits.ts`) —
  fed straight into `rollSlotCount`/`rollTraits` with no normalization.
  Writing it on a 0–100 scale (e.g. `[45, 40, 15]`) would put the entire
  cumulative weight under the first step and roll **zero** traits on every
  single Migration Season hatch — the opposite of the intended buff.
- Specs in this repo are dated records of a decision as it was made, so a spec proven
  wrong after implementation is deliberately NOT corrected in place. The worked example is
  `docs/superpowers/specs/2026-08-27-operator-refunds-design.md` §3 case 6, whose
  reset-boundary mechanism is false and shipped as unreachable dead code: the correction
  lives at `§spec-createdAt-boundary-is-false` in `docs/conventions/admin-service.md`, and
  a reader who finds the spec's mechanism should implement from there instead.
- `tests/help.test.ts` scrapes `/park`'s subcommand list straight from the
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
