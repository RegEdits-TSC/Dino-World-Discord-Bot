import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { LANDMARKS, MAX_LANDMARK_TIER, landmarkFor, landmarkCostFor, landmarkBandFor } from '../src/data/landmarks.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { InsufficientFundsError } from '../src/core/economy.js';
import { makeCtx } from './harness.js';
import { buyLandmark, nextLandmark, LandmarkMaxedError } from '../src/modules/park/landmarks.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
});

describe('landmark ladder', () => {
  it('is six rungs of strictly increasing cost', () => {
    expect(LANDMARKS).toHaveLength(6);
    expect(MAX_LANDMARK_TIER).toBe(6);
    LANDMARKS.forEach((l, i) => expect(l.tier, l.name).toBe(i + 1));
    for (let i = 1; i < LANDMARKS.length; i++) {
      expect(LANDMARKS[i].cost, LANDMARKS[i].name).toBeGreaterThan(LANDMARKS[i - 1].cost);
    }
  });
  it('matches the spec values', () => {
    expect(LANDMARKS.map((l) => l.cost)).toEqual([5_000_000, 10_000_000, 20_000_000, 40_000_000, 80_000_000, 160_000_000]);
    expect(LANDMARKS.map((l) => l.band)).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
    expect(LANDMARKS.map((l) => l.name)).toEqual([
      'Stone Marker', 'Fossil Plinth', 'Bronze Sentinel', 'Amber Obelisk', 'Grand Rotunda', 'Titan Monument',
    ]);
  });
  it('totals 315,000,000 — the sink sizing the spec is built on', () => {
    expect(LANDMARKS.reduce((s, l) => s + l.cost, 0)).toBe(315_000_000);
  });
  it('every band is used, so no art file is orphaned', () => {
    expect(new Set(LANDMARKS.map((l) => l.band))).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('landmark lookups', () => {
  it('resolve a real tier', () => {
    expect(landmarkFor(1)!.name).toBe('Stone Marker');
    expect(landmarkCostFor(3)).toBe(20_000_000);
    expect(landmarkBandFor(5)).toBe('c');
  });
  it('return null outside the ladder rather than throwing or reading past the table', () => {
    for (const t of [0, -1, 7, 99, 1.5, NaN]) {
      expect(landmarkFor(t), `tier ${t}`).toBeNull();
      expect(landmarkCostFor(t), `tier ${t}`).toBeNull();
      expect(landmarkBandFor(t), `tier ${t}`).toBeNull();
    }
  });
});

describe('buyLandmark', () => {
  const rich = (c: ReturnType<typeof makeCtx>, cash: number) =>
    c.db.update(schema.users).set({ cash }).where(eq(schema.users.discordId, 'u1')).run();

  it('charges the next tier and increments by exactly one', () => {
    rich(ctx, 5_000_000);
    const def = buyLandmark(ctx, 'u1');
    expect(def.tier).toBe(1);
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(1);
    expect(row.cash).toBe(0);
  });

  it('walks the ladder one rung at a time', () => {
    rich(ctx, 15_000_000);
    buyLandmark(ctx, 'u1');
    const second = buyLandmark(ctx, 'u1');
    expect(second.tier).toBe(2);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(0);
  });

  it('refuses past the top rung', () => {
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER, cash: 999_999_999 })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(() => buyLandmark(ctx, 'u1')).toThrow(LandmarkMaxedError);
  });

  it('refuses without the cash and leaves the tier untouched', () => {
    rich(ctx, 4_999_999);
    expect(() => buyLandmark(ctx, 'u1')).toThrow(InsufficientFundsError);
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(0);
    expect(row.cash).toBe(4_999_999);
  });

  it('reports the next rung and stops reporting one at the top', () => {
    expect(nextLandmark(ctx, 'u1')!.tier).toBe(1);
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(nextLandmark(ctx, 'u1')).toBeNull();
  });
});
