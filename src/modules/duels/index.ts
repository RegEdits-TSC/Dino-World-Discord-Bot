import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { matches, respondRanked, emptyRow } from '../../core/autocomplete.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import {
  resolveDuel, requireDuellable, duelSquad, setDuelSquad, eligibleForDuel, duelRecord, notifyDefender, DuelError,
  type DuelSquadMember,
} from './service.js';
import { duelResultPayload, challengePayload, recordPayload, DUEL_PREFIX } from './embeds.js';
import { DUEL_CHALLENGE_TTL_MS } from '../../data/battle/constants.js';

export const duelsModule: ModuleManifest = {
  name: 'duels',
  commands: [
    {
      data: new SlashCommandBuilder().setName('duel').setDescription('Exhibition duels — free, and pay nothing but a record')
        .addSubcommand((s) => s.setName('ghost').setDescription("Duel a snapshot of another player's squad")
          .addUserOption((o) => o.setName('opponent').setDescription('Who to duel').setRequired(true)))
        .addSubcommand((s) => s.setName('challenge').setDescription('Challenge another player to a live duel')
          .addUserOption((o) => o.setName('opponent').setDescription('Who to challenge').setRequired(true)))
        .addSubcommand((s) => s.setName('squad').setDescription('Set the squad you field in duels — leave blank to clear')
          .addIntegerOption((o) => o.setName('dino1').setDescription('Squad slot 1').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('dino2').setDescription('Squad slot 2').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('dino3').setDescription('Squad slot 3').setAutocomplete(true)))
        .addSubcommand((s) => s.setName('record').setDescription('Duel rating, record and recent opponents')
          .addUserOption((o) => o.setName('player').setDescription('Whose record — defaults to yours'))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        if (sub === 'squad') {
          const ids = ['dino1', 'dino2', 'dino3']
            .map((n) => i.options.getInteger(n))
            .filter((v): v is number => v !== null);
          try {
            const squad = setDuelSquad(ctx, i.user.id, ids);
            await i.reply({
              content: ids.length
                ? `⚔️ Duel squad set: ${squad.map((m) => `Lv.${m.level} ${m.name}`).join(', ')}.`
                : `⚔️ Duel squad cleared — duels now field your top three automatic picks: ${squad.map((m) => m.name).join(', ')}.`,
              flags: MessageFlags.Ephemeral,
            });
          } catch (e) {
            if (e instanceof DuelError) {
              await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              return;
            }
            throw e;
          }
          return;
        }
        if (sub === 'record') {
          const who = i.options.getUser('player');
          const targetId = who?.id ?? i.user.id;
          try {
            const record = duelRecord(ctx, targetId);
            // The DB row's displayName, not the Discord option's — the same "resolve the
            // shown name from our own stored copy" rule visitPayload follows for /park
            // view user:. The fake-command harness only echoes the raw id as a User
            // option's displayName, so trusting who.displayName would also show the
            // caller's own snowflake instead of the name getOrCreateUser recorded.
            const name = who
              ? ctx.db.select().from(schema.users).where(eq(schema.users.discordId, targetId)).get()!.displayName
                || targetId
              : i.user.displayName;
            await i.reply(recordPayload(name, record));
          } catch (e) {
            if (e instanceof DuelError) {
              await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              return;
            }
            throw e;
          }
          return;
        }
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
              const outcome = resolveDuel(ctx, i.user.id, target.id, 'ghost');
              await i.reply(duelResultPayload(outcome));
              // After the reply: the duel is already committed, so a failed
              // notification must not cost the player their result. ctx.notify never
              // throws.
              await notifyDefender(ctx, outcome, i.guildId);
              return;
            }
            // A challenge stores NOTHING: the squads and both ratings resolve when the
            // button is clicked, which is what makes a 15-minute-old card honest — it
            // fights the squad you have when it lands. These reads only verify the
            // pairing is duellable before a card is posted publicly, so a player with
            // no dinos is told now rather than the ACCEPTING player being told later.
            try {
              duelSquad(ctx, i.user.id);
            } catch (e) {
              // Mirrors resolveDuel: only the "no battle-ready dinos" case is re-phrased
              // for the challenger's own point of view. Anything else — a retired species
              // id, a DB fault — must not be disguised as an empty roster.
              if (!(e instanceof DuelError)) throw e;
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
      // Provider contract: respond() only, no reply/defer, no getOrCreateUser (no row
      // creation on keystrokes), read-only. settleEscapes is NOT called here — it
      // writes, and duelSquad evaluates escape read-only anyway.
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'squad') { await i.respond([]); return; }
        const user = ctx.db.select().from(schema.users)
          .where(eq(schema.users.discordId, i.user.id)).get();
        if (!user) { await i.respond([]); return; }
        const focused = i.options.getFocused(true);
        const q = String(focused.value);
        const others = ['dino1', 'dino2', 'dino3'].filter((n) => n !== focused.name);
        const taken = new Set(others.map((n) => Number(i.options.get(n)?.value)).filter((v) => Number.isFinite(v)));
        let squad: DuelSquadMember[] = [];
        try { squad = eligibleForDuel(ctx, i.user.id); } catch { squad = []; }
        if (!squad.length) { await respondRanked(i, [emptyRow('No battle-ready dinos — hatch or /rescue first', 0)]); return; }
        // Unicode only — a custom emoji tag renders as literal text in autocomplete.
        await respondRanked(i, squad
          .filter((m) => !taken.has(m.dinoId))
          .filter((m) => matches(q, m.dinoId, m.name, m.speciesId))
          .map((m) => ({ value: m.dinoId, valid: true, label: `🦖 #${m.dinoId} Lv.${m.level} ${m.name} (${m.archetype})` })));
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
        // challengerId is the one customId segment nothing else here validates, and
        // resolveDuel takes it on faith and mutates THAT player's rating. The only
        // thing that can prove it is genuine is the real message this button lives
        // on: interactionMetadata.user is Discord's own record of who ran the
        // /duel challenge that produced the message, and a client cannot forge that
        // field the way it can forge customId segments. A forged challengerId naming
        // an uninvolved player — one who never ran /duel challenge against this
        // defender at all — always fails here, because no real message exists whose
        // poster matches the forged claim.
        if (i.message.interactionMetadata?.user.id !== challengerId) {
          await i.reply({ content: 'That challenge is no longer valid — run `/duel challenge` again.', flags: MessageFlags.Ephemeral });
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
