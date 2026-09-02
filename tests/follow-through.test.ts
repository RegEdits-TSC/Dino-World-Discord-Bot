import { describe, it, expect } from 'vitest';
import { ActionRow, ComponentType } from 'discord.js';
import type { APIActionRowComponent, APIComponentInMessageActionRow, MessageActionRowComponent } from 'discord.js';
import { eq } from 'drizzle-orm';
import {
  makeCtx, fakeCommand, fakeButton, fakeSelect, replyText, testRegistry,
  type FakeInteraction,
} from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { startExpedition, activeExpedition, expeditionFeeFor } from '../src/modules/expeditions/service.js';
import { feedCostFor } from '../src/modules/care/service.js';
import { dailyEggOffers, eggPriceAt } from '../src/modules/shop/service.js';
import { mythicSpeciesChoices } from '../src/modules/shop/shards.js';
import { MYTHIC_UNLOCK_RATING } from '../src/data/progression.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';
import { eventMods } from '../src/core/world.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';
import type { Rarity } from '../src/data/types.js';

// ---------------------------------------------------------------------------
// The follow-through graph (docs/superpowers/specs/2026-08-31-follow-through-design.md §3).
//
// Every surface that hands a player a new object offers the next step on it as a
// control on the same message. The graph is a CONVENTION — per-module minting on
// each module's own existing prefix — so nothing structural holds it together, and
// this table is the whole defence. A future surface that mints an egg and never
// offers Incubate compiles, typechecks, and passes every other test in the suite.
//
// Each row does three things, in this order, and all three matter:
//   1. drives the REAL surface (a command or a button, through routeInteraction),
//   2. reads the minted customIds out of the REAL builder JSON — never hand-typed,
//      which would prove only that two strings someone wrote match each other,
//   3. dispatches one of those ids back through routeInteraction against
//      `testRegistry` (built from the real ALL_MODULES) and asserts the DB effect.
//
// Step 3 is why this file exists rather than a set of `comp.execute` calls.
// `ModuleRegistry.findComponent` resolves a handler by `customId.split(':')[0]`
// alone (src/core/modules.ts), so a component registered under a two-segment
// prefix matches nothing, is never acknowledged, and ships dead — the
// `/admin ledger` pager was written that way. Only a ROUTED test sees it
// (§routed-test-per-component).
//
// The `exactly` field below is the ONE whole-list assertion in the plan. Per-slice
// tests use toContain for the id their own task owns, because /expedition claim's
// reply and /shop egg's reply are each built by two different slices pushing onto
// one array. The full ordered list lives here so a deletion AND an undeclared
// addition are each a single findable failure.
// ---------------------------------------------------------------------------

type TestCtx = ReturnType<typeof makeCtx>;

const OWNER = 'u1';
// src/core/world.ts keeps its own day constant module-private, so it is restated here.
const DAY_MS = 86_400_000;
// Day 5,000 of the epoch. Nothing in this file hard-codes a price or a fee off that
// choice: every row that cares derives its number from the same function production
// calls. What the day DOES buy is a calm world event, which keeps the fixtures legible.
// Re-derive it with:
//   npx tsx -e "import {worldEventFor} from './src/core/world.ts'; console.log(worldEventFor(5000*86400000).id)"
const DAY0 = 5_000 * DAY_MS;

/**
 * The module flags every row runs against. `makeCtx` leaves `config.modules` as `{}`
 * (tests/harness.ts:21) and nothing in this plan changes that, so each test file that needs flags
 * declares its own copy — tests/follow-through-incubate.test.ts and
 * tests/follow-through-assign.test.ts each carry one already, and a test file imports nothing from
 * another test file. Same shape as theirs, copied rather than shared — not a second shape.
 *
 * It is load-bearing here, not decoration. Most rows below drive a CROSS-MODULE mint: expeditions,
 * the shop and the gene lab each mint a `hatch:` id, and the hatch reveal mints `park:` ids, so
 * each is gated on `ctx.config.modules.<name>` — ModuleRegistry resolves a component handler only
 * among ENABLED modules (src/core/modules.ts), so a control whose handler's module is off is a
 * button nothing answers at all. Left at the `{}` default, every one of those gates would suppress
 * its own control and this entire table would pass while asserting nothing — the exact vacuous
 * green this file exists to prevent.
 *
 * Derived from ALL_MODULES rather than a hand-written list of names, unlike the sibling files,
 * which each name only the modules their own cases touch: this table drives every module that
 * mints anything, so a name left out of a literal list would silently re-open that vacuous pass on
 * one row while the rest of the table stayed green.
 *
 * `testRegistry` is NOT affected by this and does not need to be: it builds its own all-enabled
 * flags map as a separate ModuleRegistry argument (tests/harness.ts:33-34), so routing is fully
 * enabled either way. The gates read ctx.config, so only a fixture can move them.
 *
 * No row here asserts the DISABLED shape — those cases belong to the per-slice files that own each
 * gate (Tasks G4-D, G4-E, G4-F, G5-F). `over` is kept so a row that ever needs one has the same
 * handle those files use, and such a row would build its own ctx rather than change ctxOn.
 */
