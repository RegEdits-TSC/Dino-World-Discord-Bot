# Schema and migrations

Fires on: `src/core/db/` (the schema and the migrator), everything under `drizzle/`,
`drizzle.config.ts`, `scripts/backfill-species-seen.ts`, and the two suites that cover them
(`tests/db.test.ts`, `tests/migration.test.ts`).

## Headlines

- `migrateDb` brackets `migrate()` with `foreign_keys = OFF`/`ON` at the CONNECTION level, before the migration's own transaction starts — a `PRAGMA` inside the migration SQL is a no-op there, and without the outer bracket a table-recreate throws on a populated DB. §migratedb-fk-bracket-outside-transaction
- The "production path" block in `tests/migration.test.ts` does NOT show that a recreate would fail on production — a well-formed recreate passes it, bracket and all. Know the three regressions it actually catches before you trim it. §populated-migration-test-proves-less-than-it-sounds
- The only gate against an UNNECESSARY recreate — one drizzle-kit could have expressed as a plain `ALTER TABLE` — is reading the emitted SQL by eye. No test can do that job for you. §unnecessary-recreate-caught-only-by-reading-sql
- Never add a blanket `user_id` index: every composite primary key in this schema already leads with `user_id`, so an index there is write cost bought for nothing. §indexes-not-a-blanket-user-id-sweep
- `tx_log_reverses` is PARTIAL so an ordinary charge never enters it, and `tx_log.user_id` stays deliberately UNINDEXED rather than charging every economy write to serve a command an operator runs a few times a month. §tx-log-partial-index-and-unindexed-user
- `locksFor`'s two per-call filters run in SQL and are covered by `trades_status_from` and `breedings_user_claimed`; the trades index leads with `status`, not the user, because `expireStale` filters on `status` alone. §locks-read-indexes
- Leave `tx_log.reverses_id` a plain column, never a DB-level foreign key: the table is append-only, so nothing can ever dangle — the constraint would buy nothing and costs drizzle type inference. §reverses-id-not-a-foreign-key
- The season track ships TWO migrations, 0015 and 0016, both applying on the same boot and neither dropping a column. §season-two-migrations
- `npm run backfill-species-seen` is an OPERATOR step to run by hand after migration 0010, never migration SQL — a failure inside a migration blocks boot — and once it has run nothing distinguishes a seeded table from an accumulated one. §species-seen-backfill-is-an-operator-step
- A migration that adds a table incurs a debt in `adminReset`: it must delete from every table the feature reads, or the feature leaves state nobody can clear. §reset-covers-every-table-the-feature-reads

## migratedb-fk-bracket-outside-transaction

`migrateDb` (`src/core/db/index.ts`) brackets `migrate()` with `foreign_keys = OFF`/`ON`,
toggled OUTSIDE the migration's own transaction, at the connection level, before
`migrate()` even starts. This is load-bearing, not cleanup: drizzle wraps every migration
in a transaction, so a `PRAGMA foreign_keys` statement embedded in the migration SQL itself
is a no-op there — but a pragma set before that transaction begins stays in effect for its
whole duration, which is why `migrateDb`'s outer bracket (and not a per-migration one) is
what lets a table-recreate migration (SQLite column drop) run `DROP TABLE` against child
rows on a **populated** DB (`createDb` sets FK on) without throwing.

## populated-migration-test-proves-less-than-it-sounds

What the "seed a parent **and** a child row, then run the real `migrateDb`" recipe (the
"production path" block in `tests/migration.test.ts`) actually proves is narrower than it
sounds: a well-formed recreate PASSES that test, bracket and all — the recipe does not
demonstrate that a recreate "would fail on production", because it demonstrably doesn't.
What it catches is (1) a regression that removes or weakens the bracket, (2) a lesser
raw-SQL replay or an empty-DB substitute standing in for the real migrator, either of which
gives a false green on exactly that regression, and (3) a recreate that mishandles data —
drops or resets a column — even though FK enforcement passes clean.

## unnecessary-recreate-caught-only-by-reading-sql

The actual gate against an UNNECESSARY recreate, one drizzle-kit could have expressed as a
plain `ALTER TABLE` instead, is reading the emitted SQL by eye; the populated-row test
cannot do that job for you.

## indexes-not-a-blanket-user-id-sweep

