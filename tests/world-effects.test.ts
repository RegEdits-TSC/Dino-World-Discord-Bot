import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { feedCostFor } from '../src/modules/care/service.js';
import { shiftOdds, startExpedition, claimExpedition, expeditionFeeFor, expeditionCashFor } from '../src/modules/expeditions/service.js';
import { makeCtx, fakeAutocomplete, fakeCommand, mulberry32 } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { decorateLot } from '../src/modules/park/dinos.js';
import { recomputeRating } from '../src/modules/park/rating.js';
import { startBreeding, claimBreeding, breedCooldowns } from '../src/modules/genelab/service.js';
import { schema } from '../src/core/db/index.js';
import { STARTER_FOOD, FOODS } from '../src/data/foods.js';
import { BREED_MS, BREED_COOLDOWN_MS } from '../src/data/breeding.js';
import { runFight, energyCostFor, BattleError } from '../src/modules/battles/service.js';
import { chaptersPayload, type ChaptersView } from '../src/modules/battles/embeds.js';
import { battlesModule } from '../src/modules/battles/index.js';
import { CAMPAIGN } from '../src/data/battle/chapters/index.js';
import { hatchEgg } from '../src/modules/hatchery/service.js';
import { buyEgg, buyFood, eggPriceAt, foodPriceAt, roundCharge, todaysDeal } from '../src/modules/shop/service.js';
import { sellDino, previewSell, sellCashAt, roundPayout } from '../src/modules/shop/shards.js';
import { shopModule } from '../src/modules/shop/index.js';
import { SHOP_EGG_PRICES, DEAL_EGG_DISCOUNT, DEAL_FOOD_DISCOUNT } from '../src/data/shop.js';
import { SELL_CASH } from '../src/data/sell.js';
import { WORLD_EVENTS } from '../src/data/world-events.js';
import { worldEventFor } from '../src/core/world.js';

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

describe('breeding time under world events', () => {
  // Local seeding helpers, mirroring tests/genelab.test.ts's `park`/`dino` —
  // there is no shared seedPark helper in the harness.
  function park(ctx: ReturnType<typeof makeCtx>, id = 'u1') {
    getOrCreateUser(ctx, id, id);
    ctx.economy.apply(id, { cash: 500_000 }, 'test', 0);
    buildLot(ctx, id, 'gene_lab');
    buildLot(ctx, id, 'herbivore_paddock');
    return ctx.db.select().from(schema.lots).all().find((l) => l.kind === 'herbivore_paddock')!;
  }
  function dino(ctx: ReturnType<typeof makeCtx>, opts: Partial<{ species: string; lotId: number; traits: string[] }> = {}) {
    // lastFedAt/hatchedAt anchor to ctx.now(), not 0 — these tests run on day 27,
    // and a dino "fed" at epoch 0 would already have drained under the hunger
    // gate by then (see tests/genelab.test.ts's own drain test at 30h elapsed).
    return ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: opts.species ?? 'triceratops', lotId: opts.lotId ?? null,
      hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      traits: opts.traits ?? [],
    }).returning().get();
  }

  it('is the base time on a calm day', () => {
    const ctx = makeCtx({ nowMs: 0 });   // day 0 is calm (world.ts:12)
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    expect(startBreeding(ctx, 'u1', a.id, b.id, null).readyAt).toBe(ctx.now() + BREED_MS.common);
  });

  it('runs 25% longer during Migration Season', () => {
    const ctx = makeCtx({ nowMs: 27 * DAY });   // day 27 is migration_season (world.test.ts:40)
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    expect(startBreeding(ctx, 'u1', a.id, b.id, null).readyAt)
      .toBe(ctx.now() + Math.round(BREED_MS.common * 1.25));
  });

  it('composes with Fertile, which still shortens it', () => {
    const ctx = makeCtx({ nowMs: 27 * DAY });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id, traits: ['fertile'] });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    expect(startBreeding(ctx, 'u1', a.id, b.id, null).readyAt)
      .toBe(ctx.now() + Math.round(BREED_MS.common * 0.75 * 1.25));
  });

  it('quotes the same number in the dry-run preview as it commits', () => {
    const ctx = makeCtx({ nowMs: 27 * DAY });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const preview = startBreeding(ctx, 'u1', a.id, b.id, null, { dryRun: true });
    const committed = startBreeding(ctx, 'u1', a.id, b.id, null);
    expect(committed.readyAt).toBe(preview.readyAt);
  });

  it('leaves the post-claim cooldown at the un-shortened rarity time, unaffected by the event', () => {
    // Migration Season lengthens the wait TO the egg, not the wait BETWEEN
    // pairings — breedCooldowns must read BREED_COOLDOWN_MS straight, with no
    // event factor applied.
    const ctx = makeCtx({ nowMs: 27 * DAY });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    claimBreeding(ctx, 'u1', br.id);
    const cd = breedCooldowns(ctx, 'u1');
    expect(cd.get(a.id)).toBe(br.readyAt + BREED_COOLDOWN_MS.common);
    expect(cd.get(b.id)).toBe(br.readyAt + BREED_COOLDOWN_MS.common);
  });
});

