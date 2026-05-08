-- Dino-World: core module, migration V1.
--
-- Intentionally a no-op. The MigrationRunner bootstraps the
-- `schema_version` tracking table itself before applying any module
-- migrations, so the core module has nothing to add at V1.
--
-- This file exists only so the migrations directory for `core` is non-empty
-- and so the (module='core', version=1) row is recorded — making it obvious
-- in `/debug system db` that the core module's migration history is intact.
SELECT 1;
