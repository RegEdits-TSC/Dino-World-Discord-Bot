import { describe, it, expect } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { eggHatchHandler, expeditionReturnHandler, clientSender, type Sender, type NotifyPayload } from '../src/core/notify.js';

function capture() {
  const dms: NotifyPayload[] = [];
  const sender: Sender = {
    channelSend: async () => { throw new Error('no channel configured in these tests'); },
    dmSend: async (_userId, payload) => { dms.push(payload); },
  };
  return { dms, sender };
}

describe('scheduler notification handlers', () => {
  it('eggHatchHandler notifies for a live egg and skips a deleted one', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'rare', source: 'shop', obtainedAt: 0 }).returning().get();
    const { dms, sender } = capture();
    const handler = eggHatchHandler(sender, ctx);
    await handler({ userId: 'u1', refId: egg.id, originGuildId: null });
    expect(dms).toHaveLength(1);
    expect(dms[0]).toContain('rare egg is ready to hatch');
    ctx.db.delete(schema.eggs).run();
    await handler({ userId: 'u1', refId: egg.id, originGuildId: null });
    expect(dms).toHaveLength(1);   // skip-guard: no ping for a consumed egg
  });
  it('expeditionReturnHandler notifies unclaimed and skips claimed', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const exp = ctx.db.insert(schema.expeditions)
      .values({ userId: 'u1', siteId: 'coastal_dig', departedAt: 0, returnsAt: 1 }).returning().get();
    const { dms, sender } = capture();
    const handler = expeditionReturnHandler(sender, ctx);
    await handler({ userId: 'u1', refId: exp.id, originGuildId: null });
    expect(dms).toHaveLength(1);
    expect(dms[0]).toContain('has returned');
    ctx.db.update(schema.expeditions).set({ claimedAt: 2 }).run();
    await handler({ userId: 'u1', refId: exp.id, originGuildId: null });
    expect(dms).toHaveLength(1);
  });
  it('handlers never throw, even when delivery fails', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const hostile: Sender = {
      channelSend: async () => { throw new Error('x'); },
      dmSend: async () => { throw new Error('y'); },
    };
    await expect(eggHatchHandler(hostile, ctx)({ userId: 'u1', refId: egg.id, originGuildId: null }))
      .resolves.toBeUndefined();
  });
});

describe('clientSender', () => {
  it('sends to a text channel and rejects non-sendable channels', async () => {
    const sent: string[] = [];
    const fakeClient = {
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (c: string) => { sent.push(c); } }) },
      users: { fetch: async () => ({ send: async (c: string) => { sent.push(`dm:${c}`); } }) },
    };
    const s = clientSender(fakeClient as never);
    await s.channelSend('c1', 'hello');
    expect(sent).toEqual(['hello']);
    await s.dmSend('u1', 'direct');
    expect(sent).toEqual(['hello', 'dm:direct']);
    const badClient = { channels: { fetch: async () => ({ isTextBased: () => false }) } };
    await expect(clientSender(badClient as never).channelSend('c1', 'x')).rejects.toThrow('not sendable');
  });
});
