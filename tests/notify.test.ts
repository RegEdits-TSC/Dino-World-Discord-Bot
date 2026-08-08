import { describe, it, expect } from 'vitest';
import { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { makeCtx } from './harness.js';
import { deliverNotification, withMention, type Sender, type NotifyPayload } from '../src/core/notify.js';
import { schema } from '../src/core/db/index.js';

const mkSender = (opts: { channelFails?: boolean; dmFails?: boolean } = {}): Sender & { calls: string[]; payloads: NotifyPayload[] } => {
  const calls: string[] = [];
  const payloads: NotifyPayload[] = [];
  return { calls, payloads,
    async channelSend(c, p) { calls.push(`channel:${c}`); payloads.push(p); if (opts.channelFails) throw new Error('x'); },
    async dmSend(u, p) { calls.push(`dm:${u}`); payloads.push(p); if (opts.dmFails) throw new Error('x'); } };
};
const contentOf = (p: NotifyPayload | undefined): string =>
  typeof p === 'string' ? p : p?.content ?? '';

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

describe('withMention', () => {
  it('merges the ping into content for all three payload shapes', () => {
    expect(contentOf(withMention('u1', 'hi'))).toBe('<@u1> hi');
    expect(contentOf(withMention('u1', { content: 'hi' }))).toBe('<@u1> hi');
    const embedOnly = withMention('u1', { embeds: [new EmbedBuilder().setTitle('t')] });
    expect(contentOf(embedOnly)).toBe('<@u1>');
    expect((embedOnly as { embeds?: EmbedBuilder[] }).embeds).toHaveLength(1);
  });

  it('withMention whitelists exactly the notified user so the ping actually fires', () => {
    // src/index.ts sets allowedMentions: { parse: [] } client-wide. A per-message
    // value REPLACES that default (discord.js MessagePayload#resolveBody), so without
    // this the <@id> is an inert grey chip and nobody is notified.
    const out = withMention('u1', { embeds: [] }) as {
      content?: string; allowedMentions?: { users?: string[]; parse?: string[] };
    };
    expect(out.content).toBe('<@u1>');
    expect(out.allowedMentions).toEqual({ users: ['u1'] });
  });

  it('withMention does not widen the whitelist when the payload already has content', () => {
    // A role or @everyone in caller-supplied content must stay unpingable.
    const out = withMention('u1', { content: '@everyone <@&999> hello' }) as {
      content?: string; allowedMentions?: { users?: string[] };
    };
    expect(out.content).toBe('<@u1> @everyone <@&999> hello');
    expect(out.allowedMentions).toEqual({ users: ['u1'] });
  });

  it('withMention preserves a components array', () => {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('alert:mute:u1').setLabel('x').setStyle(ButtonStyle.Secondary));
    const out = withMention('u1', { embeds: [], components: [row] }) as { components?: unknown[] };
    expect(out.components).toHaveLength(1);
  });
});

describe('notification payloads', () => {
  it('the channel path mentions the user and passes embeds/files through untouched', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g1', notifyChannelId: 'c1' }).run();
    const s = mkSender();
    const embed = new EmbedBuilder().setTitle('Egg ready');
    const file = new AttachmentBuilder(Buffer.from('x'), { name: 'common.png' });
    await deliverNotification(s, ctx, 'u1', 'g1', { content: 'ready!', embeds: [embed], files: [file] });
    const p = s.payloads[0] as { content?: string; embeds?: EmbedBuilder[]; files?: AttachmentBuilder[] };
    expect(p.content).toBe('<@u1> ready!');
    expect(p.embeds?.[0]).toBe(embed);
    expect(p.files?.[0]).toBe(file);
  });
  it('the DM path delivers the payload unmentioned', async () => {
    // A <@id> inside a DM is noise — the mention is a channel-path-only concern.
    const ctx = makeCtx(); const s = mkSender();
    const embed = new EmbedBuilder().setTitle('Egg ready');
    await deliverNotification(s, ctx, 'u1', 'g1', { content: 'ready!', embeds: [embed] });
    expect(s.calls).toEqual(['dm:u1']);
    const p = s.payloads[0] as { content?: string; embeds?: EmbedBuilder[] };
    expect(p.content).toBe('ready!');
    expect(p.embeds?.[0]).toBe(embed);
  });
  it('an object payload survives the channel to DM fallback, mentioned only on the channel', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g1', notifyChannelId: 'c1' }).run();
    const s = mkSender({ channelFails: true });
    await deliverNotification(s, ctx, 'u1', 'g1', { content: 'ready!' });
    expect(s.calls).toEqual(['channel:c1', 'dm:u1']);
    expect(contentOf(s.payloads[0])).toBe('<@u1> ready!');
    expect(contentOf(s.payloads[1])).toBe('ready!');
  });
});
