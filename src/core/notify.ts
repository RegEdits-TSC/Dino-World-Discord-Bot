import { eq } from 'drizzle-orm';
import type { Client } from 'discord.js';
import { schema } from './db/index.js';
import type { Ctx } from './context.js';
import { logger } from './logger.js';
import { EXPEDITION_SITES } from '../data/sites.js';

// Minimal send surface so tests can pass a fake.
export interface Sender {
  channelSend(channelId: string, content: string): Promise<void>;
  dmSend(userId: string, content: string): Promise<void>;
}

export async function deliverNotification(sender: Sender, ctx: Ctx, userId: string, originGuildId: string | null, message: string): Promise<void> {
  try {
    if (originGuildId) {
      const gs = ctx.db.select().from(schema.guildSettings).where(eq(schema.guildSettings.guildId, originGuildId)).get();
      if (gs?.notifyChannelId) {
        try { await sender.channelSend(gs.notifyChannelId, `<@${userId}> ${message}`); return; }
        catch (e) { logger.warn({ err: e, guild: originGuildId }, 'notify channel send failed'); }
      }
    }
    try { await sender.dmSend(userId, message); return; }
    catch (e) { logger.warn({ err: e, userId }, 'notify DM failed'); }
    // silent
  } catch (e) { logger.warn({ err: e, userId }, 'notify delivery failed'); }
}

export function clientSender(client: Client): Sender {
  return {
    async channelSend(channelId, content) {
      const ch = await client.channels.fetch(channelId);
      if (ch && ch.isTextBased() && 'send' in ch) await (ch as { send(c: string): Promise<unknown> }).send(content);
      else throw new Error('channel not sendable');
    },
    async dmSend(userId, content) { const u = await client.users.fetch(userId); await u.send(content); },
  };
}

export function eggHatchHandler(sender: Sender, ctx: Ctx) {
  return async (t: { userId: string; refId: number; originGuildId: string | null }) => {
    try {
      const egg = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, t.refId)).get();
      if (!egg) return;   // already hatched/removed
      await deliverNotification(sender, ctx, t.userId, t.originGuildId, `🥚 Your ${egg.rarity} egg is ready to hatch! Use /hatch ${egg.id}.`);
    } catch (e) { logger.warn({ err: e }, 'notify handler failed'); }
  };
}
export function expeditionReturnHandler(sender: Sender, ctx: Ctx) {
  return async (t: { userId: string; refId: number; originGuildId: string | null }) => {
    try {
      const exp = ctx.db.select().from(schema.expeditions).where(eq(schema.expeditions.id, t.refId)).get();
      if (!exp || exp.claimedAt) return;
      await deliverNotification(sender, ctx, t.userId, t.originGuildId, `🧭 Your expedition to ${EXPEDITION_SITES[exp.siteId].name} has returned! Use /expedition claim.`);
    } catch (e) { logger.warn({ err: e }, 'notify handler failed'); }
  };
}
