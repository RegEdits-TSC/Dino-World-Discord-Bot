import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrateDb, schema, type Db } from '../src/core/db/index.js';
import { EconomyService, InsufficientFundsError, ReversalError, shortfallLine } from '../src/core/economy.js';
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

describe('EconomyService.reverse', () => {
  it('posts a compensating row and moves the balance back', () => {
    eco.apply('u1', { cash: -300 }, 'build:paddock_plains', 100);
    expect(bal().cash).toBe(200);

    const charge = db.select().from(schema.txLog).all().at(-1)!;
    const out = eco.reverse(charge.id, 500);

    expect(out.targetId).toBe(charge.id);
    expect(bal().cash).toBe(500);
    const reversal = db.select().from(schema.txLog)
      .where(eq(schema.txLog.id, out.reversalId)).get()!;
    expect(reversal).toMatchObject({
      userId: 'u1', cashDelta: 300, reason: 'reverse', reversesId: charge.id, note: null,
    });
  });

  it('stores the operator note on the reversal row', () => {
    eco.apply('u1', { cash: -100 }, 'landmark:1', 100);
    const charge = db.select().from(schema.txLog).all().at(-1)!;
    const out = eco.reverse(charge.id, 500, 'stale button double-charge');
    expect(db.select().from(schema.txLog).where(eq(schema.txLog.id, out.reversalId)).get()!.note)
      .toBe('stale button double-charge');
  });

  it('reverses a food row independently of its cash row', () => {
    eco.apply('u1', { cash: -50, foods: { ferns: 3 } }, 'shop-food:ferns:3', 100);
    const rows = db.select().from(schema.txLog).all();
    const foodRow = rows.find((r) => r.foodId === 'ferns')!;
    eco.reverse(foodRow.id, 500);
    expect(eco.getFoodInventory('u1').ferns ?? 0).toBe(0);
    expect(bal().cash).toBe(450);                       // the cash row is untouched
  });

  it('reversing a food row writes exactly one row and names it as reversalId', () => {
    eco.apply('u1', { cash: -50, foods: { ferns: 3 } }, 'shop-food:ferns:3', 100);
    const before = db.select().from(schema.txLog).all().length;                     // cash row + food row
    const foodRow = db.select().from(schema.txLog).all().find((r) => r.foodId === 'ferns')!;

    const out = eco.reverse(foodRow.id, 500);

    const rows = db.select().from(schema.txLog).all();
    expect(rows).toHaveLength(before + 1);                          // no orphan zero-delta base row
    expect(rows.at(-1)!.id).toBe(out.reversalId);
    expect(rows.at(-1)).toMatchObject({
      foodId: 'ferns', foodDelta: -3, cashDelta: 0, shardsDelta: 0, reversesId: foodRow.id,
    });
  });

  it('refuses an unknown transaction', () => {
    expect(() => eco.reverse(9999, 500)).toThrow(ReversalError);
  });

  it('refuses to reverse the same charge twice', () => {
    eco.apply('u1', { cash: -100 }, 'build:x', 100);
    const charge = db.select().from(schema.txLog).all().at(-1)!;
    eco.reverse(charge.id, 500);
    expect(() => eco.reverse(charge.id, 600)).toThrow(/already reversed/i);
  });

  it('refuses to reverse a reversal — reversals are terminal', () => {
    eco.apply('u1', { cash: -100 }, 'build:x', 100);
    const charge = db.select().from(schema.txLog).all().at(-1)!;
    const out = eco.reverse(charge.id, 500);
    expect(() => eco.reverse(out.reversalId, 600)).toThrow(/terminal/i);
  });

  it('refuses a credit reversal the player can no longer afford, leaving no partial row', () => {
    eco.apply('u1', { cash: 1000 }, 'admin:give', 100);   // 500 -> 1500
    const grant = db.select().from(schema.txLog).all().at(-1)!;
    eco.apply('u1', { cash: -1400 }, 'build:x', 200);     // 1500 -> 100
    const before = db.select().from(schema.txLog).all().length;

    expect(() => eco.reverse(grant.id, 500)).toThrow(InsufficientFundsError);
    expect(bal().cash).toBe(100);                          // unchanged
    expect(db.select().from(schema.txLog).all()).toHaveLength(before);  // no partial row
  });

  it('throws rather than returning a null id when a reversal writes no row', () => {
    // A food row of quantity zero: apply() cannot create one (its own zero filter drops the
    // entry first), so this is built by hand. reverse() suppresses the base row for a food
    // row and the zero food entry is then filtered out too, leaving nothing written. The old
    // `baseId ?? lastFoodId!` handed that back as a null id, which adminReverse reports to the
    // operator as a completed reversal — a success message for money that never moved.
    db.insert(schema.txLog).values({
      userId: 'u1', foodDelta: 0, foodId: 'ferns', reason: 'feed:trex', createdAt: 100,
    }).run();
    const empty = db.select().from(schema.txLog).all().at(-1)!;
    expect(() => eco.reverse(empty.id, 500)).toThrow(/recorded no row/i);
    // And nothing was left behind by the attempt.
    expect(db.select().from(schema.txLog).all().filter((r) => r.reversesId !== null)).toHaveLength(0);
  });

  it('rolls back the wallet update when the reversal audit insert fails', () => {
    eco.apply('u1', { cash: -100 }, 'build:x', 100);        // 500 -> 400
    const charge = db.select().from(schema.txLog).all().at(-1)!;

    // raw better-sqlite3 handle; drizzle exposes it as db.$client
    const raw = db.$client;
    raw.exec(`CREATE TRIGGER block_reverse BEFORE INSERT ON tx_log
              WHEN NEW.reason = 'reverse'
              BEGIN SELECT RAISE(ABORT, 'forced'); END;`);

    expect(() => eco.reverse(charge.id, 500)).toThrow();
    expect(bal().cash).toBe(400);                     // wallet update rolled back, not left at 500
  });
});

