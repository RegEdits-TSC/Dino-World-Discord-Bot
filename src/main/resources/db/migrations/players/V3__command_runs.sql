-- Dino-World: players module, migration V3.
--
-- command_runs: one row per (user, command, subcommand) the player
-- has ever invoked. Backs the missions module's ordered-tutorial
-- flow — when a mission's command:<name> trigger is satisfied while
-- an earlier mission in the same set is still pending, the run is
-- recorded here so the mission can fire later (on the next awarder
-- pass) without forcing the player to re-run the same command.
--
-- subcommand is stored as '' (not NULL) for "no subcommand". SQLite
-- treats each NULL as distinct in composite primary keys, which
-- would let INSERT OR IGNORE silently duplicate rows; '' makes the
-- PK + dedup work like a normal composite key.
--
-- first_run_at is informational; only presence/absence matters for
-- mission satisfaction.

CREATE TABLE command_runs
(
    user_id      INTEGER NOT NULL REFERENCES player (user_id),
    command      TEXT    NOT NULL,
    subcommand   TEXT    NOT NULL DEFAULT '',
    first_run_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, command, subcommand)
);

CREATE INDEX idx_command_runs_user_cmd ON command_runs (user_id, command);
