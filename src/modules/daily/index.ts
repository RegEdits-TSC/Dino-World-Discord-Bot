import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { settleEscapes } from '../park/escapes.js';
import { rollDailyQuests, claimQuests, claimAchievements } from './service.js';
import { hubPayload, claimPayload, achievementsPayload, claimAllPayload } from './embeds.js';
import { rollSeason, seasonView, claimSeason } from './season.js';
import { seasonPayload, seasonClaimPayload } from './season-embeds.js';
import { seasonIndexFor } from '../../core/world.js';

export const dailyModule: ModuleManifest = {
  name: 'daily',
  commands: [
    {
      data: new SlashCommandBuilder().setName('daily').setDescription('Your daily quests, streak, and chest'),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        rollDailyQuests(ctx, i.user.id);
        await i.reply(hubPayload(ctx, i.user.id));
      },
    },
    {
      data: new SlashCommandBuilder().setName('achievements').setDescription('Your lifetime achievement tracks'),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        await i.reply(achievementsPayload(ctx, i.user.id, 1));
      },
    },
    {
      data: new SlashCommandBuilder().setName('season').setDescription('Your season track, rewards, and badge'),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        rollSeason(ctx, i.user.id);
        await i.reply(seasonPayload(seasonView(ctx, i.user.id)!, i.user.id));
      },
    },
  ],
  components: [
    {
      prefix: 'daily',
      async execute(ctx, i) {
        // The custom id is client-supplied: the owner segment is a plain Discord
        // snowflake string (never parsed to a number), checked directly against
        // the clicker's own id before any read or write happens.
        const [, action, uid] = i.customId.split(':');
        if (action !== 'claim') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) { await i.reply({ content: 'Not your quests.', flags: MessageFlags.Ephemeral }); return; }
        const result = claimQuests(ctx, i.user.id);
        if (!result.claimed.length) {
          await i.reply({ content: 'Nothing to claim — quests reset at UTC midnight.', flags: MessageFlags.Ephemeral });
          return;
        }
        await i.reply({ ...claimPayload(result), flags: MessageFlags.Ephemeral });
      },
    },
    {
      prefix: 'ach',
      async execute(ctx, i) {
        // Same owner-lock discipline as the 'daily' prefix above: the customId's uid
        // segment is checked against the clicker before any read or write, and an
        // unrecognized action degrades to deferUpdate rather than erroring.
        const [, action, uid, pageStr] = i.customId.split(':');
        if (action !== 'page' && action !== 'claimall') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) { await i.reply({ content: 'Not your achievements.', flags: MessageFlags.Ephemeral }); return; }
        if (action === 'page') {
          await i.update({ ...achievementsPayload(ctx, i.user.id, Number(pageStr)), attachments: [] });
          return;
        }
        const result = claimAchievements(ctx, i.user.id);
        if (!result.claimed.length) {
          await i.reply({ content: 'Nothing to claim yet.', flags: MessageFlags.Ephemeral });
          return;
        }
        await i.reply({ ...claimAllPayload(result), flags: MessageFlags.Ephemeral });
      },
    },
    {
      prefix: 'season',
      async execute(ctx, i) {
        // Same owner-lock discipline as 'daily' and 'ach', plus a season check: the
        // customId carries the season it was minted for, and a card left open across a
        // rollover must not pay this season's rungs against last season's ladder.
        const [, action, uid, indexStr] = i.customId.split(':');
        if (action !== 'claim') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) { await i.reply({ content: 'Not your season track.', flags: MessageFlags.Ephemeral }); return; }
        const offered = Number(indexStr);
        if (!Number.isInteger(offered) || offered !== seasonIndexFor(ctx.now())) {
          await i.reply({ content: 'That season has ended — run **/season** for the current one.', flags: MessageFlags.Ephemeral });
          return;
        }
        rollSeason(ctx, i.user.id);
        const result = claimSeason(ctx, i.user.id);
        if (!result.claimed.length) {
          await i.reply({ content: 'Nothing to claim yet — keep playing.', flags: MessageFlags.Ephemeral });
          return;
        }
        await i.reply({ ...seasonClaimPayload(result), flags: MessageFlags.Ephemeral });
      },
    },
  ],
};
