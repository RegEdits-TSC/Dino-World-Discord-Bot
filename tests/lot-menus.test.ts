import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeButton, fakeSelect, replyText } from './harness.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { parkModule } from '../src/modules/park/index.js';
import { lotsPayload } from '../src/modules/park/embeds.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

const parkComp = () => parkModule.components.find((c) => c.prefix === 'park')!;
const parkSelect = () => parkModule.selects!.find((s) => s.prefix === 'park')!;
const cashOf = (id: string) =>
  ctx.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;
const fieldsOf = (p: { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }) =>
  p.embeds[0].toJSON().fields ?? [];
// Reads the FIRST string-select component minted on a builder's `components` array —
// discord.js's toJSON() uses ComponentType.StringSelect === 3, distinguishing it from a
// button row's ComponentType.Button === 2. The Lots tab can mint TWO (Build, then
// Upgrade), so every case using this helper either seeds a state where only one of them
// survives its filter or asserts on the id it got back; a case that needs both filters
// the rows itself (see 'mints no build menu once every lot slot is used'). Undefined when
// no select was minted, which is itself the assertion in the visited cases below.
const selectOf = (rows: ReadonlyArray<{ toJSON(): { components: Array<{ type: number; custom_id?: string; options?: Array<{ value: string }> }> } }>) =>
  rows.flatMap((r) => r.toJSON().components).find((c) => c.type === 3) as
    { custom_id: string; options: Array<{ value: string }> } | undefined;

describe('build menu', () => {
  it('asks for confirmation rather than spending on the selection itself', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1',
      values: ['carnivore_paddock'], options: ['carnivore_paddock'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    const json = JSON.stringify(s.replies[0]);
    // Four segments, not three: the trailing 0 is the lot COUNT this confirm was minted
    // against — u1 owns none yet. It is what makes the id single-use (see the
    // double-click case below), so pinning the bare three-segment prefix here would let
    // the anchor be dropped from the mint with every assertion in this file still green.
    expect(json).toContain('park:buildyes:u1:carnivore_paddock:0');
    expect(json).toContain('park:buildno:u1');
    // Without these three the confirm can ship with no tab row, no attachments: [] and
    // no content, and every other assertion in this file still passes. The tab row keeps
    // the player from being one click from losing navigation mid-purchase; attachments: []
    // sheds the Lots tab's banners/lots.webp, which would otherwise strand as an orphan
    // attachment card; content: '' clears any result line left over from a previous action.
    expect(json).toContain('park:tab:u1:park');
    expect((s.replies[0] as { attachments?: unknown[] }).attachments).toEqual([]);
    expect((s.replies[0] as { content?: string }).content).toBe('');
  });

  // The case above mints against a park with no lots, where `:0` is also what a hardcoded
  // constant would produce. This one seeds a lot first, so only a live read passes.
  it('anchors the confirm to the live lot count, not a constant', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.insert(schema.lots).values({
      userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
    }).run();
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1',
      values: ['herbivore_paddock'], options: ['herbivore_paddock'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(JSON.stringify(s.replies[0])).toContain('park:buildyes:u1:herbivore_paddock:1');
  });

  it('builds only after the confirm click', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:0', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBeLessThan(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(1);
  });

  // The park:upgyes stale-button case's twin, and the reason the count anchor exists at
  // all. Two clicks landing before the first repaint both pass the owner check and both
  // pass the allowlist; for a FACILITY the second is stopped by DuplicateFacilityError,
  // but paddocks are duplicable by design, so without an anchor the second click builds a
  // second one. lotSlots caps at 10 and this codebase has no demolish path outside
  // adminReset, so the loss is a permanent slot, not the 2,000 cash.
  it('refuses a second click of the same build button and builds no second paddock', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const first = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:0', user: 'u1' });
    await parkComp().execute(ctx, first.asInteraction() as never);
    const afterFirst = cashOf('u1');
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(1);
    const second = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:0', user: 'u1' });
    await parkComp().execute(ctx, second.asInteraction() as never);
    expect(cashOf('u1')).toBe(afterFirst);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(1);
    // Pins the FIGURES, exactly as the upgrade twin does. 'no longer valid' belongs to the
    // allowlist and integer-parse branches, so asserting it here would go red against a
    // correct implementation — and the two counts are the only part of the message telling
    // the player what actually changed.
    expect(JSON.stringify(second.replies[0])).toContain('has 1 lot now, not 0');
    expect(second.deferOpts).toEqual([]);
  });

  it('refuses a non-integer lot-count anchor without touching the database', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:notanumber', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(0);
    // Fixes which guard is under test: with Number.isInteger removed, `offeredCount` is
    // NaN and `lotCount !== NaN` is always true, so the count check would swallow this and
    // the parse guard would go untested — the upgrade side's reasoning, verbatim.
    expect(JSON.stringify(b.replies[0])).toContain('no longer valid');
    expect(b.deferOpts).toEqual([]);
  });

  it('rejects a prototype key at the handler, before buildLot is reached', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    // `:0` is the CORRECT count for a player with no lots, so the count anchor cannot be
    // what rejects this — the allowlist is, which is the guard this case exists for.
    const b = fakeButton({ customId: 'park:buildyes:u1:constructor:0', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(0);
    expect(JSON.stringify(b.replies[0])).toContain('no longer valid');
  });

  it('rejects a value the minted menu never offered', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1',
      values: ['gene_lab'], options: ['carnivore_paddock'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(s.deferOpts).toEqual([{ kind: 'update' }]);
    expect(s.replies).toEqual([]);
  });

  // Cancel had no coverage on either menu: `park:buildno` was asserted only as a string
  // the confirm MINTS, and `park:upgno` appeared in tests/ nowhere at all. Deleting
  // `case 'buildno': case 'upgno':` left the whole suite green — the clicks then fell to
  // the switch's `default: await i.deferUpdate()` and Cancel became a silent no-op,
  // stranding the player on a confirm card with a live Yes and a dead Cancel.
  it('returns Cancel to a freshly rendered Lots tab rather than acknowledging silently', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:buildno:u1', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    // deferOpts first, deliberately: it is the assertion that goes red when the case is
    // deleted, and it reads as a clean diff. A deleted case falls to the switch's
    // `default: await i.deferUpdate()`, which records there and sends no payload at all.
    // The Build menu below then proves what WAS sent is the Lots tab, not some other card.
    expect(b.deferOpts).toEqual([]);
    expect(JSON.stringify(b.replies[0])).toContain('park:build:u1');
  });

  it('refuses a stranger driving the menu', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u2', values: ['gene_lab'], options: ['gene_lab'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(JSON.stringify(s.replies[0])).toContain('Not your park');
  });
});

