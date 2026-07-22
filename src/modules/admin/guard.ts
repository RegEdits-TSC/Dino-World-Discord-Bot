import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Ctx } from '../../core/context.js';

// Owner-only gate. Replies ephemeral and returns false for non-owners; true for the owner.
export async function requireOwner(ctx: Ctx, i: ChatInputCommandInteraction): Promise<boolean> {
  if (i.user.id === ctx.config.ownerId) return true;
  await i.reply({ content: '⛔ Owner only.', flags: MessageFlags.Ephemeral });
  return false;
}
