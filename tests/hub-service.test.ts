import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, toClockDinos, needsAttentionCount, capHours, facilityBonusPct } from '../src/modules/park/service.js';
import { escapeAt, ESCAPE_WARN_MS, accruedIncome, HUNGER_DRAIN_MS, hungerAt, drainMsFor } from '../src/core/clock.js';
import { hubView } from '../src/modules/hub/service.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx({ nowMs: 1_000_000 }); getOrCreateUser(ctx, 'u1', 'U1'); });

const egg = (over: Partial<typeof schema.eggs.$inferInsert> = {}) =>
  ctx.db.insert(schema.eggs).values({
    userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, ...over,
  }).run();

const ids = (userId = 'u1') => hubView(ctx, userId).map((s) => s.id);

// --- NEEDS YOU fixtures -----------------------------------------------------------------
// These build real rows against the real schema and hand back through the real clock
// (toClockDinos/escapeAt/accruedIncome) rather than hand-deriving instants, and each one
// asserts the state it claims to produce before any hub assertion relies on it.

const seedDino = (over: Partial<typeof schema.dinos.$inferInsert> = {}) =>
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();

const paddockLot = (kind: 'herbivore_paddock' | 'carnivore_paddock', name: string) =>
  ctx.db.insert(schema.lots).values({ userId: 'u1', type: 'paddock', kind, name }).returning().get();

// Escape-instant math is independent of `now` (see escapeAt's own doc comment), so it can
// be computed once right after the insert and reused after ctx.setNow moves `now` under it.
const escapeInstantFor = (dinoId: number): number => {
  const { clockDinos, dinos } = toClockDinos(ctx, 'u1');
  const idx = dinos.findIndex((d) => d.id === dinoId);
  const at = escapeAt(clockDinos[idx]);
  if (at === null) throw new Error('fixture dino never crosses the escape threshold');
  return at;
};

/** The instant hubView's dinos-at-risk row must carry for this dino, per the real clock. */
const expectedEscapeInstantFor = (dino: { id: number }): number => escapeInstantFor(dino.id);

// Herbivore in a herbivore paddock, no decor -> fit 0.75 (same shape tests/escapes.test.ts
// uses for its settleEscapes fixture). Comfort crosses ESCAPE_COMFORT at ~32h, +8h grace.
const seedAtRiskDino = () => {
  const lot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
  const dino = seedDino({ lotId: lot.id });
  const at = escapeInstantFor(dino.id);
  ctx.setNow(at - 3_600_000);   // one hour before the escape instant — inside the 12h window
  // Precondition: genuinely at risk, not yet escaped and inside ESCAPE_WARN_MS — never
  // faked via escapedAt, which is a different state (see the task brief).
  expect(escapeAt(toClockDinos(ctx, 'u1').clockDinos[0]), 'fixture already escaped').toBeGreaterThan(ctx.now());
  expect(at - ctx.now(), 'fixture is not within the warn window').toBeLessThanOrEqual(ESCAPE_WARN_MS);
  return dino;
};

// Triceratops (herbivore) parked in a carnivore paddock: paddockFit is pinned to 0.5
// whenever diet mismatches, independent of decor, so this alone is enough to trip
// needsAttentionCount's mismatch predicate.
const seedWrongHabitatDino = () => {
  const lot = paddockLot('carnivore_paddock', 'Carnivore Paddock');
  const dino = seedDino({ lotId: lot.id });
  const { clockDinos, dinos } = toClockDinos(ctx, 'u1');
  const idx = dinos.findIndex((d) => d.id === dino.id);
  expect(clockDinos[idx].paddock?.diet, 'fixture is not actually off-diet').not.toBe(clockDinos[idx].species.diet);
  return dino;
};