// The five cases above all drive the SELECT HANDLER against a fakeSelect whose menu the
// harness fabricates (tests/harness.ts) — never a menu lotsPayload actually produced. Every
// pre-existing lotsPayload call in the suite (tests/park-tabs.test.ts, tests/park.test.ts,
// tests/router.test.ts) omits `buildable`, so the MINT side — the customId shape, that the
// option value is the kind (not the label), the visited-card suppression, the owned-facility
// filter and the slot-cap path, all in src/modules/park/embeds.ts and the renderTab lots
// branch in src/modules/park/index.ts — was covered by nothing. These four cases close that.
describe('build menu mint', () => {
  it('mints the select menu with the kind as the option value, not the label', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = lotsPayload(user, [], 3, {
      buildable: [{ kind: 'gene_lab', name: 'Gene Lab', cost: 5_000 }],
    });
    const select = selectOf(p.components);
    expect(select?.custom_id).toBe('park:build:u1');
    // The label carries the cost ("Gene Lab — 5,000 cash"); only `value` is read back by
    // the handler, so it must be the bare kind and nothing else.
    expect(select?.options.map((o) => o.value)).toEqual(['gene_lab']);
  });

  it('suppresses the menu and the Building hint on a visited card', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = lotsPayload(user, [], 3, {
      buildable: [{ kind: 'gene_lab', name: 'Gene Lab', cost: 5_000 }], visit: true,
    });
    expect(selectOf(p.components)).toBeUndefined();
    expect(fieldsOf(p).some((f) => f.name === 'Building')).toBe(false);
  });

  it('renderTab wires the owned-facility filter into the minted menu', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.insert(schema.lots).values({
      userId: 'u1', type: 'facility', kind: 'gene_lab', name: 'Gene Lab', level: 1,
    }).run();
    const b = fakeButton({ customId: 'park:tab:u1:lots', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as {
      components: ReadonlyArray<{ toJSON(): { components: Array<{ type: number; custom_id?: string; options?: Array<{ value: string }> }> } }>;
    };
    const select = selectOf(sent.components);
    const values = select!.options.map((o) => o.value);
    // Paddocks are duplicable, so both stay offered; gene_lab is the one facility the
    // player already owns and must not be offered a second time.
    expect(values).toContain('carnivore_paddock');
    expect(values).toContain('herbivore_paddock');
    expect(values).not.toContain('gene_lab');
  });

  it('mints no build menu once every lot slot is used', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // BASE_LOT_SLOTS_FALLBACK is 3 at ratingHighWater 0 — three paddocks (duplicable, so
    // this needs no facility juggling) fill every slot with no rating gain required.
    for (let n = 0; n < 3; n++) {
      ctx.db.insert(schema.lots).values({
        userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
      }).run();
    }
    const b = fakeButton({ customId: 'park:tab:u1:lots', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as {
      components: ReadonlyArray<{ toJSON(): { components: Array<{ type: number; custom_id?: string }> } }>;
    };
    // Slots are full, so no Build select — but these three level-1 paddocks are still each
    // upgradable, so the Upgrade select IS present. Narrowed from "no select at all" (the
    // right assertion when Build was the only menu kind) to "no Build select specifically",
    // now that Task 2's Upgrade menu shares this tab.
    const selects = sent.components.flatMap((r) => r.toJSON().components).filter((c) => c.type === 3);
    expect(selects.some((c) => c.custom_id === 'park:build:u1')).toBe(false);
  });
});

