import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrateDb, schema, type Db } from '../src/core/db/index.js';
import { EconomyService, InsufficientFundsError } from '../src/core/economy.js';
import { eq } from 'drizzle-orm';

let db: Db; let eco: EconomyService;
beforeEach(() => {
  db = createDb(':memory:'); migrateDb(db);
  db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run(); // starts cash 500, food 20
  eco = new EconomyService(db);
});

const bal = () => db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;

describe('EconomyService.apply', () => {
  it('credits and debits atomically with audit row', () => {
    eco.apply('u1', { cash: 100, food: -5 }, 'test:mixed', 1000);
    expect(bal().cash).toBe(600);
    expect(bal().food).toBe(15);
    const logs = db.select().from(schema.txLog).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ userId: 'u1', cashDelta: 100, foodDelta: -5, reason: 'test:mixed' });
  });
  it('rejects any overdraft and rolls back everything', () => {
    expect(() => eco.apply('u1', { cash: 100, shards: -1 }, 'test:overdraft', 1000))
      .toThrow(InsufficientFundsError);
    expect(bal().cash).toBe(500);                    // credit rolled back too
    expect(db.select().from(schema.txLog).all()).toHaveLength(0);
  });
});
