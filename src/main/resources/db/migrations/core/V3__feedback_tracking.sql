-- Dino-World: core module, migration V3.
--
-- Per-user state for /feedback:
--
--   feedback_log       — last submission timestamp per user, used to enforce
--                        the rolling 24h cooldown. One row per user; updated
--                        in-place on each successful send.
--
--   feedback_blacklist — manually-managed deny list, populated via
--                        /debug feedback block <user_id>. Presence in this
--                        table short-circuits /feedback before any DM is
--                        attempted, regardless of the cooldown.
--
-- Both tables key on Discord user IDs (snowflake → INTEGER; SQLite stores
-- INTEGER as up to 8 bytes, plenty for snowflakes).
CREATE TABLE feedback_log (
    user_id      INTEGER PRIMARY KEY,
    last_sent_at TEXT    NOT NULL
);

CREATE TABLE feedback_blacklist (
    user_id    INTEGER PRIMARY KEY,
    blocked_at TEXT    NOT NULL,
    reason     TEXT
);
