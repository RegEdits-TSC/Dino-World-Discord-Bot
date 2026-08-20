import { MessageFlags } from 'discord.js';
import type { Interaction, ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction, InteractionReplyOptions } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Ctx } from './context.js';
import type { ModuleRegistry } from './modules.js';
import { schema } from './db/index.js';
import { logger } from './logger.js';
import { clickedIdIsOnMessage } from './components.js';

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
  // Safe to widen to include a select, unlike ComponentDef.execute (see the select branch
  // below): dailyRouterHooks.postDispatch reads only i.user.id, i.deferred, i.replied and
  // i.followUp, all present on every member of this union.
  postDispatch?(
    ctx: Ctx, i: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    source: { command?: string; prefix?: string },
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
  const isSelect = interaction.isStringSelectMenu();
  // A third branch, deliberately, rather than widening the button one: ComponentDef.execute
  // is declared with method syntax, so its parameter is bivariant and widening it would
  // compile clean across all seventeen modules while letting a select reach a handler that
  // only ever parses i.customId. Anything still unrecognised here keeps the historical
  // silent no-op — modals in particular are NOT routed.
  if (!isCommand && !isButton && !isSelect) return;
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
    } else if (isSelect) {
      const sel = registry.findSelect((interaction as StringSelectMenuInteraction).customId);
      if (sel) {
        const s = interaction as StringSelectMenuInteraction;
        // Same guard, same reasoning, same rejection shape as the button branch below.
        // It proves the bot minted THIS MENU on THIS MESSAGE — and nothing whatsoever
        // about s.values, which ride outside the customId and are unattested client
        // input. Every select handler validates its own values in addition to this.
        if (!clickedIdIsOnMessage(s)) {
          logger.warn(
            { customId: s.customId, userId: s.user.id, messageId: s.message?.id },
            'select id not present on its message',
          );
          await s.deferUpdate();
          return;
        }
        await sel.execute(ctx, s);
      }
    } else {
      const comp = registry.findComponent((interaction as ButtonInteraction).customId);
      if (comp) {
        const b = interaction as ButtonInteraction;
        // Every clicked customId must actually be on the message it was clicked from.
        // A component interaction can be emitted straight at the gateway with any
        // custom_id, anchored on any message the client can address, and the dispatch
        // above resolves a handler from the PREFIX alone — nothing binds the message to
        // the module, the id, or the clicker. Message#components is Discord's own record
        // of the buttons the BOT minted, so checking against it is what turns "these
        // segments parse" into "the bot minted exactly this id, on this message". See
        // src/core/components.ts for why exact equality, and why it fails closed.
        //
        // Module-level clickedIdIsOnMessage calls are DEFENCE IN DEPTH from here on: the
        // one at src/modules/duels/index.ts is preempted by this guard in production and
        // stays for callers that invoke comp.execute directly (scripts/test-live.ts, and
        // the S1 regression fixtures in tests/duels.test.ts).
        //
        // This closes CROSS-MESSAGE anchoring only. It does nothing about stale-
        // same-message replay — the class that cost real money on park:landmark:buy —
        // so per-rung, per-page, per-season state in customIds stays mandatory.
        if (!clickedIdIsOnMessage(b)) {
          // Logged before the ack, so a deferUpdate that throws on an expired
          // interaction still leaves the rejection in the log — this warn is the only
          // signal a legitimate flow was rejected in a shape nobody anticipated. Two
          // benign shapes are expected: pager double-clicks and a late battle:skip.
          logger.warn(
            { customId: b.customId, userId: b.user.id, messageId: b.message?.id },
            'component id not present on its message',
          );
          // deferUpdate, never a bare return: a bare return paints "This interaction
          // failed" after 3 seconds on every rejected click, an innocent double-click
          // included. And never a distinct text reply — that is an oracle telling an
          // attacker the GUARD stopped him rather than the handler. Same house idiom as
          // the unknown-action arms in battles/park/dex/ach/alert/top.
          await b.deferUpdate();
          // Returns BEFORE postDispatch, and that is load-bearing: deferUpdate sets
          // i.deferred = true and daily/hooks.ts gates its hint on
          // `!i.deferred && !i.replied`, so falling through would emit a real quest or
          // season followUp for a forged click AND burn the one-shot notifiedAt /
          // hintedRung stamps for a message nobody asked for.
          return;
        }
        await comp.execute(ctx, b);
      }
    }
    try {
      const source = isCommand
        ? { command: (interaction as ChatInputCommandInteraction).commandName }
        : { prefix: (interaction as ButtonInteraction | StringSelectMenuInteraction).customId.split(':')[0] };
      await hooks?.postDispatch?.(
        ctx, interaction as ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction, source);
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
