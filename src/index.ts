import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { loadConfig } from './core/config.js';
import { createDb, migrateDb } from './core/db/index.js';
import { EconomyService } from './core/economy.js';
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
setInterval(() => { scheduler.tick(Date.now()).catch((e) => console.error('scheduler tick failed', e)); }, 30_000);
scheduler.tick(Date.now()).catch((e) => console.error('scheduler boot scan failed', e));  // fire anything missed while down

client.on(Events.InteractionCreate, (i) => {
  routeInteraction(ctx, registry, i).catch((e) => console.error('route failed', e));
});
client.once(Events.ClientReady, (c) => console.log(`Logged in as ${c.user.tag}`));
await client.login(config.token);
