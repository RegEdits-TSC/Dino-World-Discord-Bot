import { describe, it, expect } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track, readStat, readStats, STATS } from '../src/core/stats.js';

describe('stats substrate', () => {
  it('catalogs exactly the 18 spec stats with count/sum kinds', () => {
    expect(Object.keys(STATS)).toHaveLength(18);
    expect(STATS.income_collected).toBe('sum');
    expect(STATS.income_collections).toBe('count');
    expect(STATS.trades_completed).toBe('count');
  });
  it('missing row reads 0; track upserts and accumulates', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    expect(readStat(ctx, 'u1', 'eggs_hatched')).toBe(0);
    track(ctx, 'u1', 'eggs_hatched', 1);
    track(ctx, 'u1', 'eggs_hatched', 2);
    expect(readStat(ctx, 'u1', 'eggs_hatched')).toBe(3);
    expect(readStats(ctx, 'u1')).toEqual({ eggs_hatched: 3 });
  });
  it('zero or negative delta is a no-op', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    track(ctx, 'u1', 'dinos_fed', 0);
    track(ctx, 'u1', 'dinos_fed', -5);
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(0);
  });
  it('a rolled-back transaction leaves no trace', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    expect(() => ctx.db.transaction(() => {
      track(ctx, 'u1', 'dinos_fed', 1);
      throw new Error('boom');
    })).toThrow('boom');
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(0);
  });
});