function modulesConfig(over: Record<string, boolean> = {}): Config {
  return {
    token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner',
    modules: { ...Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])), ...over },
  };
}
// makeCtx spreads `...overrides` last, so a passed `config` replaces the default outright.
const ctxOn = (nowMs = 0) => makeCtx({ nowMs, config: modulesConfig() });

interface Rendered { custom_id: string; type?: number; options?: Array<{ value: string }> }

/**
 * The customIds a recorded reply actually carries. `.toJSON()` turns an
 * ActionRowBuilder into Discord's own wire shape, where the field is snake_case
 * `custom_id` — the camelCase form only exists on the fake interaction object.
 */
function controlsOf(payload: unknown, label: string): Rendered[] {
  const rows = (payload as { components?: unknown[] } | undefined)?.components ?? [];
  return rows.flatMap((row) => {
    const toJSON = (row as { toJSON?: () => unknown }).toJSON;
    expect(typeof toJSON, `${label}: a component row that is not an ActionRowBuilder`).toBe('function');
    const json = (row as { toJSON(): { components?: Rendered[] } }).toJSON();
    return (json.components ?? []).filter((c) => typeof c.custom_id === 'string');
  });
}

/**
 * ActionRow's own constructor is private — discord.js parses gateway/REST payloads through
 * it internally and never exposes it — so this casts the CLASS to a public-constructor shape
 * purely to reach that same constructor from a test. The object that comes back is a genuine
 * `ActionRow` instance (`instanceof ActionRow` is true), not a duck-typed stand-in.
 */
const RealActionRow = ActionRow as unknown as new (
  data: APIActionRowComponent<APIComponentInMessageActionRow>,
) => ActionRow<MessageActionRowComponent>;

/**
 * `i.message.components`, as discord.js actually represents it — real `ActionRow` structures
 * built from a reply's real builder JSON — not the harness's default id-only placeholder
 * (`fakeButton`'s `componentIds`, tests/harness.ts). Needed wherever a handler reads
 * `i.message.components` itself, which until the Incubate fix (src/modules/hatchery/index.ts)
 * nothing in this repo did: the placeholder's children carry a customId and nothing else, and
 * `ActionRowBuilder.from()` rightly refuses to round-trip a button missing its label. Using the
 * placeholder here would make the sibling-survival assertions below pass by drowning out the
 * bug they exist to catch — every row would fail `instanceof ActionRow`, the rebuild would see
 * zero rows regardless of what the card actually held, and `components: []` would look correct
 * by coincidence.
 */
function realMessageComponents(payload: unknown): ActionRow<MessageActionRowComponent>[] {
  const rows = (payload as { components?: ReadonlyArray<{ toJSON(): unknown }> } | undefined)?.components ?? [];
  return rows.map((row) => new RealActionRow(row.toJSON() as APIActionRowComponent<APIComponentInMessageActionRow>));
}

/**
 * The click reached its handler AND the handler answered it.
 *
 * The first assertion is the load-bearing one and must stay first. When
 * `registry.findComponent(customId)` returns undefined — the exact defect
 * §routed-test-per-component exists for — routeInteraction falls through in
 * COMPLETE SILENCE: `if (comp)` has no else (src/core/router.ts:113), so there is
 * no reply, no deferUpdate, nothing. Both of the other two assertions pass
 * vacuously against empty arrays, so without this first one the helper proves
 * nothing at all about the failure mode this whole file exists to catch.
 *
 * The second distinguishes a real dispatch from the router's own guard, which
 * rejects with `deferUpdate()` and nothing else. It also holds these handlers to
 * replying or updating rather than deferring: every follow-through action is
 * synchronous DB work with nothing to wait on, so a defer here is a mistake, not
 * a style choice.
 *
 * The third catches the router's outer catch swallowing a handler throw and
 * answering with one fixed sentence (src/core/router.ts:168).
 */
function expectDispatched(f: FakeInteraction, label: string): void {
  expect(f.replies.length + f.deferOpts.length,
    `${label}: nothing answered the click at all — no handler resolved for this prefix`)
    .toBeGreaterThan(0);
  expect(f.deferOpts, `${label}: the router acknowledged the click instead of dispatching it`)
    .toHaveLength(0);
  for (const r of f.replies) {
    expect(replyText(r), `${label}: the handler threw and the router's catch swallowed it`)
      .not.toContain('Something went wrong');
  }
}

/** Click a control that IS the surface (a button whose reply carries the next step). */
async function clickSurface(ctx: TestCtx, customId: string, label: string): Promise<FakeInteraction> {
  const b = fakeButton({ customId, user: OWNER, componentIds: [customId] });
  await routeInteraction(ctx, testRegistry, b.asInteraction());
  expectDispatched(b, label);
  return b;
}

/**
 * Submits the first option of the one select menu a reply opened, and RETURNS the
 * value it submitted so the caller can assert the handler acted on that value and
 * not on some other option it happened to find. Values are read off the real
 * payload rather than hardcoded, so the second hop stays independent of how the
 * minting module spells them.
 */
