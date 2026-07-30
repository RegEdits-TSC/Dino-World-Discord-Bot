import { SlashCommandBuilder, EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { assetImage, attach } from '../../core/images.js';
import { renderPark } from '../../core/render/client.js';
import { buildParkSnapshot } from '../park/snapshot.js';
import { withParkImage } from '../park/embeds.js';

// Art is a LAZY descriptor, never a built ImageRef: assetImage returns a fresh
// AttachmentBuilder per call and this map is module-level.
interface HelpTopic { title: string; body: string; art?: { kind: 'eggs' | 'sites' | 'banners'; name: string } }

export const HELP_TOPICS: Record<string, HelpTopic> = {
  'getting-started': { title: '🦕 Getting started', art: { kind: 'banners', name: 'help' }, body: [
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
  eggs: { title: '🥚 Eggs', art: { kind: 'eggs', name: 'rare' }, body: [
    '`/eggs` — your eggs and incubator status.',
    '`/incubate egg:<id>` — start the timer (slots grow with the Hatchery Lab).',
    '`/hatch egg:<id>` — crack a ready egg and meet your dino.',
    '`/mythic species:<name>` — spend 500 shards on a Mythic egg (needs 4★ rating).',
  ].join('\n') },
  expeditions: { title: '🧭 Expeditions', art: { kind: 'sites', name: 'coastal_dig-banner' }, body: [
    '`/expedition start site:<site>` — pay cash, wait, get loot. Higher sites need higher rating.',
    '`/expedition status` — check the timer.',
    '`/expedition claim` — collect the egg + cash + food.',
    'Sites: Coastal Dig (15m) → Amber Ridge (1h) → Frozen Cliffs (4h) → Volcano Core (8h).',
  ].join('\n') },
  shop: { title: '🏪 Shop', art: { kind: 'banners', name: 'shop_food_market' }, body: [
    '`/shop view` — today\'s egg rotation (changes daily), food, decor.',
    '`/shop egg rarity:<r>` — buy an egg from today\'s rotation.',
    '`/shop food item:<food> units:<n>` — diet-matched food; carnivore food costs ~20% more.',
    '`/sell dino:<id>` — sell a dino for cash + shards (shards buy Mythics).',
  ].join('\n') },
  care: { title: '🍖 Care', art: { kind: 'banners', name: 'care' }, body: [
    '`/feed one dino:<id> [food:<item>]` or `/feed all` — feeding resets hunger; costs food by rarity.',
    'Dinos only eat their diet: herbivores get Ferns/Fruit Basket/Royal Greens, carnivores get Fish/Goat/Prime Steak.',
    'Premium food overfills hunger (up to 150) so dinos stay fed longer.',
    'Hunger drains over 48h. Low comfort long enough → the dino escapes and stops earning.',
    '`/rescue dino:<id>` — recapture an escaped dino for a fee.',
  ].join('\n') },
  trading: { title: '🤝 Trading', art: { kind: 'banners', name: 'trading' }, body: [
    '`/trade offer user:<u> ...` — offer dinos/eggs/cash/food (item + qty) for theirs.',
    '`/trade list` — pending trades. `/trade accept|decline id:<id>` as recipient, `/trade cancel id:<id>` as sender.',
    'Offers expire after a while; offered items are locked until resolved.',
  ].join('\n') },
  ranks: { title: '🏆 Ranks', art: { kind: 'banners', name: 'leaderboards' }, body: [
    '`/top metric:<rating|cash|collection> [scope]` — server or global leaderboards.',
    'Rating grows with dinos, lots, and comfort; it gates expeditions, shop tiers, and Mythics.',
  ].join('\n') },
  battles: { title: '⚔️ Battles', art: { kind: 'sites', name: 'coastal_dig-banner' }, body: [
    '`/battle chapters` — the campaign map: 4 chapters themed to the expedition sites, 5 stages each, the 5th a boss.',
    '`/battle fight stage:<stage> dino1:<id> [dino2] [dino3]` — send a squad of 1–3 dinos; the fight auto-resolves and plays back as a short cinematic (press Skip to jump to the result).',
    'Energy: every attempt costs ⚡ 1–3 by stage, win or lose. You hold up to 10 and regain 1 every 10 minutes.',
    'Squads: escaped dinos can\'t fight — rescue them first. Power comes from rarity, archetype (bruiser / tank / swift / support), and battle level: every fight pays battle XP, up to Lv.10.',
    'Stars: ★★★ win with no knockouts · ★★ win with ≤1 knockout or a fast finish · ★ any other win. Higher stars scale the cash/food payout; beating a stage for the first time also pays shards, once.',
    'Bosses: clear a chapter\'s boss for the first time to earn a high-rarity egg and open the next chapter — its expedition site\'s rating gate applies too.',
  ].join('\n') },
};

const topicChoices = Object.keys(HELP_TOPICS).map((t) => ({ name: t, value: t }));

export const helpModule: ModuleManifest = {
  name: 'help',
  commands: [
    { data: new SlashCommandBuilder().setName('help').setDescription('How to play Dino World')
        .addStringOption((o) => o.setName('topic').setDescription('Jump to a topic').addChoices(...topicChoices)),
      async execute(ctx, i) {
        const topic = i.options.getString('topic');
        if (topic && HELP_TOPICS[topic]) {
          const t = HELP_TOPICS[topic];
          const embed = new EmbedBuilder().setTitle(t.title).setDescription(t.body).setColor(0x5865F2);
          const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
          if (t.art) {
            attach(embed, payload, 'image', assetImage(t.art.kind, t.art.name));
          }
          if (topic === 'park') {
            // The park topic illustrates itself with the reader's own map: a worker
            // render, so defer first and degrade to the text-only embed on any
            // failure (including "this reader has no park row yet").
            await i.deferReply();
            let png: Buffer | undefined;
            try { png = await renderPark(buildParkSnapshot(ctx, i.user.id)); } catch { png = undefined; }
            await i.editReply(png ? withParkImage(payload, png) : payload);
            return;
          }
          await i.reply(payload);
          return;
        }
        // The no-topic overview must itself contain the first-10-minutes walkthrough (spec QoL item 1).
        const overview = new EmbedBuilder().setTitle('🦕 Dino World — help').setColor(0x5865F2)
          .setDescription(`Hatch dinos, build a park, keep them fed.\n\n${HELP_TOPICS['getting-started'].body}`)
          .addFields(Object.entries(HELP_TOPICS).map(([key, t]) => ({
            name: t.title, value: `\`/help topic:${key}\``, inline: true,
          })));
        const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [overview] };
        attach(overview, payload, 'image', assetImage('banners', 'help'));
        await i.reply(payload);
      } },
  ],
  components: [],
};
