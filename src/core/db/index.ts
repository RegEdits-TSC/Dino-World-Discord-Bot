import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Database as DatabaseType } from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: DatabaseType };
export { schema };

export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export function migrateDb(db: Db): void {
  const folder = fileURLToPath(new URL('../../../drizzle', import.meta.url));
  // drizzle runs each migration inside a transaction, and `PRAGMA foreign_keys`
  // is a no-op mid-transaction — so a table-recreate migration's own OFF/ON
  // pragmas never take effect and `DROP TABLE` fails against child rows on a
  // populated DB. Toggle enforcement here, outside the transaction, then restore
  // it (the runtime relies on foreign_keys = ON, set in createDb).
  db.$client.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder: folder });
  } finally {
    db.$client.pragma('foreign_keys = ON');
  }
}
