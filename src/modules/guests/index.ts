import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
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
          case 'view':
            await i.reply(guestsPayload(ctx, i.user.id));
            return;
          case 'build': {
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
        // key: guestsPayload ships no art (the park:landmark:buy success path's own
        // precedent for a payload that never carries files), so there is nothing stale
        // for this update to shed.
        await i.update(guestsPayload(ctx, i.user.id));
      },
    },
  ],
};
