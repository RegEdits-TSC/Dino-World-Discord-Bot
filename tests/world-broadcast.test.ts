import { describe, it, expect } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { worldBroadcastHandler, armWorldBroadcast, WORLD_TIMER } from '../src/modules/world/broadcast.js';

const DAY = 86_400_000;

function fakeSender() {
  const channel: Array<{ channelId: string; payload: unknown }> = [];
  const dm: Array<{ userId: string; payload: unknown }> = [];
  return {
    channel, dm,
    channelSend: async (channelId: string, payload: unknown) => { channel.push({ channelId, payload }); },
    dmSend: async (userId: string, payload: unknown) => { dm.push({ userId, payload }); },
  };
}

describe('the world broadcast', () => {
  it('posts only to guilds that opted in AND have a channel', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    ctx.db.insert(schema.guildSettings).values([
      { guildId: 'g-in',      notifyChannelId: 'c1',  worldBroadcast: true },
      { guildId: 'g-out',     notifyChannelId: 'c2',  worldBroadcast: false },
      { guildId: 'g-nochan',  notifyChannelId: null,  worldBroadcast: true },
    ]).run();
    const s = fakeSender();
    await worldBroadcastHandler(s, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null });
    expect(s.channel.map((c) => c.channelId)).toEqual(['c1']);
  });

  it('never sends a DM', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g', notifyChannelId: 'c', worldBroadcast: true }).run();
    const s = fakeSender();
    await worldBroadcastHandler(s, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null });
    expect(s.dm).toEqual([]);
  });

  it('re-arms itself for the next UTC midnight', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY + 1000 });
    const s = fakeSender();
    await worldBroadcastHandler(s, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null });
    const timers = ctx.db.select().from(schema.timers).all();
    expect(timers.filter((t) => t.kind === WORLD_TIMER).map((t) => t.firesAt)).toEqual([6 * DAY]);
  });

  it('re-arms even when a channel send throws', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    ctx.db.insert(schema.guildSettings).values([
      { guildId: 'g1', notifyChannelId: 'bad', worldBroadcast: true },
      { guildId: 'g2', notifyChannelId: 'ok',  worldBroadcast: true },
    ]).run();
    const s = fakeSender();
    const throwing = { ...s, channelSend: async (id: string, p: unknown) => {
      if (id === 'bad') throw new Error('channel gone');
      return s.channelSend(id, p);
    } };
    await expect(worldBroadcastHandler(throwing, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null })).resolves.toBeUndefined();
    expect(s.channel.map((c) => c.channelId)).toEqual(['ok']);
    expect(ctx.db.select().from(schema.timers).all().filter((t) => t.kind === WORLD_TIMER)).toHaveLength(1);
  });

  it('arms exactly once however many times boot runs', () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    armWorldBroadcast(ctx);
    armWorldBroadcast(ctx);
    armWorldBroadcast(ctx);
    expect(ctx.db.select().from(schema.timers).all().filter((t) => t.kind === WORLD_TIMER)).toHaveLength(1);
  });

  it('survives adminReset of an arbitrary player', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });
    armWorldBroadcast(ctx);
    const { getOrCreateUser } = await import('../src/modules/park/service.js');
    const { adminReset } = await import('../src/modules/admin/service.js');
    getOrCreateUser(ctx, 'u1', 'U1');
    adminReset(ctx, 'u1');
    expect(ctx.db.select().from(schema.timers).all().filter((t) => t.kind === WORLD_TIMER)).toHaveLength(1);
  });
});
