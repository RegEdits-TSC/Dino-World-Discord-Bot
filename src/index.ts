import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { loadConfig } from './core/config.js';
import { createDb, migrateDb } from './core/db/index.js';
import { EconomyService } from './core/economy.js';
import { ModuleRegistry } from './core/modules.js';
import { routeInteraction } from './core/router.js';
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

client.on(Events.InteractionCreate, (i) => void routeInteraction(ctx, registry, i));
client.once(Events.ClientReady, (c) => console.log(`Logged in as ${c.user.tag}`));
await client.login(config.token);
