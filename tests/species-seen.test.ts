import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen, seenSpecies, firstSeenAt } from '../src/core/species-seen.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

describe('species-seen record', () => {
  it('records a species and reads it back', () => {
    ctx.setNow(500);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(seenSpecies(ctx, 'u1')).toEqual(new Set(['triceratops']));
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(500);
  });
  it('keeps the FIRST instant when the same species returns', () => {
    ctx.setNow(500);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    ctx.setNow(9_000);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(500);
  });
  it('is per user', () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(seenSpecies(ctx, 'u2').size).toBe(0);
  });
  it('reads an empty set for a player who has seen nothing', () => {
    expect(seenSpecies(ctx, 'u1')).toEqual(new Set());
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBeNull();
  });
});
