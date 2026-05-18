-- Dino-World: zoo module, migration V4.
--
-- Adds a personality trait rolled once at hatch and pinned for the dino's
-- lifetime. NULL means "plain" (~30% of hatches); a non-null value is one
-- of the enum ids defined in DinoTrait.java. Stored as TEXT rather than an
-- INTEGER discriminator so the column survives renames/additions to the
-- catalog without a follow-up migration.

ALTER TABLE dino_instance ADD COLUMN trait TEXT;

CREATE INDEX idx_dino_instance_trait ON dino_instance(trait);
