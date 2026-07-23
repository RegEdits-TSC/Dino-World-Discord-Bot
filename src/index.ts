import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { loadConfig } from './core/config.js';
import { createDb, migrateDb } from './core/db/index.js';
import { EconomyService } from './core/economy.js';
import { loadAppEmojis } from './core/emojis.js';
import { logger } from './core/logger.js';
import { ModuleRegistry } from './core/modules.js';
import { clientSender, deliverNotification, eggHatchHandler, expeditionReturnHandler } from './core/notify.js';
import { routeInteraction } from './core/router.js';
import { Scheduler } from './core/scheduler.js';
import { parkModule } from './modules/park/index.js';
import { hatcheryModule } from './modules/hatchery/index.js';
import { expeditionsModule } from './modules/expeditions/index.js';
import { shopModule } from './modules/shop/index.js';
import { settingsModule } from './modules/settings/index.js';
import { careModule } from './modules/care/index.js';
import { tradingModule } from './modules/trading/index.js';
import { leaderboardsModule } from './modules/leaderboards/index.js';
import { adminModule } from './modules/admin/index.js';
import { helpModule } from './modules/help/index.js';
import type { Ctx } from './core/context.js';

const config = loadConfig();
const db = createDb(config.databasePath);
migrateDb(db);
const scheduler = new Scheduler(db);
const ctx: Ctx = {
  db, economy: new EconomyService(db), config, scheduler,
  now: () => Date.now(), rng: Math.random,
  notify: (userId, originGuildId, message) => deliverNotification(sender, ctx, userId, originGuildId, message),
};
const registry = new ModuleRegistry([parkModule, hatcheryModule, expeditionsModule, shopModule, settingsModule, careModule, tradingModule, leaderboardsModule, adminModule, helpModule], config.modules);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const sender = clientSender(client);
scheduler.register('egg_hatch', eggHatchHandler(sender, ctx));
scheduler.register('expedition_return', expeditionReturnHandler(sender, ctx));

setInterval(() => { scheduler.tick(Date.now()).catch((e) => logger.error({ err: e }, 'scheduler tick failed')); }, 30_000);

client.on(Events.InteractionCreate, (i) => {
  routeInteraction(ctx, registry, i).catch((e) => logger.error({ err: e }, 'route failed'));
});
client.on('error', (e) => logger.error({ err: e }, 'discord client error'));
client.once(Events.ClientReady, (c) => {
  logger.info(`Logged in as ${c.user.tag}`);
  void loadAppEmojis(client);
  scheduler.tick(Date.now()).catch((e) => logger.error({ err: e }, 'scheduler boot scan failed'));
});
await client.login(config.token);
