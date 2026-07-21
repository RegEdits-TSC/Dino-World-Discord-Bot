import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, activeExpedition, claimExpedition, listSites, ExpeditionError } from '../src/modules/expeditions/service.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); ctx.economy.apply('u1', { cash: 50_000 }, 'seed', 0); });

describe('expeditions', () => {
  it('lists only unlocked sites by high-water', () => {
    expect(listSites(0).map((s) => s.id)).toEqual(['coastal_dig']);
    expect(listSites(400).length).toBe(4);
  });
  it('starts an expedition, charges cost, enqueues a return timer, blocks a second start', () => {
    const exp = startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    expect(exp.returnsAt).toBe(ctx.now() + 15 * 60_000);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(500 + 50_000 - 200); // 500 starting + 50,000 seed - 200 cost
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
    expect(() => startExpedition(ctx, 'u1', 'coastal_dig', 'g1')).toThrow(ExpeditionError);
  });
  it('rejects a locked site', () => {
    expect(() => startExpedition(ctx, 'u1', 'volcano_core', 'g1')).toThrow(ExpeditionError);
  });
  it('claim before return fails; claim after return yields an egg + bonuses and unblocks the next start', () => {
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    expect(() => claimExpedition(ctx, 'u1')).toThrow(ExpeditionError);
    ctx.setNow(ctx.now() + 15 * 60_000);
    const { loot } = claimExpedition(ctx, 'u1');
    expect(['common', 'uncommon']).toContain(loot.eggRarity);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all()).toHaveLength(1);
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
  });
});
