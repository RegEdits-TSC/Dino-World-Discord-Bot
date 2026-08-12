import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { resolveDuel, requireDuellable, duelSquad, DuelError } from './service.js';
import { duelResultPayload, challengePayload, DUEL_PREFIX } from './embeds.js';
import { DUEL_CHALLENGE_TTL_MS } from '../../data/battle/constants.js';

export const duelsModule: ModuleManifest = {
  name: 'duels',
  commands: [
    {
      data: new SlashCommandBuilder().setName('duel').setDescription('Exhibition duels — free, and pay nothing but a record')
        .addSubcommand((s) => s.setName('ghost').setDescription("Duel a snapshot of another player's squad")
          .addUserOption((o) => o.setName('opponent').setDescription('Who to duel').setRequired(true)))
        .addSubcommand((s) => s.setName('challenge').setDescription('Challenge another player to a live duel')
          .addUserOption((o) => o.setName('opponent').setDescription('Who to challenge').setRequired(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        if (sub === 'ghost' || sub === 'challenge') {
          const target = i.options.getUser('opponent', true);
          if (target.id === i.user.id) {
            await i.reply({ content: "You can't duel yourself.", flags: MessageFlags.Ephemeral });
            return;
          }
          if (target.bot) {
            await i.reply({ content: 'You cannot duel a bot.', flags: MessageFlags.Ephemeral });
            return;
          }
          // The challenger ran a command, so settling their escapes here is exactly the
          // documented rule. The DEFENDER is never settled — duelSquad evaluates their
          // escapes read-only instead.
          settleEscapes(ctx, i.user.id);
          try {
            if (sub === 'ghost') {
              await i.reply(duelResultPayload(resolveDuel(ctx, i.user.id, target.id, 'ghost')));
              return;
            }
            // A challenge stores NOTHING: the squads and both ratings resolve when the
            // button is clicked, which is what makes a 15-minute-old card honest — it
            // fights the squad you have when it lands. These reads only verify the
            // pairing is duellable before a card is posted publicly, so a player with
            // no dinos is told now rather than the ACCEPTING player being told later.
            try {
              duelSquad(ctx, i.user.id);
            } catch {
              throw new DuelError('You have no battle-ready dinos — hatch or rescue one first.');
            }
            const defender = requireDuellable(ctx, target.id);
            const expiresAtMs = ctx.now() + DUEL_CHALLENGE_TTL_MS;
            await i.reply(challengePayload(
              i.user.id, target.id, i.user.displayName, defender.displayName || target.id, expiresAtMs));
          } catch (e) {
            if (e instanceof DuelError) {
              await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              return;
            }
            throw e;
          }
          return;
        }
        // Never the /park dispatch trap: an unrecognised subcommand reports failure
        // rather than silently rendering something plausible.
        await i.reply({ content: 'Unknown /duel subcommand.', flags: MessageFlags.Ephemeral });
      },
    },
  ],
  components: [
    {
      prefix: DUEL_PREFIX,
      async execute(ctx, i) {
        const [, action, challengerId, defenderId, expiresRaw] = i.customId.split(':');
        if (action !== 'accept' && action !== 'decline') { await i.deferUpdate(); return; }
        // The id segment names the CHALLENGED player: only they may answer.
        if (i.user.id !== defenderId) {
          await i.reply({ content: 'That challenge is not for you.', flags: MessageFlags.Ephemeral });
          return;
        }
        const expiresAtMs = Number(expiresRaw);
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= ctx.now()) {
          await i.reply({ content: 'That challenge expired — start a new one with `/duel challenge`.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === 'decline') {
          await i.update({ content: `⚔️ Challenge declined by ${i.user.displayName}.`, embeds: [], components: [] });
          return;
        }
        settleEscapes(ctx, i.user.id);   // the accepting player is the one clicking
        try {
          const outcome = resolveDuel(ctx, challengerId, defenderId, 'live', expiresAtMs);
          // i.update replaces the challenge card with its own result, so one challenge
          // never accumulates messages.
          await i.update({ ...duelResultPayload(outcome), attachments: [] });
        } catch (e) {
          if (e instanceof DuelError) {
            await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
            return;
          }
          throw e;
        }
      },
    },
  ],
};