describe('battles under world events', () => {
  const CH1 = ['coastal_dig_1', 'coastal_dig_2', 'coastal_dig_3', 'coastal_dig_4'];
  const XP_MAX = 999_999;

  function addDino(ctx: ReturnType<typeof makeCtx>, userId: string, speciesId: string, battleXp = 0): number {
    return ctx.db.insert(schema.dinos).values({
      userId, speciesId, hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(), battleXp,
    }).returning().get().id;
  }
  function clearThrough(ctx: ReturnType<typeof makeCtx>, userId: string, stageIds: string[]): void {
    for (const stageId of stageIds) ctx.db.insert(schema.battleProgress).values({
      userId, stageId, stars: 3, firstClearedAt: 1, attempts: 1,
    }).run();
  }
  // Mirrors battles-autocomplete.test.ts's "fully unlocked player" fixture:
  // every stage in every chapter gets a 1-star clear, and rating high-water
  // clears every chapter's own site-rating co-gate.
  function unlockEverything(ctx: ReturnType<typeof makeCtx>, userId: string): void {
    ctx.db.update(schema.users).set({ ratingHighWater: 1000 }).where(eq(schema.users.discordId, userId)).run();
    for (const ch of CAMPAIGN) {
      for (const s of ch.stages) {
        ctx.db.insert(schema.battleProgress).values({ userId, stageId: s.id, stars: 1, firstClearedAt: 1, attempts: 1 }).run();
      }
    }
  }
  const userRow = (ctx: ReturnType<typeof makeCtx>, userId: string) =>
    ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!;

  describe('energyCostFor', () => {
    it('costs the declared energy on a calm day', () => {
      expect(energyCostFor(3, 0)).toBe(3);
      expect(energyCostFor(1, 0)).toBe(1);
    });

    it('costs one less during a Blood Moon, floored at 1', () => {
      expect(energyCostFor(3, 7 * DAY)).toBe(2);     // boss
      expect(energyCostFor(2, 7 * DAY)).toBe(1);     // stage 4
      expect(energyCostFor(1, 7 * DAY)).toBe(1);     // already at the floor
    });
  });

  describe('runFight — energy gate and debit agree on the Blood Moon-adjusted cost', () => {
    it('a squad with exactly the adjusted cost can fight, and is charged exactly that much', () => {
      // coastal_dig_boss declares energyCost 3; day 7 is blood_moon, so the
      // adjusted cost is 2 (energyCostFor tests above). Funding the user with
      // exactly 2 — one short of the DECLARED cost — proves the gate reads the
      // adjusted number, not stage.energyCost directly. If the debit below
      // used the declared 3 instead of the same local, energyAfter would be
      // -1, not 0.
      const ctx = makeCtx({ nowMs: 7 * DAY });
      getOrCreateUser(ctx, 'p', 'P');
      clearThrough(ctx, 'p', CH1);
      ctx.db.update(schema.users).set({ energy: 2, energyUpdatedAt: 7 * DAY })
        .where(eq(schema.users.discordId, 'p')).run();
      const d = addDino(ctx, 'p', 'compsognathus');
      const out = runFight(ctx, 'p', 'coastal_dig_boss', [d]);
      expect(out.energyAfter).toBe(0);
      expect(userRow(ctx, 'p').energy).toBe(0);
    });

    it('one energy short of the adjusted cost still throws, even during Blood Moon', () => {
      const ctx = makeCtx({ nowMs: 7 * DAY });
      getOrCreateUser(ctx, 'p', 'P');
      clearThrough(ctx, 'p', CH1);
      ctx.db.update(schema.users).set({ energy: 1, energyUpdatedAt: 7 * DAY })
        .where(eq(schema.users.discordId, 'p')).run();
      const d = addDino(ctx, 'p', 'compsognathus');
      expect(() => runFight(ctx, 'p', 'coastal_dig_boss', [d])).toThrow(BattleError);
      expect(() => runFight(ctx, 'p', 'coastal_dig_boss', [d])).toThrow(/need ⚡2, have ⚡1/);
      expect(userRow(ctx, 'p').energy).toBe(1);   // rejected before any debit
    });
  });

  describe('runFight — enemy HP scales with the world, ATK never does', () => {
    it('a knife-edge fight keeps its margin on a Blood Moon day — proof ATK is not silently scaled too', () => {
      // coastal_dig_1 pits a solo compsognathus against rosterFor's first
      // enemy — itself a level-1 compsognathus (coastal_dig_1's roster is
      // [compsognathus, struthiomimus, gallimimus], weakest-first; squadSize 1
      // takes just the first). A mirror match at fixed level/traits is exactly
      // reproducible from mulberry32(42), and — verified empirically by
      // temporarily reintroducing the exact bug this guards against (folding
      // `* mods.enemyHp` into the npc atk expression, the plausible
      // copy-paste of the hp line) — it is close enough that a stray +15%
      // enemy atk flips the outcome outright: the squad's narrow win on
      // Blood Moon (1 hp to spare) becomes a loss (rounds 6->5, stars 3->0,
      // finalHp.d1 1->0) the instant atk picks up enemyHp. It does not today:
      //   calm (day 0):        won, rounds 5, finalHp { d1: 10, n0: 0 }
      //   blood_moon (day 7):  won, rounds 6, finalHp { d1: 1,  n0: 0 }
      // The extra round and the far tighter margin on day 7 are the enemy's
      // hp scaling (x1.15) making the mirror match harder, exactly as
      // intended — while the squad's own dino, whose stats no event mod
      // touches, still scrapes a win specifically because the enemy's atk
      // did NOT also move.
      const runOn = (nowMs: number) => {
        const ctx = makeCtx({ nowMs });
        getOrCreateUser(ctx, 'p', 'P');
        const d = addDino(ctx, 'p', 'compsognathus');
        return runFight(ctx, 'p', 'coastal_dig_1', [d]);
      };
      const calm = runOn(0);
      const bloodMoon = runOn(7 * DAY);
      expect(calm.won).toBe(true);
      expect(calm.stars).toBe(3);
      expect(calm.result.rounds).toBe(5);
      expect(calm.result.finalHp).toEqual({ d1: 10, n0: 0 });
      expect(bloodMoon.won).toBe(true);
      expect(bloodMoon.stars).toBe(3);
      expect(bloodMoon.result.rounds).toBe(6);
      expect(bloodMoon.result.finalHp).toEqual({ d1: 1, n0: 0 });
    });

    it('enemy maxHp and hp both scale by x1.15 on a Blood Moon day, at a genuinely fractional pre-round value', () => {
      // Isolates the formula from combat noise: containment_site_boss (Asset
      // 47, legendary/bruiser, effective level 12, hpMult 2.15, atkMult 1.2)
      // fielded 1v1 against a solo level-1 compsognathus. Asset 47's spd vastly
      // exceeds compsognathus's, so it acts first, and its atk (unaffected by
      // any event) is so far past compsognathus's 51 hp that even the WORST
      // possible damage roll (minimum variance, no crit) one-shots it before
      // compsognathus ever gets a turn. The boss therefore takes zero damage
      // over the whole fight, so its post-fight hp equals its untouched max —
      // both fields fed by the same local (hazard #3), so reading hp back
      // through the public API is enough to pin maxHp too.
      //   base stats: statsFor('spinoraptor', 12).hp = floor(265*1.0*1.88) = 498
      //   calm:       round(498 * 2.15)        = round(1070.7)   = 1071  (frac .7  -> not floor, floor would give 1070)
      //   blood_moon: round(498 * 2.15 * 1.15) = round(1231.305) = 1231  (frac .305 -> not ceil,  ceil would give 1232)
      const runOn = (nowMs: number) => {
        const ctx = makeCtx({ nowMs });
        getOrCreateUser(ctx, 'p', 'P');
        unlockEverything(ctx, 'p');
        const d = addDino(ctx, 'p', 'compsognathus');
        return runFight(ctx, 'p', 'containment_site_boss', [d]);
      };
      const calm = runOn(0);
      const bloodMoon = runOn(7 * DAY);
      // Both runs: compsognathus is one-shot before it ever acts.
      expect(calm.won).toBe(false);
      expect(calm.result.rounds).toBe(1);
      expect(calm.result.squadKos).toBe(1);
      expect(calm.result.finalHp.d1).toBe(0);
      expect(bloodMoon.result.rounds).toBe(1);
      expect(bloodMoon.result.finalHp.d1).toBe(0);
      // The boss's untouched final hp IS its scaled max hp.
      expect(calm.result.finalHp.n0).toBe(1071);
      expect(bloodMoon.result.finalHp.n0).toBe(1231);
    });
  });

  describe('runFight — battle XP scales the total before the floor-split', () => {
    it('scales the pool x1.5 on a Blood Moon day, and the floor-split remainder still goes to slot 1', () => {
      // Same fixture as tests/battle-service.test.ts's "squad XP splits
      // floor-even" test (heavies() vs coastal_dig_2, guaranteed 3 stars),
      // run on day 7 instead of a calm day.
      //   totalXp = round(35 * 1.5 * 1.5) = round(78.75) = 79   (frac .75 -> not floor, floor would give 78 and [26,26,26])
      //   baseXp = floor(79 / 3) = 26, remainder = 79 % 3 = 1 -> slot 1 gets 26 + 1
      const ctx = makeCtx({ nowMs: 7 * DAY });
      getOrCreateUser(ctx, 'p', 'P');
      clearThrough(ctx, 'p', ['coastal_dig_1']);
      const squad = [
        addDino(ctx, 'p', 'tyrannosaurus', XP_MAX),
        addDino(ctx, 'p', 'giganotosaurus', XP_MAX),
        addDino(ctx, 'p', 'spinosaurus', XP_MAX),
      ];
      const out = runFight(ctx, 'p', 'coastal_dig_2', squad);
      expect(out.won).toBe(true);
      expect(out.stars).toBe(3);
      const totalXp = out.rewards.xpPerDino.reduce((s, x) => s + x, 0);
      expect(totalXp).toBe(79);
      expect(totalXp % 3).toBe(1);   // still a genuine remainder under the scaled total, not swallowed by scaling
      expect(out.rewards.xpPerDino).toEqual([27, 26, 26]);
    });
  });

  describe('the chapters embed and the stage autocomplete both quote the Blood Moon-adjusted cost', () => {
    const baseView = (over: Partial<ChaptersView> = {}): ChaptersView => ({
      progress: new Map(), ratingHighWater: 0, energy: 10, energyUpdatedAtMs: 0, ...over,
    });

    it('chaptersPayload shows the adjusted cost, not the declared one', () => {
      const p = chaptersPayload('u1', 0, baseView({ now: 7 * DAY }));
      const stages = p.embeds[0].toJSON().fields!.find((f) => f.name === 'Stages')!.value.split('\n');
      expect(stages[3]).toContain('(⚡1)');     // coastal_dig_4 declares 2, adjusted to 1
      expect(stages[3]).not.toContain('(⚡2)');
      expect(stages[4]).toContain('(⚡2)');     // boss declares 3, adjusted to 2
      expect(stages[4]).not.toContain('(⚡3)');
    });

    it('chaptersPayload shows the declared cost on a calm day (default `now`)', () => {
      const p = chaptersPayload('u1', 0, baseView());
      const stages = p.embeds[0].toJSON().fields!.find((f) => f.name === 'Stages')!.value.split('\n');
      expect(stages[3]).toContain('(⚡2)');
      expect(stages[4]).toContain('(⚡3)');
    });

    it('the stage autocomplete shows the adjusted cost for both open and locked entries', async () => {
      const ctx = makeCtx({ nowMs: 7 * DAY });
      getOrCreateUser(ctx, 'u1', 'u1');
      const battleCmd = battlesModule.commands[0];
      const fake = fakeAutocomplete({ name: 'battle', sub: 'fight', user: 'u1', focused: { name: 'stage', value: '' } });
      await battleCmd.autocomplete!(ctx, fake.asAutocomplete());
      const choices = fake.replies[0] as { name: string; value: string }[];
      const stage4 = choices.find((c) => c.value === 'coastal_dig_4')!;    // locked, declared 2
      const boss = choices.find((c) => c.value === 'coastal_dig_boss')!;   // locked, declared 3
      expect(stage4.name).toContain('(⚡1)');
      expect(boss.name).toContain('(⚡2)');
    });
  });
});

