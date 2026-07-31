# Gameplay bug fixes — design

**Date:** 2026-07-30
**Branch:** `gameplay-bug-fixes` (fresh off `main` @ `6ccc087`)
**Status:** Approved

## Context

Three confirmed gameplay bugs surfaced during fact extraction for the repo
documentation pass, each verified against source and then re-verified against
an adversarial refutation pass. All three survived. Two further suspects were
investigated and cleared as intended design (see Out of scope).

All three fixes are service-layer + UI-label changes: no schema migration, no
command-builder change (so no `deploy-commands` run), no emoji or asset work.

## Bug 1 — trade escrow is not enforced by the incubate/hatch path

`createTrade` sets `eggs.locked = true` on every offered egg
(`src/modules/trading/service.ts:68`), but nothing on the hatchery side reads
that column: `incubateEgg` (`src/modules/hatchery/service.ts:25`), `hatchEgg`
(`:41`), and `/hatch`'s pre-check (`src/modules/hatchery/index.ts:53`) all omit
it. Hatching deletes the egg row, so the trade silently becomes unfulfillable
and the recipient later gets the misleading "You do not own egg #N" from
`verifySide` at accept time. The `/incubate` autocomplete makes it worse by
listing a locked egg as a top-ranked, untagged suggestion.

Not an economic exploit (`acceptTrade` re-verifies before its transaction), but
a silent reneging path that contradicts `/help`'s promise that "offered items
are locked until resolved", and the codebase's own governing principle at
`src/modules/battles/service.ts:51`: locked dinos may battle because battling
"neither consumes nor transfers". Hatching consumes.

### Fix

- `incubateEgg`: after the ownership check, reject locked eggs with
  `HatcheryError('That egg is locked in a pending trade.')`. This is the
  correctness fix — `verifySide` already refuses to escrow an incubating egg
  (`trading/service.ts:49`), so incubation is the sole entry into the bad
  state.
- `hatchEgg`: same check, same message. Unreachable through the public API —
  already true today, since `createTrade` is the only writer of
  `eggs.locked = true` and its `verifySide` refuses an incubating egg, so only
  a row left over from this very bug can reach it. It guards the invariant
  regardless, and its test must therefore lock the row with a raw
  `ctx.db.update` after `incubateEgg`.
- `/hatch` pre-check (`hatchery/index.ts`): same rejection, ephemeral, so the
  user is told before the crack-button embed rather than after clicking it.

### Stale locks are swept first

`expireStale` is lazy: nothing sweeps expired trades on a timer, and its only
four call sites all live in `src/modules/trading/index.ts`. A trade that timed
out 25 hours ago still holds its lock until the owner happens to run some
`/trade` subcommand. Today that is invisible on the hatchery path, which
ignores `locked` entirely; after this fix it would hard-block `/incubate` with
a statement that is false.

So `expireStale(ctx, i.user.id)` runs at the top of the `/incubate` and
`/hatch` executes and both egg autocomplete providers, before the eggs are
read. It is contract-legal inside a provider — the repo's autocomplete rules
name it as one of exactly two permitted writes, and unlike `settleEscapes` it
reads no user row, so it is safe for a user who has no park. It stays at the
command layer rather than inside the services, so no service-to-service
dependency is added; `hatchery/index.ts` already imports across modules
(`../park/service.js`, `../shop/shards.js`).

`/sell` has the same staleness gap for dinos. It is deliberately left alone —
out of scope here.

## Bug 2 — hatching launders the via-trade flag

`acceptTrade` marks transferred eggs `viaTrade = true`
(`trading/service.ts:80`), but `hatchEgg` inserts the hatchling dino without a
`viaTrade` value (`hatchery/service.ts:49`), so it takes the column default
`false`. The sell path only reads `dinos.viaTrade` (`shop/shards.ts:26`), so
the hatchling sells for full shards — reopening the alt-to-main shard funnel
one hatch-step removed (epic 20–35, legendary 50–80 shards per sale).

