-- Dino-World: zoo module, migration V2.
--
-- Adds notified_at to egg_instance so the zoo.egg_ready_notify TickScheduler
-- job can DM each player exactly once when an egg becomes ready, even if
-- the bot was offline when ready_at passed. NULL means "not yet notified".
ALTER TABLE egg_instance ADD COLUMN notified_at INTEGER;

CREATE INDEX idx_egg_ready_notify ON egg_instance (notified_at, hatched_at, ready_at);