describe('wild hatch trait odds under world events', () => {
  // Every user gets exactly one dino, so recomputeRating (called inside hatchEgg)
  // stays O(1) per hatch instead of degrading to O(n) as one user's collection grows
  // — the difference between a few thousand hatches finishing instantly and a
  // quadratic blowup. speciesId is pinned so hatchEgg never has to draw an extra
  // rng() for the species roll (rollSpeciesInRarity) before rolling traits.
  function insertReadyEgg(
    ctx: ReturnType<typeof makeCtx>, userId: string,
    opts: Partial<{ source: 'shop' | 'breeding'; traits: string[] }> = {},
  ) {
    getOrCreateUser(ctx, userId, userId);
    return ctx.db.insert(schema.eggs).values({
      userId, rarity: 'common', speciesId: 'compsognathus',
      source: opts.source ?? 'shop', traits: opts.traits ?? [],
      obtainedAt: ctx.now(), incubationStartedAt: ctx.now(), hatchesAt: ctx.now(),
    }).returning().get();
  }

  // N and the tolerance were chosen together: for a Bernoulli share at p~=0.55/0.45
  // (variance product 0.2475 either way), N=4000 gives a standard deviation of
  // ~0.0079, so a 0.03 tolerance is ~3.8 sigma — loose enough that the seeded
  // (fully deterministic, not actually flaky) run lands nowhere near the edge,
  // yet tight enough that either injected bug below (wrong table, or the
  // un-normalized 0-100 scale) misses by 10x the tolerance or more.
  const N = 4000;
  const TOLERANCE = 0.03;

  // The mean trait count, measured on the SAME sample as the 0-trait share.
  // The share alone cannot distinguish [p0, p1, p2] from a 1<->2 bucket swap
  // [p0, p2, p1] — both give an IDENTICAL 0-trait share, since only p0 feeds
  // it. That is exactly the shape of the bug that shipped and survived a full
  // task review before being caught: WORLD_EVENTS' migration_season odds were
  // briefly transposed as [45, 15, 40] against the intended [45, 40, 15].
  // E[traits] = p1 + 2*p2 moves under that swap, so it catches what the share
  // can't. Variance of X in {0,1,2}: calm p=[.55,.35,.10] gives Var = (.35*1 +
  // .10*4) - .55^2 = .75 - .3025 = .4475; migration p=[.45,.40,.15] gives Var
  // = (.40*1 + .15*4) - .70^2 = 1.00 - .49 = .51. Either way the N=4000
  // sample mean's SD is ~0.0106-0.0113, so a 0.05 tolerance (~4.5 sigma) stays
  // loose enough for the deterministic run while still catching the
  // bucket-swap deviation (0.25, ~5x the tolerance) by a wide margin.
  const MEAN_TOLERANCE = 0.05;

  function hatchTraitStats(nowMs: number, seed: number, n: number): { zeroShare: number; meanTraits: number } {
    const ctx = makeCtx({ nowMs, rng: mulberry32(seed) });
    let zero = 0;
    let totalTraits = 0;
    for (let i = 0; i < n; i++) {
      const userId = `stat${i}`;
      const egg = insertReadyEgg(ctx, userId);
      const out = hatchEgg(ctx, userId, egg.id);
      if (out.traits.length === 0) zero++;
      totalTraits += out.traits.length;
    }
    return { zeroShare: zero / n, meanTraits: totalTraits / n };
  }

  // Each sample runs the full hatchEgg pipeline (transaction, escrow check,
  // recomputeRating) against a fresh in-memory db user, so 4000 of them cost more
  // than the default 5s test timeout — bumped per-test rather than globally.
  it('uses the standard 55/35/10 odds on a calm day', () => {
    const { zeroShare, meanTraits } = hatchTraitStats(0, 7, N);
    expect(Math.abs(zeroShare - 0.55)).toBeLessThan(TOLERANCE);
    // E[traits] = 0*0.55 + 1*0.35 + 2*0.10 = 0.55 — coincidentally equal to
    // WILD_SLOT_ODDS' own p0, not a copy-paste of the assertion above.
    expect(Math.abs(meanTraits - 0.55)).toBeLessThan(MEAN_TOLERANCE);
  }, 20_000);

  it('uses 45/40/15 odds during Migration Season', () => {
    const { zeroShare, meanTraits } = hatchTraitStats(27 * DAY, 7, N);
    expect(Math.abs(zeroShare - 0.45)).toBeLessThan(TOLERANCE);
    // E[traits] = 0*0.45 + 1*0.40 + 2*0.15 = 0.70. The 1<->2 bucket swap this
    // test exists to catch ([0.45, 0.15, 0.40]) leaves the 0-trait share above
    // identical (still 0.45) but moves this mean to 0.95 — the gap a
    // zero-share-only check cannot see.
    expect(Math.abs(meanTraits - 0.70)).toBeLessThan(MEAN_TOLERANCE);
  }, 20_000);

  it('never applies the event odds to a bred egg', () => {
    const ctx = makeCtx({ nowMs: 27 * DAY });
    const egg = insertReadyEgg(ctx, 'u1', { source: 'breeding', traits: ['hardy', 'savage'] });
    const out = hatchEgg(ctx, 'u1', egg.id);
    expect(out.traits).toEqual(['hardy', 'savage']);
  });
});

