import { describe, it, expect } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeButton, fakeCommand, replyText, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, activeExpedition, expeditionFeeFor } from '../src/modules/expeditions/service.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';
import { dailyEggOffers, eggPriceAt, todaysDeal } from '../src/modules/shop/service.js';
import { eventMods, worldEventFor } from '../src/core/world.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';

const DAY = 86_400_000;

/** Every custom_id on a payload's action rows, read out of the REAL builder JSON.
 *  Builder JSON is snake_case: `custom_id`, never `customId`.
 *  `?.components ?? []` on BOTH counts: a REFUSAL reply is `{ content, flags }` with no
 *  components key at all, and an unrouted or deferred click leaves `replies[0]` undefined
 *  entirely. The helper must answer "no ids" in both cases rather than throwing, or every
 *  refusal case below dies here instead of asserting what it came to assert — and every
 *  red step that predicts an empty list would report a TypeError instead. */
type MintedRows = { components?: ReadonlyArray<{ toJSON(): unknown }> } | undefined;
function mintedIds(reply: unknown): string[] {
  const rows = (reply as MintedRows)?.components ?? [];
  return rows
    .flatMap((r) => (r.toJSON() as { components: Array<{ custom_id?: string }> }).components)
    .map((c) => c.custom_id)
    .filter((id): id is string => typeof id === 'string');
}

/** The rendered label of one minted button, for whole-string assertions. */
function labelOf(reply: unknown, customId: string): string {
  const rows = (reply as MintedRows)?.components ?? [];
  return rows
    .flatMap((r) => (r.toJSON() as { components: Array<{ custom_id?: string; label?: string }> }).components)
    .find((c) => c.custom_id === customId)!.label!;
}

const cashOf = (c: ReturnType<typeof makeCtx>, id: string): number =>
  c.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;

/** A player who can afford several digs. users.cash defaults to 500, so this leaves 50,500. */
function seedDigger(c: ReturnType<typeof makeCtx>, id = 'u1'): void {
  getOrCreateUser(c, id, 'Reg');
  c.economy.apply(id, { cash: 50_000 }, 'seed', c.now());
}

/** Dispatch to coastal_dig and advance to its return. coastal_dig's durationMs IS 15 minutes
 *  and claimExpedition refuses only on `returnsAt > now`, so landing exactly on it counts as
 *  returned — the same idiom tests/alert-buttons.test.ts already uses. 15 minutes never
 *  crosses a UTC midnight from the day starts these tests use, so the world event cannot
 *  move underneath a fixture. */
function digAndReturn(c: ReturnType<typeof makeCtx>, id = 'u1'): void {
  startExpedition(c, id, 'coastal_dig', null);
  c.setNow(c.now() + 15 * 60_000);
}

