import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from './db/index.js';
import { FOODS, type FoodId } from '../data/foods.js';

export interface WalletDelta { cash?: number; shards?: number; foods?: Partial<Record<FoodId, number>> }

export class InsufficientFundsError extends Error {
  constructor(public wallet: 'cash' | 'food' | 'shards', public foodId?: FoodId) {
    super(foodId ? `Insufficient ${FOODS[foodId].name}` : `Insufficient ${wallet}`);
  }
}

export class ReversalError extends Error {}

// The handle drizzle hands a transaction callback. NOT `Db` — a transaction is a narrower
// type, and typing the shared helper's parameter as `Db` will not compile.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class EconomyService {
  constructor(private db: Db) {}

  apply(userId: string, delta: WalletDelta, reason: string, now: number): void {
    this.db.transaction((tx) => { this.post(tx, userId, delta, reason, now, null, null, false); });
  }

  // The single writer for every wallet movement. Called inside an open transaction by both
  // apply() and reverse() so the balance guards and the audit rows can never diverge.
  // skipBaseRow: true only for reversing a food row — that reversal's cash/shards delta is
  // zero by construction, and writing that empty base row anyway would drop an orphan row
  // into the ledger and leave two new rows for reverse() to choose an id from. apply() always
  // passes false, so its base row is written exactly as before.
  private post(
    tx: Tx, userId: string, delta: WalletDelta, reason: string, now: number,
    reversesId: number | null, note: string | null, skipBaseRow: boolean,
  ): number {
    const { cash = 0, shards = 0, foods = {} } = delta;
    const foodEntries = (Object.entries(foods) as Array<[FoodId, number]>).filter(([, q]) => q !== 0);
    const u = tx.select().from(schema.users)
      .where(eq(schema.users.discordId, userId)).get();
    if (!u) throw new Error(`Unknown user ${userId}`);
    if (u.cash + cash < 0) throw new InsufficientFundsError('cash');
    if (u.shards + shards < 0) throw new InsufficientFundsError('shards');
    tx.update(schema.users).set({
      cash: sql`${schema.users.cash} + ${cash}`,
      shards: sql`${schema.users.shards} + ${shards}`,
    }).where(eq(schema.users.discordId, userId)).run();
    for (const [foodId, qty] of foodEntries) {
      const row = tx.select().from(schema.foodInventory)
        .where(and(eq(schema.foodInventory.userId, userId), eq(schema.foodInventory.foodId, foodId))).get();
      const next = (row?.qty ?? 0) + qty;
      if (next < 0) throw new InsufficientFundsError('food', foodId);
      if (row) {
        tx.update(schema.foodInventory).set({ qty: next })
          .where(and(eq(schema.foodInventory.userId, userId), eq(schema.foodInventory.foodId, foodId))).run();
      } else {
        tx.insert(schema.foodInventory).values({ userId, foodId, qty: next }).run();
      }
    }
    let baseId: number | null = null;
    if (!skipBaseRow) {
      const base = tx.insert(schema.txLog)
        .values({ userId, cashDelta: cash, shardsDelta: shards, reason, createdAt: now, reversesId, note })
        .returning().get();
      baseId = base.id;
    }
    let lastFoodId: number | null = null;
    for (const [foodId, qty] of foodEntries) {
      if (skipBaseRow) {
        const row = tx.insert(schema.txLog)
          .values({ userId, foodDelta: qty, foodId, reason, createdAt: now, reversesId, note })
          .returning().get();
        lastFoodId = row.id;
      } else {
        tx.insert(schema.txLog)
          .values({ userId, foodDelta: qty, foodId, reason, createdAt: now, reversesId, note }).run();
      }
    }
    // skipBaseRow is only ever true for a single-food-entry reversal (see reverse() below), so
    // exactly one of these is non-null — but it is asserted rather than assumed. A non-null
    // assertion here would hand the caller a null id on a row that wrote nothing, and
    // adminReverse reports that id to the operator as a completed reversal: a success message
    // for money that never moved. Throwing turns the same impossible state into a visible
    // failure. Reachable only by a food row whose quantity is zero, which apply() cannot
    // create — its own zero filter drops the entry before the row is ever written.
    if (baseId !== null) return baseId;
    if (lastFoodId !== null) return lastFoodId;
    throw new Error(`Ledger write for ${reason} recorded no row.`);
  }

  // Reverses one ledger row by posting its opposite as a NEW row. tx_log is append-only: the
  // target is never edited, and "already reversed?" is derived by looking for a row that
  // points at it. Read, guard and both writes share one transaction, and better-sqlite3 is
  // synchronous with no suspension point between them, so a double reversal is structurally
  // impossible rather than checked by convention.
  reverse(txId: number, now: number, note?: string): { targetId: number; reversalId: number } {
    return this.db.transaction((tx) => {
      const target = tx.select().from(schema.txLog).where(eq(schema.txLog.id, txId)).get();
      if (!target) throw new ReversalError(`No transaction #${txId}.`);
      // Reversals are terminal. Reversing a reversal is coherent double-entry, but it would
      // leave the target still pointed at by a row while the player is, on net, charged —
      // so the derived flag would report "reversed" and be wrong.
      if (target.reversesId !== null) {
        throw new ReversalError(`#${txId} is itself a reversal, and reversals are terminal.`);
      }
      const existing = tx.select().from(schema.txLog)
        .where(eq(schema.txLog.reversesId, txId)).get();
      if (existing) throw new ReversalError(`#${txId} was already reversed by #${existing.id}.`);

      // A row is either a cash/shards row or a food row, never both — apply() writes them
      // separately, so each reverses independently. A food row's opposite has nothing to say
      // in the base cash/shards row (cash=0, shards=0), so skipBaseRow suppresses it —
      // see post()'s own comment.
      const isFoodRow = target.foodId !== null;
      const delta: WalletDelta = isFoodRow
        ? { foods: { [target.foodId as FoodId]: -target.foodDelta } }
        : { cash: -target.cashDelta, shards: -target.shardsDelta };

      const reversalId = this.post(tx, target.userId, delta, 'reverse', now, target.id, note ?? null, isFoodRow);
      return { targetId: target.id, reversalId };
    });
  }

  getFoodInventory(userId: string): Partial<Record<FoodId, number>> {
    const rows = this.db.select().from(schema.foodInventory)
      .where(eq(schema.foodInventory.userId, userId)).all();
    const out: Partial<Record<FoodId, number>> = {};
    for (const r of rows) if (r.qty > 0) out[r.foodId as FoodId] = r.qty;
    return out;
  }
}
