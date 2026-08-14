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
      // 0007 (the rating rescale) also runs on this path — migrateDb always applies the
      // full folder — so the preserved value comes back doubled. The assertion's purpose
      // is unchanged: it proves the 0002 users rebuild copies unrelated columns through
      // rather than resetting them to defaults.
      expect(preserved.rating_high_water).toBe(210 * 2);
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

describe('0006 daily loop via the real drizzle migrator (production path)', () => {
  it('backfills veteran user_stats from existing history and defaults the new streak columns', () => {
    // Reach the 0005 schema via a scratch folder holding migrations 0000-0005, seed a parent
    // 'vet' user AND an 'other' user (trades carries FKs to both sides) plus rows across every
    // table the backfill reads from, then let the real migrateDb apply 0006 exactly as the bot
    // does at startup — this is the only path that exercises the hand-appended INSERT ... SELECT
    // backfill statements against real data, not just the additive DDL.
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig6-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-5].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 5);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');                   // production createDb sets this
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });           // apply 0000-0005 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('vet', 0, 0), ('other', 0, 0)`).run();

    // battle_progress: two cleared stages for 'vet', one not-yet-cleared (NULL excluded).
    sqlite.prepare(`INSERT INTO battle_progress (user_id, stage_id, stars, first_cleared_at_ms, attempts)
                    VALUES ('vet', 'coastal_dig_1', 3, 100, 1)`).run();
    sqlite.prepare(`INSERT INTO battle_progress (user_id, stage_id, stars, first_cleared_at_ms, attempts)
                    VALUES ('vet', 'coastal_dig_2', 2, 200, 3)`).run();
    sqlite.prepare(`INSERT INTO battle_progress (user_id, stage_id, stars, first_cleared_at_ms, attempts)
                    VALUES ('vet', 'coastal_dig_3', 0, NULL, 2)`).run();

    // lots: three facilities/paddocks built by 'vet'.
    sqlite.prepare(`INSERT INTO lots (user_id, type, kind, name) VALUES ('vet', 'paddock', 'herbivore_paddock', 'Fern Hollow')`).run();
    sqlite.prepare(`INSERT INTO lots (user_id, type, kind, name) VALUES ('vet', 'paddock', 'carnivore_paddock', 'Meat Yard')`).run();
    sqlite.prepare(`INSERT INTO lots (user_id, type, kind, name) VALUES ('vet', 'facility', 'incubator', 'Egg Room')`).run();

    // trades: one accepted (counts for both sides), one pending (does not count).
    const side = (cash: number) => JSON.stringify({ dinoIds: [], eggIds: [], cash, foods: {} });
    sqlite.prepare(`INSERT INTO trades (from_user, to_user, offer, request, status, created_at_ms)
                    VALUES ('vet', 'other', ?, ?, 'accepted', 0)`).run(side(0), side(0));
    sqlite.prepare(`INSERT INTO trades (from_user, to_user, offer, request, status, created_at_ms)
                    VALUES ('vet', 'other', ?, ?, 'pending', 0)`).run(side(0), side(0));

    // breedings: one claimed, one still pending.
    sqlite.prepare(`INSERT INTO breedings (user_id, parent_a, parent_b, rarity, started_at_ms, ready_at_ms, claimed_at_ms)
                    VALUES ('vet', 1, 2, 'common', 0, 100, 150)`).run();
    sqlite.prepare(`INSERT INTO breedings (user_id, parent_a, parent_b, rarity, started_at_ms, ready_at_ms, claimed_at_ms)
                    VALUES ('vet', 3, 4, 'rare', 0, 100, NULL)`).run();

    // expeditions: one claimed, one still out.
    sqlite.prepare(`INSERT INTO expeditions (user_id, site_id, departed_at_ms, returns_at_ms, claimed_at_ms)
                    VALUES ('vet', 'coastal_dig', 0, 100, 100)`).run();
    sqlite.prepare(`INSERT INTO expeditions (user_id, site_id, departed_at_ms, returns_at_ms, claimed_at_ms)
                    VALUES ('vet', 'coastal_dig', 0, 100, NULL)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();

      const stats = sqlite.prepare(
        "SELECT stat, value FROM user_stats WHERE user_id = 'vet' ORDER BY stat").all() as Array<{ stat: string; value: number }>;
      expect(stats).toEqual([
        { stat: 'breedings_claimed', value: 1 },
        { stat: 'breedings_started', value: 2 },
        { stat: 'expeditions_claimed', value: 1 },
        { stat: 'lots_built', value: 3 },
        { stat: 'stages_first_cleared', value: 2 },
        { stat: 'trades_completed', value: 1 },
      ]);
      const u = sqlite.prepare("SELECT quest_streak, quest_streak_best, last_quest_claim_at_ms FROM users WHERE discord_id = 'vet'").get() as Record<string, number>;
      expect(u).toEqual({ quest_streak: 0, quest_streak_best: 0, last_quest_claim_at_ms: 0 });

      // Both parties to the accepted trade get credited, not just the sender.
      const otherStats = sqlite.prepare(
        "SELECT stat, value FROM user_stats WHERE user_id = 'other' ORDER BY stat").all() as Array<{ stat: string; value: number }>;
      expect(otherStats).toEqual([{ stat: 'trades_completed', value: 1 }]);

      // migrateDb must leave FK enforcement ON — runtime integrity depends on it.
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0007 rating rescale via the real drizzle migrator (production path)', () => {
  it('doubles both stored rating columns on a populated database', () => {
    // Reach the 0006 schema via a scratch folder holding migrations 0000-0006, seed a
    // parent user AND a child dino row, then let the real migrateDb apply 0007 exactly
    // as the bot does at startup. An empty-DB run or a raw-SQL replay would pass even
    // if the journal entry were missing, which is the failure this test exists to catch.
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig7-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-6].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 6);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });          // apply 0000-0006 only

    sqlite.prepare(`INSERT INTO users (discord_id, park_rating, rating_high_water, last_collect_at_ms, created_at_ms)
                    VALUES ('u1', 300, 410, 0, 0), ('u2', 0, 0, 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      const rows = sqlite.prepare(`SELECT discord_id, park_rating, rating_high_water FROM users ORDER BY discord_id`).all() as
        Array<{ discord_id: string; park_rating: number; rating_high_water: number }>;
      expect(rows[0]).toEqual({ discord_id: 'u1', park_rating: 600, rating_high_water: 820 });
      expect(rows[1]).toEqual({ discord_id: 'u2', park_rating: 0, rating_high_water: 0 });
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0008 world broadcast via the real drizzle migrator (production path)', () => {
  it('adds world_broadcast defaulting to false and preserves an existing notify channel', () => {
    // Reach the 0007 schema via a scratch folder holding migrations 0000-0007, seed a
    // parent user AND a child dino row (the FK migrateDb must not trip over), plus a
    // pre-existing guild_settings row, then let the real migrateDb apply 0008 exactly
    // as the bot does at startup. An empty-DB run or a raw-SQL replay would pass even
    // if the journal entry were missing (idx 8's `when` <= 0007's), which is the
    // failure this test exists to catch.
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig8-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-7].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 7);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');           // production createDb sets this
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0007 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();
    sqlite.prepare(`INSERT INTO guild_settings (guild_id, notify_channel_id) VALUES ('g1', 'chan1')`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      const rows = sqlite.prepare(`SELECT guild_id, notify_channel_id, world_broadcast FROM guild_settings`).all() as
        Array<{ guild_id: string; notify_channel_id: string; world_broadcast: number }>;
      // A row that predates the column keeps its channel and defaults world_broadcast to off.
      expect(rows).toEqual([{ guild_id: 'g1', notify_channel_id: 'chan1', world_broadcast: 0 }]);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0009 park alerts via the real drizzle migrator (production path)', () => {
  it('adds alerts_enabled defaulting to on, creates alerts_sent, and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig9-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-8].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 8);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0008 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      // A row that predates the column defaults to alerts ON.
      const users = sqlite.prepare(`SELECT discord_id, alerts_enabled FROM users`).all() as
        Array<{ discord_id: string; alerts_enabled: number }>;
      expect(users).toEqual([{ discord_id: 'u1', alerts_enabled: 1 }]);
      // The child row the FK bracket exists to protect survived.
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      // alerts_sent exists and enforces its composite primary key.
      sqlite.prepare(`INSERT INTO alerts_sent (user_id, kind, ref_id, tier, fired_for_ms, sent_at_ms)
                      VALUES ('u1', 'escape', 1, 'heads_up', 500, 100)`).run();
      expect(() => sqlite.prepare(`INSERT INTO alerts_sent (user_id, kind, ref_id, tier, fired_for_ms, sent_at_ms)
                      VALUES ('u1', 'escape', 1, 'heads_up', 900, 200)`).run()).toThrow();
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0010 species_seen via the real drizzle migrator (production path)', () => {
  it('creates species_seen, enforces its key, and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig10-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-9].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 9);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0009 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      // The child row the FK bracket exists to protect survived.
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      sqlite.prepare(`INSERT INTO species_seen (user_id, species_id, first_at_ms)
                      VALUES ('u1', 'triceratops', 500)`).run();
      expect(() => sqlite.prepare(`INSERT INTO species_seen (user_id, species_id, first_at_ms)
                      VALUES ('u1', 'triceratops', 900)`).run()).toThrow();
      // The FK is real: an unknown owner is rejected.
      expect(() => sqlite.prepare(`INSERT INTO species_seen (user_id, species_id, first_at_ms)
                      VALUES ('nobody', 'triceratops', 500)`).run()).toThrow();
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0011 landmark tier via the real drizzle migrator (production path)', () => {
  it('adds landmark_tier defaulting to 0 and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig11-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|10).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 10);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0010 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      const rows = sqlite.prepare(`SELECT discord_id, landmark_tier FROM users`).all();
      expect(rows).toEqual([{ discord_id: 'u1', landmark_tier: 0 }]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0012 park showcase via the real drizzle migrator (production path)', () => {
  it('adds motto and featured_dino_id and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig12-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together. Copy-pasting 0011's
    // /^00(0[0-9]|10).*\.sql$/ here would omit 0011 from the scratch folder while every
    // assertion below still passed — green for the wrong reason, against a 0010 baseline.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[01]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 11);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0011 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      const rows = sqlite.prepare(`SELECT discord_id, motto, featured_dino_id FROM users`).all();
      expect(rows).toEqual([{ discord_id: 'u1', motto: '', featured_dino_id: null }]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
      // No foreign key on featured_dino_id: an id naming no dino must be storable, because
      // a featured dino can be sold at any time and nothing sweeps the column.
      expect(() => sqlite.prepare(`UPDATE users SET featured_dino_id = 9999 WHERE discord_id = 'u1'`).run())
        .not.toThrow();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0013 duels via the real drizzle migrator (production path)', () => {
  it('adds duel_rating and duel_squad, creates duels, and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig13-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together. Copy-pasting 0012's
    // /^00(0[0-9]|1[01]).*\.sql$/ here would omit 0012 from the scratch folder while
    // every assertion below still passed — green for the wrong reason, against a
    // 0011 baseline.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[0-2]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 12);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0012 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u2', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      // Existing rows pick up the defaults rather than NULL: every reader in src/
      // treats duel_squad as an array and duel_rating as a number.
      const rows = sqlite.prepare(`SELECT discord_id, duel_rating, duel_squad FROM users ORDER BY discord_id`).all();
      expect(rows).toEqual([
        { discord_id: 'u1', duel_rating: 1000, duel_squad: '[]' },
        { discord_id: 'u2', duel_rating: 1000, duel_squad: '[]' },
      ]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
      // The log is real and two-sided.
      sqlite.prepare(`INSERT INTO duels (challenger_id, defender_id, mode, result, elo_delta, created_at_ms)
                      VALUES ('u1', 'u2', 'ghost', 'win', 16, 0)`).run();
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM duels`).get() as { c: number }).c).toBe(1);
      // Both sides carry a real foreign key to users: a duel naming nobody is not a
      // state the game can reach, unlike featured_dino_id, which deliberately has none.
      expect(() => sqlite.prepare(`INSERT INTO duels (challenger_id, defender_id, mode, result, elo_delta, created_at_ms)
                                   VALUES ('u1', 'nobody', 'ghost', 'win', 16, 0)`).run()).toThrow();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0014 legacy rank best via the real drizzle migrator (production path)', () => {
  it('adds legacy_rank_best defaulting to 0 and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig14-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[0-3]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 13);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0013 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      const rows = sqlite.prepare(`SELECT discord_id, legacy_rank_best FROM users`).all();
      expect(rows).toEqual([{ discord_id: 'u1', legacy_rank_best: 0 }]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0015 season track via the real drizzle migrator (production path)', () => {
  it('creates both season tables and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig15-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[0-4]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 14);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0014 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      sqlite.prepare(`INSERT INTO season_progress (user_id, season_index, baselines, head_start, created_at_ms)
                      VALUES ('u1', 689, '{}', 0, 0)`).run();
      sqlite.prepare(`INSERT INTO season_claims (user_id, season_index, rung, claimed_at_ms)
                      VALUES ('u1', 689, 0, 0)`).run();
      // badge_at_ms is nullable: a season in progress has no badge yet.
      expect(sqlite.prepare(`SELECT badge_at_ms FROM season_progress`).all())
        .toEqual([{ badge_at_ms: null }]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('0016 season hint high water via the real drizzle migrator (production path)', () => {
  it('adds hinted_rung defaulting to -1 and preserves an existing season_progress row', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig16-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[0-5]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 15);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0015 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();
    // Existing pre-0016 row: no hinted_rung column yet at insert time.
    sqlite.prepare(`INSERT INTO season_progress (user_id, season_index, baselines, head_start, created_at_ms)
                    VALUES ('u1', 689, '{}', 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      expect(sqlite.prepare(`SELECT hinted_rung FROM season_progress WHERE user_id = 'u1'`).all())
        .toEqual([{ hinted_rung: -1 }]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