describe('shop and sell prices under world events', () => {
  const CHARGEABLE_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
  const shopCmd = () => shopModule.commands.find((c) => c.data.name === 'shop')!;
  const sellCmd = () => shopModule.commands.find((c) => c.data.name === 'sell')!;

  function seedUser(ctx: ReturnType<typeof makeCtx>, id = 'u1') {
    getOrCreateUser(ctx, id, id);
    ctx.economy.apply(id, { cash: 500_000 }, 'seed', ctx.now());
  }
  const cashOf = (ctx: ReturnType<typeof makeCtx>, id = 'u1') =>
    ctx.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;

  // Parse "<number>" (with optional thousands separators) out of a real
  // rendered string — never recompute the expected number from a constant,
  // or a display/charge disagreement would slip straight through the test.
  function parseCash(text: string): number {
    const m = text.match(/([\d,]+) cash/);
    if (!m) throw new Error(`no "<n> cash" found in: ${text}`);
    return Number(m[1].replace(/,/g, ''));
  }

  describe('quote-vs-charge parity', () => {
    // Market Panic (day 38): eggPrice x0.70, sellCash x0.80.
    // Bumper Harvest (day 18): foodPrice x0.60, eggPrice x1.25.
    it('charges exactly what /shop view quotes for an egg', async () => {
      const ctx = makeCtx({ nowMs: 38 * DAY });
      seedUser(ctx);
      const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
      await shopCmd().execute(ctx, i.asChatInput());
      const payload = i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
      const eggField = payload.embeds[0].toJSON().fields!.find((f) => f.name.includes('Eggs'))!;
      // startsWith, not includes: 'common egg' is also a substring of 'uncommon egg'.
      const line = eggField.value.split('\n').find((l) => l.startsWith('• common egg'))!;
      const quoted = parseCash(line);
      expect(quoted).toBe(350);   // SHOP_EGG_PRICES.common (500) * market_panic's eggPrice (0.70)
      const before = cashOf(ctx);
      buyEgg(ctx, 'u1', 'common');
      expect(before - cashOf(ctx)).toBe(quoted);
    });

    it('charges exactly what the rarity autocomplete quotes', async () => {
      const ctx = makeCtx({ nowMs: 38 * DAY });
      seedUser(ctx);
      const i = fakeAutocomplete({ name: 'shop', sub: 'egg', user: 'u1', focused: { name: 'rarity', value: '' } });
      await shopCmd().autocomplete!(ctx, i.asAutocomplete());
      const rows = i.replies[0] as Array<{ name: string; value: string }>;
      const row = rows.find((r) => r.value === 'common')!;
      const quoted = parseCash(row.name);
      expect(quoted).toBe(350);
      const before = cashOf(ctx);
      buyEgg(ctx, 'u1', 'common');
      expect(before - cashOf(ctx)).toBe(quoted);
    });

    it('charges exactly what /shop view quotes for food', async () => {
      const ctx = makeCtx({ nowMs: 18 * DAY });
      seedUser(ctx);
      const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
      await shopCmd().execute(ctx, i.asChatInput());
      const payload = i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
      const foodField = payload.embeds[0].toJSON().fields!.find((f) => f.name.includes('Food'))!;
      const line = foodField.value.split('\n').find((l) => l.includes('Fish'))!;
      const match = line.match(/— (\d+)\/unit/);
      expect(match, line).not.toBeNull();
      const quotedUnit = Number(match![1]);
      // 12 * 0.60 = 7.2 -> round 7. Genuinely fractional pre-round, so this
      // also proves foodPriceAt isn't Math.ceil (which would quote 8).
      expect(quotedUnit).toBe(7);
      const before = cashOf(ctx);
      const { total } = buyFood(ctx, 'u1', 'fish', 3);
      expect(total).toBe(quotedUnit * 3);
      expect(before - cashOf(ctx)).toBe(total);
    });

    it('pays exactly what the /sell confirm preview quotes', () => {
      const ctx = makeCtx({ nowMs: 38 * DAY });
      seedUser(ctx);
      const d = ctx.db.insert(schema.dinos).values({
        userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      }).returning().get();
      const preview = previewSell(ctx, 'u1', d.id);
      expect(preview.cashValue).toBe(400);   // SELL_CASH.rare (500) * market_panic's sellCash (0.80)
      const before = cashOf(ctx);
      const res = sellDino(ctx, 'u1', d.id);
      expect(res.cash).toBe(preview.cashValue);
      expect(cashOf(ctx) - before).toBe(preview.cashValue);
    });

    it('pays exactly what the /sell autocomplete quotes', async () => {
      const ctx = makeCtx({ nowMs: 38 * DAY });
      seedUser(ctx);
      const d = ctx.db.insert(schema.dinos).values({
        userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      }).returning().get();
      const i = fakeAutocomplete({ name: 'sell', user: 'u1', focused: { name: 'dino', value: '' } });
      await sellCmd().autocomplete!(ctx, i.asAutocomplete());
      const rows = i.replies[0] as Array<{ name: string; value: number }>;
      const row = rows.find((r) => r.value === d.id)!;
      const quoted = parseCash(row.name);
      expect(quoted).toBe(400);
      const before = cashOf(ctx);
      const res = sellDino(ctx, 'u1', d.id);
      expect(res.cash).toBe(quoted);
      expect(cashOf(ctx) - before).toBe(quoted);
    });

    it('is a no-op on a calm day, aside from the day\'s own (independent) deal', () => {
      // A calm day has no world event, but the daily deal (Task 10) is not a
      // world event — it exists every day, folded into eggPriceAt/foodPriceAt
      // via a wholly separate rng stream (todaysDeal). So "no-op" now means
      // "matches raw price, except for whichever one rarity/food is today's
      // deal" — derived from the real formula, not hand-picked, so this stays
      // accurate if the day-0 deal ever changes (e.g. a future DEAL_SALT edit).
      const ctx = makeCtx({ nowMs: 0 });
      const deal = todaysDeal(ctx.now());
      for (const r of CHARGEABLE_RARITIES) {
        const expected = r === deal.rarity ? roundCharge(SHOP_EGG_PRICES[r], DEAL_EGG_DISCOUNT) : SHOP_EGG_PRICES[r];
        expect(eggPriceAt(r, ctx.now()), r).toBe(expected);
      }
      for (const f of Object.values(FOODS)) {
        const expected = f.id === deal.food ? roundCharge(f.unitCost, DEAL_FOOD_DISCOUNT) : f.unitCost;
        expect(foodPriceAt(f, ctx.now()), f.id).toBe(expected);
      }
      // Selling is untouched by the deal (only egg purchases and food purchases are).
      for (const r of CHARGEABLE_RARITIES) expect(sellCashAt(r, ctx.now())).toBe(SELL_CASH[r]);
    });
  });

  describe('rounding is round-with-floor for charges, round-only for the payout — never ceil, never floor', () => {
    // Confirms neither shipped event reaches a fractional product against
    // egg or sell prices — every SHOP_EGG_PRICES entry is a multiple of 500
    // and every SELL_CASH entry a multiple of 50, and bumper_harvest/
    // market_panic's multipliers (0.60, 0.70, 0.80, 1.25) resolve all of them
    // to exact integers. Food alone reaches a genuine fraction under a
    // shipped event (Fish at day 18, in the parity test above). So egg and
    // sell rounding is unit tested directly against the shared roundCharge/
    // roundPayout primitives with a synthetic fractional multiplier instead
    // — the same pattern Task 5 used for expeditionFeeFor/expeditionCashFor
    // — rather than fabricating a fake world event to reach one.
    it('no shipped egg or sell-cash price is fractional under bumper_harvest or market_panic', () => {
      for (const r of CHARGEABLE_RARITIES) {
        expect(Number.isInteger(SHOP_EGG_PRICES[r] * 0.70), `${r} market_panic eggPrice`).toBe(true);
        expect(Number.isInteger(SHOP_EGG_PRICES[r] * 1.25), `${r} bumper_harvest eggPrice`).toBe(true);
        expect(Number.isInteger(SELL_CASH[r] * 0.80), `${r} market_panic sellCash`).toBe(true);
      }
    });

    it('roundCharge rounds, rather than always rounding up (not Math.ceil)', () => {
      // 200 * 1.1 === 220.00000000000003 (float artifact). Math.round -> 220;
      // Math.ceil -> 221.
      expect(roundCharge(200, 1.1)).toBe(220);
    });

    it('roundCharge rounds, rather than always rounding down (not Math.floor)', () => {
      // 10 * 1.26 = 12.6. Math.round -> 13; Math.floor -> 12.
      expect(roundCharge(10, 1.26)).toBe(13);
    });

    it('roundCharge floors at 1 cash so a steep discount cannot reach 0', () => {
      // 200 * 0.001 = 0.2 -> Math.round alone gives 0; Math.max(1, ...) lifts it to 1.
      expect(roundCharge(200, 0.001)).toBe(1);
    });

    it('roundPayout rounds, rather than always rounding up (not Math.ceil)', () => {
      expect(roundPayout(200, 1.1)).toBe(220);
    });

    it('roundPayout rounds, rather than always rounding down (not Math.floor)', () => {
      expect(roundPayout(10, 1.26)).toBe(13);
    });

    it('roundPayout applies no floor — a near-zero multiplier can reach 0', () => {
      // Unlike roundCharge, sellCashAt never floors at 1: SELL_CASH's minimum
      // (common, 50) times the one shipped sellCash multiplier (0.80) is 40,
      // nowhere near 0, so nothing shipped needs the floor. Documented here,
      // directly against the primitive, since no real payout can prove it.
      expect(roundPayout(50, 0.001)).toBe(0);
    });
  });
});

