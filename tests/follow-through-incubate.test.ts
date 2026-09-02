import { describe, it, expect } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, claimExpedition } from '../src/modules/expeditions/service.js';
import { incubateRow } from '../src/modules/hatchery/embeds.js';
import { incubateEgg } from '../src/modules/hatchery/service.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';
import { dailyEggOffers } from '../src/modules/shop/service.js';
import { buildLot } from '../src/modules/park/service.js';
import { BREED_MS } from '../src/data/breeding.js';
import { mythicSpeciesChoices } from '../src/modules/shop/shards.js';
import { MYTHIC_UNLOCK_RATING } from '../src/data/progression.js';
import { getSpecies } from '../src/data/species/index.js';

// Day 0 is `clear_skies` — every eventMods multiplier is 1 — so coastal_dig costs exactly
// 200 cash and takes exactly its 15-minute durationMs. Re-derive with:
//   npx tsx -e "import {worldEventFor,eventMods} from './src/core/world.ts'; console.log(worldEventFor(0).id, eventMods(0))"
const MIN = 60_000;

describe('claimExpedition returns the egg it minted', () => {
  it('hands back the newly inserted expedition egg, not a pre-existing one', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    // A shop egg the player already owned. A "read the newest row back" implementation
    // would be indistinguishable from a correct one without this row present.
    const older = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 })
      .returning().get();

    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(16 * MIN);
    const { egg } = claimExpedition(ctx, 'u1');

    const fromExpedition = ctx.db.select().from(schema.eggs).all()
      .filter((e) => e.source === 'expedition');
    expect(fromExpedition).toHaveLength(1);
    expect(egg.id).toBe(fromExpedition[0].id);
    expect(egg.id).not.toBe(older.id);
    expect(egg.userId).toBe('u1');
    expect(egg.source).toBe('expedition');
    // The returned row is the stored row, not a hand-built copy.
    expect(egg).toEqual(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get());
  });
});

/** The button/select children of a recorded payload, as Discord's own JSON. */
interface MintedChild { custom_id?: string }
function mintedChildren(payload: unknown): MintedChild[] {
  const rows = (payload as { components?: ReadonlyArray<{ toJSON(): { components: MintedChild[] } }> })
    .components ?? [];
  return rows.flatMap((r) => r.toJSON().components);
}
const mintedIds = (payload: unknown): string[] =>
  mintedChildren(payload).map((c) => c.custom_id).filter((id): id is string => typeof id === 'string');

/** An unincubated egg the given player owns. */
function seedEgg(ctx: ReturnType<typeof makeCtx>, userId: string) {
  return ctx.db.insert(schema.eggs)
    .values({ userId, rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
}

describe('incubateRow — the one Incubate button builder', () => {
  it('mints one row holding one button, with the owner and the egg in the id', () => {
    const json = incubateRow('u1', 7).toJSON() as
      { components: Array<{ custom_id: string; label: string }> };
    expect(json.components).toHaveLength(1);
    // Whole rendered strings, both of them. Every minting surface goes through this builder,
    // so these two assertions are the only place either string is pinned.
    expect(json.components[0].custom_id).toBe('hatch:inc:u1:7');
    expect(json.components[0].label).toBe('🥚 Incubate #7');
  });
});

describe('hatch:inc — the one Incubate handler', () => {
  it('routes through the real registry, starts the egg timer, and closes the button', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const egg = seedEgg(ctx, 'u1');
    // Dispatched through routeInteraction against testRegistry (the real ALL_MODULES), not
    // comp.execute: findComponent resolves on customId.split(':')[0] alone, so calling
    // execute directly would prove nothing about the button being reachable at all.
    const customId = `hatch:inc:u1:${egg.id}`;
    const b = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    const row = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!;
    expect(row.incubationStartedAt).toBe(0);
    expect(row.hatchesAt).toBe(15 * 60_000);          // common: RARITY.common.incubationMs
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
    expect(b.deferOpts).toHaveLength(0);
    expect(b.replies).toHaveLength(1);
    // Whole rendered line, never a substring around a number.
    expect(replyText(b.replies[0])).toBe(
      `🥚 Egg #${egg.id} is incubating — ready <t:${Math.floor(row.hatchesAt! / 1000)}:R>, then \`/hatch egg:${egg.id}\`.`);
    // The spent button is REMOVED, not disabled: neither router guard reads `disabled`.
    // A whole-list assertion is correct HERE and nowhere else in this file — this is the
    // handler's own payload, written by this task alone, not a components array a second
    // slice also pushes onto.
    expect(mintedIds(b.replies[0])).toEqual([]);
    // i.update, not i.reply. `replies` cannot tell the two apart — this is the only
    // assertion in the file that can, and Step 11 watches it fail on its own.
    expect(b.replyKinds).toEqual(['update']);
  });

  it('leaves the embed and its upload alone so the egg art survives the click', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const egg = seedEgg(ctx, 'u1');
    const customId = `hatch:inc:u1:${egg.id}`;
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    // Sending `attachments: []` would drop the upload the surrounding embed's
    // attachment:// URL points at, leaving a broken image; sending `embeds: []` would
    // throw the reveal away. Neither key may appear.
    const sent = b.replies[0] as Record<string, unknown>;
    expect(Object.hasOwn(sent, 'attachments')).toBe(false);
    expect(Object.hasOwn(sent, 'embeds')).toBe(false);
  });
});

