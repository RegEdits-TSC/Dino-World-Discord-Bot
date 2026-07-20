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
});