// The BUILD CONFIRM button, not the menu: park:buildyes is what reaches buildLot, and
// buildLot's slot-cap throw is the only way to observe the LotLimitError message at all.
// §5.2. LotLimitError carries no message and means two different things (slot cap in
// buildLot, already-max-level in upgradeLot), so this block pins the BUILD half only.
describe('build confirm', () => {
  it('names the slot, its threshold and BOTH ratings when slots remain locked', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (let n = 0; n < 7; n++) {
      ctx.db.insert(schema.lots).values({
        userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
      }).run();
    }
    // lotSlots(640) is 7, so seven lots fill the cap and nextLotSlot(640) is slot 8 at 800.
    // parkRating sits BELOW ratingHighWater deliberately: the gate reads the high-water, and
    // rendering one figure twice is the mistake this case exists to catch.
    ctx.db.update(schema.users)
      .set({ cash: 10_000_000, parkRating: 620, ratingHighWater: 640 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:7', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    // The WHOLE line, never a substring holding one of the four numbers: three of them are
    // one decimal place apart, so a substring assertion on any one of them passes a sentence
    // that quotes another wrongly.
    expect(replyText(b.replies[0]))
      .toBe("All lots full (7/7). Slot 8 unlocks at ★8.0 — you're at ★6.2 (best ★6.4).");
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(7);
  });

  it('says every slot is unlocked once the threshold ladder is exhausted', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (let n = 0; n < 10; n++) {
      ctx.db.insert(schema.lots).values({
        userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
      }).run();
    }
    // 950 is the last rung, so nextLotSlot returns null and the sentence must not promise a
    // slot 11 that LOT_SLOT_THRESHOLDS has no rung for.
    ctx.db.update(schema.users)
      .set({ cash: 10_000_000, parkRating: 950, ratingHighWater: 950 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:10', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0])).toBe('All lots full (10/10) — every slot is unlocked.');
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(10);
  });

  it('reads the lot COUNT and the CAP from different sources', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Eight rows against a cap of seven. This state is NOT reachable through buildLot —
    // ratingHighWater is monotone so the cap never falls, and lot rows only ever grow — and
    // that is exactly why the row is here. At every reachable state the two halves of the
    // slash are EQUAL (buildLot throws at `lots.length >= lotSlots(hw)`), so without one
    // row where they differ, `${lots}/${cap}` could be written `${lots}/${lots}` or
    // `${cap}/${cap}` and every other case in this block would still pass.
    for (let n = 0; n < 8; n++) {
      ctx.db.insert(schema.lots).values({
        userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
      }).run();
    }
    ctx.db.update(schema.users)
      .set({ cash: 10_000_000, parkRating: 620, ratingHighWater: 640 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock:8', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0]))
      .toBe("All lots full (8/7). Slot 8 unlocks at ★8.0 — you're at ★6.2 (best ★6.4).");
  });
});

describe('upgrade menu', () => {
  const seedLot = (level: number) => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 100_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    return ctx.db.insert(schema.lots).values({
      userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level,
    }).returning().get();
  };

  it('carries the level it was minted for in the option value', async () => {
    const lot = seedLot(1);
    const s = fakeSelect({
      customId: 'park:upgrade:u1', user: 'u1',
      values: [`${lot.id}:1`], options: [`${lot.id}:1`],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    const json = JSON.stringify(s.replies[0]);
    expect(json).toContain(`park:upgyes:u1:${lot.id}:1`);
    // The Cancel half was minted here and asserted nowhere — see the buildno/upgno
    // handler cases for what that cost.
    expect(json).toContain('park:upgno:u1');
  });

  // The buildno twin. Both ids share one `case`, so this pins that the SHARED arm is
  // reached from the upgrade side too rather than only from the build side.
  it('returns upgrade Cancel to a freshly rendered Lots tab', async () => {
    seedLot(1);
    const b = fakeButton({ customId: 'park:upgno:u1', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(b.deferOpts).toEqual([]);
    expect(JSON.stringify(b.replies[0])).toContain('park:build:u1');
  });

  it('upgrades once when the level still matches', async () => {
    const lot = seedLot(1);
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const after = ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!;
    expect(after.level).toBe(2);
  });

  // The park:landmark:buy incident, in its new home. Worst measured case is 90x.
  it('refuses a stale button and charges nothing', async () => {
    const lot = seedLot(1);
    const first = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, first.asInteraction() as never);
    const afterFirst = cashOf('u1');
    // The same button clicked again: its label still says level 1 to 2, but the lot is
    // level 2 now and upgradeCostFor would charge the level-2 price.
    const second = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, second.asInteraction() as never);
    expect(cashOf('u1')).toBe(afterFirst);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(2);
    // Pins the FIGURES, not a loose phrase. 'no longer' appears only on the non-integer
    // branch and in the build handler, so asserting it here goes red against a CORRECT
    // implementation — and the two obvious repairs are both wrong: loosening the
    // assertion is this repo's recurring substring trap, and rewriting the handler to
    // say 'no longer' drops the two levels, which are the only part telling the player
    // what actually changed.
    expect(JSON.stringify(second.replies[0])).toContain('is level 2 now, not 1');
  });

  it('refuses a forged lot id belonging to someone else', async () => {
    seedLot(1);
    getOrCreateUser(ctx, 'u2', 'Other');
    const theirs = ctx.db.insert(schema.lots).values({
      userId: 'u2', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
    }).returning().get();
    const b = fakeButton({ customId: `park:upgyes:u1:${theirs.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, theirs.id)).get()!.level).toBe(1);
    // Positive assertions, without which this case CANNOT FAIL under any implementation:
    // upgradeLot is itself scoped by userId, so the state assertion above passes whether
    // or not the handler's own fresh read is scoped — and it passed before the `upgyes`
    // case existed at all, when the click still fell through to the park component
    // switch's `default: await i.deferUpdate()` arm and wrote nothing. Pinning the
    // message text and the absence of a defer is what distinguishes the three.
    expect(JSON.stringify(b.replies[0])).toContain('No such lot');
    expect(b.deferOpts).toEqual([]);
  });

  it('refuses a non-integer level anchor without touching the database', async () => {
    const lot = seedLot(1);
    const before = cashOf('u1');
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:notanumber`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(1);
    // Same reason as the forged-lot case: the state assertions above are already true
    // before this feature exists. This one also fixes which guard is under test — with
    // Number.isInteger removed, `expected` is NaN and `lot.level !== NaN` is always true,
    // so the stale check would cover it and the parse guard would go untested.
    expect(JSON.stringify(b.replies[0])).toContain('no longer valid');
    expect(b.deferOpts).toEqual([]);
  });

  it('names the cap and the capacity when the lot is already at max level', async () => {
    const lot = seedLot(4);   // paddock max level; seedLot also gives u1 100,000,000 cash
    const before = cashOf('u1');
    // The anchor matches the fresh read, so the handler's own staleness pre-check passes and
    // the click reaches upgradeLot — which is what throws LotLimitError. Anchoring anything
    // else would test the pre-check instead and never exercise this message.
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:4`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0])).toBe('Already max level (4) — that paddock holds 8.');
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(4);
  });
});

// Same gap as the build menu's own mint block above, for the same reason: every case in
// the block above drives the SELECT/BUTTON HANDLERS against fixtures the harness
// fabricates, never a menu lotsPayload actually produced, and never renderTab's own
// `upgradable` computation. These three close that for the upgrade menu.
describe('upgrade menu mint', () => {
  it('mints the select menu with <lotId>:<expectedLevel> as the option value', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = lotsPayload(user, [], 3, {
      upgradable: [{ lotId: 42, name: 'Carnivore Paddock', level: 1, cost: 12_000 }],
    });
    const select = selectOf(p.components);
    expect(select?.custom_id).toBe('park:upgrade:u1');
    // The label carries the cost and the target level; only `value` is read back by the
    // handler, so it must be exactly `<lotId>:<level>` and nothing else.
    expect(select?.options.map((o) => o.value)).toEqual(['42:1']);
  });

  it('suppresses the upgrade menu on a visited card', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = lotsPayload(user, [], 3, {
      upgradable: [{ lotId: 42, name: 'Carnivore Paddock', level: 1, cost: 12_000 }], visit: true,
    });
    expect(selectOf(p.components)).toBeUndefined();
  });

  it('renderTab excludes a lot already at max level from the minted options', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Three lots fills every slot at ratingHighWater 0 (BASE_LOT_SLOTS_FALLBACK 3), which
    // empties `buildable` and leaves the Upgrade menu the only select on the card — so
    // selectOf (first-match) is unambiguous without a second helper.
    const below = ctx.db.insert(schema.lots).values({
      userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
    }).returning().get();
    // gene_lab's maxLevel is 3 (src/data/facilities.ts) — seeded already there so it must
    // be filtered OUT, covering both the `upgradable` filter itself and the renderTab call
    // site, neither of which a direct lotsPayload call can reach.
    const geneLab = ctx.db.insert(schema.lots).values({
      userId: 'u1', type: 'facility', kind: 'gene_lab', name: 'Gene Lab', level: 3,
    }).returning().get();
    ctx.db.insert(schema.lots).values({
      userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock', level: 1,
    }).run();
    const b = fakeButton({ customId: 'park:tab:u1:lots', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as {
      components: ReadonlyArray<{ toJSON(): { components: Array<{ type: number; custom_id?: string; options?: Array<{ value: string }> }> } }>;
    };
    const select = selectOf(sent.components);
    expect(select?.custom_id).toBe('park:upgrade:u1');
    const values = select!.options.map((o) => o.value);
    expect(values).toContain(`${below.id}:1`);
    expect(values.some((v) => v.startsWith(`${geneLab.id}:`))).toBe(false);
  });
});

describe('confirm-button insufficiency messages', () => {
  it('park:buildyes names the building and quotes the shortfall', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 0 }).where(eq(schema.users.discordId, 'u1')).run();
    // The trailing :0 is the lot-count anchor the handler validates against a fresh read
    // before entering the try — the player owns no lots, so the id is not stale and the
    // handler reaches buildLot rather than the count-mismatch refusal above it.
    const b = fakeButton({ customId: 'park:buildyes:u1:herbivore_paddock:0', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0]))
      .toBe('Not enough cash — the Herbivore Paddock costs 2,000, you have 0 (2,000 short).');
    expect(cashOf('u1')).toBe(0);
  });

  it('park:upgyes quotes the shortfall for the level the button was minted at', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');   // level 1
    ctx.db.update(schema.users).set({ cash: 0 }).where(eq(schema.users.discordId, 'u1')).run();
    // herbivore_paddock L1 -> L2 is round(2,000 x 2.5) = 5,000 (upgradeCostFor). The trailing
    // :1 is the expected-level anchor the handler checks against a fresh read before the try.
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(replyText(b.replies[0]))
      .toBe('Not enough cash — that upgrade costs 5,000, you have 0 (5,000 short).');
    expect(cashOf('u1')).toBe(0);
  });
});
