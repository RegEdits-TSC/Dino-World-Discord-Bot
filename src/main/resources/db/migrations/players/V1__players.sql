-- Dino-World: players module, migration V1.
--
-- The `players` module owns per-Discord-user game state. Every interactive
-- command that a real user runs flows through PlayerService.ensure(...),
-- which UPSERTs into the table below — so an absent row simply means the
-- user has never run a game-aware command.
--
--   player        — one row per Discord user. `coins` is the in-game
--                   currency (kept generic on purpose so the bot can be
--                   re-themed without a migration). `xp` and `level` are
--                   present for forward-compatibility; they're not used
--                   in v1, but adding columns later requires an
--                   awkward ALTER + backfill.
--                   `last_daily` is nullable: NULL means "never claimed".
--
--   coin_ledger   — append-only audit log of every coin change. Every
--                   PlayerService.addCoins(...) call writes one row inside
--                   the same transaction that updates `player.coins`,
--                   so balance bugs are reconstructable.
--                   `counterparty_user_id` is nullable now to leave room
--                   for future trading mechanics without a schema change.
--
-- All user IDs are stored as INTEGER — Discord snowflakes fit in 8 bytes,
-- matching the convention already used by feedback_log/feedback_blacklist.
-- Timestamps are epoch millis (matching tick_state from core V4).
CREATE TABLE player
(
    user_id      INTEGER PRIMARY KEY,
    display_name TEXT    NOT NULL,
    coins        INTEGER NOT NULL DEFAULT 0,
    xp           INTEGER NOT NULL DEFAULT 0,
    level        INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL,
    last_daily   INTEGER
);

CREATE TABLE coin_ledger
(
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id              INTEGER NOT NULL REFERENCES player (user_id),
    delta                INTEGER NOT NULL,
    reason               TEXT    NOT NULL,
    counterparty_user_id INTEGER,
    occurred_at          INTEGER NOT NULL
);

CREATE INDEX idx_ledger_user ON coin_ledger (user_id, occurred_at);