Migration 0018's read indexes are not a blanket `user_id` sweep and must not become one.
Every composite primary key in this schema already leads with `user_id`, so those tables
need nothing — the only two that gained an index (`season_progress`, `user_guilds`) did so
because their hot read filters the key's *non-leftmost* column, which the key cannot serve.

`tx_log` used to have no filtered read anywhere in `src/` at all; operator refunds
(`/admin ledger` and `/admin reverse`) gave it its first, and the rule survives with one
carve-out. The reads are: by `id`, which the primary key already serves; by `reverses_id`,
the double-reversal guard inside `EconomyService.reverse`; and two per-player reads,
`/admin ledger`'s scan by `user_id` and `adminReverse`'s reset-boundary lookup, which
filters `(user_id, reason)` — worth knowing before revisiting this decision, since the
composite is the shape an index would have to serve.

## tx-log-partial-index-and-unindexed-user

`tx_log_reverses` (migration 0019) is **PARTIAL** — `where reverses_id is not null`, the
same shape as `timers_due` — so an ordinary charge, on what will become the largest table
in the schema, never enters the index and pays essentially nothing for it, while the
double-reversal guard stays logarithmic.

`user_id` stays deliberately UNINDEXED and should: it would charge write cost on every
economy transaction in the game to serve a command an operator runs a few times a month.
See the per-index comments in `src/core/db/schema.ts` for which read each one serves.

## locks-read-indexes

`locksFor` (`src/core/locks.ts`) runs two table filters per call, and both filter in SQL.
Both were unindexed until migration 0018, which added `trades_status_from` and
`breedings_user_claimed` to cover exactly those two reads. The trades index leads with
`status` rather than the user because `expireStale` filters on `status` alone and has no
user scope to narrow it.

These two reads run on every call that needs a lock, because escrow is derived rather than
stored: `§escrow-derived-never-stored` in `docs/conventions/escrow-and-item-moves.md`
states that principle in full, and it is what makes the read cost worth indexing rather
than caching away.

## reverses-id-not-a-foreign-key

`tx_log.reverses_id` is deliberately NOT a DB-level foreign key. The table is append-only —
nothing in `src/` UPDATEs or DELETEs a ledger row, and a reversal is a compensating row
rather than an edit (`§reversal-is-a-compensating-row` in
`docs/conventions/economy-core.md`) — so nothing can ever dangle: the constraint would buy
nothing and costs drizzle type inference.

## season-two-migrations

The season track ships two migrations, not one: **0015** (`season_progress` +
`season_claims`, both tables, no column drop) and **0016**
(`season_progress.hinted_rung`, added in a later task for one-shot hint suppression). Both
apply on the same boot. `hinted_rung`'s default of `-1` is what that second migration is
for, and the reason it is a high-water mark rather than an existence check belongs with the
feature: `§hinted-rung-high-water-stamp-after-send` in
`docs/conventions/season-track.md`.

## species-seen-backfill-is-an-operator-step

`species_seen` has a fourth writer besides the three in-transaction credit sites, and it
runs exactly once, by hand: `npm run backfill-species-seen`
(`scripts/backfill-species-seen.ts`), an operator step to be run AFTER migration 0010,
never as migration SQL — a failure there would block boot. It credits every player for
every species still in their inventory via `INSERT OR IGNORE` + `MIN(hatched_at_ms)`, so a
real `recordSpeciesSeen` credit always wins and re-running it is safe.

Worth knowing because **once it has run there is no trace that the table was seeded rather
than accumulated**: `species_seen` looks identical either way, and a species a player sold
or traded away before the backfill reads as never-seen — `tx_log` has no species column, so
that history is genuinely gone, which is the accepted cost of backfilling from live
inventory instead of shipping every dex empty. The three real write sites are
`§record-species-seen-write-sites` in `docs/conventions/escrow-and-item-moves.md`.

## reset-covers-every-table-the-feature-reads

A migration that adds a table incurs a debt in `adminReset`, which must delete from every
table the feature reads. The general rule and its later instances are
`§admin-covers-daily-tables` in `docs/conventions/admin-service.md`.

The escrow instance is the one that taught it. `adminReset` must delete from every table
`locksFor` reads — `trades` and now `breedings` — not only the tables holding the player's
own items. The parents are deleted moments earlier, so a surviving pending breeding holds a
Gene Lab slot busy forever and leaves a claimable pairing whose parents no longer exist.