async function submitFirstOptionOfTheOnlyMenu(
  ctx: TestCtx, payload: unknown, label: string, expectedId?: string,
): Promise<string> {
  const menus = controlsOf(payload, label).filter((c) => c.type === ComponentType.StringSelect);
  expect(menus, `${label} opened no select menu, or opened more than one`).toHaveLength(1);
  const menu = menus[0]!;
  if (expectedId !== undefined) expect(menu.custom_id, `${label} opened the wrong menu`).toBe(expectedId);
  const values = (menu.options ?? []).map((o) => o.value);
  expect(values.length, `${label}: ${menu.custom_id} offered no options`).toBeGreaterThan(0);
  const picked = values[0]!;
  const submit = fakeSelect({
    customId: menu.custom_id, user: OWNER,
    values: [picked], options: values, componentIds: [menu.custom_id],
  });
  await routeInteraction(ctx, testRegistry, submit.asInteraction());
  expectDispatched(submit, `${label} → ${menu.custom_id}`);
  return picked;
}

function seedOwner(ctx: TestCtx): void {
  getOrCreateUser(ctx, OWNER, 'One');
  // One pot every fixture below spends from, rather than each computing its own
  // affordability. The shard grant is exactly MYTHIC_SHARD_COST (src/data/sell.ts),
  // and the fern stack covers many meals of the tier-1 herbivore food.
  ctx.economy.apply(OWNER, { cash: 10_000_000, shards: 500, foods: { ferns: 40 } }, 'seed', ctx.now());
}

const eggsOf = (ctx: TestCtx) =>
  ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, OWNER)).all();
const dinosOf = (ctx: TestCtx) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, OWNER)).all();
const eggRow = (ctx: TestCtx, id: number) =>
  ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, id)).get()!;
const dinoRow = (ctx: TestCtx, id: number) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;

function onlyEgg(ctx: TestCtx) {
  const eggs = eggsOf(ctx);
  expect(eggs, 'the fixture expected the surface to hand over exactly one egg').toHaveLength(1);
  return eggs[0]!;
}

function onlyDino(ctx: TestCtx) {
  const dinos = dinosOf(ctx);
  expect(dinos, 'the fixture expected exactly one dino').toHaveLength(1);
  return dinos[0]!;
}

/**
 * An egg that /hatch's crack button will hatch immediately. hatchEgg refuses only on
 * `incubationStartedAt === null`, `hatchesAt === null` and `hatchesAt > now`
 * (src/modules/hatchery/service.ts), so stamping both columns in the past is a
 * legitimate fixture. speciesId is pinned so the hatched species — and therefore its
 * DIET, which decides which paddocks are eligible below — is not an rng roll.
 * Triceratops is a common herbivore.
 */
function hatchReadyEgg(ctx: TestCtx) {
  return ctx.db.insert(schema.eggs).values({
    userId: OWNER, rarity: 'common', speciesId: 'triceratops', source: 'shop',
    obtainedAt: DAY0 - 1, incubationStartedAt: DAY0 - 1, hatchesAt: DAY0 - 1,
  }).returning().get();
}

const cashOf = (ctx: TestCtx) =>
  ctx.db.select().from(schema.users).where(eq(schema.users.discordId, OWNER)).get()!.cash;

/**
 * The first pair of adjacent UTC days on which Coastal Dig's expedition fee genuinely
 * differs. DERIVED, never written down: which day carries which world event is a function of
 * WORLD_SALT and the order of WORLD_EVENTS, so a pinned day index would go stale silently the
 * moment either changed — and a stale one would leave the staleness test comparing a price
 * against itself, passing forever while proving nothing.
 *
 * It compares the FEE, not the multiplier that scales it: expeditionFeeFor rounds and floors
 * at 1, so a moved multiplier does not by itself guarantee a moved price.
 */
function daysWhereExpeditionFeeMoves(): { before: number; after: number } {
  const cost = EXPEDITION_SITES.coastal_dig.cost;
  const feeOn = (day: number) => expeditionFeeFor(cost, eventMods(day * DAY_MS).expeditionFee);
  for (let day = 0; day < 2_000; day++) {
    if (feeOn(day) !== feeOn(day + 1)) return { before: day, after: day + 1 };
  }
  throw new Error("no adjacent UTC day pair moves Coastal Dig's fee — the fixture cannot be built");
}

/** The same, for the shop's egg price, which rolls with both the world event and the Daily Deal. */
function daysWhereEggPriceMoves(rarity: Rarity): { before: number; after: number } {
  for (let day = 0; day < 2_000; day++) {
    if (eggPriceAt(rarity, day * DAY_MS) !== eggPriceAt(rarity, (day + 1) * DAY_MS)) {
      return { before: day, after: day + 1 };
    }
  }
  throw new Error(`no adjacent UTC day pair moves eggPriceAt('${rarity}') — the fixture cannot be built`);
}

