# Leaderboards

Fires on: `src/modules/leaderboards/` — `/top`'s command surface and the `scored()` read
path behind every board — and `tests/leaderboards.test.ts`, the select-counting suite over
it.

## Headlines

- Keep `scored()` at a FIXED number of `.select()` calls per metric: one query per source TABLE, grouped in JS, never one per candidate — a per-candidate read turns a board render into an N+1 that grows with the roster. §top-scored-fixed-query-count
- Keep the select-counting `Proxy` test that pins every per-metric integer at two roster sizes and both scopes, so a rewrite that double-reads or mis-scopes a table fails a specific number rather than an equality check. §leaderboards-query-count-proxy-test
- Aggregate with `.all()` plus a JS reduce, never SQL `groupBy`/`count`/`sum`: `SUM()` over an empty row set returns NULL where `reduce(…, 0)` returns 0, poisoning a fresh account's score with `NaN` instead of a clean zero. §no-group-by-null-sum
- Compute a season row's deltas by iterating `Object.keys(STATS)`, never `Object.entries(row.baselines)` — the two agree today, but only the former survives a new `StatId` shipping after live rows exist. §season-scores-iterate-stats-keys
- Score a player with no `season_progress` row for the current index as 0 and never mint a baseline from this read path — that would be one write per candidate on every board render. §season-scores-no-baseline-mint
- Pair `legacyScores` with the LIVE `legacyPoints`, never the monotone `legacyRankBest` high-water: the board answers who is ahead right now, the park card answers what was ever earned, and the two must agree for a given user. §legacy-scores-twin-of-points
- Intersect `species_seen` against the live species roster in both score paths, and deliberately do NOT roster-filter `achievement_claims` — that asymmetry is what keeps the board and the rank in agreement, so "fixing" it makes them diverge. §score-terms-roster-intersection
- `attendanceScores` is DELIBERATELY LAXER than `attendanceOf`, so a board row can read higher than that player's own `/guests view` until something settles the row — a bounded, self-correcting lag, not a bug to close with a per-candidate settle. §attendance-scores-deliberately-laxer
- `/top`'s embed interpolates `r.displayName` un-defanged BY DESIGN — it is Discord's own display name, not text typed into our commands — so do not "fix" it as a missed defang call site. §displayname-injection-path-open

## top-scored-fixed-query-count

`/top`'s `scored()` (`src/modules/leaderboards/service.ts`) costs a FIXED number of
`.select()` queries per metric, independent of roster size: 1 for cash/rating (the
candidate scan alone), 2 for stars (+ `battle_progress`), 2 for collection
(+ `dinos`), 4 for legacy (+ `species_seen`, `achievement_claims`,
`battle_progress` via `starScores`), 3 for season (+ `season_progress` scoped to the
CURRENT `seasonIndex`, + `user_stats` for the whole board) — one more each for a
server-scoped board, which reads `user_guilds` first to resolve `memberIds` (season
server-scoped is 4; a guild with zero registered members costs exactly 1 — the
`user_guilds` read alone, since both of `seasonScores`' reads short-circuit on an
empty `memberIds` array without touching the DB).

Every one of those extra reads is
ONE query per source TABLE, grouped in JS, never one per candidate. That is the
batch-per-user rule (`§locks-batch-per-user` in
`docs/conventions/escrow-and-item-moves.md`) widened to batch-per-board.

## leaderboards-query-count-proxy-test

`tests/leaderboards.test.ts` pins every one of those integers via a `select`-counting
`Proxy`, at two roster sizes (3 and 30) and both scopes (global and server) — a
rewrite that reads any table twice, or scopes the wrong one, fails a specific pinned
number, not just an equality check.

## no-group-by-null-sum

Deliberately not `GROUP BY`: nothing in `src/` has ever used `groupBy`/`count`/`sum`,
every read here is `.all()` plus a JS reduce, and SQL `SUM()` over an empty row set
returns NULL where `.reduce(…, 0)` returns 0 — silently turning a fresh account's
score into `NaN` instead of a clean zero.

## season-scores-iterate-stats-keys

`seasonScores` is the live board-wide twin of `seasonPoints`, never the badge
high-water — the same pure-read-versus-high-water split `legacyScores` follows below,
stated in full at `§legacy-high-water-write-split` in
`docs/conventions/park-progression.md`, and drawn here for the
same reason.

It iterates `Object.keys(STATS)` when computing each row's deltas, NOT
`Object.entries(row.baselines)` — the two agree today, but only the former survives
a new `StatId` shipping after live rows already exist; the latter would silently
under-report that player against their own `/season` hub, which reads baselines the
same STATS-keyed way.

## season-scores-no-baseline-mint

A player with no `season_progress` row for the current index
scores 0 and is deliberately NOT rolled from this read path — minting a baseline
from `/top` would be one write per candidate on every board render. That is this site's
own reason; the general rule that a read path never writes is stated at
`§legacy-high-water-write-split` in `docs/conventions/park-progression.md`.

## legacy-scores-twin-of-points

`legacyScores` is the board-wide twin of
`legacyPoints` (`src/modules/park/ranks.ts`) — deliberately, not of `legacyRank`'s
`max(stored, computed)` high-water (`legacyRankBest`), the split stated at
`§legacy-high-water-write-split` in `docs/conventions/park-progression.md` — and the two
must always agree
for a given user: a board that disagrees with the rank on that player's own park card
is worse than no board, and the player sees both.

The pairing with `legacyPoints` and not `legacyRankBest` is itself the
deliberate part: the board answers "who is ahead right now" (a live standing that can
legitimately fall — see `adminReset`), while the park-card title answers "what have you
ever earned" (a monotone high-water mark that must never fall).

## score-terms-roster-intersection

Both score paths intersect `species_seen` against the LIVE species roster
(a retired species id contributes nothing to either), but neither filters
`achievement_claims` the same way — that term is a plain row count with no roster
check, which is what keeps the two in agreement rather than one silently diverging.

Roster-filtering the claims on one side only is exactly how the board and the rank come to
report different numbers for the same player.

## attendance-scores-deliberately-laxer

`attendanceScores` (`src/modules/leaderboards/service.ts`), the board-wide twin of
`attendanceOf` (`src/modules/park/attendance.ts`), is DELIBERATELY LAXER — it
matches `recomputeRating`'s `assigned` filter and checks only the stored `escapedAt`,
where `attendanceOf`'s own predicate is time-aware (`§attendance-predicate-is-time-aware`
in `docs/conventions/park-progression.md`). So a board row can read higher than that
player's own `/guests view` for a park no
command has touched since an escape. That gap is bounded and self-correcting: it
converges the next time anything settles the row, the same standing lag `/top`
already accepts elsewhere on this board. Closing it with a per-candidate settle would
turn a board render into a write path, per candidate.

## displayname-injection-path-open

One text-injection path into a public surface stays open, by design rather than
oversight: `/top`'s leaderboard embed
description (`src/modules/leaderboards/index.ts`) interpolates `r.displayName`, sourced
from `i.user.displayName` — Discord's own guild nickname / global display name, not
text a player types into any of our commands — for every OTHER player on the board, so
it is also cross-user. Closing it is out of scope here; `getOrCreateUser`
(`src/modules/park/service.ts`) is where that column is written, at every call site,
always from `i.user.displayName`.

This is the deliberate exception to §defang-user-text-on-public-surfaces in
`docs/conventions/park-surface.md`, which closes every path carrying player-typed text;
an open path is only intelligible against the closed ones, so read that rule alongside
this one rather than reading this one as permission.
