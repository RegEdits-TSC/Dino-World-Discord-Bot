import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type ChatInputCommandInteraction, type ButtonInteraction } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import type { Ctx } from '../../core/context.js';
import { runFight, BattleError, type FightOutcome } from './service.js';
import { fightFrames, type FramePayload } from './embeds.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { FIGHT_FRAME_DELAY_MS } from '../../data/battle/constants.js';
import { logger } from '../../core/logger.js';

// In-process cinematic state (standing single-bot-instance-per-token rule).
// A restart mid-broadcast costs animation frames only: all game state commits
// inside runFight before the first Discord edit.
let presentationSeq = 0;
// userId is stored on the record, not just baked into the clicked button's
// customId: the pid counter resets on a restart, so a stale button from a
// frozen pre-restart message can carry a live-looking pid that now belongs
// to a different user's fresh fight. Trusting the customId's owner segment
// alone would let that stale click hijack (and leak) someone else's outcome.
const presentations = new Map<string, { userId: string; final: FramePayload; skipped: boolean }>();
// The again button's customId carries only the stageId; the squad is remembered
// here. Empty after a restart -> the button degrades to an ephemeral nudge.
const lastSquads = new Map<string, number[]>();

function skipRow(userId: string, presentationId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`battle:skip:${userId}:${presentationId}`)
      .setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary));
}
function againRow(userId: string, stageId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`battle:again:${userId}:${stageId}`)
      .setLabel('⚔️ Fight again').setStyle(ButtonStyle.Primary));
}

async function presentFight(ctx: Ctx, i: ChatInputCommandInteraction | ButtonInteraction,
    userId: string, outcome: FightOutcome): Promise<void> {
  const pid = String(++presentationSeq);
  try {
    // fightFrames can throw on a data inconsistency (unknown stage/species/food
    // id) — by commit-before-present design runFight already committed every
    // reward before we ever got here, so a throw anywhere in this block is a
    // presentation-layer failure only, never a reason to imply nothing happened.
    const frames = fightFrames(outcome, () => skipRow(userId, pid));
    frames[3].components.push(againRow(userId, outcome.stageId));
    const entry = { userId, final: frames[3], skipped: false };
    presentations.set(pid, entry);
    for (const idx of [0, 1, 2] as const) {
      if (entry.skipped) return;
      await i.editReply(frames[idx]);
      await ctx.sleep(FIGHT_FRAME_DELAY_MS);
    }
    if (!entry.skipped) await i.editReply(frames[3]);
  } catch (err) {
    logger.debug({ err }, 'battle cinematic render failed');
    await i.editReply({
      content: 'The fight already resolved and your rewards were applied — the cinematic replay could not be rendered.',
      embeds: [], components: [], files: [],
    }).catch(() => {});
  } finally {
    presentations.delete(pid);
  }
}

export const battlesModule: ModuleManifest = {
  name: 'battles',
  commands: [
    { data: new SlashCommandBuilder().setName('battle').setDescription('PvE campaign battles')
        .addSubcommand((s) => s.setName('chapters').setDescription('Browse the campaign'))
        .addSubcommand((s) => s.setName('fight').setDescription('Fight a stage with a squad of 1-3 dinos')
          .addStringOption((o) => o.setName('stage').setDescription('Stage — type to search').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('dino1').setDescription('Squad slot 1').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('dino2').setDescription('Squad slot 2').setAutocomplete(true))
          .addIntegerOption((o) => o.setName('dino3').setDescription('Squad slot 3').setAutocomplete(true))),
      async execute(ctx, i) {
        if (i.options.getSubcommand() === 'chapters') {
          // Replaced by the chapters step (Task 12).
          await i.reply({ content: 'Chapter view is on its way.', flags: MessageFlags.Ephemeral });
          return;
        }
        const stageId = i.options.getString('stage', true);
        const dinoIds = [i.options.getInteger('dino1', true), i.options.getInteger('dino2'), i.options.getInteger('dino3')]
          .filter((d): d is number => d !== null);
        let outcome: FightOutcome;
        try {
          outcome = runFight(ctx, i.user.id, stageId, dinoIds);
        } catch (e) {
          if (e instanceof BattleError) { await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); return; }
          if (e instanceof InsufficientFundsError) { await i.reply({ content: 'Not enough resources for that fight.', flags: MessageFlags.Ephemeral }); return; }
          throw e;
        }
        lastSquads.set(`${i.user.id}:${stageId}`, outcome.squad.map((m) => m.dinoId));
        await i.deferReply();
        await presentFight(ctx, i, i.user.id, outcome);
      },
      // Real providers land with the chapters step (Task 12).
      async autocomplete(_ctx, i) { await i.respond([]); },
    },
  ],
  components: [
    { prefix: 'battle', async execute(ctx, i) {
        const [, action, ownerId, arg] = i.customId.split(':');
        if (i.user.id !== ownerId) { await i.reply({ content: 'Not your battle.', flags: MessageFlags.Ephemeral }); return; }
        if (action === 'skip') {
          const entry = presentations.get(arg);
          // Belt and braces: the customId owner check above only proves the
          // clicker owns the id baked into THIS button. A stale button (pid
          // reused after a restart) can carry someone else's live pid, so the
          // record's own stored owner is the authority, not the customId.
          if (!entry || entry.userId !== i.user.id) { await i.deferUpdate(); return; }
          entry.skipped = true;
          await i.update(entry.final);
        } else if (action === 'again') {
          const squad = lastSquads.get(`${i.user.id}:${arg}`);
          if (!squad) { await i.reply({ content: 'That battle expired — start a new one with /battle fight.', flags: MessageFlags.Ephemeral }); return; }
          let outcome: FightOutcome;
          try {
            outcome = runFight(ctx, i.user.id, arg, squad);   // full pipeline incl. energy check
          } catch (e) {
            if (e instanceof BattleError) { await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); return; }
            if (e instanceof InsufficientFundsError) { await i.reply({ content: 'Not enough resources for that fight.', flags: MessageFlags.Ephemeral }); return; }
            throw e;
          }
          await i.deferUpdate();
          await presentFight(ctx, i, i.user.id, outcome);
        }
      } },
  ],
};