interface Step {
  /** The payload the surface rendered — what `required` and `exactly` are checked against. */
  payload: unknown;
  /** Every customId that payload MUST carry. */
  required: string[];
  /**
   * The WHOLE minted list, in order — the plan's single whole-list assertion.
   * Declared here, on the record each row's run() returns, rather than on GraphRow,
   * because the ids embed row ids the database allocates at runtime.
   */
  exactly?: string[];
  /** No minted id may start with any of these. */
  forbiddenPrefixes?: string[];
  /** The one id this row dispatches back through the router. */
  follow: string;
  /**
   * Set only on a card that mints TWO controls where `follow` spends one of them
   * (hatch:inc) — the id of the OTHER control, which that click must not delete. This is
   * the assertion this whole plan shipped without: every row here previously asserted only
   * the graph at MINT time, never what the message looks like after a follow-through is
   * taken, which is exactly how one click deleting its sibling survived 32 reviews. Set
   * this and `follow`'s click is driven with the card's REAL rendered components
   * (`realMessageComponents`) rather than the harness's id-only placeholder — the
   * placeholder would make this assertion pass for the wrong reason (see that helper).
   */
  siblingSurvivesClick?: string;
  /** Asserted after `follow` has routed. Receives the click that routed it. */
  effect(followed: FakeInteraction): Promise<void>;
}

interface GraphRow { surface: string; run(ctx: TestCtx): Promise<Step> }

/** Every Incubate row asserts the same thing about the egg it was minted for. */
const startedIncubating = (ctx: TestCtx, eggId: number) => async () => {
  expect(eggRow(ctx, eggId).incubationStartedAt,
    'the Incubate button did not start the egg incubating').not.toBeNull();
};

