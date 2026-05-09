-- Dino-World: staff module, migration V1.
--
-- One table that drives the whole staff system: every hired staff member
-- is one row. Roles, wages, hire costs, and effects live in the YAML
-- catalog (data/staff/roles.yaml) and are looked up by role_id at runtime;
-- changing balance numbers therefore needs no migration.
--
--   staff_member    A hired NPC. enclosure_id is set for "enclosure" scope
--                   roles (zookeeper, vet) and NULL for "global" scope
--                   roles (scientist, marketer). last_paid_at lets the
--                   wages tick render "due in N hours" without recomputing
--                   from scratch — currently informational only, the tick
--                   itself uses tick_state.
--
-- Convention matches zoo/V1: INTEGER for snowflake user ids, INTEGER
-- (epoch millis) for timestamps.

CREATE TABLE staff_member
(
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES player (user_id),
    role_id       TEXT    NOT NULL,
    enclosure_id  INTEGER REFERENCES enclosure (id) ON DELETE SET NULL,
    custom_name   TEXT,
    hired_at      INTEGER NOT NULL,
    last_paid_at  INTEGER
);

CREATE INDEX idx_staff_owner ON staff_member (owner_user_id);
CREATE INDEX idx_staff_enclosure ON staff_member (enclosure_id);
CREATE INDEX idx_staff_role ON staff_member (role_id);
