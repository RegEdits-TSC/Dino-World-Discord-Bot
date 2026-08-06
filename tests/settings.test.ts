import { describe, it, expect } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, replyText } from './harness.js';
import { settingsModule } from '../src/modules/settings/index.js';
import { schema } from '../src/core/db/index.js';

const cmd = settingsModule.commands[0];

describe('/settings channel', () => {
  it('refuses outside a guild, ephemeral', async () => {
    const ctx = makeCtx();
    const i = fakeCommand({ name: 'settings', sub: 'channel', user: 'u1', options: { channel: 'chan1' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Use this in a server');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.guildSettings).all()).toHaveLength(0);
  });
  it('inserts then updates the notify channel for a guild', async () => {
    const ctx = makeCtx();
    const first = fakeCommand({ name: 'settings', sub: 'channel', user: 'u1', guild: 'g1', options: { channel: 'chanA' } });
    await cmd.execute(ctx, first.asChatInput());
    expect(replyText(first.replies[0])).toContain('<#chanA>');
    expect(ctx.db.select().from(schema.guildSettings).all()).toEqual([
      { guildId: 'g1', notifyChannelId: 'chanA', worldBroadcast: false },
    ]);
    const second = fakeCommand({ name: 'settings', sub: 'channel', user: 'u1', guild: 'g1', options: { channel: 'chanB' } });
    await cmd.execute(ctx, second.asChatInput());
    expect(ctx.db.select().from(schema.guildSettings).all()).toEqual([
      { guildId: 'g1', notifyChannelId: 'chanB', worldBroadcast: false },
    ]);
  });
});

describe('/settings world-news', () => {
  it('refuses outside a guild, ephemeral', async () => {
    const ctx = makeCtx();
    const i = fakeCommand({ name: 'settings', sub: 'world-news', user: 'u1', options: { state: 'on' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Use this in a server');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.guildSettings).all()).toHaveLength(0);
  });
  it('turns the daily bulletin on without touching a channel that was never set', async () => {
    const ctx = makeCtx();
    const on = fakeCommand({ name: 'settings', sub: 'world-news', user: 'u1', guild: 'g1', options: { state: 'on' } });
    await cmd.execute(ctx, on.asChatInput());
    expect(replyText(on.replies[0])).toContain('bulletin');
    expect(ctx.db.select().from(schema.guildSettings).all()).toEqual([
      { guildId: 'g1', notifyChannelId: null, worldBroadcast: true },
    ]);
  });
  it('toggling world-news does not clobber a previously-set notify channel', async () => {
    const ctx = makeCtx();
    const chan = fakeCommand({ name: 'settings', sub: 'channel', user: 'u1', guild: 'g1', options: { channel: 'chanA' } });
    await cmd.execute(ctx, chan.asChatInput());
    const on = fakeCommand({ name: 'settings', sub: 'world-news', user: 'u1', guild: 'g1', options: { state: 'on' } });
    await cmd.execute(ctx, on.asChatInput());
    expect(ctx.db.select().from(schema.guildSettings).all()).toEqual([
      { guildId: 'g1', notifyChannelId: 'chanA', worldBroadcast: true },
    ]);
    const off = fakeCommand({ name: 'settings', sub: 'world-news', user: 'u1', guild: 'g1', options: { state: 'off' } });
    await cmd.execute(ctx, off.asChatInput());
    expect(ctx.db.select().from(schema.guildSettings).all()).toEqual([
      { guildId: 'g1', notifyChannelId: 'chanA', worldBroadcast: false },
    ]);
  });
});
