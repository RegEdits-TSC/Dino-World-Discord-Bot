-- Dino-World: players module, migration V2.
--
-- mission_progress: one row per (user, mission) the player has
-- completed. Tracks the on-board tutorial and (later) seasonal mission
-- sets — keyed by the YAML mission id so adding a new set means
-- shipping a YAML file, no schema change.
--
-- Auto-award model: rows are inserted when MissionAwarder detects the
-- mission's trigger condition is newly satisfied for this user. The
-- INSERT itself is the "you got the reward" signal — the awarder pairs
-- it with a coin/XP grant and an ephemeral follow-up so the player sees
-- the milestone in the same flow.
--
-- (user_id, mission_id) is the natural primary key — there's exactly
-- one completion per pair. completed_at supports "completed N missions
-- since X" reads and audit.

CREATE TABLE mission_progress
(
    user_id      INTEGER NOT NULL REFERENCES player (user_id),
    mission_id   TEXT    NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, mission_id)
);

CREATE INDEX idx_mission_progress_user ON mission_progress (user_id);
