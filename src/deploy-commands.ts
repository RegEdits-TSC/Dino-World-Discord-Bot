import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadConfig } from './core/config.js';
import { ModuleRegistry } from './core/modules.js';
import { parkModule } from './modules/park/index.js';
import { hatcheryModule } from './modules/hatchery/index.js';
import { expeditionsModule } from './modules/expeditions/index.js';
import { shopModule } from './modules/shop/index.js';
import { settingsModule } from './modules/settings/index.js';

const config = loadConfig();
const registry = new ModuleRegistry([parkModule, hatcheryModule, expeditionsModule, shopModule, settingsModule], config.modules);
const body = registry.commands().map((c) => c.data.toJSON());
const rest = new REST().setToken(config.token);
await rest.put(Routes.applicationCommands(config.clientId), { body });
console.log(`Deployed ${body.length} commands.`);
