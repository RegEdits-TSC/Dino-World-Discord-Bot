import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/core/config.js';
import { createDb, migrateDb, type Db } from '../src/core/db/index.js';

/**
 * One-shot backfill: credit every player for every species currently in their
 * inventory. Run once, as an operator step AFTER migration 0010 — never as
 * migration SQL, so a failure here can never block boot. INSERT OR IGNORE plus
 * MIN(hatched_at_ms) means a real credit already written by recordSpeciesSeen
 * always wins (safe to re-run) and the EARLIEST hatch is credited, never the
 * run time or whichever row the scan happened to see first.
 *
 * History is not recoverable: tx_log carries no species column, so a species a
 * player sold or traded away before this ran reads as never-seen. That is the
 * accepted cost of backfilling from live inventory — the only source that
 * still exists — over shipping every dex empty on day one.
 */
export function backfillSpeciesSeen(db: Db): number {
  const before = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM species_seen`).c;
  db.run(sql`
    INSERT OR IGNORE INTO species_seen (user_id, species_id, first_at_ms)
    SELECT user_id, species_id, MIN(hatched_at_ms) FROM dinos GROUP BY user_id, species_id
  `);
  const after = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM species_seen`).c;
  return after - before;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const db = createDb(config.databasePath);
  migrateDb(db);
  const n = backfillSpeciesSeen(db);
  console.log(`species_seen: ${n} rows credited`);
}
