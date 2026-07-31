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

describe('0002 battle columns via the real drizzle migrator (production path)', () => {
  it('applies 0002 to a populated 0001 database and enforces the new constraints', () => {
    // Reach the 0001 schema via a scratch folder holding only migrations 0000-0001,
    // seed a parent user + child dino (FK on, as production createDb runs), then let
    // the real migrateDb apply 0002 exactly as the bot does at startup.
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig2-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[01].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 1);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');                   // production createDb sets this
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });           // apply 0000 + 0001 only

    sqlite.prepare(`INSERT INTO users (discord_id, cash, park_name, rating_high_water, shards, last_collect_at_ms, created_at_ms)
                    VALUES ('u1', 1234, 'Jurassic Pocket', 210, 7, 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms) VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();

      // The users rebuild (table-recreate, per the energy_nonneg CHECK) must preserve
      // pre-existing data, not just apply new-column defaults. Same recreate shape as
      // 0001 (proven safe by the '0001 ... production path' test above); this asserts
      // the copy-through of columns unrelated to 0002 as well.
      const preserved = sqlite.prepare(
        `SELECT cash, park_name, rating_high_water, shards FROM users WHERE discord_id='u1'`
      ).get() as { cash: number; park_name: string; rating_high_water: number; shards: number };
      expect(preserved.cash).toBe(1234);
      expect(preserved.park_name).toBe('Jurassic Pocket');
      expect(preserved.rating_high_water).toBe(210);
      expect(preserved.shards).toBe(7);

      // Existing user rows pick up the new NOT NULL defaults.
      const u = sqlite.prepare(`SELECT energy, energy_updated_at_ms FROM users WHERE discord_id='u1'`).get() as
        { energy: number; energy_updated_at_ms: number };
      expect(u.energy).toBe(10);
      expect(u.energy_updated_at_ms).toBe(0);
      expect(() => sqlite.prepare(`UPDATE users SET energy = -1 WHERE discord_id='u1'`).run()).toThrow(); // energy_nonneg

      // The child dino row must still resolve against the rebuilt (renamed) users table.
      const joined = sqlite.prepare(
        `SELECT d.id FROM dinos d JOIN users u ON u.discord_id = d.user_id WHERE u.discord_id = 'u1'`
      ).all();
      expect(joined).toHaveLength(1);

      // Existing dino rows pick up battle_xp default 0.
      const d = sqlite.prepare(`SELECT battle_xp FROM dinos WHERE user_id='u1'`).get() as { battle_xp: number };
      expect(d.battle_xp).toBe(0);

      // battle_progress: insert a child row post-migration, then check PK + stars CHECK + FK.
      sqlite.prepare(`INSERT INTO battle_progress (user_id, stage_id, stars, first_cleared_at_ms, attempts)
                      VALUES ('u1', 'coastal_dig_1', 2, NULL, 1)`).run();
      expect(() => sqlite.prepare(`INSERT INTO battle_progress (user_id, stage_id) VALUES ('u1', 'coastal_dig_1')`).run())
        .toThrow();                                       // PK (user_id, stage_id)
      expect(() => sqlite.prepare(`UPDATE battle_progress SET stars = 4`).run()).toThrow();   // stars_range
      expect(() => sqlite.prepare(`INSERT INTO battle_progress (user_id, stage_id) VALUES ('ghost', 'coastal_dig_1')`).run())
        .toThrow();                                       // FK -> users.discord_id

      // eggs.source widening is TypeScript-only: 'battle' must insert with no DDL change.
      sqlite.prepare(`INSERT INTO eggs (user_id, rarity, source, obtained_at_ms) VALUES ('u1', 'rare', 'battle', 0)`).run();

      // migrateDb must leave FK enforcement ON — runtime integrity depends on it.
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0005 locked-column drop via the real drizzle migrator (production path)', () => {
  it('preserves populated dino and egg rows across the locked-column drop', () => {
    // Reach the 0004 schema (the last one that still has dinos.locked / eggs.locked) via a
    // scratch folder, seed rows through RAW pre-0005 SQL — both of them locked, so the drop is
    // exercised against a column that actually carries data — then let the real migrateDb apply
    // 0005 exactly as the bot does at startup. Seeding AFTER the migration would prove nothing:
    // the risk this test exists for is losing (or blanking) rows in the column rewrite.
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig5-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-4].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 4);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');                   // production createDb sets this
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });           // apply 0000-0004 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    const lotId = Number(sqlite.prepare(
      `INSERT INTO lots (user_id, type, kind, name) VALUES ('u1', 'paddock', 'herbivore_paddock', 'Fern Hollow')`
    ).run().lastInsertRowid);
    sqlite.prepare(`INSERT INTO dinos (user_id, lot_id, species_id, nickname, hunger, last_fed_at_ms, hatched_at_ms,
                                       via_trade, locked, battle_xp, traits)
                    VALUES ('u1', ?, 'triceratops', 'Trixie', 87, 5, 5, 1, 1, 250, '["hardy"]')`).run(lotId);
    sqlite.prepare(`INSERT INTO eggs (user_id, rarity, species_id, source, via_trade, locked, traits,
                                      obtained_at_ms, incubation_started_at_ms, hatches_at_ms)
                    VALUES ('u1', 'epic', 'stegosaurus', 'trade', 1, 1, '["swift"]', 7, 9, 11)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();

      // The columns are gone...
      const cols = (t: string) => (sqlite.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as Array<{ name: string }>)
        .map((r) => r.name);
      expect(cols('dinos')).not.toContain('locked');
      expect(cols('eggs')).not.toContain('locked');

      // ...and every surviving column kept its value. A rewrite that dropped rows, or reset
      // them to column defaults, fails here — not just on the row count.
      const dinos = sqlite.prepare(`SELECT * FROM dinos`).all() as Array<Record<string, unknown>>;
      expect(dinos).toHaveLength(1);
      expect(dinos[0]).toMatchObject({
        user_id: 'u1', lot_id: lotId, species_id: 'triceratops', nickname: 'Trixie', hunger: 87,
        last_fed_at_ms: 5, escaped_at_ms: null, via_trade: 1, battle_xp: 250, traits: '["hardy"]', hatched_at_ms: 5,
      });
      const eggs = sqlite.prepare(`SELECT * FROM eggs`).all() as Array<Record<string, unknown>>;
      expect(eggs).toHaveLength(1);
      expect(eggs[0]).toMatchObject({
        user_id: 'u1', rarity: 'epic', species_id: 'stegosaurus', source: 'trade', via_trade: 1,
        traits: '["swift"]', obtained_at_ms: 7, incubation_started_at_ms: 9, hatches_at_ms: 11,
      });

      // The dino's lot FK must still resolve — nothing was renamed out from under it.
      expect(sqlite.prepare(
        `SELECT d.id FROM dinos d JOIN lots l ON l.id = d.lot_id WHERE l.user_id = 'u1'`
      ).all()).toHaveLength(1);

      // migrateDb must leave FK enforcement ON — runtime integrity depends on it.
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
