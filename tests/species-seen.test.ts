import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen, seenSpecies, firstSeenAt } from '../src/core/species-seen.js';
import { schema } from '../src/core/db/index.js';
import { incubateEgg, hatchEgg } from '../src/modules/hatchery/service.js';
import { adminGive } from '../src/modules/admin/service.js';
import { createTrade, acceptTrade } from '../src/modules/trading/service.js';
import { TRADE_MIN_RATING } from '../src/data/trade.js';
import { backfillSpeciesSeen } from '../scripts/backfill-species-seen.js';

// recordSpeciesSeen is a pass-through spy by default (calls the real implementation),
// so every test in this file except the rollback test below is unaffected — same
// technique as assetImage in tests/hatchery.test.ts and tests/battles-embeds.test.ts.
// That one test overrides exactly the next call via mockImplementationOnce to make
// the credit itself throw AFTER genuinely writing the row, which is what proves the
// write sits inside the caller's transaction rather than merely being reachable.
vi.mock('../src/core/species-seen.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/species-seen.js')>();
  return { ...actual, recordSpeciesSeen: vi.fn(actual.recordSpeciesSeen) };
});

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

describe('write sites', () => {
  it('hatching credits the species', () => {
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', speciesId: 'triceratops', source: 'shop', obtainedAt: 0 })
      .returning().get();
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    ctx.setNow(ctx.now() + 15 * 60_000);
    const { species } = hatchEgg(ctx, 'u1', egg.id);
    expect(species.id).toBe('triceratops');
    expect(seenSpecies(ctx, 'u1').has(species.id)).toBe(true);
  });

  it('admin give credits the species', () => {
    adminGive(ctx, 'u1', 'Reg', { dinoSpecies: 'triceratops' });
    expect(seenSpecies(ctx, 'u1').has('triceratops')).toBe(true);
  });

  it('a trade credits the RECIPIENT for the dino they receive', () => {
    getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
    const dino = ctx.db.insert(schema.dinos)
      .values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    const trade = createTrade(ctx, 'u1', 'u2',
      { dinoIds: [dino.id], eggIds: [], cash: 0, foods: {} },
      { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    // Only the recipient is credited — the sender already owned (and was presumably
    // already credited for) this species.
    acceptTrade(ctx, 'u2', trade.id);
    expect(seenSpecies(ctx, 'u2').has('triceratops')).toBe(true);
  });

  it('a rolled-back hatch leaves no credit', async () => {
    // hatchEgg's own transaction has no failure path reachable through the public API
    // after the dino insert: the species is resolved and validated before the
    // transaction opens, and track() never throws. So instead of contriving one, this
    // makes the credit itself the failure: recordSpeciesSeen is the LAST statement
    // inside hatchEgg's transaction, which is exactly why throwing from it (after it
    // has genuinely written the row) is the lever that proves PLACEMENT — mocking an
    // earlier statement like track() would mean the credit never ran at all, proving
    // nothing about whether the call sits inside the transaction boundary.
    const { recordSpeciesSeen: realRecordSpeciesSeen } =
      await vi.importActual<typeof import('../src/core/species-seen.js')>('../src/core/species-seen.js');
    vi.mocked(recordSpeciesSeen).mockImplementationOnce((c, u, s) => {
      realRecordSpeciesSeen(c, u, s);   // the row genuinely gets written...
      throw new Error('boom');          // ...then whatever transaction it's inside must roll back
    });
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', speciesId: 'triceratops', source: 'shop', obtainedAt: 0 })
      .returning().get();
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    ctx.setNow(ctx.now() + 15 * 60_000);
    expect(() => hatchEgg(ctx, 'u1', egg.id)).toThrow('boom');
    expect(seenSpecies(ctx, 'u1').size).toBe(0);
  });
});

describe('backfill', () => {
  it('credits every species a player currently owns, dated to the hatch', () => {
    ctx.db.insert(schema.dinos).values([
      { userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 700 },
      { userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 200 },
      { userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 900 },
    ]).run();
    const n = backfillSpeciesSeen(ctx.db);
    expect(n).toBe(2);
    expect(seenSpecies(ctx, 'u1')).toEqual(new Set(['triceratops', 'velociraptor']));
    // The EARLIEST hatch wins, not whichever row the scan happened to see first.
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(200);
  });

  it('is safe to run twice and never overwrites a real credit', () => {
    ctx.setNow(50);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 700,
    }).run();
    backfillSpeciesSeen(ctx.db);
    backfillSpeciesSeen(ctx.db);
    expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(50);
  });
});
