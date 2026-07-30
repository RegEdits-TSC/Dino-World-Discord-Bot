# Full-functionality testing — design

Date: 2026-07-25
Status: approved

## Goal

Automate testing of as much bot functionality as possible so that manual
review is limited to cosmetics (image renders, emoji art, banner layout).
Everything else — command logic, interaction lifecycle, Discord payload
validity, builder↔handler contracts, multi-step player journeys, deploy
scripts, scheduler/notification plumbing — is verified by automated tests
the operator (or CI) runs.

## Context: what the audit found

A seven-agent audit of the current suite (44 test files, ~374 tests, all
driven through hand-rolled fakes in `tests/harness.ts` + in-memory DB)
found the logic layer well covered but four structural blind spots:

1. **Fakes enforce no Discord semantics.** `reply`/`editReply`/`followUp`/
   `update` all funnel into the same recorder. Reply-after-reply,
   editReply-before-ack, required-getter misses, autocomplete limits,
   payload size caps — none enforced. The `i.replied` half of the router's
   error fallback is unreachable under the fakes.
2. **Zero builder↔handler contract check.** Fake getters return whatever
   the test fixture contains, keyed by whatever name the handler asks for.
   A builder/handler option or subcommand rename passes the whole suite
   and fails only in production. (Manual cross-check: no drift exists
   today; nothing keeps it that way.)
3. **Uncovered entry points and files.** 14 command/subcommand/button
   entry points have no test through `execute()`. Five src files are
   never imported by any test (`index.ts`, `deploy-commands.ts`,
   `deploy-emojis.ts`, `build-emojis.ts`, `core/render/worker.ts`). The
   module list is duplicated in three places (`index.ts`,
   `deploy-commands.ts`, `registry-load.test.ts`) — dropping a module from
   `index.ts` alone stays green while live commands lose their handler.
4. **No sequence-level journey tests.** Exactly one test chains two real
   player commands. Six time/state couplings ride on nothing (see
   Journey suite below); the worst — feeding inside an uncollected income
   window retroactively reprices the pre-feed portion — has zero coverage
   of any kind.

## Architecture: three tiers + triggers

### Tier 0 — Strict harness (rebuild `tests/harness.ts` internals)

The fakes become high-fidelity simulators. Exported API is unchanged
(`makeCtx`, `fakeCommand`, `fakeButton`, `fakeAutocomplete`), so all 44
existing test files keep working and get stricter for free. Any existing
test that violates real semantics is a real bug surfaced.

- **Reply-state machine.** Mirrors discord.js v14: `reply()` after any
  ack throws `InteractionAlreadyReplied`; `deferReply()` then `reply()`
  throws; `editReply()`/`followUp()` before any ack throws
  `InteractionNotReplied`; `deferReply()` twice throws. Buttons gain
  `deferUpdate` and a `message` property; `update()` enforces the same
  state rules. `deferReply` records its options so ephemeral defers are
  assertable. Errors carry the exact discord.js error names so test
  failures read like production.
- **Builder-backed option getters.** The harness resolves the command's
  real builder from the module registry by command name and reads
  `data.toJSON()`. `getString('speces')` throws "option not defined in
  builder"; a getter whose type mismatches the builder's option type
  throws; `getSubcommand()` throws when the builder defines subcommands
  and the test supplied none (matching real Discord, which always sends
  one); required getters (`getString(name, true)`) throw when the fixture
  omits the option. Adds `getChannel` and `getBoolean` (needed for
  `/settings`; currently missing entirely).
- **Payload validation.** Every recorded payload (reply, editReply,
  followUp, update, autocomplete respond) is validated against Discord
  limits via a shared zod module: content ≤ 2000 chars; ≤ 10 embeds;
  embed title 256 / description 4096 / ≤ 25 fields / field name 256 /
  value 1024 / footer 2048 / 6000-char embed total; ≤ 5 action rows × 5
  buttons; customId ≤ 100 chars; autocomplete ≤ 25 choices, choice names
  1–100 chars, respond-at-most-once.
