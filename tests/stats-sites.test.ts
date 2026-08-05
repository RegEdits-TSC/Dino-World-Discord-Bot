import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot, upgradeLot, collectIncome } from '../src/modules/park/service.js';
import { feedDino, feedAll, rescueDino, CareError } from '../src/modules/care/service.js';
import { incubateEgg, hatchEgg } from '../src/modules/hatchery/service.js';
import { startExpedition, claimExpedition, ExpeditionError } from '../src/modules/expeditions/service.js';
import { runFight } from '../src/modules/battles/service.js';
import { createTrade, acceptTrade } from '../src/modules/trading/service.js';
import { buyEgg, buyFood } from '../src/modules/shop/service.js';
import { buyMythicEgg, sellDino } from '../src/modules/shop/shards.js';
import { startBreeding, claimBreeding, spliceDino } from '../src/modules/genelab/service.js';
import { readStat } from '../src/core/stats.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { TRADE_MIN_RATING } from '../src/data/trade.js';
import { MYTHIC_UNLOCK_RATING } from '../src/data/progression.js';

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

describe('runFight stat tracking', () => {
  const CH1 = ['coastal_dig_1', 'coastal_dig_2', 'coastal_dig_3', 'coastal_dig_4'];
  function clearThrough(stageIds: string[]): void {
    for (const stageId of stageIds) ctx.db.insert(schema.battleProgress).values({
      userId: 'u1', stageId, stars: 3, firstClearedAt: 1, attempts: 1,
    }).run();
  }

  it('a loss counts battles_fought but neither battles_won nor stages_first_cleared', () => {
    clearThrough(CH1);
    // Solo compsognathus vs the boss roster (2.5x HP, 1.2x atk) is a guaranteed loss —
    // same seed as tests/battle-service.test.ts's "runFight — loss" case.
    const d = addDino({ speciesId: 'compsognathus' });
    const out = runFight(ctx, 'u1', 'coastal_dig_boss', [d.id]);
    expect(out.won).toBe(false);
    expect(readStat(ctx, 'u1', 'battles_fought')).toBe(1);
    expect(readStat(ctx, 'u1', 'battles_won')).toBe(0);
    expect(readStat(ctx, 'u1', 'stages_first_cleared')).toBe(0);
  });

  it('a first-clear win counts battles_fought, battles_won, and stages_first_cleared', () => {
    // Level-10 tyrannosaurus solo vs a stage-1 roster is a guaranteed win.
    const d = addDino({ speciesId: 'tyrannosaurus', battleXp: 999_999 });
    const out = runFight(ctx, 'u1', 'coastal_dig_1', [d.id]);
    expect(out.won).toBe(true);
    expect(out.firstClear).toBe(true);
    expect(readStat(ctx, 'u1', 'battles_fought')).toBe(1);
    expect(readStat(ctx, 'u1', 'battles_won')).toBe(1);
    expect(readStat(ctx, 'u1', 'stages_first_cleared')).toBe(1);
  });

  it('replaying an already-cleared stage keeps stages_first_cleared at 1', () => {
    const d = addDino({ speciesId: 'tyrannosaurus', battleXp: 999_999 });
    runFight(ctx, 'u1', 'coastal_dig_1', [d.id]);
    const again = runFight(ctx, 'u1', 'coastal_dig_1', [d.id]);
    expect(again.won).toBe(true);
    expect(again.firstClear).toBe(false);
    expect(readStat(ctx, 'u1', 'battles_fought')).toBe(2);
    expect(readStat(ctx, 'u1', 'battles_won')).toBe(2);
    expect(readStat(ctx, 'u1', 'stages_first_cleared')).toBe(1);
  });
});

