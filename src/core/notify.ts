import { eq } from 'drizzle-orm';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Client, AttachmentBuilder } from 'discord.js';
import { schema } from './db/index.js';
import type { Ctx } from './context.js';
import { logger } from './logger.js';
import { EXPEDITION_SITES } from '../data/sites.js';
import { assetImage, attach } from './images.js';

// What a passive notification can carry. A bare string stays legal, so
// Ctx.notify's `message: string` and every one of its call sites are unaffected.
export type NotifyPayload = string | {
  content?: string;
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions?: { users?: string[]; roles?: string[]; parse?: Array<'users' | 'roles' | 'everyone'> };
};

// Minimal send surface so tests can pass a fake.
export interface Sender {
  channelSend(channelId: string, payload: NotifyPayload): Promise<void>;
  dmSend(userId: string, payload: NotifyPayload): Promise<void>;
}

// Channel deliveries ping the player; DMs do not (a DM already notifies).
// The allowedMentions whitelist is load-bearing, not decoration: src/index.ts
// sets `allowedMentions: { parse: [] }` client-wide so that /dino rename and
// /park rename cannot echo a user-supplied role mention into public content.
// A per-message value REPLACES that default rather than merging with it
// (discord.js MessagePayload#resolveBody), so naming exactly this one user id
// restores the ping without making anything else pingable. Without it the
// <@id> below renders as an inert grey chip and notifies nobody — which is
// what shipped.
// Always returns an object so callers can read `.content` without re-narrowing.
export function withMention(userId: string, payload: NotifyPayload): NotifyPayload {
  const mention = `<@${userId}>`;
  const allowedMentions = { users: [userId] };
  if (typeof payload === 'string') return { content: `${mention} ${payload}`, allowedMentions };
  return { ...payload, content: payload.content ? `${mention} ${payload.content}` : mention, allowedMentions };
}

export async function deliverNotification(sender: Sender, ctx: Ctx, userId: string, originGuildId: string | null, payload: NotifyPayload): Promise<void> {
  try {
    if (originGuildId) {
      const gs = ctx.db.select().from(schema.guildSettings).where(eq(schema.guildSettings.guildId, originGuildId)).get();
      if (gs?.notifyChannelId) {
        try { await sender.channelSend(gs.notifyChannelId, withMention(userId, payload)); return; }
        catch (e) { logger.warn({ err: e, guild: originGuildId }, 'notify channel send failed'); }
      }
    }
    try { await sender.dmSend(userId, payload); return; }
    catch (e) { logger.warn({ err: e, userId }, 'notify DM failed'); }
    // silent
  } catch (e) { logger.warn({ err: e, userId }, 'notify delivery failed'); }
}

export function clientSender(client: Client): Sender {
  return {
    async channelSend(channelId, payload) {
      const ch = await client.channels.fetch(channelId);
      if (ch && ch.isTextBased() && 'send' in ch) await (ch as { send(p: NotifyPayload): Promise<unknown> }).send(payload);
      else throw new Error('channel not sendable');
    },
    async dmSend(userId, payload) { const u = await client.users.fetch(userId); await u.send(payload); },
  };
}

export function eggHatchHandler(sender: Sender, ctx: Ctx) {
  return async (t: { userId: string; refId: number; originGuildId: string | null }) => {
    try {
      const egg = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, t.refId)).get();
      if (!egg) return;   // already hatched/removed
      const embed = new EmbedBuilder().setColor(0xf1c40f)
        .setTitle('🥚 Egg ready')
        .setDescription(`Your ${egg.rarity} egg is ready to hatch! Use \`/hatch egg:${egg.id}\`.`);
      const payload: NotifyPayload & { embeds: EmbedBuilder[] } = { embeds: [embed] };
      attach(embed, payload, 'thumbnail', assetImage('eggs', egg.rarity));
      payload.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`hatch:crack:${egg.id}`)
          .setLabel('🥚 Hatch').setStyle(ButtonStyle.Primary))];
      await deliverNotification(sender, ctx, t.userId, t.originGuildId, payload);
    } catch (e) { logger.warn({ err: e }, 'notify handler failed'); }
  };
}
export function breedingReadyHandler(sender: Sender, ctx: Ctx) {
  return async (t: { userId: string; refId: number; originGuildId: string | null }) => {
    try {
      const b = ctx.db.select().from(schema.breedings).where(eq(schema.breedings.id, t.refId)).get();
      if (!b || b.claimedAt) return;
      const embed = new EmbedBuilder().setColor(0x9b59b6)
        .setTitle('🧬 Breeding complete')
        .setDescription('Your pairing has produced an egg! Use `/breed claim` to collect it.');
      const payload: NotifyPayload & { embeds: EmbedBuilder[] } = { embeds: [embed] };
      attach(embed, payload, 'image', assetImage('banners', 'gene_lab'));
      payload.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`breed:claim:${b.id}`)
          .setLabel('🧬 Claim').setStyle(ButtonStyle.Primary))];
      await deliverNotification(sender, ctx, t.userId, t.originGuildId, payload);
    } catch (e) { logger.warn({ err: e }, 'notify handler failed'); }
  };
}
export function expeditionReturnHandler(sender: Sender, ctx: Ctx) {
  return async (t: { userId: string; refId: number; originGuildId: string | null }) => {
    try {
      const exp = ctx.db.select().from(schema.expeditions).where(eq(schema.expeditions.id, t.refId)).get();
      if (!exp || exp.claimedAt) return;
      const site = EXPEDITION_SITES[exp.siteId];
      const embed = new EmbedBuilder().setColor(0xe8590c)
        .setTitle(`🧭 ${site.name} — your expedition has returned!`)
        .setDescription('Use `/expedition claim` to collect the egg, cash, and food.');
      const payload: NotifyPayload & { embeds: EmbedBuilder[] } = { embeds: [embed] };
      attach(embed, payload, 'image', assetImage('sites', `${exp.siteId}-banner`));
      payload.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`exp:claim:${t.userId}`)
          .setLabel('🧭 Claim').setStyle(ButtonStyle.Primary))];
      await deliverNotification(sender, ctx, t.userId, t.originGuildId, payload);
    } catch (e) { logger.warn({ err: e }, 'notify handler failed'); }
  };
}
