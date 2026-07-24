import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from './db/index.js';
import { FOODS, type FoodId } from '../data/foods.js';

export interface WalletDelta { cash?: number; shards?: number; foods?: Partial<Record<FoodId, number>> }

export class InsufficientFundsError extends Error {
  constructor(public wallet: 'cash' | 'food' | 'shards', public foodId?: FoodId) {
    super(foodId ? `Insufficient ${FOODS[foodId].name}` : `Insufficient ${wallet}`);
  }
}

export class EconomyService {
  constructor(private db: Db) {}

  apply(userId: string, delta: WalletDelta, reason: string, now: number): void {
    const { cash = 0, shards = 0, foods = {} } = delta;
    const foodEntries = (Object.entries(foods) as Array<[FoodId, number]>).filter(([, q]) => q !== 0);
    this.db.transaction((tx) => {
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
      tx.insert(schema.txLog).values({ userId, cashDelta: cash, shardsDelta: shards, reason, createdAt: now }).run();
      for (const [foodId, qty] of foodEntries) {
        tx.insert(schema.txLog).values({ userId, foodDelta: qty, foodId, reason, createdAt: now }).run();
      }
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
