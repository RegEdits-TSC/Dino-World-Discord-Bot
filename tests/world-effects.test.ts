import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { feedCostFor } from '../src/modules/care/service.js';
import { shiftOdds, startExpedition, claimExpedition, expeditionFeeFor, expeditionCashFor } from '../src/modules/expeditions/service.js';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { STARTER_FOOD } from '../src/data/foods.js';

const DAY = 86_400_000;

describe('feed cost under world events', () => {
  it('is unchanged on a calm day', () => {
    expect(feedCostFor('rare', [], 0)).toBe(20);
    expect(feedCostFor('common', [], 0)).toBe(5);
  });

  it('rises 30% during a Heat Wave', () => {
    expect(feedCostFor('rare', [], 5 * DAY)).toBe(26);      // 20 * 1.3
  });

  it('falls 25% during a Cold Snap', () => {
    expect(feedCostFor('rare', [], 8 * DAY)).toBe(15);      // 20 * 0.75
  });

  it('composes with the Thrifty trait inside the never-free floor', () => {
    // common feedCost 5, thrifty 0.75, cold snap 0.75 => 2.8125 -> round 3
    expect(feedCostFor('common', ['thrifty'], 8 * DAY)).toBe(3);
  });

  it('applies the event multiplier before rounding, not after the floor', () => {
    // common feedCost 5 * heat wave 1.3 = 6.5 -> round 7. Rounding the trait
    // product first (5 -> 5) and multiplying the event factor in afterward
    // would yield 5 * 1.3 = 6.5, a non-integer food cost — proof the two
    // orderings genuinely diverge, unlike the Thrifty/Cold-Snap case above.
    expect(feedCostFor('common', [], 5 * DAY)).toBe(7);
  });

  it('never returns less than one unit', () => {
    expect(feedCostFor('common', ['thrifty'], 8 * DAY)).toBeGreaterThanOrEqual(1);
  });
});

describe('expedition odds shifting', () => {
  it('is identity at step 0', () => {
    const odds = [{ rarity: 'rare' as const, weight: 40 }, { rarity: 'epic' as const, weight: 60 }];
    expect(shiftOdds(odds, 0)).toEqual(odds);
  });

  it('moves every entry one rarity down and merges collisions', () => {
    // rare+epic shifted down => uncommon+rare, no merge
    expect(shiftOdds([{ rarity: 'rare', weight: 40 }, { rarity: 'epic', weight: 60 }], -1))
      .toEqual([{ rarity: 'uncommon', weight: 40 }, { rarity: 'rare', weight: 60 }]);
  });

  it('floors at common and merges what piles up there', () => {
    expect(shiftOdds([{ rarity: 'common', weight: 70 }, { rarity: 'uncommon', weight: 30 }], -1))
      .toEqual([{ rarity: 'common', weight: 100 }]);
  });

  it('preserves total weight for every site at every step', async () => {
    const { EXPEDITION_SITES } = await import('../src/data/sites.js');
    for (const site of Object.values(EXPEDITION_SITES)) {
      const before = site.eggOdds.reduce((s, o) => s + o.weight, 0);
      for (const step of [-1, 0, 1] as const) {
        const after = shiftOdds(site.eggOdds, step).reduce((s, o) => s + o.weight, 0);
        expect(after, `${site.id} step ${step}`).toBeCloseTo(before, 6);
      }
    }
  });
});

describe('expedition fee/cash rounding is round-with-floor, not ceil or floor', () => {
  // No shipped world event produces a fractional expeditionFee or
  // expeditionCash today — WORLD_EVENTS only ever sets expeditionFee to 1 or 2,
  // and expeditionCash's one nonneutral value (fossil_rush, 1.5) applied to an
  // integer roll can only ever land on a .0 or .5 fraction, where Math.round
  // and Math.ceil always agree. So the real request pipeline can prove the fee
  // is "not ceil" (Math.ceil(200 * 2) === 400 === Math.round(...), no shipped
  // fee multiplier is fractional) but can never honestly prove "not floor" for
  // cash, or pin the fee's round-vs-ceil distinction with anything other than
  // a fabricated event. Per review, these call the two exported pure helpers
  // directly with a synthetic fractional multiplier instead — the real
  // production expression, not a fake event.

  it('expeditionFeeFor rounds, rather than always rounding up (not Math.ceil)', () => {
    // 200 * 1.1 === 220.00000000000003 (float artifact). Math.round -> 220;
    // Math.ceil -> 221. This is the reviewer's own repro of the original bug.
    expect(expeditionFeeFor(200, 1.1)).toBe(220);
  });

  it('expeditionFeeFor rounds, rather than always rounding down (not Math.floor)', () => {
    // 10 * 1.26 = 12.6. Math.round -> 13; Math.floor -> 12.
    expect(expeditionFeeFor(10, 1.26)).toBe(13);
  });

  it('expeditionFeeFor floors at 1 cash so a steep discount cannot reach 0', () => {
    // 200 * 0.001 = 0.2 -> Math.round alone gives 0; Math.max(1, ...) lifts it to 1.
    expect(expeditionFeeFor(200, 0.001)).toBe(1);
  });

  it('expeditionCashFor rounds, rather than always rounding up (not Math.ceil)', () => {
    expect(expeditionCashFor(200, 1.1)).toBe(220);
  });

  it('expeditionCashFor rounds, rather than always rounding down (not Math.floor)', () => {
    expect(expeditionCashFor(10, 1.26)).toBe(13);
  });
});

