import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser, buildLot, upgradeLot, collectIncome, pendingIncome, LotLimitError, UnknownKindError } from './service.js';
import { settleEscapes } from './escapes.js';
import { assignDino, unassignDino, decorateLot, listDinos, AssignError } from './dinos.js';
import { dashboardPayload } from './embeds.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { PADDOCKS } from '../../data/paddocks.js';
import { FACILITIES } from '../../data/facilities.js';
import { DECOR } from '../../data/decor.js';

const kindChoices = [...Object.keys(PADDOCKS), ...Object.keys(FACILITIES)]
  .map((k) => ({ name: k.replaceAll('_', ' '), value: k }));

export const parkModule: ModuleManifest = {
  name: 'park',
  commands: [
    {
      data: new SlashCommandBuilder().setName('park').setDescription('Your park')
        .addSubcommand((s) => s.setName('view').setDescription('Park dashboard'))
        .addSubcommand((s) => s.setName('rename').setDescription('Rename your park')
          .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(60))),
      async execute(ctx, i) {
        const user = getOrCreateUser(ctx, i.user.id, i.user.displayName);
        if (i.options.getSubcommand() === 'rename') {
          const name = i.options.getString('name', true);
          ctx.db.update(schema.users).set({ parkName: name })
            .where(eq(schema.users.discordId, i.user.id)).run();
          await i.reply({ content: `Park renamed to **${name}**.` });
          return;
        }
        settleEscapes(ctx, i.user.id);
        const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all();
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        await i.reply(dashboardPayload(user, lots, dinos.length, pendingIncome(ctx, i.user.id)));
      },
    },
    {
      data: new SlashCommandBuilder().setName('build').setDescription('Build on an empty lot')
        .addStringOption((o) => o.setName('kind').setDescription('What to build').setRequired(true)
          .addChoices(...kindChoices)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const lot = buildLot(ctx, i.user.id, i.options.getString('kind', true));
          await i.reply({ content: `🏗️ Built **${lot.name}** (lot #${lot.id}).` });
        } catch (e) {
          if (e instanceof LotLimitError) await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
    },
    {
      data: new SlashCommandBuilder().setName('upgrade').setDescription('Upgrade a lot')
        .addIntegerOption((o) => o.setName('lot').setDescription('Lot id from /park view').setRequired(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const lot = upgradeLot(ctx, i.user.id, i.options.getInteger('lot', true));
          await i.reply({ content: `⬆️ **${lot.name}** is now level ${lot.level}.` });
        } catch (e) {
          if (e instanceof LotLimitError) await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });
          else if (e instanceof UnknownKindError) await i.reply({ content: 'No such lot.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
    },
    {
      data: new SlashCommandBuilder().setName('dino').setDescription('Manage your dinos')
        .addSubcommand((s) => s.setName('list').setDescription('List your dinos'))
        .addSubcommand((s) => s.setName('assign').setDescription('Assign a dino to a paddock')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino id').setRequired(true))
          .addIntegerOption((o) => o.setName('lot').setDescription('Paddock lot id').setRequired(true)))
        .addSubcommand((s) => s.setName('unassign').setDescription('Remove a dino from its paddock')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino id').setRequired(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'list') {
            settleEscapes(ctx, i.user.id);
            const dinos = listDinos(ctx, i.user.id);
            const lines = dinos.length
              ? dinos.map((d) => `#${d.dino.id} ${d.species.name} — ${Math.round(d.comfort * 100)}% comfort — ${d.dino.lotId ? `lot ${d.dino.lotId}` : 'unassigned'}`).join('\n')
              : 'No dinos yet. Hatch one!';
            await i.reply({ embeds: [new EmbedBuilder().setTitle('🦕 Your dinos').setDescription(lines).setColor(0x3ba55c)] });
          } else if (sub === 'assign') {
            assignDino(ctx, i.user.id, i.options.getInteger('dino', true), i.options.getInteger('lot', true));
            await i.reply({ content: '🦕 Assigned.' });
          } else {
            unassignDino(ctx, i.user.id, i.options.getInteger('dino', true));
            await i.reply({ content: '🦕 Unassigned.' });
          }
        } catch (e) { if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      },
    },
    {
      data: new SlashCommandBuilder().setName('decorate').setDescription('Add decor to a paddock')
        .addIntegerOption((o) => o.setName('lot').setDescription('Paddock lot id').setRequired(true))
        .addStringOption((o) => o.setName('item').setDescription('Decoration').setRequired(true).addChoices(...Object.values(DECOR).map((d) => ({ name: d.name, value: d.kind })))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          decorateLot(ctx, i.user.id, i.options.getInteger('lot', true), i.options.getString('item', true));
          await i.reply({ content: '🌴 Decoration added.' });
        } catch (e) {
          if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
    },
  ],
  components: [
    {
      prefix: 'park',
      async execute(ctx, i) {
        if (i.customId === 'park:collect') {
          settleEscapes(ctx, i.user.id);
          const { amount } = collectIncome(ctx, i.user.id);
          await i.reply({ content: amount > 0 ? `💰 Collected **${amount.toLocaleString()}** cash.` : 'Nothing to collect yet.', flags: MessageFlags.Ephemeral });
        }
      },
    },
  ],
};
