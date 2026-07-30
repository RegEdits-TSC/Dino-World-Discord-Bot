import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type ChatInputCommandInteraction, type ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import type { Ctx } from '../../core/context.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { getSpecies } from '../../data/species/index.js';
import { battleLevel } from '../../data/battle/stats.js';
import { settleEnergy } from '../../data/battle/energy.js';
import { CAMPAIGN, stageUnlocked, chapterUnlocked } from '../../data/battle/chapters/index.js';
import { runFight, loadProgress, BattleError, type FightOutcome } from './service.js';
import { fightFrames, chaptersPayload, type FramePayload, type ChaptersView } from './embeds.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { FIGHT_FRAME_DELAY_MS } from '../../data/battle/constants.js';
import { logger } from '../../core/logger.js';
import { matches, respondRanked, emptyRow, type AcEntry } from '../../core/autocomplete.js';

// In-process cinematic state (standing single-bot-instance-per-token rule).
// A restart mid-broadcast costs animation frames only: all game state commits
// inside runFight before the first Discord edit.
let presentationSeq = 0;
// userId is stored on the record, not just baked into the clicked button's
// customId: the pid counter resets on a restart, so a stale button from a
// frozen pre-restart message can carry a live-looking pid that now belongs
// to a different user's fresh fight. Trusting the customId's owner segment
// alone would let that stale click hijack (and leak) someone else's outcome.
interface Presentation {
  userId: string;
  final: FramePayload;
  skipped: boolean;
  // Tail of the serialized edit queue for this presentation's message — see queueEdit.
  lock: Promise<unknown>;
}
const presentations = new Map<string, Presentation>();

// The cinematic loop and the Skip handler are two independent writers to the SAME
// message, and `entry.skipped` alone cannot order them: a Skip that lands while a
// beat frame's editReply is already in flight sets the flag too late to stop that
// PATCH, and the two requests then race. Losing that race is not cosmetic — F4
// replaces the message's whole attachment set, so a beat frame landing after it
// restores an embed pointing at attachment://<chapter>-banner.webp that no longer
// exists, i.e. a permanently broken image on the final message.
// Every edit therefore queues behind the previous one and only fires if its guard
// still holds, which makes F4 the last PATCH sent in either interleaving: a Skip
// arriving mid-frame waits for that frame's response before sending F4, and a beat
// frame queued behind an already-sent F4 is dropped instead of sent after it.
// The queue is per presentation and the lock is free during ctx.sleep, so in the
// common case (Skip clicked between frames) the button still answers immediately.
function queueEdit(entry: Presentation, guard: () => boolean, send: () => Promise<unknown>): Promise<void> {
  const run = entry.lock.then(() => (guard() ? send() : undefined));
  entry.lock = run.catch(() => {});   // a failed edit must not wedge the queue
  return run.then(() => {});          // ...but the caller still sees the rejection
}
// The again button's customId carries only the stageId; the squad is remembered
// here. Empty after a restart -> the button degrades to an ephemeral nudge.
const lastSquads = new Map<string, number[]>();

// entry.final (the F4 payload) has two possible send sites: presentFight's own
// closing editReply below, and — if a Skip lands in the narrow window while
// that editReply is already in flight — the skip button handler's i.update,
// racing it. discord.js's MessagePayload mutates options.attachments IN PLACE
// on every send (it pushes that send's file descriptors onto whatever array it
// finds there), so if both sites forwarded the same entry.final object, the
// second send to resolve would push onto an array the first send already
// populated, corrupting it with duplicate/stale ids. Never pass entry.final
// straight through — always route it through here, which hands out a fresh,
// unshared attachments array per call so two racing sends can never collide.
function finalPayload(entry: { final: FramePayload }): FramePayload {
  return { ...entry.final, attachments: [] };
}

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
    const entry: Presentation = { userId, final: frames[3], skipped: false, lock: Promise.resolve() };
    presentations.set(pid, entry);
    const unskipped = () => !entry.skipped;
    for (const idx of [0, 1, 2] as const) {
      if (entry.skipped) return;
      await queueEdit(entry, unskipped, () => i.editReply(frames[idx]));
      if (entry.skipped) return;   // a Skip landed while that frame was in flight
      await ctx.sleep(FIGHT_FRAME_DELAY_MS);
    }
    if (!entry.skipped) await queueEdit(entry, unskipped, () => i.editReply(finalPayload(entry)));
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

