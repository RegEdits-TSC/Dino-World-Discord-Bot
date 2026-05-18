-- Dino-World: zoo module, migration V5.
--
-- Marks a hatched dino as a rare "shiny" variant. Rolled at hatch with
-- a 1/512 probability (see ShinyRoller); permanent for the dino's
-- lifetime. Surfaces as a ✨ prefix in /dino inspect and the hatch
-- result embed, and grants a +50% income multiplier in
-- IncomeTickService.
--
-- Stored as INTEGER NOT NULL DEFAULT 0 because SQLite has no native
-- boolean type — 0 = normal, 1 = shiny. Partial index keeps the lookup
-- cheap without bloating the table since shinies are rare.

ALTER TABLE dino_instance ADD COLUMN is_shiny INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_dino_instance_shiny
    ON dino_instance(is_shiny) WHERE is_shiny = 1;
