import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from './db/index.js';

export interface WalletDelta { cash?: number; food?: number; shards?: number }

export class InsufficientFundsError extends Error {
  constructor(public wallet: 'cash' | 'food' | 'shards') { super(`Insufficient ${wallet}`); }
}

export class EconomyService {
  constructor(private db: Db) {}

  apply(userId: string, delta: WalletDelta, reason: string, now: number): void {
    const { cash = 0, food = 0, shards = 0 } = delta;
    this.db.transaction((tx) => {
      const u = tx.select().from(schema.users)
        .where(eq(schema.users.discordId, userId)).get();
      if (!u) throw new Error(`Unknown user ${userId}`);
      if (u.cash + cash < 0) throw new InsufficientFundsError('cash');
      if (u.food + food < 0) throw new InsufficientFundsError('food');
      if (u.shards + shards < 0) throw new InsufficientFundsError('shards');
      tx.update(schema.users).set({
        cash: sql`${schema.users.cash} + ${cash}`,
        food: sql`${schema.users.food} + ${food}`,
        shards: sql`${schema.users.shards} + ${shards}`,
      }).where(eq(schema.users.discordId, userId)).run();
      tx.insert(schema.txLog).values({
        userId, cashDelta: cash, foodDelta: food, shardsDelta: shards, reason, createdAt: now,
      }).run();
    });
  }
}