describe('unrecognised hatchery actions acknowledge instead of timing out', () => {
  it('hatch:<unknown> defers the update', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const customId = 'hatch:nope:u1:1';
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    // deferUpdate, not deferReply: deferReply posts a public "thinking…" placeholder that
    // never resolves. Both satisfy toHaveLength(1), so `kind` is the assertion that matters.
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });

  it('mythic:<unknown> defers the update', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const customId = 'mythic:nope:whatever';
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });
});

describe('hatch:inc guards', () => {
  it('tells a bystander it is not their egg, and touches nothing', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    getOrCreateUser(ctx, 'u2', 'Two');
    const owned = seedEgg(ctx, 'u1');
    // u2 owns an egg of their own. It is here for the BACKSTOP assertion below (the second
    // incubationStartedAt check, on `bystanders.id`): incubateEgg filters on (id, CALLER), so
    // even with the owner check deleted, u2's click would resolve against u2's OWN id and
    // never touch this egg. Under that break, though, vitest's fail-fast aborts at the
    // `replyText` assertion just below — incubateEgg would throw 'You do not own that egg.'
    // instead of 'That is not your egg.' — so the backstop assertion is never REACHED in that
    // scenario, not observed passing. Its truth rests entirely on incubateEgg's own
    // (id, userId) filter, not on a green run of this test.
    const bystanders = seedEgg(ctx, 'u2');

    const customId = `hatch:inc:u1:${owned.id}`;
    const b = fakeButton({ customId, user: 'u2', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    expect(replyText(b.replies[0])).toBe('That is not your egg.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, owned.id)).get()!.incubationStartedAt).toBeNull();
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, bystanders.id)).get()!.incubationStartedAt).toBeNull();
    expect(ctx.db.select().from(schema.timers).all()).toEqual([]);
  });

  it('names a malformed link as malformed rather than as an ownership problem', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    seedEgg(ctx, 'u1');
    const customId = 'hatch:inc:u1:not-a-number';
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    expect(replyText(b.replies[0])).toBe('That incubate link is invalid — use `/incubate`.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.timers).all()).toEqual([]);
  });

  it('refuses an egg that is already incubating, and enqueues no second timer', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    const egg = seedEgg(ctx, 'u1');
    // A level-2 Hatchery Lab, so incubatorSlots is 2. It is NOT needed for this assertion:
    // service.ts:36's already-incubating check runs BEFORE the slot cap at :38-39, so the
    // cap cannot fire first here. It IS needed for Step 5 — with :36 commented out, a
    // one-slot park refuses the click with 'All incubator slots are full. Upgrade the
    // Hatchery Lab for more.', which is red for the wrong reason. Do not delete it.
    ctx.db.insert(schema.lots)
      .values({ userId: 'u1', type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab', level: 2 }).run();
    incubateEgg(ctx, 'u1', egg.id, 'g1');

    const customId = `hatch:inc:u1:${egg.id}`;
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    expect(replyText(b.replies[0])).toBe('That egg is already incubating.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    // One timer, not two: a re-incubation would enqueue a second egg_hatch for the same egg.
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
  });

  it('refuses an egg locked in a pending trade', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    getOrCreateUser(ctx, 'u2', 'Two');
    const egg = seedEgg(ctx, 'u1');
    // Escrow is DERIVED from the pending trade row at read time (src/core/locks.ts), so this
    // row is the only way to put an egg in escrow without going through createTrade's own
    // gates. createdAt must be > now - TRADE_EXPIRY_MS for locksFor to see it; at nowMs 0
    // that cutoff is negative, so 0 qualifies.
    ctx.db.insert(schema.trades).values({
      fromUser: 'u1', toUser: 'u2',
      offer: { dinoIds: [], eggIds: [egg.id], cash: 0, foods: {} },
      request: { dinoIds: [], eggIds: [], cash: 0, foods: {} },
      status: 'pending', createdAt: ctx.now(),
    }).run();

    const customId = `hatch:inc:u1:${egg.id}`;
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());

    expect(replyText(b.replies[0])).toBe('That egg is locked in a pending trade.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    // Hatching CONSUMES the egg, so incubating an escrowed one would leave the trade
    // unfulfillable — the egg row must be untouched.
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get()!.incubationStartedAt).toBeNull();
    expect(ctx.db.select().from(schema.timers).all()).toEqual([]);
  });
});