// A dino whose hunger has fully drained (48h since its last feed, nothing eaten): genuinely
// needs food, not merely "not at 100".
const seedHungryDino = () => {
  const lot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
  const dino = seedDino({ lotId: lot.id });
  ctx.setNow(HUNGER_DRAIN_MS);
  const { clockDinos, dinos } = toClockDinos(ctx, 'u1');
  const idx = dinos.findIndex((d) => d.id === dino.id);
  const c = clockDinos[idx];
  expect(hungerAt(c.hungerAtFed, c.lastFedAt, ctx.now(), drainMsFor(c.traits)), 'fixture is not actually hungry')
    .toBeLessThanOrEqual(0);
  return dino;
};

// A paddocked, freshly-fed dino earning income from the very instant the player's cap
// window opens (lastCollectAt), then `now` pushed a full cap + 1h past that — so the
// window is genuinely capped, not merely old.
const seedIncomeAtCap = () => {
  const lot = paddockLot('herbivore_paddock', 'Herbivore Paddock');
  const before = toClockDinos(ctx, 'u1');
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', lotId: lot.id,
    hunger: 100, lastFedAt: before.user.lastCollectAt, hatchedAt: 0,
  }).run();
  const capMs = capHours(before.lots) * 3_600_000;   // no visitor_center lot -> falls back to 8h
  ctx.setNow(before.user.lastCollectAt + capMs + 3_600_000);
  const after = toClockDinos(ctx, 'u1');
  const pending = accruedIncome(
    after.clockDinos, facilityBonusPct(after.lots), capHours(after.lots), after.user.lastCollectAt, ctx.now());
  // Precondition: the fixture actually accrues income AND the elapsed time already clears
  // the cap — both halves of hubView's income-capped condition.
  expect(pending, 'fixture accrues no income — cannot exercise the cap').toBeGreaterThan(0);
  expect(ctx.now() - after.user.lastCollectAt, 'fixture has not cleared the cap window').toBeGreaterThanOrEqual(capMs);
};

describe('hubView — the READY section', () => {
  it('is empty for a player with nothing ready', () => {
    expect(hubView(ctx, 'u1').filter((s) => s.section === 'ready')).toEqual([]);
  });

  it('reports an egg whose hatch time has arrived, and offers Crack', () => {
    egg({ incubationStartedAt: 0, hatchesAt: 1_000_000 });   // exactly now — the boundary
    const row = hubView(ctx, 'u1').find((s) => s.id === 'eggs-ready');
    expect(row, 'no eggs-ready row').toBeTruthy();
    expect(row!.section).toBe('ready');
    expect(row!.lossAtMs, 'a ready egg waits forever and must not carry a deadline').toBeNull();
    expect(row!.control!.customId).toBe('hatch:crack:1');
  });

  it('does NOT report an egg still cooking as ready', () => {
    egg({ incubationStartedAt: 0, hatchesAt: 1_000_001 });   // one ms out
    expect(ids()).not.toContain('eggs-ready');
  });

  it('reports an egg that was never put in the incubator, and offers Incubate', () => {
    egg();   // incubationStartedAt stays null
    const row = hubView(ctx, 'u1').find((s) => s.id === 'eggs-idle');
    expect(row, 'no eggs-idle row').toBeTruthy();
    // The owner uid rides in this id because the handler checks it; the egg id is
    // validated as an integer on the other side.
    expect(row!.control!.customId).toBe('hatch:inc:u1:1');
  });

  it('suppresses both egg rows for an egg locked in a pending trade', () => {
    egg();
    egg({ incubationStartedAt: 0, hatchesAt: 0 });
    getOrCreateUser(ctx, 'u2', 'U2');   // toUser is FK-constrained against users.discordId
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { dinoIds: [], eggIds: [1, 2], cash: 0, foods: {} },
      request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
      status: 'pending', createdAt: 999_999,
    } as typeof schema.trades.$inferInsert).run();
    // Both incubateEgg and hatchEgg refuse a locked egg, so offering either control would
    // be offering a button that can only error.
    expect(ids()).not.toContain('eggs-idle');
    expect(ids()).not.toContain('eggs-ready');
  });

  it('reports a returned expedition and offers Claim, but not one still out', () => {
    ctx.db.insert(schema.expeditions).values({
      userId: 'u1', siteId: 'coastal_dig', departedAt: 0, returnsAt: 1_000_000,
    }).run();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'expedition-ready');
    expect(row!.control!.customId).toBe('exp:claim:u1');

    ctx.setNow(999_999);
    expect(ids()).not.toContain('expedition-ready');
  });

  it('reports a finished pairing and offers Claim, carrying the breeding id', () => {
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: 1, parentB: 2, rarity: 'common', startedAt: 0, readyAt: 500_000,
    }).run();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'breeding-ready');
    // breed:claim carries the breeding id, NOT the owner — safe here only because the hub
    // is ephemeral and therefore owner-only. It must never be minted on a public message.
    expect(row!.control!.customId).toBe('breed:claim:1');
  });

  it('writes nothing — hubView is a read', () => {
    egg();
    const before = ctx.db.select().from(schema.eggs).all();
    hubView(ctx, 'u1');
    expect(ctx.db.select().from(schema.eggs).all()).toEqual(before);
  });
});

