import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { loadConfig } from './core/config.js';
import { createDb, migrateDb } from './core/db/index.js';
import { EconomyService } from './core/economy.js';
import { logger } from './core/logger.js';
import { ModuleRegistry } from './core/modules.js';
import { routeInteraction } from './core/router.js';
import { Scheduler } from './core/scheduler.js';
import { parkModule } from './modules/park/index.js';
import type { Ctx } from './core/context.js';

const config = loadConfig();
const db = createDb(config.databasePath);
migrateDb(db);
const ctx: Ctx = {
  db, economy: new EconomyService(db), config,
  now: () => Date.now(), rng: Math.random,
};
const registry = new ModuleRegistry([parkModule], config.modules);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const scheduler = new Scheduler(db);
setInterval(() => { scheduler.tick(Date.now()).catch((e) => logger.error({ err: e }, 'scheduler tick failed')); }, 30_000);
scheduler.tick(Date.now()).catch((e) => logger.error({ err: e }, 'scheduler boot scan failed'));  // fire anything missed while down

client.on(Events.InteractionCreate, (i) => {
  routeInteraction(ctx, registry, i).catch((e) => logger.error({ err: e }, 'route failed'));
});
client.on('error', (e) => logger.error({ err: e }, 'discord client error'));
client.once(Events.ClientReady, (c) => logger.info(`Logged in as ${c.user.tag}`));
await client.login(config.token);