### Fix

`hatchEgg`'s dino insert carries `viaTrade: egg.viaTrade`. The `dinos.viaTrade`
column already exists; the existing sell-path reads and the `/sell`
autocomplete's "0 shards (via trade)" tag then apply to hatched dinos with no
further change.

## Bug 3 — second Visitor Center stacks income but not the cap

`facilityBonusPct` sums `incomeBonusPct` across every facility lot, but
`capHours` resolves the Visitor Center with `lots.find(...)`
(`src/modules/park/service.ts:40`) — the first row of an unordered SELECT,
i.e. the first one built. `incubatorSlots` (`hatchery/service.ts:16`) has the
same shape for the Hatchery Lab. Nothing prevents building duplicate
facilities, so a player who upgrades a later-built Visitor Center pays for a
cap extension they never receive (player-harming only, never exploitable for
gain).

### Fix (decided: one facility per kind)

- `buildLot` rejects building a facility kind the user already owns with a new
  `DuplicateFacilityError`; `/build` maps it to an ephemeral
  "You already have a {name} — upgrade it instead." A new error class is
  required because `LotLimitError`'s message is hardcoded at the call site
  (`park/index.ts:138`). Paddocks stay duplicable — multiple paddocks of one
  kind are intended capacity progression.
- `capHours` and `incubatorSlots` switch from `find` to the max level across
  matching lots. This makes pre-existing duplicate rows on the live DB resolve
  to the best facility (decided: code-only, no cleanup migration — dev-guild
  data, small blast radius). Defaults (8 h cap, 1 slot) are unchanged when the
  facility is absent, and the no-match case stays an explicit early return:
  `Math.max()` over an empty array is `-Infinity`, and neither resolver's
  array index is guarded, so a bare reduce would silently return `undefined`
  and poison `accruedIncome` with `NaN`.
- `facilityBonusPct` becomes max-per-kind for the same reason. For every legal
  state (one facility per kind) the result is identical to today's sum; it
  differs only for pre-existing duplicate rows, which stop double-paying. Left
  summing, those rows would keep stacking income while their cap resolved to
  the best row — the exact asymmetry that is bug 3.
- `/build`'s `kind` option is static choices, not autocomplete, so there is
  nothing to tag; the execute-time error is the UX. The duplicate check runs
  *before* the lot-slot cap check: with three base slots and exactly three
  facility kinds, a player who owns all three is already at the cap, and
  "You already have a Food Court — upgrade it instead" is the actionable
  message where "All lots full" is merely true.

## UI surfaces (bug 1's other half)

- `eggLabel` (`src/core/autocomplete.ts:48`) gains a locked case, checked
  first: `🥚 #N Rarity — locked in a trade` — the same wording `/sell` already
  uses for dinos. A locked egg cannot be incubating once bug 1 is fixed, so the
  state precedence is unambiguous for new rows; on a pre-existing locked+
  incubating row the locked branch masks the READY text, which is correct
  because the lock is the blocking state. Both `/incubate` and `/hatch` egg
  autocompletes use `eggLabel`, so one edit covers both.
- `valid` flags demote locked eggs below valid ones (the `/sell` pattern,
  `shop/index.ts:142-146`): incubate → `incubationStartedAt === null &&
  !locked`; hatch → ready `&& !locked`.
- `/eggs` list (`eggListPayload`) marks locked eggs with 🔒. This is a unicode
  literal, never a custom app emoji: there is no `dw_lock` in the 33-name
  fallback table, and a custom tag would additionally be illegal in the
  autocomplete labels `eggLabel` feeds. The marker goes inside the existing
  `lines` map only — the two `attach()` calls below it are pinned in call order
  by three tests.
- `/help topic:park`'s `/build` line and `topic:eggs` gain one clause each, for
  the one-facility-per-kind rule and the trade lock. Both are embed body text,
  not builder fields, so neither forces `npm run deploy-commands`; topic KEYS
  are unchanged, so `tests/help.test.ts`'s two hardcoded lists stay green.

