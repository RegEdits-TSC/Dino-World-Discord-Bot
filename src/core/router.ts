import { MessageFlags } from 'discord.js';
import type { Interaction, ChatInputCommandInteraction, ButtonInteraction, InteractionReplyOptions } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Ctx } from './context.js';
import type { ModuleRegistry } from './modules.js';
import { schema } from './db/index.js';
import { logger } from './logger.js';

function touchPresence(ctx: Ctx, userId: string, displayName: string, guildId: string | null): void {
  ctx.db.update(schema.users).set({ displayName }).where(eq(schema.users.discordId, userId)).run();
  if (guildId) {
    ctx.db.insert(schema.userGuilds)
      .values({ userId, guildId, lastSeenAt: ctx.now() })
      .onConflictDoUpdate({
        target: [schema.userGuilds.userId, schema.userGuilds.guildId],
        set: { lastSeenAt: ctx.now() },
      }).run();
  }
}

export interface RouterHooks {
  preDispatch?(ctx: Ctx, userId: string): void;
  postDispatch?(
    ctx: Ctx, i: ChatInputCommandInteraction | ButtonInteraction, source: { command?: string; prefix?: string },
  ): Promise<void>;
}

export async function routeInteraction(
  ctx: Ctx, registry: ModuleRegistry, interaction: Interaction, hooks?: RouterHooks,
): Promise<void> {
  if (interaction.isAutocomplete()) {
    const cmd = registry.findCommand(interaction.commandName);
    try {
      if (cmd?.autocomplete) await cmd.autocomplete(ctx, interaction);
      else await interaction.respond([]);
    } catch (err) {
      logger.debug({ err }, 'autocomplete failed');
      await interaction.respond([]).catch(() => {});
    }
    return;
  }
  const isCommand = interaction.isChatInputCommand();
  const isButton = interaction.isButton();
  if (!isCommand && !isButton) return;
  try {
    touchPresence(ctx, interaction.user.id, interaction.user.displayName, interaction.guildId);
    try {
      hooks?.preDispatch?.(ctx, interaction.user.id);
    } catch (err) {
      logger.warn({ err }, 'preDispatch hook failed');
    }
    if (isCommand) {
      const cmd = registry.findCommand((interaction as ChatInputCommandInteraction).commandName);
      if (cmd) await cmd.execute(ctx, interaction as ChatInputCommandInteraction);
    } else {
      const comp = registry.findComponent((interaction as ButtonInteraction).customId);
      if (comp) await comp.execute(ctx, interaction as ButtonInteraction);
    }
    try {
      const source = isCommand
        ? { command: (interaction as ChatInputCommandInteraction).commandName }
        : { prefix: (interaction as ButtonInteraction).customId.split(':')[0] };
      await hooks?.postDispatch?.(
        ctx, interaction as ChatInputCommandInteraction | ButtonInteraction, source);
    } catch (err) {
      logger.warn({ err }, 'postDispatch hook failed');
    }
  } catch (err) {
    const i = interaction as ChatInputCommandInteraction | ButtonInteraction;
    const payload: InteractionReplyOptions = { content: 'Something went wrong — nothing was charged. Try again.', flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) await i.followUp(payload).catch(() => {});
    else await i.reply(payload).catch(() => {});
    logger.error({ err }, 'interaction handling failed');
  }
}
