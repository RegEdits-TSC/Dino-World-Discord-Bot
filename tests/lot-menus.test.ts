import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeButton, fakeSelect } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { parkModule } from '../src/modules/park/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

const parkComp = () => parkModule.components.find((c) => c.prefix === 'park')!;
const parkSelect = () => parkModule.selects!.find((s) => s.prefix === 'park')!;
const cashOf = (id: string) =>
  ctx.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;

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
