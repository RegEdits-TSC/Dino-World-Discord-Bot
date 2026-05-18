-- Dino-World: achievements module, migration V1.
--
-- achievement_progress: one row per (user, achievement) the player has
-- unlocked. Mirrors mission_progress: keyed by the YAML achievement id
-- so adding new milestones means shipping YAML, no schema change.
--
-- Auto-unlock model: rows are inserted by AchievementAwarder the first
-- time a trigger's predicate evaluates true for this user. The INSERT
-- itself is the "you got the reward" signal — the awarder pairs it
-- with coin/XP grants and a DM via NotificationService.

CREATE TABLE achievement_progress
(
    user_id        INTEGER NOT NULL REFERENCES player (user_id),
    achievement_id TEXT    NOT NULL,
    unlocked_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX idx_achievement_progress_user ON achievement_progress (user_id);
