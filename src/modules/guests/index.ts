import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { recomputeRating } from '../park/rating.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { ATTRACTIONS } from '../../data/attractions.js';
import { guestsPayload, builtPayload, milestonePayload } from './embeds.js';
import {
  attractionRows, buildAttraction, upgradeAttraction, claimMilestone,
  UnknownAttractionError, AttractionLockedError,
  DuplicateAttractionError, AttractionMaxedError, MilestoneUnavailableError,
} from './service.js';

const attractionChoices = Object.values(ATTRACTIONS).map((d) => ({ name: d.name, value: d.kind }));

export const guestsModule: ModuleManifest = {
  name: 'guests',
  commands: [
    {
      data: new SlashCommandBuilder().setName('guests').setDescription('Park attendance and attractions')
        .addSubcommand((s) => s.setName('view').setDescription('Your attendance, attractions and milestones'))
        .addSubcommand((s) => s.setName('build').setDescription('Build or upgrade an attraction')
          .addStringOption((o) => o.setName('attraction').setDescription('Which attraction')
            .setRequired(true).addChoices(...attractionChoices)))
        .addSubcommand((s) => s.setName('claim').setDescription('Claim a reached attendance milestone')),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        // A real switch with a default arm, never a fallthrough to the view: the /park
        // dispatch trap (a new subcommand silently rendering the dashboard and reporting
        // success for a command that did nothing) is what this shape exists to avoid.
        switch (i.options.getSubcommand()) {
          // view is a PURE READ, and recomputeRating must never be hoisted back above this
          // switch. It used to run for every subcommand, to stamp the attendance high-water
          // before anything read it — but it writes three columns in one UPDATE, and one of
          // them is parkRating, the LIVE value, which falls freely as comfort decays.
          // liveRating (../trading/service.ts) is a plain SELECT of that column, checked
          // against TRADE_MIN_RATING at both createTrade and acceptTrade, so opening this
          // screen after a few hours of hunger drain could drop a park below the trade gate
          // and kill a pending offer — a state change caused by reading a screen. /park view
          // deliberately never recomputes either. The high-water still advances on every
          // build, claim, feed, assign, upgrade and decorate, so nothing becomes unreachable.
          case 'view':
            await i.reply(guestsPayload(ctx, i.user.id));
            return;
          case 'build': {
            // Stamped here because buildAttraction reads the high-water as its unlock gate:
            // every account predating that column starts at a stored 0, so without this the
            // catalog would refuse a kind the dashboard already shows as earned. This arm
            // mutates regardless, so the parkRating write riding along carries no surprise.
            recomputeRating(ctx, i.user.id);
            const kind = i.options.getString('attraction', true);
            // One subcommand for both: an unowned kind is built, an owned one is upgraded.
            // Two subcommands would have made the player track which state they are in.
            const owned = attractionRows(ctx, i.user.id).some((r) => r.kind === kind);
            try {
              const result = owned
                ? upgradeAttraction(ctx, i.user.id, kind)
                : { def: buildAttraction(ctx, i.user.id, kind), level: 1 };
              await i.reply(builtPayload(ctx, i.user.id, result.def, result.level));
            } catch (e) {
              // Every service error maps to an ephemeral reply; anything unrecognised
              // rethrows so the router's error path reports it rather than swallowing it.
              const msg =
                e instanceof AttractionLockedError ? `Your park is not drawing enough guests for the ${e.message} yet.`
                : e instanceof DuplicateAttractionError ? `You already have a ${e.message}.`
                : e instanceof AttractionMaxedError ? `Your ${e.message} is already at its top level.`
                : e instanceof UnknownAttractionError ? 'No such attraction.'
                : e instanceof InsufficientFundsError ? 'Not enough cash.'
                : null;
              if (msg === null) throw e;
              await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
            }
            return;
          }
          case 'claim':
            // Same reason as build: claimableMilestones gates on the stored high-water, so a
            // pre-migration account would be offered nothing until some other command
            // stamped it. This arm leads straight to a payout, so the write belongs here.
            recomputeRating(ctx, i.user.id);
            await i.reply(milestonePayload(ctx, i.user.id));
            return;
          default:
            await i.reply({ content: 'Unknown /guests subcommand.', flags: MessageFlags.Ephemeral });
        }
      },
    },
  ],
  components: [
    {
      prefix: 'guests',
      async execute(ctx, i) {
        // The milestone rides in the customId, validated after the owner check and before
        // any read or write. This is the park:landmark:buy lesson: a Discord message is
        // durable and its label is not re-derived, so one stale button charged 5M/10M/20M/40M
        // against a ladder that re-derived its own rung on every click.
        const [, action, uid, atStr] = i.customId.split(':');
        if (action !== 'claim') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) {
          await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
          return;
        }
        const at = Number(atStr);
        if (!Number.isInteger(at)) {
          await i.reply({ content: 'That reward is no longer available.', flags: MessageFlags.Ephemeral });
          return;
        }
        // claimMilestone throws MilestoneUnavailableError for BOTH "high-water not
        // reached" and "already claimed" — the two are textually indistinguishable
        // (src/modules/guests/service.ts), so both collapse to one shared, honest reply
        // rather than a wrong specific one.
        try {
          claimMilestone(ctx, i.user.id, at);
        } catch (e) {
          if (!(e instanceof MilestoneUnavailableError)) throw e;
          await i.reply({ content: 'That reward is no longer available.', flags: MessageFlags.Ephemeral });
          return;
        }
        // Re-render so the message that was just used advances — a second layer only.
        // The customId check above is what actually protects the claim. No attachments
        // key by hand: guestsPayload attaches banners/guests on every render, so this
        // update replaces the message's attachment set with an identical one. Setting
        // `attachments: []` here would be the fightFrames rule misapplied — that rule
        // exists because one MessagePayload object reaches two send sites and each must
        // shed the other's set; this payload is built fresh and sent exactly once.
        await i.update(guestsPayload(ctx, i.user.id));
      },
    },
  ],
};