describe('InsufficientFundsError carries the numbers it used to withhold', () => {
  // Never `expect(fn).toThrow(InsufficientFundsError)` here: that proves a CLASS, and what is
  // under test is the three fields on the instance. The trailing throw is what stops the whole
  // block passing vacuously if the guard stops firing and nothing is thrown at all.
  function overdraft(fn: () => void): InsufficientFundsError {
    try {
      fn();
    } catch (e) {
      if (e instanceof InsufficientFundsError) return e;
      throw e;
    }
    throw new Error('expected an InsufficientFundsError; nothing was thrown');
  }

  it('a cash overdraft carries the amount asked for, the balance held, and no foodId', () => {
    eco.apply('u1', { cash: 7_910 }, 'seed', 0);            // 500 -> 8,410
    const e = overdraft(() => eco.apply('u1', { cash: -12_000 }, 'build:gene_lab', 0));
    expect(e.wallet).toBe('cash');
    expect(e.needed).toBe(12_000);
    expect(e.held).toBe(8_410);
    expect(e.foodId).toBeUndefined();
    // The WHOLE line. Step 6 swaps the two constructor arguments and shows that
    // toContain('8,410') and toContain('3,590') BOTH still pass against the broken output;
    // only .toBe catches it.
    expect(shortfallLine(e)).toBe('costs 12,000, you have 8,410 (3,590 short)');
    // message is deliberately untouched: src/modules/admin/service.ts and the
    // "Insufficient Fish" assertion earlier in this file both still read it.
    expect(e.message).toBe('Insufficient cash');
    expect(bal().cash).toBe(8_410);                          // and nothing was written
  });

  it('a shards overdraft carries its own wallet and numbers', () => {
    eco.apply('u1', { shards: 340 }, 'seed', 0);
    const e = overdraft(() => eco.apply('u1', { shards: -500 }, 'mythic:indominus', 0));
    expect(e.wallet).toBe('shards');
    expect(e.needed).toBe(500);
    expect(e.held).toBe(340);
    expect(shortfallLine(e)).toBe('costs 500, you have 340 (160 short)');
    expect(e.message).toBe('Insufficient shards');
  });

  it('a food overdraft counts units, names the food, and says "need" rather than "costs"', () => {
    eco.apply('u1', { foods: { ferns: 1 } }, 'seed', 0);
    const e = overdraft(() => eco.apply('u1', { foods: { ferns: -3 } }, 'feed:triceratops', 0));
    expect(e.wallet).toBe('food');
    expect(e.foodId).toBe('ferns');
    expect(e.needed).toBe(3);
    expect(e.held).toBe(1);
    expect(shortfallLine(e)).toBe('need 3, you have 1 (2 short)');
    expect(e.message).toBe('Insufficient Ferns');
  });

  it('a food the player holds none of reports held 0, not a missing row', () => {
    // food_inventory has no row at all for a food never bought, and getFoodInventory drops
    // zero rows besides. `held` must still be the number 0 — not undefined, not NaN.
    const e = overdraft(() => eco.apply('u1', { foods: { goat: -2 } }, 'feed:trex', 0));
    expect(e.wallet).toBe('food');
    expect(e.held).toBe(0);
    expect(e.needed).toBe(2);
    expect(shortfallLine(e)).toBe('need 2, you have 0 (2 short)');
  });
});