/**
 * makeCtx leaves `config.modules` as `{}` (tests/harness.ts:21), and every Incubate mint from
 * here on is CROSS-MODULE: expeditions, the shop and the gene lab all mint an id the HATCHERY
 * module handles, so each is gated on `ctx.config.modules.hatchery`. ModuleRegistry filters to
 * ENABLED modules (src/core/modules.ts), so a button whose handler's module is off is a control
 * nothing answers at all. Left at the default, every one of those gates would suppress its own
 * button and every case asserting the button exists would go green while proving nothing.
 * `testRegistry` is a separate object and stays fully enabled on purpose: the gate reads
 * ctx.config, not the registry, so a fixture has to move exactly that.
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
const ctxOn = (nowMs = 0) => makeCtx({ nowMs, config: modulesConfig() });
const ctxNoHatchery = (nowMs = 0) => makeCtx({ nowMs, config: modulesConfig({ hatchery: false }) });

describe('/expedition claim offers Incubate', () => {
  function digReady(ctx: ReturnType<typeof makeCtx>) {
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(16 * 60_000);
  }

  it('the slash reply mints hatch:inc for the egg it just found, and that id routes', async () => {
    const ctx = ctxOn();
    digReady(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    // toContain, never a whole-list toEqual: Task 19 (G7-A) owns another control on this same
    // array and Task 29 (G8-A)'s GRAPH row is the ONE place the whole list is pinned. The second
    // assertion is a clobber tripwire, not a claim on that button.
    expect(mintedIds(i.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);
    expect(mintedIds(i.replies[0])).toContain('exp:again:u1:coastal_dig');

    // Mint it, then ROUTE it: asserting the id alone would not catch a prefix that
    // resolves to no handler at all.
    const customId = `hatch:inc:u1:${eggRow.id}`;
    const b = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt).toBe(16 * 60_000);
  });

  it('the slash reply keeps the typed fallback beside the button', async () => {
    const ctx = ctxOn();
    digReady(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    const description = (i.replies[0] as { embeds: Array<{ toJSON(): { description: string } }> })
      .embeds[0].toJSON().description;
    // The LAST rendered line, whole. The lines above it are the world-event header and the
    // loot line, neither of which this task changes. The sentence names only the TYPED path
    // because the button is gated on the hatchery module being enabled — "the button below"
    // would be a lie in exactly the configuration the next case covers.
    const lines = description.split('\n');
    expect(lines[lines.length - 1]).toBe(`Incubate it with \`/incubate egg:${eggRow.id}\`.`);
  });

  it('mints no Incubate row when the hatchery module is disabled', async () => {
    const ctx = ctxNoHatchery();
    digReady(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(i.replies[0])).not.toContain(`hatch:inc:u1:${eggRow.id}`);
    // Dig again still ships: this gate is about the hatchery module, not about the reply.
    expect(mintedIds(i.replies[0])).toContain('exp:again:u1:coastal_dig');
  });
});

describe('/shop egg offers Incubate', () => {
  /** Buy the first rarity actually on offer today. The rotation gate runs before buyEgg, and
   *  ratingHighWater is 0 for a fresh user — the same argument the handler itself passes.
   *  Re-derive today's list with:
   *    npx tsx -e "import {dailyEggOffers} from './src/modules/shop/service.ts'; console.log(dailyEggOffers(0,0))" */
  function buyFirstOffered(ctx: ReturnType<typeof makeCtx>) {
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 200_000 }, 'seed', 0);
    return fakeCommand({
      name: 'shop', sub: 'egg', user: 'u1', guild: 'g1',
      options: { rarity: dailyEggOffers(0, ctx.now())[0] },
    });
  }

  it('mints hatch:inc for the bought egg, and that id routes', async () => {
    const ctx = ctxOn();
    const i = buyFirstOffered(ctx);
    await routeInteraction(ctx, testRegistry, i.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(i.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);
    // Clobber tripwire for Task 23 (G7-D)'s control, not a claim on it.
    expect(mintedIds(i.replies[0])).toContain(`shop:again:u1:${eggRow.rarity}`);
    // The typed path survives beside the button — the whole description, which is one line.
    expect((i.replies[0] as { embeds: Array<{ toJSON(): { description: string } }> }).embeds[0].toJSON().description)
      .toBe(`Incubate it with \`/incubate egg:${eggRow.id}\`.`);

    const customId = `hatch:inc:u1:${eggRow.id}`;
    const b = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt).toBe(0);
  });

  it('mints no Incubate row when the hatchery module is disabled', async () => {
    const ctx = ctxNoHatchery();
    const i = buyFirstOffered(ctx);
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(i.replies[0])).not.toContain(`hatch:inc:u1:${eggRow.id}`);
    expect(mintedIds(i.replies[0])).toContain(`shop:again:u1:${eggRow.rarity}`);
  });
});

