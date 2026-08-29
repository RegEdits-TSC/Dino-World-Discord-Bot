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
