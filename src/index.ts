import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { loadConfig } from './core/config.js';
import { createDb, migrateDb } from './core/db/index.js';
import { EconomyService } from './core/economy.js';
import { loadAppEmojis } from './core/emojis.js';
import { logger } from './core/logger.js';
import { ModuleRegistry } from './core/modules.js';
import { clientSender, deliverNotification, eggHatchHandler, expeditionReturnHandler, breedingReadyHandler } from './core/notify.js';
import { routeInteraction } from './core/router.js';
import { Scheduler } from './core/scheduler.js';
import { ALL_MODULES } from './core/module-list.js';
import { dailyRouterHooks } from './modules/daily/hooks.js';
import type { Ctx } from './core/context.js';

const config = loadConfig();
const db = createDb(config.databasePath);
migrateDb(db);
const scheduler = new Scheduler(db);
const ctx: Ctx = {
  db, economy: new EconomyService(db), config, scheduler,
  now: () => Date.now(), rng: Math.random,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  notify: (userId, originGuildId, message) => deliverNotification(sender, ctx, userId, originGuildId, message),
};
const registry = new ModuleRegistry(ALL_MODULES, config.modules);
// parse: [] — nothing in a message ever pings from parsed text. Several commands echo
// user-supplied strings into public content (/dino rename, /park rename); without this,
// a name like "<@&123456789012345678>" would ping a role. Set once here so every current
// and future send site is covered, rather than on individual reply/update payloads.
const client = new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] } });

const sender = clientSender(client);
scheduler.register('egg_hatch', eggHatchHandler(sender, ctx));
scheduler.register('expedition_return', expeditionReturnHandler(sender, ctx));
scheduler.register('breeding_ready', breedingReadyHandler(sender, ctx));

setInterval(() => { scheduler.tick(Date.now()).catch((e) => logger.error({ err: e }, 'scheduler tick failed')); }, 30_000);

client.on(Events.InteractionCreate, (i) => {
  routeInteraction(ctx, registry, i, dailyRouterHooks).catch((e) => logger.error({ err: e }, 'route failed'));
});
client.on('error', (e) => logger.error({ err: e }, 'discord client error'));
client.once(Events.ClientReady, (c) => {
  logger.info(`Logged in as ${c.user.tag}`);
  void loadAppEmojis(client);
  scheduler.tick(Date.now()).catch((e) => logger.error({ err: e }, 'scheduler boot scan failed'));
});
await client.login(config.token);