/**
 * A gene lab, a herbivore paddock, and two common herbivores standing in it — the minimum
 * startBreeding accepts (same rarity, same diet, both in a paddock, fed, affordable).
 * triceratops and gallimimus are both common/herbivore; hunger is left at the dinos table's
 * schema default (src/core/db/schema.ts), comfortably over BREED_MIN_HUNGER, and lastFedAt 0
 * at nowMs 0. Returns the two dino ids.
 */
function pairedDinos(ctx: ReturnType<typeof makeCtx>): { a: number; b: number } {
  getOrCreateUser(ctx, 'u1', 'One');
  ctx.economy.apply('u1', { cash: 500_000 }, 'seed', 0);
  buildLot(ctx, 'u1', 'gene_lab');
  buildLot(ctx, 'u1', 'herbivore_paddock');
  const lot = ctx.db.select().from(schema.lots).all().find((l) => l.kind === 'herbivore_paddock')!;
  const a = ctx.db.insert(schema.dinos)
    .values({ userId: 'u1', speciesId: 'triceratops', lotId: lot.id, lastFedAt: 0, hatchedAt: 0 })
    .returning().get();
  const b = ctx.db.insert(schema.dinos)
    .values({ userId: 'u1', speciesId: 'gallimimus', lotId: lot.id, lastFedAt: 0, hatchedAt: 0 })
    .returning().get();
  return { a: a.id, b: b.id };
}

