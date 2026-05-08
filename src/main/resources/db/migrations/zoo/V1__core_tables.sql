-- Dino-World: zoo module, migration V1.
--
-- Three tables that, together, drive the entire game loop:
--
--   enclosure       Habitats owned by a player. Each has a tier (gates
--                   which species rarities can live there), a biome, and
--                   a capacity. Every player gets a free starter enclosure
--                   (tier 1, biome 'forest', capacity 3) the first time
--                   they touch the zoo.
--
--   dino_instance   One row per owned, hatched dinosaur. happiness drives
--                   the income multiplier; level/xp/current_hp are stored
--                   for the (deferred) /battle phase but kept here now so
--                   we don't need a schema change later. enclosure_id is
--                   nullable so a dino can be temporarily homeless if its
--                   habitat is deleted.
--
--   egg_instance    A purchased-but-unhatched egg. species_id is set
--                   immediately for determined eggs; for mystery eggs it
--                   stays NULL until /hatch rolls a species of the
--                   matching rarity. Rows are kept after hatching for
--                   audit (hatched_at + hatch_dino_id).
--
-- All user IDs are INTEGER (Discord snowflakes fit in 8 bytes), all
-- timestamps are epoch millis — matching the conventions set by
-- core/V4__tick_state.sql and players/V1.

CREATE TABLE enclosure
(
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES player (user_id),
    biome         TEXT    NOT NULL,
    capacity      INTEGER NOT NULL,
    tier          INTEGER NOT NULL,
    name          TEXT,
    created_at    INTEGER NOT NULL
);

CREATE INDEX idx_enclosure_owner ON enclosure (owner_user_id);

CREATE TABLE dino_instance
(
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL REFERENCES player (user_id),
    species_id      TEXT    NOT NULL,
    enclosure_id    INTEGER REFERENCES enclosure (id),
    custom_name     TEXT,
    level           INTEGER NOT NULL DEFAULT 1,
    xp              INTEGER NOT NULL DEFAULT 0,
    current_hp      INTEGER NOT NULL DEFAULT 100,
    happiness       INTEGER NOT NULL DEFAULT 100,
    last_fed_at     INTEGER,
    last_decay_at   INTEGER NOT NULL,
    acquired_at     INTEGER NOT NULL
);

CREATE INDEX idx_dino_owner   ON dino_instance (owner_user_id);
CREATE INDEX idx_dino_species ON dino_instance (species_id);

CREATE TABLE egg_instance
(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id  INTEGER NOT NULL REFERENCES player (user_id),
    rarity         TEXT    NOT NULL,
    species_id     TEXT,
    purchased_at   INTEGER NOT NULL,
    ready_at       INTEGER NOT NULL,
    hatched_at     INTEGER,
    hatch_dino_id  INTEGER REFERENCES dino_instance (id)
);

CREATE INDEX idx_egg_owner_pending ON egg_instance (owner_user_id, hatched_at);
