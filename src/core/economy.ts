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
    this.db.transaction((tx) => { this.post(tx, userId, delta, reason, now, null, null); });
  }

  // The single writer for every wallet movement. Called inside an open transaction by both
  // apply() and reverse() so the balance guards and the audit rows can never diverge.
  private post(
    tx: Tx, userId: string, delta: WalletDelta, reason: string, now: number,
    reversesId: number | null, note: string | null,
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
    const base = tx.insert(schema.txLog)
      .values({ userId, cashDelta: cash, shardsDelta: shards, reason, createdAt: now, reversesId, note })
      .returning().get();
    for (const [foodId, qty] of foodEntries) {
      tx.insert(schema.txLog)
        .values({ userId, foodDelta: qty, foodId, reason, createdAt: now, reversesId, note }).run();
    }
    return base.id;
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
      // separately, so each reverses independently.
      const delta: WalletDelta = target.foodId
        ? { foods: { [target.foodId as FoodId]: -target.foodDelta } }
        : { cash: -target.cashDelta, shards: -target.shardsDelta };

      const reversalId = this.post(tx, target.userId, delta, 'reverse', now, target.id, note ?? null);
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
