# Daily quests and lifetime stats

Fires on: `src/core/stats.ts` (the `track` substrate), the quest half of
`src/modules/daily/` (`index.ts`, `service.ts`, `hooks.ts`, `embeds.ts`), the content
tables behind them (`src/data/quests.ts`, `src/data/achievements.ts`), their suites
(`tests/daily-*.test.ts`, `tests/stats.test.ts`, `tests/stats-sites.test.ts`) — and every
`src/modules/*/service.ts`, because that is where the `track` call sites live.

## Headlines

- `track(ctx, userId, stat, delta)` is the one lifetime-counter substrate, and every call site sits INSIDE the action's own transaction: a rolled-back action must never count. §track-inside-the-measured-write
- Quest progress is DERIVED, never stored — a `daily_quests` row freezes `baseline` and `target`, and `questProgress` computes `clamp(current - baseline, 0, target)` at read time. §quest-progress-derived
- `pickBoard` enforces three hard rules on the day's 3 quests: no two slots share a stat, at most one churn-stat quest, at most one food-paying quest. §pickboard-three-hard-rules
- The board is a deterministic `hashSeed`/`mulberry32` draw over `` `${userId}:${dayKey}` ``, never `ctx.rng()`, so concurrent first-interactions land on the same board and the unique `(userId, dayKey, slot)` constraint backstops the race. §quest-roll-deterministic
- Streak chests pay on PERSONAL BESTS only, against the monotonic `questStreakBest`, so breaking and re-climbing a streak deliberately re-pays nothing. §streak-chests-personal-best-only
- The quest-complete hint is one combined `followUp` from `postDispatch` with exactly four exemptions — the last of them because `followUp` on an unreplied interaction throws. §quest-hint-exemptions

## track-inside-the-measured-write

One substrate: `track(ctx, userId, stat, delta)` (`src/core/stats.ts`)
upserts a lifetime `user_stats` counter. Every call site sits inside the action's own
existing transaction (or, where there isn't one already, is atomic on its own) — a
rolled-back action must never count, so never call `track` outside the write it's
measuring.

The same rule governs `recordSpeciesSeen`, the other counter this repo increments inside
the transaction that mints the thing it counts: `§record-species-seen-write-sites` in
`docs/conventions/escrow-and-item-moves.md`.

## quest-progress-derived

Quest progress is **derived, never stored**: a `daily_quests` row freezes
`baseline` (the counter's value at roll time) and `target`; `questProgress`
(`src/modules/daily/service.ts`) computes `clamp(current - baseline, 0, target)` at
read time. Nothing
sweeps, nothing drifts, and a missing `user_stats` row reads 0 at both baseline and
progress. The principle, and the other features built the same way, are at
`§escrow-derived-never-stored` in `docs/conventions/escrow-and-item-moves.md`.

## pickboard-three-hard-rules

The roller (`pickBoard`) enforces three hard rules when it draws the day's
3 quests from `QUESTS` (`src/data/quests.ts`): (a) no two slots share a stat; (b) at
most one churn-stat quest (`CHURN_STATS`: `eggs_incubated`, `dinos_sold`) per board;
(c) at most one food-paying quest per board.

## quest-roll-deterministic

The roll itself is deterministic — the
shared `hashSeed` (`src/core/rolls.ts`) turns `` `${userId}:${dayKey}` `` into a seed for
`mulberry32` (same file), never `ctx.rng()` — so concurrent
first-interactions land on the same board and the unique `(userId, dayKey, slot)`
constraint backstops the race with `INSERT OR IGNORE`. `hashSeed` has a second caller
and changing it silently rerolls every board in flight:
`§hashseed-must-never-change` in `docs/conventions/art-resolver.md`.

## streak-chests-personal-best-only

Streak chests (`chestFor`, `src/data/quests.ts`) pay on **personal bests only**:
`claimQuests` only grants one when the post-tick streak exceeds `questStreakBest`,
which is monotonic — deliberately breaking and re-climbing a streak re-pays nothing
until the old best is exceeded, and `nextChestAt` advertises the next milestone above
`max(streak, best)` so the hub never suggests a replay is worth it.

## quest-hint-exemptions

The quest-complete
hint (`dailyRouterHooks.postDispatch`, `src/modules/daily/hooks.ts`) fires one combined
followUp after any successful dispatch, with four exemptions: autocomplete never
reaches it at all (the router's autocomplete branch returns before hooks run); the
`/daily`/`/achievements` commands and the `daily`/`ach` component prefixes are
exempted by name (`EXEMPT_COMMANDS`/`EXEMPT_PREFIXES`) so there's no hint about the
screen the user is already looking at; and an interaction that never replied (the
errored path) is skipped, since `followUp` on an unreplied interaction throws.

Two orderings around this gate are enforced elsewhere and are easy to break from here.
The season capstone is stamped BEFORE these exemption returns, so an exempt command still
records the crossing (`§stamp-season-badge-guard-and-order` in
`docs/conventions/season-track.md`), and a click the router rejects returns before
`postDispatch` runs at all, so a forged interaction never burns a one-shot stamp
(`§router-guard-placement` in `docs/conventions/router-and-registry.md`).
