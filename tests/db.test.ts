import { describe, it, expect } from 'vitest';
import { createDb, migrateDb, schema } from '../src/core/db/index.js';
import { makeCtx } from './harness.js';

describe('database', () => {
  it('creates schema and enforces non-negative cash', () => {
    const db = createDb(':memory:');
    migrateDb(db);
    db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    expect(() =>
      db.update(schema.users).set({ cash: -1 }).run()
    ).toThrow();
  });
  it('enforces non-negative food_inventory qty', () => {
    const db = createDb(':memory:'); migrateDb(db);
    db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    db.insert(schema.foodInventory).values({ userId: 'u1', foodId: 'ferns', qty: 1 }).run();
    expect(() => db.update(schema.foodInventory).set({ qty: -1 }).run()).toThrow();
  });

  describe('migration 0020 — the incoming-trade index', () => {
    it('creates trades_status_to on (status, to_user, created_at_ms)', () => {
      const ctx = makeCtx();
      // sqlite_master is the authority: a drizzle schema declaration that never reached a
      // migration file compiles, typechecks and passes every ORM-level test while the real
      // database has no such index. This assertion reads the DB, not the schema module.
      const row = ctx.db.$client
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('trades_status_to') as { sql: string } | undefined;
      expect(row, 'trades_status_to is missing from the migrated database').toBeTruthy();
      // Column ORDER is the whole point of the index — status leads because it is the
      // lowest-cardinality column and the only predicate expireStale filters on, and
      // created_at_ms trails because the hub filters expiry on it. A reordered index
      // still exists and still passes a name-only check.
      expect(row!.sql.replace(/\s+/g, ' ')).toContain('(`status`,`to_user`,`created_at_ms`)');
    });
  });
});
