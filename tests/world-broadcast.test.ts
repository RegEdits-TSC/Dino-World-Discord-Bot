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

  it('re-arms from ctx.now(), not from the missed firesAt, after a multi-day gap', async () => {
    // Distinguishes the shipped `nextMidnight(ctx.now())` from the forbidden
    // `t.firesAt + DAY_MS`: every other re-arm fixture keeps nowMs and firesAt
    // on the same UTC day, so both forms land on 6*DAY there. A restart after
    // a multi-day outage is the case where they diverge — firesAt is stale at
    // 5*DAY, but real time has moved to partway through day 8, so the correct
    // re-arm is the next midnight after NOW (9*DAY), not firesAt+DAY_MS (6*DAY).
    const ctx = makeCtx({ nowMs: 8 * DAY + 500 });
    // Also seed an opted-in guild with a channel, so the sent PAYLOAD (not
    // just the re-arm) is exercised here — this is otherwise the only
    // fixture in the file where nowMs and firesAt fall on different days, and
    // no existing test reads the sent payload at all. Day 5 (the stale
    // firesAt) is Heat Wave; day 8 (ctx.now()) is Cold Snap — genuinely
    // different events, verified via worldEventFor, not assumed.
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g', notifyChannelId: 'c', worldBroadcast: true }).run();
    const s = fakeSender();
    await worldBroadcastHandler(s, ctx)({ id: 1, kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY, handledAt: null });
    const timers = ctx.db.select().from(schema.timers).all();
    expect(timers.filter((t) => t.kind === WORLD_TIMER).map((t) => t.firesAt)).toEqual([9 * DAY]);
    const sent = s.channel[0].payload as { embeds: Array<{ toJSON(): { title?: string } }> };
    expect(sent.embeds[0].toJSON().title).toContain('Cold Snap');      // ctx.now()'s (day 8) event
    expect(sent.embeds[0].toJSON().title).not.toContain('Heat Wave');  // firesAt's (day 5) event — must not leak in
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

  it('converges two pending timers to one instead of compounding, when both fire in the same tick', async () => {
    // world_broadcast is the repo's first SELF-rescheduling timer kind: handling
    // one always enqueues its own successor, so — unlike the other three kinds,
    // which degrade to at most one duplicate message per stray fire — an
    // unguarded re-arm here doubles the pending count on every fire (2 -> 4 ->
    // 8 ...) instead of converging. This mirrors two bot processes racing the
    // same due timer (this repo's CLAUDE.md: exactly one instance per token,
    // but the DB itself does not enforce it): seed two pending rows directly,
    // then drain them through the real Scheduler — which marks handledAt
    // sequentially after each handler resolves, exactly as production does —
    // rather than invoking the handler function twice by hand.
    const ctx = makeCtx({ nowMs: 5 * DAY });
    const s = fakeSender();
    ctx.scheduler.enqueue({ kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY });
    ctx.scheduler.enqueue({ kind: WORLD_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt: 5 * DAY });
    ctx.scheduler.register(WORLD_TIMER, worldBroadcastHandler(s, ctx));
    const fired = await ctx.scheduler.tick(ctx.now());
    expect(fired).toBe(2);
    const pending = ctx.db.select().from(schema.timers).all()
      .filter((t) => t.kind === WORLD_TIMER && t.handledAt === null);
    expect(pending).toHaveLength(1);
  });

  it('arms exactly once however many times boot runs, and ignores a decoy timer of a different kind', () => {
    // A regression that dropped the `kind` clause from armWorldBroadcast's
    // guard would still pass against an empty timers table; production
    // routinely has other pending kinds (egg_hatch, expedition_return,
    // breeding_ready) at boot, so seed one to make that failure mode real.
    const ctx = makeCtx({ nowMs: 5 * DAY });
    ctx.scheduler.enqueue({ kind: 'egg_hatch', userId: 'u1', refId: 7, originGuildId: null, firesAt: 6 * DAY });
    armWorldBroadcast(ctx);
    armWorldBroadcast(ctx);
    armWorldBroadcast(ctx);
    const timers = ctx.db.select().from(schema.timers).all();
    expect(timers.filter((t) => t.kind === WORLD_TIMER)).toHaveLength(1);
    expect(timers.filter((t) => t.kind === 'egg_hatch')).toEqual([
      { id: expect.any(Number), kind: 'egg_hatch', userId: 'u1', refId: 7, originGuildId: null, firesAt: 6 * DAY, handledAt: null },
    ]);
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
