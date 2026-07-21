import { describe, it, expect } from 'vitest';
import { makeCtx } from './harness.js';
import { deliverNotification, type Sender } from '../src/core/notify.js';
import { schema } from '../src/core/db/index.js';

const mkSender = (opts: { channelFails?: boolean; dmFails?: boolean } = {}): Sender & { calls: string[] } => {
  const calls: string[] = [];
  return { calls,
    async channelSend(c) { calls.push(`channel:${c}`); if (opts.channelFails) throw new Error('x'); },
    async dmSend(u) { calls.push(`dm:${u}`); if (opts.dmFails) throw new Error('x'); } };
};

describe('deliverNotification', () => {
  it('uses the configured guild channel when set', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g1', notifyChannelId: 'c1' }).run();
    const s = mkSender();
    await deliverNotification(s, ctx, 'u1', 'g1', 'hi');
    expect(s.calls).toEqual(['channel:c1']);
  });
  it('falls back to DM when no channel configured', async () => {
    const ctx = makeCtx(); const s = mkSender();
    await deliverNotification(s, ctx, 'u1', 'g1', 'hi');
    expect(s.calls).toEqual(['dm:u1']);
  });
  it('falls back to DM when the channel throws, then silent when DM throws (never throws)', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g1', notifyChannelId: 'c1' }).run();
    const s = mkSender({ channelFails: true, dmFails: true });
    await deliverNotification(s, ctx, 'u1', 'g1', 'hi');
    expect(s.calls).toEqual(['channel:c1', 'dm:u1']);
  });
});