const GRAPH: GraphRow[] = [
  {
    surface: '/expedition claim',
    async run(ctx) {
      seedOwner(ctx);
      const exp = startExpedition(ctx, OWNER, 'coastal_dig', null);
      // returnsAt is read off the committed row, never recomputed: startExpedition
      // captures the world event's duration multiplier at start.
      ctx.setNow(exp.returnsAt);
      const cmd = fakeCommand({ name: 'expedition', sub: 'claim', user: OWNER });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      const egg = onlyEgg(ctx);
      return {
        payload: cmd.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`, `exp:again:${OWNER}:coastal_dig`],
        // Dig again first, then Incubate — Task 19 (G7-A) pushes onto the array, Task 22 (G4-D)
        // pushes after it. This is the only place that order is pinned.
        exactly: [`exp:again:${OWNER}:coastal_dig`, `hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        // This is the exact card the reviewer reproduced the Important defect on: clicking
        // Incubate replaced components with [], deleting Dig again along with the spent
        // button.
        siblingSurvivesClick: `exp:again:${OWNER}:coastal_dig`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: 'the exp:claim button',
    async run(ctx) {
      seedOwner(ctx);
      const exp = startExpedition(ctx, OWNER, 'coastal_dig', null);
      ctx.setNow(exp.returnsAt);
      const b = await clickSurface(ctx, `exp:claim:${OWNER}`, 'the exp:claim button');
      const egg = onlyEgg(ctx);
      return {
        payload: b.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`, `exp:again:${OWNER}:coastal_dig`],
        exactly: [`exp:again:${OWNER}:coastal_dig`, `hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        // Same two-control shape as /expedition claim above, minted by the same i.update in
        // the exp component handler rather than the slash command's own i.reply — the
        // Important defect's fix is shared code, but nothing pinned this surface against a
        // future edit reopening it here specifically.
        siblingSurvivesClick: `exp:again:${OWNER}:coastal_dig`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: '/shop egg',
    async run(ctx) {
      seedOwner(ctx);
      // The rotation gate runs before buyEgg and reads ratingHighWater, which is 0 for a
      // fresh user. Asserted rather than assumed, because which rarities are on offer is a
      // function of the day and would otherwise fail this row while blaming the shop reply.
      expect(dailyEggOffers(0, ctx.now()),
        'the fixture assumes common is in the rotation at high-water 0').toContain('common');
      const cmd = fakeCommand({ name: 'shop', sub: 'egg', user: OWNER, options: { rarity: 'common' } });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      const egg = onlyEgg(ctx);
      return {
        payload: cmd.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`, `shop:again:${OWNER}:common`],
        // Buy another first, then Incubate — Task 23 (G7-D) pushes, Task 26 (G4-E) pushes after it.
        exactly: [`shop:again:${OWNER}:common`, `hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        // The other card the reviewer reproduced the Important defect on, same shape as
        // /expedition claim above: clicking Incubate replaced components with [], deleting
        // Buy another along with the spent button.
        siblingSurvivesClick: `shop:again:${OWNER}:common`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: '/breed claim',
    async run(ctx) {
      seedOwner(ctx);
      // breedings.parentA/parentB deliberately carry no foreign key, and claimBreeding reads
      // both parents tolerantly (`a?.traits ?? []`), so a row inserted straight into the
      // table is a legitimate fixture — far cheaper than a Gene Lab, two fed same-rarity
      // parents in paddocks, and a real pairing. claimBreeding refuses only on a missing
      // row, an already-claimed row, and `readyAt > now`.
      ctx.db.insert(schema.breedings).values({
        userId: OWNER, parentA: 1, parentB: 2, rarity: 'common',
        startedAt: DAY0 - 1_000, readyAt: DAY0 - 1,
      }).run();
      const cmd = fakeCommand({ name: 'breed', sub: 'claim', user: OWNER });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      const egg = onlyEgg(ctx);
      return {
        payload: cmd.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`],
        exactly: [`hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: 'the breed:claim button',
    async run(ctx) {
      seedOwner(ctx);
      const breeding = ctx.db.insert(schema.breedings).values({
        userId: OWNER, parentA: 1, parentB: 2, rarity: 'common',
        startedAt: DAY0 - 1_000, readyAt: DAY0 - 1,
      }).returning().get();
      const b = await clickSurface(ctx, `breed:claim:${breeding.id}`, 'the breed:claim button');
      const egg = onlyEgg(ctx);
      return {
        payload: b.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`],
        exactly: [`hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: 'the mythic:confirm button',
    async run(ctx) {
      seedOwner(ctx);
      // The gate reads ratingHighWater, which is monotone, so writing it directly is the
      // honest fixture — a live parkRating would decay back under the gate.
      ctx.db.update(schema.users).set({ ratingHighWater: MYTHIC_UNLOCK_RATING })
        .where(eq(schema.users.discordId, OWNER)).run();
      // Derived, never a species id typed in here: the roster is data and this row has no
      // opinion about which mythic exists.
      const speciesId = mythicSpeciesChoices()[0]!.id;
      const b = await clickSurface(ctx, `mythic:confirm:${speciesId}`, 'the mythic:confirm button');
      const egg = onlyEgg(ctx);
      return {
        payload: b.replies[0],
        required: [`hatch:inc:${OWNER}:${egg.id}`],
        exactly: [`hatch:inc:${OWNER}:${egg.id}`],
        follow: `hatch:inc:${OWNER}:${egg.id}`,
        effect: startedIncubating(ctx, egg.id),
      };
    },
  },
  {
    surface: 'the hatch reveal, with exactly one eligible paddock',
    async run(ctx) {
      seedOwner(ctx);
      const lot = buildLot(ctx, OWNER, 'herbivore_paddock');
      const egg = hatchReadyEgg(ctx);
      const b = await clickSurface(ctx, `hatch:crack:${egg.id}`, 'the hatch reveal');
      const dino = onlyDino(ctx);
      return {
        payload: b.replies[0],
        required: [`park:assign:${OWNER}:${dino.id}:${lot.id}`],
        exactly: [`park:assign:${OWNER}:${dino.id}:${lot.id}`],
        follow: `park:assign:${OWNER}:${dino.id}:${lot.id}`,
        async effect() {
          expect(dinoRow(ctx, dino.id).lotId,
            'the Assign button did not put the dino in the paddock it named').toBe(lot.id);
        },
      };
    },
  },
  {
    surface: 'the hatch reveal, with several eligible paddocks',
    async run(ctx) {
      seedOwner(ctx);
      // Paddocks are duplicable by design; facilities are one per park.
      const first = buildLot(ctx, OWNER, 'herbivore_paddock');
      const second = buildLot(ctx, OWNER, 'herbivore_paddock');
      const egg = hatchReadyEgg(ctx);
      const b = await clickSurface(ctx, `hatch:crack:${egg.id}`, 'the hatch reveal');
      const dino = onlyDino(ctx);
      return {
        payload: b.replies[0],
        required: [`park:assignpick:${OWNER}:${dino.id}`],
        exactly: [`park:assignpick:${OWNER}:${dino.id}`],
        follow: `park:assignpick:${OWNER}:${dino.id}`,
        async effect(followed) {
          const picked = await submitFirstOptionOfTheOnlyMenu(
            ctx, followed.replies[0], 'the assign picker', `park:assignsel:${OWNER}:${dino.id}`);
          // Against the SUBMITTED value, not merely against the eligible set. The router's
          // submittedValuesAreOnMessage proves only that the value was OFFERED; a handler
          // that ignored i.values entirely and assigned to whichever eligible paddock it
          // found first would satisfy a membership check — and picking the right one is the
          // only thing a select adds over a button.
          //
          // A value here is a LOT id. The /build picker below is this menu's mirror and its
          // values are DINO ids; the two are easy to confuse and swapping them compiles.
          expect(dinoRow(ctx, dino.id).lotId,
            'the assign menu did not use the option that was actually submitted')
            .toBe(Number(picked));
          expect([first.id, second.id],
            'the assign menu submitted a lot that was never eligible').toContain(Number(picked));
        },
      };
    },
  },
  {
    surface: 'the hatch reveal, with no eligible paddock',
    async run(ctx) {
      seedOwner(ctx);
      // A carnivore paddock, against a herbivore hatch: this proves the DIET filter, where
      // building nothing at all would only prove the empty case.
      buildLot(ctx, OWNER, 'carnivore_paddock');
      const egg = hatchReadyEgg(ctx);
      const b = await clickSurface(ctx, `hatch:crack:${egg.id}`, 'the hatch reveal');
      onlyDino(ctx);
      return {
        payload: b.replies[0],
        // 'park:assign' is the prefix of park:assign, park:assignpick and park:assignsel
        // alike, so one entry forbids every assign shape.
        forbiddenPrefixes: ['park:assign'],
        // park:goto, never park:tab — the hatch reveal is a PUBLIC message and park:tab's
        // handler ends in renderTab's `i.update`, which would destroy the reveal and leave
        // the owner's Lots card in a public channel. park:goto replies EPHEMERALLY, which
        // is what the landmark/guests/roster targets beside it already do, for that reason.
        // Note the owner id sits at parts index 3 in a goto id, not index 2.
        required: [`park:goto:lots:${OWNER}`],
        exactly: [`park:goto:lots:${OWNER}`],
        follow: `park:goto:lots:${OWNER}`,
        async effect(followed) {
          const ids = controlsOf(followed.replies[0], 'the Lots card').map((c) => c.custom_id);
          // The Build select, not merely a reply: this pins that the goto arm hands back a
          // real Lots payload with `buildable` computed, rather than an empty card the
          // player cannot act on.
          expect(ids, 'Build a paddock did not open a Lots card carrying the Build menu')
            .toContain(`park:build:${OWNER}`);
          // lotsPayload appends a tab row on EVERY call, unlike its landmark/guests/roster
          // neighbours, so Task 15 (G5-E) strips it here. Owned by this table too, and not only
          // by that task's own file: without the strip, one tab click on this ephemeral
          // hands the player a second, parallel park dashboard.
          expect(ids.filter((id) => id.startsWith(`park:tab:${OWNER}:`)),
            'the Build a paddock ephemeral grew a tab row and became a second park dashboard')
            .toEqual([]);
        },
      };
    },
  },
  {
    surface: '/build, when the built lot is a paddock',
    async run(ctx) {
      seedOwner(ctx);
      const dino = ctx.db.insert(schema.dinos).values({
        userId: OWNER, lotId: null, speciesId: 'triceratops',
        hunger: 100, lastFedAt: DAY0, hatchedAt: DAY0,
      }).returning().get();
      const cmd = fakeCommand({ name: 'build', user: OWNER, options: { kind: 'herbivore_paddock' } });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, OWNER)).all();
      expect(lots, '/build did not build exactly one lot').toHaveLength(1);
      const lot = lots[0]!;
      return {
        payload: cmd.replies[0],
        required: [`park:builddino:${OWNER}:${lot.id}`],
        exactly: [`park:builddino:${OWNER}:${lot.id}`],
        follow: `park:builddino:${OWNER}:${lot.id}`,
        async effect(followed) {
          const picked = await submitFirstOptionOfTheOnlyMenu(
            ctx, followed.replies[0], 'the Assign a dino picker',
            `park:builddinosel:${OWNER}:${lot.id}`);
          // This menu runs the assign machinery backwards: the LOT is fixed by the customId
          // and the values are the player's unassigned diet-matching dinos, so a value here
          // is a DINO id. Pinned, because the minting task and this row would otherwise be
          // free to disagree about it silently, and a swap compiles cleanly.
          expect(picked, 'the Assign a dino menu offered a value that is not a dino id')
            .toBe(String(dino.id));
          expect(dinoRow(ctx, dino.id).lotId,
            'the Assign a dino menu did not put the dino in the lot just built').toBe(lot.id);
        },
      };
    },
  },
  {
    surface: 'the park:buildyes confirm',
    async run(ctx) {
      seedOwner(ctx);
      ctx.db.insert(schema.dinos).values({
        userId: OWNER, lotId: null, speciesId: 'triceratops',
        hunger: 100, lastFedAt: DAY0, hatchedAt: DAY0,
      }).run();
      // The Lots tab's Build… dropdown is the path /park view actively pushes players
      // toward, and it reaches buildLot through this confirm rather than through /build.
      // The trailing :0 is the lot-count anchor the handler re-reads before it builds; the
      // player owns no lots, so the id is not stale.
      const b = await clickSurface(ctx, `park:buildyes:${OWNER}:herbivore_paddock:0`,
        'the park:buildyes confirm');
      const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, OWNER)).all();
      expect(lots, 'the confirm did not build exactly one lot').toHaveLength(1);
      const lot = lots[0]!;
      // Two payloads: renderTab's i.update of the Lots tab, then the ephemeral follow-up.
      // The control cannot ride on the tab — renderTab builds AND sends that whole payload.
      expect(b.replies, 'the confirm sent no follow-up beside the Lots tab').toHaveLength(2);
      return {
        payload: b.replies[1],
        required: [`park:builddino:${OWNER}:${lot.id}`],
        exactly: [`park:builddino:${OWNER}:${lot.id}`],
        follow: `park:builddino:${OWNER}:${lot.id}`,
        async effect(followed) {
          const ids = controlsOf(followed.replies[0], 'the Assign a dino picker')
            .map((c) => c.custom_id);
          expect(ids, 'the confirm path minted an Assign button that opens no menu')
            .toContain(`park:builddinosel:${OWNER}:${lot.id}`);
        },
      };
    },
  },
  {
    surface: '/rescue',
    async run(ctx) {
      seedOwner(ctx);
      const lot = buildLot(ctx, OWNER, 'herbivore_paddock');
      const dino = ctx.db.insert(schema.dinos).values({
        userId: OWNER, lotId: lot.id, speciesId: 'triceratops',
        hunger: 0, lastFedAt: DAY0 - 1, hatchedAt: DAY0 - 1, escapedAt: DAY0 - 1,
      }).returning().get();
      const cmd = fakeCommand({ name: 'rescue', user: OWNER, options: { dino: dino.id } });
      await routeInteraction(ctx, testRegistry, cmd.asInteraction());
      // The dino MUST be in a matching paddock: rescueDino sets hunger to
      // round(50 / paddockFit), and the lotId-less fallback fit of 0.5 would put it back at
      // 100 — full — so the Feed it click would legitimately spend nothing and this row
      // would assert against a no-op. A herbivore in an undecorated herbivore paddock is
      // fit 0.75, so it comes back hungry.
      const fernsBefore = ctx.economy.getFoodInventory(OWNER).ferns ?? 0;
      return {
        payload: cmd.replies[0],
        required: [`care:feed:${OWNER}:${dino.id}`],
        exactly: [`care:feed:${OWNER}:${dino.id}`],
        follow: `care:feed:${OWNER}:${dino.id}`,
        async effect() {
          // Ferns is the tier-1 herbivore food and the pantry holds far more than one meal,
          // so feedDino's auto-pick lands on it. Feeding is a food spend, never cash, which
          // is why this button takes effect on the first click.
          const spent = fernsBefore - (ctx.economy.getFoodInventory(OWNER).ferns ?? 0);
          expect(spent, 'the Feed it button did not consume one meal of Ferns')
            .toBe(feedCostFor('common', [], ctx.now()));
        },
      };
    },
  },
  {
    surface: 'the Dig again button',
    async run(ctx) {
      seedOwner(ctx);
      const price = expeditionFeeFor(
        EXPEDITION_SITES.coastal_dig.cost, eventMods(ctx.now()).expeditionFee);
      // Read before the card opens and compared against itself afterwards: a literal here
      // would bake in both seedOwner's grant AND users.cash's schema default, and a change to
      // either would fail this line while blaming the Dig again handler.
      const cashAtOpen = cashOf(ctx);
      const b = await clickSurface(ctx, `exp:again:${OWNER}:coastal_dig`, 'the Dig again card');
      // Two steps, never one: opening the card charges nothing at all.
      expect(cashOf(ctx), 'opening the Dig again card charged the player').toBe(cashAtOpen);
      expect(activeExpedition(ctx, OWNER),
        'opening the Dig again card started an expedition').toBeUndefined();
      return {
        payload: b.replies[0],
        required: [`exp:againyes:${OWNER}:coastal_dig:${price}`],
        exactly: [`exp:againyes:${OWNER}:coastal_dig:${price}`],
        follow: `exp:againyes:${OWNER}:coastal_dig:${price}`,
        async effect() {
          expect(cashOf(ctx), 'the confirmed dig did not charge exactly the price it quoted')
            .toBe(cashAtOpen - price);
          expect(activeExpedition(ctx, OWNER),
            'the confirmed dig did not start an expedition').toBeDefined();
        },
      };
    },
  },
  {
    surface: 'the Buy another button',
    async run(ctx) {
      seedOwner(ctx);
      expect(dailyEggOffers(0, ctx.now()),
        'the fixture assumes common is in the rotation at high-water 0').toContain('common');
      const price = eggPriceAt('common', ctx.now());
      const cashAtOpen = cashOf(ctx);
      const b = await clickSurface(ctx, `shop:again:${OWNER}:common`, 'the Buy another card');
      expect(eggsOf(ctx), 'opening the Buy another card bought an egg').toHaveLength(0);
      expect(cashOf(ctx), 'opening the Buy another card charged the player').toBe(cashAtOpen);
      return {
        payload: b.replies[0],
        required: [`shop:againyes:${OWNER}:common:${price}`],
        exactly: [`shop:againyes:${OWNER}:common:${price}`],
        follow: `shop:againyes:${OWNER}:common:${price}`,
        async effect() {
          expect(cashOf(ctx), 'the confirmed purchase did not charge exactly the price it quoted')
            .toBe(cashAtOpen - price);
          expect(eggsOf(ctx), 'the confirmed purchase did not hand over an egg').toHaveLength(1);
        },
      };
    },
  },
];

describe('the follow-through graph', () => {
  for (const row of GRAPH) {
    it(`${row.surface} offers its next step, and that step routes`, async () => {
      // ctxOn, never a bare makeCtx: every cross-module control below is gated on
      // ctx.config.modules, and the harness default of {} would suppress them all silently.
      const ctx = ctxOn(DAY0);
      const step = await row.run(ctx);
      expect(step.payload, `${row.surface} recorded no reply at all`).toBeDefined();
      const minted = controlsOf(step.payload, row.surface).map((c) => c.custom_id);
      for (const id of step.required) {
        expect(minted, `${row.surface} minted ${JSON.stringify(minted)} and is missing ${id}`)
          .toContain(id);
      }
      if (step.exactly) {
        // A fixture self-check first, so a row cannot declare a `required` id its own
        // `exactly` list contradicts — that would make the two assertions below
        // unsatisfiable and the row impossible to read.
        for (const id of step.required) {
          expect(step.exactly, `${row.surface} requires ${id}, which its own exact list omits`)
            .toContain(id);
        }
        expect(minted,
          `${row.surface} minted a control list this table does not describe — a new control needs a row here, and a deleted one needs its owner back`)
          .toEqual(step.exactly);
      }
      for (const prefix of step.forbiddenPrefixes ?? []) {
        expect(minted.filter((id) => id.startsWith(prefix)),
          `${row.surface} minted a ${prefix}… control it must not offer in this state`).toEqual([]);
      }
      expect(step.required, 'this row dispatches an id it never required').toContain(step.follow);
      const click = fakeButton({ customId: step.follow, user: OWNER, componentIds: minted });
      if (step.siblingSurvivesClick) {
        // The default id-only placeholder cannot exercise this assertion — see
        // realMessageComponents for why — so this row's click gets the card's REAL rendered
        // components instead.
        (click.asInteraction() as unknown as { message: { components: unknown[] } }).message.components =
          realMessageComponents(step.payload);
      }
      await routeInteraction(ctx, testRegistry, click.asInteraction());
      expectDispatched(click, `${row.surface} → ${step.follow}`);
      if (step.siblingSurvivesClick) {
        const after = controlsOf(click.replies[0], `${row.surface} after clicking ${step.follow}`)
          .map((c) => c.custom_id);
        expect(after,
          `${row.surface}: clicking ${step.follow} deleted its sibling control ${step.siblingSurvivesClick} — a follow-through click must close only the control it spent`)
          .toContain(step.siblingSurvivesClick);
      }
      await step.effect(click);
    });
  }
});

// ---------------------------------------------------------------------------
// The price segment is the guard, not a nicety (spec §4.4). A confirm card left
// open across a UTC midnight would otherwise charge today's price under
// yesterday's label — and re-rendering the message on success is a second layer
// only, because any OTHER open message still holds the stale button
// (§repaint-is-second-layer-not-guard).
//
// Both tests MOVE THE CLOCK to a day where the price genuinely differs and then
// replay the id minted on the earlier day. Handing the handler a hand-written
// wrong price would prove that `!==` works and nothing at all about staleness, so
// each test asserts up front that its two days really do disagree.
// ---------------------------------------------------------------------------
describe('a spend confirm refuses a price that moved under it', () => {
  it('Dig again refuses a confirm minted on a day with a different expedition fee', async () => {
    const { before, after } = daysWhereExpeditionFeeMoves();
    const ctx = ctxOn(before * DAY_MS);
    seedOwner(ctx);
    const site = EXPEDITION_SITES.coastal_dig;
    const quoted = expeditionFeeFor(site.cost, eventMods(ctx.now()).expeditionFee);

    const open = `exp:again:${OWNER}:coastal_dig`;
    const card = fakeButton({ customId: open, user: OWNER, componentIds: [open] });
    await routeInteraction(ctx, testRegistry, card.asInteraction());
    const minted = controlsOf(card.replies[0], open).map((c) => c.custom_id);
    const stale = `exp:againyes:${OWNER}:coastal_dig:${quoted}`;
    expect(minted, `the card did not quote ${quoted}`).toContain(stale);

    ctx.setNow(after * DAY_MS);
    expect(expeditionFeeFor(site.cost, eventMods(ctx.now()).expeditionFee),
      'the two days must genuinely disagree about the fee, or this test proves nothing')
      .not.toBe(quoted);

    const cashBefore = cashOf(ctx);
    const click = fakeButton({ customId: stale, user: OWNER, componentIds: minted });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(cashOf(ctx), 'the stale confirm charged the player').toBe(cashBefore);
    expect(activeExpedition(ctx, OWNER),
      'the stale confirm started an expedition at the earlier day’s price').toBeUndefined();
    // Refused, but ANSWERED: a bare return paints "This interaction failed" after three
    // seconds, so the click must leave either a reply or an acknowledgement.
    expect(click.replies.length + click.deferOpts.length,
      'the stale confirm left the interaction unacknowledged').toBeGreaterThan(0);
  });

  it('Buy another refuses a confirm minted on a day with a different egg price', async () => {
    const { before, after } = daysWhereEggPriceMoves('common');
    const ctx = ctxOn(before * DAY_MS);
    seedOwner(ctx);
    // The ROTATION recheck is not what this test isolates, so both days must offer common —
    // otherwise the handler would refuse on rotation and the price guard would never run.
    expect(dailyEggOffers(0, before * DAY_MS)).toContain('common');
    expect(dailyEggOffers(0, after * DAY_MS)).toContain('common');
    const quoted = eggPriceAt('common', ctx.now());

    const open = `shop:again:${OWNER}:common`;
    const card = fakeButton({ customId: open, user: OWNER, componentIds: [open] });
    await routeInteraction(ctx, testRegistry, card.asInteraction());
    const minted = controlsOf(card.replies[0], open).map((c) => c.custom_id);
    const stale = `shop:againyes:${OWNER}:common:${quoted}`;
    expect(minted, `the card did not quote ${quoted}`).toContain(stale);

    ctx.setNow(after * DAY_MS);
    expect(eggPriceAt('common', ctx.now()),
      'the two days must genuinely disagree about the price, or this test proves nothing')
      .not.toBe(quoted);

    const cashBefore = cashOf(ctx);
    const click = fakeButton({ customId: stale, user: OWNER, componentIds: minted });
    await routeInteraction(ctx, testRegistry, click.asInteraction());

    expect(cashOf(ctx), 'the stale confirm charged the player').toBe(cashBefore);
    expect(eggsOf(ctx), 'the stale confirm bought an egg at the earlier day’s price')
      .toHaveLength(0);
    expect(click.replies.length + click.deferOpts.length,
      'the stale confirm left the interaction unacknowledged').toBeGreaterThan(0);
  });
});
