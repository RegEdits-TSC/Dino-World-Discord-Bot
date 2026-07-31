import { describe, it, expect } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { locksFor } from '../src/core/locks.js';
import { TRADE_EXPIRY_MS } from '../src/data/trade.js';

function seed(ctx: ReturnType<typeof makeCtx>, id: string) {
  ctx.db.insert(schema.users).values({ discordId: id, lastCollectAt: 0, createdAt: 0 }).run();
  const dino = ctx.db.insert(schema.dinos).values({
    userId: id, speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
  }).returning().get();
  const egg = ctx.db.insert(schema.eggs).values({
    userId: id, rarity: 'rare', source: 'shop', obtainedAt: 0,
  }).returning().get();
  return { dino, egg };
}

const emptySide = { dinoIds: [], eggIds: [], cash: 0, foods: {} };

describe('locksFor', () => {
  it('locks the offer side of a pending trade', () => {
    const ctx = makeCtx({ nowMs: 1_000 });
    const a = seed(ctx, 'u1'); seed(ctx, 'u2');
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { ...emptySide, dinoIds: [a.dino.id], eggIds: [a.egg.id] },
      request: emptySide, status: 'pending', createdAt: 1_000,
    }).run();

    const locks = locksFor(ctx, 'u1');
    expect(locks.dinos.get(a.dino.id)).toEqual({ kind: 'trade', tradeId: 1 });
    expect(locks.eggs.get(a.egg.id)).toEqual({ kind: 'trade', tradeId: 1 });
  });

  it('does not lock the request side', () => {
    const ctx = makeCtx({ nowMs: 1_000 });
    seed(ctx, 'u1'); const b = seed(ctx, 'u2');
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2', offer: emptySide,
      request: { ...emptySide, dinoIds: [b.dino.id] },
      status: 'pending', createdAt: 1_000,
    }).run();

    expect(locksFor(ctx, 'u2').dinos.size).toBe(0);
  });

  it('stops locking once the trade is past expiry, with no sweep', () => {
    const ctx = makeCtx({ nowMs: 1_000 });
    const a = seed(ctx, 'u1'); seed(ctx, 'u2');
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { ...emptySide, dinoIds: [a.dino.id] },
      request: emptySide, status: 'pending', createdAt: 1_000,
    }).run();
    expect(locksFor(ctx, 'u1').dinos.size).toBe(1);

    ctx.setNow(1_000 + TRADE_EXPIRY_MS + 1);
    // No expireStale call — the predicate is evaluated at read time.
    expect(locksFor(ctx, 'u1').dinos.size).toBe(0);
    // ...and the row is still 'pending', proving nothing swept it.
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('pending');
  });

  it('ignores non-pending trades', () => {
    const ctx = makeCtx({ nowMs: 1_000 });
    const a = seed(ctx, 'u1'); seed(ctx, 'u2');
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { ...emptySide, dinoIds: [a.dino.id] },
      request: emptySide, status: 'cancelled', createdAt: 1_000,
    }).run();
    expect(locksFor(ctx, 'u1').dinos.size).toBe(0);
  });

  it('locks both parents of an unclaimed breeding', () => {
    const ctx = makeCtx({ nowMs: 1_000 });
    const a = seed(ctx, 'u1');
    const b = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'stegosaurus', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: a.dino.id, parentB: b.id, rarity: 'common',
      startedAt: 1_000, readyAt: 2_000,
    }).run();

    const locks = locksFor(ctx, 'u1');
    expect(locks.dinos.get(a.dino.id)).toEqual({ kind: 'breeding', breedingId: 1 });
    expect(locks.dinos.get(b.id)).toEqual({ kind: 'breeding', breedingId: 1 });
  });

  it('keeps parents locked after readyAt until the egg is claimed', () => {
    const ctx = makeCtx({ nowMs: 9_999 });
    const a = seed(ctx, 'u1');
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: a.dino.id, parentB: a.dino.id, rarity: 'common',
      startedAt: 0, readyAt: 100,
    }).run();
    expect(locksFor(ctx, 'u1').dinos.has(a.dino.id)).toBe(true);
  });

  it('releases parents once claimed', () => {
    const ctx = makeCtx({ nowMs: 9_999 });
    const a = seed(ctx, 'u1');
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: a.dino.id, parentB: a.dino.id, rarity: 'common',
      startedAt: 0, readyAt: 100, claimedAt: 200,
    }).run();
    expect(locksFor(ctx, 'u1').dinos.size).toBe(0);
  });

  it('scopes to the requested user only', () => {
    const ctx = makeCtx({ nowMs: 1_000 });
    const a = seed(ctx, 'u1'); seed(ctx, 'u2');
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { ...emptySide, dinoIds: [a.dino.id] },
      request: emptySide, status: 'pending', createdAt: 1_000,
    }).run();
    expect(locksFor(ctx, 'u2').dinos.size).toBe(0);
  });
});
