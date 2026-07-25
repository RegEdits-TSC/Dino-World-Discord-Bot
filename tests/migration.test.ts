import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDb, schema } from '../src/core/db/index.js';

const DRIZZLE = resolve(process.cwd(), 'drizzle');
const sqlFiles = readdirSync(DRIZZLE).filter((f) => f.endsWith('.sql')).sort();

function execFile(db: InstanceType<typeof Database>, file: string): void {
  const sql = readFileSync(resolve(DRIZZLE, file), 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    if (stmt.trim()) db.exec(stmt);
  }
}

describe('0001 diet food types migration', () => {
  it('refunds generic food as cash with a ledger row and drops the column', () => {
    const db = new Database(':memory:');
    execFile(db, sqlFiles[0]);                    // 0000 baseline
    db.prepare(`INSERT INTO users (discord_id, cash, food, last_collect_at_ms, created_at_ms)
                VALUES ('u1', 500, 35, 0, 0)`).run();
    execFile(db, sqlFiles[1]);                    // 0001 under test
    const u = db.prepare(`SELECT cash FROM users WHERE discord_id = 'u1'`).get() as { cash: number };
    expect(u.cash).toBe(500 + 350);
    const cols = db.prepare(`SELECT name FROM pragma_table_info('users')`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).not.toContain('food');
    const log = db.prepare(`SELECT * FROM tx_log WHERE reason = 'food-refund:migration'`).get() as
      { cash_delta: number; food_delta: number };
    expect(log.cash_delta).toBe(350);
    expect(log.food_delta).toBe(-35);
  });
  it('converts pending trade food to cash and reshapes all trade sides', () => {
    const db = new Database(':memory:');
    execFile(db, sqlFiles[0]);
    db.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('a', 0, 0), ('b', 0, 0)`).run();
    const side = (cash: number, food: number) => JSON.stringify({ dinoIds: [], eggIds: [], cash, food });
    db.prepare(`INSERT INTO trades (from_user, to_user, offer, request, status, created_at_ms)
                VALUES ('a', 'b', ?, ?, 'pending', 0)`).run(side(100, 5), side(0, 20));
    db.prepare(`INSERT INTO trades (from_user, to_user, offer, request, status, created_at_ms)
                VALUES ('a', 'b', ?, ?, 'accepted', 0)`).run(side(0, 7), side(0, 0));
    execFile(db, sqlFiles[1]);
    const rows = db.prepare(`SELECT offer, request, status FROM trades ORDER BY id`).all() as
      Array<{ offer: string; request: string; status: string }>;
    expect(JSON.parse(rows[0].offer)).toEqual({ dinoIds: [], eggIds: [], cash: 150, foods: {} });
    expect(JSON.parse(rows[0].request)).toEqual({ dinoIds: [], eggIds: [], cash: 200, foods: {} });
    expect(JSON.parse(rows[1].offer)).toEqual({ dinoIds: [], eggIds: [], cash: 0, foods: {} });  // resolved: no cash bump
  });
  it('creates food_inventory with a non-negative qty check', () => {
    const db = new Database(':memory:');
    execFile(db, sqlFiles[0]); execFile(db, sqlFiles[1]);
    db.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    db.prepare(`INSERT INTO food_inventory (user_id, food_id, qty) VALUES ('u1', 'ferns', 5)`).run();
    expect(() => db.prepare(`UPDATE food_inventory SET qty = -1`).run()).toThrow();
    expect(() => db.prepare(`INSERT INTO food_inventory (user_id, food_id, qty) VALUES ('u1', 'ferns', 1)`).run())
      .toThrow();                                  // PK (user_id, food_id)
  });
});

// The block above replays the raw SQL statement-by-statement (each PRAGMA takes
// effect, FK enforcement defaults off) — it verifies the SQL logic but NOT the
// path the bot actually runs. drizzle's migrator wraps the whole migration in a
// transaction, where `PRAGMA foreign_keys=OFF` is a no-op, so a populated DB
// with FK enforcement on fails on `DROP TABLE users`. This exercises that path.
describe('0001 via the real drizzle migrator (production path)', () => {
  it('applies 0001 to a populated 0000 database without a foreign-key failure', () => {
    // Reach the 0000 schema through a scratch folder holding only that migration,
    // seed a user + a child dino (the FK that blocks the table drop), then run the
    // real migrateDb so drizzle applies 0001 exactly as the bot does at startup.
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    const zero = readdirSync(DRIZZLE).filter((f) => f.startsWith('0000') && f.endsWith('.sql'))[0];
    cpSync(resolve(DRIZZLE, zero), resolve(scratch, zero));
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx === 0);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');                     // production createDb sets this
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });             // apply 0000 only

    sqlite.prepare(`INSERT INTO users (discord_id, food, cash, last_collect_at_ms, created_at_ms) VALUES ('u1', 30, 500, 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms) VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();            // RED before the fix: FOREIGN KEY constraint failed on DROP TABLE users
      const cols = (sqlite.prepare(`SELECT name FROM pragma_table_info('users')`).all() as Array<{ name: string }>).map((r) => r.name);
      expect(cols).not.toContain('food');
      expect(sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='food_inventory'`).get()).toBeTruthy();
      expect((sqlite.prepare(`SELECT cash FROM users WHERE discord_id='u1'`).get() as { cash: number }).cash).toBe(500 + 300);
      expect((sqlite.prepare(`SELECT count(*) n FROM tx_log WHERE reason='food-refund:migration'`).get() as { n: number }).n).toBe(1);
      // migrateDb must leave FK enforcement ON — runtime integrity depends on it.
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