// Read-only settle for display (previewSell precedent): nothing persisted here.
function chaptersView(ctx: Ctx, userId: string): { view: ChaptersView; frontier: number } | null {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) return null;
  const progress = loadProgress(ctx, userId);
  const settled = settleEnergy(user.energy, user.energyUpdatedAt, ctx.now());
  const view: ChaptersView = {
    progress, ratingHighWater: user.ratingHighWater,
    energy: settled.energy, energyUpdatedAtMs: settled.updatedAtMs,
  };
  // Frontier = highest unlocked chapter (chapter 1 is always unlocked).
  const frontier = CAMPAIGN.reduce((acc, ch, k) => (chapterUnlocked(ch.id, progress, user.ratingHighWater) ? k : acc), 0);
  return { view, frontier };
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
          getOrCreateUser(ctx, i.user.id, i.user.displayName);
          const { view, frontier } = chaptersView(ctx, i.user.id)!;   // row exists: just created
          await i.reply(chaptersPayload(i.user.id, frontier, view));
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
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'fight') { await i.respond([]); return; }
        // Guard the row via direct select — never getOrCreateUser here, and
        // settleEscapes below is only safe once the row is known to exist.
        const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, i.user.id)).get();
        if (!user) { await i.respond([]); return; }
        const focused = i.options.getFocused(true);
        const q = String(focused.value);
        if (focused.name === 'stage') {
          const progress = loadProgress(ctx, i.user.id);
          const entries: AcEntry[] = [];
          for (const ch of CAMPAIGN) {
            if (!chapterUnlocked(ch.id, progress, user.ratingHighWater)) continue;
            ch.stages.forEach((s, k) => {
              if (!matches(q, s.id, s.name, ch.name)) return;
              const open = stageUnlocked(s.id, progress);
              const stars = progress.get(s.id)?.stars ?? 0;
              const pos = s.boss ? 'Boss' : String(k + 1);
              // Unicode only — custom emoji tags render as literal text here.
              const glyphs = stars > 0 ? `${'⭐'.repeat(stars)} ` : '';
              entries.push({
                value: s.id, valid: open,
                label: open
                  ? `${glyphs}${ch.name} ${pos} — ${s.name} (⚡${s.energyCost})`
                  : `🔒 ${ch.name} ${pos} — ${s.name} (⚡${s.energyCost})`,
              });
            });
          }
          await respondRanked(i, entries);
          return;
        }
        settleEscapes(ctx, i.user.id);   // row guaranteed above
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all()
          .filter((d) => d.escapedAt === null);   // escaped dinos can't fight — excluded outright
        if (!dinos.length) { await respondRanked(i, [emptyRow('No battle-ready dinos — hatch or /rescue first', 0)]); return; }
        const others = ['dino1', 'dino2', 'dino3'].filter((n) => n !== focused.name);
        const taken = new Set(others.map((n) => Number(i.options.get(n)?.value)).filter((v) => Number.isFinite(v)));
        await respondRanked(i, dinos
          .filter((d) => !taken.has(d.id))
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, d.nickname, species.name))
          .map(({ d, species }) => ({
            value: d.id, valid: true,
            label: `Lv.${battleLevel(d.battleXp)} ${d.nickname ?? species.name} (${species.archetype})`,
          })));
      },
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
          // Guard is always-true: this update is also the button's acknowledgement,
          // so it must be sent even if the loop already reached F4 (the second send
          // is the same content, and finalPayload hands it its own attachments array).
          await queueEdit(entry, () => true, () => i.update(finalPayload(entry)));
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
        } else if (action === 'chapter') {
          const cv = chaptersView(ctx, i.user.id);
          if (!cv) { await i.reply({ content: 'Run /battle chapters first.', flags: MessageFlags.Ephemeral }); return; }
          const idx = Math.min(Math.max(0, Number(arg) || 0), CAMPAIGN.length - 1);
          // attachments: [] clears the previous page's banner before the new one attaches.
          await i.update({ ...chaptersPayload(i.user.id, idx, cv.view), attachments: [] });
        } else {
          // Unknown battle:* action — acknowledge so Discord doesn't surface
          // "This interaction failed" for a stale or forged customId.
          await i.deferUpdate();
        }
      } },
  ],
};