- **Opt-in synthetic emoji map.** `makeCtx` (or a harness helper) can
  install a fake app-emoji map, exercising the custom-tag branches that
  are structurally untestable today: `foodEmoji`'s custom arm,
  `rarityEmoji` non-empty tags, and the `setEmoji('')` throw hazard.

### Tier 1 — Coverage fill (new tests on the strict harness)

- **Uncovered entry points (audit's UNCOVERED list):** `/settings
  channel` (both branches; first test of the settings module),
  `/incubate` execute, `/hatch` execute (not-yours / not-ready /
  pre-hatch reply), `/rescue` execute, `/upgrade` execute **and its
  entirely untested `upgradeLot` service**, `/decorate` execute, `/park
  rename`, `/dino unassign`, `/shop food`, `/expedition status` (both
  branches), `/trade cancel`, `/admin fast-forward` + the give
  food-item/food-qty pairing validation, and the `park:collect` button
  (the only unclicked button handler). Near-miss error branches ride
  along: `/build` error replies, `mythic:confirm` / `hatch:crack` /
  `sell:confirm` error replies, `/sell` not-sellable preview, care
  feed not-your-dino branch, trade autocomplete `decline` sub and
  counterparty want-food listing.
- **Router gaps:** followUp fallback after a handler defers then throws;
  unknown command no-op (and that presence rows still write); first-ever
  user (no users row) path; unmatched button customId; autocomplete
  double-fault swallow; non-command/non-button interaction early return.
- **Journey suite (`tests/journeys.test.ts`)** — command-level sequences
  pinning the six risky couplings:
  1. Feed-inside-collect-window: collect → time → `/feed` → time →
     `park:collect`; assert payout matches piecewise expectation (the
     audit's highest-risk untested behavior).
  2. Hunger-100 knee through commands: `/feed` premium (fillTo 150) →
     time across the crossing → collect.
  3. Escape loop: starve → interaction settles escape → `/rescue` →
     feeding and income resume.
  4. Trade escrow expiry at command layer: `/trade offer` → +25 h →
     `/trade accept` fails because expiry settles first, dino unlocks.
  5. Scheduler notifications end-to-end: `/incubate` (and expedition
     start) → `scheduler.tick` past due → `eggHatchHandler` /
     `expeditionReturnHandler` deliver correct content; skip-guards
     (already hatched / already claimed) hold.
  6. Rating gates earned through play: build/feed until
     `ratingHighWater` unlocks lot slots / sites / mythic, no direct DB
     pokes.
  Plus the full spine: `/incubate` → time → `/hatch` → `hatch:crack` →
  `/dino assign` → time → collect.
- **Wiring and deploy surface:**
  - `src/core/module-list.ts` — single module array; `src/index.ts`,
    `src/deploy-commands.ts`, and tests import it. Kills the three-copy
    drift. Only production-code refactor in scope.
  - Contract test: serialize all 19 builders via `toJSON()` in CI (a
    builder that throws on serialization currently only fails at deploy
    time).
  - `deploy-emojis` state machine (hash skip / changed
    delete-recreate / manifest-in-finally / corrupt manifest error) with
    a fake REST client.
  - Real render-worker protocol test: spawn the actual
    `core/render/worker.ts` in vitest, round-trip a snapshot, assert the
    stale-id filter and error recycling.
  - Notify handlers and `clientSender` guard branches with fake senders.
  - Scheduler edges: restart retries previously failed timer (fresh
    Scheduler over same DB); handler registered after first tick;
    no double-fire across overlapping ticks.
  - Parity: `FOODS[].emoji` names ↔ deployable emoji names (same style
    as the existing SVG↔fallback parity test).

### Tier 2 — Live REST sweep (`npm run test:live`)

Real Discord validation without gateway login — REST only, so it never
violates the one-gateway-instance-per-token rule and is safe while the
bot runs.

Flow (`scripts/test-live.ts`):
1. Build the registry, `PUT` all command JSON to the dev guild — Discord
   itself validates every builder.
2. Seed an in-memory DB with representative state (dinos of each diet,
   eggs in each status, active/expired trades, an escaped dino, shop
   stock), execute each command/button through the strict harness,
   collect the payloads.
3. `POST` each captured payload — embeds, image attachments, button
   rows — to the test channel, prefixed with a header line naming the
   command and case (e.g. `/hatch — pre-hatch embed`). Discord validates
   the real payloads; cosmetic review is one channel scroll. Buttons in
   these posts are inert (no gateway) and labeled as a gallery.
4. Verify remote application emojis against `assets/emojis/manifest.json`
   and `FOODS` names.
5. Print a summary table; exit nonzero if Discord rejected anything.

Env: `DISCORD_TOKEN`, `DEV_GUILD_ID`, and new `TEST_CHANNEL_ID`
(documented in `.env.example`). Per-payload error reporting, not
fail-fast; discord.js REST handles 429 backoff; missing env exits with a
message naming the variable.

### Triggers

- `npm test` — Tiers 0–1, offline, deterministic.
- `npm run test:live` — Tier 2, needs env.
- `/verify` repo command (`.claude/commands/verify.md`): typecheck →
  `npm test` → `npm run test:live` → pass/fail summary ending with
  "check the test channel for cosmetics". Run after every change.
- GitHub Actions CI (`.github/workflows/ci.yml`): on push/PR — checkout,
  Node (latest LTS), `npm ci`, typecheck, `npm test`. Actions pinned to
  current latest stable releases. Live tier stays local (token secret
  could be added later).

## Components

| File | Role |
| --- | --- |
| `tests/lib/discord-limits.ts` | zod validators for Discord payload limits; shared by harness and live tier |
| `tests/harness.ts` | rebuilt internals: state machine, builder-backed getters, payload validation, emoji-map opt-in; same exported API |
| `src/core/module-list.ts` | the single module array |
| `tests/settings.test.ts` | first coverage of the settings module |
| `tests/journeys.test.ts` | sequence suite (six couplings + spine) |
| `tests/contract.test.ts` | builder serialization + option-name parity |
| `tests/deploy-emojis.test.ts` | manifest state machine with fake REST |
| `tests/render-worker.test.ts` | real worker spawn, protocol round-trip |
| `tests/notify-handlers.test.ts` | scheduler handlers + clientSender guards |
| `scripts/test-live.ts` | Tier 2 runner |
| `.claude/commands/verify.md` | `/verify` command |
| `.github/workflows/ci.yml` | offline CI |

Existing per-module test files gain the uncovered entry-point and error-
branch tests; `tests/harness.test.ts` gains meta-tests asserting each
lifecycle violation throws and each limit breach is rejected.

## Error handling

- Harness violations throw with discord.js error names
  (`InteractionAlreadyReplied`, `InteractionNotReplied`, required-option
  messages) so failures read identically to production stack traces.
- Live tier reports every Discord rejection with the offending
  command/case name and Discord's error body; continues the sweep;
  nonzero exit at the end.
- Test-channel posts are throttled by discord.js's built-in REST
  rate-limit handling; the sweep chunks gallery posts rather than
  firing hundreds of parallel requests.

## Documentation (same change, not follow-up)

- `README.md`: new scripts, `/verify`, CI badge/description.
- Repo `CLAUDE.md`: strict-harness rules (what now throws), single
  module list — module-registration checklist drops from 5 sites to 4.
- `.env.example`: `TEST_CHANNEL_ID`.

## Out of scope

- Browser-driven E2E of Discord's UI (user-account automation; ToS
  gray zone — explicitly declined).
- Pixel-level assertions on rendered park images / egg art beyond the
  existing guards — cosmetics remain human-reviewed via the Tier 2
  gallery channel.
- CI execution of the live tier (needs a token secret; can be added
  later without design changes).
- Battles module (still deferred product work).
