-- Dino-World: core module, migration V2.
--
-- Per-guild key/value settings store. Modules use this to persist
-- guild-specific configuration (game knobs, channel restrictions, etc.)
-- without inventing their own table per setting.
--
-- Keys are namespaced by convention (e.g. 'game.spawnRate', 'core.locale');
-- there is no enum or whitelist — modules choose their own keys. Values are
-- plain text; numeric or JSON encoding is the caller's responsibility.
CREATE TABLE guild_settings
(
    guild_id   INTEGER NOT NULL,
    key        TEXT    NOT NULL,
    value      TEXT,
    updated_at TEXT    NOT NULL,
    PRIMARY KEY (guild_id, key)
);
