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
    // u2 owns an egg of their own. It is here as the BACKSTOP assertion: incubateEgg
    // filters on (id, CALLER), so even with the owner check deleted u2's own egg is
    // never started. That assertion stays green in Step 3 on purpose — it pins that
    // the service filter really is the second layer this guard is allowed to lean on.
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
