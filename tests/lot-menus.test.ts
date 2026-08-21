import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeButton, fakeSelect } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
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
// Reads the (at most one) string-select component minted on a builder's `components`
// array — discord.js's toJSON() uses ComponentType.StringSelect === 3, distinguishing it
// from a button row's ComponentType.Button === 2. Undefined when no select was minted,
// which is itself the assertion in the visited/slot-cap cases below.
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
    expect(json).toContain('park:buildyes:u1:carnivore_paddock');
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

  it('builds only after the confirm click', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBeLessThan(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(1);
  });

  it('rejects a prototype key at the handler, before buildLot is reached', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const b = fakeButton({ customId: 'park:buildyes:u1:constructor', user: 'u1' });
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
      components: ReadonlyArray<{ toJSON(): { components: Array<{ type: number }> } }>;
    };
    expect(selectOf(sent.components)).toBeUndefined();
  });
});
