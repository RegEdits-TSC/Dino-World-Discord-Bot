import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadConfig } from './core/config.js';
import { ModuleRegistry } from './core/modules.js';
import { parkModule } from './modules/park/index.js';

const config = loadConfig();
const registry = new ModuleRegistry([parkModule], config.modules);
const body = registry.commands().map((c) => c.data.toJSON());
const rest = new REST().setToken(config.token);
await rest.put(Routes.applicationCommands(config.clientId), { body });
console.log(`Deployed ${body.length} commands.`);
