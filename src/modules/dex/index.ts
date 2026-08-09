import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { matches, respondRanked, capitalize } from '../../core/autocomplete.js';
import { allSpecies } from '../../data/species/index.js';
import type { Archetype, Diet, Rarity } from '../../data/types.js';
import { dexListPayload, dexViewPayload } from './embeds.js';

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const DIETS: Diet[] = ['herbivore', 'carnivore'];
const ARCHETYPES: Archetype[] = ['bruiser', 'tank', 'swift', 'support'];

export const dexModule: ModuleManifest = {
  name: 'dex',
  commands: [
    {
      data: new SlashCommandBuilder().setName('dex').setDescription('The species compendium')
        .addSubcommand((s) => s.setName('list').setDescription('Browse every species')
          .addStringOption((o) => o.setName('rarity').setDescription('Filter by rarity')
            .addChoices(...RARITIES.map((r) => ({ name: capitalize(r), value: r }))))
          .addStringOption((o) => o.setName('diet').setDescription('Filter by diet')
            .addChoices(...DIETS.map((d) => ({ name: capitalize(d), value: d }))))
          .addStringOption((o) => o.setName('archetype').setDescription('Filter by combat role')
            .addChoices(...ARCHETYPES.map((a) => ({ name: capitalize(a), value: a }))))
          .addIntegerOption((o) => o.setName('page').setDescription('Page number')))
        .addSubcommand((s) => s.setName('view').setDescription('One species in detail')
          .addStringOption((o) => o.setName('species').setDescription('Species — type to search').setRequired(true).setAutocomplete(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        if (sub === 'view') {
          const id = i.options.getString('species', true);
          // 42 species exceeds Discord's 25-choice cap, so the value is a free-text
          // string even with autocomplete: an unknown id is a normal input, not a bug.
          if (!allSpecies().some((s) => s.id === id)) {
            await i.reply({ content: 'No such species.', flags: MessageFlags.Ephemeral });
            return;
          }
          await i.reply(dexViewPayload(ctx, i.user.id, id));
          return;
        }
        if (sub === 'list') {
          await i.reply(dexListPayload(ctx, i.user.id, {
            rarity: (i.options.getString('rarity') as Rarity | null) ?? undefined,
            diet: (i.options.getString('diet') as Diet | null) ?? undefined,
            archetype: (i.options.getString('archetype') as Archetype | null) ?? undefined,
          }, i.options.getInteger('page') ?? 1));
          return;
        }
        // Deliberately not the /park dispatch trap: an unrecognised subcommand
        // reports failure instead of silently rendering a default view.
        await i.reply({ content: 'Unknown /dex subcommand.', flags: MessageFlags.Ephemeral });
      },
      // Static data only: no DB read, no user row, no custom emoji in labels.
      async autocomplete(ctx, i) {
        const q = String(i.options.getFocused());
        await respondRanked(i, allSpecies()
          .filter((s) => matches(q, s.name, s.id, s.rarity, s.archetype))
          .map((s) => ({ value: s.id, valid: true, label: `${s.name} — ${capitalize(s.rarity)} ${s.archetype}` })));
      },
    },
  ],
  components: [
    {
      prefix: 'dex',
      async execute(ctx, i) {
        // Same owner-lock discipline as the 'ach' prefix (src/modules/daily/index.ts):
        // the customId's uid segment is checked against the clicker before any read
        // or write, and an unrecognized action degrades to deferUpdate rather than
        // erroring.
        const [, action, uid, pageStr] = i.customId.split(':');
        if (action !== 'page') { await i.deferUpdate(); return; }
        if (i.user.id !== uid) { await i.reply({ content: 'Not your dex.', flags: MessageFlags.Ephemeral }); return; }
        await i.update({ ...dexListPayload(ctx, i.user.id, {}, Number(pageStr)), attachments: [] });
      },
    },
  ],
};
