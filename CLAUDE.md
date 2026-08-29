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
- `fightFrames` picks its thumbnail once, up front: the boss portrait on a boss
  stage, else the archetype art of `rosterFor(stage, squad.length)[0]` — the same
  lead enemy the Enemies field opens with, so the frame can never disagree with
  the fight. A boss stage whose portrait is missing degrades to **no** thumbnail;
  it must never fall back to archetype art, because `rosterFor`'s lead entry on a
  1-dino squad IS the boss. One merged `thumb` ref feeds `dress()` (F1-F3), F4's
  `setThumbnail`, and both `files` arrays, so the F1/F4 upload contract holds
  without a second code path.
- Battles: the fight pipeline is **commit-before-present**: `runFight` commits every
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
- `NPC_LEVEL_SANITY_CAP` (`src/data/progression.ts`, 12, enforced in
  `tests/battle-content.test.ts`) is frozen by a deliberate design decision, not a value
  to keep in sync as content ships — do not "fix" it to track the roster. It must never
  be raised to
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
- `attendanceScores` (`src/modules/leaderboards/service.ts`), the board-wide twin of
  `attendanceOf` (`src/modules/park/attendance.ts`), is DELIBERATELY LAXER — it
  matches `recomputeRating`'s `assigned` filter and checks only the stored `escapedAt`,
  so a board row can read higher than that player's own `/guests view` for a park no
  command has touched since an escape. That gap is bounded and self-correcting: it
  converges the next time anything settles the row, the same standing lag `/top`
  already accepts elsewhere on this board.