describe('Dig again — the button', () => {
  it('/expedition claim mints the Dig again button carrying the owner and the site', async () => {
    const ctx = makeCtx();
    seedDigger(ctx);
    digAndReturn(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    // toContain, never a whole-list toEqual: Tasks G7-B and G4-D each add a second control to
    // this same array, and the ONE whole-list assertion over this surface lives in Task 29 (G8-A)'s
    // GRAPH so a deletion is a single findable failure rather than four.
    expect(mintedIds(i.replies[0])).toContain('exp:again:u1:coastal_dig');
    expect(labelOf(i.replies[0], 'exp:again:u1:coastal_dig')).toBe('🧭 Dig again');
  });

  it("the exp:claim button's own update mints it too, so both claim surfaces agree", async () => {
    const ctx = makeCtx();
    seedDigger(ctx);
    digAndReturn(ctx);
    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(mintedIds(b.replies[0])).toContain('exp:again:u1:coastal_dig');
    expect(labelOf(b.replies[0], 'exp:again:u1:coastal_dig')).toBe('🧭 Dig again');
  });

  it('an unrecognised exp action still acknowledges rather than painting "This interaction failed"', async () => {
    // Already true today, and pinned here because Task 20 (G7-B) restructures this handler and must
    // keep it true: the unknown-action arm stays FIRST, ahead of the owner check. That ordering
    // is also pinned by tests/alert-buttons.test.ts's 'exp defers before the owner check on an
    // unknown action, even with a mismatched uid'.
    const ctx = makeCtx();
    seedDigger(ctx);
    const b = fakeButton({ customId: 'exp:whatever:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });
});

/**
 * makeCtx leaves `config.modules` as `{}` (tests/harness.ts:21) and Task 9 (G4-B) deliberately
 * keeps it that way, so every CROSS-MODULE mint below — expeditions and the shop both minting
 * an id the HATCHERY module handles — is gated on `ctx.config.modules.hatchery` and would
 * suppress its own button under a plain ctx. Every case that asserts such a button EXISTS
 * builds its ctx here too, not only the module-disabled ones, or it would go green having
 * watched the gate close rather than the button ship. `testRegistry` is a separate object and
 * stays fully enabled on purpose: the gate reads ctx.config, not the registry, so a fixture
 * has to move exactly that. Same shape as Task 22 (G4-D)'s fixture, declared again rather than
 * imported — no test file imports another test file's helpers.
 */
function modulesConfig(over: Record<string, boolean> = {}): Config {
  return {
    token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner',
    // Derived from ALL_MODULES, never a hand-written list of names: a gate added later on a
    // module this literal happened not to name would read `undefined`, suppress its own
    // control, and leave the test green with nothing to show for it. tests/harness.ts already
    // compiles this exact expression for testRegistry, so it is proven under `npm run typecheck`.
    modules: { ...Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])), ...over },
  };
}
const ctxWithModules = (over: Record<string, boolean> = {}, nowMs = 0) =>
  makeCtx({ nowMs, config: modulesConfig(over) });

const eggsOf = (c: ReturnType<typeof makeCtx>, id: string) =>
  c.db.select().from(schema.eggs).where(eq(schema.eggs.userId, id)).all();

describe('the exp:claim update carries both follow-through controls', () => {
  it('mints Dig again AND Incubate for the egg it just found, and the Incubate id routes', async () => {
    // ctxWithModules, not a plain makeCtx: the Incubate mint is gated on
    // ctx.config.modules.hatchery and the harness default is `{}`, so a plain ctx would make
    // the gate suppress the very button this case is here to see.
    const ctx = ctxWithModules({}, 9 * DAY);
    seedDigger(ctx);
    digAndReturn(ctx);
    const claimedAt = ctx.now();

    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const egg = eggsOf(ctx, 'u1')[0]!;
    expect(mintedIds(b.replies[0])).toContain('exp:again:u1:coastal_dig');
    expect(mintedIds(b.replies[0])).toContain(`hatch:inc:u1:${egg.id}`);

    // Mint it, then ROUTE it. Asserting the id alone would not catch a prefix that resolves
    // to no handler: routeInteraction has no else-branch for an unresolved prefix, so a dead
    // id is a fully silent no-op.
    const inc = `hatch:inc:u1:${egg.id}`;
    const click = fakeButton({ customId: inc, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());
    expect(click.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!.incubationStartedAt)
      .toBe(claimedAt);
  });

  it('mints no Incubate row when the hatchery module is disabled', async () => {
    const ctx = ctxWithModules({ hatchery: false }, 9 * DAY);
    seedDigger(ctx);
    digAndReturn(ctx);
    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const egg = eggsOf(ctx, 'u1')[0]!;
    expect(mintedIds(b.replies[0])).not.toContain(`hatch:inc:u1:${egg.id}`);
    // Dig again still ships: this gate is about the hatchery module, not about the reply.
    expect(mintedIds(b.replies[0])).toContain('exp:again:u1:coastal_dig');
  });
});

describe('Dig again — the confirm card', () => {
  // Day 9 is Heat Wave (expeditionFee x1) and day 10 is Amber Storm (expeditionFee x2).
  // These assertions are not decoration: they are what makes every fixture below a statement
  // about the real world-event pipeline rather than about two constants someone typed.
  // WORLD_SALT or a reorder of WORLD_EVENTS moves which day is which, and this fails loudly
  // instead of the fee tests going quietly vacuous.
  it('day 9 and day 10 really do price coastal_dig differently, through the real pipeline', () => {
    expect(worldEventFor(9 * DAY).id).toBe('heat_wave');
    expect(worldEventFor(10 * DAY).id).toBe('amber_storm');
    expect(eventMods(9 * DAY).expeditionFee).toBe(1);
    expect(eventMods(10 * DAY).expeditionFee).toBe(2);
    expect(expeditionFeeFor(EXPEDITION_SITES.coastal_dig.cost, eventMods(9 * DAY).expeditionFee)).toBe(200);
    expect(expeditionFeeFor(EXPEDITION_SITES.coastal_dig.cost, eventMods(10 * DAY).expeditionFee)).toBe(400);
  });

  it('opens an ephemeral card whose confirm button carries the fee it was minted for', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    digAndReturn(ctx);
    const claim = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1' });
    await routeInteraction(ctx, testRegistry, claim.asInteraction());
    // The REAL minted id, read back out of the payload that mints it — never hand-typed.
    const openId = mintedIds(claim.replies[0]).find((id) => id.startsWith('exp:again:'))!;

    const open = fakeButton({ customId: openId, user: 'u1' });
    const before = cashOf(ctx, 'u1');
    await routeInteraction(ctx, testRegistry, open.asInteraction());

    expect(open.deferOpts).toHaveLength(0);
    expect(open.replies).toHaveLength(1);
    expect((open.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(mintedIds(open.replies[0])).toContain('exp:againyes:u1:coastal_dig:200');
    expect(labelOf(open.replies[0], 'exp:againyes:u1:coastal_dig:200')).toBe('Dig — 200 cash');
    // Nothing is spent by OPENING the card — read before the click, compared after it.
    expect(cashOf(ctx, 'u1')).toBe(before);
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });

  it('quotes the DOUBLED fee, in the card text as well as the id, on an Amber Storm day', async () => {
    const ctx = makeCtx({ nowMs: 10 * DAY });
    seedDigger(ctx);
    const b = fakeButton({ customId: 'exp:again:u1:coastal_dig', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(mintedIds(b.replies[0])).toContain('exp:againyes:u1:coastal_dig:400');
    expect(labelOf(b.replies[0], 'exp:againyes:u1:coastal_dig:400')).toBe('Dig — 400 cash');
    // The LAST rendered line, whole — never a substring around the number. The line above it
    // is the world-event header, whose emoji resolves through EMOJI_FALLBACK and is not what
    // this case is about.
    const lines = replyText(b.replies[0]).split('\n');
    expect(lines[lines.length - 1]).toBe('Send a crew back to **Coastal Dig** for **400** cash?');
  });

  it('a bystander gets nothing back but a refusal', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    seedDigger(ctx, 'u2');
    const b = fakeButton({ customId: 'exp:again:u1:coastal_dig', user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That is not your expedition.');
    // A refusal is content-only, so mintedIds takes its `?? []` branch — no card, no button.
    expect(mintedIds(b.replies[0])).toHaveLength(0);
  });

  it('a forged site segment is acknowledged and dropped, never priced', async () => {
    // EXPEDITION_SITES is a PLAIN object literal (src/data/sites.ts), so
    // EXPEDITION_SITES['constructor'] reads back truthy off Object.prototype and its .cost is
    // undefined. A truthiness guard would quote "undefined for NaN cash" and mint
    // exp:againyes:u1:constructor:NaN.
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    for (const forged of ['exp:again:u1:constructor', 'exp:again:u1:__proto__', 'exp:again:u1']) {
      const b = fakeButton({ customId: forged, user: 'u1' });
      await routeInteraction(ctx, testRegistry, b.asInteraction());
      expect(b.replies, forged).toHaveLength(0);
      expect(b.deferOpts, forged).toHaveLength(1);
      expect(b.deferOpts[0], forged).toMatchObject({ kind: 'update' });
    }
  });
});

describe('Dig again — the confirm click', () => {
  /** Open the card on whatever day ctx is at and hand back the confirm id it really minted. */
  async function openCard(ctx: ReturnType<typeof makeCtx>): Promise<string> {
    const b = fakeButton({ customId: 'exp:again:u1:coastal_dig', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return mintedIds(b.replies[0])[0]!;
  }
  const digRows = (c: ReturnType<typeof makeCtx>) =>
    c.db.select().from(schema.txLog).all().filter((r) => r.reason === 'expedition:coastal_dig');

  it('REFUSES the confirm when one UTC rollover has moved the fee under it', async () => {
    // Minted on day 9 (Heat Wave, fee x1 -> 200). Clicked on day 10 (Amber Storm, fee x2 ->
    // 400). The clock crossing one midnight is what moves the price — nothing here writes a
    // wrong number into the id, which would prove only that `!==` works.
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    const confirmId = await openCard(ctx);
    expect(confirmId).toBe('exp:againyes:u1:coastal_dig:200');

    ctx.setNow(10 * DAY);
    const before = cashOf(ctx, 'u1');
    const beforeRows = digRows(ctx).length;
    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(replyText(click.replies[0])).toBe(
      'Coastal Dig costs 400 cash now, not 200 — open the Dig again card for the current price.');
    expect((click.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(cashOf(ctx, 'u1')).toBe(before);
    expect(digRows(ctx)).toHaveLength(beforeRows);
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });

  it('charges exactly once on the happy path, and refuses a second click of the same confirm', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    const confirmId = await openCard(ctx);
    const before = cashOf(ctx, 'u1');
    const beforeRows = digRows(ctx).length;

    const first = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, first.asInteraction());
    expect(first.deferOpts).toHaveLength(0);
    expect(cashOf(ctx, 'u1')).toBe(before - 200);
    expect(digRows(ctx)).toHaveLength(beforeRows + 1);
    expect(activeExpedition(ctx, 'u1')!.siteId).toBe('coastal_dig');
    // The card blanks itself. Second layer only — any OTHER open message still holds a stale
    // button, which is why the price segment above is the actual guard.
    expect(mintedIds(first.replies[0])).toHaveLength(0);

    const afterFirst = cashOf(ctx, 'u1');
    const second = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, second.asInteraction());
    expect(replyText(second.replies[0])).toBe('You already have an expedition out — claim it first.');
    expect(cashOf(ctx, 'u1')).toBe(afterFirst);
    expect(digRows(ctx)).toHaveLength(beforeRows + 1);
  });

  it('a bystander clicking the confirm dispatches nothing and pays nothing', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    seedDigger(ctx, 'u2');
    const confirmId = await openCard(ctx);
    const before = cashOf(ctx, 'u2');
    const b = fakeButton({ customId: confirmId, user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That is not your expedition.');
    expect(cashOf(ctx, 'u2')).toBe(before);
    expect(activeExpedition(ctx, 'u2')).toBeUndefined();
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });

  it('quotes the shortfall when the player cannot afford the dig it just confirmed', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Three different numbers — needed 200, held 45, short 155 — so a swapped-argument bug
    // in shortfallLine cannot render identically. An expedition SITE is a proper place name
    // and takes no article, matching /expedition start's own wording (Task 3 (G1-C)).
    ctx.db.update(schema.users).set({ cash: 45 }).where(eq(schema.users.discordId, 'u1')).run();
    const confirmId = await openCard(ctx);
    const click = fakeButton({ customId: confirmId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, click.asInteraction());
    expect(replyText(click.replies[0]))
      .toBe('Not enough cash — Coastal Dig costs 200, you have 45 (155 short).');
    expect(cashOf(ctx, 'u1')).toBe(45);
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });

  it('a non-integer price segment is acknowledged and dropped', async () => {
    const ctx = makeCtx({ nowMs: 9 * DAY });
    seedDigger(ctx);
    for (const forged of ['exp:againyes:u1:coastal_dig:abc', 'exp:againyes:u1:coastal_dig']) {
      const b = fakeButton({ customId: forged, user: 'u1' });
      await routeInteraction(ctx, testRegistry, b.asInteraction());
      expect(b.replies, forged).toHaveLength(0);
      expect(b.deferOpts[0], forged).toMatchObject({ kind: 'update' });
    }
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });
});

describe('Buy another — the button', () => {
  it('/shop egg mints the Buy another button carrying the owner and the rarity', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    // Day 0 really does offer it. `common` is structurally always in the rotation at the
    // uncommon ceiling — the pool there is exactly ['common','uncommon'] and slice(0,3)
    // cannot truncate it — so the pre-buy rotation gate cannot swallow this case.
    expect(dailyEggOffers(0, 0)).toContain('common');
    const i = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity: 'common' } });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    // toContain for the id this task owns; Task 26 (G4-E) adds a second control to this same
    // array and Task 29 (G8-A)'s GRAPH is the one place the whole list is pinned.
    expect(mintedIds(i.replies[0])).toContain('shop:again:u1:common');
    expect(labelOf(i.replies[0], 'shop:again:u1:common')).toBe('🥚 Buy another');
  });
});

describe('the sell prefix acknowledges an action it does not know', () => {
  it('defers rather than painting "This interaction failed"', async () => {
    // Spec §3.3, applied to the third switch this work edits: a bare return leaves the
    // interaction unanswered, and a stale id from an older deploy lands exactly here.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'sell:whatever:1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });
});

describe('Buy another — the confirm card', () => {
  // Day 17 is Clear Skies (eggPrice x1) and day 18 is Bumper Harvest (eggPrice x1.25). The
  // daily deal is `uncommon` on both, so `common` is undiscounted either side and the ONLY
  // thing moving its price is the world event. These assertions keep every fixture below a
  // statement about the real pipeline rather than about typed constants.
  it('day 17 and day 18 really do price a common egg differently, through the real pipeline', () => {
    expect(worldEventFor(17 * DAY).id).toBe('clear_skies');
    expect(worldEventFor(18 * DAY).id).toBe('bumper_harvest');
    expect(eventMods(17 * DAY).eggPrice).toBe(1);
    expect(eventMods(18 * DAY).eggPrice).toBe(1.25);
    expect(todaysDeal(17 * DAY).rarity).toBe('uncommon');
    expect(todaysDeal(18 * DAY).rarity).toBe('uncommon');
    expect(dailyEggOffers(0, 17 * DAY)).toContain('common');
    expect(dailyEggOffers(0, 18 * DAY)).toContain('common');
    expect(eggPriceAt('common', 17 * DAY)).toBe(500);
    expect(eggPriceAt('common', 18 * DAY)).toBe(625);
  });

  it('opens an ephemeral card whose confirm button carries the price it was minted for', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    const buy = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity: 'common' } });
    await routeInteraction(ctx, testRegistry, buy.asInteraction());
    // The REAL minted id, read back out of the payload that mints it.
    const openId = mintedIds(buy.replies[0]).find((id) => id.startsWith('shop:again:'))!;

    const open = fakeButton({ customId: openId, user: 'u1' });
    const before = cashOf(ctx, 'u1');
    await routeInteraction(ctx, testRegistry, open.asInteraction());

    expect(open.deferOpts).toHaveLength(0);
    expect((open.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(mintedIds(open.replies[0])).toContain('shop:againyes:u1:common:500');
    expect(labelOf(open.replies[0], 'shop:againyes:u1:common:500')).toBe('Buy — 500 cash');
    // The card's own sentence, whole — never a substring around the number.
    expect(replyText(open.replies[0])).toBe('Buy another **common** egg for **500** cash?');
    // Nothing is spent by OPENING the card — read before the click, compared after it.
    expect(cashOf(ctx, 'u1')).toBe(before);
    expect(eggsOf(ctx, 'u1')).toHaveLength(1);   // the one /shop egg bought, and no more
  });

  it('quotes the Bumper Harvest price when the card is opened on day 18', async () => {
    const ctx = makeCtx({ nowMs: 18 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'shop:again:u1:common', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(mintedIds(b.replies[0])).toContain('shop:againyes:u1:common:625');
    expect(labelOf(b.replies[0], 'shop:againyes:u1:common:625')).toBe('Buy — 625 cash');
    expect(replyText(b.replies[0])).toBe('Buy another **common** egg for **625** cash?');
  });

  it('refuses to open a card for a rarity that has left the rotation', async () => {
    // At an epic ceiling, day 0 offers rare and day 1 does not.
    const ctx = makeCtx({ nowMs: DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ ratingHighWater: 400 })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(dailyEggOffers(400, DAY)).not.toContain('rare');
    const b = fakeButton({ customId: 'shop:again:u1:rare', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe("A rare egg isn't in today's rotation — see /shop view.");
    expect(mintedIds(b.replies[0])).toHaveLength(0);
  });

  it('a bystander gets a refusal and no card', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Two');
    const b = fakeButton({ customId: 'shop:again:u1:common', user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That is not your purchase.');
    expect(mintedIds(b.replies[0])).toHaveLength(0);
  });

  it('a forged rarity segment is acknowledged and dropped, never echoed and never priced', async () => {
    const ctx = makeCtx({ nowMs: 17 * DAY });
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 50_000 }, 'seed', ctx.now());
    for (const forged of ['shop:again:u1:__proto__', 'shop:again:u1:constructor', 'shop:again:u1:mythic', 'shop:again:u1']) {
      const b = fakeButton({ customId: forged, user: 'u1' });
      await routeInteraction(ctx, testRegistry, b.asInteraction());
      expect(b.replies, forged).toHaveLength(0);
      expect(b.deferOpts[0], forged).toMatchObject({ kind: 'update' });
    }
    expect(eggsOf(ctx, 'u1')).toHaveLength(0);
  });

  it('an unrecognised shop action acknowledges rather than painting "This interaction failed"', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'shop:whatever:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });
});
