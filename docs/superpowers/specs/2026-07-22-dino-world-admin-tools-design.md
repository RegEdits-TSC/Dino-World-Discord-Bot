# Dino World — Admin Tools (Plan 6) Design

**Status:** Approved 2026-07-22. Builds on Plans 1–5 (merged to `main`; 8 modules, 17 commands).

## Goal

Owner-gated admin/QA tooling: grant resources, inspect a player's raw state, reset a player, and fast-forward a player's clock for testing. One new `admin` module.

## Architecture

A new **`admin` module** (the 9th) exposing one `/admin` command with four subcommands. Every subcommand is gated to the bot owner:

```
requireOwner(ctx, i): boolean
  // if i.user.id !== ctx.config.ownerId → reply ephemeral "⛔ Owner only." ; return false
  // else return true
```

Each subcommand calls `requireOwner` first and returns if it fails. The `/admin` builder also sets `setDefaultMemberPermissions(PermissionFlagsBits.Administrator)` so the command is hidden from regular members in the Discord UI — but the code-level owner check (by `ctx.config.ownerId`, from the `OWNER_ID` env) is the authoritative gate.

All mutations follow the project's existing rules: currency moves only through `ctx.economy.apply`; multi-row changes wrapped in one `ctx.db.transaction`; `recomputeRating` after any collection/comfort change; `settleEscapes(target)` before reading escaped-dependent state. Time via `ctx.now()`.

## Commands

### `/admin give @user [cash] [food] [shards] [egg-rarity] [dino-species]`
`getOrCreateUser(target)` (can seed a brand-new player), then one transaction:
- Currency: if any of cash/food/shards is set, `ctx.economy.apply(target, { cash, food, shards }, 'admin:give', now)` (positive deltas).
- Egg: if `egg-rarity` chosen (one of the six rarities), insert an egg with that rarity, `speciesId = null` (rolled at hatch, like shop eggs), `source = 'admin'`, `obtainedAt = now`.
- Dino: if `dino-species` given, validate via `getSpecies(id)` (unknown → error), insert a dino with that species, `hunger = 100`, `lastFedAt = now`, `hatchedAt = now`, unassigned (`lotId = null`).

Then `recomputeRating(target)` (a granted dino/egg changes collection/rating). Reply ephemeral summary. At least one field must be provided (else ephemeral "nothing to give").

### `/admin inspect @user`
`settleEscapes(target)` first, then a read-only ephemeral embed dump: cash / food / shards, rating (÷100 ★) + high-water, income age (now − `lastCollectAt`), lots (id / kind / level), dinos (id / species / comfort% or 🚨 escaped / lot), eggs (rarity / incubating?), pending trades (ids), active (unclaimed) expeditions (site / returns-in). If the target has no `users` row → ephemeral "That player has no park yet."

### `/admin reset @user confirm:<text>`
Typed-confirmation guard: `confirm` must equal the target's user id, else abort with an ephemeral notice showing the required value. If the target has no park → "nothing to reset." Otherwise one transaction:
- Delete the target's rows in `dinos`, `eggs`, `lots`, `expeditions`, `timers`, and `trades` (where `fromUser` OR `toUser` = target).
- Reset the `users` row to new-player defaults: `cash = 500`, `food = 20`, `shards = 0`, `parkRating = 0`, `ratingHighWater = 0`, `parkName = 'New Park'`, `shardsWindowStart = 0`, `shardsWindowEarned = 0`, `lastCollectAt = now`. Keep `discordId`, `displayName`, `createdAt`.

Reply ephemeral confirmation.

### `/admin fast-forward @user hours:<1-720>`
Advance the target's clock by shifting their time-bearing columns **backward** by `shift = hours * 3_600_000` ms (so elapsed time appears larger), in one transaction:
- `users`: `lastCollectAt -= shift`, `shardsWindowStart -= shift`.
- `dinos` (target's): `lastFedAt -= shift`.
- `eggs` (target's): `incubationStartedAt -= shift`, `hatchesAt -= shift` (only where non-null).
- `expeditions` (target's): `departedAt -= shift`, `returnsAt -= shift`.
- `timers` where `userId = target` and `handledAt IS NULL`: `firesAt -= shift` (so scheduled hatch/expedition notifications fire on the accelerated timeline).

Then `settleEscapes(target)` so any dinos now past the escape threshold are stamped. Reply ephemeral summary (e.g. "⏩ Fast-forwarded @user by 48h; income accrues, N dino(s) escaped"). `hours` is clamped/validated to 1–720 (30 days). Not slow → no `deferReply` needed.

## Registration (5-site checklist)

`modules.json` (+`"admin": true`); `src/index.ts` and `src/deploy-commands.ts` (import + array); `tests/registry-load.test.ts` (import + array + flags + count **17 → 18**); `tests/config.test.ts` (expected-modules `toEqual` +`admin`). Result: **9 modules, 18 slash commands**.

## Schema note (no SQL migration)

`eggs.source` is a TS-only enum on a plain `TEXT` column with **no CHECK constraint**, so widening it to include `'admin'` (`['expedition','shop','trade','admin']` in `schema.ts`) is a compile-time-only change — no data migration. No other schema change.

## Error handling & testing

- **Owner gate:** a non-owner invoking any subcommand gets the ephemeral reject and no mutation. Tested (a non-owner `/admin give` does not change balances).
- **give:** unknown `dino-species` rejected; at least one field required; currency/dino/egg all land in one transaction; `recomputeRating` runs.
- **reset:** wrong `confirm` aborts with no data change; correct confirm wipes dependents and restores defaults.
- **fast-forward:** `hours` out of 1–720 rejected; after a shift, `pendingIncome` increases and a starved dino escapes on `settleEscapes`.
- **inspect:** returns an embed for an existing player; ephemeral "no park" otherwise.

Tests live in `tests/admin.test.ts` and drive the module via the `fakeCommand` harness (owner id set on the test `ctx.config`).

## Non-goals (deferred)

Runtime module enable/disable (stays `modules.json` + restart — needs registry mutability + a redeploy), global economy tuning knobs, a separate audit log (`tx_log` already records every currency move).
