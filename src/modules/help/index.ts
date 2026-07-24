import { SlashCommandBuilder, EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { assetImage } from '../../core/images.js';

export const HELP_TOPICS: Record<string, { title: string; body: string }> = {
  'getting-started': { title: '🦕 Getting started', body: [
    'Your first 10 minutes:',
    '1. `/park view` — see your park and the Collect button.',
    '2. `/expedition start site:coastal_dig` — send a dig crew (15 min).',
    '3. `/expedition claim` when it returns — you get an egg + cash + food.',
    '4. `/incubate egg:<id>`, then `/hatch egg:<id>` when ready.',
    '5. `/build kind:herbivore_paddock`, then `/dino assign` — unassigned dinos earn nothing.',
    '6. `/feed all` regularly — hungry dinos get uncomfortable and eventually escape.',
  ].join('\n') },
  park: { title: '🏞️ Park', body: [
    '`/park view [user]` — dashboard, park map, Collect button.',
    '`/park rename name:<text>` — rename your park.',
    '`/build kind:<lot>` — build a paddock or facility on an empty lot.',
    '`/upgrade lot:<id>` — raise a lot one level.',
    '`/decorate lot:<id> item:<decor>` — decor boosts comfort for matching biomes.',
    'Income accrues while dinos are comfortable, up to your Visitor Center cap — collect often.',
    'Dinos in the wrong-diet paddock earn half comfort — the bot warns before you assign one.',
  ].join('\n') },
  eggs: { title: '🥚 Eggs', body: [
    '`/eggs` — your eggs and incubator status.',
    '`/incubate egg:<id>` — start the timer (slots grow with the Hatchery Lab).',
    '`/hatch egg:<id>` — crack a ready egg and meet your dino.',
    '`/mythic species:<name>` — spend 500 shards on a Mythic egg (needs 4★ rating).',
  ].join('\n') },
  expeditions: { title: '🧭 Expeditions', body: [
    '`/expedition start site:<site>` — pay cash, wait, get loot. Higher sites need higher rating.',
    '`/expedition status` — check the timer.',
    '`/expedition claim` — collect the egg + cash + food.',
    'Sites: Coastal Dig (15m) → Amber Ridge (1h) → Frozen Cliffs (4h) → Volcano Core (8h).',
  ].join('\n') },
  shop: { title: '🏪 Shop', body: [
    '`/shop view` — today\'s egg rotation (changes daily), food, decor.',
    '`/shop egg rarity:<r>` — buy an egg from today\'s rotation.',
    '`/shop food item:<food> units:<n>` — diet-matched food; carnivore food costs ~20% more.',
    '`/sell dino:<id>` — sell a dino for cash + shards (shards buy Mythics).',
  ].join('\n') },
  care: { title: '🍖 Care', body: [
    '`/feed one dino:<id> [food:<item>]` or `/feed all` — feeding resets hunger; costs food by rarity.',
    'Dinos only eat their diet: herbivores get Ferns/Fruit Basket/Royal Greens, carnivores get Fish/Goat/Prime Steak.',
    'Premium food overfills hunger (up to 150) so dinos stay fed longer.',
    'Hunger drains over 48h. Low comfort long enough → the dino escapes and stops earning.',
    '`/rescue dino:<id>` — recapture an escaped dino for a fee.',
  ].join('\n') },
  trading: { title: '🤝 Trading', body: [
    '`/trade offer user:<u> ...` — offer dinos/eggs/cash/food (item + qty) for theirs.',
    '`/trade list` — pending trades. `/trade accept|decline id:<id>` as recipient, `/trade cancel id:<id>` as sender.',
    'Offers expire after a while; offered items are locked until resolved.',
  ].join('\n') },
  ranks: { title: '🏆 Ranks', body: [
    '`/top metric:<rating|cash|collection> [scope]` — server or global leaderboards.',
    'Rating grows with dinos, lots, and comfort; it gates expeditions, shop tiers, and Mythics.',
  ].join('\n') },
};

const topicChoices = Object.keys(HELP_TOPICS).map((t) => ({ name: t, value: t }));

export const helpModule: ModuleManifest = {
  name: 'help',
  commands: [
    { data: new SlashCommandBuilder().setName('help').setDescription('How to play Dino World')
        .addStringOption((o) => o.setName('topic').setDescription('Jump to a topic').addChoices(...topicChoices)),
      async execute(_ctx, i) {
        const topic = i.options.getString('topic');
        if (topic && HELP_TOPICS[topic]) {
          const t = HELP_TOPICS[topic];
          await i.reply({ embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.body).setColor(0x5865F2)] });
          return;
        }
        // The no-topic overview must itself contain the first-10-minutes walkthrough (spec QoL item 1).
        const overview = new EmbedBuilder().setTitle('🦕 Dino World — help').setColor(0x5865F2)
          .setDescription(`Hatch dinos, build a park, keep them fed.\n\n${HELP_TOPICS['getting-started'].body}`)
          .addFields(Object.entries(HELP_TOPICS).map(([key, t]) => ({
            name: t.title, value: `\`/help topic:${key}\``, inline: true,
          })));
        const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [overview] };
        const banner = assetImage('banners', 'help');
        if (banner) { overview.setImage(banner.url); payload.files = [banner.file]; }
        await i.reply(payload);
      } },
  ],
  components: [],
};