describe('expeditions under world events', () => {
  // Local seeding helper, mirroring tests/expeditions.test.ts's beforeEach —
  // there is no shared seedPark helper in the harness.
  function seed(ctx: ReturnType<typeof makeCtx>) {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0);
  }
  const cashOf = (ctx: ReturnType<typeof makeCtx>) =>
    ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash;

  it('changes nothing on a calm day', () => {
    const ctx = makeCtx({ nowMs: 0 });
    seed(ctx);
    const exp = startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    expect(exp.returnsAt).toBe(ctx.now() + 15 * 60_000);
    // Mirrors tests/expeditions.test.ts:30-31 — 500 starting + 50,000 seed - 200 cost.
    expect(cashOf(ctx)).toBe(500 + 50_000 - 200);
  });

  it('shortens the dig and doubles the fee during an Amber Storm', () => {
    const ctx = makeCtx({ nowMs: 10 * DAY });   // day 10 is amber_storm (world.test.ts:37)
    seed(ctx);
    const exp = startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    expect(exp.returnsAt).toBe(ctx.now() + Math.round(15 * 60_000 * 0.75));
    expect(cashOf(ctx)).toBe(500 + 50_000 - 400);   // 200 * 2 (doubled fee)
  });

  it('leaves the returnsAt timer alone even if the event ends mid-flight', () => {
    // Depart 5 minutes before day 10 (amber_storm) rolls into day 11
    // (clear_skies — verified via worldEventFor, not assumed). The shortened
    // (x0.75) returnsAt lands 6.25 minutes INTO day 11, a day whose own mods
    // would give the full, unshortened duration. If returnsAt were ever
    // recomputed live against claim-time mods instead of the value frozen at
    // start, day 11's neutral expeditionMs would push the deadline later and
    // wrongly reject a claim that has, in reality, already returned.
    const start = 11 * DAY - 5 * 60_000;
    const ctx = makeCtx({ nowMs: start });
    seed(ctx);
    const exp = startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    const frozenReturnsAt = start + Math.round(15 * 60_000 * 0.75);
    expect(exp.returnsAt).toBe(frozenReturnsAt);
    expect(Math.floor(frozenReturnsAt / DAY)).toBe(11);   // confirms the day-boundary crossing
    ctx.setNow(frozenReturnsAt);
    const { loot } = claimExpedition(ctx, 'u1');
    expect(loot).toBeDefined();
  });

  it('pays 50% more cash and shifts egg odds one step down during a Fossil Rush', () => {
    // day 14 is fossil_rush: expeditionCash x1.5, expeditionOddsShift -1
    // (world.test.ts:38). coastal_dig's odds are common:70/uncommon:30 — shifted
    // down one step that collapses to 100% common (see the shiftOdds tests
    // above), so the egg rarity is deterministic regardless of the rng draw.
    const ctx = makeCtx({ nowMs: 14 * DAY });
    seed(ctx);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 15 * 60_000);
    const cashBefore = cashOf(ctx);
    const { loot } = claimExpedition(ctx, 'u1');
    expect(loot.eggRarity).toBe('common');
    // Seeded rng (mulberry32(42)): eggRarity draw -> lootDiet draw -> raw
    // bonusCash roll of 178, scaled 178 * 1.5 = 267.
    expect(loot.cash).toBe(267);
    expect(cashOf(ctx) - cashBefore).toBe(267);
    expect(ctx.economy.getFoodInventory('u1')[loot.food.foodId])
      .toBe((STARTER_FOOD[loot.food.foodId] ?? 0) + loot.food.qty);
  });
});