describe('/breed claim offers Incubate', () => {
  /** Start a pairing through the routed confirm button, advance to its ready time, and
   *  return the breeding row's id. */
  async function startAndAdvance(ctx: ReturnType<typeof makeCtx>): Promise<number> {
    const { a, b } = pairedDinos(ctx);
    const confirmId = `breed:confirm:${a}:${b}`;
    const confirm = fakeButton({ customId: confirmId, user: 'u1', guild: 'g1', componentIds: [confirmId] });
    await routeInteraction(ctx, testRegistry, confirm.asInteraction());
    const breeding = ctx.db.select().from(schema.breedings).all()[0];
    // BREED_MS.common sets the pairing's duration, and day 0's clear_skies event leaves the
    // breedMs multiplier at 1, so the pairing is ready at exactly the stamp set on the next
    // line. claimBreeding refuses only on readyAt > now.
    ctx.setNow(BREED_MS.common);
    return breeding.id;
  }

  it('the slash reply mints hatch:inc, and that id routes', async () => {
    const ctx = ctxOn();
    await startAndAdvance(ctx);

    const claim = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, claim.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(claim.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);

    const customId = `hatch:inc:u1:${eggRow.id}`;
    const clicked = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, clicked.asInteraction());
    expect(clicked.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt)
      .toBe(BREED_MS.common);
  });

  // Its own case, not a second assertion inside the one above: behind that case's first
  // assertion it would never be OBSERVED failing, and an assertion nobody has watched fail
  // is not yet an assertion.
  it('the slash reply names the typed fallback under the pairing result', async () => {
    const ctx = ctxOn();
    await startAndAdvance(ctx);
    const claim = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, testRegistry, claim.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    // The whole LAST line of the description. The line above it is the pairing result,
    // whose wording depends on the upgrade roll and which this task does not change.
    const description = (claim.replies[0] as { embeds: Array<{ toJSON(): { description: string } }> })
      .embeds[0].toJSON().description;
    const lines = description.split('\n');
    expect(lines[lines.length - 1]).toBe(`Incubate it with \`/incubate egg:${eggRow.id}\`.`);
  });

  it('the breed:claim button mints hatch:inc, and that id routes', async () => {
    const ctx = ctxOn();
    const breedingId = await startAndAdvance(ctx);

    const claimId = `breed:claim:${breedingId}`;
    const claim = fakeButton({ customId: claimId, user: 'u1', guild: 'g1', componentIds: [claimId] });
    await routeInteraction(ctx, testRegistry, claim.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(claim.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);
    // Whole rendered line. The rarity is read back off the row because claimBreeding can
    // upgrade it (BREED_UPGRADE_CHANCE), so the sentence must track what was actually stored.
    expect(replyText(claim.replies[0])).toBe(
      `🧬 Claimed — a **${eggRow.rarity}** egg is yours. Incubate it with \`/incubate egg:${eggRow.id}\`.`);

    const customId = `hatch:inc:u1:${eggRow.id}`;
    const clicked = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, clicked.asInteraction());
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt)
      .toBe(BREED_MS.common);
  });

  it('mints no Incubate row on either surface when the hatchery module is disabled', async () => {
    const slash = ctxNoHatchery();
    await startAndAdvance(slash);
    const claimCmd = fakeCommand({ name: 'breed', sub: 'claim', user: 'u1', guild: 'g1' });
    await routeInteraction(slash, testRegistry, claimCmd.asInteraction());
    const slashEgg = slash.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(claimCmd.replies[0])).not.toContain(`hatch:inc:u1:${slashEgg.id}`);

    const button = ctxNoHatchery();
    const breedingId = await startAndAdvance(button);
    const claimId = `breed:claim:${breedingId}`;
    const clicked = fakeButton({ customId: claimId, user: 'u1', guild: 'g1', componentIds: [claimId] });
    await routeInteraction(button, testRegistry, clicked.asInteraction());
    const buttonEgg = button.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(clicked.replies[0])).not.toContain(`hatch:inc:u1:${buttonEgg.id}`);
  });
});

describe('mythic:confirm offers Incubate', () => {
  it('mints hatch:inc for the Mythic egg, and that id routes', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { shards: 500 }, 'seed', 0);
    ctx.db.update(schema.users).set({ ratingHighWater: MYTHIC_UNLOCK_RATING })
      .where(eq(schema.users.discordId, 'u1')).run();
    const speciesId = mythicSpeciesChoices()[0].id;

    const confirmId = `mythic:confirm:${speciesId}`;
    const confirm = fakeButton({ customId: confirmId, user: 'u1', guild: 'g1', componentIds: [confirmId] });
    await routeInteraction(ctx, testRegistry, confirm.asInteraction());

    const eggRow = ctx.db.select().from(schema.eggs).all()[0];
    expect(mintedIds(confirm.replies[0])).toContain(`hatch:inc:u1:${eggRow.id}`);
    expect(replyText(confirm.replies[0])).toBe(
      `🌟 A Mythic **${getSpecies(speciesId).name}** egg is yours (#${eggRow.id})! Incubate it with \`/incubate egg:${eggRow.id}\`.`);
    // Plain makeCtx here, with config.modules left at {}: this mint needs NO module gate,
    // because the hatchery module mints AND handles this id — if it were disabled this
    // message would never have been sent. A ctx with modules off is therefore the sharpest
    // fixture available, and the button must still appear.
    expect(confirm.replyKinds).toEqual(['update']);

    const customId = `hatch:inc:u1:${eggRow.id}`;
    const clicked = fakeButton({ customId, user: 'u1', guild: 'g1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, clicked.asInteraction());
    expect(clicked.deferOpts).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, eggRow.id)).get()!.incubationStartedAt).toBe(0);
  });
});
