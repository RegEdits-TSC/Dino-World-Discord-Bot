import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrateDb, schema, type Db } from '../src/core/db/index.js';
import { EconomyService, InsufficientFundsError } from '../src/core/economy.js';
import { eq } from 'drizzle-orm';

let db: Db; let eco: EconomyService;
beforeEach(() => {
  db = createDb(':memory:'); migrateDb(db);
  db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run(); // starts cash 500
  eco = new EconomyService(db);
});

const bal = () => db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;

describe('EconomyService.apply', () => {
  it('credits and debits atomically with audit rows per food item', () => {
    eco.apply('u1', { foods: { ferns: 10 } }, 'seed', 0);
    eco.apply('u1', { cash: 100, foods: { ferns: -5 } }, 'test:mixed', 1000);
    expect(bal().cash).toBe(600);
    const inv = eco.getFoodInventory('u1');
    expect(inv.ferns).toBe(5);
    const logs = db.select().from(schema.txLog).all().filter((l) => l.reason === 'test:mixed');
    expect(logs).toHaveLength(2);                                        // base row + one food row
    expect(logs[0]).toMatchObject({ userId: 'u1', cashDelta: 100, foodId: null });
    expect(logs[1]).toMatchObject({ userId: 'u1', foodDelta: -5, foodId: 'ferns' });
  });
  it('rejects a food overdraft with the item name and rolls everything back', () => {
    eco.apply('u1', { foods: { fish: 3 } }, 'seed', 0);
    expect(() => eco.apply('u1', { cash: 100, foods: { fish: -4 } }, 'test:overdraft', 0))
      .toThrow('Insufficient Fish');
    expect(bal().cash).toBe(500);
    expect(eco.getFoodInventory('u1').fish).toBe(3);
  });
  it('getFoodInventory omits zero rows', () => {
    eco.apply('u1', { foods: { goat: 2 } }, 'seed', 0);
    eco.apply('u1', { foods: { goat: -2 } }, 'spend', 0);
    expect(eco.getFoodInventory('u1')).toEqual({});
  });
  it('rejects any overdraft and rolls back everything', () => {
    expect(() => eco.apply('u1', { cash: 100, shards: -1 }, 'test:overdraft', 1000))
      .toThrow(InsufficientFundsError);
    expect(bal().cash).toBe(500);                    // credit rolled back too
    expect(db.select().from(schema.txLog).all()).toHaveLength(0);
  });
  it('rolls back the wallet update when the audit insert fails', () => {
    // raw better-sqlite3 handle; drizzle exposes it as db.$client
    const raw = db.$client;
    raw.exec(`CREATE TRIGGER block_fail BEFORE INSERT ON tx_log
              WHEN NEW.reason = 'FORCE_FAIL'
              BEGIN SELECT RAISE(ABORT, 'forced'); END;`);
    expect(() => eco.apply('u1', { cash: 100 }, 'FORCE_FAIL', 1000)).toThrow();
    expect(bal().cash).toBe(500);                     // update rolled back, not left at 600
    expect(db.select().from(schema.txLog).all()).toHaveLength(0);
  });
  it('throws a plain Error for an unknown user and writes no audit row', () => {
    expect(() => eco.apply('ghost', { cash: 1 }, 'x', 0)).toThrow(Error);
    expect(() => eco.apply('ghost', { cash: 1 }, 'x', 0)).not.toThrow(InsufficientFundsError);
    expect(db.select().from(schema.txLog).all()).toHaveLength(0);
  });
});