describe('the hard invariant — events never touch a gate', () => {
  // The day index at which each event first occurs, so the loop below covers
  // all nine without mocking anything. Pinned against tests/world.test.ts's
  // own "pins the day fixtures the rest of the suite selects events by" test —
  // every value here is one of those already-verified fixture days.
  const DAY_OF: Record<string, number> = {
    clear_skies: 0, heat_wave: 5, blood_moon: 7, cold_snap: 8, amber_storm: 10,
    fossil_rush: 14, bumper_harvest: 18, migration_season: 27, market_panic: 38,
  };

  it('covers every event in the roster', () => {
    for (const e of WORLD_EVENTS) {
      expect(DAY_OF[e.id], `no fixture day for ${e.id}`).toBeDefined();
      expect(worldEventFor(DAY_OF[e.id] * DAY).id).toBe(e.id);
    }
  });

  it('computes an identical park rating under all nine events', () => {
    // One paddock, one dino fed and assigned at that ctx's own `now` (so hunger
    // never drains across the different fixture days), one decor piece —
    // exactly enough to exercise all three rating.ts terms (collection, park,
    // comfort). Anchoring lastFedAt/hatchedAt to ctx.now() rather than 0
    // mirrors tests/world-effects.test.ts's own `dino()` helper above, for the
    // same reason: a dino "fed" at epoch 0 would have drained differently
    // depending on how far the fixture day sits from day 0.
    function seed(ctx: ReturnType<typeof makeCtx>): string {
      const userId = 'u1';
      getOrCreateUser(ctx, userId, userId);
      ctx.economy.apply(userId, { cash: 500_000 }, 'test', ctx.now());
      const lot = buildLot(ctx, userId, 'herbivore_paddock');
      ctx.db.insert(schema.dinos).values({
        userId, speciesId: 'triceratops', lotId: lot.id,
        hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      }).run();
      decorateLot(ctx, userId, lot.id, 'grass_tuft');
      return userId;
    }

    const ratings = new Set<number>();
    const highWaters = new Set<number>();
    for (const e of WORLD_EVENTS) {
      const ctx = makeCtx({ nowMs: DAY_OF[e.id] * DAY });
      const userId = seed(ctx);
      const out = recomputeRating(ctx, userId);
      ratings.add(out.rating);
      highWaters.add(out.highWater);
    }
    expect([...ratings], 'an event moved park rating').toHaveLength(1);
    expect([...highWaters], 'an event moved best-ever rating').toHaveLength(1);
  });

  // Every gate in the game is a pure function of RATING ALONE. The way an event
  // could ever move one is by someone threading eventMods into the progression
  // layer, so assert that structurally — a value-comparison test here would be
  // tautological, since both sides would read the same unmodified constant.
  it('keeps the progression layer free of any dependency on the world', () => {
    const gateFiles = [
      resolve(process.cwd(), 'src/data/progression.ts'),
      resolve(process.cwd(), 'src/modules/park/rating.ts'),
    ];
    for (const file of gateFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} must not depend on the world`).not.toMatch(/core\/world\.js/);
      expect(text, `${file} must not depend on event data`).not.toMatch(/world-events\.js/);
    }
  });
});
