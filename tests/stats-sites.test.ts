import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot, upgradeLot, collectIncome } from '../src/modules/park/service.js';
import { feedDino, feedAll, rescueDino, CareError } from '../src/modules/care/service.js';
import { incubateEgg, hatchEgg } from '../src/modules/hatchery/service.js';
import { startExpedition, claimExpedition, ExpeditionError } from '../src/modules/expeditions/service.js';
import { readStat } from '../src/core/stats.js';
import { PADDOCKS } from '../src/data/paddocks.js';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { foods: { ferns: 1_000 } }, 'seed', 0);
});

const addDino = (over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();

describe('feedDino stat tracking', () => {
  it('counts dinos_fed once for a hungry dino', () => {
    const d = addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(24 * H);                      // hunger has drained below 100 by now
    feedDino(ctx, 'u1', d.id);
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(1);
  });

  it('does not count re-feeding an already-full dino (anti-farm)', () => {
    const d = addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(24 * H);
    feedDino(ctx, 'u1', d.id);
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(1);
    // Same instant as the feed above: settled hunger is exactly 100 (no time has
    // passed since lastFedAt), so the second feed must not count.
    feedDino(ctx, 'u1', d.id);
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(1);
  });

  // This throws on the pre-transaction "no matching food" guard (before ctx.db.transaction
  // is ever entered), so it only proves the guard runs before any counter write — not
  // rollback. Rollback itself is proven at the substrate level by "a rolled-back
  // transaction leaves no trace" in tests/stats.test.ts.
  it('counts nothing when the feed is rejected before its transaction (no matching food)', () => {
    const d = addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(24 * H);
    ctx.db.delete(schema.foodInventory).run();
    expect(() => feedDino(ctx, 'u1', d.id)).toThrow(CareError);
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(0);
  });
});

describe('feedAll stat tracking', () => {
  it('counts dinos_fed +2 for two hungry dinos', () => {
    addDino({ hunger: 100, lastFedAt: 0 });
    addDino({ hunger: 100, lastFedAt: 0 });
    ctx.setNow(48 * H);
    feedAll(ctx, 'u1');
    expect(readStat(ctx, 'u1', 'dinos_fed')).toBe(2);
  });
});

describe('rescueDino stat tracking', () => {
  it('counts dinos_rescued once', () => {
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops',
      hunger: 0, lastFedAt: 0, hatchedAt: 0, escapedAt: 40 * H,
    }).returning().get();
    rescueDino(ctx, 'u1', d.id);
    expect(readStat(ctx, 'u1', 'dinos_rescued')).toBe(1);
  });
});

describe('collectIncome stat tracking', () => {
  it('counts income_collected += amount and income_collections += 1 when income is pending', () => {
    ctx.economy.apply('u1', { cash: 2_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops',
      hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    ctx.db.update(schema.lots).set({ decor: ['palm_tree'] }).run();
    ctx.setNow(12 * H);
    const { amount } = collectIncome(ctx, 'u1');
    expect(amount).toBe(440);
    expect(readStat(ctx, 'u1', 'income_collected')).toBe(440);
    expect(readStat(ctx, 'u1', 'income_collections')).toBe(1);
  });

  it('leaves both stats unchanged when nothing is pending', () => {
    const { amount } = collectIncome(ctx, 'u1');   // fresh user, nothing accrued
    expect(amount).toBe(0);
    expect(readStat(ctx, 'u1', 'income_collected')).toBe(0);
    expect(readStat(ctx, 'u1', 'income_collections')).toBe(0);
  });
});

describe('buildLot / upgradeLot stat tracking', () => {
  it('counts lots_built once', () => {
    ctx.economy.apply('u1', { cash: 20_000 }, 'seed', 0);
    buildLot(ctx, 'u1', 'herbivore_paddock');
    expect(readStat(ctx, 'u1', 'lots_built')).toBe(1);
  });

  it('counts lots_upgraded once', () => {
    ctx.economy.apply('u1', { cash: 1_000_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    upgradeLot(ctx, 'u1', lot.id);
    expect(readStat(ctx, 'u1', 'lots_upgraded')).toBe(1);
  });
});

describe('hatchery stat tracking', () => {
  const addEgg = (rarity: string) =>
    ctx.db.insert(schema.eggs).values({
      userId: 'u1', rarity: rarity as never, source: 'expedition', obtainedAt: 0,
    }).returning().get();

  it('counts eggs_incubated once', () => {
    const egg = addEgg('common');
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    expect(readStat(ctx, 'u1', 'eggs_incubated')).toBe(1);
  });

  it('counts eggs_hatched once', () => {
    const egg = addEgg('common');
    incubateEgg(ctx, 'u1', egg.id, 'g1');
    ctx.setNow(ctx.now() + 15 * 60_000);
    hatchEgg(ctx, 'u1', egg.id);
    expect(readStat(ctx, 'u1', 'eggs_hatched')).toBe(1);
  });
});

describe('claimExpedition stat tracking', () => {
  it('counts expeditions_claimed once after the expedition has returned', () => {
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);
    claimExpedition(ctx, 'u1');
    expect(readStat(ctx, 'u1', 'expeditions_claimed')).toBe(1);
  });

  // This throws on the pre-transaction "not returned yet" guard (nine lines before the
  // transaction), so it only proves the guard runs before any counter write — not
  // rollback. Rollback itself is proven at the substrate level by "a rolled-back
  // transaction leaves no trace" in tests/stats.test.ts.
  it('counts nothing when claiming an un-returned expedition is rejected before its transaction', () => {
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    expect(() => claimExpedition(ctx, 'u1')).toThrow(ExpeditionError);
    expect(readStat(ctx, 'u1', 'expeditions_claimed')).toBe(0);
  });
});