## Error handling summary

| Site | Error | Message |
| --- | --- | --- |
| `incubateEgg`, `hatchEgg` | `HatcheryError` (existing class) | That egg is locked in a pending trade. |
| `/hatch` pre-check | direct ephemeral reply (no throw, matching its existing pre-checks) | That egg is locked in a pending trade. |
| `buildLot` | `DuplicateFacilityError` (new) | You already have a {name} — upgrade it instead. |

All surface ephemeral through existing catch blocks; the only new catch arm is
`DuplicateFacilityError` in `/build`. The misleading accept-time
"You do not own egg #N" needs no edit — with locked eggs unable to hatch away,
`verifySide` no longer encounters a vanished escrowed egg through this path.

## Testing

Regression per bug plus golden path and edges; gates are `npm test` and the
separate `npm run typecheck`.

- `tests/hatchery.test.ts`: locked egg → `incubateEgg` throws; `hatchEgg`
  throws (belt, state built by locking the row after `incubateEgg`); traded egg
  hatches → `dino.viaTrade === true`; non-traded egg → `false`; `/hatch`
  pre-check replies ephemerally; the stale-trade sweep un-blocks `/incubate`
  after 25 h.
- `tests/autocomplete-hatchery.test.ts`: lock tag shown and locked eggs ranked
  below valid ones — in a new `it` with its own seed, because the shared
  `seedEggs` is pinned by a full-array `toEqual` and a `toHaveLength(3)`.
- `tests/autocomplete-kit.test.ts`: `eggLabel(egg({ locked: true }), …)` — the
  fixture already carries `locked: false` and takes an override bag.
- Exploit end-to-end (`tests/journeys.test.ts`): trade an egg across users →
  incubate → hatch → sell yields 0 shards. Pins the laundering fix at the money
  boundary, not just the flag, and is the first end-to-end coverage of
  `moveItems`' egg write. The egg must be traded before it is incubated —
  `verifySide` refuses an incubating egg.
- `tests/park.test.ts`: duplicate facility build → `DuplicateFacilityError`;
  duplicate paddock still allowed; `/build` maps the new error to its ephemeral
  reply; `capHours` with two Visitor Center rows seeded directly in the DB
  (simulating pre-existing duplicates, bypassing the new block) → max level
  wins, plus the zero-lot default; same for `incubatorSlots` with two labs and
  for `facilityBonusPct`. That file has no lot-seed helper today — copy the
  `seedLot` shape from `tests/autocomplete-park.test.ts`.
- `/eggs` list 🔒 marker asserted (no existing assertion reads that
  description, so it is a new test, not an edit).

## Out of scope

- **Battle shards vs the sell-cap window** — intended: the 40/24 h cap is
  scoped to sales, battles are one-time-per-stage with a machine-pinned
  93-shard lifetime pool. Do not "fix".
- **Volcano Core boss at level 11** — intended, machine-gated, and the fight
  embed displays "Lv.11". Do not "fix".
- Retroactive identification of already-laundered dinos (egg row deleted, no
  provenance) and any cleanup migration — explicitly declined.
- Species-level trade provenance display, trade-side previews, or any trading
  UX beyond the surfaces above.
- `/sell`'s identical stale-lock gap for dinos, and the absence of any timer
  that expires trades — both pre-existing, both left as they are.
- `/admin inspect`'s egg rows, `featuredEgg`'s thumbnail pick, and
  `eggHatchHandler`'s "use /hatch" text: three further surfaces where lock
  state stays invisible. None is wrong today, and none is reachable for a
  correctly-locked egg once this ships.
- Removing pre-existing duplicate facility rows. There is no in-product path:
  `delete(schema.lots)` exists only inside `adminReset`, which wipes the whole
  player. Max-per-kind resolution is the entire remedy.
