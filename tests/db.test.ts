import { describe, it, expect } from 'vitest';
import { createDb, migrateDb, schema } from '../src/core/db/index.js';

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
});
