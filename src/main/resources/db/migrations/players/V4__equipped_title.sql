-- Dino-World: players module, migration V4.
--
-- Adds equipped_title: a cosmetic label the player has selected from
-- their unlocked achievement titles. Surfaces on /profile (Title field)
-- and on the /rank rank card (under the username). NULL means "no
-- title equipped" — the column is independent of which titles are
-- actually unlocked, so AchievementsCommand.equip enforces the
-- "must be unlocked" guard at write time.

ALTER TABLE player ADD COLUMN equipped_title TEXT NULL;
