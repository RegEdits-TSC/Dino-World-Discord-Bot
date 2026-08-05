import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { feedCostFor } from '../src/modules/care/service.js';
import { shiftOdds, startExpedition, claimExpedition, expeditionFeeFor, expeditionCashFor } from '../src/modules/expeditions/service.js';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { startBreeding, claimBreeding, breedCooldowns } from '../src/modules/genelab/service.js';
import { schema } from '../src/core/db/index.js';
import { STARTER_FOOD } from '../src/data/foods.js';
import { BREED_MS, BREED_COOLDOWN_MS } from '../src/data/breeding.js';
import { runFight, energyCostFor, BattleError } from '../src/modules/battles/service.js';
import { chaptersPayload, type ChaptersView } from '../src/modules/battles/embeds.js';
import { battlesModule } from '../src/modules/battles/index.js';
import { CAMPAIGN } from '../src/data/battle/chapters/index.js';

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