describe('acceptTrade stat tracking', () => {
  const emptySide = { dinoIds: [] as number[], eggIds: [] as number[], cash: 0, foods: {} as Record<string, number> };

  it('counts trades_completed for both fromUser and toUser when a dino actually moves', () => {
    getOrCreateUser(ctx, 'u2', 'Two');
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();   // both at 4★ so the gate passes
    const d = addDino();
    const t = createTrade(ctx, 'u1', 'u2', { ...emptySide, dinoIds: [d.id] }, emptySide);
    acceptTrade(ctx, 'u2', t.id);
    expect(readStat(ctx, 'u1', 'trades_completed')).toBe(1);
    expect(readStat(ctx, 'u2', 'trades_completed')).toBe(1);
  });

  it('does not count an empty-for-empty trade (anti-farm)', () => {
    getOrCreateUser(ctx, 'u2', 'Two');
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
    // createTrade's own validation would accept this too (no minimum content is
    // enforced at creation), so insert the pending row directly — the point is
    // that acceptTrade itself must not credit a trade that moves nothing.
    const t = ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2', offer: emptySide, request: emptySide,
      status: 'pending', createdAt: ctx.now(),
    }).returning().get();
    acceptTrade(ctx, 'u2', t.id);
    expect(readStat(ctx, 'u1', 'trades_completed')).toBe(0);
    expect(readStat(ctx, 'u2', 'trades_completed')).toBe(0);
  });
});

describe('shop stat tracking', () => {
  it('buyEgg counts shop_purchases once', () => {
    buyEgg(ctx, 'u1', 'common');
    expect(readStat(ctx, 'u1', 'shop_purchases')).toBe(1);
  });

  it('buyFood counts shop_purchases once regardless of units bought', () => {
    buyFood(ctx, 'u1', 'fish', 5);
    expect(readStat(ctx, 'u1', 'shop_purchases')).toBe(1);
  });

  it('buyMythicEgg counts shop_purchases once', () => {
    ctx.db.update(schema.users).set({ ratingHighWater: MYTHIC_UNLOCK_RATING, shards: 500 })
      .where(eq(schema.users.discordId, 'u1')).run();
    buyMythicEgg(ctx, 'u1', 'indoraptor');
    expect(readStat(ctx, 'u1', 'shop_purchases')).toBe(1);
  });

  it('sellDino counts dinos_sold once', () => {
    const d = addDino({ speciesId: 'velociraptor' });
    sellDino(ctx, 'u1', d.id);
    expect(readStat(ctx, 'u1', 'dinos_sold')).toBe(1);
  });
});

describe('gene lab stat tracking', () => {
  function labSetup() {
    ctx.economy.apply('u1', { cash: 500_000 }, 'seed', 0);
    buildLot(ctx, 'u1', 'gene_lab');
    return buildLot(ctx, 'u1', 'herbivore_paddock');
  }

  it('a /breed start preview (dryRun) does not count breedings_started', () => {
    const lot = labSetup();
    const a = addDino({ lotId: lot.id });
    const b = addDino({ speciesId: 'gallimimus', lotId: lot.id });
    startBreeding(ctx, 'u1', a.id, b.id, null, { dryRun: true });
    expect(readStat(ctx, 'u1', 'breedings_started')).toBe(0);
  });

  it('a real startBreeding counts breedings_started once', () => {
    const lot = labSetup();
    const a = addDino({ lotId: lot.id });
    const b = addDino({ speciesId: 'gallimimus', lotId: lot.id });
    startBreeding(ctx, 'u1', a.id, b.id, null);
    expect(readStat(ctx, 'u1', 'breedings_started')).toBe(1);
  });

  it('claimBreeding counts breedings_claimed once', () => {
    const lot = labSetup();
    const a = addDino({ lotId: lot.id });
    const b = addDino({ speciesId: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    claimBreeding(ctx, 'u1', br.id);
    expect(readStat(ctx, 'u1', 'breedings_claimed')).toBe(1);
  });

  it('spliceDino counts splices_done once', () => {
    ctx.economy.apply('u1', { shards: 100 }, 'seed', 0);
    const d = addDino({ traits: ['prolific', 'savage'] });
    spliceDino(ctx, 'u1', d.id, 0);
    expect(readStat(ctx, 'u1', 'splices_done')).toBe(1);
  });
});