describe('hubView — the NEEDS YOU section', () => {
  it('reports dinos with no paddock, which nothing else in the product surfaces', () => {
    // accruedIncome skips them outright (`if (!d.paddock) continue;`), so an unassigned
    // dino is pure silent loss: it eats, it can escape, and it earns nothing.
    seedDino({ lotId: null });
    const row = hubView(ctx, 'u1').find((s) => s.id === 'dinos-unassigned');
    expect(row, 'no dinos-unassigned row').toBeTruthy();
    expect(row!.section).toBe('attention');
  });

  it('reports an escaped dino with NO control, because /rescue is slash-only', () => {
    seedDino({ escapedAt: 500_000 });
    const row = hubView(ctx, 'u1').find((s) => s.id === 'dinos-escaped');
    expect(row, 'no dinos-escaped row').toBeTruthy();
    expect(row!.control, 'the escaped row must not take a button seat').toBeUndefined();
    expect(row!.text).toContain('/rescue');
  });

  it('carries the escape INSTANT as the at-risk deadline, not now and not a duration', () => {
    const dino = seedAtRiskDino();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'dinos-at-risk')!;
    // lossAtMs is an absolute instant; rankSignals compares it against other absolute
    // instants. A duration here sorts as though the dino escaped in 1970.
    expect(row.lossAtMs).toBe(expectedEscapeInstantFor(dino));
    expect(row.control!.customId).toBe('hub:feedall:u1');
  });

  it('reports income that has hit its cap, with a deadline already in the past', () => {
    seedIncomeAtCap();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'income-capped')!;
    // Already losing outranks about to lose — see rankSignals. Any past instant does.
    expect(row.lossAtMs).not.toBeNull();
    expect(row.lossAtMs!).toBeLessThanOrEqual(ctx.now());
  });

  it('reports an empty larder and points at the shop, with no Feed control', () => {
    seedHungryDino();
    // Feed all with nothing to feed with is a button that can only fail.
    ctx.db.delete(schema.foodInventory).run();
    const row = hubView(ctx, 'u1').find((s) => s.id === 'food-empty');
    expect(row, 'no food-empty row').toBeTruthy();
    expect(row!.control).toBeUndefined();
    expect(hubView(ctx, 'u1').find((s) => s.id === 'dinos-at-risk')?.control).toBeUndefined();
  });

  it('agrees with needsAttentionCount rather than keeping its own definition', () => {
    // The union of at-risk and wrong-habitat, counted as DISTINCT dinos: a dino can trip
    // both, and summing the two rows would double-count it. This test is what stops the
    // hub growing a third inlined copy of the predicate.
    seedAtRiskDino();
    seedWrongHabitatDino();
    const { clockDinos } = toClockDinos(ctx, 'u1');
    const row = hubView(ctx, 'u1').find((s) => s.id === 'needs-attention')!;
    expect(row.text).toContain(String(needsAttentionCount(clockDinos, ctx.now())));
  });
});
