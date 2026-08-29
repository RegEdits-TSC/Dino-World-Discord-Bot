# Test harness and gates

Fires on: `tests/harness.ts` and `tests/harness.test.ts`, the cross-module
`tests/journeys.test.ts`, the limit tables in `tests/lib/discord-limits.ts` and
`tests/discord-limits.test.ts`, `scripts/test-live.ts`, and the build and CI config that
decides which gate reads which files — `vitest.config.ts`, `tsconfig.json`,
`tsconfig.test.json`, `package.json`, `package-lock.json` and `.github/workflows/ci.yml`.

**A green suite proves nothing about a seam it cannot observe.** Every gate here sees a
bounded slice: the offline suite opens no socket and runs on a fixed clock,
`npm run test:live` never opens a gateway session and never routes an interaction,
`npm run build` never reads `tests/`, and a fake enforces only the parts of a real API
someone taught it. A passing run is evidence about the seams some gate actually watches
and about nothing else — so before treating one as proof, name the seam the change
touches and confirm something is looking at it.

## Headlines

- The `tests/harness.ts` fakes (`fakeCommand`/`fakeAutocomplete`/`fakeButton`) enforce the real interaction lifecycle — reply-once, defer-before-`editReply`/`followUp` — throwing the same `InteractionAlreadyReplied`/`InteractionNotReplied` errors discord.js would, so a lifecycle mistake fails offline instead of at runtime. §harness-lifecycle-enforced
- The fakes validate every reply payload against Discord's message limits, so a breach fails in a test rather than as a rejected API call in production. §harness-validates-payload-limits
- Option getters are backed by the command's REAL builder JSON: an unknown fixture option key, or a getter called with the wrong type for that option, throws instead of silently returning null or the wrong value. §harness-option-getters-from-builder
- `npm run test:live` is REST-only and never logs in a second gateway session — that is the only reason it is safe to run against the dev guild while the bot is live. §test-live-rest-only-gallery
- Calling a command's `execute` directly bypasses `routeInteraction`, so router hooks never fire: a season gallery case must call `rollSeason` and `stampSeasonBadge` by hand or it throws on a row that was never rolled. §router-hooks-skip-direct-execute

## harness-lifecycle-enforced

The fakes in `tests/harness.ts` (`fakeCommand`/`fakeAutocomplete`/`fakeButton`)
enforce the real interaction lifecycle — reply-once, and defer-before-
editReply/followUp — throwing the same `InteractionAlreadyReplied`/
`InteractionNotReplied` errors discord.js would.

## harness-validates-payload-limits

The fakes validate every reply payload against Discord's message limits.

## harness-option-getters-from-builder

The fakes back `getString`/`getInteger`/etc.
option getters with the command's real builder JSON: a fixture option key or
a getter called with the wrong type for that option throws instead of
silently returning null or the wrong value. Synthetic command names the
module registry doesn't know about (router tests use these) skip builder
lookup entirely and fall back to the old permissive getters.

## test-live-rest-only-gallery

`npm run test:live` (`scripts/test-live.ts`) posts the payload gallery — every
case's real embeds, components, and images — to `TEST_CHANNEL_ID` for
cosmetic review. It's REST-only: it deploys builders and posts messages over
`discord.js`'s REST client, never logging in a second gateway session, so
it's safe to run against the dev guild while the bot is live.

Three further things are true of this script, and each one changes what a gallery case
has to do for itself. It bypasses the router
entirely (below). It runs on the real calendar clock rather than the suite's day 0 —
`§world-salt-day-zero-epoch` in `docs/conventions/world-events.md`. And `ctx.sleep` is an
instant stub there as it is in `makeCtx`, so no cinematic actually waits:
`§ctx-sleep-injected` in `docs/conventions/notify-and-runtime.md`.

## router-hooks-skip-direct-execute

Because `postDispatch`/`preDispatch` are ROUTER hooks, anything that calls a command's
`execute` directly — `scripts/test-live.ts`'s `slash()`/`button()` helpers do exactly
this, bypassing `routeInteraction` entirely — never triggers `rollSeason` or
`stampSeasonBadge` on its own. `test-live.ts` already calls `rollDailyQuests` by hand
for the same reason; any season-related gallery case needs `rollSeason(ctx, userId)`
called by hand BEFORE the `/season` command runs (its `seasonView(ctx, ...)!` asserts
non-null and throws if the row was never rolled) and `stampSeasonBadge(ctx, userId)`
called by hand to put a badge on a park card — there is no router in this script to do
it for you.

This is the home of the direct-execute bypass. It bites in other places too, and each
consequence is recorded where it lands. A module-level `clickedIdIsOnMessage` call is defence in
depth rather than dead code, because a direct-execute caller never passes the router's
copy — `§module-guard-defence-in-depth` in `docs/conventions/router-and-registry.md`. The
same argument earns the Lots menus their own duplicate allowlist:
`§handler-guard-copies-are-defence-in-depth` in
`docs/conventions/router-and-registry.md`. And it is why the router's own guard has to be
proved by tests that dispatch through `routeInteraction`, since neither the bulk of the
suite nor `test:live` reaches it — `§router-guard-test-evidence` in
`docs/conventions/router-and-registry.md`.
